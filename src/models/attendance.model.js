import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        date: {
            type: Date,
            required: true
        },
        punchIn: {
            time: Date,
            location: {
                lat: Number,
                lng: Number
            },
            address: String,
        },
        punchOut: {
            time: Date,
            location: {
                lat: Number,
                lng: Number
            },
            address: String,
        },
        status: {
            type: String,
            enum: ["present", "absent", "half-day", "holiday", "leave"],
            default: "present"
        },
        workHours: {
            type: Number,
            default: 0
        },
        overtime: {
            type: Number,
            default: 0
        },
        remarks: String,
        metadata: {
            type: Map,
            of: mongoose.Schema.Types.Mixed
        }
    },
    {
        timestamps: true
    }
);

// Indexes
attendanceSchema.index({ user: 1, date: -1 });
attendanceSchema.index({ status: 1 });
attendanceSchema.index({ 'punchIn.time': -1 });

export default mongoose.model("Attendance", attendanceSchema);