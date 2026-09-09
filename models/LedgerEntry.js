const mongoose = require("mongoose");

const ledgerEntrySchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    party: { type: mongoose.Schema.Types.ObjectId, ref: "Party", required: true },
    kind: { type: String, enum: ["take", "give", "credit", "cash_in", "cash_out"], required: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: String, default: "" },
    note: { type: String, default: "" },
    invoice: { type: String, default: "" },
    accountId: { type: String, default: "" },
    accountName: { type: String, default: "" },
  },
  { timestamps: true }
);

ledgerEntrySchema.index({ adminId: 1, party: 1, createdAt: -1 });

module.exports = mongoose.model("LedgerEntry", ledgerEntrySchema);
