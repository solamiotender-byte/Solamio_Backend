import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/user.model.js";
import { AppError, NotFoundError } from "../errors/customError.js";

/* ==========================================================
   Helper for Unified Error Handling
========================================================== */
const handleError = (error, defaultMessage) => {
  if (error instanceof AppError) throw error;
  throw new AppError(error.message || defaultMessage, 500);
};

/* ==========================================================
   USER REGISTRATION
========================================================== */
export const register = async (userData) => {
  try {
    const { email, phoneNumber } = userData;  // remove password from destructure

    const existingUser = await User.findOne({
      $or: [{ email }, { phoneNumber }],
    });

    if (existingUser) throw new AppError("User already exists", 400);

    // ✅ Pass plain password — the pre-save hook handles hashing
    const newUser = new User({ ...userData });

    await newUser.save();

    const result = newUser.toObject();
    delete result.password;
    return result;
  } catch (error) {
    handleError(error, "User registration failed");
  }
};

/* ==========================================================
   USER LOGIN (Email + Password Only)
========================================================== */
export const login = async ({ email, password }) => {
  try {
    const user = await User.findOne({ email }).select("+password");
    if (!user) throw new AppError("Invalid email or password", 400);

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new AppError("Invalid email or password", 400);

    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    user.token = token;
    user.refreshToken = refreshToken;
    user.lastLoginDate = new Date();
    await user.save();

    const result = user.toObject();
    delete result.password;
    return result;
  } catch (error) {
    handleError(error, "User login failed");
  }
};

/* ==========================================================
   USER LOGOUT
========================================================== */
export const logout = async ({ userId }) => {
  try {
    const user = await User.findById(userId);
    if (!user) throw new NotFoundError("User", userId);

    user.token = null;
    user.refreshToken = null;
    await user.save();
    return true;
  } catch (error) {
    handleError(error, "Logout failed");
  }
};

