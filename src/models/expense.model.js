import mongoose from "mongoose";


/* ================= Schema ================= */
const expenseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },

    category: {
      type: String,
      enum: [
        "Fuel",
        "Travel",
        "Food",
        "Accommodation",
        "Stationery",
        "Miscellaneous"
      ],
      required: true
    },

    amount: { type: Number, min: 0},

    expenseDate: { type: Date, default: Date.now },

    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending"
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: Date,
    rejectionReason: String,
    approverRemarks: { type: String },

    /* ===== Bill Attachment ===== */
    billAttachment: { type: String }, // URL to uploaded bill image
    location: {
      lat: Number,
      lng: Number,
      address: String
    },
    vehicleType: {
      type: String,
      enum: ["Bike", "Car", "None"],
      default: "None"
    },

    fuelType: {
      type: String,
      enum: ["Petrol", "Diesel", "CNG", "Electric", "None"],
      default: "None"
    },
    kilometersTraveled: { type: Number, default: 0, min: 0 },
    fuelRatePerKm: { type: Number, default: 0 }
  },
  { 
    timestamps: true,
    indexes: [
      { createdBy: 1, expenseDate: -1 },
      { status: 1 },
      { category: 1 },
      { createdAt: -1 }
    ]
  }
);


export default mongoose.model("Expense", expenseSchema);