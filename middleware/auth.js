const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token) {
    return res.status(401).json({ success: false, message: "Not authorized, no token" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Session expired, please login again" });
    }

    if (req.user.role === "staff") {
      if (!req.user.createdBy) {
        return res.status(401).json({ success: false, message: "Staff account is no longer linked. Please contact admin." });
      }
      const admin = await User.findById(req.user.createdBy).select("_id");
      if (!admin) {
        await User.deleteOne({ _id: req.user._id });
        return res.status(401).json({ success: false, message: "Shop account was deleted. Staff login is closed." });
      }
    }

    // adminId = agar user admin hai to uska apna ID, agar staff hai to uska createdBy (admin ka ID)
    if (req.user.role === "admin") {
      req.adminId = req.user._id;
    } else if (req.user.role === "staff" && req.user.createdBy) {
      req.adminId = req.user.createdBy;
    } else {
      req.adminId = req.user._id; // fallback
    }

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Token invalid or expired" });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user && (req.user.role === "admin" || req.user.role === "superadmin")) return next();
  return res.status(403).json({ success: false, message: "Admin access required" });
};

const superAdminOnly = (req, res, next) => {
  if (req.user && req.user.role === "superadmin") return next();
  return res.status(403).json({ success: false, message: "Super Admin access required" });
};

module.exports = { protect, adminOnly, superAdminOnly };
