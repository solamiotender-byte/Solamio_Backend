import {
    punchInService,
    punchOutService,
    markHolidayService,
    getAllAttendanceService,
    getAttendanceByIdService,
    updateAttendanceService,
    deleteAttendanceService,
    getAttendanceSettingService,
    updateAttendanceSettingService,
} from "../services/attendance.service.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../errors/customError.js";

/**
 * @desc    Punch In
 * @route   POST /api/attendance/punch-in
 * @access  Private
 */
export const punchIn = async (req, res, next) => {
    try {
        const data = await punchInService(
            req.body,
            req.user,
            req.files
        );
        sendResponse(res, 200, "Punch in successful", data);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Punch Out
 * @route   POST /api/attendance/punch-out
 * @access  Private
 */
export const punchOut = async (req, res, next) => {
    try {
        const data = await punchOutService(
            req.body,
            req.user,
            req.files
        );
        sendResponse(res, 200, "Punch out successful", data);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Mark a date as holiday for all scoped users
 * @route   POST /api/attendance/holiday
 * @access  Private (Head Office only)
 */
export const markHoliday = async (req, res, next) => {
    try {
        const data = await markHolidayService(req.body, req.user);
        sendResponse(res, 200, "Holiday created successfully", data);
    } catch (error) {
        next(error);
    }
};

export const getAttendanceSetting = async (req, res, next) => {
    try {
        const data = await getAttendanceSettingService();
        sendResponse(res, 200, "Attendance settings fetched successfully", data);
    } catch (error) {
        next(error);
    }
};

export const updateAttendanceSetting = async (req, res, next) => {
    try {
        const data = await updateAttendanceSettingService(req.body, req.user);
        sendResponse(res, 200, "Attendance settings updated successfully", data);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get all attendance records
 * @route   GET /api/attendance
 * @access  Private
 */
export const getAllAttendance = async (req, res, next) => {
    try {
        const data = await getAllAttendanceService(req.query, req.user);
        sendResponse(res, 200, "Attendance records fetched successfully", data);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get attendance by ID
 * @route   GET /api/attendance/:id
 * @access  Private
 */
export const getAttendanceById = async (req, res, next) => {
    try {
        const data = await getAttendanceByIdService(req.params.id);
        sendResponse(res, 200, "Attendance record fetched successfully", data);
    } catch (error) {
        next(error);
    }
};


/**
 * @desc    Update attendance record
 * @route   PUT /api/attendance/:id
 * @access  Private (Admin/Manager only)
 */
export const updateAttendance = async (req, res, next) => {
    try {
        const data = await updateAttendanceService(
            req.params.id,
            req.body,
            req.user
        );
        sendResponse(res, 200, "Attendance record updated successfully", data);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Delete attendance record
 * @route   DELETE /api/attendance/:id
 * @access  Private (Admin only)
 */
export const deleteAttendance = async (req, res, next) => {
    try {
        const data = await deleteAttendanceService(req.params.id, req.user);
        sendResponse(res, 200, data.message, data);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get attendance statistics
 * @route   GET /api/attendance/stats
 * @access  Private
 */
export const getAttendanceStats = async (req, res, next) => {
    try {
        const data = await getAttendanceStatsService(req.query, req.user);
        sendResponse(res, 200, "Attendance statistics fetched successfully", data);
    } catch (error) {
        next(error);
    }
};
