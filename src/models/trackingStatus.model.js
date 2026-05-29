import mongoose from "mongoose";

const trackingStatusSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    lastHeartbeatAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastLocationAt: {
      type: Date,
      default: null,
    },
    lastKnownLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      accuracy: { type: Number, default: null },
    },
    locationEnabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    locationOffAt: {
      type: Date,
      default: null,
    },
    lastLocationOffReason: {
      type: String,
      default: "",
      trim: true,
    },
    lastLocationOffAlertAt: {
      type: Date,
      default: null,
    },
    lastNoSignalAlertAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

export default mongoose.model("TrackingStatus", trackingStatusSchema);
