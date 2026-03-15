// routes/location.routes.js
import express from "express";
import {
  createLocationPointController,
  getLocationPointsController,
  getTodayLocationPathController,
  getLocationStatsController,
  bulkCreateLocationPointsController,
} from "../controllers/locationPoint.controller.js";
import { authenticate, allowRoles } from "../middlewares/verifyToken.js";

const router = express.Router();

// ✅ All routes require a valid JWT
router.use(authenticate);

// ─── Salesman routes (any logged-in user can track themselves) ────────────────
// POST /location/track       — save a single GPS point
// POST /location/track/bulk  — save multiple GPS points (offline sync)
router.post("/track",      createLocationPointController);
router.post("/track/bulk", bulkCreateLocationPointsController);

// ─── Admin / supervisor routes ────────────────────────────────────────────────
// ✅ FIX: these were open to ALL authenticated users before.
//    A salesman could pass any salesmanId and read someone else's trail.
//    Now only Head_office, ZSM, ASM can query with an arbitrary salesmanId.
//    Regular TEAM users hitting these routes without a salesmanId param
//    will fall back to their own ID inside the controller — that's safe.

// GET /location/             — get all points (admin: any user, self: own only)
router.get(
  "/",
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getLocationPointsController
);

// GET /location/today        — today's path polyline
router.get(
  "/today",
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getTodayLocationPathController
);

// GET /location/stats        — stats for a given day
router.get(
  "/stats",
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getLocationStatsController
);

export default router;