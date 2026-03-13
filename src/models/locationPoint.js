// models/locationPoint.js
import mongoose from "mongoose";

const locationPointSchema = new mongoose.Schema(
  {
    salesmanId: {
      type:  mongoose.Schema.Types.ObjectId,
      ref:   "User",
      index: true,
    },
    date: {
      type:  String, // "YYYY-MM-DD"
      index: true,
    },
    lat:      { type: Number, required: true },
    lng:      { type: Number, required: true },
    speed:    { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    recordedAt: {
      type:    Date,
      default: Date.now,
      index:   true,
    },
  },
  { timestamps: false }
);

// ✅ FIX: compound index for the most common query pattern
//         (fetch all points for a salesman on a given date).
//         Without this, Mongo had to scan two separate single-field indexes.
locationPointSchema.index({ salesmanId: 1, date: 1 });

// TTL index — auto-delete raw GPS points after 90 days to keep the collection lean.
// Remove this if you need longer history.
locationPointSchema.index(
  { recordedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90 }
);

export default mongoose.model("LocationPoint", locationPointSchema);