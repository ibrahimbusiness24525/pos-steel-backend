const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    date: { type: String, default: "" },
    type: { type: String, trim: true, required: true },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, default: "" },
    payMode: { type: String, enum: ["paid", "payable", "receivable"], default: "paid" },
    accountId: { type: String, default: "" },
    accountName: { type: String, default: "" },
    partyName: { type: String, default: "" },
    partyType: { type: String, enum: ["", "supplier", "customer"], default: "" },
    invoice: { type: String, default: "" },
  },
  { timestamps: true }
);

expenseSchema.index({ adminId: 1, date: -1, createdAt: -1 });

module.exports = mongoose.model("Expense", expenseSchema);
