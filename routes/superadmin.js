const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { protect, superAdminOnly } = require("../middleware/auth");

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });

// GET /api/superadmin/admins — all admins list
router.get("/admins", protect, superAdminOnly, async (req, res) => {
  try {
    const admins = await User.find({ role: "admin" })
      .select("-password")
      .sort({ createdAt: -1 });
    res.json({ success: true, admins });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/superadmin/admins — create new admin
router.post("/admins", protect, superAdminOnly, async (req, res) => {
  try {
    const { name, email, password, businessName } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: "Name, email, password required" });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ success: false, message: "Email already in use" });

    const user = await User.create({
      name,
      email,
      password,
      role: "admin",
      businessName: businessName || "",
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      admin: { _id: user._id, name: user.name, email: user.email, role: user.role, businessName: user.businessName, createdAt: user.createdAt }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/superadmin/admins/:id — update admin
router.put("/admins/:id", protect, superAdminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== "admin")
      return res.status(404).json({ success: false, message: "Admin not found" });

    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;
    user.businessName = req.body.businessName !== undefined ? req.body.businessName : user.businessName;
    if (req.body.password && req.body.password.trim() !== "") {
      user.password = req.body.password;
    }
    await user.save();
    res.json({
      success: true,
      admin: { _id: user._id, name: user.name, email: user.email, role: user.role, businessName: user.businessName }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/superadmin/admins/:id — delete admin
router.delete("/admins/:id", protect, superAdminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== "admin")
      return res.status(404).json({ success: false, message: "Admin not found" });

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Admin removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/superadmin/stats — overall stats
router.get("/stats", protect, superAdminOnly, async (req, res) => {
  try {
    const adminCount = await User.countDocuments({ role: "admin" });
    const staffCount = await User.countDocuments({ role: "staff" });
    res.json({ success: true, stats: { adminCount, staffCount, totalUsers: adminCount + staffCount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
