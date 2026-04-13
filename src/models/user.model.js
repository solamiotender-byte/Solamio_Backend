// models/user.model.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;

const getKey = () => {
  const secret = process.env.VIEW_PASSWORD_SECRET || "";
  if (secret.length < KEY_LEN) {
    return crypto.scryptSync(secret || "default_unsafe_key", "salt", KEY_LEN);
  }
  return Buffer.from(secret.slice(0, KEY_LEN));
};

export const encryptViewPassword = (plain) => {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
};

export const decryptViewPassword = (stored) => {
  if (!stored) return null;
  try {
    const [ivHex, tagHex, encHex] = stored.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");
    const encBuf = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encBuf) + decipher.final("utf8");
  } catch {
    return null;
  }
};

// ─── Schema ───────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    email: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      required: true,
    },
    phoneNumber: { type: String, trim: true, sparse: true },

    // ✅ FIX: select: false prevents password from being returned in queries
    //    and prevents accidental re-hashing on save()
    password: { type: String, required: true, minlength: 6, select: false },

    // Stored as AES-256-GCM encrypted string
    viewPassword: { type: String, default: null },

    role: {
      type: String,
      enum: ["Head_office", "ZSM", "ASM", "TEAM"],
      default: "TEAM",
    },
    supervisor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    headOffice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    token: { type: String, default: null },
    refreshToken: { type: String, default: null },
    lastLoginDate: { type: Date, default: null },
    resetPasswordToken: { type: String, default: null },
    resetPasswordExpire: { type: Date, default: null },
  },
  { timestamps: true }
);

// ─── Hooks ────────────────────────────────────────────────────────────────────
userSchema.pre("save", async function (next) {
  // ✅ Only hash if password was explicitly modified (not on token/login updates)
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

// ─── Methods ──────────────────────────────────────────────────────────────────
userSchema.methods.generateAuthToken = function () {
  const token = jwt.sign(
    { _id: this._id, role: this.role },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
  return token;
};

userSchema.methods.generateRefreshToken = function () {
  const refreshToken = jwt.sign(
    { _id: this._id, role: this.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  return refreshToken;
};

export default mongoose.model("User", userSchema);
