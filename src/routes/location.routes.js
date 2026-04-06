// routes/location.routes.js
import express from "express";
import {
  createLocationPointController,
  getLocationPointsController,
  getTodayLocationPathController,
  getLocationStatsController,
  getTotalDistanceController,
  bulkCreateLocationPointsController,
  deleteExpiredLocationPointsController,
} from "../controllers/locationPoint.controller.js";
import { authenticate, allowRoles } from "../middlewares/verifyToken.js";

const router = express.Router();

router.use(authenticate);

// ─── Save points ──────────────────────────────────────────────────────────────
// router.post("/track",      createLocationPointController);
router.post("/track/bulk", bulkCreateLocationPointsController);

// ─── Read trail & stats ───────────────────────────────────────────────────────
router.get(
  "/",
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getLocationPointsController
);

// GET /location/today?salesmanId=&startTime=<ISO>&endTime=<ISO>
// Returns trail points for last 24h (or today if no time params)
router.get(
  "/today",
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getTodayLocationPathController
);

// GET /location/stats?salesmanId=&date=YYYY-MM-DD
router.get(
  "/stats",
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getLocationStatsController
);

// GET /location/distance?salesmanId=&date=YYYY-MM-DD
// Returns { totalKm, totalPoints, firstRecorded, lastRecorded }
router.get(
  "/distance",
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getTotalDistanceController
);

// DELETE /location/expired — manual cleanup trigger (optional, TTL handles it)
router.delete(
  "/expired",
  allowRoles(["Head_office"]),
  deleteExpiredLocationPointsController
);

export default router;