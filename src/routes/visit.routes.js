// FIXED: /:id moved to bottom, router.param only applies to ID routes
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
const ALL_ROLES     = ["Head_office", "ZSM", "ASM", "TEAM"];
const MANAGER_ROLES = ["Head_office", "ZSM", "ASM"];

// Apply authentication to all routes
router.use(authenticate);

/* =========================================================
   STATIC / NAMED ROUTES — must come before /:id
========================================================= */

// Get all visits with filters
router.get("/", allowRoles(ALL_ROLES), getAllVisitsController);

// Recent activity
router.get("/activity/recent", allowRoles(ALL_ROLES), getRecentActivityController);

// Visit stats
router.get("/stats/overview", allowRoles(ALL_ROLES), getVisitStatsController);

// Team performance (managers + TEAM self-view)
router.get("/performance/team", allowRoles(ALL_ROLES), getTeamPerformanceController);

// My performance (TEAM role only)
router.get("/performance/me", allowRoles(["TEAM"]), getMyPerformanceController);

// Export visits
router.get("/export/data", allowRoles(MANAGER_ROLES), exportVisitsController);

// Team by supervisor
router.get("/team/supervisor/:supervisorId", allowRoles(MANAGER_ROLES), getTeamBySupervisorController);

// Team member performance
router.get("/performance/team-member/:memberId", allowRoles(ALL_ROLES), getTeamMemberPerformance);

/* =========================================================
   CREATE / UPDATE ROUTES
========================================================= */

// Create new visit (with photo upload)
router.post(
  "/",
  allowRoles(ALL_ROLES),
  upload.array("photos", 10),
  createVisitController
);

// Update visit
router.put("/:id", allowRoles(ALL_ROLES), updateVisitController);

// Complete visit
router.patch("/:id/complete", allowRoles(ALL_ROLES), completeVisitController);

/* =========================================================
   /:id ROUTE — MUST BE LAST (catches anything not matched above)
========================================================= */
router.get("/:id", allowRoles(ALL_ROLES), getVisitByIdController);

/* =========================================================
   VALIDATION MIDDLEWARE
========================================================= */

// Validate visit ID parameter — only runs for routes with :id
router.param("id", (req, res, next, id) => {
  if (!id.match(/^[0-9a-fA-F]{24}$/)) {
    return next(new AppError("Invalid visit ID format", 400));
  }
  next();
});
// In your location router (wherever /api/v1/location routes live)
import fetch from 'node-fetch'; // or use axios if you already have it

router.get('/route-distance', authenticate, async (req, res, next) => {
  try {
    const { originLat, originLng, destLat, destLng } = req.query;
    if (!originLat || !originLng || !destLat || !destLng) {
      return res.status(400).json({ error: 'Missing coordinates' });
    }
    const key = process.env.GOOGLE_MAPS_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${originLat},${originLng}` +
      `&destination=${destLat},${destLng}` +
      `&mode=driving&key=${key}`;
    const r    = await fetch(url);
    const data = await r.json();
    if (data.status === 'OK') {
      const leg = data.routes[0].legs[0];
      return res.json({
        distanceKm:      leg.distance.value / 1000,
        distanceText:    leg.distance.text,
        durationMinutes: Math.round(leg.duration.value / 60),
        durationText:    leg.duration.text,
      });
    }
    res.status(400).json({ error: data.status });
  } catch (e) {
    next(e);
  }
});
export default router;