import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import compression from "compression";
import mongoSanitize from "express-mongo-sanitize";
import xss from "xss-clean";
import hpp from "hpp";

import apiV1Router from "./routes/index.js";
import globalErrorHandler from "./middlewares/globalErrorHandler.js";
import dns from "dns"
dns.setServers(["1.1.1.1","8.8.8.8"])
// 🔁 Cron Jobs
import {
  startHourlyBackup,
  startDailyCopy,
  startRestoreCron,
} from "./cron/dbBackup.cron.js";
import { startFollowUpNotificationCron } from "./cron/followUpNotification.cron.js";
import { startVisitPhotoCleanupCron } from "./cron/visitPhotoCleanup.cron.js";

const app = express();

// ==================== CRON JOBS ====================
startHourlyBackup();
startRestoreCron();
startDailyCopy();
startFollowUpNotificationCron();
startVisitPhotoCleanupCron();

// ==================== CORS ====================
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://solar-frontend-lake.vercel.app",
  "https://solar-frontend-seven.vercel.app",
  "https://solamio-frontend.vercel.app",
  "https://sunergytechsolar.com",
  "https://www.sunergytechsolar.com",
];

// ✅ FIX: Define corsOptions once and reuse — previously corsOptions was never
//         declared, which caused a ReferenceError crash on startup.
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Log unknown origins in dev; in production you may want to block them
      console.warn(`CORS: unknown origin "${origin}" — allowed anyway`);
      callback(null, true);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // pre-flight for all routes

// ==================== SECURITY ====================
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(mongoSanitize());
app.use(xss());
app.use(hpp());

// ==================== BODY ====================
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(compression());

// ==================== HEALTH CHECK ====================
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
  });
});

// ==================== STATIC ====================
const __dirname = path.resolve();
const publicDir = path.join(__dirname, "public");

app.get("/public/:filename", (req, res, next) => {
  const rawFilename = req.params.filename;
  const filename = path.basename(rawFilename || "");

  if (!filename || filename !== rawFilename) {
    return next();
  }

  const directFile = path.join(publicDir, filename);
  if (fs.existsSync(directFile)) {
    return res.sendFile(directFile);
  }

  const fallbackFolders = [
    path.join(publicDir, "uploads", "images"),
    path.join(publicDir, "uploads", "videos"),
    path.join(publicDir, "uploads", "documents"),
    path.join(publicDir, "uploads", "lead-imports"),
  ];

  for (const folder of fallbackFolders) {
    const candidate = path.join(folder, filename);
    if (fs.existsSync(candidate)) {
      return res.sendFile(candidate);
    }
  }

  return next();
});

app.use(
  "/public",
  express.static(publicDir, {
    maxAge: "1y",
  })
);

// ==================== ROUTES ====================
app.use("/api/v1", apiV1Router);

// ==================== 404 ====================
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// ==================== ERROR ====================
app.use(globalErrorHandler);

export default app;
