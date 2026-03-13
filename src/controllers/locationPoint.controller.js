// controllers/locationPoint.controller.js
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
    // ✅ Basic validation
    const { lat, lng } = req.body;
    if (lat == null || lng == null) {
      return res
        .status(400)
        .json({ success: false, message: "lat and lng are required" });
    }

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
      date:      req.query.date,
      startDate: req.query.startDate,
      endDate:   req.query.endDate,
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

    // ✅ FIX: validate input before hitting the service layer.
    //         Previously undefined/empty points would crash insertMany.
    if (!Array.isArray(points) || points.length === 0) {
      return res.status(400).json({
        success: false,
        message: "points must be a non-empty array",
      });
    }

    // Reject if any point is missing lat/lng
    const invalid = points.some((p) => p.lat == null || p.lng == null);
    if (invalid) {
      return res.status(400).json({
        success: false,
        message: "Every point must have lat and lng",
      });
    }

    const data = await bulkCreateLocationPointsService(points, req.user);
    sendResponse(res, 201, "Location points recorded in bulk successfully", data);
  } catch (e) {
    next(e);
  }
};