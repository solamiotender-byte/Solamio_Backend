import Notification from "../models/notification.model.js";

export const createNotification = async ({
  user,
  title,
  message = "",
  type = "general",
  referenceType = "",
  referenceId = null,
}) => {
  if (!user || !title) return null;

  return Notification.create({
    user,
    title,
    message,
    type,
    referenceType,
    referenceId,
  });
};

export const getUserNotifications = async (userId, { limit = 100 } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  return Notification.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();
};

export const markNotificationRead = async (userId, notificationId) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { $set: { read: true } },
    { new: true },
  ).lean();
};

export const markAllNotificationsRead = async (userId) => {
  await Notification.updateMany(
    { user: userId, read: false },
    { $set: { read: true } },
  );
};
