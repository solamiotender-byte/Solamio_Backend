import { Router } from "express";
import { authenticate } from "../middlewares/verifyToken.js";
import User from "../models/user.model.js";
import {
  getUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notification.service.js";

const router = Router();

router.use(authenticate);

router.post("/device-token", async (req, res, next) => {
  try {
    const token = String(req.body?.token || "").trim();
    const platform = String(req.body?.platform || "android").trim() || "android";

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Device token is required",
      });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $pull: { fcmTokens: { token } } }
    );

    await User.updateOne(
      { _id: req.user._id },
      {
        $push: {
          fcmTokens: {
            token,
            platform,
            updatedAt: new Date(),
          },
        },
      }
    );

    res.status(200).json({
      success: true,
      message: "Device token registered",
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/device-token", async (req, res, next) => {
  try {
    const token = String(req.body?.token || "").trim();

    if (token) {
      await User.updateOne(
        { _id: req.user._id },
        { $pull: { fcmTokens: { token } } }
      );
    }

    res.status(200).json({
      success: true,
      message: "Device token removed",
    });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const notifications = await getUserNotifications(req.user._id, req.query);
    res.status(200).json({
      success: true,
      data: {
        notifications,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/read-all", async (req, res, next) => {
  try {
    await markAllNotificationsRead(req.user._id);
    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/read", async (req, res, next) => {
  try {
    const notification = await markNotificationRead(req.user._id, req.params.id);
    res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: { notification },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
