const mongoose = require("mongoose");

const saleReturnSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    sale: { type: mongoose.Schema.Types.ObjectId, ref: "Sale" },
    invoice: { type: String, default: "" },
    returnInvoice: { type: String, default: "" },
    customer: { type: String, default: "" },
    date: { type: String, default: "" },
    items: { type: mongoose.Schema.Types.Mixed, default: [] },
    total: { type: Number, default: 0 },
    notes: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, strict: false }
);

saleReturnSchema.index({ adminId: 1, sale: 1, createdAt: -1 });

module.exports = mongoose.model("SaleReturn", saleReturnSchema);
