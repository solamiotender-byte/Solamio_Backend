// services/locationPoint.service.js
import LocationPoint from "../models/locationPoint.js";
import { AppError } from "../errors/customError.js";
import User from "../models/user.model.js";
import Attendance from "../models/attendance.model.js";
import Visit from "../models/visit.model.js";
import { assertSameHeadOffice } from "../utils/headOfficeScope.js";
import { getAddressFromCoords } from "../utils/locationUtils.js";
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
const DEFAULT_STAY_MINUTES = 15;
const STAY_RADIUS_KM = 0.15;
const MAX_STAY_ACCURACY_METRES = 150;

const isValidCoordinate = (lat, lng) =>
  Number.isFinite(Number(lat)) &&
  Number.isFinite(Number(lng)) &&
  Number(lat) >= -90 &&
  Number(lat) <= 90 &&
  Number(lng) >= -180 &&
  Number(lng) <= 180;

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

const getDateRange = (date) => {
  const value = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Date().toISOString().split("T")[0];
  const [year, month, day] = value.split("-").map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  return { value, start, end };
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

const pushTravelPoint = (points, point) => {
  if (!isValidCoordinate(point?.lat, point?.lng)) return;
  const normalized = {
    label: point.label,
    type: point.type,
    lat: Number(point.lat),
    lng: Number(point.lng),
    time: point.time ? new Date(point.time) : null,
    address: point.address || null,
  };
  const last = points[points.length - 1];
  if (
    last &&
    Math.abs(last.lat - normalized.lat) < 0.00001 &&
    Math.abs(last.lng - normalized.lng) < 0.00001
  ) {
    return;
  }
  points.push(normalized);
};

const fetchGoogleRoadSegment = async (from, to) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new AppError("GOOGLE_MAPS_API_KEY is not configured", 500);
  }

  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${from.lat},${from.lng}` +
    `&destination=${to.lat},${to.lng}` +
    `&mode=driving&key=${key}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.status !== "OK") {
    throw new Error(data?.error_message || data?.status || "Google Directions API failed");
  }

  const leg = data.routes?.[0]?.legs?.[0];
  if (!leg?.distance?.value) {
    throw new Error("Google Directions API returned no route distance");
  }

  return {
    distanceKm: leg.distance.value / 1000,
    distanceText: leg.distance.text,
    durationMinutes: Math.round((leg.duration?.value || 0) / 60),
    durationText: leg.duration?.text || "",
  };
};

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

const calculateCleanedDistanceStats = (points = []) => {
  const sortedPoints = [...points]
    .filter((point) => isValidCoordinate(point?.lat, point?.lng))
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  let previous = null;
  let totalKm = 0;
  let acceptedSegments = 0;

  for (const point of sortedPoints) {
    const normalized = {
      lat: Number(point.lat),
      lng: Number(point.lng),
      accuracy: Number(point.accuracy || 0),
      recordedAt: point.recordedAt,
    };

    if (normalized.accuracy > 100) continue;

    if (previous) {
      const distanceKm = getValidDistanceKm(previous, normalized);
      if (distanceKm > 0) {
        totalKm += distanceKm;
        acceptedSegments += 1;
      }
    }

    previous = normalized;
  }

  return {
    totalKm: Number(totalKm.toFixed(3)),
    totalPoints: sortedPoints.length,
    acceptedSegments,
    firstRecorded: sortedPoints[0]?.recordedAt || null,
    lastRecorded: sortedPoints[sortedPoints.length - 1]?.recordedAt || null,
  };
};

const geocodeCache = new Map();

const getCachedAddressLabel = async (lat, lng) => {
  const cacheKey = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey);
  }

  const fullAddress = await getAddressFromCoords(Number(lat), Number(lng));
  const shortLabel = String(fullAddress || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");

  const resolved = {
    full: fullAddress || cacheKey,
    short: shortLabel || fullAddress || cacheKey,
  };

  geocodeCache.set(cacheKey, resolved);
  return resolved;
};

const finalizeStayCluster = (cluster, minimumStayMinutes) => {
  if (!cluster?.points?.length) return null;

  const startTime = new Date(cluster.startTime);
  const endTime = new Date(cluster.endTime);
  const durationMs = endTime.getTime() - startTime.getTime();
  const durationMinutes = Math.round(durationMs / 60000);

  if (durationMinutes < minimumStayMinutes) return null;

  const centroidLat =
    cluster.points.reduce((sum, point) => sum + Number(point.lat), 0) / cluster.points.length;
  const centroidLng =
    cluster.points.reduce((sum, point) => sum + Number(point.lng), 0) / cluster.points.length;

  return {
    lat: Number(centroidLat.toFixed(6)),
    lng: Number(centroidLng.toFixed(6)),
    startTime,
    endTime,
    durationMinutes,
    pointCount: cluster.points.length,
  };
};

const addPointToStayCluster = (cluster, point) => {
  const count = cluster.points.length;
  const lat = Number(point.lat);
  const lng = Number(point.lng);

  cluster.anchorLat = ((cluster.anchorLat * count) + lat) / (count + 1);
  cluster.anchorLng = ((cluster.anchorLng * count) + lng) / (count + 1);
  cluster.endTime = point.recordedAt;
  cluster.points.push(point);
};

const buildStayEvents = (points, minimumStayMinutes) => {
  if (!Array.isArray(points) || points.length === 0) return [];

  const sortedPoints = [...points]
    .filter((point) => {
      const accuracy = Number(point?.accuracy || 0);
      return (
        isValidCoordinate(point?.lat, point?.lng) &&
        (!accuracy || accuracy <= MAX_STAY_ACCURACY_METRES)
      );
    })
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  if (sortedPoints.length === 0) return [];

  const stayEvents = [];
  let cluster = {
    anchorLat: Number(sortedPoints[0].lat),
    anchorLng: Number(sortedPoints[0].lng),
    startTime: sortedPoints[0].recordedAt,
    endTime: sortedPoints[0].recordedAt,
    points: [sortedPoints[0]],
  };

  for (let i = 1; i < sortedPoints.length; i += 1) {
    const point = sortedPoints[i];
    const accuracyBufferKm = Math.min(Number(point.accuracy || 0), 80) / 1000;
    const distanceFromAnchor = haversineKm(
      cluster.anchorLat,
      cluster.anchorLng,
      Number(point.lat),
      Number(point.lng)
    );

    if (distanceFromAnchor <= STAY_RADIUS_KM + accuracyBufferKm) {
      addPointToStayCluster(cluster, point);
      continue;
    }

    const finalized = finalizeStayCluster(cluster, minimumStayMinutes);
    if (finalized) stayEvents.push(finalized);

    cluster = {
      anchorLat: Number(point.lat),
      anchorLng: Number(point.lng),
      startTime: point.recordedAt,
      endTime: point.recordedAt,
      points: [point],
    };
  }

  const finalized = finalizeStayCluster(cluster, minimumStayMinutes);
  if (finalized) stayEvents.push(finalized);

  return stayEvents;
};

const summarizeStayEvents = async (stayEvents) => {
  const summaries = [];

  for (const stayEvent of stayEvents) {
    const address = await getCachedAddressLabel(stayEvent.lat, stayEvent.lng);
    summaries.push({
      locationName: address.short,
      address: address.full,
      lat: stayEvent.lat,
      lng: stayEvent.lng,
      visitCount: 1,
      totalDurationMinutes: stayEvent.durationMinutes,
      lastEndTime: stayEvent.endTime,
      events: [stayEvent],
    });
  }

  return summaries
    .sort((a, b) => {
      const aTime = new Date(a.events?.[0]?.startTime || a.lastEndTime).getTime();
      const bTime = new Date(b.events?.[0]?.startTime || b.lastEndTime).getTime();
      return aTime - bTime;
    })
    .map((entry) => ({
      ...entry,
      totalDurationLabel:
        entry.totalDurationMinutes >= 60
          ? `${Math.floor(entry.totalDurationMinutes / 60)}h ${entry.totalDurationMinutes % 60}m`
          : `${entry.totalDurationMinutes} min`,
      events: entry.events
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .map((event) => ({
          ...event,
          durationLabel:
            event.durationMinutes >= 60
              ? `${Math.floor(event.durationMinutes / 60)}h ${event.durationMinutes % 60}m`
              : `${event.durationMinutes} min`,
        })),
    }));
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
// Returns total km travelled after filtering GPS jumps from the raw points.
export const getTotalDistanceService = async (salesmanId, currentUser, date) => {
  try {
    const salesman = await User.findById(salesmanId);
    if (!salesman) throw new AppError("User not found", 404);
    await assertSameHeadOffice(currentUser, salesman);

    const targetDate = date || new Date().toISOString().split("T")[0];
    const points = await LocationPoint.find({
      salesmanId: salesman._id,
      date: targetDate,
    })
      .sort({ recordedAt: 1 })
      .select("lat lng accuracy recordedAt -_id")
      .lean();

    return calculateCleanedDistanceStats(points);
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

export const getStayedLocationsService = async (
  salesmanId,
  currentUser,
  date,
  minimumStayMinutes = DEFAULT_STAY_MINUTES
) => {
  try {
    const salesman = await User.findById(salesmanId);
    if (!salesman) throw new AppError("User not found", 404);
    await assertSameHeadOffice(currentUser, salesman);

    const targetDate = date || new Date().toISOString().split("T")[0];
    const points = await LocationPoint.find({
      salesmanId: salesman._id,
      date: targetDate,
    })
      .sort({ recordedAt: 1 })
      .select("lat lng recordedAt accuracy speed -_id")
      .lean();

    const stayEvents = buildStayEvents(points, Number(minimumStayMinutes) || DEFAULT_STAY_MINUTES);
    const summaries = await summarizeStayEvents(stayEvents);

    return {
      date: targetDate,
      minimumStayMinutes: Number(minimumStayMinutes) || DEFAULT_STAY_MINUTES,
      totalStayedLocations: summaries.length,
      totalStayEvents: stayEvents.length,
      stayedLocations: summaries,
    };
  } catch (e) {
    handleError(e, "Failed to fetch stayed locations");
  }
};

export const getLocationStatsService = async (salesmanId, currentUser, date) => {
  try {
    const salesman = await User.findById(salesmanId);
    if (!salesman) throw new AppError("User not found", 404);
    await assertSameHeadOffice(currentUser, salesman);

    const targetDate = date || new Date().toISOString().split("T")[0];
    const points = await LocationPoint.find({
      salesmanId: salesman._id,
      date: targetDate,
    })
      .sort({ recordedAt: 1 })
      .select("lat lng accuracy speed recordedAt -_id")
      .lean();

    const distanceStats = calculateCleanedDistanceStats(points);
    const speeds = points.map((point) => Number(point.speed || 0));
    const accuracies = points.map((point) => Number(point.accuracy || 0));

    return {
      totalPoints: points.length,
      totalKm: distanceStats.totalKm,
      avgSpeed: speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : 0,
      maxSpeed: speeds.length ? Math.max(...speeds) : 0,
      minSpeed: speeds.length ? Math.min(...speeds) : 0,
      avgAccuracy: accuracies.length
        ? accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length
        : 0,
      firstPoint: distanceStats.firstRecorded,
      lastPoint: distanceStats.lastRecorded,
    };
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

// Historical location points are intentionally retained for old map playback.
export const deleteExpiredLocationPointsService = async () => {
  try {
    return 0;
  } catch (e) {
    handleError(e, "Failed to delete expired location points");
  }
};

// Petrol reimbursement distance: punch-in -> visits -> punch-out by Google road route.
export const getRoadTravelDistanceService = async (salesmanId, currentUser, date) => {
  try {
    const salesman = await User.findById(salesmanId);
    if (!salesman) throw new AppError("User not found", 404);
    await assertSameHeadOffice(currentUser, salesman);

    const { value: targetDate, start, end } = getDateRange(date);

    const attendance = await Attendance.findOne({
      user: salesman._id,
      date: { $gte: start, $lte: end },
    }).lean();

    const visits = await Visit.find({
      user: salesman._id,
      $or: [
        { checkInTime: { $gte: start, $lte: end } },
        { visitDate: { $gte: start, $lte: end } },
        { createdAt: { $gte: start, $lte: end } },
      ],
      coordinates: { $exists: true, $ne: null },
    })
      .sort({ checkInTime: 1, visitDate: 1, createdAt: 1 })
      .select("locationName address coordinates checkInTime visitDate createdAt")
      .lean();

    const points = [];
    if (attendance?.punchIn?.location) {
      pushTravelPoint(points, {
        type: "punch-in",
        label: "Punch In",
        lat: attendance.punchIn.location.lat,
        lng: attendance.punchIn.location.lng,
        time: attendance.punchIn.time,
        address: attendance.punchIn.address,
      });
    }

    for (const visit of visits) {
      if (String(visit.locationName || "").trim().toLowerCase() === "start location") {
        continue;
      }
      pushTravelPoint(points, {
        type: "visit",
        label: visit.locationName || "Visit",
        lat: visit.coordinates?.lat,
        lng: visit.coordinates?.lng,
        time: visit.checkInTime || visit.visitDate || visit.createdAt,
        address: visit.address,
      });
    }

    if (attendance?.punchOut?.location) {
      pushTravelPoint(points, {
        type: "punch-out",
        label: "Punch Out",
        lat: attendance.punchOut.location.lat,
        lng: attendance.punchOut.location.lng,
        time: attendance.punchOut.time,
        address: attendance.punchOut.address,
      });
    }

    if (points.length < 2) {
      return {
        date: targetDate,
        source: "google-road",
        totalKm: 0,
        totalDistanceText: "0 km",
        totalDurationMinutes: 0,
        totalDurationText: "",
        pointCount: points.length,
        segmentCount: 0,
        points,
        segments: [],
      };
    }

    const segments = [];
    let totalKm = 0;
    let totalDurationMinutes = 0;

    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1];
      const to = points[i];
      const road = await fetchGoogleRoadSegment(from, to);
      totalKm += road.distanceKm;
      totalDurationMinutes += road.durationMinutes;
      segments.push({
        from,
        to,
        ...road,
      });
    }

    return {
      date: targetDate,
      source: "google-road",
      totalKm: Math.round(totalKm * 1000) / 1000,
      totalDistanceText: `${(Math.round(totalKm * 10) / 10).toFixed(1)} km`,
      totalDurationMinutes,
      totalDurationText: totalDurationMinutes ? `${totalDurationMinutes} mins` : "",
      pointCount: points.length,
      segmentCount: segments.length,
      points,
      segments,
    };
  } catch (e) {
    handleError(e, "Failed to calculate road travel distance");
  }
};
