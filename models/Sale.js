const mongoose = require("mongoose");

const saleSchema = new mongoose.Schema(
  {
    adminId:         { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    invoiceNum:      { type: String, default: "" },
    invoice:         { type: String, default: "" },
    customer:        { type: String, trim: true, default: "" },
    date:            { type: String, default: "" },
    product:         { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    productName:     { type: String, default: "" },
    productPrice:    { type: Number, default: 0 },
    category:        { type: String, default: "" },
    qty:             { type: Number, default: 0 },
    rate:            { type: Number, default: 0 },
    total:           { type: Number, default: 0 },
    grandTotal:      { type: Number, default: 0 },
    rows:            { type: mongoose.Schema.Types.Mixed, default: [] },
    items:           { type: mongoose.Schema.Types.Mixed, default: [] },
    // saleItems: clean [{ productId, qty }] list — ONE entry per product sold in this
    // sale (billing/multi-product sales). Used for accurate stock check/deduct per product.
    saleItems:       { type: mongoose.Schema.Types.Mixed, default: [] },
    paymentMethod:   { type: String, default: "cash" },
    bankName:        { type: String, default: "" },
    loaderName:      { type: String, default: "" },
    loaderFee:       { type: Number, default: 0 },
    // Chader category "binding mazdori" (binding labour charge) — works just like
    // loaderFee: added on top of the products total, charged to the customer, and
    // excluded from shop revenue/profit since it's a pass-through labour cost.
    bindingFee:      { type: Number, default: 0 },
    isPartial:       { type: Boolean, default: false },
    paidAmount:      { type: Number, default: 0 },
    remainingAmount: { type: Number, default: 0 },
    totalAmount:     { type: Number, default: 0 },
    notes:           { type: String, default: "" },
    createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model("Sale", saleSchema);
