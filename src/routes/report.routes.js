import { Router } from "express";
import { authenticate, allowRoles } from "../middlewares/verifyToken.js";

import {
  getAllLeadsReportController,
  getInstallationReportController,
  getExpenseReportController,
  getAttendanceReportController
} from "../controllers/report.controller.js";

const router = Router();

/* ===============================
   LEADS REPORT
================================ */
router.get(
  "/leads",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getAllLeadsReportController
);

/* ===============================
   INSTALLATION REPORT
================================ */
router.get(
  "/installations",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getInstallationReportController
);

/* ===============================
   EXPENSE REPORT
================================ */
router.get(
  "/expenses",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getExpenseReportController
);

/* ===============================
   EXPENSE REPORT
================================ */
router.get(
  "/attendance",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getAttendanceReportController
);

export default router;
