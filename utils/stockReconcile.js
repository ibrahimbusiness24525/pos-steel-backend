const Product = require("../models/Product");
const Purchase = require("../models/Purchase");
const PurchaseReturn = require("../models/PurchaseReturn");
const Sale = require("../models/Sale");
const SaleReturn = require("../models/SaleReturn");

function pid(v) {
  if (!v) return "";
  if (typeof v === "object") return String(v._id || v.id || "");
  return String(v);
}

function purchaseLineQty(p) {
  const q = Number(p?.qty);
  if (q > 0) return q;
  if (Array.isArray(p?.entries) && p.entries.length) {
    const fromEntries = p.entries.reduce((s, e) => s + (Number(e.quantity) || Number(e.qty) || 0), 0);
    if (fromEntries > 0) return fromEntries;
  }
  const fromRows = (p?.rows || []).reduce(
    (s, r) => s + (Number(r.qty) || Number(r.quantity) || Number(r.pieces) || Number(r.weight) || Number(r.feet) || 0),
    0
  );
  if (fromRows > 0) return fromRows;
  const rate = Number(p?.rate) || Number(p?.productPrice) || Number(p?.rows?.[0]?.purchasePrice) || 0;
  const total = Number(p?.total) || Number(p?.totalAmount) || 0;
  if (rate > 0 && total > 0) return Math.round((total / rate) * 1000) / 1000;
  return 0;
}

function addMap(map, id, qty) {
  const key = pid(id);
  const n = Number(qty) || 0;
  if (!key || n === 0) return;
  map[key] = (map[key] || 0) + n;
}

function hasStockBaseline(meta) {
  if (!meta || !meta.at) return false;
  const n = Number(meta.baseline);
  return Number.isFinite(n) && n >= 0;
}

function isAfterBaseline(doc, at) {
  const t = new Date(doc?.createdAt || 0).getTime();
  const b = new Date(at).getTime();
  return Number.isFinite(t) && Number.isFinite(b) && t > b;
}

/** On-hand after a stock edit: the typed count, plus only purchases/sales saved after that edit. */
function applyBaselineStock(baseline, purchasedAfter, purchRetAfter, soldAfter, saleRetAfter) {
  const stock = (Number(baseline) || 0)
    + (Number(purchasedAfter) || 0)
    - (Number(purchRetAfter) || 0)
    - (Number(soldAfter) || 0)
    + (Number(saleRetAfter) || 0);
  return Math.max(0, Math.round(stock * 1000) / 1000);
}

/** Old bills sit inside the edited count. A qty change on one of them moves that count, it does not restore the previous pieces. */
async function shiftStockBaseline(adminId, productId, billCreatedAt, delta) {
  const id = pid(productId);
  const n = Number(delta) || 0;
  if (!adminId || !id || !n) return;
  const prod = await Product.findOne({ _id: id, adminId }).select("stockBaseline stockBaselineAt");
  if (!hasStockBaseline({ baseline: prod?.stockBaseline, at: prod?.stockBaselineAt })) return;
  const billTime = new Date(billCreatedAt || 0).getTime();
  const baseTime = new Date(prod.stockBaselineAt).getTime();
  if (!(billTime <= baseTime)) return;
  const next = applyBaselineStock(prod.stockBaseline, n, 0, 0, 0);
  await Product.updateOne({ _id: id, adminId }, { $set: { stockBaseline: next } });
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Only accept product ids that belong to this admin; otherwise resolve by name. */
function makeResolveId(products) {
  const ownedIds = new Set();
  const nameToId = new Map();
  (products || []).forEach((p) => {
    const id = pid(p._id);
    const name = String(p.name || "").trim().toLowerCase();
    if (id) ownedIds.add(id);
    if (id && name && !nameToId.has(name)) nameToId.set(name, id);
  });
  return (rawId, rawName) => {
    const id = pid(rawId);
    if (id && ownedIds.has(id)) return id;
    const name = String(rawName || "").trim().toLowerCase();
    return name ? nameToId.get(name) || "" : "";
  };
}

/**
 * Fix purchases whose product id points outside this shop (or is missing)
 * by re-linking to the same-named product under adminId.
 */
async function repairPurchaseProductLinks(adminId) {
  if (!adminId) return 0;
  const products = await Product.find({ adminId }).select("_id name").lean();
  const ownedIds = new Set(products.map((p) => pid(p._id)).filter(Boolean));
  const nameToId = new Map();
  products.forEach((p) => {
    const n = String(p.name || "").trim().toLowerCase();
    if (n && !nameToId.has(n)) nameToId.set(n, pid(p._id));
  });

  const purchases = await Purchase.find({ adminId }).select("_id product productName").lean();
  let repaired = 0;
  for (const p of purchases) {
    const id = pid(p.product);
    if (id && ownedIds.has(id)) continue;
    const name = String(p.productName || "").trim().toLowerCase();
    const correct = name ? nameToId.get(name) : "";
    if (!correct) continue;
    await Purchase.updateOne({ _id: p._id, adminId }, { $set: { product: correct } });
    repaired += 1;
  }
  return repaired;
}

async function computeStockByProduct(adminId) {
  const purchased = {};
  const purchRet = {};
  const sold = {};
  const saleRet = {};
  const purchasedAfter = {};
  const purchRetAfter = {};
  const soldAfter = {};
  const saleRetAfter = {};

  const [products, purchases, purchaseReturns, sales, saleReturns] = await Promise.all([
    Product.find({ adminId }).select("_id name stockBaseline stockBaselineAt").lean(),
    Purchase.find({ adminId }).select("product productName qty rows entries createdAt").lean(),
    PurchaseReturn.find({ adminId }).select("items createdAt").lean(),
    Sale.find({ adminId }).select("product productName qty saleItems items createdAt").lean(),
    SaleReturn.find({ adminId }).select("items createdAt").lean(),
  ]);

  const resolveId = makeResolveId(products);
  const metaById = {};
  products.forEach((p) => {
    const id = pid(p._id);
    if (id) metaById[id] = { baseline: p.stockBaseline, at: p.stockBaselineAt };
  });

  // A stock edit freezes on-hand at that moment. Bills from before the edit
  // must not be added again when a later purchase rebuilds stock.
  const addQty = (allMap, afterMap, id, qty, doc) => {
    const key = pid(id);
    const n = Number(qty) || 0;
    if (!key || !n) return;
    const meta = metaById[key];
    if (hasStockBaseline(meta)) {
      if (isAfterBaseline(doc, meta.at)) addMap(afterMap, key, n);
      return;
    }
    addMap(allMap, key, n);
  };

  purchases.forEach((p) => {
    if (Array.isArray(p.entries) && p.entries.length) {
      p.entries.forEach((e) => {
        addQty(
          purchased,
          purchasedAfter,
          resolveId(e.product || e.productId, e.productName || e.name || p.productName),
          e.quantity || e.qty,
          p
        );
      });
    } else {
      addQty(purchased, purchasedAfter, resolveId(p.product, p.productName), purchaseLineQty(p), p);
    }
  });

  purchaseReturns.forEach((r) => {
    (r.items || []).forEach((it) => {
      addQty(
        purchRet,
        purchRetAfter,
        resolveId(it.product || it.productId, it.productName || it.name),
        it.qty,
        r
      );
    });
  });

  sales.forEach((s) => {
    const saleItems = Array.isArray(s.saleItems) ? s.saleItems : [];
    const items = Array.isArray(s.items) ? s.items : [];
    const seen = new Set();
    // Same rule as the stock list: one product counts once per bill (first line).
    // A line with its own id must not inherit the bill's first product name.
    const nameFor = (ownName, lineCount) => {
      const own = String(ownName || "").trim();
      if (own) return own;
      return lineCount === 1 ? s.productName : "";
    };
    const take = (rawId, rawName, qty, lineCount) => {
      const id = resolveId(rawId, nameFor(rawName, lineCount));
      const q = Number(qty) || 0;
      if (!id || q <= 0 || seen.has(id)) return;
      seen.add(id);
      addQty(sold, soldAfter, id, q, s);
    };
    const itemQty = (it) => {
      if (Number(it?.qty) > 0) return Number(it.qty);
      const row = it?.rows?.[0] || {};
      return Number(row.qty) || Number(row.quantity) || Number(row.weight) || Number(row.feet) || 0;
    };
    saleItems.forEach((si) => take(si.productId || si.product, si.productName, si.qty, saleItems.length));
    items.forEach((it) => take(it.productId || it.product, it.productName, itemQty(it), items.length));
    if (!seen.size) take(s.product, s.productName, s.qty, 1);
  });

  saleReturns.forEach((r) => {
    (r.items || []).forEach((it) => {
      addQty(
        saleRet,
        saleRetAfter,
        resolveId(it.product || it.productId, it.productName || it.name),
        it.qty,
        r
      );
    });
  });

  const ids = new Set([
    ...Object.keys(purchased),
    ...Object.keys(purchRet),
    ...Object.keys(sold),
    ...Object.keys(saleRet),
    ...Object.keys(purchasedAfter),
    ...Object.keys(purchRetAfter),
    ...Object.keys(soldAfter),
    ...Object.keys(saleRetAfter),
    ...Object.keys(metaById).filter((id) => hasStockBaseline(metaById[id])),
  ]);

  const result = {};
  ids.forEach((id) => {
    const meta = metaById[id];
    result[id] = hasStockBaseline(meta)
      ? applyBaselineStock(meta.baseline, purchasedAfter[id], purchRetAfter[id], soldAfter[id], saleRetAfter[id])
      : Math.max(0, Math.round(((purchased[id] || 0) - (purchRet[id] || 0) - (sold[id] || 0) + (saleRet[id] || 0)) * 1000) / 1000);
  });
  return result;
}

/**
 * A new purchase may only add its own quantity.
 * If rebuilding from old bills would change the stock that was already there,
 * keep that stock and add just this purchase. This applies to every product.
 */
async function applyStockValueDelta(adminId, productId, qtyDelta, unitCost) {
  const id = pid(productId);
  const qty = Number(qtyDelta) || 0;
  if (!adminId || !id || !qty) return;
  const prod = await Product.findOne({ _id: id, adminId }).select("stock costValue listCost");
  if (!prod) return;
  const beforeStock = Number(prod.stock) || 0;
  const beforeVal = Number(prod.costValue) || 0;
  const rate = Number(unitCost) || Number(prod.listCost) || 0;
  let nextVal = beforeVal;
  if (qty > 0) nextVal = beforeVal + qty * rate;
  else if (beforeStock > 0.0001) nextVal = beforeVal * Math.max(0, (beforeStock + qty) / beforeStock);
  else nextVal = 0;
  const set = { costValue: Math.round(Math.max(0, nextVal) * 100) / 100 };
  if (rate > 0 && qty > 0) set.listCost = rate;
  await Product.updateOne({ _id: id, adminId }, { $set: set });
}

async function keepExistingStockOnPurchase(adminId, additions, purchaseCreatedAt, stockBefore) {
  const lines = (additions || [])
    .map((a) => ({ id: pid(a.productId), qty: Number(a.qty) || 0 }))
    .filter((a) => a.id && a.qty > 0);
  if (!adminId || !lines.length) return;

  const ids = [...new Set(lines.map((a) => a.id))];
  const added = {};
  lines.forEach((a) => { added[a.id] = (added[a.id] || 0) + a.qty; });

  const docs = await Product.find({ _id: { $in: ids }, adminId }).select("stockBaseline stockBaselineAt");
  const before = stockBefore || {};
  const alreadyFrozen = {};
  docs.forEach((p) => {
    const id = pid(p._id);
    alreadyFrozen[id] = hasStockBaseline({ baseline: p.stockBaseline, at: p.stockBaselineAt });
  });

  await reconcileProductStock(adminId, ids);

  const at = new Date(new Date(purchaseCreatedAt || Date.now()).getTime() - 1);
  let froze = false;
  for (const id of ids) {
    if (alreadyFrozen[id]) continue;
    const expected = Math.round(((before[id] || 0) + (added[id] || 0)) * 1000) / 1000;
    const now = await Product.findOne({ _id: id, adminId }).select("stock");
    const rebuilt = Number(now?.stock) || 0;
    if (Math.abs(rebuilt - expected) <= 0.001) continue;
    await Product.updateOne(
      { _id: id, adminId },
      { $set: { stockBaseline: before[id] || 0, stockBaselineAt: at } }
    );
    froze = true;
  }
  if (froze) await reconcileProductStock(adminId, ids);
}

async function reconcileProductStock(adminId, productIds = []) {
  // Relink orphan / foreign product ids before computing stock.
  await repairPurchaseProductLinks(adminId);

  const wanted = (productIds || []).map(pid).filter(Boolean);
  const byId = await computeStockByProduct(adminId);
  const ids = wanted.length ? wanted : Object.keys(byId);
  let fixed = 0;
  for (const id of ids) {
    const next = byId[id] != null ? byId[id] : 0;
    const updated = await Product.findOneAndUpdate(
      { _id: id, adminId },
      { $set: { stock: next } },
      { new: true, runValidators: false }
    );
    if (updated) fixed += 1;
  }
  return { fixed, stocks: byId };
}

async function resolveOwnedProduct(adminId, productId, productName) {
  const id = pid(productId);
  if (id) {
    const byId = await Product.findOne({ _id: id, adminId }).select("_id name category unit");
    if (byId) return byId;
  }
  const name = String(productName || "").trim();
  if (!name) return null;
  return Product.findOne({
    adminId,
    name: new RegExp(`^${escapeRegExp(name)}$`, "i"),
  }).select("_id name category unit");
}

module.exports = {
  pid,
  purchaseLineQty,
  applyBaselineStock,
  shiftStockBaseline,
  computeStockByProduct,
  reconcileProductStock,
  keepExistingStockOnPurchase,
  applyStockValueDelta,
  repairPurchaseProductLinks,
  resolveOwnedProduct,
  escapeRegExp,
};
