const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { protect, adminOnly } = require("../middleware/auth");

// GET — only staff created by this admin
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const staff = await User.find({ createdBy: req.user._id, role: "staff" })
      .select("-password")
      .sort({ createdAt: -1 });
    res.json({ success: true, staff });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST — create staff under this admin
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: "Name, email, password required" });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ success: false, message: "Email already in use" });

    const user = await User.create({
      name,
      email,
      password,
      role: role || "staff",
      createdBy: req.user._id,  // link staff to this admin
    });
    res.status(201).json({
      success: true,
      staff: { _id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT — update only this admin's staff
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id, createdBy: req.user._id });
    if (!user) return res.status(404).json({ success: false, message: "Staff not found" });

    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;
    user.role = req.body.role || user.role;
    if (req.body.password && req.body.password.trim() !== "") {
      user.password = req.body.password;
    }
    await user.save();
    res.json({
      success: true,
      staff: { _id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE — delete only this admin's staff
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString())
      return res.status(400).json({ success: false, message: "Cannot delete your own account" });

    const user = await User.findOneAndDelete({ _id: req.params.id, createdBy: req.user._id });
    if (!user) return res.status(404).json({ success: false, message: "Staff not found" });
    res.json({ success: true, message: "Staff removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
