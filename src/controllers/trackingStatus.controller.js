import Attendance from "../models/attendance.model.js";
import TrackingStatus from "../models/trackingStatus.model.js";
import User from "../models/user.model.js";
import { createNotification } from "../services/notification.service.js";

const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;

const distinctIds = (values = []) =>
  [...new Set(values.filter(Boolean).map((value) => String(value)))];

const getTodayRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start, end };
};

const getAlertRecipients = async (userId) => {
  const user = await User.findById(userId)
    .select("_id firstName lastName supervisor createdBy headOffice")
    .lean();
  if (!user) return { user: null, recipients: [] };

  const recipientIds = distinctIds([
    user.supervisor,
    user.createdBy,
    user.headOffice,
  ]);

  if (!recipientIds.length) {
    const headOfficeUsers = await User.find({
      role: "Head_office",
      ...(user.headOffice ? { headOffice: user.headOffice } : {}),
      status: "active",
    })
      .select("_id")
      .lean();
    return {
      user,
      recipients: distinctIds(headOfficeUsers.map((entry) => entry._id)),
    };
  }

  return { user, recipients: recipientIds };
};

const createAlertNotifications = async ({
  userId,
  title,
  message,
  type,
}) => {
  const { user, recipients } = await getAlertRecipients(userId);
  if (!user || !recipients.length) return;

  await Promise.all(
    recipients.map((recipientId) =>
      createNotification({
        user: recipientId,
        title,
        message,
        type,
        referenceType: "User",
        referenceId: user._id,
      }),
    ),
  );
};

export const logTrackingHeartbeat = async (req, res) => {
  try {
    const { lat, lng, accuracy } = req.body || {};
    const hasCoords = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
    const now = new Date();

    const update = {
      userId: req.user._id,
      lastHeartbeatAt: now,
      locationEnabled: true,
      locationOffAt: null,
      lastLocationOffReason: "",
    };

    if (hasCoords) {
      update.lastLocationAt = now;
      update.lastKnownLocation = {
        lat: Number(lat),
        lng: Number(lng),
        accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
      };
    }

    const status = await TrackingStatus.findOneAndUpdate(
      { userId: req.user._id },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    res.status(200).json({ success: true, data: status });
  } catch (error) {
    console.error("Tracking heartbeat error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const reportLocationOff = async (req, res) => {
  try {
    const now = new Date();
    const reason = String(req.body?.reason || "Location services disabled").trim();
    const previous = await TrackingStatus.findOne({ userId: req.user._id }).lean();
    const shouldAlert =
      !previous?.lastLocationOffAlertAt ||
      now.getTime() - new Date(previous.lastLocationOffAlertAt).getTime() > ALERT_COOLDOWN_MS;

    const status = await TrackingStatus.findOneAndUpdate(
      { userId: req.user._id },
      {
        $set: {
          userId: req.user._id,
          lastHeartbeatAt: now,
          locationEnabled: false,
          locationOffAt: now,
          lastLocationOffReason: reason,
          ...(shouldAlert ? { lastLocationOffAlertAt: now } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    if (shouldAlert) {
      const userName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim() || "Team member";
      await createAlertNotifications({
        userId: req.user._id,
        title: "Location Turned Off",
        message: `${userName} turned off location tracking on the mobile app.`,
        type: "tracking-location-off",
      });
    }

    res.status(200).json({ success: true, data: status });
  } catch (error) {
    console.error("Tracking location-off error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getTrackingStatuses = async (req, res) => {
  try {
    const requestedIds = distinctIds(
      String(req.query.userIds || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    );

    const queryUserIds = requestedIds.length ? requestedIds : [String(req.user._id)];
    const statuses = await TrackingStatus.find({ userId: { $in: queryUserIds } }).lean();
    const statusMap = Object.fromEntries(
      statuses.map((entry) => [String(entry.userId), entry]),
    );

    const { start, end } = getTodayRange();
    const onDutyAttendances = await Attendance.find({
      user: { $in: queryUserIds },
      date: { $gte: start, $lte: end },
      "punchIn.time": { $exists: true },
      "punchOut.time": { $exists: false },
    })
      .select("user")
      .lean();

    const onDutyUserIds = new Set(onDutyAttendances.map((entry) => String(entry.user)));
    const nowMs = Date.now();

    for (const userId of queryUserIds) {
      const current = statusMap[userId];
      if (!current || !onDutyUserIds.has(userId) || !current.lastHeartbeatAt) continue;

      const heartbeatAgeMs = nowMs - new Date(current.lastHeartbeatAt).getTime();
      const noSignal =
        current.locationEnabled !== false &&
        heartbeatAgeMs > HEARTBEAT_STALE_MS;

      if (!noSignal) continue;

      const shouldAlert =
        !current.lastNoSignalAlertAt ||
        nowMs - new Date(current.lastNoSignalAlertAt).getTime() > ALERT_COOLDOWN_MS;

      if (shouldAlert) {
        await TrackingStatus.updateOne(
          { userId },
          { $set: { lastNoSignalAlertAt: new Date(nowMs) } },
        );

        const user = await User.findById(userId).select("firstName lastName").lean();
        const userName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || "Team member";
        await createAlertNotifications({
          userId,
          title: "No Tracking Signal",
          message: `${userName} has not sent any tracking signal for more than 5 minutes.`,
          type: "tracking-no-signal",
        });
      }
    }

    const refreshedStatuses = await TrackingStatus.find({ userId: { $in: queryUserIds } }).lean();
    const data = refreshedStatuses.map((entry) => {
      const lastHeartbeatAt = entry.lastHeartbeatAt ? new Date(entry.lastHeartbeatAt) : null;
      const heartbeatAgeMs = lastHeartbeatAt ? nowMs - lastHeartbeatAt.getTime() : null;
      const derivedState = entry.locationEnabled === false
        ? "location_off"
        : heartbeatAgeMs != null && heartbeatAgeMs > HEARTBEAT_STALE_MS
        ? "no_signal"
        : "ok";

      return {
        ...entry,
        heartbeatAgeMs,
        derivedState,
      };
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Get tracking statuses error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};
