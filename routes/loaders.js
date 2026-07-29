const express  = require("express");
const router   = express.Router();
const Loader   = require("../models/Loader");
const Sale     = require("../models/Sale");
const { protect, adminOnly } = require("../middleware/auth");

// All routes protected
router.use(protect);

// GET /api/loaders — admin ke saare loaders
router.get("/", async (req, res) => {
  try {
    const loaders = await Loader.find({ createdBy: req.adminId }).sort({ createdAt: -1 });
    res.json({ success: true, loaders });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/loaders — naya loader add
router.post("/", adminOnly, async (req, res) => {
  try {
    const { name, phone, details, defaultFee } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Name required" });
    const loader = await Loader.create({ name, phone: phone||"", details: details||"", defaultFee: Number(defaultFee)||0, createdBy: req.adminId });
    res.json({ success: true, loader });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT /api/loaders/:id — update
router.put("/:id", adminOnly, async (req, res) => {
  try {
    const { name, phone, details, defaultFee } = req.body;
    const loader = await Loader.findOneAndUpdate(
      { _id: req.params.id, createdBy: req.adminId },
      { name, phone: phone||"", details: details||"", defaultFee: Number(defaultFee)||0 },
      { new: true }
    );
    if (!loader) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, loader });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/loaders/:id
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const loader = await Loader.findOneAndDelete({ _id: req.params.id, createdBy: req.adminId });
    if (!loader) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/loaders/daily?date=YYYY-MM-DD — us din ke sales grouped by loader
router.get("/daily", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const sales = await Sale.find({ createdBy: req.adminId, date, loaderName: { $ne: "" } });

    const map = {};
    sales.forEach(s => {
      const name = s.loaderName || "—";
      if (!map[name]) map[name] = { loaderName: name, invoices: [], totalFee: 0, totalLoad: 0 };
      map[name].invoices.push(s.invoice);
      map[name].totalFee += Number(s.loaderFee) || 0;
      map[name].totalLoad += Number(s.qty) || 0;
    });

    res.json({ success: true, date, loaders: Object.values(map) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
