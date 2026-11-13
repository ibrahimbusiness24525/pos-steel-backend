const express = require("express");
const router = express.Router();
const Purchase = require("../models/Purchase");
const PurchaseReturn = require("../models/PurchaseReturn");
const Product = require("../models/Product");
const { protect } = require("../middleware/auth");
const { pid, purchaseLineQty, reconcileProductStock, resolveOwnedProduct, shiftStockBaseline, keepExistingStockOnPurchase, applyStockValueDelta, purchaseLineRemaining } = require("../utils/stockReconcile");
const { logActivity } = require("../utils/activityLog");

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

function snapPcs(category, qty) {
  const n = Math.max(0, Number(qty) || 0);
  const cat = String(category || "");
  if (cat === "Pipe" || cat === "Hardware" || cat === "Custom") return Math.round(n);
  return Math.round(n * 1000) / 1000;
}

/** Undo a stock-edit STK bill: put pieces back to the count from before that edit. */
async function reverseStockEditPurchase(adminId, purchase) {
  const id = pid(purchase.product);
  if (!adminId || !id) return null;
  const prod = await Product.findOne({ _id: id, adminId }).select("stock category costValue");
  if (!prod) return null;
  const stock = Number(prod.stock) || 0;
  const fromQty = purchase.fromQty == null ? null : Number(purchase.fromQty);
  const delta = Number(purchase.delta);
  let next;
  if (fromQty != null && Number.isFinite(fromQty)) next = fromQty;
  else if (Number.isFinite(delta) && Math.abs(delta) > 0.0001) next = stock - delta;
  else next = stock - (purchaseLineQty(purchase) || 0);
  next = snapPcs(prod.category, next);
  const nextVal = stock > 0.0001 ? (Number(prod.costValue) || 0) * (next / stock) : 0;
  const now = new Date();
  await Product.updateOne(
    { _id: id, adminId },
    {
      $set: {
        stock: next,
        stockBaseline: next,
        stockBaselineAt: now,
        costValue: Math.round(Math.max(0, nextVal) * 100) / 100,
      },
    }
  );
  return { from: stock, to: next };
}

function billDateFilter(from, to) {
  const start = String(from || "").slice(0, 10);
  const end = String(to || "").slice(0, 10);
  if (!start && !end) return null;
  const a = start || end;
  const b = end || start;
  return { date: { $gte: a, $lte: b } };
}

// GET purchases. Pass ?from=&to= for a day or range.
router.get("/", protect, async (req, res) => {
  try {
    const filter = req.adminId ? { adminId: req.adminId } : {};
    const ranged = billDateFilter(req.query.from, req.query.to);
    const cap = Math.min(Math.max(parseInt(req.query.limit, 10) || (ranged ? 2000 : 800), 1), 2000);
    const purchases = await Purchase.find(ranged ? { ...filter, ...ranged } : filter)
      .select("-editHistory")
      .sort({ createdAt: -1 })
      .limit(cap)
      .maxTimeMS(8000)
      .lean();
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
    throw new Error(
      `Stock update failed — product not found in this shop (id: ${productId}). Purchase was not saved.`
    );
  }
  return updated;
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

    // Must resolve to a product owned by this admin — never save a PO that cannot update stock.
    const owned = await resolveOwnedProduct(req.adminId, data.product, data.productName);
    if (!owned) {
      return res.status(400).json({
        success: false,
        message: `Product "${data.productName || data.product || ""}" not found in this shop. Add the product first, then save purchase.`,
      });
    }
    data.product = owned._id;
    if (!data.productName) data.productName = owned.name;
    if (!data.category && owned.category) data.category = owned.category;

    if (!(Number(data.qty) > 0)) {
      const fromRows = purchaseLineQty(data);
      if (fromRows > 0) data.qty = fromRows;
    }
    if (!(Number(data.qty) > 0) && !skipStock) {
      return res.status(400).json({
        success: false,
        message: "Purchase quantity is required so stock can be updated.",
      });
    }

    // Resolve multi-entry lines to owned products before save.
    if (Array.isArray(data.entries) && data.entries.length) {
      for (const entry of data.entries) {
        if (!entry.quantity && !entry.qty) continue;
        const entryOwned = await resolveOwnedProduct(
          req.adminId,
          entry.product || entry.productId,
          entry.productName || entry.name || data.productName
        );
        if (!entryOwned) {
          return res.status(400).json({
            success: false,
            message: `Product "${entry.productName || entry.product || ""}" not found in this shop.`,
          });
        }
        entry.product = entryOwned._id;
        if (!entry.productName) entry.productName = entryOwned.name;
      }
    }

    const additions = [];
    if (!skipStock) {
      if (Array.isArray(data.entries) && data.entries.length) {
        data.entries.forEach((entry) => {
          const qty = Number(entry.quantity || entry.qty) || 0;
          if (entry.product && qty > 0) additions.push({ productId: entry.product, qty });
        });
      } else if (data.product && Number(data.qty) > 0) {
        additions.push({ productId: data.product, qty: Number(data.qty) });
      }
    }

    const priorIds = [...new Set(additions.map((a) => pid(a.productId)).filter(Boolean))];
    const priorDocs = priorIds.length
      ? await Product.find({ _id: { $in: priorIds }, adminId: req.adminId }).select("stock")
      : [];
    const stockBefore = {};
    priorDocs.forEach((p) => { stockBefore[pid(p._id)] = Number(p.stock) || 0; });

    const purchase = await Purchase.create(data);

    try {
      if (!skipStock) {
        if (Array.isArray(data.entries) && data.entries.length) {
          for (const entry of data.entries) {
            if (entry.product && (entry.quantity || entry.qty)) {
              await addStock(
                req.adminId,
                entry.product,
                entry.quantity || entry.qty,
                entry.category || data.category,
                entry.productPrice,
                entry.rows,
                data.unit
              );
            }
          }
        } else if (data.product && data.qty) {
          await addStock(
            req.adminId,
            data.product,
            data.qty,
            data.category,
            data.productPrice,
            data.rows,
            data.unit
          );
        }
      }

      const savedCost = Number(purchase.rate) || Number(purchase.productPrice) || 0;
      await Product.findOneAndUpdate(
        { _id: purchase.product, adminId: req.adminId },
        {
          lastInvoice: purchase.invoice || purchase.invoiceNum || "",
          lastPurchaseDate: purchase.date || "",
          lastSupplier: purchase.supplier || purchase.supplierName || "",
          ...(savedCost > 0 ? { listCost: savedCost } : {}),
        }
      );

      for (const line of additions) {
        await applyStockValueDelta(req.adminId, line.productId, line.qty, savedCost);
      }
    } catch (stockErr) {
      // Never leave a bill that did not update this shop's stock.
      await Purchase.deleteOne({ _id: purchase._id, adminId: req.adminId });
      const touch = pid(purchase.product);
      if (touch) {
        try { await reconcileProductStock(req.adminId, [touch]); } catch (_) { /* best effort */ }
      }
      throw stockErr;
    }

    await logActivity(req, {
      type: "purchase",
      date: purchase.date,
      product: purchase.product,
      productName: purchase.productName,
      category: purchase.category,
      qty: purchaseLineQty(purchase),
      invoice: purchase.invoice || purchase.invoiceNum,
      party: purchase.supplier || purchase.supplierName,
      summary: "Purchase saved",
    });
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

    const owned = await resolveOwnedProduct(
      req.adminId,
      bodyWithoutHistory.product || old.product,
      bodyWithoutHistory.productName || old.productName
    );
    if (!owned) {
      return res.status(400).json({
        success: false,
        message: `Product "${bodyWithoutHistory.productName || old.productName || ""}" not found in this shop. Cannot update purchase.`,
      });
    }
    bodyWithoutHistory.product = owned._id;
    if (!bodyWithoutHistory.productName) bodyWithoutHistory.productName = owned.name;

    const oldPid = pid(old.product);
    const newPid = pid(owned._id);
    const oldQty = purchaseLineQty(old);
    const newQty = purchaseLineQty({ ...old.toObject(), ...bodyWithoutHistory });
    const productChanged = oldPid && newPid && oldPid !== newPid;
    const qtyChanged = Math.abs(oldQty - newQty) > 0.0001;

    // A stock edit froze the old bills into one count. Changing one of those
    // bills moves that count. It must not put the previous piece total back.
    if (qtyChanged || productChanged) {
      if (oldPid) {
        await shiftStockBaseline(req.adminId, oldPid, old.createdAt, productChanged ? -oldQty : newQty - oldQty);
      }
      if (productChanged && newPid) await shiftStockBaseline(req.adminId, newPid, old.createdAt, newQty);
    }

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

    await logActivity(req, {
      type: "purchase-edit",
      date: purchase.date,
      product: purchase.product,
      productName: purchase.productName,
      category: purchase.category,
      qty: purchaseLineQty(purchase),
      invoice: purchase.invoice || purchase.invoiceNum,
      party: purchase.supplier || purchase.supplierName,
      summary: "Purchase edited",
    });
    res.json({ success: true, purchase });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/:id", protect, async (req, res) => {
  try {
    const purchase = await Purchase.findOne({ _id: req.params.id, adminId: req.adminId });
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    const skipStockAdj = !!(purchase.skipStock || purchase.stockEdit);
    const allReturns = await PurchaseReturn.find({ adminId: req.adminId });
    const returns = allReturns.filter((r) =>
      (r.items || []).some((it) => String(it.purchase) === String(purchase._id))
    );
    const returnedByProduct = {};
    returns.forEach((r) => {
      (r.items || []).forEach((it) => {
        if (String(it.purchase) !== String(purchase._id)) return;
        const id = pid(it.product || it.productId) || pid(purchase.product);
        const q = Number(it.qty) || 0;
        if (!id || q <= 0) return;
        returnedByProduct[id] = (returnedByProduct[id] || 0) + q;
      });
    });

    const lines = [];
    if (Array.isArray(purchase.entries) && purchase.entries.length) {
      for (const entry of purchase.entries) {
        const id = pid(entry.product || entry.productId);
        const q = Number(entry.quantity) || Number(entry.qty) || 0;
        if (id && q > 0) lines.push({ id, qty: q, name: entry.productName || purchase.productName || "" });
      }
    }
    if (!lines.length) {
      const id = pid(purchase.product);
      const q = purchaseLineQty(purchase);
      if (id && q > 0) lines.push({ id, qty: q, name: purchase.productName || "" });
    }

    if (!skipStockAdj) {
      for (const line of lines) {
        const net = line.qty - (returnedByProduct[line.id] || 0);
        if (net <= 0) continue;
        const remaining = await purchaseLineRemaining(req.adminId, purchase, line.id, net);
        if (remaining + 0.08 < net) {
          const used = Math.round((net - remaining) * 1000) / 1000;
          return res.status(400).json({
            success: false,
            purchased: net,
            remaining,
            used,
            message: `"${line.name || "Product"}": is bill ki ${net} pieces mein se ${used} sale/use ho chuke hain. Ab ${remaining} pieces stock mein hain. Poori bill delete nahi ho sakti. Remaining ${remaining} kam karne ke liye Stock List → Edit use karein, ya pehle sale return karein.`,
          });
        }
      }
    }

    const removed = await Purchase.findOneAndDelete({ _id: purchase._id, adminId: req.adminId });
    if (!removed) return res.status(404).json({ success: false, message: "Purchase not found" });

    let undone = null;
    if (skipStockAdj) {
      undone = await reverseStockEditPurchase(req.adminId, purchase);
    } else {
      for (const line of lines) {
        const net = line.qty - (returnedByProduct[line.id] || 0);
        if (net <= 0) continue;
        await applyStockValueDelta(req.adminId, line.id, -net, 0);
        await adjustStock(req.adminId, line.id, -net);
        await Product.findOneAndUpdate(
          { _id: line.id, adminId: req.adminId, stock: { $lt: 0 } },
          { $set: { stock: 0 } },
          { runValidators: false }
        );
        await shiftStockBaseline(req.adminId, line.id, purchase.createdAt, -net);
      }
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

    await logActivity(req, {
      type: "purchase-delete",
      date: purchase.date,
      product: purchase.product,
      productName: purchase.productName,
      category: purchase.category,
      qty: purchaseLineQty(purchase),
      fromQty: undone ? undone.from : purchase.fromQty,
      toQty: undone ? undone.to : purchase.toQty,
      invoice: purchase.invoice || purchase.invoiceNum,
      party: purchase.supplier || purchase.supplierName,
      summary: undone
        ? `Stock edit deleted ${undone.from} → ${undone.to}`
        : "Purchase deleted",
    });
    res.json({ success: true, message: "Purchase deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;