import { Router } from "express";
import { authenticate, allowRoles } from "../middlewares/verifyToken.js";
import { upload } from "../middlewares/upload.js";
import { AppError } from "../errors/customError.js";
import {
  createVisitController,
  getAllVisitsController,
  getVisitByIdController,
  updateVisitController,
  completeVisitController,
  getRecentActivityController,
  getVisitStatsController,
  getTeamPerformanceController,
  getMyPerformanceController,
  getTeamBySupervisorController,
  exportVisitsController,
  getTeamMemberPerformance,
} from "../controllers/visit.controller.js";

const router = Router();


/* =========================================================
   ROLE CONSTANTS
========================================================= */
const ALL_ROLES = ["Head_office", "ZSM", "ASM", "TEAM"];
const MANAGER_ROLES = ["Head_office", "ZSM", "ASM"];
const HEAD_OFFICE_ONLY = ["Head_office", "ZSM"];
const HEAD_OFFICE = ["Head_office"]

// Apply authentication to all routes
router.use(authenticate);

/* =========================================================
   PUBLIC ROUTES (All authenticated users)
========================================================= */

// Get all visits with filters
router.get("/", allowRoles(ALL_ROLES), getAllVisitsController);

// Get visit by ID
router.get("/:id", allowRoles(ALL_ROLES), getVisitByIdController);

// Get recent activity
router.get("/activity/recent", allowRoles(ALL_ROLES), getRecentActivityController);

// Get visit stats
router.get("/stats/overview", allowRoles(ALL_ROLES), getVisitStatsController);

// Get team performance (managers only for team view, TEAM for self)
router.get("/performance/team", allowRoles(ALL_ROLES), getTeamPerformanceController);

// Get my performance (for TEAM role)
router.get("/performance/me", allowRoles(["TEAM"]), getMyPerformanceController);

// Export visits
router.get("/export/data", allowRoles(MANAGER_ROLES), exportVisitsController);

/* =========================================================
   PROTECTED ROUTES (Create/Update)
========================================================= */

// Create new visit (with photo upload)
router.post(
  "/",
  allowRoles(ALL_ROLES),
  upload.array("photos", 10), // Max 10 photos
  createVisitController
);

// Update visit
router.put("/:id", allowRoles(ALL_ROLES), updateVisitController);
// Complete visit
router.patch("/:id/complete", allowRoles(ALL_ROLES), completeVisitController);

router.get("/team/supervisor/:supervisorId", allowRoles(MANAGER_ROLES), getTeamBySupervisorController);
router.get("/performance/team-member/:memberId", allowRoles(ALL_ROLES), getTeamMemberPerformance);

/* =========================================================
   VALIDATION MIDDLEWARE
========================================================= */

// Validate visit ID parameter
router.param('id', (req, res, next, id) => {
  if (!id.match(/^[0-9a-fA-F]{24}$/)) {
    return next(new AppError("Invalid visit ID format", 400));
  }
  next();
});

export default router;