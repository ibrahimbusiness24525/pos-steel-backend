const express = require("express");
const router = express.Router();
const Purchase = require("../models/Purchase");
const PurchaseReturn = require("../models/PurchaseReturn");
const Product = require("../models/Product");
const { protect } = require("../middleware/auth");
const { pid, purchaseLineQty, reconcileProductStock } = require("../utils/stockReconcile");

function purchaseSnapshot(doc) {
  if (!doc) return {};
  const o = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    invoice: o.invoice || o.invoiceNum || "",
    date: o.date || "",
    supplier: o.supplier || o.supplierName || "",
    productName: o.productName || "",
    qty: purchaseLineQty(o),
    rate: Number(o.rate) || Number(o.productPrice) || 0,
    total: Number(o.total) || 0,
    paidAmount: Number(o.paidAmount) || 0,
    remainingAmount: Number(o.remainingAmount) || 0,
    paymentMethod: o.paymentMethod || "",
  };
}

function purchaseEditSummary(before, after) {
  const bits = [];
  if (String(before.supplier || "") !== String(after.supplier || "")) bits.push("supplier");
  if (String(before.date || "") !== String(after.date || "")) bits.push("date");
  if (String(before.productName || "") !== String(after.productName || "")) bits.push("product");
  if (Math.abs((Number(before.qty) || 0) - (Number(after.qty) || 0)) > 0.009) bits.push("qty");
  if (Math.abs((Number(before.rate) || 0) - (Number(after.rate) || 0)) > 0.009) bits.push("rate");
  if (Math.abs((Number(before.total) || 0) - (Number(after.total) || 0)) > 0.009) bits.push("total");
  if (String(before.paymentMethod || "") !== String(after.paymentMethod || "")) bits.push("payment");
  return bits.length ? bits.join(", ") : "updated";
}

async function adjustStock(adminId, productId, delta) {
  const id = pid(productId);
  const n = Number(delta) || 0;
  if (!id || !n) return;
  await Product.findOneAndUpdate(
    { _id: id, adminId },
    { $inc: { stock: n } },
    { runValidators: false }
  );
}

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
const addStock = async (adminId, productId, qty, category, productPrice, rows, unit) => {
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
      // Hardware keeps `price` as sale price — only update cost.
      if (String(category || "").toLowerCase() === "hardware") {
        updateFields.$set = { purchasePrice: newPrice };
      } else {
        updateFields.$set = { price: newPrice, purchasePrice: newPrice };
      }
    }
    
    // Update unit for Hardware/Custom if provided
    if ((category === "Hardware" || category === "Custom") && unit) {
      updateFields.$set = updateFields.$set || {};
      updateFields.$set.unit = unit;
      updateFields.$set.stockUnit = unit;
    }
  } else if (rows && rows.length > 0) {
    const row = rows[0];
    if (row.purchasePercentage !== undefined && row.purchasePercentage !== null && row.purchasePercentage !== "") {
      const newPct = Number(row.purchasePercentage) || 0;
      updateFields.$set = { purchasePercentage: newPct };
    }
  }

  const updated = await Product.findOneAndUpdate(
    { _id: productId, adminId },
    updateFields,
    { new: true, runValidators: false }
  );
  if (!updated) {
    console.warn(`[PURCHASE] Stock NOT added for product ${productId} — product not found under adminId ${adminId}.`);
  }
};

router.post("/", protect, async (req, res) => {
  try {
    const data = { ...req.body, createdBy: req.user._id, adminId: req.adminId };
    const skipStock = !!data.skipStock;
    delete data.skipStock;
    if (!data.invoiceNum && !data.invoice) {
      const count = await Purchase.countDocuments({ adminId: req.adminId });
      data.invoiceNum = `PO-${String(count + 1).padStart(4, "0")}`;
    }
    if (data.invoice && !data.invoiceNum) data.invoiceNum = data.invoice;
    if (!data.invoice && data.invoiceNum) data.invoice = data.invoiceNum;

    const purchase = await Purchase.create(data);

    if (purchase.product) {
      await Product.findOneAndUpdate(
        { _id: purchase.product, adminId: req.adminId },
        {
          lastInvoice: purchase.invoice || purchase.invoiceNum || "",
          lastPurchaseDate: purchase.date || "",
          lastSupplier: purchase.supplier || purchase.supplierName || "",
        }
      );
    }

    if (!skipStock) {
      if (Array.isArray(data.entries)) {
        for (const entry of data.entries) {
          if (entry.product && entry.quantity) {
            await addStock(req.adminId, entry.product, entry.quantity, entry.category, entry.productPrice, entry.rows, data.unit);
          }
        }
      } else if (data.product && data.qty) {
        await addStock(req.adminId, data.product, data.qty, data.category, data.productPrice, data.rows, data.unit);
      }
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

    const beforeSnap = purchaseSnapshot(old);
    const { editHistory: _ignoreHistory, ...bodyWithoutHistory } = req.body || {};
    // Keep qty filled from rows when client sends 0/empty but rows have quantity.
    if (!(Number(bodyWithoutHistory.qty) > 0)) {
      const fromRows = purchaseLineQty({ ...old.toObject(), ...bodyWithoutHistory });
      if (fromRows > 0) bodyWithoutHistory.qty = fromRows;
    }

    const oldPid = pid(old.product);
    const newPid = pid(bodyWithoutHistory.product) || oldPid;
    const oldQty = purchaseLineQty(old);
    const newQty = purchaseLineQty({ ...old.toObject(), ...bodyWithoutHistory });
    const productChanged = oldPid && newPid && oldPid !== newPid;
    const qtyChanged = Math.abs(oldQty - newQty) > 0.0001;

    // Date/supplier/price-only edits must NOT touch stock (was doubling stock before).
    if (productChanged || qtyChanged) {
      if (oldPid && oldQty) await adjustStock(req.adminId, oldPid, -oldQty);
      if (newPid && newQty) await adjustStock(req.adminId, newPid, newQty);
    }

    const afterSnap = purchaseSnapshot({ ...old.toObject(), ...bodyWithoutHistory });
    const historyEntry = {
      at: new Date(),
      byUserId: req.user?._id,
      byName: req.user?.name || "",
      byEmail: req.user?.email || "",
      summary: purchaseEditSummary(beforeSnap, afterSnap),
      before: beforeSnap,
      after: afterSnap,
    };

    const purchase = await Purchase.findOneAndUpdate(
      { _id: req.params.id, adminId: req.adminId },
      {
        $set: bodyWithoutHistory,
        $push: { editHistory: historyEntry },
      },
      { new: true, runValidators: true }
    );
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    // Rebuild absolute stock from purchases/sales so old double-counts get corrected.
    const touch = [...new Set([oldPid, newPid, pid(purchase.product)].filter(Boolean))];
    if (touch.length) await reconcileProductStock(req.adminId, touch);

    res.json({ success: true, purchase });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/:id", protect, async (req, res) => {
  try {
    const purchase = await Purchase.findOne({ _id: req.params.id, adminId: req.adminId });
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    const allReturns = await PurchaseReturn.find({ adminId: req.adminId });
    const returns = allReturns.filter((r) =>
      (r.items || []).some((it) => String(it.purchase) === String(purchase._id))
    );
    let returnedQty = 0;
    returns.forEach((r) => {
      (r.items || []).forEach((it) => {
        if (String(it.purchase) === String(purchase._id)) returnedQty += Number(it.qty) || 0;
      });
    });

    const reverse = async (productId, qty) => {
      const net = (Number(qty) || 0) - returnedQty;
      if (!productId || net <= 0) return;
      await Product.findOneAndUpdate(
        { _id: productId, adminId: req.adminId },
        { $inc: { stock: -net } }
      );
    };

    if (Array.isArray(purchase.entries) && purchase.entries.length) {
      for (const entry of purchase.entries) {
        if (entry.product && entry.quantity) await reverse(entry.product, entry.quantity);
      }
    } else if (purchase.product && purchase.qty) {
      await reverse(purchase.product, purchase.qty);
    }

    for (const r of returns) {
      const leftover = (r.items || []).filter((it) => String(it.purchase) !== String(purchase._id));
      if (!leftover.length) await PurchaseReturn.deleteOne({ _id: r._id });
      else {
        await PurchaseReturn.findByIdAndUpdate(r._id, {
          items: leftover,
          total: leftover.reduce((s, it) => s + (Number(it.amount) || 0), 0),
        });
      }
    }

    await Purchase.deleteOne({ _id: purchase._id });
    res.json({ success: true, message: "Purchase deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;