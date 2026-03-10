import express from "express";
import {
  createLocationPointController,
  getLocationPointsController,
  getTodayLocationPathController,
  getLocationStatsController,
  bulkCreateLocationPointsController,
  //getTeamLocationPathController,
} from "../controllers/locationPoint.controller.js";
import { authenticate, allowRoles } from "../middlewares/verifyToken.js";

const router = express.Router();

router.use(authenticate);

// Location tracking routes
router.post("/track", createLocationPointController);
router.post("/track/bulk", bulkCreateLocationPointsController);
router.get("/", getLocationPointsController);
router.get("/today", getTodayLocationPathController);
router.get("/stats", getLocationStatsController);

// Team location tracking (for supervisors - real-time monitoring)
//router.get("/team/track", allowRoles(["ZSM", "ASM"]), getTeamLocationPathController);

export default router;