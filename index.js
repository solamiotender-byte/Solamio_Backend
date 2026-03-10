import dotenv from "dotenv";
import { createServer } from "http";
import mongoose from "mongoose";

import app from "./src/app.js";
import connectDB from "./src/config/mongoDB.js";
import { initializeSocket } from "./src/helper/socket/index.js";
import logger from "./src/utils/logger.js";
import { setupGracefulShutdown } from "./src/utils/shutdownHandler.js";

dotenv.config();

const PORT = process.env.PORT || 9001;

// ==================== CREATE SERVER ====================
const server = createServer(app);

// ==================== SOCKET ====================
const io = initializeSocket(server);
app.set("io", io);

// ==================== START SERVER ====================
const startServer = async () => {
  try {
    await connectDB();

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`API → http://localhost:${PORT}/api/v1`);
    });

    setupGracefulShutdown(server, io);
  } catch (error) {
    console.error("❌ Server start failed:", error);
    process.exit(1);
  }
};

startServer();

// ==================== ERROR HANDLING ====================

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION", err);
  server.close(() => process.exit(1));
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Closing server...");
  server.close(() => {
    mongoose.connection.close(false, () => {
      process.exit(0);
    });
  });
});