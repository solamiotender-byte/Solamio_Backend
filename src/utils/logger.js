// src/utils/logger.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create logs directory if it doesn't exist
const logDir = path.join(__dirname, "../../logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Log levels
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLogLevel = process.env.LOG_LEVEL || "info";

class Logger {
  constructor() {
    this.logFile = path.join(
      logDir,
      `app-${new Date().toISOString().split("T")[0]}.log`
    );
    this.errorLogFile = path.join(
      logDir,
      `error-${new Date().toISOString().split("T")[0]}.log`
    );
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      // ✅ Fix: safely serialize message if it's an object
      message: typeof message === "object"
        ? JSON.stringify(message)
        : message,
      ...meta,
      pid: process.pid,
    };
    return JSON.stringify(logEntry);
  }

  writeToFile(logFile, formattedMessage) {
    fs.appendFile(logFile, formattedMessage + "\n", (err) => {
      if (err) {
        console.error("Failed to write to log file:", err);
      }
    });
  }

  log(level, message, meta = {}) {
    if (LOG_LEVELS[level] > LOG_LEVELS[currentLogLevel]) {
      return;
    }

    // ✅ Fix: handle when message is an object (e.g. logger.error({...}))
    const resolvedMessage =
      typeof message === "object"
        ? JSON.stringify(message, null, 2)
        : message;

    const resolvedMeta =
      typeof message === "object" ? {} : meta;

    const formattedMessage = this.formatMessage(level, resolvedMessage, resolvedMeta);

    // Console colors
    const colors = {
      error: "\x1b[31m", // Red
      warn: "\x1b[33m",  // Yellow
      info: "\x1b[36m",  // Cyan
      debug: "\x1b[35m", // Magenta
      reset: "\x1b[0m",
    };

    // ✅ Fix: properly display meta if it has keys
    const metaDisplay =
      Object.keys(resolvedMeta).length > 0
        ? "\n" + JSON.stringify(resolvedMeta, null, 2)
        : "";

    console.log(
      `${colors[level] || ""}[${level.toUpperCase()}]${colors.reset} ${resolvedMessage}${metaDisplay}`
    );

    // File output
    if (level === "error") {
      this.writeToFile(this.errorLogFile, formattedMessage);
    }
    this.writeToFile(this.logFile, formattedMessage);
  }

  error(message, meta = {}) {
    this.log("error", message, meta);
  }

  warn(message, meta = {}) {
    this.log("warn", message, meta);
  }

  info(message, meta = {}) {
    this.log("info", message, meta);
  }

  debug(message, meta = {}) {
    this.log("debug", message, meta);
  }
}

export default new Logger();