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

  const [products, purchases, purchaseReturns, sales, saleReturns] = await Promise.all([
    Product.find({ adminId }).select("_id name").lean(),
    Purchase.find({ adminId }).select("product productName qty rows entries").lean(),
    PurchaseReturn.find({ adminId }).select("items").lean(),
    Sale.find({ adminId }).select("product productName qty saleItems items").lean(),
    SaleReturn.find({ adminId }).select("items").lean(),
  ]);

  const resolveId = makeResolveId(products);

  purchases.forEach((p) => {
    if (Array.isArray(p.entries) && p.entries.length) {
      p.entries.forEach((e) => {
        addMap(
          purchased,
          resolveId(e.product || e.productId, e.productName || e.name || p.productName),
          e.quantity || e.qty
        );
      });
    } else {
      addMap(purchased, resolveId(p.product, p.productName), purchaseLineQty(p));
    }
  });

  purchaseReturns.forEach((r) => {
    (r.items || []).forEach((it) => {
      addMap(purchRet, resolveId(it.product || it.productId, it.productName || it.name), it.qty);
    });
  });

  sales.forEach((s) => {
    const saleItems = Array.isArray(s.saleItems) ? s.saleItems : [];
    const items = Array.isArray(s.items) ? s.items : [];
    // A line that already has its own product id must not inherit the bill's first
    // product name. Otherwise other items on that bill get subtracted from RAD.
    const nameFor = (ownName, lineCount) => {
      const own = String(ownName || "").trim();
      if (own) return own;
      return lineCount === 1 ? s.productName : "";
    };
    if (saleItems.length) {
      saleItems.forEach((si) => {
        addMap(
          sold,
          resolveId(si.productId || si.product, nameFor(si.productName, saleItems.length)),
          si.qty
        );
      });
    } else if (items.length) {
      items.forEach((it) => {
        const q = Number(it.qty) || Number(it.rows?.[0]?.qty) || 0;
        addMap(
          sold,
          resolveId(it.productId || it.product, nameFor(it.productName, items.length)),
          q
        );
      });
    } else {
      addMap(sold, resolveId(s.product, s.productName), s.qty);
    }
  });

  saleReturns.forEach((r) => {
    (r.items || []).forEach((it) => {
      addMap(saleRet, resolveId(it.product || it.productId, it.productName || it.name), it.qty);
    });
  });

  const ids = new Set([
    ...Object.keys(purchased),
    ...Object.keys(purchRet),
    ...Object.keys(sold),
    ...Object.keys(saleRet),
  ]);

  const result = {};
  ids.forEach((id) => {
    const stock = (purchased[id] || 0) - (purchRet[id] || 0) - (sold[id] || 0) + (saleRet[id] || 0);
    result[id] = Math.max(0, Math.round(stock * 1000) / 1000);
  });
  return result;
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
  computeStockByProduct,
  reconcileProductStock,
  repairPurchaseProductLinks,
  resolveOwnedProduct,
  escapeRegExp,
};
