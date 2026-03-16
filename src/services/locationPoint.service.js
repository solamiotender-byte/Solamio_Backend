// services/locationPoint.service.js
import LocationPoint from "../models/locationPoint.js";
import { AppError } from "../errors/customError.js";

const handleError = (error, msg) => {
  if (error instanceof AppError) throw error;
  throw new AppError(error.message || msg, 500);
};

// ─── Haversine formula — distance in km between two lat/lng points ────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Create single Location Point ────────────────────────────────────────────
export const createLocationPointService = async (data, currentUser) => {
  try {
    const today      = new Date().toISOString().split("T")[0];
    const recordedAt = data.time ? new Date(data.time) : new Date();
    const date       = data.date || recordedAt.toISOString().split("T")[0];

    // Find last point for this salesman today to calculate distance
    const lastPoint = await LocationPoint.findOne(
      { salesmanId: currentUser._id, date },
      {},
      { sort: { recordedAt: -1 } }
    );

    let distanceFromPrevious = 0;
    if (lastPoint) {
      const dist = haversineKm(lastPoint.lat, lastPoint.lng, data.lat, data.lng);
      // Ignore impossible jumps > 5km (bad GPS fix)
      distanceFromPrevious = dist <= 5 ? dist : 0;
    }

    const locationPoint = await LocationPoint.create({
      ...data,
      salesmanId:           currentUser._id,
      date,
      recordedAt,
      distanceFromPrevious,
      expiresAt: new Date(recordedAt.getTime() + 24 * 60 * 60 * 1000),
    });

    return locationPoint;
  } catch (e) {
    handleError(e, "Failed to create location point");
  }
};

// ─── Get Location Points by Salesman ─────────────────────────────────────────
export const getLocationPointsService = async (salesmanId, filters = {}) => {
  try {
    const query = { salesmanId };

    if (filters.date) {
      query.date = filters.date;
    } else if (filters.startDate && filters.endDate) {
      query.date = { $gte: filters.startDate, $lte: filters.endDate };
    }

    const locationPoints = await LocationPoint.find(query).sort({ recordedAt: -1 });
    return locationPoints;
  } catch (e) {
    handleError(e, "Failed to fetch location points");
  }
};

// ─── Get Today's Location Path (last 24 hours) ───────────────────────────────
export const getTodayLocationPathService = async (salesmanId, options = {}) => {
  try {
    let query = { salesmanId };

    if (options.startTime && options.endTime) {
      // Precise 24h window using recordedAt timestamps
      query.recordedAt = {
        $gte: new Date(options.startTime),
        $lte: new Date(options.endTime),
      };
    } else {
      // Fallback: today's date string
      const today = new Date().toISOString().split("T")[0];
      query.date = today;
    }

    const path = await LocationPoint.find(query)
      .sort({ recordedAt: 1 })
      .select("lat lng accuracy speed distanceFromPrevious recordedAt -_id");

    return path;
  } catch (e) {
    handleError(e, "Failed to fetch today's location path");
  }
};

// ─── Get Total Distance for a Date ───────────────────────────────────────────
// Returns total km travelled by summing distanceFromPrevious for all points.
export const getTotalDistanceService = async (salesmanId, date) => {
  try {
    const targetDate = date || new Date().toISOString().split("T")[0];

    const result = await LocationPoint.aggregate([
      { $match: { salesmanId, date: targetDate } },
      {
        $group: {
          _id:           null,
          totalKm:       { $sum: "$distanceFromPrevious" },
          totalPoints:   { $sum: 1 },
          firstRecorded: { $min: "$recordedAt" },
          lastRecorded:  { $max: "$recordedAt" },
        },
      },
    ]);

    return result[0] || {
      totalKm:       0,
      totalPoints:   0,
      firstRecorded: null,
      lastRecorded:  null,
    };
  } catch (e) {
    handleError(e, "Failed to calculate total distance");
  }
};

// ─── Get Location Statistics ──────────────────────────────────────────────────
export const getLocationStatsService = async (salesmanId, date) => {
  try {
    const targetDate = date || new Date().toISOString().split("T")[0];

    const stats = await LocationPoint.aggregate([
      { $match: { salesmanId, date: targetDate } },
      {
        $group: {
          _id:           null,
          totalPoints:   { $sum: 1 },
          totalKm:       { $sum: "$distanceFromPrevious" },   // ← total distance
          avgSpeed:      { $avg: "$speed" },
          maxSpeed:      { $max: "$speed" },
          minSpeed:      { $min: "$speed" },
          avgAccuracy:   { $avg: "$accuracy" },
          firstPoint:    { $min: "$recordedAt" },
          lastPoint:     { $max: "$recordedAt" },
        },
      },
    ]);

    return (
      stats[0] || {
        totalPoints: 0,
        totalKm:     0,
        avgSpeed:    0,
        maxSpeed:    0,
        minSpeed:    0,
        avgAccuracy: 0,
        firstPoint:  null,
        lastPoint:   null,
      }
    );
  } catch (e) {
    handleError(e, "Failed to fetch location statistics");
  }
};

// ─── Bulk Create Location Points ─────────────────────────────────────────────
export const bulkCreateLocationPointsService = async (points, currentUser) => {
  try {
    // Sort by time ascending so distance calc is in correct order
    const sorted = [...points].sort((a, b) => {
      const ta = a.time ? new Date(a.time) : 0;
      const tb = b.time ? new Date(b.time) : 0;
      return ta - tb;
    });

    // Get the very last saved point for this salesman to chain distance from
    const firstPt    = sorted[0];
    const firstDate  = firstPt.time
      ? new Date(firstPt.time).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];

    const lastSaved = await LocationPoint.findOne(
      { salesmanId: currentUser._id, date: firstDate },
      {},
      { sort: { recordedAt: -1 } }
    );

    let prevLat = lastSaved?.lat ?? null;
    let prevLng = lastSaved?.lng ?? null;

    const pointsWithMetadata = sorted.map((point) => {
      const recordedAt = point.time ? new Date(point.time) : new Date();
      const date       = recordedAt.toISOString().split("T")[0];

      // Calculate distance from previous point
      let distanceFromPrevious = 0;
      if (prevLat !== null && prevLng !== null) {
        const dist = haversineKm(prevLat, prevLng, point.lat, point.lng);
        distanceFromPrevious = dist <= 5 ? dist : 0; // ignore bad jumps > 5km
      }

      prevLat = point.lat;
      prevLng = point.lng;

      return {
        ...point,
        salesmanId:           currentUser._id,
        date,
        recordedAt,
        distanceFromPrevious,
        expiresAt: new Date(recordedAt.getTime() + 24 * 60 * 60 * 1000),
      };
    });

    const createdPoints = await LocationPoint.insertMany(pointsWithMetadata, {
      ordered: false,
    });

    return createdPoints;
  } catch (e) {
    handleError(e, "Failed to bulk create location points");
  }
};

// ─── Delete location points older than 24 hours (safety net) ─────────────────
export const deleteExpiredLocationPointsService = async () => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await LocationPoint.deleteMany({ recordedAt: { $lt: cutoff } });
    console.log(`[LocationCleanup] Deleted ${result.deletedCount} expired points`);
    return result.deletedCount;
  } catch (e) {
    handleError(e, "Failed to delete expired location points");
  }
};