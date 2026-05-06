import Attendance from "../models/attendance.model.js";
import Leave from "../models/leave.model.js";
import User from "../models/user.model.js";
import { AppError } from "../errors/customError.js";
import admin, { isFirebaseReady } from "../config/firebase.config.js";
import { getHeadOfficeScopedUserIds } from "../utils/headOfficeScope.js";

const managerRoles = ["Head_office", "ZSM", "ASM"];

const startOfDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getInclusiveDays = (startDate, endDate) =>
  Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;

const formatDate = (date) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);

const getScopedLeaveFilter = async (currentUser, query = {}) => {
  const filter = {};

  if (managerRoles.includes(currentUser.role)) {
    const scopedUserIds = await getHeadOfficeScopedUserIds(currentUser);
    filter.user = { $in: scopedUserIds };
    if (query.user) {
      const userInScope = scopedUserIds.some((userId) => String(userId) === String(query.user));
      filter.user = userInScope ? query.user : { $in: [] };
    }
  } else {
    filter.user = currentUser._id;
  }

  if (query.status && ["pending", "approved", "rejected"].includes(query.status)) {
    filter.status = query.status;
  }

  return filter;
};

const sendLeaveStatusNotification = async (leave, status) => {
  if (!isFirebaseReady()) return;

  const user = await User.findById(leave.user).select("fcmTokens firstName lastName").lean();
  const tokens = (user?.fcmTokens || [])
    .map((item) => item?.token)
    .filter(Boolean);

  if (!tokens.length) return;

  const title = status === "approved" ? "Leave approved" : "Leave rejected";
  const body = `${formatDate(leave.startDate)} to ${formatDate(leave.endDate)}: ${status}`;

  await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: {
      type: "leave",
      leaveId: String(leave._id),
      status,
      message: body,
    },
  });
};

const applyLeaveToAttendance = async (leave, reviewerId) => {
  for (let day = new Date(leave.startDate); day <= leave.endDate; day = addDays(day, 1)) {
    await Attendance.findOneAndUpdate(
      {
        user: leave.user,
        date: day,
      },
      {
        $set: {
          status: "leave",
          remarks: leave.reason,
          metadata: {
            leaveRequest: leave._id,
            leaveReason: leave.reason,
            approvedBy: reviewerId,
          },
        },
        $unset: {
          punchIn: "",
          punchOut: "",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
};

export const createLeaveRequestService = async (data, currentUser) => {
  const startDate = startOfDay(data.startDate);
  const endDate = startOfDay(data.endDate);
  const reason = String(data.reason || "").trim();

  if (!startDate || !endDate) {
    throw new AppError("Start date and end date are required", 400);
  }
  if (endDate < startDate) {
    throw new AppError("End date cannot be before start date", 400);
  }
  if (!reason) {
    throw new AppError("Leave reason is required", 400);
  }

  const leave = await Leave.create({
    user: currentUser._id,
    startDate,
    endDate,
    totalDays: getInclusiveDays(startDate, endDate),
    reason,
  });

  return Leave.findById(leave._id)
    .populate("user", "firstName lastName email phoneNumber role")
    .populate("reviewedBy", "firstName lastName email role")
    .lean();
};

export const getLeavesService = async (query, currentUser) => {
  const filter = await getScopedLeaveFilter(currentUser, query);
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  const skip = (page - 1) * limit;

  const [leaves, total] = await Promise.all([
    Leave.find(filter)
      .populate("user", "firstName lastName email phoneNumber role")
      .populate("reviewedBy", "firstName lastName email role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Leave.countDocuments(filter),
  ]);

  return { leaves, total, page, limit };
};

export const updateLeaveStatusService = async (id, data, currentUser) => {
  if (!managerRoles.includes(currentUser.role)) {
    throw new AppError("Only managers can approve or reject leave", 403);
  }

  const status = String(data.status || "").toLowerCase();
  if (!["approved", "rejected"].includes(status)) {
    throw new AppError("Status must be approved or rejected", 400);
  }

  const leave = await Leave.findById(id);
  if (!leave) throw new AppError("Leave request not found", 404);
  if (leave.status !== "pending") {
    throw new AppError("This leave request is already reviewed", 400);
  }

  const scopedUserIds = await getHeadOfficeScopedUserIds(currentUser);
  const canReview = scopedUserIds.some((userId) => String(userId) === String(leave.user));
  if (!canReview) {
    throw new AppError("You can only review leave from your own team", 403);
  }

  leave.status = status;
  leave.reviewedBy = currentUser._id;
  leave.reviewedAt = new Date();
  leave.reviewNote = String(data.reviewNote || "").trim();
  await leave.save();

  if (status === "approved") {
    await applyLeaveToAttendance(leave, currentUser._id);
  }

  await sendLeaveStatusNotification(leave, status).catch((error) => {
    console.warn("Leave notification failed:", error.message);
  });

  return Leave.findById(leave._id)
    .populate("user", "firstName lastName email phoneNumber role")
    .populate("reviewedBy", "firstName lastName email role")
    .lean();
};
