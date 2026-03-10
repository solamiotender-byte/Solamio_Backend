import express from "express";
import {
  createDailySummaryController,
  getDailySummariesController,
  getDailySummaryByIdController,
 // getTeamDailySummaryController,
  getSummaryStatsController,
  // updateAttendanceSummaryController,
} from "../controllers/dailySummary.controller.js";
import { authenticate, allowRoles } from "../middlewares/verifyToken.js";

const router = express.Router();

router.use(authenticate);

// Daily summary routes
router.post("/", createDailySummaryController);
router.get("/", getDailySummariesController);
router.get("/stats", getSummaryStatsController);
router.get("/:id", getDailySummaryByIdController);

// // Team summary (for supervisors)
// router.get("/team/summary", authorize(["ZSM", "ASM"]), getTeamDailySummaryController);

// // Admin routes
// router.put("/attendance", authorize(["Head_office", "ZSM", "ASM"]), updateAttendanceSummaryController);

export default router;