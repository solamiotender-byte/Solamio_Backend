import crypto from "crypto";
import fs from "fs";
import multer from "multer";
import multerS3 from "multer-s3";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import s3Client, { BUCKET_NAME } from "../config/aws.js";
import { generateFullUrl } from "../utils/generateFullUrl.js";

const useS3Flag = process.env.USE_S3?.trim().toLowerCase();
const useCloudinaryFlag = process.env.USE_CLOUDINARY?.trim().toLowerCase();

const cloudinaryRequested = useCloudinaryFlag === "true";
const cloudinaryEnabled =
  cloudinaryRequested &&
  Boolean(process.env.CLOUDINARY_CLOUD_NAME) &&
  Boolean(process.env.CLOUDINARY_API_KEY) &&
  Boolean(process.env.CLOUDINARY_API_SECRET);

const s3Requested =
  !cloudinaryRequested &&
  (useS3Flag === "true" ||
    (!useS3Flag && process.env.NODE_ENV === "production"));

const s3Enabled = s3Requested && Boolean(BUCKET_NAME);

/* --------------------------------------------------
   FILE FILTER (AUTO-DETECT BY MIME TYPE)
-------------------------------------------------- */
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
   CLOUDINARY HELPERS
-------------------------------------------------- */
const buildCloudinarySignature = (params) => {
  const sorted = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(`${sorted}${process.env.CLOUDINARY_API_SECRET}`)
    .digest("hex");
};

const uploadFileToCloudinary = async (req, file) => {
  const folder = getFolder(req, file);
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `${Date.now()}-${uuidv4()}`;
  const signature = buildCloudinarySignature({
    folder,
    public_id: publicId,
    timestamp,
  });

  const formData = new FormData();
  const blob = new Blob([file.buffer], { type: file.mimetype });

  formData.append("file", blob, file.originalname);
  formData.append("api_key", process.env.CLOUDINARY_API_KEY);
  formData.append("timestamp", String(timestamp));
  formData.append("folder", folder);
  formData.append("public_id", publicId);
  formData.append("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload`,
    {
      method: "POST",
      body: formData,
    }
  );

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      payload?.error?.message || "Cloudinary upload failed"
    );
  }

  return {
    ...file,
    key: payload.public_id,
    filename: payload.public_id,
    path: payload.secure_url,
    location: payload.secure_url,
    secure_url: payload.secure_url,
    size: payload.bytes ?? file.size,
    mimetype: file.mimetype,
  };
};

const persistFileLocally = async (req, file) => {
  const folder = getFolder(req, file);
  const ext = path.extname(file.originalname) || "";
  const filename = `${Date.now()}-${uuidv4()}${ext}`;
  const fullDirectory = path.join(localUploadRoot, folder);
  const fullPath = path.join(fullDirectory, filename);

  if (!fs.existsSync(fullDirectory)) {
    fs.mkdirSync(fullDirectory, { recursive: true });
  }

  await fs.promises.writeFile(fullPath, file.buffer);

  const normalizedPath = fullPath.replace(/\\/g, "/");
  const publicPath = normalizedPath.includes("/public/")
    ? normalizedPath.slice(normalizedPath.indexOf("/public/") + 1)
    : normalizedPath;

  return {
    ...file,
    filename,
    path: publicPath,
    destination: fullDirectory,
    size: file.buffer?.length ?? file.size,
  };
};

const fallbackUploadedFilesToLocal = async (req) => {
  if (req.file?.buffer) {
    req.file = await persistFileLocally(req, req.file);
    return;
  }

  if (Array.isArray(req.files)) {
    req.files = await Promise.all(req.files.map((file) => persistFileLocally(req, file)));
    return;
  }

  if (req.files && typeof req.files === "object") {
    const entries = await Promise.all(
      Object.entries(req.files).map(async ([field, files]) => [
        field,
        await Promise.all(files.map((file) => persistFileLocally(req, file))),
      ])
    );
    req.files = Object.fromEntries(entries);
  }
};

const mapUploadedFiles = async (req) => {
  if (req.file?.buffer) {
    req.file = await uploadFileToCloudinary(req, req.file);
    return;
  }

  if (Array.isArray(req.files)) {
    req.files = await Promise.all(
      req.files.map((file) => uploadFileToCloudinary(req, file))
    );
    return;
  }

  if (req.files && typeof req.files === "object") {
    const entries = await Promise.all(
      Object.entries(req.files).map(async ([field, files]) => [
        field,
        await Promise.all(files.map((file) => uploadFileToCloudinary(req, file))),
      ])
    );
    req.files = Object.fromEntries(entries);
  }
};

const wrapCloudinaryUpload = (middleware) => (req, res, next) => {
  middleware(req, res, async (error) => {
    if (error) return next(error);
    if (!cloudinaryEnabled) return next();

    try {
      await mapUploadedFiles(req);
      return next();
    } catch (uploadError) {
      console.warn(
        `Cloudinary upload failed, falling back to local storage: ${uploadError.message}`
      );

      try {
        await fallbackUploadedFilesToLocal(req);
        return next();
      } catch (localFallbackError) {
        return next(localFallbackError);
      }
    }
  });
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
const localUploadRoot = process.env.LOCAL_UPLOAD_PATH || "./public/uploads";

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
if (cloudinaryRequested && !cloudinaryEnabled) {
  console.warn(
    "Cloudinary upload storage was requested but Cloudinary credentials are incomplete. Falling back to local storage."
  );
}

if (!s3Enabled && s3Requested) {
  console.warn(
    "S3 upload storage was requested but AWS_BUCKET_NAME is missing. Falling back to local storage."
  );
}

const selectedStorage = cloudinaryEnabled
  ? multer.memoryStorage()
  : s3Enabled
    ? s3Storage
    : localStorage;

const multerInstance = multer({
  storage: selectedStorage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 10,
  },
});

export const upload = {
  single: (fieldName) =>
    wrapCloudinaryUpload(multerInstance.single(fieldName)),
  array: (fieldName, maxCount) =>
    wrapCloudinaryUpload(multerInstance.array(fieldName, maxCount)),
  fields: (fieldsConfig) =>
    wrapCloudinaryUpload(multerInstance.fields(fieldsConfig)),
  none: () => multerInstance.none(),
  any: () => wrapCloudinaryUpload(multerInstance.any()),
};

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

  const normalizedFiles = Array.isArray(files)
    ? files
    : Object.values(files).flat();

  const response = normalizedFiles.map((file) => ({
    key: file.key || file.filename,
    url:
      file.location ||
      file.secure_url ||
      generateFullUrl(file.filename),
    size: file.size,
    mimetype: file.mimetype,
    originalName: file.originalname,
  }));

  res.status(200).json({
    success: true,
    files: response,
  });
};
