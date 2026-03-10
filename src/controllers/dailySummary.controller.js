import {
  createDailySummaryService,
  getDailySummaryService,
  getDailySummaryByIdService,
  getTeamDailySummaryService,
  getSummaryStatsService,
  updateAttendanceSummaryService,
} from "../services/dailySummary.service.js";
import { sendResponse } from "../utils/response.js";

export const createDailySummaryController = async (req, res, next) => {
  try {
    const data = await createDailySummaryService(req.body, req.user);
    sendResponse(res, 201, "Daily summary created/updated successfully", data);
  } catch (e) {
    next(e);
  }
};

export const getDailySummariesController = async (req, res, next) => {
  try {
    const filters = {
      salesmanId: req.query.salesmanId,
      date: req.query.date,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };
    
    const data = await getDailySummaryService(filters);
    sendResponse(res, 200, "Daily summaries fetched successfully", data);
  } catch (e) {
    next(e);
  }
};

export const getDailySummaryByIdController = async (req, res, next) => {
  try {
    const data = await getDailySummaryByIdService(req.params.id);
    sendResponse(res, 200, "Daily summary fetched successfully", data);
  } catch (e) {
    next(e);
  }
};

export const getTeamDailySummaryController = async (req, res, next) => {
  try {
    const supervisorId = req.user._id;
    const { date } = req.query;
    
    const data = await getTeamDailySummaryService(supervisorId, date);
    sendResponse(res, 200, "Team daily summaries fetched successfully", data);
  } catch (e) {
    next(e);
  }
};

export const getSummaryStatsController = async (req, res, next) => {
  try {
    const salesmanId = req.query.salesmanId || req.user._id;
    const { startDate, endDate } = req.query;
    
    const data = await getSummaryStatsService(salesmanId, startDate, endDate);
    sendResponse(res, 200, "Summary statistics fetched successfully", data);
  } catch (e) {
    next(e);
  }
};

export const updateAttendanceSummaryController = async (req, res, next) => {
  try {
    const { salesmanId, date, attendanceStatus } = req.body;
    const data = await updateAttendanceSummaryService(salesmanId, date, attendanceStatus);
    sendResponse(res, 200, "Attendance summary updated successfully", data);
  } catch (e) {
    next(e);
  }
};