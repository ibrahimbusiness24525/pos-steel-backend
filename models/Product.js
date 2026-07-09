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
      enum: ["feet", "meter", "piece", "kg", "set", "bundle", "ton"],
      default: "piece",
    },
    price: { type: Number, required: true, default: 0 },
    purchasePrice: { type: Number, default: 0 },
    purchasePercentage: { type: Number, default: 0 },
    stock: { type: Number, required: true, default: 0 },
    lowStockThreshold: { type: Number, default: 10 },
  },
  { timestamps: true, strict: false }
);

module.exports = mongoose.model("Product", productSchema);
