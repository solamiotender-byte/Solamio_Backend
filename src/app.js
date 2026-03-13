import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import compression from "compression";
import mongoSanitize from "express-mongo-sanitize";
import xss from "xss-clean";
import hpp from "hpp";

import apiV1Router from "./routes/index.js";
import globalErrorHandler from "./middlewares/globalErrorHandler.js";

// 🔁 Cron Jobs
import { startHourlyBackup, startDailyCopy, startRestoreCron } from "./cron/dbBackup.cron.js";

const app = express();

// ==================== CRON JOBS ====================
startHourlyBackup();
startRestoreCron();
startDailyCopy();

// ==================== CORS ====================
// ==================== CORS ====================
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://solar-frontend-lake.vercel.app",
  "https://solar-frontend-seven.vercel.app",
  "https://sunergytechsolar.com",
  "https://www.sunergytechsolar.com"
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // allow instead of blocking
    }
  },
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));



app.options("*", cors());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

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
app.use(
  express.json({
    limit: "50mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "50mb",
  })
);

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

app.use(
  "/public",
  express.static(path.join(__dirname, "public"), {
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