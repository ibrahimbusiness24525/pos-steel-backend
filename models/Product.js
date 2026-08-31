const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["Pipe", "Chader", "Net", "Hardware", "Custom", "pipe", "chader", "net", "hardware", "custom"],
      required: true,
    },
    pipeType: { type: String, enum: ["round", "square", ""], default: "" },
    subType: { type: String, default: "" },
    inches: { type: String, default: "" },
    pipeInch: { type: String, default: "" },
    pipeSubType: { type: String, default: "" },
    gauge: { type: String, default: "" },
    length: { type: Number, default: null },
    weightPerPiece: { type: Number, default: null },
    chaderType: { type: String, default: "" },
    unit: {
      type: String,
      enum: ["feet", "meter", "piece", "kg", "set", "bundle", "ton", "box", "dozen", "pair", "packet"],
      default: "piece",
    },
    price: { type: Number, required: true, default: 0 },
    purchasePrice: { type: Number, default: 0 },
    purchasePercentage: { type: Number, default: 0 },
    stock: { type: Number, required: true, default: 0 },
    lowStockThreshold: { type: Number, default: 10 },
    barcode: { type: String, default: "" },
    brand: { type: String, default: "" },
    subCategory: { type: String, default: "" },
    group: { type: String, default: "" },
    location: { type: String, default: "" },
    notes: { type: String, default: "" },
    photo: { type: String, default: "" },
    suppliers: { type: [{ name: String, id: String, isMain: Boolean }], default: [] },
    secondaryUnit: { type: String, default: "" },
    tax: { type: String, default: "" },
    taxInclusive: { type: Boolean, default: true },
    isComposite: { type: Boolean, default: false },
    variations: { type: [String], default: [] },
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model("Product", productSchema);
