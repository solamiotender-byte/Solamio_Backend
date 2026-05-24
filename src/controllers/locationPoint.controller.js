// controllers/locationPoint.controller.js
import {
  createLocationPointService,
  getLocationPointsService,
  getTodayLocationPathService,
  getLocationStatsService,
  getTotalDistanceService,
  getVerifiedDistanceService,
  bulkCreateLocationPointsService,
  deleteExpiredLocationPointsService,
} from "../services/locationPoint.service.js";
import { sendResponse } from "../utils/response.js";

export const createLocationPointController = async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    if (lat == null || lng == null)
      return res.status(400).json({ success: false, message: "lat and lng are required" });

    // Tracking is via socket — this REST route is unused
    sendResponse(res, 200, "Tracking is handled via socket", null);
  } catch (e) { next(e); }
};


export const getLocationPointsController = async (req, res, next) => {
  try {
    const salesmanId = req.query.salesmanId || req.user._id;
    const filters = {
      date:      req.query.date,
      startDate: req.query.startDate,
      endDate:   req.query.endDate,
    };
    const data = await getLocationPointsService(salesmanId, req.user, filters);
    sendResponse(res, 200, "Location points fetched successfully", data);
  } catch (e) { next(e); }
};

// GET /location/today?salesmanId=&startTime=&endTime=
export const getTodayLocationPathController = async (req, res, next) => {
  try {
    const salesmanId = req.query.salesmanId || req.user._id;
    const options = {
      startTime: req.query.startTime || null,
      endTime:   req.query.endTime   || null,
    };
    const data = await getTodayLocationPathService(salesmanId, req.user, options);
    sendResponse(res, 200, "Today's location path fetched successfully", data);
  } catch (e) { next(e); }
};

export const getLocationStatsController = async (req, res, next) => {
  try {
    const salesmanId = req.query.salesmanId || req.user._id;
    const { date } = req.query;
    const data = await getLocationStatsService(salesmanId, req.user, date);
    sendResponse(res, 200, "Location statistics fetched successfully", data);
  } catch (e) { next(e); }
};

// GET /location/distance?salesmanId=&date=YYYY-MM-DD
// Returns total km travelled for a given day
export const getTotalDistanceController = async (req, res, next) => {
  try {
    const salesmanId = req.query.salesmanId || req.user._id;
    const { date }   = req.query;
    const data       = await getTotalDistanceService(salesmanId, req.user, date);
    sendResponse(res, 200, "Total distance fetched successfully", data);
  } catch (e) { next(e); }
};

// GET /location/verified-distance?salesmanId=&date=YYYY-MM-DD
// Returns payable KM with review flags for poor GPS, jumps, and tracking gaps.
export const getVerifiedDistanceController = async (req, res, next) => {
  try {
    const salesmanId = req.query.salesmanId || req.user._id;
    const { date } = req.query;
    const data = await getVerifiedDistanceService(salesmanId, req.user, date);
    sendResponse(res, 200, "Verified payable distance fetched successfully", data);
  } catch (e) { next(e); }
};

export const bulkCreateLocationPointsController = async (req, res, next) => {
  try {
    const { points } = req.body;

    if (!Array.isArray(points) || points.length === 0)
      return res.status(400).json({ success: false, message: "points must be a non-empty array" });

    const invalid = points.some((p) => p.lat == null || p.lng == null);
    if (invalid)
      return res.status(400).json({ success: false, message: "Every point must have lat and lng" });

    const data = await bulkCreateLocationPointsService(points, req.user);
    sendResponse(res, 201, "Location points recorded in bulk successfully", data);
  } catch (e) { next(e); }
};

export const deleteExpiredLocationPointsController = async (req, res, next) => {
  try {
    const deletedCount = await deleteExpiredLocationPointsService();
    sendResponse(res, 200, `Deleted ${deletedCount} expired location points`, { deletedCount });
  } catch (e) { next(e); }
};
