import mongoose from "mongoose";

const locationPointSchema = new mongoose.Schema(
  {
    salesmanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true
    },
    date: {
      type: String,
      index: true
    },
    lat: Number,
    lng: Number,
    speed: Number,
    accuracy: Number,
    recordedAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  { timestamps: false }
);

export default mongoose.model("LocationPoint", locationPointSchema);