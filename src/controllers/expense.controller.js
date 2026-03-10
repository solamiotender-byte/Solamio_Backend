import {
  createExpenseService,
  getExpensesService,
  updateExpenseService,
  deleteExpenseService,
  approveExpenseService,
  rejectExpenseService,
  getExpenseByIdService,
  getExpenseStatsService,
  getUserExpenseSummaryService,
} from "../services/expense.service.js";
import { sendResponse } from "../utils/response.js";
import { AppError } from "../errors/customError.js";

export const createExpenseController = async (req, res, next) => {
  try {
    // Validate fuel expense fields
    if (req.body.category === "Fuel") {
      if (!req.body.vehicleType || req.body.vehicleType === "None") {
        throw new AppError("Vehicle type is required for fuel expenses", 400);
      }
      if (!req.body.fuelType || req.body.fuelType === "None") {
        throw new AppError("Fuel type is required for fuel expenses", 400);
      }
      if (!req.body.kilometersTraveled || req.body.kilometersTraveled <= 0) {
        throw new AppError("Kilometers traveled must be greater than 0 for fuel expenses", 400);
      }
    }
    
    const data = await createExpenseService(req.body, req.user, req.file);
    sendResponse(res, 201, "Expense created successfully", data);
  } catch (e) {
    next(e);
  }
};

export const getExpensesController = async (req, res, next) => {
  try {
    const data = await getExpensesService(req.query, req.user);
    sendResponse(res, 200, "Expenses fetched successfully", data);
  } catch (e) {
    next(e);
  }
};

export const getExpenseController = async (req, res, next) => {
  try {
    const data = await getExpenseByIdService(req.params.id);
    sendResponse(res, 200, "Expense fetched successfully", data);
  } catch (e) {
    next(e);
  }
};

export const updateExpenseController = async (req, res, next) => {
  try {

    // Validate fuel expense fields if category is being updated to Fuel
    if (req.body.category === "Fuel") {
      if (!req.body.vehicleType || req.body.vehicleType === "None") {
        throw new AppError("Vehicle type is required for fuel expenses", 400);
      }
      if (!req.body.fuelType || req.body.fuelType === "None") {
        throw new AppError("Fuel type is required for fuel expenses", 400);
      }
      if (!req.body.kilometersTraveled || req.body.kilometersTraveled <= 0) {
        throw new AppError("Kilometers traveled must be greater than 0 for fuel expenses", 400);
      }
    }
    
    const data = await updateExpenseService(
      req.params.id,
      req.body,
      req.user.role,
      req.file
    );
    sendResponse(res, 200, "Expense updated successfully", data);
  } catch (e) {
    next(e);
  }
};

export const deleteExpenseController = async (req, res, next) => {
  try {
    const data = await deleteExpenseService(req.params.id, req.user.role);
    sendResponse(res, 200, data.message, null);
  } catch (e) {
    next(e);
  }
};

export const approveExpenseController = async (req, res, next) => {
  try {
    const { remarks } = req.body;
    const data = await approveExpenseService(req.params.id, req.user, remarks);
    sendResponse(res, 200, "Expense approved successfully", data);
  } catch (e) {
    next(e);
  }
};

export const rejectExpenseController = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const data = await rejectExpenseService(req.params.id, req.user, reason);
    sendResponse(res, 200, "Expense rejected successfully", data);
  } catch (e) {
    next(e);
  }
};

export const getExpenseStatsController = async (req, res, next) => {
  try {
    const stats = await getExpenseStatsService(req.query, req.user);
    sendResponse(res, 200, "Stats fetched successfully", stats);
  } catch (e) {
    next(e);
  }
};

export const getUserSummaryController = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { period } = req.query;
    const summary = await getUserExpenseSummaryService(userId, period);
    sendResponse(res, 200, "User summary fetched successfully", summary);
  } catch (e) {
    next(e);
  }
};