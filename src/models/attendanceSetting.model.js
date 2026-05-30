import mongoose from "mongoose";

const attendanceSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    officePunchInTime: { type: String, default: "08:00" },
    officePunchOutTime: { type: String, default: "22:00" },
    blockEarlyPunchIn: { type: Boolean, default: true },
    autoPunchOutEnabled: { type: Boolean, default: true },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

export default mongoose.model("AttendanceSetting", attendanceSettingSchema);
