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
    // Har product ki required qty nikalo — is baar HAR product alag se, chahe
    // frontend "saleItems" bheje ya sirf purana "items" array (productName +
    // rows[0].desc). Isse purana deployed frontend bhi sahi kaam karega.
    const stockRequired = {}; // productId → qty needed

    const addRequired = (productId, qty) => {
      if (!productId || !qty) return;
      const id = productId.toString();
      stockRequired[id] = (stockRequired[id] || 0) + Number(qty);
    };

    // Description string se qty nikalne ke liye (jab item.qty na diya ho)
    const parseQtyFromDesc = (cat, desc) => {
      if (!desc) return 0;
      let m;
      if (cat === "Chader") m = desc.match(/^(\d+\.?\d*)kg/);
      else if (cat === "Net") m = desc.match(/^(\d+\.?\d*)ft/);
      else m = desc.match(/^(\d+\.?\d*)pc/); // Pipe / Hardware / Custom
      return m ? parseFloat(m[1]) : 0;
    };

    if (Array.isArray(data.saleItems) && data.saleItems.length > 0) {
      // Best path: naye frontend se aaya hua clean [{productId, qty}] array —
      // har product ki apni ID aur qty seedhi milti hai.
      data.saleItems.forEach(si => addRequired(si.productId || si.product, si.qty));
    } else if (Array.isArray(data.items) && data.items.length > 0) {
      // Fallback path: "items" array — HAR item ke liye alag se productId aur
      // qty nikalo (productName se match, desc se qty parse), sirf pehle
      // product ke against total qty combine mat karo.
      for (const item of data.items) {
        let itemProductId = item.productId || item.product || "";
        if (!itemProductId && item.productName) {
          const p = await Product.findOne({ name: item.productName, adminId: req.adminId });
          if (p) itemProductId = p._id;
        }
        let itemQty = Number(item.qty) || 0;
        if (!itemQty) {
          const desc = item.rows?.[0]?.desc || "";
          itemQty = parseQtyFromDesc(item.category, desc);
        }
        addRequired(itemProductId, itemQty);
      }
    } else if (data.product && data.qty) {
      // Purana single-product sale (Products/Quick-sale page waghera)
      addRequired(data.product, data.qty);
    }

    // Stock check karo — sab products ke liye
    for (const [productId, qtyNeeded] of Object.entries(stockRequired)) {
      const prod = await Product.findOne({ _id: productId, adminId: req.adminId });
      if (!prod) {
        console.warn(`[SALE] Product ${productId} not found under adminId ${req.adminId} — skipping stock check for it.`);
        continue; // product nahi mila — skip
      }
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
    // Use the same stockRequired map that was already validated above, so
    // EVERY product in a multi-product sale gets its stock deducted correctly.
    // Atomic + guarded: only deducts if enough stock is still available at the
    // moment of the update (prevents negative stock from concurrent sales), and
    // logs a clear warning if a product couldn't be found/updated so it never
    // fails silently again.
    const deductStock = async (productId, qty) => {
      const amount = Number(qty) || 0;
      if (!productId || !amount) return;
      const updated = await Product.findOneAndUpdate(
        { _id: productId, adminId: req.adminId, stock: { $gte: amount } },
        { $inc: { stock: -amount } },
        { new: true }
      );
      if (!updated) {
        console.warn(`[SALE ${sale._id}] Stock NOT deducted for product ${productId} (qty ${amount}) — product not found under this admin, or stock changed concurrently.`);
      }
    };

    const deductedProductIds = Object.keys(stockRequired);
    if (deductedProductIds.length > 0) {
      for (const [productId, qty] of Object.entries(stockRequired)) {
        await deductStock(productId, qty);
      }
    } else if (data.product && data.qty) {
      // Fallback for sales with no saleItems/product+qty match above
      await deductStock(data.product, data.qty);
    }

    res.status(201).json({ success: true, sale });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put("/:id", protect, async (req, res) => {
  try {
    const oldSale = await Sale.findOne({ _id: req.params.id, adminId: req.adminId });
    if (!oldSale) return res.status(404).json({ success: false, message: "Sale not found" });

    // ── REVERSE OLD STOCK — jo qty pehle deduct hui thi wo wapas add karo ──────
    // (BUG FIX: pehle sale edit karne par stock bilkul touch nahi hota tha, isliye
    // qty change karne par stock hamesha galat ho jata tha.)
    const reverseStock = async (productId, qty) => {
      if (!productId || !qty) return;
      await Product.findOneAndUpdate(
        { _id: productId, adminId: req.adminId },
        { $inc: { stock: Number(qty) } }
      );
    };
    if (Array.isArray(oldSale.saleItems) && oldSale.saleItems.length > 0) {
      for (const si of oldSale.saleItems) {
        await reverseStock(si.productId || si.product, si.qty);
      }
    } else if (oldSale.product && oldSale.qty) {
      await reverseStock(oldSale.product, oldSale.qty);
    }

    const sale = await Sale.findOneAndUpdate(
      { _id: req.params.id, adminId: req.adminId },
      req.body,
      { new: true, runValidators: false }
    );
    if (!sale) return res.status(404).json({ success: false, message: "Sale not found" });

    // ── APPLY NEW STOCK — updated sale ki qty ke hisaab se dobara deduct karo ──
    const deductStock = async (productId, qty) => {
      if (!productId || !qty) return;
      await Product.findOneAndUpdate(
        { _id: productId, adminId: req.adminId },
        { $inc: { stock: -Number(qty) } }
      );
    };
    if (Array.isArray(sale.saleItems) && sale.saleItems.length > 0) {
      for (const si of sale.saleItems) {
        await deductStock(si.productId || si.product, si.qty);
      }
    } else if (sale.product && sale.qty) {
      await deductStock(sale.product, sale.qty);
    }

    res.json({ success: true, sale });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/:id", protect, async (req, res) => {
  try {
    const sale = await Sale.findOneAndDelete({ _id: req.params.id, adminId: req.adminId });
    if (!sale) return res.status(404).json({ success: false, message: "Sale not found" });

    // Stock wapas karo jab sale delete ho — multi-product sale ho to sab
    // products ka stock wapas karo, sirf pehle wale ka nahi.
    if (Array.isArray(sale.saleItems) && sale.saleItems.length > 0) {
      for (const si of sale.saleItems) {
        const pid = si.productId || si.product;
        if (pid && si.qty) {
          await Product.findOneAndUpdate(
            { _id: pid, adminId: req.adminId },
            { $inc: { stock: Number(si.qty) } }
          );
        }
      }
    } else if (sale.product && sale.qty) {
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
