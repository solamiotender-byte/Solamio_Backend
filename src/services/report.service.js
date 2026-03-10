import Lead from "../models/lead.model.js";
import User from "../models/user.model.js";
import Expense from "../models/expense.model.js";
import Attendance from '../models/attendance.model.js'
import { AppError } from "../errors/customError.js";

/* ===============================
   ROLE BASED FILTER (COMMON)
================================ */
const getReportFilter = async (currentUser, baseFilter = {}) => {
  // Head Office & ZSM → ALL
  if (["Head_office", "ZSM"].includes(currentUser.role)) {
    return baseFilter;
  }

  // ASM → own + team
  if (currentUser.role === "ASM") {
    const team = await User.find({ supervisor: currentUser._id }, "_id").lean();

    const teamIds = team.map((u) => u._id);

    return {
      ...baseFilter,
      $or: [
        { assignedManager: currentUser._id },
        { assignedUser: { $in: teamIds } },
        { createdBy: currentUser._id },
      ],
    };
  }

  // TEAM → only own
  if (currentUser.role === "TEAM") {
    return {
      ...baseFilter,
      $or: [{ assignedUser: currentUser._id }, { createdBy: currentUser._id }],
    };
  }

  throw new AppError("Unauthorized role", 403);
};

/* ===============================
   ALL LEADS REPORT
================================ */
export const getAllLeadsReportService = async (query, user) => {
  const { fromDate, toDate } = query;

  const currentUser = await User.findById(user._id);
  if (!currentUser) throw new AppError("User not found", 404);

  let baseFilter = { isDeleted: false };

  if (fromDate || toDate) {
    baseFilter.createdAt = {};
    if (fromDate) baseFilter.createdAt.$gte = new Date(fromDate);
    if (toDate) baseFilter.createdAt.$lte = new Date(toDate);
  }

  const filter = await getReportFilter(currentUser, baseFilter);

  const leads = await Lead.find(filter)
    .populate("assignedUser", "firstName lastName role")
    .populate("assignedManager", "firstName lastName role")
    .populate("createdBy", "firstName lastName role")
    .lean();

    console.log("leads...", leads)

  return {
    totalLeads: leads.length,
    leads,
  };
};

/* ===============================
   INSTALLATION REPORT
================================ */
export const getInstallationReportService = async (query, user) => {
  const currentUser = await User.findById(user._id);
  if (!currentUser) throw new AppError("User not found", 404);

  const filter = await getReportFilter(currentUser, {
    status: "Installation Completion",
    isDeleted: false,
  });

  const installations = await Lead.find(filter).lean();

  return {
    totalInstallations: installations.length,
    completed: installations.filter((i) => i.installationStatus === "completed")
      .length,
    pending: installations.filter((i) => i.installationStatus === "pending")
      .length,
    installations,
  };
};

/* ===============================
   EXPENSE REPORT
================================ */
export const getExpenseReportService = async (query, user) => {
  const { fromDate, toDate, status } = query;

  const currentUser = await User.findById(user._id);
  if (!currentUser) throw new AppError("User not found", 404);

  let filter = {};

  // TEAM → own
  if (currentUser.role === "TEAM") {
    filter.createdBy = currentUser._id;
  }

  // ASM → own + team
  if (currentUser.role === "ASM") {
    const team = await User.find({ supervisor: currentUser._id }, "_id").lean();

    filter.createdBy = {
      $in: [currentUser._id, ...team.map((u) => u._id)],
    };
  }

  // Head_office & ZSM → all

  if (status) filter.status = status;

  if (fromDate || toDate) {
    filter.expenseDate = {};
    if (fromDate) filter.expenseDate.$gte = new Date(fromDate);
    if (toDate) filter.expenseDate.$lte = new Date(toDate);
  }

  const expenses = await Expense.find(filter)
    .populate("createdBy", "firstName lastName role")
    .populate("approvedBy", "firstName lastName role")
    .lean();

  const totalAmount = expenses.reduce((s, e) => s + e.amount, 0);

  return {
    totalExpenses: expenses.length,
    totalAmount,
    expenses,
  };
};

/* ===============================
   ATTENDANCE REPORT
================================ */
export const getAttendanceReportService = async (query, user) => {
  const { fromDate, toDate } = query;

  const currentUser = await User.findById(user._id);
  if (!currentUser) throw new AppError("User not found", 404);

  let filter = {};

  /* ===============================
     ROLE BASED FILTER
  ================================ */

  // TEAM → only own
  if (currentUser.role === "TEAM") {
    filter.user = currentUser._id;
  }

  // ASM → own + team
  if (currentUser.role === "ASM") {
    const team = await User.find(
      { supervisor: currentUser._id },
      "_id"
    ).lean();

    filter.user = {
      $in: [currentUser._id, ...team.map((u) => u._id)],
    };
  }

  // Head_office & ZSM → ALL

  /* ===============================
     DATE FILTER
  ================================ */

  if (fromDate || toDate) {
    filter.date = {};
    if (fromDate) filter.date.$gte = new Date(fromDate);
    if (toDate) filter.date.$lte = new Date(toDate);
  }

  /* ===============================
     FETCH ATTENDANCE
  ================================ */

  const attendance = await Attendance.find(filter)
    .populate("user", "firstName lastName role")
    .lean();

  /* ===============================
     SUMMARY
  ================================ */

  const totalRecords = attendance.length;

  const presentCount = attendance.filter(
    (a) => a.status === "present"
  ).length;

  const totalWorkHours = attendance.reduce(
    (sum, a) => sum + (a.workHours || 0),
    0
  );

  const totalOvertime = attendance.reduce(
    (sum, a) => sum + (a.overtime || 0),
    0
  );

  return {
    totalRecords,
    presentCount,
    totalWorkHours,
    totalOvertime,
    attendance,
  };
};