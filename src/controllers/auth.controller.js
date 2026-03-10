import {
  register,
  login,
  logout,
} from "../services/auth.service.js";
import { sendResponse } from "../utils/response.js";


/*===================== Register controller ======================*/

export const registerController = async (req, res, next) => {
  try {
    const user = await register(req.body);
    return sendResponse(res, 201, "User registered successfully", user);
  } catch (error) {
    next(error);
  }
};

/*===================== Login controller ======================*/

export const loginController = async (req, res, next) => {
  try {
    const user = await login(req.body);
    return sendResponse(res, 200, "User login successfully", user);
  } catch (error) {
    next(error);
  }
};

/*======================= Logout controller ===================*/

export const logoutController = async (req, res, next) => {
  try {
    const userId = req.user._id;
    await logout({ userId });
    return sendResponse(res, 200, "User logout successful", {});
  } catch (error) {
    next(error);
  }
};
