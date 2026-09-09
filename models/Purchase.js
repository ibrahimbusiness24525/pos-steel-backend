const mongoose = require("mongoose");

const purchaseSchema = new mongoose.Schema(
  {
    adminId:      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    invoiceNum:   { type: String, default: "" },
    invoice:      { type: String, default: "" },
    supplier:     { type: String, trim: true, default: "" },
    supplierName: { type: String, default: "" },
    date:         { type: String, default: "" },
    product:      { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    productName:  { type: String, default: "" },
    productPrice: { type: Number, default: 0 },
    category:     { type: String, default: "" },
    qty:          { type: Number, default: 0 },
    rate:         { type: Number, default: 0 },
    total:        { type: Number, default: 0 },
    rows:         { type: mongoose.Schema.Types.Mixed, default: [] },
    entries:      { type: mongoose.Schema.Types.Mixed, default: [] },
    totalAmount:  { type: Number, default: 0 },
    notes:        { type: String, default: "" },
    paymentMethod:{ type: String, default: "cash" },
    bankName:     { type: String, default: "" },
    isPartial:    { type: Boolean, default: false },
    paidAmount:   { type: Number, default: 0 },
    remainingAmount: { type: Number, default: 0 },
    settlement:   { type: String, default: "full" },
    accountId:    { type: String, default: "" },
    accountName:  { type: String, default: "" },
    createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model("Purchase", purchaseSchema);
