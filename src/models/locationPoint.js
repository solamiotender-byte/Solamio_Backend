// models/locationPoint.js
import mongoose from "mongoose";

const locationPointSchema = new mongoose.Schema(
  {
    salesmanId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
      index:    true,
    },

    lat:      { type: Number, required: true },
    lng:      { type: Number, required: true },
    accuracy: { type: Number, default: 0 },
    speed:    { type: Number, default: 0 },

    // ── Distance from the previous GPS point in kilometres ────────────────
    // Calculated server-side using Haversine formula.
    // SUM of all distanceFromPrevious for a salesman+date = total km that day.
    distanceFromPrevious: { type: Number, default: 0 },

    // Date string "YYYY-MM-DD" for easy day-based queries
    date: { type: String, index: true },

    // Actual GPS timestamp from device
    recordedAt: { type: Date, default: Date.now, index: true },

    // TTL — MongoDB auto-deletes this document 24h after expiresAt
    expiresAt: { type: Date, expires: 0 },
  },
  { timestamps: true }
);

locationPointSchema.index({ salesmanId: 1, date: 1 });
locationPointSchema.index({ salesmanId: 1, recordedAt: 1 });
const LocationPoint = mongoose.model("LocationPoint", locationPointSchema);
export default LocationPoint;
