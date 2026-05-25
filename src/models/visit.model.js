// models/visit.model.js
import mongoose from "mongoose";

const locationSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  { _id: false }
);

const photoSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
);

const routeInfoSchema = new mongoose.Schema(
  {
    startPoint: { type: mongoose.Schema.Types.ObjectId, ref: "Visit" },
    distanceKm: Number,
    durationMinutes: Number,
    durationText: String,
    distanceText: String,
    polyline: String,
    path: [locationSchema]
  },
  { _id: false }
);

const travelInfoSchema = new mongoose.Schema(
  {
    distanceKm: Number,
    distanceText: String,
    durationMinutes: Number,
    durationText: String,
    durationSeconds: Number,
    isEstimated: { type: Boolean, default: false }
  },
  { _id: false }
);

const visitSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    attendance: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendance",
      required: true,
      index: true
    },

    locationName: {
      type: String,
      required: true,
      trim: true
    },

    previousVisit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Visit",
      index: true
    },

    nextVisit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Visit"
    },
    
    coordinates: {
      type: locationSchema,
      required: true
    },
    
    isLeadCreate: {
      type: Boolean,
      default: false
    },
    
    // ADDED: Reference to lead created from this visit
    leadCreated: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      index: true,
      sparse: true // Allows null values while maintaining index
    },
    
    address: {
      type: String,
    },
    
    contactPerson: {
      type: String,
    },
    
    phone: {
      type: String,
    },
    
    email: {
      type: String,
    },
    
    status: {
      type: String,
      enum: ["InProgress", "Completed", "Cancelled"],
      default: "InProgress"
    },
    
    visitDate: {
      type: Date,
      default: Date.now,
      index: true
    },

    checkInTime: Date,
    checkOutTime: Date,

    timeSpentMinutes: {
      type: Number,
      default: 0
    },

    distanceFromPreviousKm: {
      type: Number,
      default: 0
    },

    totalDistanceTillNowKm: {
      type: Number,
      default: 0
    },

    travelTimeMinutes: {
      type: Number,
      default: 0
    },

    photos: [photoSchema],

    remarks: {
      type: String,
      trim: true
    },

    travelInfo: travelInfoSchema,
    routeToVisit: routeInfoSchema,
    
    verified: {
      type: Boolean,
      default: false
    },
    
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },

    verifiedAt: Date
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

/* ================= INDEXES ================= */

visitSchema.index({ user: 1, createdAt: -1 });
visitSchema.index({ user: 1, status: 1 });
visitSchema.index({ isLeadCreate: 1, createdAt: -1 }); // For filtering leads created from visits

/* ================= VIRTUALS ================= */

visitSchema.virtual("duration").get(function () {
  if (this.checkInTime && this.checkOutTime) {
    return Math.round((this.checkOutTime - this.checkInTime) / 60000);
  }
  return this.timeSpentMinutes || 0;
});

visitSchema.virtual("isComplete").get(function () {
  return this.status === "Completed";
});

visitSchema.virtual("hasLead").get(function () {
  return !!this.leadCreated;
});

/* ================= METHODS ================= */

visitSchema.methods.complete = async function () {
  this.status = "Completed";
  this.checkOutTime = new Date();

  if (this.checkInTime) {
    this.timeSpentMinutes = Math.round(
      (this.checkOutTime - this.checkInTime) / 60000
    );
  }

  await this.save();
  return this;
};

visitSchema.methods.cancel = async function (reason) {
  this.status = "Cancelled";
  this.remarks = reason || this.remarks;
  await this.save();
  return this;
};

visitSchema.methods.associateLead = async function (leadId) {
  this.leadCreated = leadId;
  await this.save();
  return this;
};

/* ================= STATICS ================= */

visitSchema.statics.findByUser = function (userId, limit = 10) {
  return this.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("leadCreated", "name email phone status");
};

visitSchema.statics.findWithLeads = function (filters = {}) {
  return this.find({ ...filters, isLeadCreate: true })
    .populate("leadCreated")
    .populate("user", "firstName lastName email")
    .sort({ createdAt: -1 });
};

visitSchema.statics.getVisitsWithLeadStats = async function (userId, startDate, endDate) {
  const match = { user: userId };
  
  if (startDate || endDate) {
    match.visitDate = {};
    if (startDate) match.visitDate.$gte = new Date(startDate);
    if (endDate) match.visitDate.$lte = new Date(endDate);
  }

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalVisits: { $sum: 1 },
        totalLeads: { 
          $sum: { $cond: [{ $eq: ["$isLeadCreate", true] }, 1, 0] } 
        },
        completedVisits: {
          $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] }
        },
        totalDistance: { $sum: "$totalDistanceTillNowKm" },
        avgTravelTime: { $avg: "$travelTimeMinutes" }
      }
    }
  ]);
};

const Visit = mongoose.model("Visit", visitSchema);

const cleanupLegacyVisitGeoIndex = async () => {
  try {
    const indexes = await Visit.collection.indexes();
    const hasLegacyGeoIndex = indexes.some((index) => index?.name === "coordinates_2dsphere");

    if (hasLegacyGeoIndex) {
      await Visit.collection.dropIndex("coordinates_2dsphere");
      console.warn('Dropped legacy Visit index "coordinates_2dsphere" because visits store coordinates as { lat, lng }, not GeoJSON.');
    }
  } catch (error) {
    // Ignore namespace/index-not-found cases; log anything else for visibility.
    if (!["NamespaceNotFound", "IndexNotFound"].includes(error?.codeName)) {
      console.error("Failed to clean up legacy Visit geo index:", error.message);
    }
  }
};

if (mongoose.connection.readyState === 1) {
  cleanupLegacyVisitGeoIndex();
} else {
  mongoose.connection.once("open", cleanupLegacyVisitGeoIndex);
}

export default Visit;
