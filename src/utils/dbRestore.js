import { exec } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const BACKUP_DIR = process.env.BACKUP_DIR || "./backups";

export const restoreLatestBackup = () => {
  if (!fs.existsSync(BACKUP_DIR)) {
    console.log("⚠️ No backup directory found");
    return;
  }

  const backups = fs
    .readdirSync(BACKUP_DIR)
    .filter(file => file.endsWith(".gz"))
    .sort();

  if (!backups.length) {
    console.log("⚠️ No backups available to restore");
    return;
  }

  const latestBackup = backups.at(-1);
  const backupPath = path.join(BACKUP_DIR, latestBackup);

  const command = `
    mongorestore --uri="${process.env.MONGO_URL}" --drop --archive="${backupPath}" --gzip
  `;

  exec(command, (error) => {
    if (error) {
      console.error("❌ Restore failed:", error.message);
      return;
    }

    console.log(`✅ Database restored from: ${latestBackup}`);
  });
};