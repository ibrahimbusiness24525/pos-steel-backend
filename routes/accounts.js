const express = require("express");
const router = express.Router();
const Account = require("../models/Account");
const { protect } = require("../middleware/auth");

const normalize = (body) => {
  const d = { ...body };
  if (d.type && !d.accountType) d.accountType = d.type;
  if (d.name && !d.accountName) d.accountName = d.name;
  if (d.openingBalance !== undefined && d.currentBalance === undefined) {
    d.currentBalance = d.openingBalance;
  }
  return d;
};

const toFrontend = (acc) => {
  const obj = acc.toObject ? acc.toObject() : acc;
  return {
    ...obj,
    type: obj.accountType || obj.type,
    name: obj.accountName || obj.name,
  };
};

// GET — only this admin's accounts
router.get("/", protect, async (req, res) => {
  try {
    const filter = req.adminId ? { adminId: req.adminId } : {};
    const accounts = await Account.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, accounts: accounts.map(toFrontend) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", protect, async (req, res) => {
  try {
    const data = { ...normalize(req.body), adminId: req.adminId };
    const account = await Account.create(data);
    res.status(201).json({ success: true, account: toFrontend(account) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put("/:id", protect, async (req, res) => {
  try {
    const data = normalize(req.body);
    const account = await Account.findOneAndUpdate(
      { _id: req.params.id, adminId: req.adminId },
      data,
      { new: true, runValidators: true }
    );
    if (!account) return res.status(404).json({ success: false, message: "Account not found" });
    res.json({ success: true, account: toFrontend(account) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/:id", protect, async (req, res) => {
  try {
    const account = await Account.findOneAndDelete({ _id: req.params.id, adminId: req.adminId });
    if (!account) return res.status(404).json({ success: false, message: "Account not found" });
    res.json({ success: true, message: "Account deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
