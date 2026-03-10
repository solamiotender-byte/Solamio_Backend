import {
  createLocationPointService,
  getLocationPointsService,
  getTodayLocationPathService,
  getLocationStatsService,
  bulkCreateLocationPointsService,
} from "../services/locationPoint.service.js";
import { sendResponse } from "../utils/response.js";

export const createLocationPointController = async (req, res, next) => {
  try {
    const data = await createLocationPointService(req.body, req.user);
    sendResponse(res, 201, "Location point recorded successfully", data);
  } catch (e) {
    next(e);
  }
};

export const getLocationPointsController = async (req, res, next) => {
  try {
    const salesmanId = req.query.salesmanId || req.user._id;
    const filters = {
      date: req.query.date,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };
    
    const data = await getLocationPointsService(salesmanId, filters);
    sendResponse(res, 200, "Location points fetched successfully", data);
  } catch (e) {
    next(e);
  }
};

export const getTodayLocationPathController = async (req, res, next) => {
  try {
    const salesmanId = req.query.salesmanId || req.user._id;
    const data = await getTodayLocationPathService(salesmanId);
    sendResponse(res, 200, "Today's location path fetched successfully", data);
  } catch (e) {
    next(e);
  }
};

export const getLocationStatsController = async (req, res, next) => {
  try {
    const salesmanId = req.query.salesmanId || req.user._id;
    const { date } = req.query;
    
    const data = await getLocationStatsService(salesmanId, date);
    sendResponse(res, 200, "Location statistics fetched successfully", data);
  } catch (e) {
    next(e);
  }
};

export const bulkCreateLocationPointsController = async (req, res, next) => {
  try {
    const { points } = req.body;
    const data = await bulkCreateLocationPointsService(points, req.user);
    sendResponse(res, 201, "Location points recorded in bulk successfully", data);
  } catch (e) {
    next(e);
  }
};