import { Router } from "express";
import { authenticate } from "../middlewares/verifyToken.js";

const router = Router();

router.use(authenticate);

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
