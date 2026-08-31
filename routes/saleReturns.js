const express = require("express");
const router = express.Router();
const Sale = require("../models/Sale");
const SaleReturn = require("../models/SaleReturn");
const Product = require("../models/Product");
const { protect } = require("../middleware/auth");

router.use(protect);

function pid(v) {
  if (!v) return "";
  if (typeof v === "object") return String(v._id || v.id || "");
  return String(v);
}

function saleSoldMap(sale) {
  const map = {};
  if (Array.isArray(sale.saleItems) && sale.saleItems.length > 0) {
    sale.saleItems.forEach((si) => {
      const id = pid(si.productId || si.product);
      const qty = Number(si.qty) || 0;
      if (id && qty) map[id] = (map[id] || 0) + qty;
    });
  } else if (sale.product && sale.qty) {
    const id = pid(sale.product);
    if (id) map[id] = (map[id] || 0) + (Number(sale.qty) || 0);
  }
  return map;
}

function itemMeta(sale, productId, productsById) {
  const items = Array.isArray(sale.items) ? sale.items : [];
  const match =
    items.find((it) => pid(it.productId || it.product) === productId) ||
    items.find((it) => productsById[productId] && it.productName === productsById[productId].name);
  const prod = productsById[productId];
  const qty = Number(
    (Array.isArray(sale.saleItems) && sale.saleItems.find((si) => pid(si.productId || si.product) === productId)?.qty) ||
      (pid(sale.product) === productId ? sale.qty : 0)
  ) || 0;
  const amount = Number(match?.subtotal) || (pid(sale.product) === productId ? Number(sale.total) || 0 : 0);
  const rate = qty > 0 ? amount / qty : Number(sale.rate) || Number(prod?.price) || 0;
  return {
    productName: match?.productName || prod?.name || sale.productName || "Item",
    category: match?.category || prod?.category || sale.category || "",
    rate,
  };
}

router.get("/", async (req, res) => {
  try {
    const returns = await SaleReturn.find({ adminId: req.adminId }).sort({ createdAt: -1 });
    res.json({ success: true, returns });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { saleId, date, notes, items } = req.body;
    const sale = await Sale.findOne({ _id: saleId, adminId: req.adminId });
    if (!sale) return res.status(404).json({ success: false, message: "Sale not found" });

    const requested = Array.isArray(items) ? items : [];
    const lines = requested
      .map((it) => ({ productId: pid(it.productId || it.product), qty: Number(it.qty) || 0 }))
      .filter((it) => it.productId && it.qty > 0);
    if (!lines.length) {
      return res.status(400).json({ success: false, message: "Return quantity is required" });
    }

    const sold = saleSoldMap(sale);
    const prev = await SaleReturn.find({ adminId: req.adminId, sale: sale._id });
    const already = {};
    prev.forEach((r) => {
      (r.items || []).forEach((it) => {
        const id = pid(it.product);
        already[id] = (already[id] || 0) + (Number(it.qty) || 0);
      });
    });

    const productIds = [...new Set(lines.map((l) => l.productId))];
    const products = await Product.find({ _id: { $in: productIds }, adminId: req.adminId });
    const productsById = {};
    products.forEach((p) => { productsById[String(p._id)] = p; });

    const savedItems = [];
    for (const line of lines) {
      const soldQty = sold[line.productId] || 0;
      if (!soldQty) {
        return res.status(400).json({ success: false, message: "This product was not on the selected sale" });
      }
      const remain = soldQty - (already[line.productId] || 0);
      if (line.qty > remain + 1e-9) {
        return res.status(400).json({
          success: false,
          message: `Return qty ${line.qty} is more than remaining ${remain}`,
        });
      }
      const meta = itemMeta(sale, line.productId, productsById);
      savedItems.push({
        product: line.productId,
        productName: meta.productName,
        category: meta.category,
        qty: line.qty,
        rate: meta.rate,
        amount: +(meta.rate * line.qty).toFixed(2),
      });
    }

    const count = await SaleReturn.countDocuments({ adminId: req.adminId });
    const doc = await SaleReturn.create({
      adminId: req.adminId,
      sale: sale._id,
      invoice: sale.invoice || sale.invoiceNum || "",
      returnInvoice: `SR-${String(count + 1).padStart(4, "0")}`,
      customer: sale.customer || "",
      date: date || new Date().toISOString().slice(0, 10),
      items: savedItems,
      total: savedItems.reduce((s, it) => s + (Number(it.amount) || 0), 0),
      notes: notes || "",
      createdBy: req.user._id,
    });

    for (const it of savedItems) {
      await Product.findOneAndUpdate(
        { _id: it.product, adminId: req.adminId },
        { $inc: { stock: Number(it.qty) } }
      );
    }

    res.status(201).json({ success: true, return: doc });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const doc = await SaleReturn.findOne({ _id: req.params.id, adminId: req.adminId });
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    for (const it of doc.items || []) {
      const amount = Number(it.qty) || 0;
      const productId = pid(it.product);
      if (!productId || !amount) continue;
      const updated = await Product.findOneAndUpdate(
        { _id: productId, adminId: req.adminId, stock: { $gte: amount } },
        { $inc: { stock: -amount } },
        { new: true }
      );
      if (!updated) {
        return res.status(400).json({
          success: false,
          message: `"${it.productName || "Item"}" stock is not enough to undo this return`,
        });
      }
    }

    await SaleReturn.deleteOne({ _id: doc._id });
    res.json({ success: true, message: "Deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
