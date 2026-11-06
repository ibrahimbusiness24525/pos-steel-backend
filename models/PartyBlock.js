const mongoose = require("mongoose");

const partyBlockSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["supplier", "customer"], required: true },
    nameKey: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

partyBlockSchema.index({ adminId: 1, type: 1, nameKey: 1 }, { unique: true });

module.exports = mongoose.model("PartyBlock", partyBlockSchema);
