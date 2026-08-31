const mongoose = require("mongoose");

const purchaseReturnSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    invoice: { type: String, default: "" },
    returnInvoice: { type: String, default: "" },
    supplier: { type: String, default: "" },
    date: { type: String, default: "" },
    items: { type: mongoose.Schema.Types.Mixed, default: [] },
    total: { type: Number, default: 0 },
    notes: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, strict: false }
);

purchaseReturnSchema.index({ adminId: 1, invoice: 1, createdAt: -1 });

module.exports = mongoose.model("PurchaseReturn", purchaseReturnSchema);
