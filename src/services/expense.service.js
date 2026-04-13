import Expense from "../models/expense.model.js";
import User from "../models/user.model.js";
import mongoose from "mongoose";
import { AppError, NotFoundError } from "../errors/customError.js";
import { generateFullUrl } from "../utils/generateFullUrl.js";
import {
  assertSameHeadOffice,
  getHeadOfficeScopedUserIds,
} from "../utils/headOfficeScope.js";

/* ================= Error Handler ================= */
const handleError = (error, msg) => {
  if (error instanceof AppError) throw error;
  throw new AppError(error.message || msg, 500);
};

/* ================= Fuel Rates ================= */
export const FUEL_RATES = {
  Bike: { Petrol: 2, Electric: 0.5, default: 2 },
  Car: {
    Petrol: 4.5,
    Diesel: 3.8,
    CNG: 2.8,
    Electric: 1.2,
    default: 4
  }
};

const getFuelRate = (vehicleType, fuelType) => {
  if (!vehicleType || vehicleType === "None") return 0;
  const rates = FUEL_RATES[vehicleType];
  return rates?.[fuelType] || rates?.default || 0;
};

/* ================= File Resolver ================= */
const resolveFileUrl = (file) => {
  if (!file) return null;
  if (file.location) return file.location;
  if (file.filename) return generateFullUrl(file.filename);
  if (file.path) return generateFullUrl(file.path);
  return null;
};

/* ==================================================
   CREATE EXPENSE (Fuel Auto Calculation)
================================================== */
export const createExpenseService = async (data, currentUser, file) => {
  try {
    const { ...restData } = data;

    const expensePayload = {
      ...restData,
      createdBy: currentUser._id
    };

    /* ---------- Bill ---------- */
    const billUrl = resolveFileUrl(file);
    if (billUrl) expensePayload.billAttachment = billUrl;

    /* ================= Fuel Auto Calc ================= */
    if (expensePayload.category === "Fuel") {
      const { vehicleType, fuelType, kilometersTraveled } = expensePayload;

      if (!vehicleType || vehicleType === "None")
        throw new AppError("Vehicle type required", 400);

      if (!fuelType || fuelType === "None")
        throw new AppError("Fuel type required", 400);

      if (!kilometersTraveled || kilometersTraveled <= 0)
        throw new AppError("Kilometers must be > 0", 400);

      const rate = getFuelRate(vehicleType, fuelType);

      if (!rate)
        throw new AppError("Invalid vehicle/fuel combination", 400);
      delete expensePayload.amount;

      expensePayload.fuelRatePerKm = rate;
      expensePayload.amount = kilometersTraveled * rate;
      expensePayload.isFuelCalculated = true;
    }
    return await Expense.create(expensePayload);

  } catch (error) {
    handleError(error, "Failed to create expense");
  }
};

/* ==================================================
   LIST EXPENSES
================================================== */
export const getExpensesService = async (query, user) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status,
      category,
      startDate,
      endDate,
      userId
    } = query;

    const scopedUserIds = await getHeadOfficeScopedUserIds(user);
    const filter = { createdBy: { $in: scopedUserIds } };
    const skip = (page - 1) * limit;

    if (user.role === "TEAM") filter.createdBy = user._id;
    else if (userId) {
      const selectedUser = await User.findById(userId);
      if (!selectedUser) throw new NotFoundError("User", userId);
      await assertSameHeadOffice(user, selectedUser);
      filter.createdBy = selectedUser._id;
    }

    if (status) filter.status = status;
    if (category) filter.category = category;

    if (startDate || endDate) {
      filter.expenseDate = {};
      if (startDate) filter.expenseDate.$gte = new Date(startDate);
      if (endDate) filter.expenseDate.$lte = new Date(endDate);
    }

    if (search) filter.title = { $regex: search, $options: "i" };

    const expenses = await Expense.find(filter)
      .skip(skip)
      .limit(+limit)
      .sort({ createdAt: -1 })
      .populate("createdBy approvedBy", "name email role");

    const total = await Expense.countDocuments(filter);

    return {
      expenses,
      pagination: {
        page: +page,
        limit: +limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    handleError(error, "Failed to fetch expenses");
  }
};

/* ==================================================
   GET BY ID
================================================== */
export const getExpenseByIdService = async (id, user) => {
  try {
    const expense = await Expense.findById(id)
      .populate("createdBy approvedBy", "name email role");

    if (!expense) throw new NotFoundError("Expense", id);
    if (user) {
      const owner = await User.findById(expense.createdBy);
      if (!owner) throw new NotFoundError("User", expense.createdBy);
      await assertSameHeadOffice(user, owner);
    }
    return expense;
  } catch (error) {
    handleError(error, "Failed to fetch expense");
  }
};

/* ==================================================
   UPDATE EXPENSE (Fuel Recalculation)
================================================== */
export const updateExpenseService = async (id, data, user) => {
  try {
    const expense = await Expense.findById(id);
    if (!expense) throw new NotFoundError("Expense", id);
    const owner = await User.findById(expense.createdBy);
    if (!owner) throw new NotFoundError("User", expense.createdBy);
    await assertSameHeadOffice(user, owner);

    if (expense.status !== "Pending")
      throw new AppError("Approved/Rejected expense cannot be updated", 400);

    if (user.role === "TEAM" && expense.createdBy.toString() !== user._id.toString())
      throw new AppError("Unauthorized", 403);

    /* ---------- Fuel Recalc ---------- */
    if (expense.category === "Fuel") {
      delete data.amount;

      if (data.kilometersTraveled || data.vehicleType || data.fuelType) {
        const km = data.kilometersTraveled ?? expense.kilometersTraveled;
        const vt = data.vehicleType ?? expense.vehicleType;
        const ft = data.fuelType ?? expense.fuelType;

        const rate = getFuelRate(vt, ft);
        if (!rate) throw new AppError("Invalid fuel update", 400);

        data.fuelRatePerKm = rate;
        data.amount = km * rate;
        data.isFuelCalculated = true;
      }
    }

    Object.assign(expense, data);
    return await expense.save();

  } catch (error) {
    handleError(error, "Failed to update expense");
  }
};

/* ==================================================
   DELETE EXPENSE
================================================== */
export const deleteExpenseService = async (id, user) => {
  try {
    const exp = await Expense.findById(id);
    if (!exp) throw new NotFoundError("Expense", id);
    const owner = await User.findById(exp.createdBy);
    if (!owner) throw new NotFoundError("User", exp.createdBy);
    await assertSameHeadOffice(user, owner);

    await exp.deleteOne();

    return { message: "Expense deleted successfully" };
    
  } catch (error) {
    handleError(error, "Failed to delete expense");
  }
};

/* ==================================================
   APPROVE / REJECT
================================================== */
export const approveExpenseService = async (id, user, remarks) => {
  try {
    if (!["ASM", "ZSM", "Head_office"].includes(user.role))
      throw new AppError("Not authorized", 403);

    const expense = await Expense.findById(id);
    if (!expense) throw new NotFoundError("Expense", id);
    const owner = await User.findById(expense.createdBy);
    if (!owner) throw new NotFoundError("User", expense.createdBy);
    await assertSameHeadOffice(user, owner);

    if (expense.status !== "Pending")
      throw new AppError(`Already ${expense.status}`, 400);

    expense.status = "Approved";
    expense.approvedBy = user._id;
    expense.approvedAt = new Date();
    expense.approverRemarks = remarks;

    return await expense.save();
  } catch (error) {
    handleError(error, "Failed to approve expense");
  }
};

export const rejectExpenseService = async (id, user, reason) => {
  try {
    if (!reason) throw new AppError("Rejection reason required", 400);

    const expense = await Expense.findById(id);
    if (!expense) throw new NotFoundError("Expense", id);
    const owner = await User.findById(expense.createdBy);
    if (!owner) throw new NotFoundError("User", expense.createdBy);
    await assertSameHeadOffice(user, owner);

    expense.status = "Rejected";
    expense.approvedBy = user._id;
    expense.approvedAt = new Date();
    expense.rejectionReason = reason;

    return await expense.save();
  } catch (error) {
    handleError(error, "Failed to reject expense");
  }
};

// Get expense statistics
export const getExpenseStatsService = async (query, user) => {
  try {
    const { period, userId, category } = query;
    const scopedUserIds = await getHeadOfficeScopedUserIds(user);

    let matchStage = {
      createdBy: { $in: scopedUserIds.map((id) => new mongoose.Types.ObjectId(id)) },
    };

    // User filter
    if (userId) {
      const targetUser = await User.findById(userId);
      if (!targetUser) throw new NotFoundError("User", userId);
      await assertSameHeadOffice(user, targetUser);
      matchStage.createdBy = new mongoose.Types.ObjectId(userId);
    } else if (user.role === "TEAM") {
      matchStage.createdBy = user._id;
    }

    // Category filter
    if (category) {
      matchStage.category = category;
    }

    // Period filter
    if (period) {
      const now = new Date();
      const startOfDay = new Date(now.setHours(0, 0, 0, 0));
      
      switch (period) {
        case 'today':
          matchStage.expenseDate = { $gte: startOfDay };
          break;
        case 'week':
          const weekAgo = new Date(now.setDate(now.getDate() - 7));
          matchStage.expenseDate = { $gte: weekAgo };
          break;
        case 'month':
          const monthAgo = new Date(now.setMonth(now.getMonth() - 1));
          matchStage.expenseDate = { $gte: monthAgo };
          break;
        case 'quarter':
          const quarterAgo = new Date(now.setMonth(now.getMonth() - 3));
          matchStage.expenseDate = { $gte: quarterAgo };
          break;
        case 'year':
          const yearAgo = new Date(now.setFullYear(now.getFullYear() - 1));
          matchStage.expenseDate = { $gte: yearAgo };
          break;
      }
    }

    const stats = await Expense.aggregate([
      { $match: matchStage },
      {
        $facet: {
          byStatus: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
                averageAmount: { $avg: "$amount" }
              }
            }
          ],
          byCategory: [
            {
              $group: {
                _id: "$category",
                count: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
                averageAmount: { $avg: "$amount" }
              }
            }
          ],
          byDay: [
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$expenseDate" } },
                totalAmount: { $sum: "$amount" },
                count: { $sum: 1 }
              }
            },
            { $sort: { "_id": 1 } },
            { $limit: 30 }
          ],
          totals: [
            {
              $group: {
                _id: null,
                totalExpenses: { $sum: 1 },
                grandTotal: { $sum: "$amount" },
                averageAmount: { $avg: "$amount" },
                maxAmount: { $max: "$amount" },
                minAmount: { $min: "$amount" }
              }
            }
          ]
        }
      }
    ]);

    return {
      filters: { period, userId, category },
      stats: stats[0] || {
        byStatus: [],
        byCategory: [],
        byDay: [],
        totals: { totalExpenses: 0, grandTotal: 0, averageAmount: 0 }
      }
    };
  } catch (e) {
    handleError(e, "Failed to fetch stats");
  }
};

// Get user expense summary
export const getUserExpenseSummaryService = async (userId, period) => {
  try {
    let dateFilter = {};
    if (period && period !== 'all') {
      const now = new Date();
      const startOfDay = new Date(now.setHours(0, 0, 0, 0));
      
      switch (period) {
        case 'today':
          dateFilter = { $gte: startOfDay };
          break;
        case 'week':
          const weekAgo = new Date(now.setDate(now.getDate() - 7));
          dateFilter = { $gte: weekAgo };
          break;
        case 'month':
          const monthAgo = new Date(now.setMonth(now.getMonth() - 1));
          dateFilter = { $gte: monthAgo };
          break;
        case 'quarter':
          const quarterAgo = new Date(now.setMonth(now.getMonth() - 3));
          dateFilter = { $gte: quarterAgo };
          break;
      }
    }

    const matchStage = {
      createdBy: new mongoose.Types.ObjectId(userId)
    };
    
    if (Object.keys(dateFilter).length) {
      matchStage.expenseDate = dateFilter;
    }

    // Get user details
    const user = await User.findById(userId).select("name email role");
    if (!user) throw new NotFoundError("User", userId);

    // Use aggregation for better performance
    const [summary, recentExpenses, monthlyTrend] = await Promise.all([
      Expense.aggregate([
        { $match: matchStage },
        {
          $facet: {
            totals: [{
              $group: {
                _id: null,
                totalExpenses: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
                averageAmount: { $avg: "$amount" }
              }
            }],
            byStatus: [{
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                total: { $sum: "$amount" }
              }
            }],
            byCategory: [{
              $group: {
                _id: "$category",
                count: { $sum: 1 },
                total: { $sum: "$amount" }
              }
            }]
          }
        }
      ]),
      Expense.find(matchStage)
        .sort({ createdAt: -1 })
        .limit(5)
        .select("title amount category status expenseDate billAttachment")
        .lean(),
      Expense.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: {
              year: { $year: "$expenseDate" },
              month: { $month: "$expenseDate" }
            },
            total: { $sum: "$amount" },
            count: { $sum: 1 }
          }
        },
        { $sort: { "_id.year": -1, "_id.month": -1 } },
        { $limit: 6 }
      ])
    ]);

    const result = summary[0] || {};
    
    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      period: period || 'all',
      summary: {
        totalExpenses: result.totals?.[0]?.totalExpenses || 0,
        totalAmount: result.totals?.[0]?.totalAmount || 0,
        averageAmount: result.totals?.[0]?.averageAmount || 0,
        byStatus: result.byStatus?.reduce((acc, item) => {
          acc[item._id] = { count: item.count, total: item.total };
          return acc;
        }, {}),
        byCategory: result.byCategory?.reduce((acc, item) => {
          acc[item._id] = { count: item.count, total: item.total };
          return acc;
        }, {})
      },
      monthlyTrend,
      recentExpenses
    };
  } catch (e) {
    handleError(e, "Failed to fetch user summary");
  }
};
