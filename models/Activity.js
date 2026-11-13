const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    type: { type: String, required: true },
    date: { type: String, default: "" },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    productName: { type: String, default: "" },
    category: { type: String, default: "" },
    qty: { type: Number, default: 0 },
    fromQty: { type: Number, default: null },
    toQty: { type: Number, default: null },
    invoice: { type: String, default: "" },
    party: { type: String, default: "" },
    summary: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    byName: { type: String, default: "" },
  },
  { timestamps: true, strict: false }
);

activitySchema.index({ adminId: 1, createdAt: -1 });
activitySchema.index({ adminId: 1, date: -1 });
activitySchema.index({ adminId: 1, product: 1, createdAt: -1 });
activitySchema.index({ adminId: 1, type: 1, date: -1 });

module.exports = mongoose.model("Activity", activitySchema);
