const mongoose = require("mongoose");

const expenseTypeSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    name: { type: String, trim: true, required: true },
    key: { type: String, trim: true },
    removed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

expenseTypeSchema.index({ adminId: 1, name: 1 }, { unique: true });
expenseTypeSchema.index({ adminId: 1, key: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("ExpenseType", expenseTypeSchema);
