import mongoose from "mongoose";

const batteryLogSchema = new mongoose.Schema(
  {
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    isCharging: { type: Boolean, default: false },
    deviceInfo: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model("BatteryLog", batteryLogSchema);