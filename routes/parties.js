const express = require("express");
const router = express.Router();
const Party = require("../models/Party");
const LedgerEntry = require("../models/LedgerEntry");
const Purchase = require("../models/Purchase");
const Sale = require("../models/Sale");
const { protect } = require("../middleware/auth");

router.use(protect);

function partyBalance(type, opening, entries) {
  let take = 0;
  let give = 0;
  (entries || []).forEach((e) => {
    const a = Number(e.amount) || 0;
    if (e.kind === "take") take += a;
    else if (e.kind === "give") give += a;
    else if (e.kind === "credit") {
      if (type === "supplier") take += a;
      else give += a;
    } else if (e.kind === "cash_in") {
      if (type === "supplier") take += a;
      else give -= a;
    } else if (e.kind === "cash_out") {
      if (type === "supplier") take -= a;
      else give += a;
    }
  });
  const open = Number(opening) || 0;
  if (type === "supplier") take += open;
  else give += open;
  const net = give - take;
  return {
    take,
    give,
    credit: take,
    cashIn: 0,
    cashOut: 0,
    opening: open,
    balance: net,
    receivable: Math.max(0, net),
    payable: Math.max(0, -net),
  };
}

function withTotals(party, entries) {
  const obj = party.toObject ? party.toObject() : party;
  return { ...obj, ...partyBalance(obj.type, obj.openingBalance, entries) };
}

// GET /api/parties?type=supplier|customer
router.get("/", async (req, res) => {
  try {
    const filter = { adminId: req.adminId };
    if (req.query.type === "supplier" || req.query.type === "customer") {
      filter.type = req.query.type;
    }
    const parties = await Party.find(filter).sort({ name: 1 });
    const ids = parties.map((p) => p._id);
    const entries = ids.length
      ? await LedgerEntry.find({ adminId: req.adminId, party: { $in: ids } })
      : [];
    const byParty = {};
    entries.forEach((e) => {
      const key = String(e.party);
      if (!byParty[key]) byParty[key] = [];
      byParty[key].push(e);
    });
    res.json({
      success: true,
      parties: parties.map((p) => withTotals(p, byParty[String(p._id)] || [])),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/parties
router.post("/", async (req, res) => {
  try {
    const { type, name, phone, notes, openingBalance, partyType, address } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }
    if (type !== "supplier" && type !== "customer") {
      return res.status(400).json({ success: false, message: "type must be supplier or customer" });
    }
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ success: false, message: "Number is required" });
    }
    const existing = await Party.findOne({
      adminId: req.adminId,
      type,
      name: String(name).trim(),
    });
    if (existing) {
      return res.status(400).json({ success: false, message: "This name already exists" });
    }
    const party = await Party.create({
      adminId: req.adminId,
      type,
      name: String(name).trim(),
      phone: phone || "",
      partyType: partyType || "",
      address: address || "",
      notes: notes || "",
      openingBalance: Number(openingBalance) || 0,
    });
    res.status(201).json({ success: true, party: withTotals(party, []) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/parties/import — unique suppliers from purchases, customers from sales
router.post("/import", async (req, res) => {
  try {
    const [purchases, sales, existing] = await Promise.all([
      Purchase.find({ adminId: req.adminId }).select("supplier supplierName"),
      Sale.find({ adminId: req.adminId }).select("customer remainingAmount isPartial"),
      Party.find({ adminId: req.adminId }),
    ]);
    const have = new Set(existing.map((p) => `${p.type}::${p.name.toLowerCase()}`));
    const created = [];

    const supplierNames = new Set();
    purchases.forEach((p) => {
      const n = (p.supplier || p.supplierName || "").trim();
      if (n) supplierNames.add(n);
    });
    for (const name of supplierNames) {
      const key = `supplier::${name.toLowerCase()}`;
      if (have.has(key)) continue;
      const party = await Party.create({
        adminId: req.adminId, type: "supplier", name, phone: "", partyType: "", address: "", notes: "", openingBalance: 0,
      });
      have.add(key);
      created.push(withTotals(party, []));
    }

    const customerNames = new Set();
    sales.forEach((s) => {
      const n = (s.customer || "").trim();
      if (n) customerNames.add(n);
    });
    for (const name of customerNames) {
      const key = `customer::${name.toLowerCase()}`;
      if (have.has(key)) continue;
      const party = await Party.create({
        adminId: req.adminId, type: "customer", name, phone: "", partyType: "", address: "", notes: "", openingBalance: 0,
      });
      have.add(key);
      created.push(withTotals(party, []));
    }

    res.json({ success: true, created: created.length, parties: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/parties/:id
router.get("/:id", async (req, res) => {
  try {
    const party = await Party.findOne({ _id: req.params.id, adminId: req.adminId });
    if (!party) return res.status(404).json({ success: false, message: "Not found" });
    const entries = await LedgerEntry.find({ adminId: req.adminId, party: party._id }).sort({ createdAt: -1, _id: -1 });
    res.json({ success: true, party: withTotals(party, entries), entries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/parties/:id
router.put("/:id", async (req, res) => {
  try {
    const { name, phone, notes, openingBalance, partyType, address } = req.body;
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (phone !== undefined) update.phone = phone;
    if (notes !== undefined) update.notes = notes;
    if (partyType !== undefined) update.partyType = partyType;
    if (address !== undefined) update.address = address;
    if (openingBalance !== undefined) update.openingBalance = Number(openingBalance) || 0;
    if (update.name === "") {
      return res.status(400).json({ success: false, message: "Name is required" });
    }
    const party = await Party.findOneAndUpdate(
      { _id: req.params.id, adminId: req.adminId },
      update,
      { new: true }
    );
    if (!party) return res.status(404).json({ success: false, message: "Not found" });
    const entries = await LedgerEntry.find({ adminId: req.adminId, party: party._id });
    res.json({ success: true, party: withTotals(party, entries) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/parties/:id
router.delete("/:id", async (req, res) => {
  try {
    const party = await Party.findOneAndDelete({ _id: req.params.id, adminId: req.adminId });
    if (!party) return res.status(404).json({ success: false, message: "Not found" });
    await LedgerEntry.deleteMany({ adminId: req.adminId, party: party._id });
    res.json({ success: true, message: "Deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/parties/:id/entries
router.post("/:id/entries", async (req, res) => {
  try {
    const party = await Party.findOne({ _id: req.params.id, adminId: req.adminId });
    if (!party) return res.status(404).json({ success: false, message: "Not found" });
    const { kind, amount, date, note, invoice, accountId, accountName } = req.body;
    if (!["take", "give", "credit", "cash_in", "cash_out"].includes(kind)) {
      return res.status(400).json({ success: false, message: "kind must be take or give" });
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ success: false, message: "Amount must be greater than 0" });
    }
    const entry = await LedgerEntry.create({
      adminId: req.adminId,
      party: party._id,
      kind,
      amount: amt,
      date: date || new Date().toISOString().slice(0, 10),
      note: note || "",
      invoice: invoice || "",
      accountId: accountId || "",
      accountName: accountName || "",
    });
    const entries = await LedgerEntry.find({ adminId: req.adminId, party: party._id }).sort({ createdAt: -1, _id: -1 });
    res.status(201).json({ success: true, entry, party: withTotals(party, entries), entries });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/parties/:id/entries/:entryId
router.delete("/:id/entries/:entryId", async (req, res) => {
  try {
    const party = await Party.findOne({ _id: req.params.id, adminId: req.adminId });
    if (!party) return res.status(404).json({ success: false, message: "Not found" });
    const entry = await LedgerEntry.findOneAndDelete({
      _id: req.params.entryId,
      party: party._id,
      adminId: req.adminId,
    });
    if (!entry) return res.status(404).json({ success: false, message: "Entry not found" });
    const entries = await LedgerEntry.find({ adminId: req.adminId, party: party._id }).sort({ createdAt: -1, _id: -1 });
    res.json({ success: true, party: withTotals(party, entries), entries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
