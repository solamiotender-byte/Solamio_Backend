import { Router } from "express";
import {
  createLeadController,
  getLeadsController,
  getLeadByIdController,
  updateLeadController,
  deleteLeadController,
  assignLeadController,
  importLeadsController,
  getLeadFunnelController,
  getMissedLeadsController,
  exportLeadsToCSVController,
  bulkAssignLeadsController,
  getLeadStatsController,
  getVisitSummaryController,
  getRegistrationSummaryController,
  getBankLoanSummaryController,
  getDisbursementSummaryController,
  getInstallationSummaryController,
  uploadLeadController,
  getHeadOfficeAndZSMController,
  getASMController,
  getTEAMController,
  getDocumentSummaryController,
  getBankAtPendingController,
  registrationUploadController,
  installationUploadController,
} from "../controllers/lead.controller.js";

import { authenticate, allowRoles } from "../middlewares/verifyToken.js";
import {
  createLeadValidation,
  updateLeadValidation,
} from "../validation/lead.validation.js";
import { handleValidation } from "../validation/validationResult.js";
import { upload } from "../middlewares/upload.js";

const router = Router();

/* ==================== CRUD OPERATIONS ==================== */

router.post(
  "/create",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  createLeadValidation,
  handleValidation,
  createLeadController
);

router.get(
  "/getAll",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getLeadsController
);

router.get(
  "/getLeadById/:id",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getLeadByIdController
);

router.put(
  "/updateLead/:id",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  updateLeadValidation,
  handleValidation,
  updateLeadController
);

router.delete(
  "/deleteLead/:id",
  authenticate,
  allowRoles(["Head_office", "ZSM"]),
  deleteLeadController
);

/* ==================== DOCUMENT UPLOAD ==================== */

router.put(
  "/upload/:id/upload-documents",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  upload.fields([
    { name: "aadhaar", maxCount: 1 },
    { name: "panCard", maxCount: 1 },
    { name: "passbook", maxCount: 1 },
    { name: "otherDocuments", maxCount: 5 },
  ]),
  uploadLeadController
);

/* ==================== ASSIGNMENT ==================== */

router.post(
  "/assign",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM"]),
  assignLeadController
);

router.post(
  "/bulk-assign",
  authenticate,
  allowRoles(["Head_office", "ZSM"]),
  bulkAssignLeadsController
);

/* ==================== MISSED LEADS ==================== */

router.get(
  "/missed",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getMissedLeadsController
);

/* ==================== ANALYTICS ==================== */

router.get(
  "/funnel",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getLeadFunnelController
);

router.get(
  "/stats",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getLeadStatsController
);

/* ==================== IMPORT / EXPORT ==================== */

router.post(
  "/import",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  upload.single("file"),
  importLeadsController
);

router.get(
  "/exports",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  exportLeadsToCSVController
);

/* ==================== SUMMARY DASHBOARDS ==================== */

router.get(
  "/visitSummary",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getVisitSummaryController
);

router.get(
  "/registrationSummary",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getRegistrationSummaryController
);

router.get(
  "/bankLoanSummary",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getBankLoanSummaryController
);

router.get(
  "/disbursementSummary",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getDisbursementSummaryController
);

router.get(
  "/installationSummary",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getInstallationSummaryController
);

router.get(
  "/DocumentSummary",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getDocumentSummaryController
);

/* ==================== ROLE DASHBOARDS ==================== */

router.get(
  "/HeadOfficeDashboard",
  authenticate,
  allowRoles(["Head_office", "ZSM"]),
  getHeadOfficeAndZSMController
);

router.get(
  "/ASMDashboard",
  authenticate,
  allowRoles(["ASM"]),
  getASMController
);

router.get(
  "/TEAMDashboard",
  authenticate,
  allowRoles(["TEAM"]),
  getTEAMController
);

/* ==================== BANKING ==================== */

router.get(
  "/bankingAtPending",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getBankAtPendingController
);

/* ==================== REGISTRATION DOC ==================== */

router.post(
  "/registration/:id/document-upload",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  upload.single("document"),
  registrationUploadController
);

router.post(
  "/installation/:id/document-upload",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  upload.single("document"),
  installationUploadController
);

export default router;