// controllers/visit.controller.js
import {
  createVisitService,
  getAllVisitsService,
  getVisitByIdService,
  updateVisitService,
  completeVisitService,
  getRecentActivityService,
  getVisitStatsService,
  getTeamPerformanceService,
  getMyPerformanceService,
  getTeamMemberPerformanceService,
  getTeamBySupervisorService,
} from "../services/visit.service.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../errors/customError.js";

/* =========================================================
   CREATE VISIT
========================================================= */
export const createVisitController = async (req, res, next) => {
  try {

    const data = await createVisitService(req.body, req.user, req.files);
    sendResponse(res, 201, "Visit created successfully", data);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   GET ALL VISITS (with pagination and filters)
========================================================= */
export const getAllVisitsController = async (req, res, next) => {
  try {
    const { page, limit, startDate, endDate, status, userId, search } = req.query;
    
    // Validate pagination params
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    
    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      throw new AppError("Invalid pagination parameters", 400);
    }

    const data = await getAllVisitsService({
      page: pageNum,
      limit: limitNum,
      startDate,
      endDate,
      status,
      userId,
      search
    }, req.user);

    sendResponse(res, 200, "Visits fetched successfully", data);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   GET VISIT BY ID
========================================================= */
export const getVisitByIdController = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      throw new AppError("Visit ID is required", 400);
    }

    const data = await getVisitByIdService(id, req.user);
    sendResponse(res, 200, "Visit fetched successfully", data);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   UPDATE VISIT
========================================================= */
export const updateVisitController = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = await updateVisitService(id, req.body, req.user);
    sendResponse(res, 200, "Visit updated successfully", data);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   COMPLETE VISIT
========================================================= */
export const completeVisitController = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      throw new AppError("Visit ID is required", 400);
    }

    const data = await completeVisitService(id, req.user);
    sendResponse(res, 200, "Visit completed successfully", data);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   RECENT ACTIVITY
========================================================= */
export const getRecentActivityController = async (req, res, next) => {
  try {
    const { limit } = req.query;
    const data = await getRecentActivityService(req.user, parseInt(limit) || 5);
    sendResponse(res, 200, "Recent activity fetched", data);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   VISIT STATS
========================================================= */
export const getVisitStatsController = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await getVisitStatsService(req.user, { startDate, endDate });
    sendResponse(res, 200, "Visit stats fetched", data);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   TEAM PERFORMANCE
========================================================= */
export const getTeamPerformanceController = async (req, res, next) => {
  try {
    const { 
      page, 
      limit, 
      search, 
      sortBy, 
      sortOrder, 
      status,
      teamId,
      asmId 
    } = req.query;

    const data = await getTeamPerformanceService({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      search,
      sortBy: sortBy || 'distance',
      sortOrder: sortOrder || 'desc',
      status: status || 'active',
      teamId,
      asmId
    }, req.user);

    sendResponse(res, 200, "Team performance fetched successfully", data);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   MY PERFORMANCE (for TEAM role)
========================================================= */
export const getMyPerformanceController = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    
    const data = await getMyPerformanceService(req.user._id, { 
      startDate, 
      endDate 
    });

    sendResponse(res, 200, "Your performance fetched successfully", data);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   TEAM BY SUPERVISOR
========================================================= */
export const getTeamBySupervisorController = async (req, res, next) => {
  try {
    const { supervisorId } = req.params;
    
    if (!supervisorId) {
      throw new AppError("Supervisor ID is required", 400);
    }

    const data = await getTeamBySupervisorService(supervisorId, req.user);
    sendResponse(res, 200, "Team members fetched successfully", data);
  } catch (error) {
    next(error);
  }
};

/* =========================================================
   EXPORT VISITS
========================================================= */
export const exportVisitsController = async (req, res, next) => {
  try {
    const { startDate, endDate, status, userId } = req.query;

    // Get all visits (unpaginated for export)
    const data = await getAllVisitsService({
      page: 1,
      limit: 10000, // Large limit for export
      startDate,
      endDate,
      status,
      userId
    }, req.user);

    // Format for CSV/Excel export
    const exportData = data.visits.map(visit => ({
      'Visit ID': visit._id,
      'Date': new Date(visit.createdAt).toLocaleString(),
      'Location Name': visit.locationName,
      'Address': visit.address,
      'Latitude': visit.coordinates?.lat,
      'Longitude': visit.coordinates?.lng,
      'Status': visit.status,
      'Distance (km)': visit.distanceFromPreviousKm,
      'Duration (min)': visit.timeSpentMinutes,
      'Contact Person': visit.contactPerson || '',
      'Phone': visit.phone || '',
      'Email': visit.email || '',
      'Remarks': visit.remarks || '',
      'Photos Count': visit.photos?.length || 0,
      'Verified': visit.verified ? 'Yes' : 'No',
      'User': visit.user?.name || '',
      'User Email': visit.user?.email || ''
    }));

    sendResponse(res, 200, "Export data fetched successfully", {
      visits: exportData,
      total: data.pagination.totalItems
    });
  } catch (error) {
    next(error);
  }
};

// controllers/visit.controller.js (add this method)

/* =========================================================
   GET TEAM MEMBER PERFORMANCE
========================================================= */
export const getTeamMemberPerformance = async (req, res, next) => {
  try {
    const { memberId } = req.params;
    const currentUser = req.user;

    const result = await getTeamMemberPerformanceService(memberId, currentUser);
    sendResponse(res, 200, "Team member performance fetched successfully", result);
  } catch (error) {
    next(error);
  }
};