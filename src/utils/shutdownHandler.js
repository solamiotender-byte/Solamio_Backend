// src/utils/shutdownHandler.js
import mongoose from "mongoose";
import logger from "./logger.js";

export const setupGracefulShutdown = (server, io) => {
  const gracefulShutdown = async (signal) => {
    //console.log(`\n👋 ${signal} received. Starting graceful shutdown...`);
    logger.info(`${signal} received, starting graceful shutdown`);

    // Set a timeout for forced shutdown
    const forceShutdownTimeout = setTimeout(() => {
      console.error("❌ Could not close connections in time, forcefully shutting down");
      logger.error("Forceful shutdown due to timeout");
      process.exit(1);
    }, 10000); // 10 seconds timeout

    try {
      // 1. Stop accepting new connections
      server.close(() => {
        //console.log("✅ HTTP server closed");
        logger.info("HTTP server closed");
      });

      // 2. Close Socket.IO connections
      if (io) {
        await new Promise((resolve) => {
          io.close(() => {
            //console.log("✅ Socket.IO server closed");
            logger.info("Socket.IO server closed");
            resolve();
          });
        });
      }

      // 3. Close database connection
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close(false);
        //console.log("✅ MongoDB connection closed");
        logger.info("MongoDB connection closed");
      }

      // 4. Clear any other resources (cron jobs, etc.)
      // Add your cleanup here

      // Clear the force shutdown timeout
      clearTimeout(forceShutdownTimeout);

      //console.log("💤 Graceful shutdown completed");
      logger.info("Graceful shutdown completed");

      process.exit(0);
    } catch (error) {
      console.error("❌ Error during graceful shutdown:", error);
      logger.error("Error during graceful shutdown", { error: error.message });
      process.exit(1);
    }
  };

  // Handle different shutdown signals
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGQUIT", () => gracefulShutdown("SIGQUIT"));
};