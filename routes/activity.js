const express = require("express");
const router = express.Router();
const Activity = require("../models/Activity");
const { protect } = require("../middleware/auth");

router.use(protect);

router.get("/", async (req, res) => {
  try {
    const filter = req.adminId ? { adminId: req.adminId } : {};
    const type = String(req.query.type || "").trim();
    if (type && type !== "all") filter.type = type;
    const product = String(req.query.product || req.query.productId || "").trim();
    if (/^[a-fA-F0-9]{24}$/.test(product)) filter.product = product;
    const from = String(req.query.from || "").slice(0, 10);
    const to = String(req.query.to || "").slice(0, 10);
    if (from && to) filter.date = { $gte: from, $lte: to };
    else if (from) filter.date = from;
    const cap = Math.min(Math.max(parseInt(req.query.limit, 10) || 800, 1), 2000);
    const activities = await Activity.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(cap)
      .maxTimeMS(8000)
      .lean();
    res.json({ success: true, activities });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
