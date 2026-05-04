// services/locationPoint.service.js
import LocationPoint from "../models/locationPoint.js";
import { AppError } from "../errors/customError.js";
import User from "../models/user.model.js";
import { assertSameHeadOffice } from "../utils/headOfficeScope.js";

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

const MIN_MOVEMENT_KM = 0.005;
const MAX_REASONABLE_JUMP_KM = 5;
const MAX_REASONABLE_SPEED_KMH = 120;

const getValidDistanceKm = (previousPoint, nextPoint) => {
  if (!previousPoint) return 0;

  const dist = haversineKm(previousPoint.lat, previousPoint.lng, nextPoint.lat, nextPoint.lng);
  if (dist < MIN_MOVEMENT_KM) return 0;

  const previousRecordedAt = previousPoint.recordedAt ? new Date(previousPoint.recordedAt) : null;
  const nextRecordedAt = nextPoint.recordedAt ? new Date(nextPoint.recordedAt) : null;

  if (
    !previousRecordedAt ||
    !nextRecordedAt ||
    Number.isNaN(previousRecordedAt.getTime()) ||
    Number.isNaN(nextRecordedAt.getTime())
  ) {
    return dist <= MAX_REASONABLE_JUMP_KM ? dist : 0;
  }

  const elapsedHours = Math.max(
    (nextRecordedAt.getTime() - previousRecordedAt.getTime()) / (60 * 60 * 1000),
    0
  );
  const maxReasonableDistance = Math.max(
    MAX_REASONABLE_JUMP_KM,
    elapsedHours * MAX_REASONABLE_SPEED_KMH
  );

  return dist <= maxReasonableDistance ? dist : 0;
};

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
      distanceFromPrevious = getValidDistanceKm(lastPoint, {
        lat: data.lat,
        lng: data.lng,
        recordedAt,
      });
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
export const getLocationPointsService = async (salesmanId, currentUser, filters = {}) => {
  try {
    const salesman = await User.findById(salesmanId);
    if (!salesman) throw new AppError("User not found", 404);
    await assertSameHeadOffice(currentUser, salesman);

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
export const getTodayLocationPathService = async (salesmanId, currentUser, options = {}) => {
  try {
    const salesman = await User.findById(salesmanId);
    if (!salesman) throw new AppError("User not found", 404);
    await assertSameHeadOffice(currentUser, salesman);

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
export const getTotalDistanceService = async (salesmanId, currentUser, date) => {
  try {
    const salesman = await User.findById(salesmanId);
    if (!salesman) throw new AppError("User not found", 404);
    await assertSameHeadOffice(currentUser, salesman);

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
export const getLocationStatsService = async (salesmanId, currentUser, date) => {
  try {
    const salesman = await User.findById(salesmanId);
    if (!salesman) throw new AppError("User not found", 404);
    await assertSameHeadOffice(currentUser, salesman);

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

    let prevPoint = lastSaved
      ? {
          lat: lastSaved.lat,
          lng: lastSaved.lng,
          recordedAt: lastSaved.recordedAt,
        }
      : null;

    const pointsWithMetadata = sorted.map((point) => {
      const recordedAt = point.time ? new Date(point.time) : new Date();
      const date       = recordedAt.toISOString().split("T")[0];

      // Calculate distance from previous point
      let distanceFromPrevious = 0;
      if (prevPoint) {
        distanceFromPrevious = getValidDistanceKm(prevPoint, {
          lat: point.lat,
          lng: point.lng,
          recordedAt,
        });
      }

      prevPoint = {
        lat: point.lat,
        lng: point.lng,
        recordedAt,
      };

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
    //console.log(`[LocationCleanup] Deleted ${result.deletedCount} expired points`);
    return result.deletedCount;
  } catch (e) {
    handleError(e, "Failed to delete expired location points");
  }
};
