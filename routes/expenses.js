const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Expense = require("../models/Expense");
const ExpenseType = require("../models/ExpenseType");
const { protect } = require("../middleware/auth");

router.use(protect);

const DEFAULT_TYPES = [
  "Rent", "Salary", "Electricity", "Gas", "Water",
  "Transport", "Food", "Repair", "Internet", "Misc",
];

function defKey(name) {
  return "def:" + String(name || "").trim().toLowerCase();
}

async function ensureDefaultTypes(adminId) {
  const existing = await ExpenseType.find({ adminId });
  const byKey = new Map(existing.filter((t) => t.key).map((t) => [t.key, t]));
  const byName = new Map(existing.map((t) => [String(t.name || "").toLowerCase(), t]));
  for (const name of DEFAULT_TYPES) {
    const key = defKey(name);
    if (byKey.has(key)) continue;
    const hit = byName.get(name.toLowerCase());
    if (hit) {
      hit.key = key;
      await hit.save();
      continue;
    }
    try {
      await ExpenseType.create({ adminId, name, key, removed: false });
    } catch { /* duplicate name */ }
  }
}

async function findType(adminId, id) {
  if (id && mongoose.isValidObjectId(id)) {
    const byId = await ExpenseType.findOne({ _id: id, adminId });
    if (byId) return byId;
  }
  return ExpenseType.findOne({ adminId, name: String(id || "").trim() });
}

async function listActiveTypes(adminId) {
  await ensureDefaultTypes(adminId);
  return ExpenseType.find({ adminId, removed: { $ne: true } }).sort({ name: 1 });
}

router.get("/types", async (req, res) => {
  try {
    const saved = await listActiveTypes(req.adminId);
    res.json({
      success: true,
      types: saved.map((t) => t.name),
      records: saved,
      custom: saved,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/types", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Type name is required" });
    const existing = await ExpenseType.findOne({ adminId: req.adminId, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
    if (existing) {
      existing.removed = false;
      existing.name = name;
      await existing.save();
      return res.status(200).json({ success: true, type: existing });
    }
    const type = await ExpenseType.create({
      adminId: req.adminId,
      name,
      key: "cus:" + Date.now().toString(36),
      removed: false,
    });
    res.status(201).json({ success: true, type });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put("/types/:id", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Type name is required" });
    const type = await findType(req.adminId, req.params.id);
    if (!type) return res.status(404).json({ success: false, message: "Type not found" });
    const oldName = type.name;
    const clash = await ExpenseType.findOne({
      adminId: req.adminId,
      _id: { $ne: type._id },
      name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    });
    if (clash && !clash.removed) {
      return res.status(400).json({ success: false, message: "This type already exists" });
    }
    type.name = name;
    type.removed = false;
    await type.save();
    if (oldName && oldName !== name) {
      await Expense.updateMany({ adminId: req.adminId, type: oldName }, { $set: { type: name } });
    }
    res.json({ success: true, type });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/types/:id", async (req, res) => {
  try {
    const type = await findType(req.adminId, req.params.id);
    if (!type) return res.status(404).json({ success: false, message: "Type not found" });
    if (String(type.key || "").startsWith("def:")) {
      type.removed = true;
      await type.save();
    } else {
      await ExpenseType.deleteOne({ _id: type._id });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const expenses = await Expense.find({ adminId: req.adminId }).sort({ date: -1, createdAt: -1 });
    res.json({ success: true, expenses });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Amount must be greater than 0" });
    }
    const type = String(req.body.type || "").trim();
    if (!type) return res.status(400).json({ success: false, message: "Expense type is required" });
    const payMode = ["paid", "payable", "receivable"].includes(req.body.payMode) ? req.body.payMode : "paid";
    const expense = await Expense.create({
      adminId: req.adminId,
      date: req.body.date || new Date().toISOString().slice(0, 10),
      type,
      amount,
      note: req.body.note || "",
      payMode,
      accountId: req.body.accountId || "",
      accountName: req.body.accountName || "",
      partyName: req.body.partyName || "",
      partyType: req.body.partyType || (payMode === "payable" ? "supplier" : payMode === "receivable" ? "customer" : ""),
      invoice: req.body.invoice || "",
    });
    if (!expense.invoice) {
      expense.invoice = `EXP-${String(expense._id).slice(-6).toUpperCase()}`;
      await expense.save();
    }
    const typeDoc = await ExpenseType.findOne({ adminId: req.adminId, name: type });
    if (!typeDoc) {
      await ExpenseType.create({
        adminId: req.adminId,
        name: type,
        key: "cus:" + Date.now().toString(36),
        removed: false,
      }).catch(() => {});
    } else if (typeDoc.removed) {
      typeDoc.removed = false;
      await typeDoc.save();
    }
    res.status(201).json({ success: true, expense });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const amount = req.body.amount != null ? Number(req.body.amount) : undefined;
    if (amount !== undefined && (!amount || amount <= 0)) {
      return res.status(400).json({ success: false, message: "Amount must be greater than 0" });
    }
    const update = { ...req.body };
    if (update.type) update.type = String(update.type).trim();
    const expense = await Expense.findOneAndUpdate(
      { _id: req.params.id, adminId: req.adminId },
      update,
      { new: true, runValidators: true }
    );
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });
    res.json({ success: true, expense });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const expense = await Expense.findOneAndDelete({ _id: req.params.id, adminId: req.adminId });
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
