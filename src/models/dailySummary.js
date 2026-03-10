import mongoose from "mongoose";

const dailySummarySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    date: {
      type: String,
      required: true
    },
    totalVisits: {
      type: Number,
      default: 0
    },
    totalKm: {
      type: Number,
      default: 0
    },
    firstVisitTime: {
      type: Date,
      default: null
    },
    lastVisitTime: {
      type: Date,
      default: null
    },
    locations: [{
      lat: Number,
      lng: Number,
      locationName: String,
      visitedAt: Date,
      kmFromPrevious: Number
    }]
  },
  { timestamps: true }
);

// Compound index for user+date (unique per user per day)
dailySummarySchema.index({ user: 1, date: 1 }, { unique: true });

export default mongoose.model("DailySummary", dailySummarySchema);