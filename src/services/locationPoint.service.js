import LocationPoint from "../models/locationPoint.js";
import { AppError } from "../errors/customError.js";

const handleError = (error, msg) => {
  if (error instanceof AppError) throw error;
  throw new AppError(error.message || msg, 500);
};

// Create Location Point
export const createLocationPointService = async (data, currentUser) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const locationPoint = await LocationPoint.create({
      ...data,
      salesmanId: currentUser._id,
      date: today,
      recordedAt: new Date()
    });

    return locationPoint;
  } catch (e) {
    handleError(e, "Failed to create location point");
  }
};

// Get Location Points by Salesman
export const getLocationPointsService = async (salesmanId, filters = {}) => {
  try {
    const query = { salesmanId };
    
    if (filters.date) {
      query.date = filters.date;
    }
    
    if (filters.startDate && filters.endDate) {
      query.date = { $gte: filters.startDate, $lte: filters.endDate };
    }

    const locationPoints = await LocationPoint.find(query)
      .sort({ recordedAt: -1 });

    return locationPoints;
  } catch (e) {
    handleError(e, "Failed to fetch location points");
  }
};

// Get Today's Location Path
export const getTodayLocationPathService = async (salesmanId) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const path = await LocationPoint.find({
      salesmanId,
      date: today
    }).sort({ recordedAt: 1 });

    return path;
  } catch (e) {
    handleError(e, "Failed to fetch today's location path");
  }
};

// Get Location Statistics
export const getLocationStatsService = async (salesmanId, date) => {
  try {
    const query = { salesmanId };
    
    if (date) {
      query.date = date;
    } else {
      const today = new Date().toISOString().split('T')[0];
      query.date = today;
    }

    const stats = await LocationPoint.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalPoints: { $sum: 1 },
          avgSpeed: { $avg: "$speed" },
          maxSpeed: { $max: "$speed" },
          minSpeed: { $min: "$speed" },
          avgAccuracy: { $avg: "$accuracy" },
          firstPoint: { $min: "$recordedAt" },
          lastPoint: { $max: "$recordedAt" }
        }
      }
    ]);

    return stats[0] || {
      totalPoints: 0,
      avgSpeed: 0,
      maxSpeed: 0,
      minSpeed: 0,
      avgAccuracy: 0
    };
  } catch (e) {
    handleError(e, "Failed to fetch location statistics");
  }
};

// Bulk Create Location Points
export const bulkCreateLocationPointsService = async (points, currentUser) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const pointsWithMetadata = points.map(point => ({
      ...point,
      salesmanId: currentUser._id,
      date: today,
      recordedAt: new Date()
    }));

    const createdPoints = await LocationPoint.insertMany(pointsWithMetadata);
    
    return createdPoints;
  } catch (e) {
    handleError(e, "Failed to bulk create location points");
  }
};