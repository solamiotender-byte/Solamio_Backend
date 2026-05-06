import BatteryLog from "../models/Batterylog.js";

export const logBattery = async (req, res) => {
  try {
    const { userId, percentage, isCharging, deviceInfo } = req.body;
    const resolvedUserId = userId || req.user?._id;
    const normalizedPercentage = Number(percentage);

    if (!resolvedUserId || percentage === undefined || !Number.isFinite(normalizedPercentage)) {
      return res.status(400).json({
        success: false,
        error: "userId and percentage are required",
      });
    }

    const log = await BatteryLog.create({
      userId: resolvedUserId,
      percentage: Math.max(0, Math.min(100, Math.round(normalizedPercentage))),
      isCharging: Boolean(isCharging),
      deviceInfo,
    });

    res.status(201).json({ success: true, data: log });
  } catch (err) {
    console.error("Battery log error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getLatestBattery = async (req, res) => {
  try {
    const log = await BatteryLog.findOne({ userId: req.params.userId }).sort({ createdAt: -1 });
    if (!log) return res.status(404).json({ success: false, error: "No data found" });
    res.json({ success: true, data: log });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getBatteryHistory = async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const logs = await BatteryLog.find({ userId: req.params.userId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getAllLatestBattery = async (req, res) => {
  try {
    const logs = await BatteryLog.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { $toString: "$userId" },
          percentage: { $first: "$percentage" },
          isCharging: { $first: "$isCharging" },
          lastSeen: { $first: "$createdAt" },
        },
      },
    ]);
    res.json({ success: true, data: logs });
  } catch (err) {
    console.error("getAllLatestBattery error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const debugBattery = async (req, res) => {
  try {
    const count = await BatteryLog.countDocuments();
    const sample = await BatteryLog.findOne({}).lean();
    res.json({ count, sample });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const clearHistory = async (req, res) => {
  try {
    await BatteryLog.deleteMany({ userId: req.params.userId });
    res.json({ success: true, message: "History cleared" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
