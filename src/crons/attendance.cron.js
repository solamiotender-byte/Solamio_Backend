import cron from "node-cron";
import { autoPunchOutService } from "../services/attendance.service.js";

export const startAttendanceCron = () => {
  cron.schedule("*/5 * * * *", async () => {
    console.log("[Cron] Running auto punch-out check...");
    await autoPunchOutService();
  });
  console.log("[Cron] Attendance auto punch-out cron started ✅");
};