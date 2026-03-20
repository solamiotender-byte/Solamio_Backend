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

/* =========================================================
   HELPERS
========================================================= */

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
  if (file.filename) return generateFullUrl(file.filename);
  if (file.path) return `${process.env.BASE_URL || 'http://localhost:5000'}/${file.path}`;
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
    .filter(photo => photo.url); // Remove any with null URLs
};

// Helper to create lead from visit data
const createLeadFromVisit = async (visit, data, session) => {
  try {
    // Prepare lead data
    const leadData = {
      name: data.contactPerson || data.locationName || "Customer",
      email: data.email || "",
      phone: data.phone || "",
      address: data.address || visit.address || "",
      source: "Visit",
      status: "New",
      assignedTo: visit.user,
      visit: visit._id,
      coordinates: visit.coordinates,
      notes: data.remarks || `Lead created from visit at ${data.locationName}`,
      createdBy: visit.user
    };

    // Create the lead
    const [lead] = await Lead.create([leadData], { session });

    // Update visit with lead reference
    visit.leadCreated = lead._id;
    await visit.save({ session });

    return lead;
  } catch (error) {
    console.error("Lead creation error:", error);
    throw new AppError("Failed to create lead from visit", 500);
  }
};

export const createVisitService = async (data, currentUser, files = []) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Validate required fields
    if (!data.latitude || !data.longitude) {
      throw new AppError("Location coordinates are required", 400);
    }

    // Parse and validate coordinates
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

    // Get address from coordinates (optional)
    let address = null;
    try {
      address = await getAddressFromCoords(lat, lng);
    } catch (error) {
      console.error("Address lookup failed:", error);
      // Continue without address - it's optional
    }

    // Process uploaded photos
    const photos = processPhotos(files);

    // Get previous visit for distance calculation
    const previousVisit = await getPreviousVisit(currentUser._id);

    let previousVisitId = null;
    let distanceFromPreviousKm = 0;
    let totalDistanceTillNowKm = 0;
    let travelTimeMinutes = 0;

    if (previousVisit && previousVisit.coordinates) {
      previousVisitId = previousVisit._id;

      // Calculate distance from previous visit
      distanceFromPreviousKm = calculateDistanceKm(
        previousVisit.coordinates.lat,
        previousVisit.coordinates.lng,
        lat,
        lng
      );

      // Calculate total distance
      totalDistanceTillNowKm =
        (previousVisit.totalDistanceTillNowKm || 0) + distanceFromPreviousKm;

      // Calculate estimated travel time (optional)
      if (distanceFromPreviousKm > 0) {
        // Assuming average speed of 40 km/h
        travelTimeMinutes = Math.round((distanceFromPreviousKm / 40) * 60);
      }
    }

    // Determine if this is a lead creation
    const isLeadCreate = data.isLeadCreate === true || data.isLeadCreate === 'true';

    // Prepare visit data
    const visitData = {
      user: currentUser._id,
      attendance: attendance._id,
      locationName: data.locationName || "Customer Visit",
      coordinates: {
        lat: parseFloat(lat.toFixed(6)),
        lng: parseFloat(lng.toFixed(6))
      },
      address: address || data.address || null,
      previousVisit: previousVisitId,
      distanceFromPreviousKm: Number(distanceFromPreviousKm.toFixed(2)),
      totalDistanceTillNowKm: Number(totalDistanceTillNowKm.toFixed(2)),
      travelTimeMinutes: travelTimeMinutes,
      checkInTime: new Date(),
      photos,
      visitDate: new Date(),
      remarks: data.remarks || "",
      status: 'InProgress',
      isLeadCreate: isLeadCreate
    };

    // Add lead-specific fields if this is a lead creation
    if (isLeadCreate) {
      // Validate required fields for lead creation
      if (!data.contactPerson && !data.phone && !data.email) {
        throw new AppError("At least one contact information (name, phone, or email) is required for lead creation", 400);
      }

      visitData.contactPerson = data.contactPerson || "";
      visitData.phone = data.phone || "";
      visitData.email = data.email || "";

      // If address wasn't resolved, use provided address
      if (!visitData.address && data.address) {
        visitData.address = data.address;
      }
    }

    // Create the visit
    const [visit] = await Visit.create([visitData], { session });

    // Create lead if this is a lead creation
    let createdLead = null;
    if (isLeadCreate) {
      try {
        createdLead = await createLeadFromVisit(visit, data, session);
        //console.log(`Lead created successfully: ${createdLead._id}`);
      } catch (leadError) {
        console.error("Failed to create lead:", leadError);
        // Don't throw here - we still want to save the visit even if lead creation fails
        // But we'll add an error note to the visit
        visit.remarks = (visit.remarks || "") + " [Lead creation failed: " + leadError.message + "]";
        await visit.save({ session });
      }
    }

    // Commit transaction
    await session.commitTransaction();

    // Get populated visit
    const populatedVisit = await Visit.findById(visit._id)
      .populate("user", "firstName lastName email role")
      .populate("attendance")
      .populate("previousVisit", "locationName coordinates locationName")
      .populate("leadCreated"); // Populate lead if created

    // Emit socket event for real-time updates
    try {
      const io = getIO();
      if (io) {
        io.to(`user:${currentUser._id}`).emit('visit:created', {
          visit: populatedVisit,
          lead: createdLead
        });

        // If lead created, also emit to admin/manager rooms
        if (createdLead) {
          io.to('role:Head_office').to('role:ZSM').to('role:ASM').emit('lead:created', {
            lead: createdLead,
            visit: populatedVisit,
            createdBy: currentUser
          });
        }
      }
    } catch (socketError) {
      console.error("Socket emission error:", socketError);
      // Don't throw - non-critical
    }

    return {
      success: true,
      visit: populatedVisit,
      lead: createdLead,
      message: createdLead ? "Visit and lead created successfully" : "Visit created successfully"
    };

  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();

    console.error("Create visit service error:", error);

    // Throw appropriate error
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(error.message || "Failed to create visit", 500);
  } finally {
    // Always end session
    session.endSession();
  }
};

// Also add a function to check if a lead already exists at a location
export const checkExistingLeadAtLocation = async (lat, lng, radiusKm = 0.1) => {
  try {
    // Use geospatial query to find leads within radius
    const existingLead = await Lead.findOne({
      coordinates: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [lng, lat]
          },
          $maxDistance: radiusKm * 1000 // Convert to meters
        }
      },
      status: { $ne: "Closed" } // Only check active leads
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

    visit.status = "Completed";
    visit.checkOutTime = new Date();

    if (visit.checkInTime) {
      visit.timeSpentMinutes = Math.round((visit.checkOutTime - visit.checkInTime) / 60000);
    }

    await visit.save({ session });
    await session.commitTransaction();

    // Emit socket event
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

  // Build filter based on user role
  let filter = {};

  // Role-based filtering
  if (currentUser.role === 'TEAM') {
    filter.user = currentUser._id;
  }
  else if (currentUser.role === 'ASM') {
    const teamMembers = await User.find({
      supervisor: currentUser._id,
      role: 'TEAM'
    }).select('_id').lean();

    const teamMemberIds = teamMembers.map(m => m._id);
    filter.user = { $in: [...teamMemberIds, currentUser._id] };
  }
  else if (['Head_office', 'ZSM'].includes(currentUser.role)) {
    if (userId) {
      filter.user = userId;
    }
  }

  // Date range filter
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  // Status filter
  if (status) {
    filter.status = status;
  }

  // Search filter
  if (search) {
    filter.$or = [
      { locationName: { $regex: search, $options: 'i' } },
      { address: { $regex: search, $options: 'i' } },
      { remarks: { $regex: search, $options: 'i' } },
      { contactPerson: { $regex: search, $options: 'i' } }
    ];
  }

  // Execute parallel queries for better performance
  const [visits, total] = await Promise.all([
    Visit.find(filter)
      .populate('user', 'firstName lastName email role')
      .populate('previousVisit', 'locationName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),

    Visit.countDocuments(filter)
  ]);

  return {
    visits,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      totalItems: total,
      itemsPerPage: parseInt(limit)
    }
  };
};

/* =========================================================
   GET VISIT BY ID
========================================================= */
export const getVisitByIdService = async (visitId, currentUser) => {
  const visit = await Visit.findById(visitId)
    .populate('user', 'firstName lastName email role')
    .populate('attendance')
    .populate('previousVisit', 'locationName coordinates address')
    .populate('nextVisit', 'locationName')
    .lean();

  if (!visit) throw new AppError("Visit not found", 404);

  // Check authorization
  if (currentUser.role === 'TEAM' && visit.user._id.toString() !== currentUser._id.toString()) {
    throw new AppError("Unauthorized", 403);
  }

  return visit;
};

/* =========================================================
   UPDATE VISIT
========================================================= */
export const updateVisitService = async (visitId, data, currentUser) => {

  //console.log("data1111..", visitId, data, currentUser)
  const visit = await Visit.findById(visitId);

  if (!visit) throw new AppError("Visit not found", 404);
  if (visit.user.toString() !== currentUser._id.toString()) {
    throw new AppError("Unauthorized", 403);
  }

  // Only allow updating certain fields
  const allowedUpdates = ['locationName', 'remarks', 'contactPerson', 'phone', 'email', 'address'];
  const updates = {};

  allowedUpdates.forEach(field => {
    if (data[field] !== undefined) {
      updates[field] = data[field];
    }
  });

  Object.assign(visit, updates);
  await visit.save();

  // Emit socket event
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
  let filter = {};

  if (currentUser.role === 'TEAM') {
    filter.user = currentUser._id;
  }
  else if (currentUser.role === 'ASM') {
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
    .lean();
};

/* =========================================================
   GET VISIT STATS
========================================================= */
export const getVisitStatsService = async (currentUser) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let userFilter = {};

  if (currentUser.role === 'TEAM') {
    userFilter = { user: currentUser._id };
  }
  else if (currentUser.role === 'ASM') {
    const teamMembers = await User.find({
      supervisor: currentUser._id,
      role: 'TEAM'
    }).select('_id').lean();

    const teamMemberIds = teamMembers.map(m => m._id);
    userFilter = { user: { $in: [...teamMemberIds, currentUser._id] } };
  }

  // Use aggregation for better performance
  const [todayVisits, allTimeStats, todayStats] = await Promise.all([
    // Today's visits count
    Visit.countDocuments({
      ...userFilter,
      createdAt: { $gte: today, $lt: tomorrow }
    }),

    // All-time stats
    Visit.aggregate([
      { $match: userFilter },
      {
        $group: {
          _id: null,
          totalDistance: { $sum: "$distanceFromPreviousKm" },
          totalTravelTime: { $sum: "$travelTimeMinutes" },
          totalVisits: { $sum: 1 },
          totalCompletedVisits: {
            $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] }
          },
          totalCancelledVisits: {
            $sum: { $cond: [{ $eq: ["$status", "Cancelled"] }, 1, 0] }
          }
        }
      }
    ]),

    // Today's stats
    Visit.aggregate([
      {
        $match: {
          ...userFilter,
          createdAt: { $gte: today, $lt: tomorrow }
        }
      },
      {
        $group: {
          _id: null,
          todayDistance: { $sum: "$distanceFromPreviousKm" },
          todayTravelTime: { $sum: "$travelTimeMinutes" }
        }
      }
    ])
  ]);

  return {
    visitsToday: todayVisits,
    totalVisits: allTimeStats[0]?.totalVisits || 0,
    totalCompletedVisits: allTimeStats[0]?.totalCompletedVisits || 0,
    totalCancelledVisits: allTimeStats[0]?.totalCancelledVisits || 0,
    totalDistanceKm: Number((allTimeStats[0]?.totalDistance || 0).toFixed(2)),
    totalTravelTimeMinutes: allTimeStats[0]?.totalTravelTime || 0,
    todayDistanceKm: Number((todayStats[0]?.todayDistance || 0).toFixed(2)),
    todayTravelTimeMinutes: todayStats[0]?.todayTravelTime || 0
  };
};

/* =========================================================
   GET TEAM PERFORMANCE
========================================================= */
export const getTeamPerformanceService = async (query, currentUser) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      sortBy = 'distance',
      sortOrder = 'desc',
      status = 'active',
      teamId,
      asmId
    } = query;

    // Build user filter based on role
    const filter = await buildUserFilter(currentUser, { status, teamId, asmId });

    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // For TEAM role, they only see themselves
    if (currentUser.role === 'TEAM') {
      const user = await User.findById(currentUser._id)
        .select('firstName lastName email phoneNumber role status supervisor createdBy lastLoginDate employeeId')
        .populate('supervisor', 'firstName lastName email role')
        .populate('createdBy', 'firstName lastName email role')
        .lean();

      const performanceData = await getUserPerformanceData([user], currentUser);

      return {
        teamMembers: performanceData,
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalItems: 1,
          itemsPerPage: 1
        },
        summary: await getTeamSummary([currentUser._id], currentUser),
        role: currentUser.role
      };
    }

    // For managers, get their team members
    const teamMembers = await User.find(filter)
      .select('firstName lastName email phoneNumber role status supervisor createdBy lastLoginDate employeeId')
      .populate('supervisor', 'firstName lastName email role')
      .populate('createdBy', 'firstName lastName email role')
      .sort({ firstName: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await User.countDocuments(filter);

    // Get performance data for each team member
    const performanceData = await getUserPerformanceData(teamMembers, currentUser);

    // Sort performance data
    const sortedData = sortPerformanceData(performanceData, sortBy, sortOrder);

    // Get summary statistics
    const userIds = teamMembers.map(m => m._id);
    const summary = await getTeamSummary(userIds, currentUser);

    return {
      teamMembers: sortedData,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      },
      summary,
      role: currentUser.role,
      filters: {
        search,
        sortBy,
        sortOrder,
        status
      }
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

  // Get all today's visits in one query
  const todayVisits = await Visit.find({
    user: { $in: userIds },
    createdAt: { $gte: today, $lt: tomorrow }
  })
    .sort({ createdAt: -1 })
    .lean();

  // Group visits by user
  const visitsByUser = {};
  todayVisits.forEach(visit => {
    const userId = visit.user.toString();
    if (!visitsByUser[userId]) visitsByUser[userId] = [];
    visitsByUser[userId].push(visit);
  });

  // Get attendance for today
  const attendances = await Attendance.find({
    user: { $in: userIds },
    date: { $gte: today, $lt: tomorrow }
  }).lean();

  const attendanceByUser = {};
  attendances.forEach(att => {
    attendanceByUser[att.user.toString()] = att;
  });

  // Get last known locations
  const lastVisits = await Visit.aggregate([
    {
      $match: {
        user: { $in: userIds },
        coordinates: { $exists: true }
      }
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$user",
        visit: { $first: "$$ROOT" }
      }
    }
  ]);

  const lastVisitByUser = {};
  lastVisits.forEach(item => {
    lastVisitByUser[item._id.toString()] = item.visit;
  });

  // Calculate stats for each user
  return users.map(user => {
    const userVisits = visitsByUser[user._id.toString()] || [];
    const attendance = attendanceByUser[user._id.toString()];
    const lastVisit = lastVisitByUser[user._id.toString()];

    const totalDistance = userVisits.reduce((sum, v) => sum + (v.distanceFromPreviousKm || 0), 0);
    const completedVisits = userVisits.filter(v => v.status === 'Completed').length;
    const inProgressVisits = userVisits.filter(v => v.status === 'InProgress').length;
    const cancelledVisits = userVisits.filter(v => v.status === 'Cancelled').length;

    return {
      id: user._id,
      name: `${user.firstName} ${user.lastName}`,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      employeeId: user.employeeId || 'N/A',
      role: user.role,
      accountStatus: user.status,
      dutyStatus: calculateDutyStatus(attendance, user),
      distance: Number(totalDistance.toFixed(1)),
      visits: {
        completed: completedVisits,
        inProgress: inProgressVisits,
        cancelled: cancelledVisits,
        total: userVisits.length
      },
      lastKnownLocation: lastVisit ? {
        address: lastVisit.address || 'Location not available',
        coordinates: lastVisit.coordinates,
        time: formatRelativeTime(lastVisit.createdAt)
      } : {
        address: 'No location data',
        time: 'N/A'
      },
      attendance: attendance ? {
        punchIn: attendance.punchIn?.time,
        punchOut: attendance.punchOut?.time,
        totalHours: attendance.totalHours || 0,
        date: attendance.date
      } : null,
      supervisor: user.supervisor ? {
        id: user.supervisor._id,
        name: `${user.supervisor.firstName} ${user.supervisor.lastName}`,
        email: user.supervisor.email,
        role: user.supervisor.role
      } : null,
      createdBy: user.createdBy ? {
        id: user.createdBy._id,
        name: `${user.createdBy.firstName} ${user.createdBy.lastName}`,
        email: user.createdBy.email,
        role: user.createdBy.role
      } : null,
      lastLogin: user.lastLoginDate ? formatRelativeTime(user.lastLoginDate) : 'Never',
      lastLoginRaw: user.lastLoginDate,
      recentVisits: userVisits.slice(0, 3).map(v => ({
        id: v._id,
        locationName: v.locationName,
        status: v.status,
        time: formatRelativeTime(v.createdAt)
      }))
    };
  });
};

/* =========================================================
   BUILD USER FILTER (Helper)
========================================================= */
const buildUserFilter = async (currentUser, options = {}) => {
  const filter = {
    role: 'TEAM',
    ...(options.status && { status: options.status })
  };

  switch (currentUser.role) {
    case 'Head_office':
    case 'ZSM':
      if (options.asmId) {
        filter.supervisor = options.asmId;
      }
      break;

    case 'ASM':
      filter.supervisor = currentUser._id;
      break;

    case 'TEAM':
      // Handled separately
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
    // Attendance stats
    Attendance.aggregate([
      {
        $match: {
          user: { $in: userIds },
          date: { $gte: today, $lt: tomorrow }
        }
      },
      {
        $group: {
          _id: null,
          onDuty: {
            $sum: {
              $cond: [
                { $and: ['$punchIn', { $eq: ['$punchOut', null] }] },
                1, 0
              ]
            }
          },
          completed: {
            $sum: {
              $cond: [
                { $and: ['$punchIn', '$punchOut'] },
                1, 0
              ]
            }
          },
          totalPresent: {
            $sum: {
              $cond: ['$punchIn', 1, 0]
            }
          }
        }
      }
    ]),

    // Visit stats
    Visit.aggregate([
      {
        $match: {
          user: { $in: userIds },
          createdAt: { $gte: today, $lt: tomorrow }
        }
      },
      {
        $group: {
          _id: null,
          totalVisits: { $sum: 1 },
          completedVisits: {
            $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] }
          },
          inProgressVisits: {
            $sum: { $cond: [{ $eq: ['$status', 'InProgress'] }, 1, 0] }
          },
          cancelledVisits: {
            $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] }
          }
        }
      }
    ]),

    // Distance stats
    Visit.aggregate([
      {
        $match: {
          user: { $in: userIds },
          createdAt: { $gte: today, $lt: tomorrow }
        }
      },
      {
        $group: {
          _id: null,
          totalDistance: { $sum: '$distanceFromPreviousKm' },
          avgDistance: { $avg: '$distanceFromPreviousKm' }
        }
      }
    ])
  ]);

  const activeUsers = userIds.length;

  return {
    totalMembers: userIds.length,
    activeMembers: activeUsers,
    onDuty: attendanceStats[0]?.onDuty || 0,
    completed: attendanceStats[0]?.completed || 0,
    absent: activeUsers - (attendanceStats[0]?.totalPresent || 0),
    attendanceRate: activeUsers > 0
      ? Math.round(((attendanceStats[0]?.totalPresent || 0) / activeUsers) * 100)
      : 0,
    totalVisits: visitStats[0]?.totalVisits || 0,
    completedVisits: visitStats[0]?.completedVisits || 0,
    inProgressVisits: visitStats[0]?.inProgressVisits || 0,
    pendingVisits: (visitStats[0]?.totalVisits || 0) - (visitStats[0]?.completedVisits || 0),
    completionRate: (visitStats[0]?.totalVisits || 0) > 0
      ? Math.round(((visitStats[0]?.completedVisits || 0) / (visitStats[0]?.totalVisits || 1)) * 100)
      : 0,
    totalDistance: Number((distanceStats[0]?.totalDistance || 0).toFixed(1)),
    avgDistance: Number((distanceStats[0]?.avgDistance || 0).toFixed(1))
  };
};

/* =========================================================
   CALCULATE DUTY STATUS (Helper)
========================================================= */
const calculateDutyStatus = (attendance, user) => {
  if (user.status !== 'active') {
    return 'INACTIVE';
  }

  if (!attendance || !attendance.punchIn) {
    return 'OFF DUTY';
  }

  if (attendance.punchIn && !attendance.punchOut) {
    return 'ON DUTY';
  }

  if (attendance.punchIn && attendance.punchOut) {
    const punchIn = new Date(attendance.punchIn.time);
    const punchOut = new Date(attendance.punchOut.time);
    const hoursWorked = (punchOut - punchIn) / (1000 * 60 * 60);

    if (hoursWorked < 4) {
      return 'HALF DAY';
    }
    return 'COMPLETED';
  }

  return 'OFF DUTY';
};

/* =========================================================
   FORMAT RELATIVE TIME (Helper)
========================================================= */
const formatRelativeTime = (timestamp) => {
  if (!timestamp) return 'N/A';

  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
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
        const aCompletion = a.visits.total > 0 ? a.visits.completed / a.visits.total : 0;
        const bCompletion = b.visits.total > 0 ? b.visits.completed / b.visits.total : 0;
        return order * (aCompletion - bCompletion);

      case 'status':
        const statusOrder = {
          'ON DUTY': 1,
          'HALF DAY': 2,
          'COMPLETED': 3,
          'OFF DUTY': 4,
          'INACTIVE': 5
        };
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
      end: endDate ? new Date(endDate) : new Date()
    };

    // Get user details
    const user = await User.findById(userId)
      .select('firstName lastName email phoneNumber role status supervisor createdBy lastLoginDate employeeId')
      .populate('supervisor', 'firstName lastName email role phoneNumber')
      .populate('createdBy', 'firstName lastName email role')
      .lean();

    if (!user) {
      throw new AppError("User not found", 404);
    }

    // Get today's attendance
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const [todayAttendance, visits, stats] = await Promise.all([
      Attendance.findOne({
        user: userId,
        date: { $gte: todayStart, $lt: todayEnd }
      }).lean(),

      Visit.find({
        user: userId,
        createdAt: { $gte: dateRange.start, $lte: dateRange.end }
      })
        .populate('previousVisit', 'locationName')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),

      Visit.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            createdAt: { $gte: dateRange.start, $lte: dateRange.end }
          }
        },
        {
          $group: {
            _id: null,
            totalVisits: { $sum: 1 },
            completedVisits: {
              $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] }
            },
            cancelledVisits: {
              $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] }
            },
            totalDistance: { $sum: '$distanceFromPreviousKm' },
            totalTimeSpent: { $sum: '$timeSpentMinutes' },
            avgDistance: { $avg: '$distanceFromPreviousKm' }
          }
        }
      ])
    ]);

    // Get daily breakdown
    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);
    last7Days.setHours(0, 0, 0, 0);

    const dailyBreakdown = await Visit.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(userId),
          createdAt: { $gte: last7Days }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            dayOfWeek: { $dayOfWeek: "$createdAt" }
          },
          distance: { $sum: "$distanceFromPreviousKm" },
          visits: { $sum: 1 },
          completedVisits: {
            $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] }
          },
          timeSpent: { $sum: "$timeSpentMinutes" }
        }
      },
      { $sort: { "_id.date": 1 } }
    ]);

    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    return {
      user: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        employeeId: user.employeeId || 'N/A',
        role: user.role,
        status: user.status,
        supervisor: user.supervisor ? {
          id: user.supervisor._id,
          name: `${user.supervisor.firstName} ${user.supervisor.lastName}`,
          email: user.supervisor.email,
          role: user.supervisor.role,
          phoneNumber: user.supervisor.phoneNumber
        } : null,
        createdBy: user.createdBy ? {
          id: user.createdBy._id,
          name: `${user.createdBy.firstName} ${user.createdBy.lastName}`,
          email: user.createdBy.email,
          role: user.createdBy.role
        } : null,
        lastLogin: user.lastLoginDate
      },
      currentStatus: {
        status: calculateDutyStatus(todayAttendance, user),
        attendance: todayAttendance ? {
          punchIn: todayAttendance.punchIn?.time,
          punchOut: todayAttendance.punchOut?.time,
          totalHours: todayAttendance.totalHours || 0,
          date: todayAttendance.date
        } : null
      },
      summary: {
        totalVisits: stats[0]?.totalVisits || 0,
        completedVisits: stats[0]?.completedVisits || 0,
        cancelledVisits: stats[0]?.cancelledVisits || 0,
        pendingVisits: (stats[0]?.totalVisits || 0) - (stats[0]?.completedVisits || 0) - (stats[0]?.cancelledVisits || 0),
        completionRate: (stats[0]?.totalVisits || 0) > 0
          ? Math.round(((stats[0]?.completedVisits || 0) / (stats[0]?.totalVisits || 1)) * 100)
          : 0,
        totalDistance: Number((stats[0]?.totalDistance || 0).toFixed(1)),
        totalTimeSpent: Math.round((stats[0]?.totalTimeSpent || 0) / 60),
        avgDistance: Number((stats[0]?.avgDistance || 0).toFixed(1))
      },
      recentVisits: visits.map(v => ({
        id: v._id,
        locationName: v.locationName,
        address: v.address,
        status: v.status,
        checkInTime: v.checkInTime,
        checkOutTime: v.checkOutTime,
        distance: v.distanceFromPreviousKm,
        duration: v.timeSpentMinutes ? `${Math.floor(v.timeSpentMinutes / 60)}h ${v.timeSpentMinutes % 60}m` : 'N/A',
        previousLocation: v.previousVisit?.locationName,
        verified: v.verified
      })),
      dailyBreakdown: dailyBreakdown.map(day => ({
        date: day._id.date,
        day: dayNames[day._id.dayOfWeek - 1],
        distance: Number(day.distance.toFixed(1)),
        visits: day.visits,
        completedVisits: day.completedVisits,
        timeSpentHours: Math.round(day.timeSpent / 60)
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
    // Check authorization
    if (currentUser.role === 'ASM' && currentUser._id.toString() !== supervisorId) {
      throw new AppError("Access denied. You can only view your own team.", 403);
    }

    const [teamMembers, supervisor, teamStats] = await Promise.all([
      User.find({
        supervisor: supervisorId,
        role: 'TEAM',
        status: 'active'
      })
        .select('firstName lastName email phoneNumber lastLoginDate employeeId')
        .sort({ firstName: 1 })
        .lean(),

      User.findById(supervisorId)
        .select('firstName lastName email role phoneNumber')
        .lean(),

      // Team stats
      (async () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const teamMemberIds = teamMembers.map(m => m._id);

        const stats = await Visit.aggregate([
          {
            $match: {
              user: { $in: teamMemberIds },
              createdAt: { $gte: today, $lt: tomorrow }
            }
          },
          {
            $group: {
              _id: null,
              totalVisits: { $sum: 1 },
              completedVisits: {
                $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] }
              },
              totalDistance: { $sum: '$distanceFromPreviousKm' }
            }
          }
        ]);

        return stats[0] || { totalVisits: 0, completedVisits: 0, totalDistance: 0 };
      })()
    ]);

    return {
      supervisor: supervisor ? {
        id: supervisor._id,
        name: `${supervisor.firstName} ${supervisor.lastName}`,
        email: supervisor.email,
        role: supervisor.role,
        phoneNumber: supervisor.phoneNumber
      } : null,
      totalMembers: teamMembers.length,
      teamStats: {
        totalVisits: teamStats.totalVisits,
        completedVisits: teamStats.completedVisits,
        totalDistance: Number(teamStats.totalDistance.toFixed(1))
      },
      teamMembers: teamMembers.map(m => ({
        id: m._id,
        name: `${m.firstName} ${m.lastName}`,
        email: m.email,
        phoneNumber: m.phoneNumber,
        employeeId: m.employeeId,
        lastLogin: m.lastLoginDate ? formatRelativeTime(m.lastLoginDate) : 'Never'
      }))
    };
  } catch (error) {
    console.error("Team by supervisor error:", error);
    throw new AppError(error.message || "Failed to fetch team by supervisor", 500);
  }
};

// services/visit.service.js (add this function)
export const getTeamMemberPerformanceService = async (memberId, currentUser) => {
  try {

    // Validate member ID
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      throw new AppError("Invalid member ID format", 400);
    }

    let canAccess = false;

    // TEAM role can only access their own data
    if (currentUser.role === 'TEAM') {
      canAccess = currentUser._id.toString() === memberId;
    }
    // ASM can access their team members' data
    else if (currentUser.role === 'ASM') {
      // Check if member is in ASM's team
      const member = await User.findOne({
        _id: memberId,
        supervisor: currentUser._id,
        role: 'TEAM'
      });
      canAccess = !!member;
    }
    // Head_office and ZSM can access any team member
    else if (['Head_office', 'ZSM'].includes(currentUser.role)) {
      canAccess = true;
    }

    if (!canAccess) {
      throw new AppError("You don't have permission to view this member's data", 403);
    }

    // Get member details
    const member = await User.findById(memberId)
      .select('firstName lastName email phoneNumber role status supervisor createdBy lastLoginDate employeeId address city state pincode')
      .populate('supervisor', 'firstName lastName email role phoneNumber')
      .populate('createdBy', 'firstName lastName email role')
      .lean();

    if (!member) {
      throw new AppError("Team member not found", 404);
    }

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get date range for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // Get date range for last 7 days (for daily breakdown)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Run parallel queries for better performance
    const [
      todayAttendance,
      todayVisits,
      recentVisits,
      stats,
      dailyBreakdown,
      lastKnownLocation,
      supervisorInfo,
      attendanceHistory
    ] = await Promise.all([
      // Today's attendance
      Attendance.findOne({
        user: memberId,
        date: { $gte: today, $lt: tomorrow }
      }).lean(),

      // Today's visits
      Visit.find({
        user: memberId,
        createdAt: { $gte: today, $lt: tomorrow }
      })
        .sort({ createdAt: -1 })
        .lean(),

      // Recent visits (last 30 days)
      Visit.find({
        user: memberId,
        createdAt: { $gte: thirtyDaysAgo }
      })
        .populate('previousVisit', 'locationName coordinates')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),

      // Overall statistics
      Visit.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(memberId),
            createdAt: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: null,
            totalVisits: { $sum: 1 },
            completedVisits: {
              $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] }
            },
            inProgressVisits: {
              $sum: { $cond: [{ $eq: ['$status', 'InProgress'] }, 1, 0] }
            },
            cancelledVisits: {
              $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] }
            },
            totalDistance: { $sum: '$distanceFromPreviousKm' },
            totalTimeSpent: { $sum: '$timeSpentMinutes' },
            avgDistance: { $avg: '$distanceFromPreviousKm' },
            avgTimeSpent: { $avg: '$timeSpentMinutes' },
            totalTravelTime: { $sum: '$travelTimeMinutes' }
          }
        }
      ]),

      // Daily breakdown for last 7 days
      Visit.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(memberId),
            createdAt: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              dayOfWeek: { $dayOfWeek: "$createdAt" }
            },
            distance: { $sum: '$distanceFromPreviousKm' },
            visits: { $sum: 1 },
            completedVisits: {
              $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] }
            },
            timeSpent: { $sum: '$timeSpentMinutes' },
            travelTime: { $sum: '$travelTimeMinutes' }
          }
        },
        { $sort: { '_id.date': 1 } }
      ]),

      // Last known location (most recent visit with coordinates)
      Visit.findOne({
        user: memberId,
        coordinates: { $exists: true, $ne: null }
      })
        .sort({ createdAt: -1 })
        .select('coordinates address locationName createdAt')
        .lean(),

      // Supervisor details (if not already populated)
      member.supervisor ? User.findById(member.supervisor._id || member.supervisor)
        .select('firstName lastName email role phoneNumber')
        .lean() : null,

      // Attendance history for last 30 days
      Attendance.find({
        user: memberId,
        date: { $gte: thirtyDaysAgo }
      })
        .sort({ date: -1 })
        .limit(30)
        .lean()
    ]);

    // Calculate performance metrics
    const statsData = stats[0] || {
      totalVisits: 0,
      completedVisits: 0,
      inProgressVisits: 0,
      cancelledVisits: 0,
      totalDistance: 0,
      totalTimeSpent: 0,
      avgDistance: 0,
      avgTimeSpent: 0,
      totalTravelTime: 0
    };

    // Calculate efficiency score
    const expectedTimePerVisit = 30; // minutes
    const actualAvgTime = statsData.avgTimeSpent || 0;
    const timeEfficiency = actualAvgTime > 0 
      ? Math.min(100, Math.round((expectedTimePerVisit / actualAvgTime) * 100))
      : 0;

    // Calculate on-time rate (visits completed within expected time)
    const onTimeVisits = recentVisits.filter(v => 
      v.status === 'Completed' && 
      v.timeSpentMinutes && 
      v.timeSpentMinutes <= expectedTimePerVisit * 1.5 // 50% buffer
    ).length;

    const onTimeRate = recentVisits.filter(v => v.status === 'Completed').length > 0
      ? Math.round((onTimeVisits / recentVisits.filter(v => v.status === 'Completed').length) * 100)
      : 0;

    // Format day names
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    // Process visits for response
    const processedVisits = recentVisits.map(v => ({
      id: v._id,
      locationName: v.locationName,
      address: v.address,
      status: v.status,
      checkInTime: v.checkInTime,
      checkOutTime: v.checkOutTime,
      distance: v.distanceFromPreviousKm || 0,
      duration: v.timeSpentMinutes ? 
        `${Math.floor(v.timeSpentMinutes / 60)}h ${v.timeSpentMinutes % 60}m` : 'N/A',
      durationMinutes: v.timeSpentMinutes,
      previousLocation: v.previousVisit?.locationName,
      previousDistance: v.distanceFromPreviousKm,
      travelTime: v.travelTimeMinutes ? `${v.travelTimeMinutes} min` : 'N/A',
      coordinates: v.coordinates,
      photos: v.photos?.map(p => p.url || p) || [],
      verified: v.verified,
      verificationTime: v.verificationTime,
      remarks: v.remarks,
      isLeadCreate: v.isLeadCreate,
      leadCreated: v.leadCreated
    }));

    // Get today's completed visits
    const todayCompletedVisits = todayVisits.filter(v => v.status === 'Completed').length;
    const todayTotalVisits = todayVisits.length;

    // Calculate attendance rate for last 30 days
    const totalWorkingDays = 30; // Assuming 30 days period
    const presentDays = attendanceHistory.filter(a => a.punchIn).length;
    const attendanceRate = Math.round((presentDays / totalWorkingDays) * 100);

    // Get punch in/out times for today
    const punchInTime = todayAttendance?.punchIn?.time;
    const punchOutTime = todayAttendance?.punchOut?.time;

    // Calculate hours worked today
    let hoursWorkedToday = 0;
    if (punchInTime && !punchOutTime) {
      hoursWorkedToday = Math.round((new Date() - new Date(punchInTime)) / (1000 * 60 * 60) * 10) / 10;
    } else if (punchInTime && punchOutTime) {
      hoursWorkedToday = Math.round((new Date(punchOutTime) - new Date(punchInTime)) / (1000 * 60 * 60) * 10) / 10;
    }

    // Build the response
    const response = {
      success: true,
      result: {
        // Basic member info
        id: member._id,
        name: `${member.firstName} ${member.lastName}`,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        phoneNumber: member.phoneNumber,
        employeeId: member.employeeId || 'N/A',
        role: member.role,
        status: member.status,
        
        // Contact & Address
        address: member.address,
        city: member.city,
        state: member.state,
        pincode: member.pincode,

        // Current status
        currentStatus: {
          dutyStatus: calculateDutyStatus(todayAttendance, member),
          isOnline: false, // This will be set by frontend via socket
          lastSeen: member.lastLoginDate,
          attendance: todayAttendance ? {
            id: todayAttendance._id,
            punchIn: punchInTime,
            punchOut: punchOutTime,
            hoursWorked: hoursWorkedToday,
            date: todayAttendance.date,
            status: todayAttendance.status || 'PRESENT'
          } : null,
          todayVisits: {
            total: todayTotalVisits,
            completed: todayCompletedVisits,
            pending: todayTotalVisits - todayCompletedVisits
          }
        },

        // Last known location
        lastKnownLocation: lastKnownLocation ? {
          address: lastKnownLocation.address || 'Location not available',
          coordinates: lastKnownLocation.coordinates,
          locationName: lastKnownLocation.locationName,
          time: formatRelativeTime(lastKnownLocation.createdAt),
          timestamp: lastKnownLocation.createdAt
        } : {
          address: 'No location data available',
          time: 'N/A'
        },

        // Performance metrics
        performance: {
          efficiency: timeEfficiency,
          onTimeRate: onTimeRate,
          avgTimePerVisit: Math.round(statsData.avgTimeSpent || 0),
          totalTimeSpent: Math.round((statsData.totalTimeSpent || 0) / 60), // in hours
          totalTravelTime: Math.round((statsData.totalTravelTime || 0) / 60), // in hours
          attendanceRate: attendanceRate,
          presentDays: presentDays,
          totalWorkingDays: totalWorkingDays
        },

        // Visit statistics
        visits: {
          total: statsData.totalVisits,
          completed: statsData.completedVisits,
          inProgress: statsData.inProgressVisits,
          cancelled: statsData.cancelledVisits,
          pending: statsData.totalVisits - statsData.completedVisits - statsData.cancelledVisits,
          completionRate: statsData.totalVisits > 0 
            ? Math.round((statsData.completedVisits / statsData.totalVisits) * 100)
            : 0
        },

        // Distance statistics
        distance: {
          total: Number(statsData.totalDistance.toFixed(1)),
          average: Number(statsData.avgDistance.toFixed(1)),
          today: Number(todayVisits.reduce((sum, v) => sum + (v.distanceFromPreviousKm || 0), 0).toFixed(1))
        },

        // Recent visits
        recentVisits: processedVisits,

        // Daily breakdown for charts
        dailyBreakdown: dailyBreakdown.map(day => ({
          date: day._id.date,
          day: dayNames[day._id.dayOfWeek - 1],
          distance: Number(day.distance.toFixed(1)),
          visits: day.visits,
          completedVisits: day.completedVisits,
          timeSpent: day.timeSpent ? Math.round(day.timeSpent / 60) : 0, // in hours
          travelTime: day.travelTime ? Math.round(day.travelTime / 60) : 0 // in hours
        })),

        // Supervisor information
        supervisor: supervisorInfo ? {
          id: supervisorInfo._id,
          name: `${supervisorInfo.firstName} ${supervisorInfo.lastName}`,
          email: supervisorInfo.email,
          role: supervisorInfo.role,
          phoneNumber: supervisorInfo.phoneNumber
        } : null,

        // Created by information
        createdBy: member.createdBy ? {
          id: member.createdBy._id,
          name: `${member.createdBy.firstName} ${member.createdBy.lastName}`,
          email: member.createdBy.email,
          role: member.createdBy.role
        } : null,

        // Metadata
        lastLogin: member.lastLoginDate,
        lastLoginFormatted: member.lastLoginDate ? 
          formatRelativeTime(member.lastLoginDate) : 'Never',
        reportGeneratedAt: new Date().toISOString(),
        dateRange: {
          start: thirtyDaysAgo,
          end: new Date()
        }
      }
    };

    return response;

  } catch (error) {
    console.error("Get team member performance error:", error);
    throw new AppError(
      error.message || "Failed to fetch team member performance", 
      error.status || 500
    );
  }
};