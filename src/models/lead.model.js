  // models/Lead.js
  import mongoose from "mongoose";

  const LeadSchema = new mongoose.Schema(
    {
      /* 🔹 Basic Info */
      firstName: { type: String, trim: true, default: null },
      lastName: { type: String, trim: true, default: null },
      email: {
        type: String,
        lowercase: true,
        trim: true,
        index: true,
        default: null,
        unique: true,
          sparse: true,
      },
      phone: { type: String, trim: true, index: true, default: null, unique: true ,  sparse: true, },

      /* 🔹 Visit */
      visitStatus: {
        type: String,
        enum: ["Scheduled", "Completed", "Cancelled", "Not Assigned"],
        default: "Not Assigned",
      },
      visitDate: { type: Date, default: null },
      visitTime: { type: String, default: null },
      visitLocation: { type: String, default: null },
      visitNotes: { type: String, default: null },

      /* 🔹 Registration */
      address: { type: String, default: null },
      city: { type: String, default: null },
      pincode: { type: String, default: null },
      solarRequirement: { type: String, default: null },
      dateOfRegistration: { type: Date, default: null },
      uploadDocument: { url: { type: String, default: null } },
      registrationStatus: {
        type: String,
        enum: ["pending", "completed","inProgress"],
        default: "inProgress",
      },
      registrationNotes: { type: String, default: null },

      /* 🔹 Bank Loan */
      loanAmount: { type: Number, default: null },
      bank: { type: String, default: null },
      branchName: { type: String, default: null },
      loanStatus: {
        type: String,
        enum: ["pending", "submitted", "rejected"],
        default: "pending",
      },
      loanApprovalDate: { type: Date, default: null },
      loanNotes: { type: String, default: null },

      /* 🔹 Documents */
      aadhaar: { url: { type: String, default: null } },
      panCard: { url: { type: String, default: null } },
      passbook: { url: { type: String, default: null } },
      otherDocuments: [
        {
          name: { type: String, default: null },
          url: { type: String, default: null },
        },
      ],
      documentNotes: { type: String, default: null },
      documentSubmissionDate: { type: Date, default: null },
      documentStatus: {
        type: String,
        enum: ["pending", "submitted", "rejected"],
        default: "pending",
      },

      /* 🔹 Bank at Pending */
      bankAtPendingStatus: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending",
      },
      reason: { type: String, default: null },
      bankAtPendingNotes: { type: String, default: null },
      bankAtPendingDate: { type: Date, default: null },

      /* 🔹 Disbursement */
      disbursementAmount: { type: Number, default: null },
      disbursementDate: { type: Date, default: null },
      disbursementStatus: {
        type: String,
        enum: ["pending", "completed", "cancelled"],
        default: "pending",
      },
      disbursementBankDetails: {
        bank: { type: String, default: null },
        branchName: { type: String, default: null },
      },
      disbursementNotes: { type: String, default: null },

      /* 🔹 Installation */
      installationStatus: {
        type: String,
        enum: [
          "installation_progress",
          "installation_completed",
          "sent_for_jee_verification",
          "load_Enhancement",
          "jee_verified",
          "meter_charge",
          "final_payment",
        ],
        default: "installation_progress",
      },
      installationDocument: {
        url: { type: String, default: null },
      },
      installationNotes: { type: String, default: null },

      /* 🔹 Assignment */
      assignedManager: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      assignedUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      /* 🔹 Lead Status */
      status: {
        type: String,
        enum: [
          "New",
          "Visit",
          "Registration",
          "Bank Loan Apply",
          "Document Submission",
          "Bank at Pending",
          "Disbursement",
          "Installation Completion",
          "Missed Leads",
        ],
        default: "New",
        index: true,
      },
      visit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Visit",
        index: true,
        sparse: true
      },
      /* 🔹 Timeline (Audit Trail – MOST IMPORTANT) */
      stageTimeline: [
        {
          stage: {
            type: String,
            enum: [
              "New",
              "Visit",
              "Registration",
              "Bank Loan Apply",
              "Document Submission",
              "Bank at Pending",
              "Disbursement",
              "Installation Completion",
              "Missed Leads",
            ],
            required: true,
          },
          notes: { type: String, default: null },
          updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
          },
          updatedRole: { type: String, default: null },
          updatedAt: { type: Date, default: Date.now },
        },
      ],

      /* 🔹 System */
      isDeleted: { type: Boolean, default: false },
      lastContactedAt: { type: Date, default: null },
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      createdAtIp: { type: String, default: null },
    },
    {
      timestamps: true,
      toJSON: { virtuals: true },
      toObject: { virtuals: true },
    }
  );

  /* 🔹 Virtuals */
  LeadSchema.virtual("fullName").get(function () {
    return `${this.firstName || ""} ${this.lastName || ""}`.trim();
  });

  LeadSchema.virtual("disbursementPercentage").get(function () {
    if (!this.loanAmount || !this.disbursementAmount) return 0;
    return Math.round((this.disbursementAmount / this.loanAmount) * 100);
  });

  LeadSchema.virtual("remainingAmount").get(function () {
    if (!this.loanAmount) return 0;
    return Math.max(0, this.loanAmount - (this.disbursementAmount || 0));
  });

  /* 🔹 Indexes */
  LeadSchema.index({ email: 1, phone: 1 });
  LeadSchema.index({ loanStatus: 1 });
  LeadSchema.index({ disbursementStatus: 1 });
  LeadSchema.index({ createdAt: -1 });

  const Lead = mongoose.model("Lead", LeadSchema);
  export default Lead;
