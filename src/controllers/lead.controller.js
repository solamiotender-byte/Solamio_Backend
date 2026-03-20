// controllers/lead.controller.j
import path from "path";
import {
  createLeadService,
  getLeadsService,
  getLeadByIdService,
  updateLeadService,
  deleteLeadService,
  assignLeadService,
  importLeadsFromFileService,
  getLeadFunnelService,
  getMissedLeadsService,
  exportLeadsToCSVService,
  bulkAssignLeadsService,
  getVisitSummaryService,
  getLeadStatsService,
  getRegistrationSummaryService,
  getBankLoanSummaryService,
  getDisbursementSummaryService,
  getInstallationSummaryService,
  uploadLeadService,
  getHeadOfficeDashboardService,
  getASMDashboardService,
  getTeamDashboardService,
  getDocumentSummaryService,
  getBankAtPendingSummaryService,
  uploadRegistrationDocumentService,
  uploadInstallationDocumentService
} from "../services/lead.service.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../errors/customError.js";

/* Create Lead */
export const createLeadController = async (req, res, next) => {
  try {
    const lead = await createLeadService(req.body, req.user);
    sendResponse(res, 201, "Lead created successfully", lead);
  } catch (error) {
    next(error);
  }
};

/* Get Leads (List with Filters) */
export const getLeadsController = async (req, res, next) => {
  try {
    const result = await getLeadsService(req.query, req.user._id);
    sendResponse(res, 200, "Leads fetched successfully", result);
  } catch (error) {
    next(error);
  }
};

/* Get Single Lead */
export const getLeadByIdController = async (req, res, next) => {
  try {
    const lead = await getLeadByIdService(req.params.id, req.user._id);
    sendResponse(res, 200, "Lead fetched successfully", lead);
  } catch (error) {
    next(error);
  }
};

/* Update Lead */
export const updateLeadController = async (req, res, next) => {
  try {
    const lead = await updateLeadService(req.params.id, req.body, req.user._id);
    sendResponse(res, 200, "Lead updated successfully", lead);
  } catch (error) {
    next(error);
  }
};

/* Delete Lead(s) - Single or Bulk */
export const deleteLeadController = async (req, res, next) => {
  try {
    // ✅ Support both :id param (single) and body.ids (bulk)
    const ids = req.params.id 
      ? [req.params.id] 
      : req.body.ids;

    if (!ids || (Array.isArray(ids) && ids.length === 0))
      throw new AppError("Lead ID(s) are required", 400);

    const result = await deleteLeadService(ids, req.user._id);
    sendResponse(res, 200, result.message, result);
  } catch (error) {
    next(error);
  }
};

/* ===============================
   Assign Lead to Manager / Team
================================ */
export const assignLeadController = async (req, res, next) => {
  try {
    const { leadId, managerId, userId } = req.body;

    const assignedLead = await assignLeadService(
      { leadId, managerId, userId },
      req.user._id // current logged user
    );
    sendResponse(res, 200, "Lead assigned successfully", assignedLead);
  } catch (error) {
    next(error);
  }
};

/* ===============================
   Bulk Assign Leads
================================ */
export const bulkAssignLeadsController = async (req, res, next) => {
  try {
    const { leadIds, targetId, targetRole, assignmentNotes } = req.body;

    if (!leadIds || !targetId || !targetRole) {
      throw new AppError("leadIds, targetId & targetRole are required", 400);
    }

    const result = await bulkAssignLeadsService(
      { leadIds, targetId, targetRole, assignmentNotes },
      req.user // current logged user
    );

    sendResponse(res, 200, result.message, result);
  } catch (error) {
    next(error);
  }
};

/* Import Leads from CSV/XLSX */
export const importLeadsController = async (req, res, next) => {
  try {
    
    if (!req.file) throw new AppError("No file uploaded", 400);

    const result = await importLeadsFromFileService(
      req.file,
      req.user._id
    );

    sendResponse(res, 200, result.message, {
      imported: result.imported,
      errors: result.errors || null,
    });
  } catch (error) {
    next(error);
  }
};

/* Lead Funnel Dashboard */
export const getLeadFunnelController = async (req, res, next) => {
  try {
    const funnel = await getLeadFunnelService(req.user._id);
    sendResponse(res, 200, "Lead funnel data fetched successfully", funnel);
  } catch (error) {
    next(error);
  }
};

/* Missed / Stale Leads */
export const getMissedLeadsController = async (req, res, next) => {
  try {
    const result = await getMissedLeadsService(req.query, req.user._id);
    sendResponse(res, 200, "Missed leads fetched successfully", result);
  } catch (error) {
    next(error);
  }
};

/* Export Leads to CSV */
export const exportLeadsToCSVController = async (req, res, next) => {
  try {
    const { filePath, filename, count } = await exportLeadsToCSVService(
      req.query,
      req.user._id
    );

    if (!filePath || count === 0) {
      return sendResponse(res, 200, "No leads found to export", { count: 0 });
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // Stream file for large exports
    res.download(path.resolve(filePath), filename, (err) => {
      if (err) {
        next(err);
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getLeadStatsController = async (req, res, next) => {
  try {
    const data = await getLeadStatsService(req.query, req.user._id);
    sendResponse(res, 200, "Lead stats fetched successfully", data);
  } catch (err) {
    next(err);
  }
};

export const getVisitSummaryController = async (req, res, next) => {
  try {
    const data = await getVisitSummaryService(req.query, req.user._id);
    sendResponse(res, 200, "Lead visits statistics fetched successfully", data);
  } catch (err) {
    next(err);
  }
};

export const getRegistrationSummaryController = async (req, res, next) => {
  try {
    const data = await getRegistrationSummaryService(req.query, req.user._id);
    sendResponse(res, 200, "Lead visits statistics fetched successfully", data);
  } catch (err) {
    next(err);
  }
};

export const getBankLoanSummaryController = async (req, res, next) => {
  try {
    const data = await getBankLoanSummaryService(req.query, req.user._id);
    sendResponse(
      res,
      200,
      "Lead bank loan statistics fetched successfully",
      data
    );
  } catch (err) {
    next(err);
  }
};

export const getDisbursementSummaryController = async (req, res, next) => {
  try {
    const data = await getDisbursementSummaryService(req.query, req.user._id);
    sendResponse(
      res,
      200,
      "Lead disbursement statistics fetched successfully",
      data
    );
  } catch (err) {
    next(err);
  }
};

export const getInstallationSummaryController = async (req, res, next) => {
  try {
    const data = await getInstallationSummaryService(req.query, req.user._id);
    sendResponse(
      res,
      200,
      "Lead installation statistics fetched successfully",
      data
    );
  } catch (err) {
    next(err);
  }
};

export const  uploadLeadController = async (req, res, next) => {
  try {
    const updatedLead = await uploadLeadService(
      req.params.id,
      req.body,
      req.user._id,
      req.files
    );
    return sendResponse(
      res,
      200,
      "Document uploaded successfully",
      updatedLead
    );
  } catch (err) {
    return next(err);
  }
};

export const getHeadOfficeAndZSMController = async (req, res, next) => {
  try {
    const data = await getHeadOfficeDashboardService(req.user._id);
    sendResponse(res, 200, "Dashboard fetched successfully", data);
  } catch (err) {
    next(err);
  }
};

export const getASMController = async (req, res, next) => {
  try {
    const data = await getASMDashboardService(req.user._id);
    sendResponse(res, 200, "Dashboard fetched successfully", data);
  } catch (err) {
    next(err);
  }
};

export const getTEAMController = async (req, res, next) => {
  try {
    const data = await getTeamDashboardService(req.user._id);
    sendResponse(res, 200, "Dashboard fetched successfully", data);
  } catch (err) {
    next(err);
  }
};

export const getDocumentSummaryController = async (req, res, next) => {
  try {
    const data = await getDocumentSummaryService(req.query, req.user._id);
    sendResponse(res, 200, "document summary stats successfully", data);
  } catch (err) {
    next(err);
  }
};

export const getBankAtPendingController = async (req, res, next) => {
  try {
    const data = await getBankAtPendingSummaryService(req.query, req.user._id);
    sendResponse(res, 200, "bank pending summary stats successfully", data);
  } catch (err) {
    next(err);
  }
};

export const registrationUploadController = async (req, res, next) => {
  try {
    //console.log("data files..", req.file)
    const data = await uploadRegistrationDocumentService(
      req.params.id,
      req.user._id,
      req.file
    );
    sendResponse(res, 200, "Registration document uploaded successfully", data);
  } catch (error) {
    next(error);
  }
};


export const installationUploadController = async (req, res, next) => {
  try {
    //console.log("data files..", req.file)
    const data = await uploadInstallationDocumentService(
      req.params.id,
      req.user._id,
      req.file
    );
    sendResponse(res, 200, "installation document uploaded successfully", data);
  } catch (error) {
    next(error);
  }
};
