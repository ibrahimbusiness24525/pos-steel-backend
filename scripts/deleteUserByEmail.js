require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

const emails = process.argv.slice(2).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean);
if (!emails.length) {
  console.error("Usage: node scripts/deleteUserByEmail.js email@example.com");
  process.exit(1);
}

(async () => {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI missing");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  for (const email of emails) {
    const user = await User.findOne({ email });
    if (!user) {
      console.log(`Not found: ${email}`);
      continue;
    }
    let staffDeleted = 0;
    if (user.role === "admin") {
      const r = await User.deleteMany({ role: "staff", createdBy: user._id });
      staffDeleted = r.deletedCount || 0;
    }
    await User.deleteOne({ _id: user._id });
    console.log(`Deleted ${user.role} ${email}${staffDeleted ? ` + ${staffDeleted} staff` : ""}`);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
