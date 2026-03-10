import { exec } from "child_process";
import dotenv from "dotenv";
dotenv.config();

export const copyDatabase = () => {
  const cmd = `
    mongodump --uri="${process.env.MONGO_URL}" --archive |
    mongorestore --uri="${process.env.MONGO_BACKUP_URL}" --archive --drop
  `;

  exec(cmd, (error) => {
    if (error) {
      console.error("❌ DB Copy Failed:", error.message);
      return;
    }
    console.log("✅ Database copied to secondary DB successfully");
  });
};