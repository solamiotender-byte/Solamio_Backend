// services/auth.service.js
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
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
    const { email, phoneNumber } = userData;

    const existingUser = await User.findOne({
      $or: [{ email }, { phoneNumber }],
    });

    if (existingUser) throw new AppError("User already exists", 400);

    // ✅ Pass plain password — the pre-save hook handles hashing
    const newUserId = new mongoose.Types.ObjectId();
    const newUser = new User({
      _id: newUserId,
      ...userData,
      headOffice: userData.role === "Head_office" ? newUserId : userData.headOffice || null,
    });
    await newUser.save();

    const result = newUser.toObject();
    delete result.password;
    delete result.viewPassword;
    return result; // createdAt included via timestamps:true
  } catch (error) {
    handleError(error, "User registration failed");
  }
};

/* ==========================================================
   USER LOGIN
========================================================== */
export const login = async ({ email, password }) => {
  try {
    // ✅ Explicitly select password field (hidden by select: false in schema)
    const user = await User.findOne({ email }).select("+password");
    if (!user) throw new AppError("Invalid email or password", 400);

    // ✅ Check if account is active
    if (user.status === "inactive") {
      throw new AppError(
        "Your account has been deactivated. Contact admin.",
        403
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new AppError("Invalid email or password", 400);

    const token        = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    // ✅ Use findByIdAndUpdate instead of user.save()
    //    This avoids triggering the pre-save hook which would re-hash the password
    await User.findByIdAndUpdate(user._id, {
      token,
      refreshToken,
      lastLoginDate: new Date(),
    });

    const result = user.toObject();
    delete result.password;

    // ✅ Attach fresh tokens (toObject() has old/null values)
    result.token        = token;
    result.refreshToken = refreshToken;

    // ✅ Explicitly ensure createdAt is present (timestamps:true guarantees
    //    it exists on the document — this just makes it explicit)
    result.createdAt = user.createdAt;

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

    // ✅ Use findByIdAndUpdate to avoid triggering pre-save hook
    await User.findByIdAndUpdate(userId, {
      token:        null,
      refreshToken: null,
    });

    return true;
  } catch (error) {
    handleError(error, "Logout failed");
  }
};
