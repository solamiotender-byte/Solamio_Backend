import DailySummary from "../models/dailySummary.js";
import Attendance from "../models/attendance.js";
import { AppError } from "../errors/customError.js";

const handleError = (error, msg) => {
  if (error instanceof AppError) throw error;
  throw new AppError(error.message || msg, 500);
};

// Create/Update Daily Summary
export const createDailySummaryService = async (data, currentUser) => {
  try {
    const summary = await DailySummary.findOneAndUpdate(
      { salesmanId: data.salesmanId || currentUser._id, date: data.date },
      { ...data },
      { upsert: true, new: true, runValidators: true }
    ).populate("salesmanId", "firstName lastName email role");

    return summary;
  } catch (e) {
    handleError(e, "Failed to create/update daily summary");
  }
};

// Get Daily Summary
export const getDailySummaryService = async (filters = {}) => {
  try {
    const query = {};
    
    if (filters.salesmanId) {
      query.salesmanId = filters.salesmanId;
    }
    
    if (filters.date) {
      query.date = filters.date;
    }
    
    if (filters.startDate && filters.endDate) {
      query.date = { $gte: filters.startDate, $lte: filters.endDate };
    }

    const summaries = await DailySummary.find(query)
      .populate("salesmanId", "firstName lastName email role")
      .sort({ date: -1 });

    return summaries;
  } catch (e) {
    handleError(e, "Failed to fetch daily summaries");
  }
};

// Get Daily Summary by ID
export const getDailySummaryByIdService = async (id) => {
  try {
    const summary = await DailySummary.findById(id)
      .populate("salesmanId", "firstName lastName email role");
    
    if (!summary) {
      throw new AppError("Daily summary not found", 404);
    }

    return summary;
  } catch (e) {
    handleError(e, "Failed to fetch daily summary");
  }
};

// Get Team Daily Summary (for supervisors)
export const getTeamDailySummaryService = async (supervisorId, date) => {
  try {
    // Find all team members under this supervisor
    const teamMembers = await User.find({ supervisor: supervisorId }).select("_id");
    const teamMemberIds = teamMembers.map(member => member._id);

    const query = {
      salesmanId: { $in: teamMemberIds }
    };

    if (date) {
      query.date = date;
    }

    const summaries = await DailySummary.find(query)
      .populate("salesmanId", "firstName lastName email role")
      .sort({ date: -1 });

    return summaries;
  } catch (e) {
    handleError(e, "Failed to fetch team daily summaries");
  }
};

// Update Attendance Status in Summary
export const updateAttendanceSummaryService = async (salesmanId, date, attendanceStatus) => {
  try {
    const summary = await DailySummary.findOneAndUpdate(
      { salesmanId, date },
      { attendanceStatus },
      { upsert: true, new: true }
    );

    return summary;
  } catch (e) {
    handleError(e, "Failed to update attendance in summary");
  }
};

// Get Summary Statistics
export const getSummaryStatsService = async (salesmanId, startDate, endDate) => {
  try {
    const query = { salesmanId };
    
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    }

    const stats = await DailySummary.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalDays: { $sum: 1 },
          totalKm: { $sum: "$totalKm" },
          totalVisits: { $sum: "$totalVisits" },
          presentDays: {
            $sum: { $cond: [{ $eq: ["$attendanceStatus", "present"] }, 1, 0] }
          },
          absentDays: {
            $sum: { $cond: [{ $eq: ["$attendanceStatus", "absent"] }, 1, 0] }
          },
          halfDays: {
            $sum: { $cond: [{ $eq: ["$attendanceStatus", "half-day"] }, 1, 0] }
          }
        }
      }
    ]);

    return stats[0] || {
      totalDays: 0,
      totalKm: 0,
      totalVisits: 0,
      presentDays: 0,
      absentDays: 0,
      halfDays: 0
    };
  } catch (e) {
    handleError(e, "Failed to fetch summary statistics");
  }
};