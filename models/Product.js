const mongoose = require("mongoose");

const PRODUCT_UNITS = ["feet", "meter", "piece", "kg", "set", "bundle", "ton", "box", "dozen", "pair", "packet", "gram", "liter", "ml", "carton"];
const UNIT_ALIASES = {
  pcs: "piece", pc: "piece", pieces: "piece",
  doz: "dozen", dozens: "dozen",
  ft: "feet", foot: "feet",
  m: "meter", metres: "meter", meters: "meter",
  kgs: "kg", kilo: "kg", kilogram: "kg", kilograms: "kg",
  grams: "gram", gm: "gram",
  litre: "liter", litres: "liter", liters: "liter",
  milliliter: "ml", millilitre: "ml", milliliters: "ml", millilitres: "ml",
};

function coerceUnit(v) {
  const s = String(v == null ? "piece" : v).trim().toLowerCase();
  if (!s) return "piece";
  if (PRODUCT_UNITS.includes(s)) return s;
  return UNIT_ALIASES[s] || "piece";
}

const productSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["Pipe", "Chader", "Net", "Hardware", "Custom", "pipe", "chader", "net", "hardware", "custom"],
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
      default: "piece",
      set: coerceUnit,
    },
    stockUnit: { type: String, default: "" },
    price: { type: Number, required: true, default: 0 },
    purchasePrice: { type: Number, default: 0 },
    purchasePercentage: { type: Number, default: 0 },
    stock: { type: Number, required: true, default: 0 },
    lowStockThreshold: { type: Number, default: 10 },
    barcode: { type: String, default: "" },
    brand: { type: String, default: "" },
    hwCategory: { type: String, default: "" },
    subCategory: { type: String, default: "" },
    group: { type: String, default: "" },
    location: { type: String, default: "" },
    notes: { type: String, default: "" },
    photo: { type: String, default: "" },
    suppliers: { type: [{ name: String, id: String, isMain: Boolean }], default: [] },
    lastInvoice: { type: String, default: "" },
    lastPurchaseDate: { type: String, default: "" },
    lastSupplier: { type: String, default: "" },
    secondaryUnit: { type: String, default: "" },
    tax: { type: String, default: "" },
    taxInclusive: { type: Boolean, default: true },
    isComposite: { type: Boolean, default: false },
    variations: { type: [String], default: [] },
  },
  { timestamps: true, strict: false }
);

productSchema.path("unit").enumValues = [];
productSchema.path("unit").validators = (productSchema.path("unit").validators || []).filter(
  (v) => v.type !== "enum"
);

productSchema.pre("save", function (next) {
  if (this.unit) this.unit = coerceUnit(this.unit);
  if (this.stockUnit) this.stockUnit = coerceUnit(this.stockUnit);
  next();
});

const Product = mongoose.model("Product", productSchema);
Product.coerceUnit = coerceUnit;
module.exports = Product;
