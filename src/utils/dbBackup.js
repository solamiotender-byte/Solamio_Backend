import { exec } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const BACKUP_DIR = process.env.BACKUP_DIR || "./backups";
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 30);

export const takeDBBackup = async () => {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = `mongo-backup-${timestamp}.gz`;
  const backupPath = path.join(BACKUP_DIR, backupFile);

  const command = `
    mongodump --uri="${process.env.MONGO_URL}" --archive="${backupPath}" --gzip
  `;

  exec(command, (error) => {
    if (error) {
      console.error("❌ Backup failed:", error.message);
      return;
    }

    console.log(`✅ Backup created: ${backupFile}`);
    cleanOldBackups();
  });
};

const cleanOldBackups = () => {
  const files = fs.readdirSync(BACKUP_DIR);

  const now = Date.now();
  files.forEach((file) => {
    const filePath = path.join(BACKUP_DIR, file);
    const stats = fs.statSync(filePath);

    const ageInDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageInDays > RETENTION_DAYS) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Old backup removed: ${file}`);
    }
  });
};