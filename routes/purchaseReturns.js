const express = require("express");
const router = express.Router();
const Purchase = require("../models/Purchase");
const PurchaseReturn = require("../models/PurchaseReturn");
const Product = require("../models/Product");
const { protect } = require("../middleware/auth");

router.use(protect);

function pid(v) {
  if (!v) return "";
  if (typeof v === "object") return String(v._id || v.id || "");
  return String(v);
}

function purchaseQty(p) {
  if (Array.isArray(p.entries) && p.entries.length) {
    return p.entries.reduce((s, e) => s + (Number(e.quantity || e.qty) || 0), 0);
  }
  return Number(p.qty) || 0;
}

router.get("/", async (req, res) => {
  try {
    const returns = await PurchaseReturn.find({ adminId: req.adminId }).sort({ createdAt: -1 });
    res.json({ success: true, returns });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

function mainSupplierName(prod) {
  const list = Array.isArray(prod?.suppliers) ? prod.suppliers : [];
  const main = list.find((s) => s && s.isMain) || list[0];
  return (main && main.name) || "";
}

router.post("/", async (req, res) => {
  try {
    const { date, notes, items, supplier } = req.body;
    const requested = Array.isArray(items) ? items : [];
    const lines = requested
      .map((it) => ({
        purchaseId: pid(it.purchaseId || it.purchase),
        productId: pid(it.productId || it.product),
        qty: Number(it.qty) || 0,
        rate: it.rate != null && it.rate !== "" ? Number(it.rate) : null,
      }))
      .filter((it) => it.qty > 0 && (it.purchaseId || it.productId));
    if (!lines.length) {
      return res.status(400).json({ success: false, message: "Return quantity is required" });
    }

    const purchaseIds = [...new Set(lines.map((l) => l.purchaseId).filter(Boolean))];
    const purchases = purchaseIds.length
      ? await Purchase.find({ _id: { $in: purchaseIds }, adminId: req.adminId })
      : [];
    if (purchases.length !== purchaseIds.length) {
      return res.status(404).json({ success: false, message: "Purchase not found" });
    }
    const purchaseById = {};
    purchases.forEach((p) => { purchaseById[String(p._id)] = p; });

    const prev = await PurchaseReturn.find({ adminId: req.adminId });
    const already = {};
    prev.forEach((r) => {
      (r.items || []).forEach((it) => {
        const id = pid(it.purchase);
        if (!id) return;
        already[id] = (already[id] || 0) + (Number(it.qty) || 0);
      });
    });

    const savedItems = [];
    let invoiceLabel = "";
    let supplierName = (supplier || "").trim();

    for (const line of lines) {
      if (line.purchaseId) {
        const purchase = purchaseById[line.purchaseId];
        const bought = purchaseQty(purchase);
        const remain = bought - (already[line.purchaseId] || 0);
        if (line.qty > remain + 1e-9) {
          return res.status(400).json({
            success: false,
            message: `Return qty ${line.qty} is more than remaining ${remain}`,
          });
        }
        const productId = pid(purchase.product);
        if (!productId) {
          return res.status(400).json({ success: false, message: "Purchase has no product" });
        }
        const prod = await Product.findOne({ _id: productId, adminId: req.adminId });
        const available = Number(prod?.stock) || 0;
        if (line.qty > available + 1e-9) {
          return res.status(400).json({
            success: false,
            message: `"${prod?.name || purchase.productName}" stock is only ${available} — cannot return ${line.qty} to supplier`,
            stockError: true,
          });
        }
        const rate = line.rate != null && Number.isFinite(line.rate)
          ? line.rate
          : (bought > 0 ? (Number(purchase.total) || 0) / bought : Number(purchase.rate) || 0);
        if (!invoiceLabel) invoiceLabel = purchase.invoice || purchase.invoiceNum || "";
        if (!supplierName) supplierName = purchase.supplier || purchase.supplierName || "";
        savedItems.push({
          purchase: purchase._id,
          product: productId,
          productName: purchase.productName || prod?.name || "Item",
          category: purchase.category || prod?.category || "",
          qty: line.qty,
          rate,
          amount: +(rate * line.qty).toFixed(2),
        });
      } else {
        const prod = await Product.findOne({ _id: line.productId, adminId: req.adminId });
        if (!prod) return res.status(404).json({ success: false, message: "Product not found" });
        const available = Number(prod.stock) || 0;
        if (line.qty > available + 1e-9) {
          return res.status(400).json({
            success: false,
            message: `"${prod.name}" stock is only ${available} — cannot return ${line.qty} to supplier`,
            stockError: true,
          });
        }
        const rate = line.rate != null && Number.isFinite(line.rate)
          ? line.rate
          : (Number(prod.purchasePrice) || Number(prod.price) || 0);
        if (!supplierName) supplierName = mainSupplierName(prod);
        if (!invoiceLabel) invoiceLabel = "STOCK";
        savedItems.push({
          purchase: null,
          product: prod._id,
          productName: prod.name || "Item",
          category: prod.category || "",
          qty: line.qty,
          rate,
          amount: +(rate * line.qty).toFixed(2),
        });
      }
    }

    const count = await PurchaseReturn.countDocuments({ adminId: req.adminId });
    const doc = await PurchaseReturn.create({
      adminId: req.adminId,
      invoice: invoiceLabel,
      returnInvoice: `PR-${String(count + 1).padStart(4, "0")}`,
      supplier: supplierName,
      date: date || new Date().toISOString().slice(0, 10),
      items: savedItems,
      total: savedItems.reduce((s, it) => s + (Number(it.amount) || 0), 0),
      notes: notes || "",
      createdBy: req.user._id,
    });

    for (const it of savedItems) {
      const amount = Number(it.qty) || 0;
      const updated = await Product.findOneAndUpdate(
        { _id: it.product, adminId: req.adminId, stock: { $gte: amount } },
        { $inc: { stock: -amount } },
        { new: true, runValidators: false }
      );
      if (!updated) {
        await PurchaseReturn.deleteOne({ _id: doc._id });
        return res.status(400).json({
          success: false,
          message: `"${it.productName}" stock changed — return cancelled`,
        });
      }
    }

    res.status(201).json({ success: true, return: doc });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const doc = await PurchaseReturn.findOne({ _id: req.params.id, adminId: req.adminId });
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    for (const it of doc.items || []) {
      const amount = Number(it.qty) || 0;
      const productId = pid(it.product);
      if (!productId || !amount) continue;
      await Product.findOneAndUpdate(
        { _id: productId, adminId: req.adminId },
        { $inc: { stock: amount } }
      );
    }

    await PurchaseReturn.deleteOne({ _id: doc._id });
    res.json({ success: true, message: "Deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
