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
    return p.entries.reduce((s, e) => s + (Number(e.quantity) || Number(e.qty) || 0), 0);
  }
  return (p?.rows || []).reduce(
    (s, r) => s + (Number(r.qty) || Number(r.quantity) || Number(r.weight) || Number(r.feet) || 0),
    0
  );
}

function addMap(map, id, qty) {
  const key = pid(id);
  const n = Number(qty) || 0;
  if (!key || n === 0) return;
  map[key] = (map[key] || 0) + n;
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

  const nameToId = new Map();
  (products || []).forEach((p) => {
    const id = pid(p._id);
    const name = String(p.name || "").trim().toLowerCase();
    if (id && name && !nameToId.has(name)) nameToId.set(name, id);
  });
  const resolveId = (rawId, rawName) => {
    const id = pid(rawId);
    if (id) return id;
    const name = String(rawName || "").trim().toLowerCase();
    return name ? (nameToId.get(name) || "") : "";
  };

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
    if (Array.isArray(s.saleItems) && s.saleItems.length) {
      s.saleItems.forEach((si) => {
        addMap(sold, resolveId(si.productId || si.product, si.productName || s.productName), si.qty);
      });
    } else if (Array.isArray(s.items) && s.items.length) {
      s.items.forEach((it) => {
        const q = Number(it.qty) || Number(it.rows?.[0]?.qty) || 0;
        addMap(sold, resolveId(it.productId || it.product, it.productName || s.productName), q);
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

module.exports = {
  pid,
  purchaseLineQty,
  computeStockByProduct,
  reconcileProductStock,
};
