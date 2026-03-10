import cron from "node-cron";
import { takeDBBackup } from "../utils/dbBackup.js";
import { restoreLatestBackup } from "../utils/dbRestore.js";
import { copyDatabase } from "../utils/dbMigrate.js";


export const startHourlyBackup = () => {
  cron.schedule("0 * * * *", async () => {
    console.log("🕐 [CRON] Hourly DB Backup started");
    try {
      await takeDBBackup();
      console.log("✅ [CRON] Hourly DB Backup completed");
    } catch (error) {
      console.error("❌ [CRON] Hourly Backup failed:", error.message);
    }
  });

  console.log("🟢 Hourly Backup Cron Active (Every 1 Hour)");
};

export const startRestoreCron = () => {
  // Every 12 hours
  cron.schedule("0 */12 * * *", async () => {
    console.log("🕛 [CRON] DB Restore started");
    try {
      await restoreLatestBackup();
      console.log("✅ [CRON] DB Restore completed");
    } catch (error) {
      console.error("❌ [CRON] Restore failed:", error.message);
    }
  });

  console.log("🟢 Restore Cron Active (Every 12 Hours)");
};

export const startDailyCopy = () => {
  // Every 24 hours (midnight)
  cron.schedule("0 0 * * *", async () => {
    console.log("🌙 [CRON] Daily DB Copy started");
    try {
      await copyDatabase();
      console.log("✅ [CRON] Daily DB Copy completed");
    } catch (error) {
      console.error("❌ [CRON] DB Copy failed:", error.message);
    }
  });

  console.log("🟢 Daily DB Copy Cron Active (Every 24 Hours)");
};