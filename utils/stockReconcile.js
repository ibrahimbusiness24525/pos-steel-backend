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

  const [purchases, purchaseReturns, sales, saleReturns] = await Promise.all([
    Purchase.find({ adminId }).select("product qty rows entries").lean(),
    PurchaseReturn.find({ adminId }).select("items").lean(),
    Sale.find({ adminId }).select("product qty saleItems items").lean(),
    SaleReturn.find({ adminId }).select("items").lean(),
  ]);

  purchases.forEach((p) => {
    if (Array.isArray(p.entries) && p.entries.length) {
      p.entries.forEach((e) => addMap(purchased, e.product || e.productId, e.quantity || e.qty));
    } else {
      addMap(purchased, p.product, purchaseLineQty(p));
    }
  });

  purchaseReturns.forEach((r) => {
    (r.items || []).forEach((it) => addMap(purchRet, it.product || it.productId, it.qty));
  });

  sales.forEach((s) => {
    if (Array.isArray(s.saleItems) && s.saleItems.length) {
      s.saleItems.forEach((si) => addMap(sold, si.productId || si.product, si.qty));
    } else if (Array.isArray(s.items) && s.items.length) {
      s.items.forEach((it) => addMap(sold, it.productId || it.product, it.qty));
    } else {
      addMap(sold, s.product, s.qty);
    }
  });

  saleReturns.forEach((r) => {
    (r.items || []).forEach((it) => addMap(saleRet, it.product || it.productId, it.qty));
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
