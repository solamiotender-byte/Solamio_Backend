import {
  getAllLeadsReportService,
  getInstallationReportService,
  getExpenseReportService,
  getAttendanceReportService,
} from "../services/report.service.js";
import { sendResponse } from "../utils/response.js";

/* ===============================
   ALL LEADS REPORT
================================ */
export const getAllLeadsReportController = async (req, res, next) => {
  try {
    const data = await getAllLeadsReportService(req.query, req.user);
    sendResponse(res, 200, "Leads report fetched", data);
  } catch (e) {
    next(e);
  }
};

/* ===============================
   INSTALLATION REPORT
================================ */
export const getInstallationReportController = async (req, res, next) => {
  try {
    const data = await getInstallationReportService(req.query, req.user);
    sendResponse(res, 200, "Installation report fetched", data);
  } catch (e) {
    next(e);
  }
};

/* ===============================
   EXPENSE REPORT
================================ */
export const getExpenseReportController = async (req, res, next) => {
  try {
    const data = await getExpenseReportService(req.query, req.user);
    sendResponse(res, 200, "Expense report fetched", data);
  } catch (e) {
    next(e);
  }
};

/* ===============================
 ATTENDANCE REPORT
================================ */
export const getAttendanceReportController = async (req, res, next) => {
  try {
    const data = await getAttendanceReportService(req.query, req.user);
    sendResponse(res, 200, "attendance report fetched", data);
  } catch (e) {
    next(e);
  }
};