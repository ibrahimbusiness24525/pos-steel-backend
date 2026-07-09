const express = require("express");
const router = express.Router();
const Purchase = require("../models/Purchase");
const Product = require("../models/Product");
const { protect } = require("../middleware/auth");

// GET all purchases — only this admin's purchases
router.get("/", protect, async (req, res) => {
  try {
    const filter = req.adminId ? { adminId: req.adminId } : {};
    const purchases = await Purchase.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, purchases });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Shared: update product stock AND price (price sync only for non-Pipe categories;
// Pipe price is set directly on the product, never from a purchase).
// Pipe purchasePercentage: use the % entered on THIS purchase directly (overwrite).
// The stock-weighted blending that used to run here diluted the % with whatever was
// already on the product (including the default 0% left over from product creation,
// which was never a real purchase). That made the cost price used on the Dashboard
// (Net Profit) drift away from the price actually shown on the Purchase screen —
// e.g. Purchase screen computes 80 (price × (1 + %)), but Dashboard cost showed 84
// because it was blended with an old, non-purchase 0%. Overwriting keeps the two in
// sync, exactly like Chader/Net/Hardware/Custom already do for their purchase price.
const addStock = async (adminId, productId, qty, category, productPrice, rows) => {
  const updateFields = { $inc: { stock: Number(qty) } };

  if (category !== "Pipe") {
    // PRIMARY: use productPrice sent from frontend
    let newPrice = Number(productPrice) || 0;

    // FALLBACK: extract from rows directly if productPrice is 0
    if (!newPrice && rows && rows.length > 0) {
      const row = rows[0];
      if (category === "Chader")
        newPrice = Number(row.purchasePrice) || 0;
      else if (category === "Net")
        newPrice = Number(row.purchasePricePerFeet) || 0;
      else if (category === "Hardware" || category === "Custom")
        newPrice = Number(row.purchasePrice) || 0;
    }

    if (newPrice > 0) {
      updateFields.$set = { price: newPrice, purchasePrice: newPrice };
    }
  } else if (rows && rows.length > 0) {
    const row = rows[0];
    console.log("[ADD STOCK - PIPE] row.purchasePercentage:", row.purchasePercentage, "typeof:", typeof row.purchasePercentage);
    if (row.purchasePercentage !== undefined && row.purchasePercentage !== null && row.purchasePercentage !== "") {
      const newPct = Number(row.purchasePercentage) || 0;

      console.log("[ADD STOCK - PIPE] purchasePercentage set directly to:", newPct);
      updateFields.$set = { purchasePercentage: newPct };
    }
  } else {
    console.log("[ADD STOCK - PIPE] no rows received for productId:", productId);
  }

  console.log("[ADD STOCK] final updateFields:", JSON.stringify(updateFields));

  const updated = await Product.findOneAndUpdate(
    { _id: productId, adminId },
    updateFields,
    { new: true }
  );
  console.log("[ADD STOCK] product after update — purchasePercentage:", updated?.purchasePercentage, "| price:", updated?.price, "| stock:", updated?.stock);
};

router.post("/", protect, async (req, res) => {
  try {
    const data = { ...req.body, createdBy: req.user._id, adminId: req.adminId };
    if (!data.invoiceNum && !data.invoice) {
      const count = await Purchase.countDocuments({ adminId: req.adminId });
      data.invoiceNum = `PO-${String(count + 1).padStart(4, "0")}`;
    }
    if (data.invoice && !data.invoiceNum) data.invoiceNum = data.invoice;

    const purchase = await Purchase.create(data);

    console.log("[PURCHASE SAVE] category:", data.category, "| product:", data.product, "| qty:", data.qty, "| rows:", JSON.stringify(data.rows));

    if (Array.isArray(data.entries)) {
      for (const entry of data.entries) {
        if (entry.product && entry.quantity) {
          await addStock(req.adminId, entry.product, entry.quantity, entry.category, entry.productPrice, entry.rows);
        }
      }
    } else if (data.product && data.qty) {
      await addStock(req.adminId, data.product, data.qty, data.category, data.productPrice, data.rows);
    } else {
      console.log("[PURCHASE SAVE] addStock SKIPPED — missing product or qty. product:", data.product, "qty:", data.qty);
    }

    res.status(201).json({ success: true, purchase });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put("/:id", protect, async (req, res) => {
  try {
    const old = await Purchase.findOne({ _id: req.params.id, adminId: req.adminId });
    if (!old) return res.status(404).json({ success: false, message: "Purchase not found" });

    // Reverse old stock
    if (Array.isArray(old.entries)) {
      for (const entry of old.entries) {
        if (entry.product && entry.quantity) {
          await Product.findOneAndUpdate(
            { _id: entry.product, adminId: req.adminId },
            { $inc: { stock: -Number(entry.quantity) } }
          );
        }
      }
    } else if (old.product && old.qty) {
      await Product.findOneAndUpdate(
        { _id: old.product, adminId: req.adminId },
        { $inc: { stock: -Number(old.qty) } }
      );
    }

    const purchase = await Purchase.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });

    // Apply new stock
    if (Array.isArray(req.body.entries)) {
      for (const entry of req.body.entries) {
        if (entry.product && entry.quantity) {
          await Product.findOneAndUpdate(
            { _id: entry.product, adminId: req.adminId },
            { $inc: { stock: Number(entry.quantity) } }
          );
        }
      }
    } else if (req.body.product && req.body.qty) {
      await Product.findOneAndUpdate(
        { _id: req.body.product, adminId: req.adminId },
        { $inc: { stock: Number(req.body.qty) } }
      );
    }

    res.json({ success: true, purchase });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/:id", protect, async (req, res) => {
  try {
    const purchase = await Purchase.findOneAndDelete({ _id: req.params.id, adminId: req.adminId });
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    // Reverse stock
    if (Array.isArray(purchase.entries)) {
      for (const entry of purchase.entries) {
        if (entry.product && entry.quantity) {
          await Product.findOneAndUpdate(
            { _id: entry.product, adminId: req.adminId },
            { $inc: { stock: -Number(entry.quantity) } }
          );
        }
      }
    } else if (purchase.product && purchase.qty) {
      await Product.findOneAndUpdate(
        { _id: purchase.product, adminId: req.adminId },
        { $inc: { stock: -Number(purchase.qty) } }
      );
    }

    res.json({ success: true, message: "Purchase deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;