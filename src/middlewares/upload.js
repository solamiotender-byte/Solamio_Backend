import multer from "multer";
import multerS3 from "multer-s3";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import s3Client, { BUCKET_NAME } from "../config/aws.js";
import { generateFullUrl } from "../utils/generateFullUrl.js";

const s3Enabled =
  (process.env.USE_S3 === "true" || process.env.NODE_ENV === "production") &&
  Boolean(BUCKET_NAME);

/* --------------------------------------------------
   FILE FILTER (AUTO-DETECT BY MIME TYPE)
-------------------------------------------------- */
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    // Images
    "image/jpeg",
    "image/png",
    "image/webp",

    // Documents
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",

    // Import files (CSV / Excel)
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

    // Videos
    "video/mp4",
    "video/quicktime",
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}`), false);
  }
};

/* --------------------------------------------------
   FOLDER RESOLUTION (SAFE)
-------------------------------------------------- */
const getFolder = (req, file) => {
  if (req.body?.folder) return req.body.folder;

  const userId = req.user?.id || "anonymous";

  // Decide folder by MIME type
  if (file.mimetype.startsWith("image/")) return "images";
  if (file.mimetype.startsWith("video/")) return "videos";

  if (
    file.mimetype === "text/csv" ||
    file.mimetype.includes("spreadsheet") ||
    file.mimetype.includes("excel")
  ) {
    return "lead-imports";
  }

  return "documents";
};

/* --------------------------------------------------
   S3 STORAGE
-------------------------------------------------- */
const s3Storage = s3Enabled
  ? multerS3({
      s3: s3Client,
      bucket: BUCKET_NAME,
      contentType: multerS3.AUTO_CONTENT_TYPE,

      metadata: (req, file, cb) => {
        cb(null, {
          uploadedBy: req.user?.email || "system",
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
        });
      },

      key: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const folder = getFolder(req, file);
        const filename = `${folder}/${Date.now()}-${uuidv4()}${ext}`;
        cb(null, filename);
      },
    })
  : null;

/* --------------------------------------------------
   LOCAL STORAGE (DEV / FALLBACK)
-------------------------------------------------- */
const localUploadRoot =
  process.env.LOCAL_UPLOAD_PATH || "./public/uploads";

if (!fs.existsSync(localUploadRoot)) {
  fs.mkdirSync(localUploadRoot, { recursive: true });
}

const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = getFolder(req, file);
    const fullPath = path.join(localUploadRoot, folder);

    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }

    cb(null, fullPath);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  },
});

/* --------------------------------------------------
   STORAGE SELECTOR
-------------------------------------------------- */
if (!s3Enabled && (process.env.USE_S3 === "true" || process.env.NODE_ENV === "production")) {
  console.warn(
    "S3 upload storage was requested but AWS_BUCKET_NAME is missing. Falling back to local storage."
  );
}

const storage = s3Enabled ? s3Storage : localStorage;

/* --------------------------------------------------
   MULTER INSTANCE
-------------------------------------------------- */
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
    files: 10,
  },
});

/* --------------------------------------------------
   STANDARD UPLOAD RESPONSE HANDLER
-------------------------------------------------- */
export const handleUploadResponse = (req, res) => {
  const files = req.files || (req.file ? [req.file] : []);

  if (!files.length) {
    return res.status(400).json({
      success: false,
      message: "No files uploaded",
    });
  }

  const response = files.map((file) => ({
    key: file.key || file.filename,
    url: file.location || generateFullUrl(file.filename),
    size: file.size,
    mimetype: file.mimetype,
    originalName: file.originalname,
  }));

  res.status(200).json({
    success: true,
    files: response,
  });
};
