const express = require("express");
const router = express.Router();
const Sale = require("../models/Sale");
const Product = require("../models/Product");
const { protect } = require("../middleware/auth");

// GET all sales
router.get("/", protect, async (req, res) => {
  try {
    const filter = req.adminId ? { adminId: req.adminId } : {};
    const sales = await Sale.find(filter)
      .populate("createdBy", "name email role")
      .sort({ createdAt: -1 });
    res.json({ success: true, sales });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST — sale save karo, pehle stock check karo
router.post("/", protect, async (req, res) => {
  try {
    const data = { ...req.body, createdBy: req.user._id, adminId: req.adminId };

    if (!data.invoiceNum && !data.invoice) {
      const count = await Sale.countDocuments({ adminId: req.adminId });
      data.invoiceNum = `INV-${String(count + 1).padStart(4, "0")}`;
    }
    if (data.invoice && !data.invoiceNum) data.invoiceNum = data.invoice;

    // ── STOCK VALIDATION — sale se pehle check ──────────────────────────────
    // Har product ki required qty nikalo
    const stockRequired = {}; // productId → qty needed

    const addRequired = (productId, qty) => {
      if (!productId || !qty) return;
      const id = productId.toString();
      stockRequired[id] = (stockRequired[id] || 0) + Number(qty);
    };

    if (Array.isArray(data.rows) && data.rows.length > 0) {
      // Billing sale — rows mein productId nahi hota, product field se
      if (data.product) addRequired(data.product, data.qty);
    } else if (Array.isArray(data.items) && data.items.length > 0) {
      // Billing multi-product — items array
      // items mein productId nahi hota — product field se qty
      if (data.product) addRequired(data.product, data.qty);
    } else if (data.product && data.qty) {
      // Simple sale
      addRequired(data.product, data.qty);
    }

    // Stock check karo — sab products ke liye
    for (const [productId, qtyNeeded] of Object.entries(stockRequired)) {
      const prod = await Product.findOne({ _id: productId, adminId: req.adminId });
      if (!prod) continue; // product nahi mila — skip
      const available = Number(prod.stock) || 0;
      if (qtyNeeded > available) {
        return res.status(400).json({
          success: false,
          message: `"${prod.name}" ka stock sirf ${available} hai — aap ${qtyNeeded} sell karne ki koshish kar rahe hain. Pehle purchase karein.`,
          stockError: true,
          productName: prod.name,
          available,
          requested: qtyNeeded,
        });
      }
    }

    // ── SAVE SALE ────────────────────────────────────────────────────────────
    const sale = await Sale.create(data);

    // ── DEDUCT STOCK ─────────────────────────────────────────────────────────
    const deductStock = async (productId, qty) => {
      await Product.findOneAndUpdate(
        { _id: productId, adminId: req.adminId },
        { $inc: { stock: -Number(qty) } }
      );
    };

    if (data.product && data.qty) {
      await deductStock(data.product, data.qty);
    }

    res.status(201).json({ success: true, sale });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put("/:id", protect, async (req, res) => {
  try {
    const sale = await Sale.findOneAndUpdate(
      { _id: req.params.id, adminId: req.adminId },
      req.body,
      { new: true, runValidators: false }
    );
    if (!sale) return res.status(404).json({ success: false, message: "Sale not found" });
    res.json({ success: true, sale });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/:id", protect, async (req, res) => {
  try {
    const sale = await Sale.findOneAndDelete({ _id: req.params.id, adminId: req.adminId });
    if (!sale) return res.status(404).json({ success: false, message: "Sale not found" });

    // Stock wapas karo jab sale delete ho
    if (sale.product && sale.qty) {
      await Product.findOneAndUpdate(
        { _id: sale.product, adminId: req.adminId },
        { $inc: { stock: Number(sale.qty) } }
      );
    }

    res.json({ success: true, message: "Sale deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
