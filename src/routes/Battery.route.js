import express from "express";
import {
  logBattery,
  getLatestBattery,
  getBatteryHistory,
  getAllLatestBattery,
  debugBattery,
  clearHistory,
} from "../controllers/battery.controller.js";
import { authenticate } from "../middlewares/verifyToken.js";

const batteryRouter = express.Router();

batteryRouter.post("/log",               authenticate, logBattery);
batteryRouter.get("/debug",              authenticate, debugBattery);
batteryRouter.get("/all-latest",         authenticate, getAllLatestBattery);
batteryRouter.get("/latest/:userId",     authenticate, getLatestBattery);
batteryRouter.get("/history/:userId",    authenticate, getBatteryHistory);
batteryRouter.delete("/history/:userId", authenticate, clearHistory);

export default batteryRouter;