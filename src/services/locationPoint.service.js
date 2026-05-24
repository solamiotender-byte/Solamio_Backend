// services/locationPoint.service.js
import LocationPoint from "../models/locationPoint.js";
import { AppError } from "../errors/customError.js";
import User from "../models/user.model.js";
import { assertSameHeadOffice } from "../utils/headOfficeScope.js";
import mongoose from "mongoose";

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

const distanceMeters = (a, b) => haversineKm(a.lat, a.lng, b.lat, b.lng) * 1000;

const MIN_MOVEMENT_KM = 0.005;
const MAX_REASONABLE_JUMP_KM = 5;
const MAX_REASONABLE_SPEED_KMH = 120;
const PAYABLE_MIN_MOVEMENT_KM = 0.03;
const PAYABLE_MAX_ACCURACY_METERS = 80;
const PAYABLE_MAX_SPEED_KMH = 100;
const PAYABLE_LARGE_GAP_MINUTES = 10;
const PAYABLE_MAX_SEGMENT_KM = 3;
const STOP_RADIUS_METERS = 75;
const STOP_MIN_DURATION_MINUTES = 15;
const STOP_MAX_ACCURACY_METERS = 120;

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

const toDateString = (date = new Date()) => {
  const normalized = date instanceof Date ? date : new Date(date);
  const year = normalized.getFullYear();
  const month = String(normalized.getMonth() + 1).padStart(2, "0");
  const day = String(normalized.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDayRange = (date) => {
  const target = date || toDateString();
  const [year, month, day] = String(target).split("-").map(Number);
  const valid = Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day);
  const start = valid ? new Date(year, month - 1, day, 0, 0, 0, 0) : new Date();
  if (!valid) start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { targetDate: toDateString(start), start, end };
};

const getPointTime = (point) => {
  const time = point?.recordedAt ? new Date(point.recordedAt).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
};

const buildFlag = (code, message, severity = "warning", meta = {}) => ({
  code,
  message,
  severity,
  ...meta,
});

const buildAuditSegment = (from, to, status, reason, segmentKm = 0, speedKmh = 0) => ({
  from: { lat: Number(from.lat), lng: Number(from.lng), recordedAt: from.recordedAt || null },
  to: { lat: Number(to.lat), lng: Number(to.lng), recordedAt: to.recordedAt || null },
  status,
  reason,
  distanceKm: Math.round(segmentKm * 1000) / 1000,
  speedKmh: Math.round(speedKmh * 10) / 10,
});

const calculateVerifiedDistance = (points = []) => {
  const sorted = [...points]
    .filter((point) => Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)))
    .sort((a, b) => (getPointTime(a) || 0) - (getPointTime(b) || 0));

  const flags = [];
  const acceptedPoints = [];
  let payableKm = 0;
  let rawKm = 0;
  let rejectedPoints = 0;
  let poorAccuracyPoints = 0;
  let impossibleSpeedSegments = 0;
  let largeJumpSegments = 0;
  let offlineGapSegments = 0;
  let duplicateOrNoisePoints = 0;
  const auditSegments = [];

  for (const point of sorted) {
    const accuracy = Number(point.accuracy || 0);
    if (accuracy > PAYABLE_MAX_ACCURACY_METERS) {
      poorAccuracyPoints += 1;
      rejectedPoints += 1;
      if (acceptedPoints.length) {
        const previous = acceptedPoints[acceptedPoints.length - 1];
        const segmentKm = haversineKm(previous.lat, previous.lng, point.lat, point.lng);
        auditSegments.push(buildAuditSegment(
          previous,
          point,
          "rejected",
          "Poor GPS accuracy",
          segmentKm
        ));
      }
      continue;
    }

    if (!acceptedPoints.length) {
      acceptedPoints.push(point);
      continue;
    }

    const previous = acceptedPoints[acceptedPoints.length - 1];
    const segmentKm = haversineKm(previous.lat, previous.lng, point.lat, point.lng);
    const previousTime = getPointTime(previous);
    const currentTime = getPointTime(point);
    const elapsedHours =
      previousTime && currentTime ? Math.max((currentTime - previousTime) / 3600000, 0) : 0;
    const speedKmh = elapsedHours > 0 ? segmentKm / elapsedHours : 0;

    rawKm += segmentKm;

    if (segmentKm < PAYABLE_MIN_MOVEMENT_KM) {
      duplicateOrNoisePoints += 1;
      rejectedPoints += 1;
      auditSegments.push(buildAuditSegment(
        previous,
        point,
        "rejected",
        "GPS noise or very small movement",
        segmentKm,
        speedKmh
      ));
      continue;
    }

    const hasLargeGap = elapsedHours > PAYABLE_LARGE_GAP_MINUTES / 60;
    if (elapsedHours > PAYABLE_LARGE_GAP_MINUTES / 60) {
      offlineGapSegments += 1;
    }

    if (segmentKm > PAYABLE_MAX_SEGMENT_KM) {
      largeJumpSegments += 1;
      rejectedPoints += 1;
      auditSegments.push(buildAuditSegment(
        previous,
        point,
        "rejected",
        "Large GPS jump",
        segmentKm,
        speedKmh
      ));
      continue;
    }

    if (speedKmh > PAYABLE_MAX_SPEED_KMH) {
      impossibleSpeedSegments += 1;
      rejectedPoints += 1;
      auditSegments.push(buildAuditSegment(
        previous,
        point,
        "rejected",
        "Impossible travel speed",
        segmentKm,
        speedKmh
      ));
      continue;
    }

    payableKm += segmentKm;
    auditSegments.push(buildAuditSegment(
      previous,
      point,
      hasLargeGap ? "review" : "payable",
      hasLargeGap ? "Tracking gap, review before payment" : "Verified payable movement",
      segmentKm,
      speedKmh
    ));
    acceptedPoints.push(point);
  }

  if (poorAccuracyPoints) {
    flags.push(buildFlag(
      "POOR_GPS_ACCURACY",
      `${poorAccuracyPoints} point(s) ignored because GPS accuracy was poor.`,
      "warning",
      { count: poorAccuracyPoints }
    ));
  }

  if (offlineGapSegments) {
    flags.push(buildFlag(
      "TRACKING_GAP",
      `${offlineGapSegments} tracking gap(s) above ${PAYABLE_LARGE_GAP_MINUTES} minutes found. Review before payment.`,
      "review",
      { count: offlineGapSegments }
    ));
  }

  if (largeJumpSegments) {
    flags.push(buildFlag(
      "LARGE_GPS_JUMP",
      `${largeJumpSegments} large jump segment(s) ignored.`,
      "review",
      { count: largeJumpSegments }
    ));
  }

  if (impossibleSpeedSegments) {
    flags.push(buildFlag(
      "IMPOSSIBLE_SPEED",
      `${impossibleSpeedSegments} segment(s) ignored because speed was too high.`,
      "review",
      { count: impossibleSpeedSegments }
    ));
  }

  if (acceptedPoints.length < 2 && sorted.length > 0) {
    flags.push(buildFlag(
      "INSUFFICIENT_VALID_POINTS",
      "Not enough valid GPS movement points to calculate payable KM.",
      "review"
    ));
  }

  return {
    payableKm: Math.round(payableKm * 1000) / 1000,
    rawKm: Math.round(rawKm * 1000) / 1000,
    acceptedPoints: acceptedPoints.length,
    rejectedPoints,
    totalPoints: sorted.length,
    duplicateOrNoisePoints,
    auditSegments,
    flags,
    firstRecorded: sorted[0]?.recordedAt || null,
    lastRecorded: sorted[sorted.length - 1]?.recordedAt || null,
    rules: {
      maxAccuracyMeters: PAYABLE_MAX_ACCURACY_METERS,
      maxSpeedKmh: PAYABLE_MAX_SPEED_KMH,
      largeGapMinutes: PAYABLE_LARGE_GAP_MINUTES,
      minMovementKm: PAYABLE_MIN_MOVEMENT_KM,
      maxSegmentKm: PAYABLE_MAX_SEGMENT_KM,
    },
  };
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
    const userObjectId = new mongoose.Types.ObjectId(String(salesmanId));

    const result = await LocationPoint.aggregate([
      { $match: { salesmanId: userObjectId, date: targetDate } },
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

export const getVerifiedDistanceService = async (salesmanId, currentUser, date) => {
  try {
    const salesman = await User.findById(salesmanId);
    if (!salesman) throw new AppError("User not found", 404);
    await assertSameHeadOffice(currentUser, salesman);

    const { targetDate, start, end } = getDayRange(date);
    const userObjectId = new mongoose.Types.ObjectId(String(salesmanId));
    const points = await LocationPoint.find({
      salesmanId: userObjectId,
      recordedAt: { $gte: start, $lte: end },
    })
      .sort({ recordedAt: 1 })
      .select("lat lng accuracy speed distanceFromPrevious recordedAt -_id")
      .lean();

    return {
      salesmanId,
      date: targetDate,
      ...calculateVerifiedDistance(points),
    };
  } catch (e) {
    handleError(e, "Failed to calculate verified payable distance");
  }
};

// ─── Get Location Statistics ──────────────────────────────────────────────────
const buildDetectedStops = (points = []) => {
  const validPoints = points
    .filter((point) =>
      Number.isFinite(Number(point.lat)) &&
      Number.isFinite(Number(point.lng)) &&
      Number(point.accuracy || 0) <= STOP_MAX_ACCURACY_METERS
    )
    .sort((a, b) => (getPointTime(a) || 0) - (getPointTime(b) || 0));

  const stops = [];
  let cluster = [];

  const flushCluster = () => {
    if (cluster.length < 2) {
      cluster = [];
      return;
    }

    const startedAt = getPointTime(cluster[0]);
    const endedAt = getPointTime(cluster[cluster.length - 1]);
    const durationMinutes = startedAt && endedAt
      ? Math.round((endedAt - startedAt) / 60000)
      : 0;

    if (durationMinutes >= STOP_MIN_DURATION_MINUTES) {
      const lat = cluster.reduce((sum, point) => sum + Number(point.lat), 0) / cluster.length;
      const lng = cluster.reduce((sum, point) => sum + Number(point.lng), 0) / cluster.length;
      stops.push({
        id: `stop-${stops.length + 1}-${startedAt || Date.now()}`,
        locationName: `Stopped ${durationMinutes} min`,
        status: "Auto Stop",
        lat: Math.round(lat * 1000000) / 1000000,
        lng: Math.round(lng * 1000000) / 1000000,
        address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        checkInTime: cluster[0].recordedAt,
        checkOutTime: cluster[cluster.length - 1].recordedAt,
        dwellMinutes: durationMinutes,
        pointCount: cluster.length,
        autoDetected: true,
      });
    }

    cluster = [];
  };

  for (const point of validPoints) {
    if (!cluster.length) {
      cluster = [point];
      continue;
    }

    const anchor = cluster[0];
    const previousTime = getPointTime(cluster[cluster.length - 1]);
    const currentTime = getPointTime(point);
    const gapMinutes = previousTime && currentTime ? (currentTime - previousTime) / 60000 : 0;

    if (distanceMeters(anchor, point) <= STOP_RADIUS_METERS && gapMinutes <= STOP_MIN_DURATION_MINUTES) {
      cluster.push(point);
    } else {
      flushCluster();
      cluster = [point];
    }
  }

  flushCluster();
  return stops;
};

export const getDetectedStopsService = async (salesmanId, currentUser, date) => {
  try {
    const salesman = await User.findById(salesmanId);
    if (!salesman) throw new AppError("User not found", 404);
    await assertSameHeadOffice(currentUser, salesman);

    const { targetDate, start, end } = getDayRange(date);
    const userObjectId = new mongoose.Types.ObjectId(String(salesmanId));
    const points = await LocationPoint.find({
      salesmanId: userObjectId,
      recordedAt: { $gte: start, $lte: end },
    })
      .sort({ recordedAt: 1 })
      .select("lat lng accuracy recordedAt -_id")
      .lean();

    return {
      salesmanId,
      date: targetDate,
      radiusMeters: STOP_RADIUS_METERS,
      minDurationMinutes: STOP_MIN_DURATION_MINUTES,
      stops: buildDetectedStops(points),
    };
  } catch (e) {
    handleError(e, "Failed to detect stop locations");
  }
};

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
