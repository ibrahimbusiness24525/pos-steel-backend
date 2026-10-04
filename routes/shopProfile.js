const express = require("express");
const router = express.Router();
const ShopProfile = require("../models/ShopProfile");
const { protect, adminOnly } = require("../middleware/auth");

const emptyProfile = () => ({
  shopName: "",
  shopNameUr: "",
  address: "",
  addressUr: "",
  logoBase64: "",
  owners: [{ name: "", nameUr: "", phone: "" }],
});

const normalizeOwners = (owners) => {
  const list = (Array.isArray(owners) ? owners : [])
    .slice(0, 3)
    .map((o) => ({
      name: String(o?.name || "").trim(),
      nameUr: String(o?.nameUr || "").trim(),
      phone: String(o?.phone || "").trim(),
    }));
  return list.length ? list : emptyProfile().owners;
};

const toClient = (doc) => {
  if (!doc) return emptyProfile();
  return {
    shopName: doc.shopName || "",
    shopNameUr: doc.shopNameUr || "",
    address: doc.address || "",
    addressUr: doc.addressUr || "",
    logoBase64: doc.logoBase64 || "",
    owners: normalizeOwners(doc.owners),
  };
};

router.use(protect);

/** GET /api/shop-profile — admin or staff (staff sees their admin's profile) */
router.get("/", async (req, res) => {
  try {
    const doc = await ShopProfile.findOne({ adminId: req.adminId });
    res.json({ success: true, profile: toClient(doc) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** PUT /api/shop-profile — admin only (each admin has their own shop branding) */
router.put("/", adminOnly, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Only shop admin can edit shop profile" });
    }
    const body = req.body || {};
    const payload = {
      shopName: String(body.shopName || "").trim(),
      shopNameUr: String(body.shopNameUr || "").trim(),
      address: String(body.address || "").trim(),
      addressUr: String(body.addressUr || "").trim(),
      logoBase64: String(body.logoBase64 || ""),
      owners: normalizeOwners(body.owners),
    };
    if (payload.logoBase64 && payload.logoBase64.length > 6_000_000) {
      return res.status(400).json({ success: false, message: "Logo is too large. Use a smaller image." });
    }
    const doc = await ShopProfile.findOneAndUpdate(
      { adminId: req.adminId },
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, profile: toClient(doc) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
