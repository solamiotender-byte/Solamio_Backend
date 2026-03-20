// services/lead.service.js
import fs from "fs";
import path from "path";
import csvParser from "csv-parser";
import * as XLSX from "xlsx";
import Lead from "../models/lead.model.js";
import User from "../models/user.model.js";
import { AppError, NotFoundError } from "../errors/customError.js";
import { Parser } from "json2csv";
import {
  getTeamPerformanceMetrics,
  getPersonalSummaryStatistics,
  getPersonalPerformance,
  getDashboardCharts,
  getTeamSummaryStatistics,
} from "../utils/common.js";
import { isValidEmail } from "../utils/emailValidation.js";
import { generateFullUrl } from '../utils/generateFullUrl.js'
import s3Client from "../config/aws.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";


/* -------------------------------------------------- */
/* Helper: Resolve file URL (S3 or Local)              */
/* -------------------------------------------------- */
const resolveFileUrl = (file) => {
  if (file.location) return file.location;
  if (file.filename) return generateFullUrl(file.filename);
  return null;
};


// Helper: Centralized error handler
const handleError = (err, defaultMsg = "Lead service error") => {
  if (err instanceof AppError || err instanceof NotFoundError) throw err;
  throw new AppError(err.message || defaultMsg, err.statusCode || 500);
};

// Get role-based lead visibility filter (FINAL VERSION)
export const getLeadVisibilityFilter = async (currentUser) => {
  if (!currentUser?.role) {
    throw new AppError("Invalid user role", 403);
  }

  /* ==========================
     HEAD OFFICE → ALL LEADS
  ========================== */
  if (currentUser.role === "Head_office") {
    return {}; // no restriction
  }

  /* ==========================
     ZSM → Own + ASM + TEAM
  ========================== */
  if (currentUser.role === "ZSM") {
    // ASMs under ZSM
    const asmIds = await User.find(
      { supervisor: currentUser._id, role: "ASM" },
      "_id"
    ).lean();

    // TEAM under ASMs
    const teamIds = await User.find(
      { supervisor: { $in: asmIds.map((u) => u._id) }, role: "TEAM" },
      "_id"
    ).lean();

    return {
      $or: [
        { assignedManager: currentUser._id },
        {
          assignedUser: {
            $in: [...asmIds.map((u) => u._id), ...teamIds.map((u) => u._id)],
          },
        },
        { createdBy: currentUser._id },
      ],
    };
  }

  /* ==========================
     ASM → Own + TEAM
  ========================== */
  if (currentUser.role === "ASM") {
    const teamIds = await User.find(
      { supervisor: currentUser._id, role: "TEAM" },
      "_id"
    ).lean();

    return {
      $or: [
        { assignedManager: currentUser._id },
        { assignedUser: { $in: teamIds.map((u) => u._id) } },
        { createdBy: currentUser._id },
      ],
    };
  }

  /* ==========================
     TEAM → OWN LEADS ONLY
  ========================== */
  if (currentUser.role === "TEAM") {
    return {
      $or: [{ assignedUser: currentUser._id }, { createdBy: currentUser._id }],
    };
  }

  throw new AppError("Unauthorized role access", 403);
};

// Stage-specific field validators
const getStageFields = (stage) => {
  const stageFields = {
    Visit: ["visitStatus", "visitDate", "visitTime", "visitLocation"],
    Registration: [
      "address",
      "city",
      "pincode",
      "registrationStatus",
      "solarRequirement",
      "dateOfRegistration",
    ],
    "Bank Loan Apply": [
      "loanAmount",
      "tenure",
      "bank",
      "branchName",
      "loanStatus",
      "loanApprovalDate",
    ],
    "Document Submission": [
      "aadhaar",
      "panCard",
      "passbook",
      "otherDocuments",
      "documentSubmissionDate",
    ],
    Disbursement: ["disbursementAmount", "disbursementDate"],
    "Installation Completion": ["installationDate", "installationStatus"],
    "Missed Leads": ["notes", "lastContactedAt"],
  };

  return stageFields[stage] || [];
};

// Validate stage-specific data
const validateStageData = (stage, data) => {
  const errors = [];
  const allowedFields = getStageFields(stage);
  const stageData = {};

  // Extract only allowed fields for this stage
  allowedFields.forEach((field) => {
    if (data[field] !== undefined) {
      stageData[field] = data[field];
    }
  });

  // Validate required fields based on stage
  if (stage === "Visit" && data.visitStatus === "Scheduled") {
    if (!data.visitDate)
      errors.push("visitDate is required for scheduled visits");
    if (!data.visitTime)
      errors.push("visitTime is required for scheduled visits");
  }

  if (stage === "Registration") {
    if (data.solarRequirement && data.solarRequirement.length > 500) {
      errors.push("solarRequirement must be less than 500 characters");
    }
  }

  if (stage === "Bank Loan Apply" && data.loanAmount) {
    if (data.loanAmount < 0) errors.push("loanAmount cannot be negative");
  }

  if (errors.length > 0) {
    throw new AppError(`Validation failed: ${errors.join(", ")}`, 400);
  }

  return stageData;
};


/* 🔹 CREATE LEAD */
export const createLeadService = async (data, currentUser) => {
  try {

    // Validate current user
    if (!currentUser || !currentUser._id) {
      throw new AppError("Invalid user", 400);
    }

    // 🔐 Email validation
    if (data.email && !isValidEmail(data.email)) {
      throw new AppError("Invalid or temporary email address", 400);
    }

    // Default status
    const status = data.status || "New";

    const leadData = {
      firstName: data.firstName?.trim() || null,
      lastName: data.lastName?.trim() || null,
      email: data.email?.trim().toLowerCase() || null,
      phone: data.phone?.trim() || null,
      source: data.source || "Website",
      status: status,
      createdBy: currentUser._id,

      stageTimeline: [
        {
          stage: status,
          notes: "Lead created",
          updatedBy: currentUser._id,
          updatedRole: currentUser.role,
          updatedAt: new Date(),
        },
      ],
    };

    /* =================================
       🔹 AUTO ASSIGN IF CREATOR = TEAM
    ================================= */

    if (currentUser.role === "TEAM") {
      leadData.assignedUser = currentUser._id;
      leadData.assignedManager = currentUser.supervisor; // ASM
    }

    /* =================================
       STAGE DATA
    ================================= */

    if (status) {
      const stageData = validateStageData(status, data);
      Object.assign(leadData, stageData);
    }

    const lead = new Lead(leadData);
    await lead.save();

    return await Lead.findById(lead._id)
      .populate("assignedManager", "firstName lastName email role")
      .populate("assignedUser", "firstName lastName email role")
      .populate("createdBy", "firstName lastName email role");

  } catch (err) {
    handleError(err, "Failed to create lead");
  }
};


export const getLeadsService = async (query, userId) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = "",
      status,
      stage,
      assignedTo,
      managerId,
      fromDate,
      toDate,
      sortBy = "createdAt",
      sortOrder = "desc",
      includeDeleted = false,
    } = query;

    const currentUser = await User.findById(userId);
    if (!currentUser) throw new AppError("User not found", 404);

    const skip = (page - 1) * limit;

    /* ===============================
       BASE VISIBILITY FILTER
    =============================== */
    const visibilityFilter = await getLeadVisibilityFilter(currentUser);

    // Remove isDeleted from visibilityFilter if includeDeleted is true
    let filter = { ...visibilityFilter };
    if (includeDeleted) {
      delete filter.isDeleted;
    }

    /* ===============================
       SEARCH
    =============================== */
    if (search.trim()) {
      const regex = { $regex: search.trim(), $options: "i" };

      filter.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { phone: regex },
        { address: regex },
        { city: regex },
      ];
    }

    /* ===============================
       STATUS / STAGE
    =============================== */
    if (status) filter.status = status;
    if (stage) filter.status = stage;

    /* ===============================
       ASSIGNED USER FILTER
    =============================== */
    if (assignedTo) {
      // Validate user has permission to filter by this assigned user
      const assignedUser = await User.findById(assignedTo);
      if (!assignedUser) throw new AppError("Assigned user not found", 404);

      if (currentUser.role === "Head_office" || currentUser.role === "ZSM") {
        filter.assignedUser = assignedTo;
      } else if (currentUser.role === "ASM") {
        // Check if assignedTo is under this ASM
        const teamUnderASM = await User.findOne({
          _id: assignedTo,
          supervisor: currentUser._id,
          role: "TEAM"
        });

        if (!teamUnderASM) {
          throw new AppError("Not authorized to view leads assigned to this user", 403);
        }
        filter.assignedUser = assignedTo;
      } else if (currentUser.role === "TEAM") {
        // TEAM can only filter their own leads
        if (assignedTo.toString() !== currentUser._id.toString()) {
          throw new AppError("Not authorized", 403);
        }
        filter.assignedUser = assignedTo;
      }
    }

    /* ===============================
       ASSIGNED MANAGER FILTER
    =============================== */
    if (managerId) {
      if (!["Head_office", "ZSM"].includes(currentUser.role)) {
        throw new AppError("Not authorized to filter by manager", 403);
      }
      filter.assignedManager = managerId;
    }

    /* ===============================
       DATE RANGE
    =============================== */
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) {
        filter.createdAt.$gte = new Date(`${fromDate}T00:00:00.000Z`);
      }
      if (toDate) {
        filter.createdAt.$lte = new Date(`${toDate}T23:59:59.999Z`);
      }
    }

    /* ===============================
       QUERY EXECUTION
    =============================== */
    const leads = await Lead.find(filter)
      .populate("assignedManager", "firstName lastName role")
      .populate("assignedUser", "firstName lastName role")
      .populate("createdBy", "firstName lastName role")
      .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await Lead.countDocuments(filter);

    return {
      leads,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (err) {
    handleError(err, "Failed to fetch leads");
  }
};

/* 🔹 GET SINGLE LEAD - WITH ACCESS CONTROL */
export const getLeadByIdService = async (id, userId) => {
  try {
    const currentUser = await User.findById(userId);
    if (!currentUser) throw new AppError("User not found", 404);

    const visibilityFilter = await getLeadVisibilityFilter(currentUser);

    const lead = await Lead.findOne({ _id: id, ...visibilityFilter })
      .populate("assignedManager", "firstName lastName email role phone")
      .populate("assignedUser", "firstName lastName email role phone")
      .populate("createdBy", "firstName lastName email role");

    if (!lead) {
      // Check if lead exists but user doesn't have access
      const leadExists = await Lead.findById(id);
      if (leadExists) {
        throw new AppError("You don't have permission to view this lead", 403);
      }
      throw new NotFoundError("Lead", id);
    }

    return lead;
  } catch (err) {
    handleError(err, "Failed to get lead");
  }
};

/* 🔹 FULL LEAD UPDATE SERVICE - ALL FIELDS, ACCESS CONTROL */
export const updateLeadService = async (id, data, userId) => {
  try {
    const currentUser = await User.findById(userId);
    if (!currentUser) throw new AppError("User not found", 404);

    const lead = await Lead.findOne({ _id: id });

    if (!lead) {
      const exists = await Lead.findById(id);
      if (exists) {
        throw new AppError(
          "You don't have permission to update this lead",
          403
        );
      }
      throw new NotFoundError("Lead", id);
    }

    // 🔐 Email validation
    if (data.email && !isValidEmail(data.email)) {
      throw new AppError("Invalid or temporary email address", 400);
    }

    const prevStatus = lead.status;
    let statusChanged = false;
    const updatedFields = {};

    /* ===============================
       1️⃣ UPDATE ALL NON-STATUS FIELDS
    =============================== */
    Object.keys(data).forEach((field) => {
      if (field !== "status" && field !== "stageTimeline" && field !== "_id") {
        lead[field] = data[field];
        updatedFields[field] = data[field];
      }
    });

    /* ===============================
       2️⃣ STATUS CHANGE + TIMELINE
    =============================== */
    if (data.status && data.status !== prevStatus) {
      lead.status = data.status;
      statusChanged = true;
      lead.stageTimeline.push({
        stage: data.status,
        notes:
          data.visitNotes ||
          data.registrationNotes ||
          data.loanNotes ||
          data.documentNotes ||
          data.bankAtPendingNotes ||
          data.disbursementNotes ||
          data.installationNotes ||
          data.reason ||
          `Status changed from ${prevStatus} to ${data.status}`,
        updatedBy: currentUser._id,
        updatedRole: currentUser.role,
        updatedAt: new Date(),
      });
    }

    /* ===============================
       3️⃣ UPDATE LAST CONTACTED
    =============================== */
    if (Object.keys(updatedFields).length > 0 || statusChanged) {
      lead.lastContactedAt = new Date();
    }

    await lead.save();

    /* ===============================
       4️⃣ RETURN UPDATED LEAD
    =============================== */
    return await Lead.findById(lead._id)
      .populate("assignedManager", "firstName lastName email role phone")
      .populate("assignedUser", "firstName lastName email role phone")
      .populate("createdBy", "firstName lastName email role phone");
  } catch (err) {
    handleError(err, "Failed to update lead");
  }
};

/* 🔹 DELETE LEAD (SOFT DELETE) */
export const deleteLeadService = async (ids, userId) => {
  try {
    const currentUser = await User.findById(userId);
    if (!["Head_office", "ZSM"].includes(currentUser.role)) {
      throw new AppError("Not authorized to delete leads", 403);
    }

    const idArray = Array.isArray(ids) ? ids : [ids];
    const visibilityFilter = await getLeadVisibilityFilter(currentUser);
    const leadsToDelete = await Lead.find({
      _id: { $in: idArray },
      ...visibilityFilter,
    });

    if (leadsToDelete.length === 0) {
      throw new AppError("No accessible leads found to delete", 404);
    }

    const accessibleIds = leadsToDelete.map((lead) => lead._id);

    const result = await Lead.updateMany(
      { _id: { $in: accessibleIds } },
      {
        isDeleted: true,
        status: "Missed Leads",
        lastContactedAt: new Date(),
      }
    );

    return {
      message: `${result.modifiedCount} lead(s) moved to deleted successfully`,
      deletedCount: result.modifiedCount,
      inaccessibleCount: idArray.length - accessibleIds.length,
    };
  } catch (err) {
    handleError(err, "Failed to delete lead(s)");
  }
};


/* 🔹 ASSIGN SINGLE LEAD — ONLY ASSIGN, NO NOTES OR HISTORY */
export const assignLeadService = async (
  { leadId, managerId, userId },
  user
) => {
  try {
    const currentUser = await User.findById(user);
    if (!currentUser) throw new NotFoundError("User Not Found", leadId);

    const lead = await Lead.findById(leadId);
    if (!lead) throw new NotFoundError("Lead", leadId);

    const hierarchy = {
      Head_office: ["ZSM", "ASM", "TEAM"],
      ZSM: ["ASM", "TEAM"],
      ASM: ["TEAM"],
      TEAM: [],
    };

    if (
      !hierarchy[currentUser.role] ||
      hierarchy[currentUser.role].length === 0
    ) {
      throw new AppError("Not authorized to assign leads", 403);
    }

    let update = {};

    /* 🔹 Assign to Manager (ZSM / ASM) */
    if (managerId) {
      const manager = await User.findById(managerId);
      if (!manager) throw new AppError("Manager not found", 400);

      if (!hierarchy[currentUser.role].includes(manager.role)) {
        throw new AppError("You cannot assign to this manager", 403);
      }

      update.assignedManager = managerId;
      update.assignedUser = null;
    }

    /* 🔹 Assign to TEAM Member */
    if (userId) {
      const teamUser = await User.findById(userId);
      if (!teamUser || teamUser.role !== "TEAM")
        throw new AppError("Invalid team member", 400);

      // ASM must assign only TEAM under same ASM
      if (
        currentUser.role === "ASM" &&
        teamUser.supervisor.toString() !== currentUser._id.toString()
      ) {
        throw new AppError("TEAM not under ASM", 403);
      }

      update.assignedUser = userId;
      lead.status = "Visit";
      update.assignedManager = teamUser.supervisor;
    }

    Object.assign(lead, update);
    await lead.save();

    return await Lead.findById(leadId).populate(
      "assignedManager assignedUser",
      "firstName lastName role"
    );
  } catch (err) {
    handleError(err, "Failed to assign lead");
  }
};

/* 🔹 BULK ASSIGN LEADS — History Only */
export const bulkAssignLeadsService = async (
  { leadIds, targetId, targetRole },
  currentUser
) => {
  try {
    const hierarchy = {
      Head_office: ["ZSM", "ASM", "TEAM"],
      ZSM: ["ASM", "TEAM"],
      ASM: ["TEAM"],
      TEAM: [],
    };

    if (!hierarchy[currentUser.role].includes(targetRole))
      throw new AppError("Not allowed to assign to this role", 403);

    const targetUser = await User.findById(targetId);
    if (!targetUser || targetUser.role !== targetRole)
      throw new AppError("Invalid target user", 400);

    const leads = await Lead.find({
      _id: { $in: leadIds },
      isDeleted: false,
    });

    for (const lead of leads) {
      if (targetRole === "TEAM") {
        // ASM can assign TEAM only under them
        if (
          currentUser.role === "ASM" &&
          targetUser.supervisor?.toString() !== currentUser._id.toString()
        )
          throw new AppError(
            `TEAM member ${targetUser.firstName} is not under ASM`,
            403
          );

        lead.assignedUser = targetId;
        lead.assignedManager = targetUser.supervisor;
        lead.status = "Visit";
      } else {
        // Assign to ZSM or ASM
        lead.assignedManager = targetId;
        lead.assignedUser = null;

        // Status should not be touched here; let workflow control it
        if (!lead.status) lead.status = "Visit"; // only if empty
      }

      await lead.save();
    }

    return {
      assigned: leads.length,
      role: targetRole,
      target: `${targetUser.firstName} ${targetUser.lastName}`,
      message: `Successfully assigned ${leads.length} lead(s)`,
    };
  } catch (err) {
    handleError(err, "Bulk assign failed");
  }
};

/* 🔹 GET MISSED LEADS LIST */
export const getMissedLeadsService = async (query, userId) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = "",
      reason,
      fromDate,
      toDate,
    } = query;

    const currentUser = await User.findById(userId);
    if (!currentUser) throw new AppError("User not found", 404);

    const skip = (page - 1) * limit;
    let filter = await getLeadVisibilityFilter(currentUser);

    // Filter for missed leads (status = Missed Leads)
    filter.status = "Missed Leads";

    // Additional filters
    if (search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: "i" };
      filter.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { notes: searchRegex },
      ];
    }

    // Date range for when lead was marked as missed
    if (fromDate || toDate) {
      filter.updatedAt = {};
      if (fromDate) {
        const from = new Date(fromDate);
        from.setHours(0, 0, 0, 0);
        filter.updatedAt.$gte = from;
      }
      if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        filter.updatedAt.$lte = to;
      }
    }

    // Get missed leads
    const missedLeads = await Lead.find(filter)
      .populate("assignedManager", "firstName lastName")
      .populate("assignedUser", "firstName lastName")
      .populate("createdBy", "firstName lastName")
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    // Calculate days inactive for each lead
    const now = new Date();
    const enrichedLeads = missedLeads.map((lead) => {
      let daysInactive = 0;
      if (lead.createdAt) {
        daysInactive = Math.floor(
          (now - new Date(lead.lastContactedAt)) / (1000 * 60 * 60 * 24)
        );
      } else if (lead.updatedAt) {
        daysInactive = Math.floor(
          (now - new Date(lead.updatedAt)) / (1000 * 60 * 60 * 24)
        );
      }
      return {
        ...lead,
        daysInactive,
        canReopen: daysInactive < 15, // Can reopen if less than 30 days
      };
    });

    const total = await Lead.countDocuments(filter);

    return {
      missedLeads: enrichedLeads,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  } catch (err) {
    handleError(err, "Failed to fetch missed leads");
  }
};


/* 🔹 IMPORT LEADS FROM FILE (S3 / LOCAL) */
export const importLeadsFromFileService = async (file, userId) => {
  try {

    if (!file) throw new AppError("No file uploaded", 400);

    const currentUser = await User.findById(userId);
    if (!currentUser) throw new AppError("User not found", 404);

    const ext = path.extname(file.originalname).toLowerCase();
    let rows = [];

    /* ---------------- CSV HANDLING ---------------- */
    if (ext === ".csv") {
      const stream = file.location
        ? (
          await s3Client.send(
            new GetObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME || "sungyertech",
              Key: file.key,
            })
          )
        ).Body
        : fs.createReadStream(file.path);

      rows = await new Promise((resolve, reject) => {
        const results = [];
        stream
          .pipe(csvParser())
          .on("data", (data) => results.push(data))
          .on("end", () => resolve(results))
          .on("error", reject);
      });
    }

    /* ---------------- EXCEL HANDLING ---------------- */
    else if ([".xlsx", ".xls"].includes(ext)) {
      let tempPath = file.path;

      // If file is from S3 → download temporarily
      if (file.location) {
        tempPath = `./temp/${Date.now()}-${file.originalname}`;
        const s3Object = await s3Client.send(
          new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: file.key,
          })
        );

        await new Promise((resolve, reject) => {
          const writeStream = fs.createWriteStream(tempPath);
          s3Object.Body.pipe(writeStream);
          writeStream.on("finish", resolve);
          writeStream.on("error", reject);
        });
      }

      const workbook = XLSX.readFile(tempPath);
      rows = XLSX.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[0]]
      );

      if (file.location && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } else {
      throw new AppError("Only CSV/XLSX files allowed", 400);
    }

    /* ---------------- IMPORT PROCESS ---------------- */
    let imported = 0;
    const errors = [];

    for (const [index, row] of rows.entries()) {
      try {
        const email =
          (row.email || row.Email || "").trim().toLowerCase() || null;
        const phone = String(
          row.phone || row.Phone || row.mobile || ""
        ).trim();

        if (!email && !phone) {
          errors.push(`Row ${index + 2}: Email or phone required`);
          continue;
        }

        const exists = await Lead.findOne({
          $or: [{ email }, { phone }].filter(Boolean),
          isDeleted: false,
        });

        if (exists) {
          errors.push(`Row ${index + 2}: Duplicate email/phone`);
          continue;
        }

        await Lead.create({
          firstName: (row.firstName || row.FirstName || "").trim(),
          lastName: (row.lastName || row.LastName || "").trim(),
          email,
          phone,
          address: (row.address || row.Address || "").trim(),
          city: (row.city || row.City || "").trim(),
          pincode: (row.pincode || row.Pincode || row.zip || "").trim(),
          source: (row.source || row.Source || "Import").trim(),
          status: "Visit",
          createdBy: currentUser._id,
          currentStage: [
            {
              status: "Visit",
              changedAt: new Date(),
              changedBy: currentUser._id,
            },
          ],
        });

        imported++;
      } catch (err) {
        errors.push(`Row ${index + 2}: ${err.message}`);
      }
    }

    /* ---------------- CLEANUP LOCAL FILE ---------------- */
    if (file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    return {
      message: `${imported} leads imported successfully`,
      imported,
      errors: errors.length ? errors : null,
    };
  } catch (err) {
    throw err instanceof AppError
      ? err
      : new AppError(err.message || "Failed to import leads", 500);
  }
};

/* 🔹 EXPORT LEADS TO CSV */
export const exportLeadsToCSVService = async (query, userId) => {
  try {
    const currentUser = await User.findById(userId);
    if (!currentUser) throw new AppError("User not found", 404);

    const filter = await getLeadVisibilityFilter(currentUser);

    // Apply additional filters from query
    if (query.status) {
      filter.status = query.status;
    }
    if (query.fromDate) {
      filter.createdAt = { $gte: new Date(query.fromDate) };
    }
    if (query.toDate) {
      filter.createdAt = { ...filter.createdAt, $lte: new Date(query.toDate) };
    }

    const leads = await Lead.find(filter)
      .populate("assignedUser", "firstName lastName")
      .populate("assignedManager", "firstName lastName")
      .sort({ createdAt: -1 })
      .lean();

    if (!leads.length) {
      return { filePath: null, count: 0 };
    }

    // Prepare data for CSV
    const csvData = leads.map((lead) => ({
      "First Name": lead.firstName || "",
      "Last Name": lead.lastName || "",
      Email: lead.email || "",
      Phone: lead.phone || "",
      Address: lead.address || "",
      City: lead.city || "",
      Pincode: lead.pincode || "",
      Status: lead.status || "",
      Source: lead.source || "",
      "Visit Date": lead.visitDate
        ? new Date(lead.visitDate).toLocaleDateString()
        : "",
      "Visit Status": lead.visitStatus || "",
      "Assigned To": lead.assignedUser
        ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}`
        : "",
      "Assigned Manager": lead.assignedManager
        ? `${lead.assignedManager.firstName} ${lead.assignedManager.lastName}`
        : "",
      "Created At": new Date(lead.createdAt).toLocaleString(),
      "Last Contacted": lead.lastContactedAt
        ? new Date(lead.lastContactedAt).toLocaleString()
        : "",
      Notes: lead.notes || "",
    }));

    const parser = new Parser();
    const csv = parser.parse(csvData);

    // Save to file
    const exportDir = path.resolve("exports");
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const filename = `leads_export_${Date.now()}.csv`;
    const filePath = path.join(exportDir, filename);
    fs.writeFileSync(filePath, csv);

    return {
      filePath,
      filename,
      count: leads.length,
    };
  } catch (err) {
    handleError(err, "Failed to export leads");
  }
};

/* 🔹 GET LEAD FUNNEL ANALYTICS */
const FUNNEL_STAGES = [
  "Visit",
  "Registration",
  "Bank Loan Apply",
  "Document Submission",
  "Disbursement",
  "Installation Completion",
  "Converted",
  "Missed Leads",
];

/* Get Lead Funnel with Counts & Details */
export const getLeadFunnelService = async (userId) => {
  try {
    const currentUser = await User.findById(userId).select("role _id");
    if (!currentUser) throw new AppError("User not found", 404);

    // Visibility Filter (Role Based)
    const visibilityFilter = await getLeadVisibilityFilter(currentUser);

    // Aggregate funnel result
    const aggregation = await Lead.aggregate([
      { $match: visibilityFilter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          leads: {
            $push: {
              _id: "$_id",
              firstName: "$firstName",
              lastName: "$lastName",
              phone: "$phone",
              email: "$email",
              source: "$source",
              createdAt: "$createdAt",
              assignedUser: "$assignedUser",
              assignedManager: "$assignedManager",
            },
          },
        },
      },
    ]);

    const funnelMap = aggregation.reduce((acc, stage) => {
      acc[stage._id] = { count: stage.count, leads: stage.leads };
      return acc;
    }, {});

    const totalNew = funnelMap["New"]?.count || 0;

    const funnel = FUNNEL_STAGES.map((stage) => ({
      stage,
      count: funnelMap[stage]?.count || 0,
      leads: funnelMap[stage]?.leads || [],
      percentage:
        totalNew > 0
          ? Number(((funnelMap[stage]?.count || 0) / totalNew) * 100).toFixed(1)
          : "0.0",
    }));

    const totalLeads = funnel.reduce((sum, s) => sum + s.count, 0);
    const convertedCount =
      funnel.find((s) => s.stage === "Converted")?.count || 0;

    return {
      totalLeads,
      conversionRate:
        totalLeads > 0
          ? Number((convertedCount / totalLeads) * 100).toFixed(2)
          : "0.00",
      funnel,
    };
  } catch (err) {
    handleError(err, "Failed to generate lead funnel");
  }
};

export const getLeadStatsService = async (query = {}, userId) => {
  try {
    let { page = 1, limit = 10 } = query;
    page = parseInt(page);
    limit = parseInt(limit);
    const skip = (page - 1) * limit;

    /** 🔹 Get logged-in user */
    const currentUser = await User.findById(userId);
    if (!currentUser) throw new AppError("User not found", 404);

    /** 🔹 ROLE-BASED FILTER */
    let filter = { isDeleted: false };

    if (currentUser.role === "ASM") {
      // ASM → own + team
      const team = await User.find({ supervisor: currentUser._id }, "_id");
      const teamIds = team.map((u) => u._id);
      filter.createdBy = { $in: [currentUser._id, ...teamIds] };
    }

    if (currentUser.role === "TEAM") {
      // TEAM → only own leads
      filter.createdBy = currentUser._id;
    }

    /** 🔹 Fetch leads paginated list optional */
    const leads = await Lead.find(filter)
      .populate("createdBy", "firstName lastName email role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    /** 🔹 Counts */
    const totalLeads = await Lead.countDocuments(filter);
    const activeLeads = await Lead.countDocuments({ ...filter, status: "New" });
    const convertedLeads = await Lead.countDocuments({
      ...filter,
      status: "Installation Completion",
    });
    const conversionRate =
      totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(2) : 0;

    /** 🔹 Pagination */
    const totalRecords = totalLeads;
    const totalPages = Math.ceil(totalRecords / limit);

    return {
      stats: {
        totalLeads,
        activeLeads,
        convertedLeads,
        conversionRate,
      },
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages,
      },
    };
  } catch (err) {
    throw new Error("Failed to fetch lead stats: " + err.message);
  }
};

/* -------------------------------------------------- */
/* Upload Lead Documents Service                       */
/* -------------------------------------------------- */
export const uploadLeadService = async (id, data, userId, files = {}) => {
  try {

    const currentUser = await User.findById(userId);
    if (!currentUser) throw new AppError("User not found", 404);

    /* 🔹 Lead Visibility */
    const visibilityFilter = await getLeadVisibilityFilter(currentUser);

    /* 🔹 Fetch Lead */
    const lead = await Lead.findOne({
      _id: id,
      status: "Document Submission",
      ...visibilityFilter,
    });

    if (!lead) {
      throw new AppError("Lead not found or access denied", 404);
    }

    /* 🔹 Update Simple Fields (except status) */
    Object.keys(data || {}).forEach((key) => {
      if (key !== "status") {
        lead[key] = data[key];
      }
    });

    /* 🔹 Status Update */
    if (data?.status && data.status !== lead.status) {
      lead.status = data.status;
      lead.currentStage.push({
        status: data.status,
        changedAt: new Date(),
        changedBy: currentUser._id,
      });
    }

    /* ==================================================
       DOCUMENT UPLOADS
    ================================================== */
    if (files?.aadhaar?.[0]) {
      const file = files.aadhaar[0];
      lead.aadhaar = {
        url: resolveFileUrl(file),
      };
    }

    if (files?.panCard?.[0]) {
      const file = files.panCard[0];
      lead.panCard = {
        url: resolveFileUrl(file),
      };
    }

    if (files?.passbook?.[0]) {
      const file = files.passbook[0];
      lead.passbook = {
        url: resolveFileUrl(file),
      };
    }

    if (files?.otherDocuments?.length) {
      lead.otherDocuments ??= [];
      files.otherDocuments.forEach((file) => {
        lead.otherDocuments.push({
          name: file.originalname,
          url: resolveFileUrl(file),
          uploadedAt: new Date(),
        });
      });
    }

    lead.documentStatus = data.documentStatus
    lead.documentSubmissionDate = new Date();
    lead.lastContactedAt = new Date();

    await lead.save();

    /* 🔹 Return Populated Lead */
    return await Lead.findById(lead._id).populate(
      "assignedManager assignedUser createdBy",
      "firstName lastName email phone role"
    );

  } catch (err) {
    handleError(err, "Failed to upload lead documents");
  }
};


/* 🔹 HEAD OFFICE DASHBOARD */
export const getHeadOfficeDashboardService = async (userId) => {
  try {
    const currentUser = await User.findById(userId);
    if (
      !currentUser ||
      (currentUser.role !== "Head_office" && currentUser.role !== "ZSM")
    ) {
      throw new AppError("Access denied. Head Office and ZSM only.", 403);
    }

    // SUMMARY STATS QUERY (ADDED)
    const summaryStatsPromise = Lead.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: null, totalLeads: { $sum: 1 } } },
    ]);

    const [
      totalVisits,
      totalMissedLeads,
      totalRegistrations,
      totalBankLoanApply,
      totalDocumentSubmission,
      totalDisbursement,
      totalInstallations,
      recentRegistrations,
      recentMissedLeads,
      recentVisits,
      teamMembers,
      recentActivities,
      summaryStats,
    ] = await Promise.all([
      Lead.countDocuments({ status: "Visit", isDeleted: false }),
      Lead.countDocuments({ status: "Missed Leads", isDeleted: false }),
      Lead.countDocuments({ status: "Registration", isDeleted: false }),
      Lead.countDocuments({ status: "Bank Loan Apply", isDeleted: false }),
      Lead.countDocuments({ status: "Document Submission", isDeleted: false }),
      Lead.countDocuments({ status: "Disbursement", isDeleted: false }),
      Lead.countDocuments({
        status: "Installation Completion",
        isDeleted: false,
      }),

      Lead.find({ status: "Registration", isDeleted: false })
        .sort({ dateOfRegistration: -1 })
        .limit(5)
        .select(
          "firstName lastName phone email dateOfRegistration registrationStatus"
        )
        .lean(),

      Lead.find({ status: "Missed Leads", isDeleted: false })
        .sort({ lastContactedAt: -1 })
        .limit(5)
        .select("firstName lastName phone email lastContactedAt notes")
        .lean(),

      Lead.find({ status: "Visit", isDeleted: false })
        .sort({ visitDate: -1 })
        .limit(5)
        .select(
          "firstName lastName phone email visitDate visitStatus visitLocation"
        )
        .lean(),

      User.find({
        role: { $in: ["ZSM", "ASM", "TEAM"] },
        status: "active",
      })
        .select("firstName lastName email role status createdAt supervisor")
        .populate("supervisor", "firstName lastName")
        .limit(10)
        .lean(),

      Lead.find({ isDeleted: false })
        .sort({ updatedAt: -1 })
        .limit(10)
        .select("firstName lastName status updatedAt currentStage assignedUser")
        .populate("assignedUser", "firstName lastName")
        .lean(),

      summaryStatsPromise,
    ]);

    const totalLeads = summaryStats?.[0]?.totalLeads || 0;

    return {
      overview: {
        totalVisits,
        totalMissedLeads,
        totalRegistrations,
        totalBankLoanApply,
        totalDocumentSubmission,
        totalDisbursement,
        totalInstallations,
        totalLeads,
        totalTeamMembers: teamMembers.length,
      },

      recentData: {
        registrations: recentRegistrations,
        missedLeads: recentMissedLeads,
        visits: recentVisits,
      },

      team: {
        members: teamMembers,
        activeCount: teamMembers.filter((m) => m.status === "active").length,
        inactiveCount: teamMembers.filter((m) => m.status === "inactive")
          .length,
      },

      activities: recentActivities.map((activity) => ({
        leadName: `${activity.firstName || ""} ${activity.lastName || ""
          }`.trim(),
        status: activity.status,
        updatedAt: activity.updatedAt,
        assignedTo: activity.assignedUser
          ? `${activity.assignedUser.firstName} ${activity.assignedUser.lastName}`
          : "Unassigned",
      })),

      charts: await getDashboardCharts(),
    };
  } catch (err) {
    throw new AppError(
      err.message || "Failed to fetch Head Office dashboard data",
      500
    );
  }
};

/* 🔹 ASM DASHBOARD */
export const getASMDashboardService = async (userId) => {
  try {
    const currentUser = await User.findById(userId);
    if (currentUser.role !== "ASM") {
      throw new AppError("Access denied. ASM only.", 403);
    }

    // Team under ASM
    const teamMembers = await User.find(
      { supervisor: currentUser._id, role: "TEAM" },
      "_id"
    );

    const teamIds = teamMembers.map((t) => t._id);
    const allUserIds = [currentUser._id, ...teamIds];

    // Parallel fetch
    const [
      totalVisits,
      totalMissedLeads,
      totalRegistrations,
      recentRegistrations,
      recentMissedLeads,
      recentVisits,
      teamList,
      recentActivities,
      summaryStats,
      teamPerformance,
    ] = await Promise.all([
      // 🔹 Counts
      Lead.countDocuments({
        $or: [
          { assignedManager: currentUser._id },
          { assignedUser: { $in: teamIds } },
          { createdBy: { $in: allUserIds } },
        ],
        status: "Visit",
        isDeleted: false,
      }),

      Lead.countDocuments({
        $or: [
          { assignedManager: currentUser._id },
          { assignedUser: { $in: teamIds } },
          { createdBy: { $in: allUserIds } },
        ],
        status: "Missed Leads",
        isDeleted: false,
      }),

      Lead.countDocuments({
        $or: [
          { assignedManager: currentUser._id },
          { assignedUser: { $in: teamIds } },
          { createdBy: { $in: allUserIds } },
        ],
        status: "Registration",
        isDeleted: false,
      }),

      // 🔹 Recent Registrations
      Lead.find({
        $or: [
          { assignedManager: currentUser._id },
          { assignedUser: { $in: teamIds } },
          { createdBy: { $in: allUserIds } },
        ],
        status: "Registration",
        isDeleted: false,
      })
        .sort({ dateOfRegistration: -1 })
        .limit(5)
        .select(
          "firstName lastName phone email dateOfRegistration registrationStatus assignedUser"
        )
        .populate("assignedUser", "firstName lastName")
        .lean(),

      // 🔹 Recent Missed Leads
      Lead.find({
        $or: [
          { assignedManager: currentUser._id },
          { assignedUser: { $in: teamIds } },
          { createdBy: { $in: allUserIds } },
        ],
        status: "Missed Leads",
        isDeleted: false,
      })
        .sort({ lastContactedAt: -1 })
        .limit(5)
        .select(
          "firstName lastName phone email lastContactedAt notes assignedUser"
        )
        .populate("assignedUser", "firstName lastName")
        .lean(),

      // 🔹 Recent Visits
      Lead.find({
        $or: [
          { assignedManager: currentUser._id },
          { assignedUser: { $in: teamIds } },
          { createdBy: { $in: allUserIds } },
        ],
        status: "Visit",
        isDeleted: false,
      })
        .sort({ visitDate: -1 })
        .limit(5)
        .select(
          "firstName lastName phone email visitDate visitStatus visitLocation assignedUser"
        )
        .populate("assignedUser", "firstName lastName")
        .lean(),

      // 🔹 Team List
      User.find({
        supervisor: currentUser._id,
        role: "TEAM",
        status: "active",
      })
        .select("firstName lastName email status createdAt lastLoginDate")
        .limit(10)
        .lean(),

      // 🔹 Recent Activities
      Lead.find({
        $or: [
          { assignedManager: currentUser._id },
          { assignedUser: { $in: teamIds } },
          { createdBy: { $in: allUserIds } },
        ],
        isDeleted: false,
      })
        .sort({ updatedAt: -1 })
        .limit(10)
        .select("firstName lastName status updatedAt assignedUser")
        .populate("assignedUser", "firstName lastName")
        .lean(),

      getTeamSummaryStatistics(currentUser._id, teamIds),
      getTeamPerformanceMetrics(teamIds),
    ]);

    return {
      overview: {
        totalVisits: totalVisits || 0,
        totalMissedLeads: totalMissedLeads || 0,
        totalRegistrations: totalRegistrations || 0,
        totalTeamMembers: teamMembers.length || 0,
        ...summaryStats,
      },
      recentData: {
        registrations: recentRegistrations || [],
        missedLeads: recentMissedLeads || [],
        visits: recentVisits || [],
      },
      team: {
        members: teamList || [],
        activeCount: teamList.filter((m) => m?.status === "active").length || 0,
      },
      activities: (recentActivities || []).map((activity) => ({
        leadName: `${activity.firstName || ""} ${activity.lastName || ""
          }`.trim(),
        status: activity.status || "Unknown",
        updatedAt: activity.updatedAt || new Date(),
        assignedTo: activity.assignedUser
          ? `${activity.assignedUser.firstName} ${activity.assignedUser.lastName}`
          : "Unassigned",
      })),
      teamPerformance: teamPerformance,
    };
  } catch (err) {
    handleError(err, "Failed to fetch ASM dashboard data");
  }
};

/* 🔹 TEAM MEMBER DASHBOARD */
export const getTeamDashboardService = async (userId) => {
  try {
    const currentUser = await User.findById(userId);
    if (currentUser.role !== "TEAM") {
      throw new AppError("Access denied. Team members only.", 403);
    }

    const [
      totalVisits,
      totalMissedLeads,
      totalRegistrations,
      recentRegistrations,
      recentMissedLeads,
      recentVisits,
      recentActivities,
      summaryStats,
      performanceData,
    ] = await Promise.all([
      // 🔹 Count
      Lead.countDocuments({
        $or: [
          { assignedUser: currentUser._id },
          { createdBy: currentUser._id },
        ],
        status: "Visit",
        isDeleted: false,
      }),

      Lead.countDocuments({
        $or: [
          { assignedUser: currentUser._id },
          { createdBy: currentUser._id },
        ],
        status: "Missed Leads",
        isDeleted: false,
      }),

      Lead.countDocuments({
        $or: [
          { assignedUser: currentUser._id },
          { createdBy: currentUser._id },
        ],
        status: "Registration",
        isDeleted: false,
      }),

      // 🔹 Recent Registrations
      Lead.find({
        $or: [
          { assignedUser: currentUser._id },
          { createdBy: currentUser._id },
        ],
        status: "Registration",
        isDeleted: false,
      })
        .sort({ dateOfRegistration: -1 })
        .limit(5)
        .select(
          "firstName lastName phone email dateOfRegistration registrationStatus"
        )
        .lean(),

      // 🔹 Recent Missed Leads
      Lead.find({
        $or: [
          { assignedUser: currentUser._id },
          { createdBy: currentUser._id },
        ],
        status: "Missed Leads",
        isDeleted: false,
      })
        .sort({ lastContactedAt: -1 })
        .limit(5)
        .select("firstName lastName phone email lastContactedAt notes")
        .lean(),

      // 🔹 Recent Visits
      Lead.find({
        $or: [
          { assignedUser: currentUser._id },
          { createdBy: currentUser._id },
        ],
        status: "Visit",
        isDeleted: false,
      })
        .sort({ visitDate: -1 })
        .limit(5)
        .select(
          "firstName lastName phone email visitDate visitStatus visitLocation"
        )
        .lean(),

      // 🔹 Recent Activities
      Lead.find({
        $or: [
          { assignedUser: currentUser._id },
          { createdBy: currentUser._id },
        ],
        isDeleted: false,
      })
        .sort({ updatedAt: -1 })
        .limit(10)
        .select("firstName lastName status updatedAt")
        .lean(),

      getPersonalSummaryStatistics(currentUser._id),
      getPersonalPerformance(currentUser._id),
    ]);

    return {
      overview: {
        totalVisits,
        totalMissedLeads,
        totalRegistrations,
        ...summaryStats,
      },
      recentData: {
        registrations: recentRegistrations,
        missedLeads: recentMissedLeads,
        visits: recentVisits,
      },
      activities: recentActivities.map((activity) => ({
        leadName: `${activity.firstName || ""} ${activity.lastName || ""
          }`.trim(),
        status: activity.status,
        updatedAt: activity.updatedAt,
      })),
      performance: performanceData,
    };
  } catch (err) {
    handleError(err, "Failed to fetch Team Member dashboard data");
  }
};

const getRoleBasedLeadFilter = async (currentUser, baseFilter = {}) => {
  // Head Office & ZSM → ALL
  if (currentUser.role === "Head_office" || currentUser.role === "ZSM") {
    return baseFilter;
  }

  // ASM → own + team
  if (currentUser.role === "ASM") {
    const team = await User.find(
      { supervisor: currentUser._id, role: "TEAM" },
      "_id"
    ).lean();

    const teamIds = team.map((t) => t._id);

    return {
      ...baseFilter,
      $or: [
        { assignedManager: currentUser._id },
        { assignedUser: { $in: teamIds } },
      ],
    };
  }

  // TEAM → only own
  if (currentUser.role === "TEAM") {
    return {
      ...baseFilter,
      assignedUser: currentUser._id,
    };
  }

  throw new Error("Unauthorized role");
};

export const getVisitSummaryService = async (query = {}, userId) => {
  const { page = 1, limit = 10 } = query;
  const skip = (page - 1) * limit;

  const currentUser = await User.findById(userId);
  if (!currentUser) throw new Error("User not found");

  const filter = await getRoleBasedLeadFilter(currentUser, {
    status: "Visit",
  });

  const visits = await Lead.find(filter)
    .sort({ visitDate: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    visits,
    summary: {
      totalVisits: await Lead.countDocuments(filter),
      completedVisits: await Lead.countDocuments({
        ...filter,
        visitStatus: "Completed",
      }),
      scheduledVisits: await Lead.countDocuments({
        ...filter,
        visitStatus: { $in: ["Scheduled", "Pending"] },
      }),
    },
    pagination: {
      page,
      limit,
      totalRecords: await Lead.countDocuments(filter),
      totalPages: Math.ceil((await Lead.countDocuments(filter)) / limit),
    },
  };
};

export const getRegistrationSummaryService = async (query = {}, userId) => {
  const { page = 1, limit = 10 } = query;
  const skip = (page - 1) * limit;

  const currentUser = await User.findById(userId);
  if (!currentUser) throw new Error("User not found");

  const filter = await getRoleBasedLeadFilter(currentUser, {
    status: "Registration",
  });

  const registrations = await Lead.find(filter)
    .sort({ dateOfRegistration: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    registrations,
    summary: {
      totalRegistrations: await Lead.countDocuments(filter),
      pendingRegistrations: await Lead.countDocuments({
        ...filter,
        registrationStatus: "pending",
      }),
      completedRegistrations: await Lead.countDocuments({
        ...filter,
        registrationStatus: "Completed",
      }),
    },
    pagination: {
      page,
      limit,
      totalRecords: await Lead.countDocuments(filter),
      totalPages: Math.ceil((await Lead.countDocuments(filter)) / limit),
    },
  };
};

export const getBankLoanSummaryService = async (query = {}, userId) => {
  const { page = 1, limit = 10 } = query;
  const skip = (page - 1) * limit;

  const currentUser = await User.findById(userId);
  if (!currentUser) throw new Error("User not found");

  const filter = await getRoleBasedLeadFilter(currentUser, {
    status: "Bank Loan Apply",
    isDeleted: false,
  });

  const loans = await Lead.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    bankLoans: loans,
    summary: {
      totalLoans: await Lead.countDocuments(filter),
      pendingLoans: await Lead.countDocuments({
        ...filter,
        loanStatus: "pending",
      }),
      approvedLoans: await Lead.countDocuments({
        ...filter,
        loanStatus: "approved",
      }),
      rejectedLoans: await Lead.countDocuments({
        ...filter,
        loanStatus: "rejected",
      }),
    },
    pagination: {
      page,
      limit,
      totalRecords: await Lead.countDocuments(filter),
      totalPages: Math.ceil((await Lead.countDocuments(filter)) / limit),
    },
  };
};

export const getDisbursementSummaryService = async (query = {}, userId) => {
  const { page = 1, limit = 10 } = query;
  const skip = (page - 1) * limit;

  const currentUser = await User.findById(userId);
  if (!currentUser) throw new Error("User not found");

  const filter = await getRoleBasedLeadFilter(currentUser, {
    status: "Disbursement",
    isDeleted: false,
  });

  const disbursements = await Lead.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    disbursements,
    summary: {
      totalDisbursements: await Lead.countDocuments(filter),
      pendingDisbursements: await Lead.countDocuments({
        ...filter,
        disbursementStatus: "pending",
      }),
      completedDisbursements: await Lead.countDocuments({
        ...filter,
        disbursementStatus: "completed",
      }),
      cancelledDisbursements: await Lead.countDocuments({
        ...filter,
        disbursementStatus: "cancelled",
      }),
    },
    pagination: {
      page,
      limit,
      totalRecords: await Lead.countDocuments(filter),
      totalPages: Math.ceil((await Lead.countDocuments(filter)) / limit),
    },
  };
};

export const getInstallationSummaryService = async (query = {}, userId) => {

  const { page = 1, limit = 10 } = query;
  const skip = (page - 1) * limit;

  const currentUser = await User.findById(userId);
  if (!currentUser) throw new Error("User not found");

  const filter = await getRoleBasedLeadFilter(currentUser, {
    status: "Installation Completion",
    isDeleted: false,
  });

  const installations = await Lead.find(filter)
    .sort({ installationDate: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    installations,
    summary: {
      totalInstallations: await Lead.countDocuments(filter),
      installationProgress: await Lead.countDocuments({
        ...filter,
        installationStatus: "installation_progress",
      }),
      installationCompleted: await Lead.countDocuments({
        ...filter,
        installationStatus: "installation_completed",
      }),
      sentForJeeVerification: await Lead.countDocuments({
        ...filter,
        installationStatus: "sent_for_jee_verification",
      }),
      loadEnhancement: await Lead.countDocuments({
        ...filter,
        installationStatus: "load_Enhancement",
      }),
      jeeVerified: await Lead.countDocuments({
        ...filter,
        installationStatus: "jee_verified",
      }),
      meterCharge: await Lead.countDocuments({
        ...filter,
        installationStatus: "meter_charge",
      }),
      finalPayment: await Lead.countDocuments({
        ...filter,
        installationStatus: "final_payment",
      }),
    },
    pagination: {
      page,
      limit,
      totalRecords: await Lead.countDocuments(filter),
      totalPages: Math.ceil((await Lead.countDocuments(filter)) / limit),
    },
  };
};

export const getDocumentSummaryService = async (query = {}, userId) => {

  const { page = 1, limit = 10 } = query;
  const skip = (page - 1) * limit;

  const currentUser = await User.findById(userId);
  if (!currentUser) throw new Error("User not found");

  const filter = await getRoleBasedLeadFilter(currentUser, {
    status: "Document Submission",
    isDeleted: false,
  });

  const documents = await Lead.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    documents,
    summary: {
      totalDocuments: await Lead.countDocuments(filter),
      submittedDocuments: await Lead.countDocuments({
        ...filter,
        documentStatus: "submitted",
      }),
      approvedDocuments: await Lead.countDocuments({
        ...filter,
        documentStatus: "approved",
      }),
      rejectedDocuments: await Lead.countDocuments({
        ...filter,
        documentStatus: "rejected",
      }),
      pendingDocuments: await Lead.countDocuments({
        ...filter,
        documentStatus: "pending",
      }),
    },
    pagination: {
      page,
      limit,
      totalRecords: await Lead.countDocuments(filter),
      totalPages: Math.ceil((await Lead.countDocuments(filter)) / limit),
    },
  };
};

/* 🔹 Bank at Pending Summary Service */
export const getBankAtPendingSummaryService = async (query = {}, userId) => {
  try {
    const { page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    const currentUser = await User.findById(userId);
    if (!currentUser) {
      throw new AppError("User not found", 404);
    }

    /* ===============================
       ROLE-BASED FILTER
    =============================== */
    const filter = await getRoleBasedLeadFilter(currentUser, {
      status: "Bank at Pending",
    });

    /* ===============================
       DATA FETCH
    =============================== */
    const leads = await Lead.find(filter)
      .populate("assignedUser", "firstName lastName")
      .populate("assignedManager", "firstName lastName")
      .sort({ bankAtPendingDate: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const totalRecords = await Lead.countDocuments(filter);

    /* ===============================
       SUMMARY COUNTS
    =============================== */
    const [pending, approved, rejected] = await Promise.all([
      Lead.countDocuments({ ...filter, bankAtPendingStatus: "pending" }),
      Lead.countDocuments({ ...filter, bankAtPendingStatus: "approved" }),
      Lead.countDocuments({ ...filter, bankAtPendingStatus: "rejected" }),
    ]);

    return {
      leads,
      summary: {
        totalBankAtPending: totalRecords,
        pending,
        approved,
        rejected,
      },
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
      },
    };
  } catch (err) {
    handleError(err, "Failed to fetch Bank at Pending summary");
  }
};


/* 🔹 Upload Registration Document Service */
export const uploadRegistrationDocumentService = async (
  id,
  userId,
  file
) => {
  try {
    /* 🔹 Validate file */
    if (!file) {
      throw new AppError("No document uploaded", 400);
    }

    /* 🔹 Current User */
    const currentUser = await User.findById(userId);
    if (!currentUser) {
      throw new AppError("User not found", 404);
    }

    /* 🔹 Lead Visibility */
    const visibilityFilter = await getLeadVisibilityFilter(currentUser);

    /* 🔹 Fetch Lead */
    const lead = await Lead.findOne({
      _id: id,
      status: "Registration",
      isDeleted: false,
      ...visibilityFilter,
    });

    if (!lead) {
      throw new AppError("Lead not found or access denied", 404);
    }

    /* --------------------------------------------------
       🔹 Resolve File URL (S3 or Local)
    -------------------------------------------------- */
    let fileUrl = null;
    let fileKey = null;

    // AWS S3
    if (file.location) {
      fileUrl = file.location;
      fileKey = file.key;
    }
    // Local storage fallback
    else if (file.filename) {
      fileUrl = generateFullUrl(file.filename);
      fileKey = file.filename;
    }

    /* 🔹 Save Document */
    lead.uploadDocument = {
      key: fileKey, // important for future delete
      originalName: file.originalname,
      url: fileUrl,
      mimetype: file.mimetype,
      size: file.size,
      uploadedAt: new Date(),
      uploadedBy: currentUser._id,
    };

    /* 🔹 Update Registration Status */
    lead.registrationStatus = "completed";

    /* 🔹 Timeline Log */
    lead.stageTimeline.push({
      stage: "Registration",
      notes: "Registration document uploaded",
      updatedBy: currentUser._id,
      updatedRole: currentUser.role,
      updatedAt: new Date(),
    });

    lead.lastContactedAt = new Date();

    await lead.save();

    /* 🔹 Return Populated Lead */
    return await Lead.findById(lead._id).populate(
      "assignedManager assignedUser createdBy",
      "firstName lastName email phone role"
    );
  } catch (err) {
    throw err; // handled by global error middleware
  }
};


/* =========================================================
   🔹 Upload Installation Document Service
========================================================= */
export const uploadInstallationDocumentService = async (
  id,
  userId,
  file
) => {
  try {

    if (!file) {
      throw new AppError("No installation document uploaded", 400);
    }

    const currentUser = await User.findById(userId);
    if (!currentUser) {
      throw new AppError("User not found", 404);
    }

    const visibilityFilter = await getLeadVisibilityFilter(currentUser);

    const lead = await Lead.findOne({
      _id: id,
      status: "Installation Completion",
      isDeleted: false,
      ...visibilityFilter,
    });

    if (!lead) {
      throw new AppError("Lead not found or access denied", 404);
    }
    //console.log("file locations", file.location)

    lead.installationDocument = {
      url: file.location,
    };

    /* 🔹 Timeline */
    lead.stageTimeline.push({
      stage: "Installation Completion",
      notes: "Installation document uploaded",
      updatedBy: currentUser._id,
      updatedRole: currentUser.role,
      updatedAt: new Date(),
    });

    lead.lastContactedAt = new Date();

    await lead.save();

    return await Lead.findById(lead._id).populate(
      "assignedManager assignedUser createdBy",
      "firstName lastName email phone role"
    );

  } catch (err) {
    throw err;
  }
};