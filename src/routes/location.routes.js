// routes/location.routes.js
import express from "express";
import {
  createLocationPointController,
  getLocationPointsController,
  getTodayLocationPathController,
  getLocationStatsController,
  getTotalDistanceController,
  getVerifiedDistanceController,
  getDetectedStopsController,
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

// GET /location/verified-distance?salesmanId=&date=YYYY-MM-DD
// Returns payable KM plus review flags for admin approval.
router.get(
  "/verified-distance",
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getVerifiedDistanceController
);

router.get(
  "/stops",
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getDetectedStopsController
);

router.get(
  "/route-distance",
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  async (req, res, next) => {
    try {
      const { originLat, originLng, destLat, destLng } = req.query;
      if (!originLat || !originLng || !destLat || !destLng) {
        return res.status(400).json({ error: "Missing coordinates" });
      }

      const key = process.env.GOOGLE_MAPS_API_KEY;
      const url =
        `https://maps.googleapis.com/maps/api/directions/json` +
        `?origin=${originLat},${originLng}` +
        `&destination=${destLat},${destLng}` +
        `&mode=driving&key=${key}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === "OK") {
        const leg = data.routes[0].legs[0];
        return res.json({
          distanceKm: leg.distance.value / 1000,
          distanceText: leg.distance.text,
          durationMinutes: Math.round(leg.duration.value / 60),
          durationText: leg.duration.text,
        });
      }

      return res.status(400).json({ error: data.status || "Directions API failed" });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /location/expired — manual cleanup trigger (optional, TTL handles it)
router.delete(
  "/expired",
  allowRoles(["Head_office"]),
  deleteExpiredLocationPointsController
);

export default router;
