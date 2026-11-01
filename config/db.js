const mongoose = require("mongoose");

let connecting = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connecting) return connecting;
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI missing");
    return null;
  }
  connecting = mongoose
    .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 })
    .then((conn) => {
      console.log(`MongoDB connected: ${conn.connection.host}`);
      return conn.connection;
    })
    .catch((err) => {
      connecting = null;
      console.error("MongoDB connection error:", err.message);
      if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
        setTimeout(connectDB, 5000);
      }
      throw err;
    });
  return connecting;
};

module.exports = connectDB;