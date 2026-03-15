// models/locationPoint.js
import mongoose from "mongoose";

const locationPointSchema = new mongoose.Schema(
  {
    salesmanId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,   // ✅ FIX: was missing — orphaned points are now impossible
      index:    true,
    },
    date: {
      type:     String,  // "YYYY-MM-DD"
      required: true,    // ✅ FIX: was missing — needed for compound index queries
      index:    true,
    },
    lat: {
      type:     Number,
      required: true,
      min:      -90,     // ✅ FIX: validate real lat range
      max:      90,
    },
    lng: {
      type:     Number,
      required: true,
      min:      -180,    // ✅ FIX: validate real lng range
      max:      180,
    },
    speed: {
      type:    Number,
      default: 0,
      min:     0,
    },
    accuracy: {
      type:    Number,
      default: 0,
      min:     0,
    },
    recordedAt: {
      type:    Date,
      default: Date.now,
      index:   true,
    },
  },
  { timestamps: false }
);

// ✅ Compound index for most common query: all points for a salesman on a date
locationPointSchema.index({ salesmanId: 1, date: 1 });

// ✅ TTL index — auto-delete raw GPS points after 90 days
locationPointSchema.index(
  { recordedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90 }
);

export default mongoose.model("LocationPoint", locationPointSchema);