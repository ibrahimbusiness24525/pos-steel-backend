const mongoose = require("mongoose");

const ownerSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    nameUr: { type: String, default: "" },
    phone: { type: String, default: "" },
  },
  { _id: false }
);

const shopProfileSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    shopName: { type: String, default: "" },
    shopNameUr: { type: String, default: "" },
    address: { type: String, default: "" },
    addressUr: { type: String, default: "" },
    logoBase64: { type: String, default: "" },
    owners: {
      type: [ownerSchema],
      default: () => [{ name: "", nameUr: "", phone: "" }],
      validate: {
        validator(v) {
          return Array.isArray(v) && v.length >= 1 && v.length <= 3;
        },
        message: "Owners must be 1–3",
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ShopProfile", shopProfileSchema);
