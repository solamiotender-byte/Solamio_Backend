// services/visit.service.js
import mongoose from "mongoose";
import Visit from "../models/visit.model.js";
import Attendance from "../models/attendance.model.js";
import User from "../models/user.model.js";
import Lead from "../models/lead.model.js";
import { AppError } from "../errors/customError.js";
import {
  getAddressFromCoords,
  calculateDistanceKm,
} from "../utils/locationUtils.js";
import { generateFullUrl } from '../utils/generateFullUrl.js';
import { getIO } from "../helper/socket/index.js";
import {
  assertSameHeadOffice,
  getHeadOfficeIdForUser,
  getHeadOfficeScopedUserIds,
  getScopedManagerRoomNames,
} from "../utils/headOfficeScope.js";

/* =========================================================
   HELPERS
========================================================= */

const VISIT_PHOTO_RETENTION_DAYS = 7;
const VISIT_PHOTO_RETENTION_MS = VISIT_PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const shouldExposeVisitPhotos = (visit) => {
  const referenceDate = visit?.visitDate || visit?.createdAt;
  if (!referenceDate) return true;

  const parsedDate = new Date(referenceDate);
  if (Number.isNaN(parsedDate.getTime())) return true;

  return Date.now() - parsedDate.getTime() < VISIT_PHOTO_RETENTION_MS;
};

const sanitizeVisitPhotos = (visit) => {
  if (!visit || typeof visit !== "object") return visit;
  if (shouldExposeVisitPhotos(visit)) return visit;

  return {
    ...visit,
    photos: [],
  };
};

const getTodayAttendance = async (userId) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return Attendance.findOne({
    user: userId,
    date: { $gte: today, $lt: tomorrow },
  });
};

const getPreviousVisit = async (userId, excludeVisitId = null) => {
  const query = { user: userId };
  if (excludeVisitId) {
    query._id = { $ne: excludeVisitId };
  }

  return Visit.findOne(query)
    .sort({ checkOutTime: -1, createdAt: -1 })
    .select("coordinates checkOutTime totalDistanceTillNowKm locationName createdAt")
    .lean();
};

const resolveFileUrl = (file) => {
  if (!file) return null;
  if (file.location) return file.location;
  if (file.path) {
    const cleanPath = file.path.replace(/^[\\/]+/, "").replace(/\\/g, "/");
    return `/${cleanPath}`;
  }
  if (file.filename) return generateFullUrl(file.filename);
  return null;
};

const processPhotos = (files = []) => {
  if (!files || !Array.isArray(files) || files.length === 0) return [];

  return files
    .filter(file => file && (file.location || file.filename || file.path))
    .map(file => ({
      url: resolveFileUrl(file),
      uploadedAt: new Date(),
    }))
    .filter(photo => photo.url);
};

// Helper to create lead from visit data
const createLeadFromVisit = async (visit, data,currentUser, session) => {
  try {
    const leadData = {
      firstName:     data.contactPerson?.trim().split(' ')[0] || 'Unknown',
      lastName:      data.contactPerson?.trim().split(' ').slice(1).join(' ') || '.',
      email:         data.email        || null,
      phone:         data.phone        || null,
      address:       data.address      || visit.address || "",
      source:        "Visit",
      status:        "Visit",           // ✅ Fixed: always 'Visit'
      assignedUser:  currentUser._id,   // ✅ Fixed: correct field name
      assignedManager: currentUser.supervisor || null, // ✅ sets manager too
      visit:         visit._id,
      visitLocation: data.locationName  || "",
      visitNotes:    data.remarks       || "",
      visitStatus:   "Completed",
      createdBy:     currentUser._id,
      stageTimeline: [{
        stage:       "Visit",
        notes:       data.remarks || "Lead created from visit",
        updatedBy:   currentUser._id,
        updatedRole: currentUser.role,
        updatedAt:   new Date(),
    }],
    };

    const [lead] = await Lead.create([leadData], { session });
    visit.leadCreated = lead._id;
    await visit.save({ session });
    return lead;
  } catch (error) {
    console.error("Lead creation error:", error);
    throw new AppError("Failed to create lead from visit", 500);
  }
};

/* =========================================================
   CREATE VISIT
   ── Handles isLeadCreated = 'yes' | 'no' | 'other'
   ── For 'other': saves description in visit.remarks, no lead
   ── For 'yes':   saves visit + creates lead
   ── For 'no':    saves visit + creates lead
========================================================= */
export const createVisitService = async (data, currentUser, files = []) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Validate required fields
    if (!data.latitude || !data.longitude) {
      throw new AppError("Location coordinates are required", 400);
    }

    const lat = parseFloat(data.latitude);
    const lng = parseFloat(data.longitude);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new AppError("Invalid coordinates provided", 400);
    }

    // Get today's attendance
    const attendance = await getTodayAttendance(currentUser._id);

    if (!attendance) {
      throw new AppError("No attendance record found. Please punch in first", 400);
    }

    if (!attendance.punchIn?.time) {
      throw new AppError("Please punch in first before creating a visit", 400);
    }

    // Get address from coordinates
    let address = null;
    try {
      address = await getAddressFromCoords(lat, lng);
    } catch (error) {
      console.error("Address lookup failed:", error);
    }

    const photos = processPhotos(files);

    const previousVisit = await getPreviousVisit(currentUser._id);

    let previousVisitId = null;
    let distanceFromPreviousKm = 0;
    let totalDistanceTillNowKm = 0;
    let travelTimeMinutes = 0;

    if (previousVisit && previousVisit.coordinates) {
  previousVisitId = previousVisit._id;

  // Try Google Directions API for real road distance
  try {
    const gKey   = process.env.GOOGLE_MAPS_API_KEY;
    const dirUrl = `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${previousVisit.coordinates.lat},${previousVisit.coordinates.lng}` +
      `&destination=${lat},${lng}` +
      `&mode=driving&key=${gKey}`;

    const dirRes  = await fetch(dirUrl);
    const dirData = await dirRes.json();

    if (dirData.status === 'OK') {
      const leg              = dirData.routes[0].legs[0];
      distanceFromPreviousKm = leg.distance.value / 1000;
      travelTimeMinutes      = Math.round(leg.duration.value / 60);

      console.log(`[Distance] Road: ${leg.distance.text}, Drive: ${leg.duration.text}`);
    } else {
      // Fallback to straight-line if Google fails
      console.warn(`[Distance] Directions API status: ${dirData.status} — falling back to haversine`);
      distanceFromPreviousKm = calculateDistanceKm(
        previousVisit.coordinates.lat, previousVisit.coordinates.lng, lat, lng
      );
      travelTimeMinutes = Math.round((distanceFromPreviousKm / 40) * 60);
    }
  } catch (dirErr) {
    // Network error — fall back gracefully
    console.warn('[Distance] Directions API failed, using haversine:', dirErr.message);
    distanceFromPreviousKm = calculateDistanceKm(
      previousVisit.coordinates.lat, previousVisit.coordinates.lng, lat, lng
    );
    travelTimeMinutes = Math.round((distanceFromPreviousKm / 40) * 60);
  }

  totalDistanceTillNowKm =
    (previousVisit.totalDistanceTillNowKm || 0) + distanceFromPreviousKm;
}

    // ── Resolve the isLeadCreated value ──────────────────────────────────
    // Frontend sends: isLeadCreated = 'yes' | 'no' | 'other'
    // Old backend field was isLeadCreate (boolean) — we now handle both
    const isLeadCreatedValue = (
      data.isLeadCreated ||   // new frontend field name
      data.isLeadCreate  ||   // old field name fallback
      'no'
    ).toString().toLowerCase().trim();

    // Create a lead for both "yes" and "no". "other" remains visit-only.
    const isLeadCreate =
      isLeadCreatedValue === 'yes' ||
      isLeadCreatedValue === 'no' ||
      isLeadCreatedValue === 'true';

    // ── Resolve description/remarks from any field name ───────────────────
    // Frontend sends remarks, description, or visitNotes — accept all three
    const resolvedRemarks =
      data.remarks?.trim()     ||
      data.description?.trim() ||
      data.visitNotes?.trim()  ||
      '';

    // Prepare visit data
    const visitData = {
      user:          currentUser._id,
      attendance:    attendance._id,
      locationName:  data.locationName || "Customer Visit",
      coordinates: {
        lat: parseFloat(lat.toFixed(6)),
        lng: parseFloat(lng.toFixed(6))
      },
      address:                  address || data.address || null,
      previousVisit:            previousVisitId,
      distanceFromPreviousKm:   Number(distanceFromPreviousKm.toFixed(2)),
      totalDistanceTillNowKm:   Number(totalDistanceTillNowKm.toFixed(2)),
      travelTimeMinutes:        travelTimeMinutes,
      checkInTime:              new Date(),
      photos,
      visitDate:                new Date(),

      // ── KEY FIX: always save remarks/description regardless of visit type ──
      remarks:     resolvedRemarks,

      status:      'InProgress',
      isLeadCreate: isLeadCreate,
    };

    // Add contact fields only for 'yes'
    // For 'yes' — validate at least one contact field exists
if (isLeadCreate) {
  if (!data.contactPerson && !data.phone && !data.email) {
    throw new AppError(
      "At least one contact information (name, phone, or email) is required for lead creation",
      400
    );
  }
}

// ✅ Always save contact fields for ALL options (yes / no / other)
// So Customer name always shows in Visit Records
if (data.contactPerson) visitData.contactPerson = data.contactPerson;
if (data.phone)         visitData.phone         = data.phone;
if (data.email)         visitData.email         = data.email;
if (data.address)       visitData.address       = data.address;

    // Create the visit
    const [visit] = await Visit.create([visitData], { session });

    // Create lead for "yes" and "no" — NOT for "other"
    let createdLead = null;
    let leadCreationError = null;
    if (isLeadCreate) {
      try {
      createdLead = await createLeadFromVisit(visit, data, currentUser, session);
      
      } catch (leadError) {
        console.error("Failed to create lead:", leadError);
        leadCreationError = leadError.message || "Failed to create lead from visit";
        visit.remarks = (visit.remarks || "") + " [Lead creation failed: " + leadError.message + "]";
        await visit.save({ session });
      }
    }

    // Log visit type for debugging
    console.log(`Visit created — type: ${isLeadCreatedValue}, remarks: "${resolvedRemarks}", isLeadCreate: ${isLeadCreate}`);

    await session.commitTransaction();

    const populatedVisit = await Visit.findById(visit._id)
      .populate("user",          "firstName lastName email role")
      .populate("attendance")
      .populate("previousVisit", "locationName coordinates")
      .populate("leadCreated");

    try {
      const io = getIO();
      if (io) {
        io.to(`user:${currentUser._id}`).emit('visit:created', {
          visit: populatedVisit,
          lead:  createdLead
        });

        if (createdLead) {
          const headOfficeId = await getHeadOfficeIdForUser(currentUser);
          for (const room of getScopedManagerRoomNames(headOfficeId)) {
            io.to(room).emit('lead:created', {
              lead:      createdLead,
              visit:     populatedVisit,
              createdBy: currentUser
            });
          }
        }
      }
    } catch (socketError) {
      console.error("Socket emission error:", socketError);
    }

    return {
      success: true,
      visit:   populatedVisit,
      lead:    createdLead,
      leadCreationError,
      message: createdLead
        ? "Visit and lead created successfully"
        : isLeadCreatedValue === 'other'
          ? "Visit created successfully with description"
          : "Visit created successfully"
    };

  } catch (error) {
    await session.abortTransaction();
    console.error("Create visit service error:", error);
    if (error instanceof AppError) throw error;
    throw new AppError(error.message || "Failed to create visit", 500);
  } finally {
    session.endSession();
  }
};

export const checkExistingLeadAtLocation = async (lat, lng, radiusKm = 0.1) => {
  try {
    const existingLead = await Lead.findOne({
      coordinates: {
        $near: {
          $geometry: { type: "Point", coordinates: [lng, lat] },
          $maxDistance: radiusKm * 1000
        }
      },
      status: { $ne: "Closed" }
    });
    return existingLead;
  } catch (error) {
    console.error("Check existing lead error:", error);
    return null;
  }
};

/* =========================================================
   COMPLETE VISIT
========================================================= */
export const completeVisitService = async (visitId, currentUser) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const visit = await Visit.findById(visitId).session(session);

    if (!visit) throw new AppError("Visit not found", 404);
    if (visit.user.toString() !== currentUser._id.toString()) {
      throw new AppError("Unauthorized", 403);
    }
    if (visit.status !== "InProgress") {
      throw new AppError("Visit is not in progress", 400);
    }

    visit.status       = "Completed";
    visit.checkOutTime = new Date();

    if (visit.checkInTime) {
      visit.timeSpentMinutes = Math.round(
        (visit.checkOutTime - visit.checkInTime) / 60000
      );
    }

    await visit.save({ session });
    await session.commitTransaction();

    const io = getIO();
    if (io) {
      io.to(`user-${currentUser._id}`).emit('visit-updated', visit);
    }

    return visit;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/* =========================================================
   GET ALL VISITS (Optimized with Pagination)
========================================================= */
export const getAllVisitsService = async (query, currentUser) => {
  const {
    page = 1,
    limit = 10,
    startDate,
    endDate,
    status,
    userId,
    search
  } = query;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const scopedUserIds = await getHeadOfficeScopedUserIds(currentUser);
  let filter = { user: { $in: scopedUserIds } };

  if (currentUser.role === 'TEAM') {
    filter.user = currentUser._id;

  } 
   else if (currentUser.role === 'ASM') {
    // ASM sees attendance of users they created OR supervise
    const subordinates = await User.find({
        $or: [
            { createdBy: currentUser._id },
            { supervisor: currentUser._id }
        ]
    }).select('_id');

    const subordinateIds = subordinates.map(u => u._id);

    // Also include ASM's own attendance
    filter.user = { $in: [...subordinateIds, currentUser._id] };

    // If a specific userId is requested, verify it's within their scope
    if (userId) {
        const isAllowed = subordinateIds.some(id => id.toString() === userId);
        if (!isAllowed && userId !== currentUser._id.toString()) {
            throw new AppError("Unauthorized to view this user's attendance", 403);
        }
        filter.user = userId;
    }

} else if (currentUser.role === 'ZSM') {
    // ZSM sees attendance of users under ASMs they supervise + direct subordinates
    const asmList = await User.find({
        $or: [
            { createdBy: currentUser._id },
            { supervisor: currentUser._id }
        ]
    }).select('_id');

    const asmIds = asmList.map(u => u._id);

    // Get all TEAM users under those ASMs
    const teamUsers = await User.find({
        $or: [
            { createdBy: { $in: asmIds } },
            { supervisor: { $in: asmIds } },
            { createdBy: currentUser._id },
            { supervisor: currentUser._id }
        ]
    }).select('_id');

    const allIds = teamUsers.map(u => u._id);
    filter.user = { $in: [...allIds, currentUser._id] };

    if (userId) {
        const isAllowed = allIds.some(id => id.toString() === userId);
        if (!isAllowed && userId !== currentUser._id.toString()) {
            throw new AppError("Unauthorized to view this user's attendance", 403);
        }
        filter.user = userId;
    }



  } else if (['Head_office', 'ZSM'].includes(currentUser.role)) {
    if (userId) {
      const targetUser = await User.findById(userId);
      if (!targetUser) {
        throw new AppError("User not found", 404);
      }
      await assertSameHeadOffice(currentUser, targetUser);
      filter.user = new mongoose.Types.ObjectId(userId);
    }
  }

 if (startDate || endDate) {
  filter.visitDate = {};
  if (startDate) {
    filter.visitDate.$gte = new Date(startDate);
  }
  if (endDate) {
    filter.visitDate.$lte = new Date(endDate);
  }
}

  if (status) {
    const statuses = String(status)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    filter.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
  }

  if (search) {
    filter.$or = [
      { locationName:   { $regex: search, $options: 'i' } },
      { address:        { $regex: search, $options: 'i' } },
      { remarks:        { $regex: search, $options: 'i' } },
      { contactPerson:  { $regex: search, $options: 'i' } }
    ];
  }

  const [visits, total] = await Promise.all([
    Visit.find(filter)
      .populate('user',          'firstName lastName email role')
      .populate('previousVisit', 'locationName')
      .sort({ visitDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),

    Visit.countDocuments(filter)
  ]);

  return {
    visits: visits.map(sanitizeVisitPhotos),
    pagination: {
      currentPage: parseInt(page),
      totalPages:  Math.ceil(total / parseInt(limit)),
      totalItems:  total,
      itemsPerPage: parseInt(limit)
    }
  };
};

/* =========================================================
   GET VISIT BY ID
========================================================= */
export const getVisitByIdService = async (visitId, currentUser) => {
  const visit = await Visit.findById(visitId)
    .populate('user',          'firstName lastName email role')
    .populate('attendance')
    .populate('previousVisit', 'locationName coordinates address')
    .populate('nextVisit',     'locationName')
    .lean();

  if (!visit) throw new AppError("Visit not found", 404);

  if (currentUser.role === 'TEAM' && visit.user._id.toString() !== currentUser._id.toString()) {
    throw new AppError("Unauthorized", 403);
  }

  return sanitizeVisitPhotos(visit);
};

/* =========================================================
   UPDATE VISIT
========================================================= */
export const updateVisitService = async (visitId, data, currentUser) => {
  const visit = await Visit.findById(visitId);

  if (!visit) throw new AppError("Visit not found", 404);
  if (visit.user.toString() !== currentUser._id.toString()) {
    throw new AppError("Unauthorized", 403);
  }

  const allowedUpdates = ['locationName', 'remarks', 'contactPerson', 'phone', 'email', 'address'];
  const updates = {};

  allowedUpdates.forEach(field => {
    if (data[field] !== undefined) updates[field] = data[field];
  });

  // Also accept description / visitNotes as aliases for remarks
  if (data.description?.trim() && !data.remarks) updates.remarks = data.description.trim();
  if (data.visitNotes?.trim()  && !data.remarks) updates.remarks = data.visitNotes.trim();

  Object.assign(visit, updates);
  await visit.save();

  const io = getIO();
  if (io) {
    io.to(`user-${currentUser._id}`).emit('visit-updated', visit);
  }

  return visit;
};

/* =========================================================
   GET RECENT ACTIVITY
========================================================= */
export const getRecentActivityService = async (currentUser) => {
  const scopedUserIds = await getHeadOfficeScopedUserIds(currentUser);
  let filter = { user: { $in: scopedUserIds } };

  if (currentUser.role === 'TEAM') {
    filter.user = currentUser._id;
  } else if (currentUser.role === 'ASM') {
    const teamMembers = await User.find({
      supervisor: currentUser._id,
      role: 'TEAM'
    }).select('_id').lean();

    const teamMemberIds = teamMembers.map(m => m._id);
    filter.user = { $in: [...teamMemberIds, currentUser._id] };
  }

  return Visit.find(filter)
    .populate('user', 'firstName lastName email role')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean()
    .then((visits) => visits.map(sanitizeVisitPhotos));
};

/* =========================================================
   GET VISIT STATS
========================================================= */
export const getVisitStatsService = async (currentUser) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const scopedUserIds = await getHeadOfficeScopedUserIds(currentUser);
  let userFilter = { user: { $in: scopedUserIds } };

  if (currentUser.role === 'TEAM') {
    userFilter = { user: currentUser._id };
  } else if (currentUser.role === 'ASM') {
    const teamMembers = await User.find({
      supervisor: currentUser._id,
      role: 'TEAM'
    }).select('_id').lean();

    const teamMemberIds = teamMembers.map(m => m._id);
    userFilter = { user: { $in: [...teamMemberIds, currentUser._id] } };
  }

  const [todayVisits, allTimeStats, todayStats] = await Promise.all([
    Visit.countDocuments({
      ...userFilter,
      createdAt: { $gte: today, $lt: tomorrow }
    }),

    Visit.aggregate([
      { $match: userFilter },
      {
        $group: {
          _id: null,
          totalDistance:         { $sum: "$distanceFromPreviousKm" },
          totalTravelTime:       { $sum: "$travelTimeMinutes" },
          totalVisits:           { $sum: 1 },
          totalCompletedVisits:  { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
          totalCancelledVisits:  { $sum: { $cond: [{ $eq: ["$status", "Cancelled"] }, 1, 0] } }
        }
      }
    ]),

    Visit.aggregate([
      { $match: { ...userFilter, createdAt: { $gte: today, $lt: tomorrow } } },
      {
        $group: {
          _id: null,
          todayDistance:    { $sum: "$distanceFromPreviousKm" },
          todayTravelTime:  { $sum: "$travelTimeMinutes" }
        }
      }
    ])
  ]);

  return {
    visitsToday:             todayVisits,
    totalVisits:             allTimeStats[0]?.totalVisits          || 0,
    totalCompletedVisits:    allTimeStats[0]?.totalCompletedVisits  || 0,
    totalCancelledVisits:    allTimeStats[0]?.totalCancelledVisits  || 0,
    totalDistanceKm:         Number((allTimeStats[0]?.totalDistance  || 0).toFixed(2)),
    totalTravelTimeMinutes:  allTimeStats[0]?.totalTravelTime       || 0,
    todayDistanceKm:         Number((todayStats[0]?.todayDistance   || 0).toFixed(2)),
    todayTravelTimeMinutes:  todayStats[0]?.todayTravelTime         || 0
  };
};

/* =========================================================
   GET TEAM PERFORMANCE
========================================================= */
export const getTeamPerformanceService = async (query, currentUser) => {
  try {
    const {
      page = 1, limit = 10, search, sortBy = 'distance',
      sortOrder = 'desc', status = 'active', teamId, asmId
    } = query;

    const filter = await buildUserFilter(currentUser, { status, teamId, asmId });

    if (search) {
      filter.$or = [
        { firstName:   { $regex: search, $options: 'i' } },
        { lastName:    { $regex: search, $options: 'i' } },
        { email:       { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    if (currentUser.role === 'TEAM') {
      const user = await User.findById(currentUser._id)
        .select('firstName lastName email phoneNumber role status supervisor createdBy lastLoginDate employeeId')
        .populate('supervisor', 'firstName lastName email role')
        .populate('createdBy',  'firstName lastName email role')
        .lean();

      const performanceData = await getUserPerformanceData([user], currentUser);

      return {
        teamMembers: performanceData,
        pagination:  { currentPage: 1, totalPages: 1, totalItems: 1, itemsPerPage: 1 },
        summary:     await getTeamSummary([currentUser._id], currentUser),
        role:        currentUser.role
      };
    }

    const teamMembers = await User.find(filter)
      .select('firstName lastName email phoneNumber role status supervisor createdBy lastLoginDate employeeId')
      .populate('supervisor', 'firstName lastName email role')
      .populate('createdBy',  'firstName lastName email role')
      .sort({ firstName: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total           = await User.countDocuments(filter);
    const performanceData = await getUserPerformanceData(teamMembers, currentUser);
    const sortedData      = sortPerformanceData(performanceData, sortBy, sortOrder);
    const userIds         = teamMembers.map(m => m._id);
    const summary         = await getTeamSummary(userIds, currentUser);

    return {
      teamMembers: sortedData,
      pagination: {
        currentPage:  parseInt(page),
        totalPages:   Math.ceil(total / parseInt(limit)),
        totalItems:   total,
        itemsPerPage: parseInt(limit)
      },
      summary,
      role:    currentUser.role,
      filters: { search, sortBy, sortOrder, status }
    };
  } catch (error) {
    console.error("Team performance error:", error);
    throw new AppError(error.message || "Failed to fetch team performance", 500);
  }
};

/* =========================================================
   GET USER PERFORMANCE DATA (Helper)
========================================================= */
const getUserPerformanceData = async (users, currentUser) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const userIds = users.map(u => u._id);

  const todayVisits = await Visit.find({
    user:      { $in: userIds },
    createdAt: { $gte: today, $lt: tomorrow }
  }).sort({ createdAt: -1 }).lean();

  const visitsByUser = {};
  todayVisits.forEach(visit => {
    const userId = visit.user.toString();
    if (!visitsByUser[userId]) visitsByUser[userId] = [];
    visitsByUser[userId].push(visit);
  });

  const attendances = await Attendance.find({
    user: { $in: userIds },
    date: { $gte: today, $lt: tomorrow }
  }).lean();

  const attendanceByUser = {};
  attendances.forEach(att => { attendanceByUser[att.user.toString()] = att; });

  const lastVisits = await Visit.aggregate([
    { $match: { user: { $in: userIds }, coordinates: { $exists: true } } },
    { $sort:  { createdAt: -1 } },
    { $group: { _id: "$user", visit: { $first: "$$ROOT" } } }
  ]);

  const lastVisitByUser = {};
  lastVisits.forEach(item => { lastVisitByUser[item._id.toString()] = item.visit; });

  return users.map(user => {
    const userVisits  = visitsByUser[user._id.toString()]    || [];
    const attendance  = attendanceByUser[user._id.toString()];
    const lastVisit   = lastVisitByUser[user._id.toString()];

    const totalDistance      = userVisits.reduce((sum, v) => sum + (v.distanceFromPreviousKm || 0), 0);
    const completedVisits    = userVisits.filter(v => v.status === 'Completed').length;
    const inProgressVisits   = userVisits.filter(v => v.status === 'InProgress').length;
    const cancelledVisits    = userVisits.filter(v => v.status === 'Cancelled').length;

    return {
      id:            user._id,
      name:          `${user.firstName} ${user.lastName}`,
      firstName:     user.firstName,
      lastName:      user.lastName,
      email:         user.email,
      phoneNumber:   user.phoneNumber,
      employeeId:    user.employeeId || 'N/A',
      role:          user.role,
      accountStatus: user.status,
      dutyStatus:    calculateDutyStatus(attendance, user),
      distance:      Number(totalDistance.toFixed(1)),
      visits: {
        completed:   completedVisits,
        inProgress:  inProgressVisits,
        cancelled:   cancelledVisits,
        total:       userVisits.length
      },
      lastKnownLocation: lastVisit ? {
        address:     lastVisit.address || 'Location not available',
        coordinates: lastVisit.coordinates,
        time:        formatRelativeTime(lastVisit.createdAt)
      } : { address: 'No location data', time: 'N/A' },
      attendance: attendance ? {
        punchIn:     attendance.punchIn?.time,
        punchOut:    attendance.punchOut?.time,
        totalHours:  attendance.totalHours || 0,
        date:        attendance.date
      } : null,
      supervisor: user.supervisor ? {
        id:    user.supervisor._id,
        name:  `${user.supervisor.firstName} ${user.supervisor.lastName}`,
        email: user.supervisor.email,
        role:  user.supervisor.role
      } : null,
      createdBy: user.createdBy ? {
        id:    user.createdBy._id,
        name:  `${user.createdBy.firstName} ${user.createdBy.lastName}`,
        email: user.createdBy.email,
        role:  user.createdBy.role
      } : null,
      lastLogin:    user.lastLoginDate ? formatRelativeTime(user.lastLoginDate) : 'Never',
      lastLoginRaw: user.lastLoginDate,
      recentVisits: userVisits.slice(0, 3).map(v => ({
        id:           v._id,
        locationName: v.locationName,
        status:       v.status,
        time:         formatRelativeTime(v.createdAt)
      }))
    };
  });
};

/* =========================================================
   BUILD USER FILTER (Helper)
========================================================= */
const buildUserFilter = async (currentUser, options = {}) => {
  const scopedUserIds = await getHeadOfficeScopedUserIds(currentUser, {
    roles: ['TEAM'],
  });
  const filter = {
    role: 'TEAM',
    _id: { $in: scopedUserIds },
    ...(options.status && { status: options.status }),
  };

  switch (currentUser.role) {
    case 'Head_office':
    case 'ZSM':
      if (options.asmId) filter.supervisor = options.asmId;
      break;
    case 'ASM':
      filter.supervisor = currentUser._id;
      break;
    case 'TEAM':
      break;
    default:
      throw new AppError("Unauthorized role", 403);
  }

  return filter;
};

/* =========================================================
   GET TEAM SUMMARY (Helper)
========================================================= */
const getTeamSummary = async (userIds, currentUser) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [attendanceStats, visitStats, distanceStats] = await Promise.all([
    Attendance.aggregate([
      { $match: { user: { $in: userIds }, date: { $gte: today, $lt: tomorrow } } },
      {
        $group: {
          _id: null,
          onDuty:       { $sum: { $cond: [{ $and: ['$punchIn', { $eq: ['$punchOut', null] }] }, 1, 0] } },
          completed:    { $sum: { $cond: [{ $and: ['$punchIn', '$punchOut'] }, 1, 0] } },
          totalPresent: { $sum: { $cond: ['$punchIn', 1, 0] } }
        }
      }
    ]),

    Visit.aggregate([
      { $match: { user: { $in: userIds }, createdAt: { $gte: today, $lt: tomorrow } } },
      {
        $group: {
          _id: null,
          totalVisits:      { $sum: 1 },
          completedVisits:  { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
          inProgressVisits: { $sum: { $cond: [{ $eq: ['$status', 'InProgress'] }, 1, 0] } },
          cancelledVisits:  { $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] } }
        }
      }
    ]),

    Visit.aggregate([
      { $match: { user: { $in: userIds }, createdAt: { $gte: today, $lt: tomorrow } } },
      {
        $group: {
          _id: null,
          totalDistance: { $sum: '$distanceFromPreviousKm' },
          avgDistance:   { $avg: '$distanceFromPreviousKm' }
        }
      }
    ])
  ]);

  const activeUsers = userIds.length;

  return {
    totalMembers:    userIds.length,
    activeMembers:   activeUsers,
    onDuty:          attendanceStats[0]?.onDuty     || 0,
    completed:       attendanceStats[0]?.completed  || 0,
    absent:          activeUsers - (attendanceStats[0]?.totalPresent || 0),
    attendanceRate:  activeUsers > 0 ? Math.round(((attendanceStats[0]?.totalPresent || 0) / activeUsers) * 100) : 0,
    totalVisits:     visitStats[0]?.totalVisits     || 0,
    completedVisits: visitStats[0]?.completedVisits || 0,
    inProgressVisits: visitStats[0]?.inProgressVisits || 0,
    pendingVisits:   (visitStats[0]?.totalVisits    || 0) - (visitStats[0]?.completedVisits || 0),
    completionRate:  (visitStats[0]?.totalVisits || 0) > 0
      ? Math.round(((visitStats[0]?.completedVisits || 0) / (visitStats[0]?.totalVisits || 1)) * 100) : 0,
    totalDistance:   Number((distanceStats[0]?.totalDistance || 0).toFixed(1)),
    avgDistance:     Number((distanceStats[0]?.avgDistance   || 0).toFixed(1))
  };
};

/* =========================================================
   CALCULATE DUTY STATUS (Helper)
========================================================= */
const calculateDutyStatus = (attendance, user) => {
  if (user.status !== 'active') return 'INACTIVE';
  if (!attendance || !attendance.punchIn) return 'OFF DUTY';
  if (attendance.punchIn && !attendance.punchOut) return 'ON DUTY';

  if (attendance.punchIn && attendance.punchOut) {
    const punchIn    = new Date(attendance.punchIn.time);
    const punchOut   = new Date(attendance.punchOut.time);
    const hoursWorked = (punchOut - punchIn) / (1000 * 60 * 60);
    return hoursWorked < 4 ? 'HALF DAY' : 'COMPLETED';
  }

  return 'OFF DUTY';
};

/* =========================================================
   FORMAT RELATIVE TIME (Helper)
========================================================= */
const formatRelativeTime = (timestamp) => {
  if (!timestamp) return 'N/A';

  const now      = new Date();
  const date     = new Date(timestamp);
  const diffMs   = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays  = Math.floor(diffMs / 86400000);

  if (diffMins < 1)   return 'Just now';
  if (diffMins < 60)  return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)   return `${diffDays} days ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/* =========================================================
   SORT PERFORMANCE DATA (Helper)
========================================================= */
const sortPerformanceData = (data, sortBy, sortOrder) => {
  const order = sortOrder === 'desc' ? -1 : 1;

  return [...data].sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return order * a.name.localeCompare(b.name);
      case 'distance':
        return order * (a.distance - b.distance);
      case 'visits':
        const aComp = a.visits.total > 0 ? a.visits.completed / a.visits.total : 0;
        const bComp = b.visits.total > 0 ? b.visits.completed / b.visits.total : 0;
        return order * (aComp - bComp);
      case 'status':
        const statusOrder = { 'ON DUTY': 1, 'HALF DAY': 2, 'COMPLETED': 3, 'OFF DUTY': 4, 'INACTIVE': 5 };
        return order * ((statusOrder[a.dutyStatus] || 6) - (statusOrder[b.dutyStatus] || 6));
      case 'lastLogin':
        const aTime = a.lastLogin === 'Never' ? 0 : new Date(a.lastLoginRaw).getTime();
        const bTime = b.lastLogin === 'Never' ? 0 : new Date(b.lastLoginRaw).getTime();
        return order * (aTime - bTime);
      case 'email':
        return order * a.email.localeCompare(b.email);
      default:
        return 0;
    }
  });
};

/* =========================================================
   GET MY PERFORMANCE
========================================================= */
export const getMyPerformanceService = async (userId, query) => {
  try {
    const { startDate, endDate } = query;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dateRange = {
      start: startDate ? new Date(startDate) : new Date(today.setDate(today.getDate() - 30)),
      end:   endDate   ? new Date(endDate)   : new Date()
    };

    const user = await User.findById(userId)
      .select('firstName lastName email phoneNumber role status supervisor createdBy lastLoginDate employeeId')
      .populate('supervisor', 'firstName lastName email role phoneNumber')
      .populate('createdBy',  'firstName lastName email role')
      .lean();

    if (!user) throw new AppError("User not found", 404);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const [todayAttendance, visits, stats] = await Promise.all([
      Attendance.findOne({ user: userId, date: { $gte: todayStart, $lt: todayEnd } }).lean(),

      Visit.find({ user: userId, createdAt: { $gte: dateRange.start, $lte: dateRange.end } })
        .populate('previousVisit', 'locationName')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),

      Visit.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId), createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
        {
          $group: {
            _id: null,
            totalVisits:      { $sum: 1 },
            completedVisits:  { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
            cancelledVisits:  { $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] } },
            totalDistance:    { $sum: '$distanceFromPreviousKm' },
            totalTimeSpent:   { $sum: '$timeSpentMinutes' },
            avgDistance:      { $avg: '$distanceFromPreviousKm' }
          }
        }
      ])
    ]);

    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);
    last7Days.setHours(0, 0, 0, 0);

    const dailyBreakdown = await Visit.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId), createdAt: { $gte: last7Days } } },
      {
        $group: {
          _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, dayOfWeek: { $dayOfWeek: "$createdAt" } },
          distance:         { $sum: "$distanceFromPreviousKm" },
          visits:           { $sum: 1 },
          completedVisits:  { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
          timeSpent:        { $sum: "$timeSpentMinutes" }
        }
      },
      { $sort: { "_id.date": 1 } }
    ]);

    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    return {
      user: {
        id:          user._id,
        name:        `${user.firstName} ${user.lastName}`,
        firstName:   user.firstName,
        lastName:    user.lastName,
        email:       user.email,
        phoneNumber: user.phoneNumber,
        employeeId:  user.employeeId || 'N/A',
        role:        user.role,
        status:      user.status,
        supervisor:  user.supervisor ? {
          id:          user.supervisor._id,
          name:        `${user.supervisor.firstName} ${user.supervisor.lastName}`,
          email:       user.supervisor.email,
          role:        user.supervisor.role,
          phoneNumber: user.supervisor.phoneNumber
        } : null,
        createdBy: user.createdBy ? {
          id:    user.createdBy._id,
          name:  `${user.createdBy.firstName} ${user.createdBy.lastName}`,
          email: user.createdBy.email,
          role:  user.createdBy.role
        } : null,
        lastLogin: user.lastLoginDate
      },
      currentStatus: {
        status:     calculateDutyStatus(todayAttendance, user),
        attendance: todayAttendance ? {
          punchIn:    todayAttendance.punchIn?.time,
          punchOut:   todayAttendance.punchOut?.time,
          totalHours: todayAttendance.totalHours || 0,
          date:       todayAttendance.date
        } : null
      },
      summary: {
        totalVisits:      stats[0]?.totalVisits     || 0,
        completedVisits:  stats[0]?.completedVisits || 0,
        cancelledVisits:  stats[0]?.cancelledVisits || 0,
        pendingVisits:    (stats[0]?.totalVisits || 0) - (stats[0]?.completedVisits || 0) - (stats[0]?.cancelledVisits || 0),
        completionRate:   (stats[0]?.totalVisits || 0) > 0
          ? Math.round(((stats[0]?.completedVisits || 0) / (stats[0]?.totalVisits || 1)) * 100) : 0,
        totalDistance:    Number((stats[0]?.totalDistance || 0).toFixed(1)),
        totalTimeSpent:   Math.round((stats[0]?.totalTimeSpent || 0) / 60),
        avgDistance:      Number((stats[0]?.avgDistance    || 0).toFixed(1))
      },
      recentVisits: visits.map(v => ({
        id:               v._id,
        locationName:     v.locationName,
        address:          v.address,
        status:           v.status,
        checkInTime:      v.checkInTime,
        checkOutTime:     v.checkOutTime,
        distance:         v.distanceFromPreviousKm,
        duration:         v.timeSpentMinutes ? `${Math.floor(v.timeSpentMinutes / 60)}h ${v.timeSpentMinutes % 60}m` : 'N/A',
        previousLocation: v.previousVisit?.locationName,
        verified:         v.verified,
        // ── include remarks so callers can show description for 'Other' visits ──
        remarks:          v.remarks || null,
      })),
      dailyBreakdown: dailyBreakdown.map(day => ({
        date:             day._id.date,
        day:              dayNames[day._id.dayOfWeek - 1],
        distance:         Number(day.distance.toFixed(1)),
        visits:           day.visits,
        completedVisits:  day.completedVisits,
        timeSpentHours:   Math.round(day.timeSpent / 60)
      }))
    };
  } catch (error) {
    console.error("My performance error:", error);
    throw new AppError(error.message || "Failed to fetch my performance", 500);
  }
};

/* =========================================================
   GET TEAM BY SUPERVISOR
========================================================= */
export const getTeamBySupervisorService = async (supervisorId, currentUser) => {
  try {
    if (currentUser.role === 'ASM' && currentUser._id.toString() !== supervisorId) {
      throw new AppError("Access denied. You can only view your own team.", 403);
    }

    const supervisorUser = await User.findById(supervisorId);
    if (!supervisorUser) {
      throw new AppError("Supervisor not found", 404);
    }
    await assertSameHeadOffice(currentUser, supervisorUser);

    const [teamMembers, supervisor, teamStats] = await Promise.all([
      User.find({ supervisor: supervisorId, role: 'TEAM', status: 'active' })
        .select('firstName lastName email phoneNumber lastLoginDate employeeId')
        .sort({ firstName: 1 })
        .lean(),

      User.findById(supervisorId).select('firstName lastName email role phoneNumber').lean(),

      (async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const teamMemberIds = (await User.find({ supervisor: supervisorId, role: 'TEAM' }).lean()).map(m => m._id);

        const stats = await Visit.aggregate([
          { $match: { user: { $in: teamMemberIds }, createdAt: { $gte: today, $lt: tomorrow } } },
          {
            $group: {
              _id: null,
              totalVisits:     { $sum: 1 },
              completedVisits: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
              totalDistance:   { $sum: '$distanceFromPreviousKm' }
            }
          }
        ]);

        return stats[0] || { totalVisits: 0, completedVisits: 0, totalDistance: 0 };
      })()
    ]);

    return {
      supervisor: supervisor ? {
        id:          supervisor._id,
        name:        `${supervisor.firstName} ${supervisor.lastName}`,
        email:       supervisor.email,
        role:        supervisor.role,
        phoneNumber: supervisor.phoneNumber
      } : null,
      totalMembers: teamMembers.length,
      teamStats: {
        totalVisits:     teamStats.totalVisits,
        completedVisits: teamStats.completedVisits,
        totalDistance:   Number(teamStats.totalDistance.toFixed(1))
      },
      teamMembers: teamMembers.map(m => ({
        id:          m._id,
        name:        `${m.firstName} ${m.lastName}`,
        email:       m.email,
        phoneNumber: m.phoneNumber,
        employeeId:  m.employeeId,
        lastLogin:   m.lastLoginDate ? formatRelativeTime(m.lastLoginDate) : 'Never'
      }))
    };
  } catch (error) {
    console.error("Team by supervisor error:", error);
    throw new AppError(error.message || "Failed to fetch team by supervisor", 500);
  }
};

/* =========================================================
   GET TEAM MEMBER PERFORMANCE
========================================================= */
export const getTeamMemberPerformanceService = async (memberId, currentUser) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      throw new AppError("Invalid member ID format", 400);
    }

    let canAccess = false;

    if (currentUser.role === 'TEAM') {
      canAccess = currentUser._id.toString() === memberId;
    } else if (currentUser.role === 'ASM') {
      const member = await User.findOne({ _id: memberId, supervisor: currentUser._id, role: 'TEAM' });
      canAccess = !!member;
    } else if (['Head_office', 'ZSM'].includes(currentUser.role)) {
      const member = await User.findById(memberId).select('_id');
      if (member) {
        await assertSameHeadOffice(currentUser, member);
        canAccess = true;
      }
    }

    if (!canAccess) {
      throw new AppError("You don't have permission to view this member's data", 403);
    }

    const member = await User.findById(memberId)
      .select('firstName lastName email phoneNumber role status supervisor createdBy lastLoginDate employeeId address city state pincode')
      .populate('supervisor', 'firstName lastName email role phoneNumber')
      .populate('createdBy',  'firstName lastName email role')
      .lean();

    if (!member) throw new AppError("Team member not found", 404);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const [
      todayAttendance, todayVisits, recentVisits, stats,
      dailyBreakdown, lastKnownLocation, supervisorInfo, attendanceHistory
    ] = await Promise.all([
      Attendance.findOne({ user: memberId, date: { $gte: today, $lt: tomorrow } }).lean(),
      Visit.find({ user: memberId, createdAt: { $gte: today, $lt: tomorrow } }).sort({ createdAt: -1 }).lean(),
      Visit.find({ user: memberId, createdAt: { $gte: thirtyDaysAgo } })
        .populate('previousVisit', 'locationName coordinates')
        .sort({ createdAt: -1 }).limit(20).lean(),
      Visit.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(memberId), createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: null,
            totalVisits:      { $sum: 1 },
            completedVisits:  { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
            inProgressVisits: { $sum: { $cond: [{ $eq: ['$status', 'InProgress'] }, 1, 0] } },
            cancelledVisits:  { $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] } },
            totalDistance:    { $sum: '$distanceFromPreviousKm' },
            totalTimeSpent:   { $sum: '$timeSpentMinutes' },
            avgDistance:      { $avg: '$distanceFromPreviousKm' },
            avgTimeSpent:     { $avg: '$timeSpentMinutes' },
            totalTravelTime:  { $sum: '$travelTimeMinutes' }
          }
        }
      ]),
      Visit.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(memberId), createdAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, dayOfWeek: { $dayOfWeek: "$createdAt" } },
            distance:        { $sum: '$distanceFromPreviousKm' },
            visits:          { $sum: 1 },
            completedVisits: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
            timeSpent:       { $sum: '$timeSpentMinutes' },
            travelTime:      { $sum: '$travelTimeMinutes' }
          }
        },
        { $sort: { '_id.date': 1 } }
      ]),
      Visit.findOne({ user: memberId, coordinates: { $exists: true, $ne: null } })
        .sort({ createdAt: -1 }).select('coordinates address locationName createdAt').lean(),
      member.supervisor ? User.findById(member.supervisor._id || member.supervisor)
        .select('firstName lastName email role phoneNumber').lean() : null,
      Attendance.find({ user: memberId, date: { $gte: thirtyDaysAgo } })
        .sort({ date: -1 }).limit(30).lean()
    ]);

    const statsData = stats[0] || {
      totalVisits: 0, completedVisits: 0, inProgressVisits: 0, cancelledVisits: 0,
      totalDistance: 0, totalTimeSpent: 0, avgDistance: 0, avgTimeSpent: 0, totalTravelTime: 0
    };

    const expectedTimePerVisit = 30;
    const actualAvgTime        = statsData.avgTimeSpent || 0;
    const timeEfficiency       = actualAvgTime > 0
      ? Math.min(100, Math.round((expectedTimePerVisit / actualAvgTime) * 100)) : 0;

    const onTimeVisits = recentVisits.filter(v =>
      v.status === 'Completed' && v.timeSpentMinutes && v.timeSpentMinutes <= expectedTimePerVisit * 1.5
    ).length;
    const completedRecentCount = recentVisits.filter(v => v.status === 'Completed').length;
    const onTimeRate = completedRecentCount > 0
      ? Math.round((onTimeVisits / completedRecentCount) * 100) : 0;

    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    const punchInTime  = todayAttendance?.punchIn?.time;
    const punchOutTime = todayAttendance?.punchOut?.time;

    let hoursWorkedToday = 0;
    if (punchInTime && !punchOutTime) {
      hoursWorkedToday = Math.round((new Date() - new Date(punchInTime)) / (1000 * 60 * 60) * 10) / 10;
    } else if (punchInTime && punchOutTime) {
      hoursWorkedToday = Math.round((new Date(punchOutTime) - new Date(punchInTime)) / (1000 * 60 * 60) * 10) / 10;
    }

    const presentDays    = attendanceHistory.filter(a => a.punchIn).length;
    const attendanceRate = Math.round((presentDays / 30) * 100);

    return {
      success: true,
      result: {
        id:          member._id,
        name:        `${member.firstName} ${member.lastName}`,
        firstName:   member.firstName,
        lastName:    member.lastName,
        email:       member.email,
        phoneNumber: member.phoneNumber,
        employeeId:  member.employeeId || 'N/A',
        role:        member.role,
        status:      member.status,
        address:     member.address,
        city:        member.city,
        state:       member.state,
        pincode:     member.pincode,
        currentStatus: {
          dutyStatus: calculateDutyStatus(todayAttendance, member),
          isOnline:   false,
          lastSeen:   member.lastLoginDate,
          attendance: todayAttendance ? {
            id:          todayAttendance._id,
            punchIn:     punchInTime,
            punchOut:    punchOutTime,
            hoursWorked: hoursWorkedToday,
            date:        todayAttendance.date,
            status:      todayAttendance.status || 'PRESENT'
          } : null,
          todayVisits: {
            total:     todayVisits.length,
            completed: todayVisits.filter(v => v.status === 'Completed').length,
            pending:   todayVisits.length - todayVisits.filter(v => v.status === 'Completed').length
          }
        },
        lastKnownLocation: lastKnownLocation ? {
          address:      lastKnownLocation.address || 'Location not available',
          coordinates:  lastKnownLocation.coordinates,
          locationName: lastKnownLocation.locationName,
          time:         formatRelativeTime(lastKnownLocation.createdAt),
          timestamp:    lastKnownLocation.createdAt
        } : { address: 'No location data available', time: 'N/A' },
        performance: {
          efficiency:        timeEfficiency,
          onTimeRate:        onTimeRate,
          avgTimePerVisit:   Math.round(statsData.avgTimeSpent || 0),
          totalTimeSpent:    Math.round((statsData.totalTimeSpent  || 0) / 60),
          totalTravelTime:   Math.round((statsData.totalTravelTime || 0) / 60),
          attendanceRate:    attendanceRate,
          presentDays:       presentDays,
          totalWorkingDays:  30
        },
        visits: {
          total:          statsData.totalVisits,
          completed:      statsData.completedVisits,
          inProgress:     statsData.inProgressVisits,
          cancelled:      statsData.cancelledVisits,
          pending:        statsData.totalVisits - statsData.completedVisits - statsData.cancelledVisits,
          completionRate: statsData.totalVisits > 0
            ? Math.round((statsData.completedVisits / statsData.totalVisits) * 100) : 0
        },
        distance: {
          total:   Number(statsData.totalDistance.toFixed(1)),
          average: Number(statsData.avgDistance.toFixed(1)),
          today:   Number(todayVisits.reduce((sum, v) => sum + (v.distanceFromPreviousKm || 0), 0).toFixed(1))
        },
        recentVisits: recentVisits.map(v => ({
          id:               v._id,
          locationName:     v.locationName,
          address:          v.address,
          status:           v.status,
          checkInTime:      v.checkInTime,
          checkOutTime:     v.checkOutTime,
          distance:         v.distanceFromPreviousKm || 0,
          duration:         v.timeSpentMinutes ? `${Math.floor(v.timeSpentMinutes / 60)}h ${v.timeSpentMinutes % 60}m` : 'N/A',
          durationMinutes:  v.timeSpentMinutes,
          previousLocation: v.previousVisit?.locationName,
          travelTime:       v.travelTimeMinutes ? `${v.travelTimeMinutes} min` : 'N/A',
          coordinates:      v.coordinates,
          photos:           shouldExposeVisitPhotos(v) ? (v.photos?.map(p => p.url || p) || []) : [],
          verified:         v.verified,
          remarks:          v.remarks || null,   // ← description for 'Other' visits
          isLeadCreate:     v.isLeadCreate,
          leadCreated:      v.leadCreated
        })),
        dailyBreakdown: dailyBreakdown.map(day => ({
          date:            day._id.date,
          day:             dayNames[day._id.dayOfWeek - 1],
          distance:        Number(day.distance.toFixed(1)),
          visits:          day.visits,
          completedVisits: day.completedVisits,
          timeSpent:       day.timeSpent ? Math.round(day.timeSpent   / 60) : 0,
          travelTime:      day.travelTime ? Math.round(day.travelTime / 60) : 0
        })),
        supervisor: supervisorInfo ? {
          id:          supervisorInfo._id,
          name:        `${supervisorInfo.firstName} ${supervisorInfo.lastName}`,
          email:       supervisorInfo.email,
          role:        supervisorInfo.role,
          phoneNumber: supervisorInfo.phoneNumber
        } : null,
        createdBy: member.createdBy ? {
          id:    member.createdBy._id,
          name:  `${member.createdBy.firstName} ${member.createdBy.lastName}`,
          email: member.createdBy.email,
          role:  member.createdBy.role
        } : null,
        lastLogin:          member.lastLoginDate,
        lastLoginFormatted: member.lastLoginDate ? formatRelativeTime(member.lastLoginDate) : 'Never',
        reportGeneratedAt:  new Date().toISOString(),
        dateRange: { start: thirtyDaysAgo, end: new Date() }
      }
    };
  } catch (error) {
    console.error("Get team member performance error:", error);
    throw new AppError(error.message || "Failed to fetch team member performance", error.status || 500);
  }
};
