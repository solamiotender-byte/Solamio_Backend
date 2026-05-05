import { Router } from "express";
import { authenticate } from "../middlewares/verifyToken.js";
import User from "../models/user.model.js";

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

router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      notifications: [],
    },
  });
});

router.patch("/:id/read", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Notification marked as read",
  });
});

router.patch("/read-all", (req, res) => {
  res.status(200).json({
    success: true,
    message: "All notifications marked as read",
  });
});

export default router;
