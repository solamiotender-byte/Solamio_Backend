import cron from "node-cron";
import Visit from "../models/visit.model.js";

const VISIT_PHOTO_RETENTION_DAYS = 7;

export const cleanupExpiredVisitPhotos = async () => {
  const cutoffDate = new Date(Date.now() - VISIT_PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const result = await Visit.updateMany(
    {
      "photos.0": { $exists: true },
      $or: [
        { visitDate: { $lt: cutoffDate } },
        {
          visitDate: { $exists: false },
          createdAt: { $lt: cutoffDate },
        },
      ],
    },
    {
      $set: { photos: [] },
    }
  );

  if (result.modifiedCount > 0) {
    console.log(`[Cron] Cleared expired visit photos from ${result.modifiedCount} visit(s) older than ${VISIT_PHOTO_RETENTION_DAYS} days.`);
  }
};

export const startVisitPhotoCleanupCron = () => {
  cron.schedule("10 0 * * *", async () => {
    try {
      await cleanupExpiredVisitPhotos();
    } catch (error) {
      console.error("Visit photo cleanup cron failed:", error.message);
    }
  });
};
