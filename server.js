require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const dns = require("dns");

dns.setServers(["1.1.1.1", "8.8.8.8"]);

// ── Auto-seed superadmin + admin after MongoDB connects ───────────────────────
const autoSeed = async () => {
  try {
    const User = require("./models/User");

    const superAdminEmail = "okiieestealpos@gmail.com";
    const existsSuperAdmin = await User.findOne({ email: superAdminEmail });
    if (!existsSuperAdmin) {
      await User.create({
        name: "Super Admin",
        email: superAdminEmail,
        password: "okiieesteal1122",
        role: "superadmin",
      });
      console.log("✅ Super Admin created! Email: " + superAdminEmail);
    } else {
      console.log("✅ Super Admin already exists");
    }

    const adminEmail = "admin@steelpos.com";
    const existsAdmin = await User.findOne({ email: adminEmail });
    if (!existsAdmin) {
      await User.create({
        name: "Admin",
        email: adminEmail,
        password: "admin123",
        role: "admin",
      });
      console.log("✅ Default Admin created! Email: " + adminEmail);
    } else {
      console.log("✅ Default Admin already exists");
    }

    const leftoverStaff = ["talhahashim835@gmail.com"];
    for (const email of leftoverStaff) {
      const leftover = await User.findOne({ email });
      if (!leftover || leftover.role === "superadmin") continue;
      if (leftover.role === "admin") {
        await User.deleteMany({ role: "staff", createdBy: leftover._id });
      }
      await User.deleteOne({ _id: leftover._id });
      console.log("Removed leftover user:", email);
    }

    const mainEmail = "talhahashim836@gmail.com";
    let mainAdmin = await User.findOne({ email: mainEmail });
    if (!mainAdmin) {
      const Product = require("./models/Product");
      const Sale = require("./models/Sale");
      const existing = await User.find({ role: { $in: ["admin", "superadmin"] } }).select("_id");
      const known = new Set(existing.map((a) => String(a._id)));
      const fromProducts = (await Product.distinct("adminId")).map(String).filter(Boolean);
      const fromSales = (await Sale.distinct("adminId")).map(String).filter(Boolean);
      const orphans = [...new Set([...fromProducts, ...fromSales])].filter((id) => id && id !== "undefined" && !known.has(id));
      let restoreId = null;
      if (orphans.length === 1) restoreId = orphans[0];
      else if (orphans.length > 1) {
        let best = orphans[0];
        let bestN = -1;
        for (const id of orphans) {
          const n = await Product.countDocuments({ adminId: id });
          if (n > bestN) { bestN = n; best = id; }
        }
        restoreId = best;
      }
      const payload = {
        name: "Talha Hashim",
        email: mainEmail,
        password: "talhahashim123",
        role: "admin",
        businessName: "",
      };
      if (restoreId && mongoose.Types.ObjectId.isValid(restoreId)) {
        payload._id = restoreId;
      }
      mainAdmin = await User.create(payload);
      console.log("✅ Restored main admin:", mainEmail, restoreId ? `(shop id ${restoreId})` : "(new id)");
    }
  } catch (err) {
    console.error("❌ Auto-seed error:", err.message);
  }
};

mongoose.connection.once("open", () => {
  autoSeed();
});

connectDB();

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: function (origin, callback) {
    // No origin = Postman / mobile / curl — allow
    if (!origin) return callback(null, true);

    // Localhost / 127.0.0.1 allow karo (local dev)
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // LAN IP allow karo
    if (/^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // Koi bhi HTTPS origin allow karo (Vercel, Netlify, Railway frontend, etc.)
    if (/^https:\/\//.test(origin)) {
      return callback(null, true);
    }

    console.warn("⚠️  CORS blocked origin:", origin);
    callback(new Error("CORS not allowed: " + origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// OPTIONS preflight — sab routes ke liye
app.options("*", cors());

app.use(express.json({ limit: "8mb" }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth",       require("./routes/auth"));
app.use("/api/products",   require("./routes/products"));
app.use("/api/purchases",  require("./routes/purchases"));
app.use("/api/sales",      require("./routes/sales"));
app.use("/api/staff",      require("./routes/staff"));
app.use("/api/accounts",   require("./routes/accounts"));
app.use("/api/superadmin", require("./routes/superadmin"));
app.use("/api/translate",  require("./routes/translate"));
app.use("/api/loaders",    require("./routes/loaders"));
app.use("/api/parties",           require("./routes/parties"));
app.use("/api/sale-returns",      require("./routes/saleReturns"));
app.use("/api/purchase-returns",  require("./routes/purchaseReturns"));
app.use("/api/expenses",          require("./routes/expenses"));

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "SteelPOS Backend Running ✅", port: process.env.PORT || 5000 }));

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Internal server error" });
});

// ── Start server on 0.0.0.0 (sab interfaces pe listen) ───────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("─────────────────────────────────────────");
  console.log(`🚀 SteelPOS Backend running!`);
  console.log(`🌐 Local:   http://localhost:${PORT}`);
  console.log(`🌐 Network: http://127.0.0.1:${PORT}`);
  console.log(`✅ CORS:    All HTTPS origins allowed`);
  console.log("─────────────────────────────────────────");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} already in use!`);
    console.error(`   Task Manager mein node.js process band karo, phir dobara chalaao.`);
    process.exit(1);
  } else {
    console.error("❌ Server error:", err.message);
  }
});