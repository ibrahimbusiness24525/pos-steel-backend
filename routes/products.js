const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const Purchase = require("../models/Purchase");
const { protect } = require("../middleware/auth");

const normalizeProduct = (body) => {
  const d = { ...body };
  return d;
};

function mainSupplierName(data) {
  const list = Array.isArray(data?.suppliers) ? data.suppliers : [];
  const main = list.find((s) => s && s.isMain) || list[0];
  return (main && main.name) || "";
}

async function createOpeningPurchase(req, product, qty) {
  const amount = Number(qty) || 0;
  if (!product || amount <= 0) return null;
  const count = await Purchase.countDocuments({ adminId: req.adminId });
  const invoice = `PO-${String(count + 1).padStart(4, "0")}`;
  const rate = Number(product.purchasePrice) || Number(product.price) || 0;
  const supplier = mainSupplierName(product) || "Opening Stock";
  return Purchase.create({
    adminId: req.adminId,
    createdBy: req.user._id,
    invoice,
    invoiceNum: invoice,
    date: new Date().toISOString().slice(0, 10),
    supplier,
    product: product._id,
    productName: product.name || "",
    category: product.category || "",
    qty: amount,
    rate,
    total: +(rate * amount).toFixed(2),
    productPrice: rate,
    rows: [{ qty: amount, purchasePrice: rate, salePrice: Number(product.price) || 0 }],
    notes: "Product create",
    skipStock: true,
  });
}

// GET all products — only this admin's products
router.get("/", protect, async (req, res) => {
  try {
    const filter = req.adminId ? { adminId: req.adminId } : {};
    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST — create product under this adminId
router.post("/", protect, async (req, res) => {
  try {
    const data = { ...normalizeProduct(req.body), adminId: req.adminId };
    const product = await Product.create(data);
    if ((Number(product.stock) || 0) > 0) {
      await createOpeningPurchase(req, product, product.stock);
    }
    res.status(201).json({ success: true, product });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT — update product (only if belongs to this admin)
// BUG FIX: pehle yeh route jo bhi "stock" value frontend se aati thi wahi seedha
// save kar deta tha. Products page ka edit-form apna purana (stale) stock number
// wapas bhej deta tha (kyunki UI mein stock ka koi editable field hi nahi hai) —
// isliye product edit karte waqt (jaise price/name change karte waqt) stock
// purane number par reset ho jata tha, chahe sale/purchase se stock already
// update ho chuka ho. Ab "stock" field ko generic edit se hata diya hai; stock
// sirf sale, purchase, ya /:id/stock endpoint se hi change hoga.
router.put("/:id", protect, async (req, res) => {
  try {
    const filter = { _id: req.params.id, adminId: req.adminId };
    const updateData = normalizeProduct(req.body);
    delete updateData.stock; // stock is never touched by a generic product edit
    const product = await Product.findOneAndUpdate(
      filter,
      updateData,
      { new: true, runValidators: false }
    );
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, product });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE — delete product (only if belongs to this admin)
router.delete("/:id", protect, async (req, res) => {
  try {
    const product = await Product.findOneAndDelete({ _id: req.params.id, adminId: req.adminId });
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH stock adjust (only if belongs to this admin)
router.patch("/:id/stock", protect, async (req, res) => {
  try {
    const { type, qty } = req.body;
    const product = await Product.findOne({ _id: req.params.id, adminId: req.adminId });
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    const amount = Number(qty) || 0;
    if (type === "add") product.stock += amount;
    else if (type === "remove") product.stock = Math.max(0, product.stock - amount);
    else return res.status(400).json({ success: false, message: "type must be 'add' or 'remove'" });
    await product.save();
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
