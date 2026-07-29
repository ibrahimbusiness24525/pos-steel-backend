const mongoose = require("mongoose");

const loaderSchema = new mongoose.Schema(
  {
    name:       { type: String, required: true, trim: true },
    phone:      { type: String, default: "", trim: true },
    details:    { type: String, default: "", trim: true },
    defaultFee: { type: Number, default: 0 },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Loader", loaderSchema);
