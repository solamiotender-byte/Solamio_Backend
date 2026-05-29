import express from "express";
import { authenticate, allowRoles } from "../middlewares/verifyToken.js";
import {
  getTrackingStatuses,
  logTrackingHeartbeat,
  reportLocationOff,
} from "../controllers/trackingStatus.controller.js";

const trackingStatusRouter = express.Router();

trackingStatusRouter.use(authenticate);

trackingStatusRouter.post("/heartbeat", logTrackingHeartbeat);
trackingStatusRouter.post("/location-off", reportLocationOff);
trackingStatusRouter.get(
  "/",
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getTrackingStatuses,
);

export default trackingStatusRouter;
