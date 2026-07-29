const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    accountName: { type: String, trim: true, default: "" },
    accountType: { type: String, enum: ["bank", "cash", "wallet"], default: "cash" },
    bankName: { type: String, default: "" },
    accountNumber: { type: String, default: "" },
    openingBalance: { type: Number, default: 0 },
    currentBalance: { type: Number, default: 0 },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Account", accountSchema);
