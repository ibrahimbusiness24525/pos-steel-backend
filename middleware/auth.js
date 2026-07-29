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
