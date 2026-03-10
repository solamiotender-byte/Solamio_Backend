import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    date: {
      type: Date,
      required: true,
      index: true
    },
    punchInTime: {
      type: Date
    },
    punchOutTime: {
      type: Date
    },
    workingHours: {
      type: Number, // Store in minutes
      default: 0
    },
    status: {
      type: String,
      enum: ["present", "absent", "half-day", "late", "on-leave"],
      default: "present"
    },
    notes: {
      type: String,
      trim: true
    }
  },
  { timestamps: true }
);

// Virtual for formatted working hours
attendanceSchema.virtual('formattedWorkingHours').get(function() {
  if (!this.workingHours) return '00:00';
  const hours = Math.floor(this.workingHours / 60);
  const minutes = this.workingHours % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
});

// Calculate working hours before save
attendanceSchema.pre("save", function (next) {
  if (this.punchInTime && this.punchOutTime) {
    if (this.punchOutTime <= this.punchInTime) {
      return next(new Error("Punch-out time must be after punch-in time"));
    }
    
    // Calculate working hours in minutes
    const diffMs = this.punchOutTime - this.punchInTime;
    this.workingHours = Math.floor(diffMs / (1000 * 60));
    
    // Auto-determine status based on working hours
    if (this.workingHours < 240) { // Less than 4 hours = half-day
      this.status = "half-day";
    } else if (this.workingHours >= 240 && this.workingHours < 480) { 
      this.status = "present";
    }

    // Check for late arrival (punch in after 10:00 AM)
    const punchInHour = this.punchInTime.getHours();
    const punchInMinute = this.punchInTime.getMinutes();
    if (punchInHour > 10 || (punchInHour === 10 && punchInMinute > 0)) {
      this.status = "late";
    }
  }
  next();

});

export default mongoose.model("Attendance", attendanceSchema);