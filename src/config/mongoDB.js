import mongoose from "mongoose";
import dotenv from "dotenv";
import LocationPoint from "../models/locationPoint.js";

dotenv.config();

const mongoUri =
  process.env.MONGO_URL ||
  process.env.MONGO_URI ||
  process.env.MONGODB_URI;

const connectDB = async () => {
  try {
    if (!mongoUri) {
      throw new Error(
        "MongoDB URI is missing. Set MONGO_URL, MONGO_URI, or MONGODB_URI in C:\\360Solar\\backend\\solar_backend\\.env"
      );
    }

    await mongoose.connect(mongoUri);

    try {
      await LocationPoint.collection.dropIndex("expiresAt_1");
      console.log("Removed legacy TTL index from location points");
    } catch (error) {
      if (error?.codeName !== "IndexNotFound") {
        console.warn("Failed to remove legacy location TTL index:", error.message);
      }
    }
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

export default connectDB;
