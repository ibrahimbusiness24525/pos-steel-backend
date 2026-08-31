const mongoose = require("mongoose");

const partySchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    type: { type: String, enum: ["supplier", "customer"], required: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },
    partyType: { type: String, default: "", trim: true },
    address: { type: String, default: "" },
    notes: { type: String, default: "" },
    openingBalance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

partySchema.index({ adminId: 1, type: 1, name: 1 });

module.exports = mongoose.model("Party", partySchema);
