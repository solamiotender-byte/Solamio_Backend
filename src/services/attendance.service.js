// services/attendance.service.js
import Attendance from "../models/attendance.model.js";
import AttendanceSetting from "../models/attendanceSetting.model.js";
import User from "../models/user.model.js";
import LocationPoint from "../models/locationPoint.js";
import { AppError } from "../errors/customError.js";
import { getAddressFromCoords } from "../utils/locationUtils.js";
import Visit from '../models/visit.model.js'
import mongoose from "mongoose";
import {
  assertSameHeadOffice,
  getHeadOfficeScopedUserIds,
} from "../utils/headOfficeScope.js";

const MIN_MOVEMENT_KM = 0.005;
const MAX_REASONABLE_JUMP_KM = 5;
const MAX_REASONABLE_SPEED_KMH = 120;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const getAttendanceSetting = async () => {
  let setting = await AttendanceSetting.findOne({ key: "default" });
  if (!setting) setting = await AttendanceSetting.create({ key: "default" });
  return setting;
};

const isValidTimeValue = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));

const timeToMinutes = (value) => {
  const [hours, minutes] = String(value).split(":").map(Number);
  return hours * 60 + minutes;
};

const getIstParts = (date) => {
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: istDate.getUTCFullYear(),
    month: istDate.getUTCMonth(),
    day: istDate.getUTCDate(),
    minutes: istDate.getUTCHours() * 60 + istDate.getUTCMinutes(),
  };
};

const getUtcDateForIstTime = (sourceDate, timeValue) => {
  const { year, month, day } = getIstParts(sourceDate);
  const [hours, minutes] = String(timeValue).split(":").map(Number);
  return new Date(Date.UTC(year, month, day, hours, minutes, 0, 0) - IST_OFFSET_MS);
};

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

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

const storeAttendanceLocationPoint = async ({
  userId,
  latitude,
  longitude,
  accuracy = 0,
  speed = 0,
  recordedAt,
}) => {
  if (latitude == null || longitude == null || !recordedAt) return;

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const date = new Date(recordedAt).toISOString().split("T")[0];
  const lastPoint = await LocationPoint.findOne(
    { salesmanId: userId, date },
    { lat: 1, lng: 1, recordedAt: 1 },
    { sort: { recordedAt: -1 } }
  );

  let distanceFromPrevious = 0;
  if (lastPoint) {
    distanceFromPrevious = getValidDistanceKm(lastPoint, {
      lat,
      lng,
      recordedAt,
    });
  }

  await LocationPoint.create({
    salesmanId: userId,
    date,
    lat,
    lng,
    accuracy: Number(accuracy ?? 0),
    speed: Number(speed ?? 0),
    recordedAt,
    distanceFromPrevious,
  });
};



/* ================= PUNCH IN ================= */
export const punchInService = async (data, currentUser, files = []) => {
  try {
    const { latitude, longitude, batteryPercentage, isCharging, time } = data;

    if (!latitude || !longitude) {
      throw new AppError("Location coordinates are required for punch in", 400);
    }

    const punchInTime = time ? new Date(time) : new Date();
    if (Number.isNaN(punchInTime.getTime())) {
      throw new AppError("Invalid punch-in time", 400);
    }

    const attendanceSetting = await getAttendanceSetting();
    if (attendanceSetting.blockEarlyPunchIn) {
      const punchInMinutes = getIstParts(punchInTime).minutes;
      const officeStartMinutes = timeToMinutes(attendanceSetting.officePunchInTime);
      if (punchInMinutes < officeStartMinutes) {
        throw new AppError(`Punch in is allowed after ${attendanceSetting.officePunchInTime}.`, 400);
      }
    }

    /* ===============================
       CHECK TODAY ATTENDANCE
    =============================== */

    const today = new Date(punchInTime);
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const existingAttendance = await Attendance.findOne({
      user: currentUser._id,
      date: { $gte: today, $lt: tomorrow }
    });

    if (existingAttendance?.punchIn?.time) {
      throw new AppError("Already punched in today", 400);
    }

    /* ===============================
       GET ADDRESS
    =============================== */

    let address = "Address not available";

    if (latitude && longitude) {
      const geoAddress = await getAddressFromCoords(
        parseFloat(latitude),
        parseFloat(longitude)
      );
      if (geoAddress) address = geoAddress;
    }

    /* ===============================
       PUNCH IN DATA
    =============================== */

    const punchInData = {
      time: punchInTime,
      location: {
        lat: parseFloat(latitude),
        lng: parseFloat(longitude)
      },
      address,
      ...(batteryPercentage !== undefined && batteryPercentage !== null
        ? {
            battery: {
              percentage: Number(batteryPercentage),
              isCharging: Boolean(isCharging),
              recordedAt: new Date(),
            }
          }
        : {})
    };

    let attendance;

    if (existingAttendance) {
      existingAttendance.punchIn = punchInData;
      existingAttendance.status = "present";
      if (batteryPercentage !== undefined && batteryPercentage !== null) {
        const existingMetadata = existingAttendance.metadata instanceof Map
          ? Object.fromEntries(existingAttendance.metadata)
          : (existingAttendance.metadata || {});
        existingAttendance.metadata = {
          ...existingMetadata,
          batteryAtPunchIn: {
            percentage: Number(batteryPercentage),
            isCharging: Boolean(isCharging),
            recordedAt: new Date(),
          },
        };
      }
      await existingAttendance.save();
      attendance = existingAttendance;
    } else {
      attendance = await Attendance.create({
        user: currentUser._id,
        date: punchInTime,
        punchIn: punchInData,
        status: "present",
        workHours: 0,
        overtime: 0,
        ...(batteryPercentage !== undefined && batteryPercentage !== null
          ? {
              metadata: {
                batteryAtPunchIn: {
                  percentage: Number(batteryPercentage),
                  isCharging: Boolean(isCharging),
                  recordedAt: new Date(),
                },
              },
            }
          : {})
      });
    }

    await storeAttendanceLocationPoint({
      userId: currentUser._id,
      latitude,
      longitude,
      accuracy: data.accuracy,
      speed: data.speed,
      recordedAt: punchInTime,
    });

    /* ===============================
       CREATE FIRST VISIT (START POINT)
    =============================== */

    const firstVisit = await Visit.create({
      user: currentUser._id,
      attendance: attendance._id,
      locationName: "Start Location",
      address,
      coordinates: {
        lat: parseFloat(latitude),
        lng: parseFloat(longitude)
      },
      status: "InProgress",
      checkInTime: punchInTime,
      checkOutTime: punchInTime,
      visitDate: punchInTime,
      timeSpentMinutes: 0,
      distanceFromPreviousKm: 0,
      totalDistanceTillNowKm: 0,
      travelTimeMinutes: 0
    });

    /* ===============================
       RETURN DATA
    =============================== */

    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate("user", "firstName lastName email phone");

    return {
      attendance: populatedAttendance,
      firstVisit
    };

  } catch (error) {
    console.error("Punch In Service Error:", error);
    if (error instanceof AppError) throw error;
    throw new AppError(error.message || "Failed to punch in", 500);
  }
};


/* ================= PUNCH OUT ================= */
export const punchOutService = async (data, currentUser, files = []) => {
  try {
    const { latitude, longitude, batteryPercentage, isCharging, time } = data;

    if (!latitude || !longitude) {
      throw new AppError("Location coordinates are required for punch out", 400);
    }

    const punchOutTime = time ? new Date(time) : new Date();
    if (Number.isNaN(punchOutTime.getTime())) {
      throw new AppError("Invalid punch-out time", 400);
    }

    const today = new Date(punchOutTime);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const attendance = await Attendance.findOne({
      user: currentUser._id,
      date: { $gte: today, $lt: tomorrow }
    });

    if (!attendance) {
      throw new AppError("No punch-in record found for today", 404);
    }

    if (!attendance.punchIn || !attendance.punchIn.time) {
      throw new AppError("Please punch in first", 400);
    }

    if (attendance.punchOut && attendance.punchOut.time) {
      throw new AppError("Already punched out today", 400);
    }

    let address = null;
    if (latitude && longitude) {
      address = await getAddressFromCoords(parseFloat(latitude), parseFloat(longitude));
    }

    const workMs = punchOutTime - new Date(attendance.punchIn.time);
    const workHours = Number((workMs / (1000 * 60 * 60)).toFixed(2));

    // Manual punch-out — NOT a missed punch-out
    attendance.punchOut = {
      time: punchOutTime,
      location: {
        lat: parseFloat(latitude),
        lng: parseFloat(longitude)
      },
      address: address || "Address not available",
      ...(batteryPercentage !== undefined && batteryPercentage !== null
        ? {
            battery: {
              percentage: Number(batteryPercentage),
              isCharging: Boolean(isCharging),
              recordedAt: new Date(),
            },
          }
        : {}),
      isAutoPunchOut: false                // ← user did this manually
    };
    attendance.workHours = workHours;
    attendance.missedPunchOut = false;     // ← user remembered to punch out

    if (workHours > 8) {
      attendance.overtime = Number((workHours - 8).toFixed(2));
    }

    if (batteryPercentage !== undefined && batteryPercentage !== null) {
      const existingMetadata = attendance.metadata instanceof Map
        ? Object.fromEntries(attendance.metadata)
        : (attendance.metadata || {});
      attendance.metadata = {
        ...existingMetadata,
        batteryAtPunchOut: {
          percentage: Number(batteryPercentage),
          isCharging: Boolean(isCharging),
          recordedAt: new Date(),
        },
      };
    }

    await attendance.save();

    await storeAttendanceLocationPoint({
      userId: currentUser._id,
      latitude,
      longitude,
      accuracy: data.accuracy,
      speed: data.speed,
      recordedAt: punchOutTime,
    });

    return await Attendance.findById(attendance._id)
      .populate('user', 'firstName lastName email phoneNumber role');

  } catch (error) {
    console.error('Punch Out Service Error:', error);
    if (error instanceof AppError) throw error;
    throw new AppError(error.message || "Failed to punch out", 500);
  }
};


/* ================= MARK HOLIDAY ================= */
export const markHolidayService = async (data, currentUser) => {
  try {
    if (!["Head_office"].includes(currentUser.role)) {
      throw new AppError("Unauthorized to create holidays", 403);
    }

    const { date, reason } = data;

    if (!date) {
      throw new AppError("Holiday date is required", 400);
    }

    if (!reason || !String(reason).trim()) {
      throw new AppError("Holiday reason is required", 400);
    }

    const [yyyy, mm, dd] = String(date).split("-").map(Number);
    const startDate = new Date(yyyy, (mm || 1) - 1, dd || 1, 0, 0, 0, 0);
    if (Number.isNaN(startDate.getTime())) {
      throw new AppError("Invalid holiday date", 400);
    }
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);

    const scopedUserIds = await getHeadOfficeScopedUserIds(currentUser, {
      roles: ["TEAM", "ASM", "ZSM"],
      includeInactive: false,
    });

    if (!scopedUserIds.length) {
      return {
        date: startDate,
        reason: String(reason).trim(),
        createdCount: 0,
        updatedCount: 0,
        skippedCount: 0,
      };
    }

    const existingAttendances = await Attendance.find({
      user: { $in: scopedUserIds },
      date: { $gte: startDate, $lt: endDate },
    });

    const existingByUser = new Map(
      existingAttendances.map((attendance) => [attendance.user.toString(), attendance])
    );

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const holidayReason = String(reason).trim();

    for (const userId of scopedUserIds) {
      const normalizedUserId = userId.toString();
      const attendance = existingByUser.get(normalizedUserId);

      if (!attendance) {
        await Attendance.create({
          user: userId,
          date: startDate,
          status: "holiday",
          remarks: holidayReason,
          metadata: {
            holidayReason,
            holidayMarkedBy: currentUser._id,
            holidayMarkedAt: new Date(),
          },
        });
        createdCount += 1;
        continue;
      }

      if (attendance.punchIn?.time || attendance.punchOut?.time) {
        skippedCount += 1;
        continue;
      }

      const existingMetadata = attendance.metadata instanceof Map
        ? Object.fromEntries(attendance.metadata)
        : (attendance.metadata || {});

      attendance.status = "holiday";
      attendance.remarks = holidayReason;
      attendance.metadata = {
        ...existingMetadata,
        holidayReason,
        holidayMarkedBy: currentUser._id,
        holidayMarkedAt: new Date(),
      };
      await attendance.save();
      updatedCount += 1;
    }

    return {
      date: startDate,
      reason: holidayReason,
      createdCount,
      updatedCount,
      skippedCount,
    };
  } catch (error) {
    throw new AppError(error.message || "Failed to mark holiday", 500);
  }
};


/* ================= AUTO PUNCH OUT (12 HOURS) ================= */
const autoPunchOutServiceLegacy = async () => {
  try {
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    // Find all records:
    // 1. Punched in exists
    // 2. No punch-out yet
    // 3. Punch-in was more than 12 hours ago
    // 4. Not already processed by auto punch-out
    const stalePunchIns = await Attendance.find({
      "punchIn.time": { $exists: true, $lte: twelveHoursAgo },
      "punchOut.time": { $exists: false },
      missedPunchOut: { $ne: true }        // avoid reprocessing
    });

    if (stalePunchIns.length === 0) {
      console.log("[AutoPunchOut] No stale punch-ins found.");
      return;
    }

    for (const attendance of stalePunchIns) {
      // Always set punch-out to exactly punchIn + 12hrs
      // — accurate even if cron fires late
      const punchOutTime = new Date(
        new Date(attendance.punchIn.time).getTime() + 12 * 60 * 60 * 1000
      );

      const workHours = 12;
      const overtime = Number((workHours - 8).toFixed(2)); // 4 hrs overtime

      attendance.punchOut = {
        time: punchOutTime,
        location: attendance.punchIn.location,  // reuse punch-in location
        address: attendance.punchIn.address,    // reuse punch-in address
        isAutoPunchOut: true                    // system triggered this
      };

      attendance.workHours = workHours;
      attendance.overtime = overtime;
      attendance.missedPunchOut = true;         // user forgot to punch out
      attendance.remarks = "User did not punch out. Auto punched out after 12 hours.";

      await attendance.save();

      console.log(
        `[AutoPunchOut] User ${attendance.user} missed punch-out. Auto punched at ${punchOutTime}`
      );
    }

    console.log(`[AutoPunchOut] Processed ${stalePunchIns.length} record(s)`);

  } catch (error) {
    console.error("[AutoPunchOut] Error:", error.message);
  }
};


export const getAttendanceSettingService = async () => {
  return await getAttendanceSetting();
};

export const updateAttendanceSettingService = async (data, currentUser) => {
  if (currentUser.role !== "Head_office") {
    throw new AppError("Only Head Office can update attendance settings", 403);
  }

  const updates = {};
  if (data.officePunchInTime !== undefined) {
    if (!isValidTimeValue(data.officePunchInTime)) throw new AppError("Invalid punch-in time", 400);
    updates.officePunchInTime = data.officePunchInTime;
  }
  if (data.officePunchOutTime !== undefined) {
    if (!isValidTimeValue(data.officePunchOutTime)) throw new AppError("Invalid punch-out time", 400);
    updates.officePunchOutTime = data.officePunchOutTime;
  }
  if (data.blockEarlyPunchIn !== undefined) updates.blockEarlyPunchIn = Boolean(data.blockEarlyPunchIn);
  if (data.autoPunchOutEnabled !== undefined) updates.autoPunchOutEnabled = Boolean(data.autoPunchOutEnabled);
  updates.updatedBy = currentUser._id;

  return await AttendanceSetting.findOneAndUpdate(
    { key: "default" },
    { $set: updates, $setOnInsert: { key: "default" } },
    { new: true, upsert: true }
  );
};

export const autoPunchOutService = async () => {
  try {
    const now = new Date();
    const setting = await getAttendanceSetting();
    if (!setting.autoPunchOutEnabled) return;

    const officePunchOutTime = setting.officePunchOutTime || "19:00";
    if (getIstParts(now).minutes < timeToMinutes(officePunchOutTime)) {
      console.log("[AutoPunchOut] Office punch-out time not reached.");
      return;
    }

    const autoPunchOutTime = getUtcDateForIstTime(now, officePunchOutTime);
    const stalePunchIns = await Attendance.find({
      "punchIn.time": { $exists: true, $lte: autoPunchOutTime },
      date: {
        $gte: getUtcDateForIstTime(now, "00:00"),
        $lte: getUtcDateForIstTime(now, "23:59"),
      },
      "punchOut.time": { $exists: false },
      missedPunchOut: { $ne: true },
    });

    if (stalePunchIns.length === 0) {
      console.log("[AutoPunchOut] No stale punch-ins found.");
      return;
    }

    for (const attendance of stalePunchIns) {
      const punchOutTime = autoPunchOutTime;
      const workHours = Math.max(
        (punchOutTime.getTime() - new Date(attendance.punchIn.time).getTime()) / (60 * 60 * 1000),
        0
      );

      attendance.punchOut = {
        time: punchOutTime,
        location: attendance.punchIn.location,
        address: attendance.punchIn.address,
        isAutoPunchOut: true,
      };
      attendance.workHours = workHours;
      attendance.overtime = Number(Math.max(workHours - 8, 0).toFixed(2));
      attendance.missedPunchOut = true;
      attendance.remarks = `User did not punch out. Auto punched out at ${officePunchOutTime}.`;

      await attendance.save();
      console.log(`[AutoPunchOut] User ${attendance.user} auto punched at ${punchOutTime}`);
    }

    console.log(`[AutoPunchOut] Processed ${stalePunchIns.length} record(s)`);
  } catch (error) {
    console.error("[AutoPunchOut] Error:", error.message);
  }
};


/* ================= GET ALL ATTENDANCE ================= */
export const getAllAttendanceService = async (query, currentUser) => {
  try {
    // ✅ Run auto punch-out check before fetching
    // so data is always fresh even if cron hasn't fired yet
    await autoPunchOutService();

    const {
      page = 1,
      limit = 10,
      sortBy = 'date',
      sortOrder = 'desc',
      userId,
      status,
      startDate,
      endDate,
      minWorkHours,
      maxWorkHours,
      hasPunchIn,
      hasPunchOut,
      search,
      ...filters
    } = query;

    const scopedUserIds = await getHeadOfficeScopedUserIds(currentUser);
    const filter = {
      ...filters,
      user: { $in: scopedUserIds },
    };

    // Role-based filtering
    if (currentUser.role === 'TEAM') {
      filter.user = currentUser._id;
    } else if (userId) {
      const targetUser = await User.findById(userId);
      if (!targetUser) {
        throw new AppError("User not found", 404);
      }
      await assertSameHeadOffice(currentUser, targetUser);
      filter.user = userId;
    }

    // Status filter
    if (status) {
      filter.status = Array.isArray(status) ? { $in: status } : status;
    }

    // Date range filter
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filter.date.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    // Work hours filter
    if (minWorkHours || maxWorkHours) {
      filter.workHours = {};
      if (minWorkHours) filter.workHours.$gte = parseFloat(minWorkHours);
      if (maxWorkHours) filter.workHours.$lte = parseFloat(maxWorkHours);
    }

    // Punch in/out presence filters
    if (hasPunchIn === 'true') filter['punchIn.time'] = { $exists: true };
    else if (hasPunchIn === 'false') filter['punchIn.time'] = { $exists: false };

    if (hasPunchOut === 'true') filter['punchOut.time'] = { $exists: true };
    else if (hasPunchOut === 'false') filter['punchOut.time'] = { $exists: false };

    // Search by user name or remarks
    if (search) {
      const users = await User.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ]
      }).select('_id');

      const userIds = users.map(u => u._id);

      filter.$or = [
        { user: { $in: userIds } },
        { 'punchIn.remarks': { $regex: search, $options: 'i' } },
        { 'punchOut.remarks': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const attendances = await Attendance.find(filter)
      .populate('user', 'firstName lastName email phoneNumber role')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Attendance.countDocuments(filter);

    // Summary statistics
    const stats = await Attendance.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalWorkHours: { $sum: '$workHours' },
          avgWorkHours: { $avg: '$workHours' },
          totalOvertime: { $sum: '$overtime' },
          avgOvertime: { $avg: '$overtime' },
          presentCount: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          absentCount: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
          halfDayCount: { $sum: { $cond: [{ $eq: ['$status', 'half-day'] }, 1, 0] } },
          leaveCount: { $sum: { $cond: [{ $eq: ['$status', 'leave'] }, 1, 0] } },
          holidayCount: { $sum: { $cond: [{ $eq: ['$status', 'holiday'] }, 1, 0] } },
          // ✅ Count missed punch-outs in summary
          missedPunchOutCount: { $sum: { $cond: ['$missedPunchOut', 1, 0] } }
        }
      }
    ]);

    const formatMinutes = (totalMinutes = 0) => {
      const hrs = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
    };

    const formattedAttendances = attendances.map(att => ({
      id: att._id,

      user: {
        id: att.user?._id,
        firstName: att.user?.firstName || null,
        lastName: att.user?.lastName || null,
        email: att.user?.email,
        phone: att.user?.phoneNumber || null,
        role: att.user?.role
      },

      date: att.date,

      punchIn: att.punchIn?.time
        ? {
            time: att.punchIn.time,
            address: att.punchIn.address,
            location: att.punchIn.location,
            battery: att.punchIn.battery || att.metadata?.get?.("batteryAtPunchIn") || att.metadata?.batteryAtPunchIn || null
          }
        : null,

      punchOut: att.punchOut?.time
        ? {
            time: att.punchOut.time,
            address: att.punchOut.address,
            location: att.punchOut.location,
            battery: att.punchOut.battery || att.metadata?.get?.("batteryAtPunchOut") || att.metadata?.batteryAtPunchOut || null,
            isAutoPunchOut: att.punchOut.isAutoPunchOut || false  // ✅ was it auto?
          }
        : null,

      // ✅ Missed punch-out fields
      missedPunchOut: att.missedPunchOut || false,
      punchOutMessage: att.missedPunchOut
        ? "User did not punch out this day"
        : null,

      workHours: att.workHours,
      workHoursFormatted: formatMinutes(att.workHours * 60),

      overtime: att.overtime,
      status: att.status,
      remarks: att.remarks || null,
      metadata: att.metadata || null,

      createdAt: att.createdAt,
      updatedAt: att.updatedAt
    }));

    return {
      attendances: formattedAttendances,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      },
      summary: {
        totalWorkHours: stats[0]?.totalWorkHours || 0,
        avgWorkHours: stats[0]?.avgWorkHours || 0,
        totalOvertime: stats[0]?.totalOvertime || 0,
        avgOvertime: stats[0]?.avgOvertime || 0,
        presentCount: stats[0]?.presentCount || 0,
        absentCount: stats[0]?.absentCount || 0,
        halfDayCount: stats[0]?.halfDayCount || 0,
        leaveCount: stats[0]?.leaveCount || 0,
        holidayCount: stats[0]?.holidayCount || 0,
        missedPunchOutCount: stats[0]?.missedPunchOutCount || 0  // ✅ new
      }
    };

  } catch (error) {
    throw new AppError(error.message || "Failed to fetch attendance records", 500);
  }
};


/* ================= GET ATTENDANCE BY ID ================= */
export const getAttendanceByIdService = async (attendanceId) => {
  try {
    const attendance = await Attendance.findById(attendanceId)
      .populate('user', 'firstName lastName email _id phoneNumber role');

    if (!attendance) {
      throw new AppError("Attendance record not found", 404);
    }

    return attendance;
  } catch (error) {
    throw new AppError(error.message || "Failed to fetch attendance record", 500);
  }
};


/* ================= UPDATE ATTENDANCE ================= */
export const updateAttendanceService = async (attendanceId, data, currentUser) => {
  try {
    if (!['Head_office', 'ZSM', 'ASM'].includes(currentUser.role)) {
      throw new AppError("Unauthorized to update attendance records", 403);
    }

    const attendance = await Attendance.findById(attendanceId).populate('user', '_id');
    if (!attendance) {
      throw new AppError("Attendance record not found", 404);
    }
    if (attendance.user?._id) {
      await assertSameHeadOffice(currentUser, attendance.user._id);
    }

    if (data.status) attendance.status = data.status;
    if (data.workHours !== undefined) attendance.workHours = data.workHours;
    if (data.overtime !== undefined) attendance.overtime = data.overtime;

    if (data.punchIn) {
      attendance.punchIn = { ...attendance.punchIn, ...data.punchIn };
    }

    if (data.punchOut) {
      attendance.punchOut = { ...attendance.punchOut, ...data.punchOut };
    }

    if (data.metadata) {
      attendance.metadata = { ...attendance.metadata, ...data.metadata };
    }

    // ✅ If admin manually fixes punch-out, clear the missed flag
    if (data.punchOut && data.punchOut.time) {
      attendance.missedPunchOut = false;
      attendance.punchOut.isAutoPunchOut = false;
    }

    attendance.remarks = data.remarks;
    await attendance.save();

    return await Attendance.findById(attendance._id)
      .populate('user', 'firstName lastName email _id phoneNumber');

  } catch (error) {
    throw new AppError(error.message || "Failed to update attendance", 500);
  }
};


/* ================= DELETE ATTENDANCE ================= */
export const deleteAttendanceService = async (attendanceId, currentUser) => {
  try {
    if (!['Head_office'].includes(currentUser.role)) {
      throw new AppError("Unauthorized to delete attendance records", 403);
    }

    const attendance = await Attendance.findById(attendanceId).populate('user', '_id');
    if (!attendance) {
      throw new AppError("Attendance record not found", 404);
    }
    if (attendance.user?._id) {
      await assertSameHeadOffice(currentUser, attendance.user._id);
    }

    await attendance.deleteOne();

    return { message: "Attendance record deleted successfully" };
  } catch (error) {
    throw new AppError(error.message || "Failed to delete attendance", 500);
  }
};


/* ================= GET ATTENDANCE STATS ================= */
export const getAttendanceStatsService = async (query, currentUser) => {
  try {
    const { userId, startDate, endDate, groupBy = 'day' } = query;

    const scopedUserIds = await getHeadOfficeScopedUserIds(currentUser);
    const matchStage = {
      user: { $in: scopedUserIds.map((id) => new mongoose.Types.ObjectId(id)) },
    };

    if (userId && ['Head_office', 'ZSM', 'ASM'].includes(currentUser.role)) {
      const targetUser = await User.findById(userId);
      if (!targetUser) {
        throw new AppError("User not found", 404);
      }
      await assertSameHeadOffice(currentUser, targetUser);
      matchStage.user = new mongoose.Types.ObjectId(userId);
    } else if (currentUser.role === 'TEAM') {
      matchStage.user = new mongoose.Types.ObjectId(currentUser._id);
    }

    if (startDate || endDate) {
      matchStage.date = {};
      if (startDate) matchStage.date.$gte = new Date(startDate);
      if (endDate) matchStage.date.$lte = new Date(endDate);
    }

    let groupId;
    if (groupBy === 'day') groupId = { $dateToString: { format: '%Y-%m-%d', date: '$date' } };
    else if (groupBy === 'week') groupId = { $week: '$date' };
    else if (groupBy === 'month') groupId = { $month: '$date' };
    else if (groupBy === 'user') groupId = '$user';

    const stats = await Attendance.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: groupId,
          count: { $sum: 1 },
          presentCount: { $sum: { $cond: [{ $eq: ['$status', 'Present'] }, 1, 0] } },
          absentCount: { $sum: { $cond: [{ $eq: ['$status', 'Absent'] }, 1, 0] } },
          halfDayCount: { $sum: { $cond: [{ $eq: ['$status', 'Half-Day'] }, 1, 0] } },
          leaveCount: { $sum: { $cond: [{ $eq: ['$status', 'Leave'] }, 1, 0] } },
          holidayCount: { $sum: { $cond: [{ $eq: ['$status', 'Holiday'] }, 1, 0] } },
          totalWorkHours: { $sum: '$workHours' },
          avgWorkHours: { $avg: '$workHours' },
          totalOvertime: { $sum: '$overtime' },
          avgOvertime: { $avg: '$overtime' },
          // ✅ Count missed punch-outs per group
          missedPunchOutCount: { $sum: { $cond: ['$missedPunchOut', 1, 0] } }
        }
      },
      { $sort: { '_id': -1 } }
    ]);

    if (groupBy === 'user' && stats.length > 0) {
      const userIds = stats.map(s => s._id);
      const users = await User.find({ _id: { $in: userIds } })
        .select('name email employeeId');

      const userMap = {};
      users.forEach(u => { userMap[u._id] = u; });
      stats.forEach(s => { s.user = userMap[s._id] || null; });
    }

    return stats;
  } catch (error) {
    throw new AppError(error.message || "Failed to fetch attendance stats", 500);
  }
};
