const Activity = require("../models/Activity");

function snapQty(category, n) {
  if (n == null || n === "") return n;
  const x = Number(n);
  if (!Number.isFinite(x)) return n;
  const cat = String(category || "");
  if (cat === "Chader" || cat === "Net") return Math.round(x * 1000) / 1000;
  return Math.round(x);
}

function ymd(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dt = new Date(d);
  if (isNaN(dt)) return new Date().toISOString().slice(0, 10);
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${m}-${day}`;
}

async function logActivity(req, payload = {}) {
  try {
    if (!req?.adminId || !payload.type) return;
    await Activity.create({
      adminId: req.adminId,
      createdBy: req.user?._id,
      byName: req.user?.name || "",
      date: ymd(payload.date),
      type: payload.type,
      product: payload.product || undefined,
      productName: payload.productName || "",
      category: payload.category || "",
      qty: snapQty(payload.category, payload.qty) || 0,
      fromQty: payload.fromQty == null ? null : snapQty(payload.category, payload.fromQty),
      toQty: payload.toQty == null ? null : snapQty(payload.category, payload.toQty),
      invoice: payload.invoice || "",
      party: payload.party || "",
      summary: payload.summary || "",
    });
  } catch (err) {
    console.warn("[activity]", err.message);
  }
}

module.exports = { logActivity, ymd };
