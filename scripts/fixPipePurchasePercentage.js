require("dotenv").config();
const mongoose = require("mongoose");
const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);
const Product  = require("../models/Product");
const Purchase = require("../models/Purchase");

const APPLY = process.argv.includes("--apply");

const computeWeightedPct = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let weightedSum = 0;
  let totalRowQty = 0;
  rows.forEach((row) => {
    const rowQty = Number(row.quantity) || 0;
    if (
      row.purchasePercentage !== undefined &&
      row.purchasePercentage !== null &&
      row.purchasePercentage !== "" &&
      rowQty > 0
    ) {
      const rowPct = Number(row.purchasePercentage) || 0;
      weightedSum += rowQty * rowPct;
      totalRowQty += rowQty;
    }
  });
  if (totalRowQty === 0) return null;
  return weightedSum / totalRowQty;
};

const purchaseTimestamp = (p) => {
  if (p.date) {
    const parts = String(p.date).split(/[-\/]/);
    if (parts.length === 3) {
      const iso = parts[0].length === 4
        ? p.date
        : `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
      const t = new Date(iso).getTime();
      if (!isNaN(t)) return t;
    }
  }
  return new Date(p.createdAt).getTime() || 0;
};

const run = async () => {
  console.log(APPLY ? "RUNNING IN APPLY MODE - DB WILL BE UPDATED\n" : "DRY RUN - no changes will be saved (pass --apply to write changes)\n");

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB\n");

  const pipeProducts = await Product.find({ category: { $in: ["Pipe", "pipe"] } });
  console.log(`Found ${pipeProducts.length} Pipe product(s)\n`);

  let changedCount = 0;
  let uncertainCount = 0;

  for (const product of pipeProducts) {
    const adminFilter = { product: product._id };
    if (product.adminId) adminFilter.adminId = product.adminId;

    const purchasesForProduct = await Purchase.find(adminFilter).sort({ createdAt: -1 });

    if (purchasesForProduct.length === 0) {
      console.log(`SKIP: ${product.name} - no purchase history found, leaving as-is`);
      continue;
    }

    purchasesForProduct.sort((a, b) => purchaseTimestamp(b) - purchaseTimestamp(a));
    const latestPurchase = purchasesForProduct[0];

    const rows = Array.isArray(latestPurchase.rows) ? latestPurchase.rows : [];
    const correctPct = computeWeightedPct(rows);

    if (correctPct === null) {
      console.log(`UNCERTAIN: ${product.name} - could not compute % from latest purchase (invoice: ${latestPurchase.invoice || latestPurchase.invoiceNum || latestPurchase._id})`);
      uncertainCount++;
      continue;
    }

    const currentPct = Number(product.purchasePercentage) || 0;
    const diff = Math.abs(correctPct - currentPct);

    if (diff < 0.0001) {
      console.log(`OK: ${product.name} - already correct (${currentPct}%)`);
      continue;
    }

    console.log(`FIX: ${product.name} - current: ${currentPct}%  ->  correct: ${correctPct.toFixed(4)}%  (from invoice ${latestPurchase.invoice || latestPurchase.invoiceNum || latestPurchase._id})`);
    changedCount++;

    if (APPLY) {
      await Product.findByIdAndUpdate(product._id, { $set: { purchasePercentage: correctPct } });
    }
  }

  console.log(`\n-----------------------------`);
  console.log(`Total Pipe products: ${pipeProducts.length}`);
  console.log(`Needing correction:  ${changedCount}`);
  console.log(`Uncertain (skipped): ${uncertainCount}`);
  console.log(APPLY ? "Changes have been written to the database." : "This was a dry run - nothing was changed. Re-run with --apply to write these changes.");

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
