import {
  createUserService,
  getUsersService,
  updateUserService,
  getUserProfileService,
  deleteUserService,
  assignUserToManagerService,
  toggleUserStatusService,
  getViewPasswordService,
  getManagerList,
  getTeamUnderAsmList,
} from "../services/user.service.js";
import { sendResponse } from "../utils/response.js";

/* Create User */
export const createUserController = async (req, res, next) => {
  try {
    const data = await createUserService(req.body, req.user._id);
    sendResponse(res, 201, "User created successfully", data);
  } catch (error) {
    next(error);
  }
};

/* Get Users with filters */
export const getUsersController = async (req, res, next) => {
  try {
    const data = await getUsersService(req.query, req.user);
    sendResponse(res, 200, "Users fetched successfully", data);
  } catch (error) {
    next(error);
  }
};

/* Get User Profile */
export const getUserProfileController = async (req, res, next) => {
  try {
    const data = await getUserProfileService(req.params.userId, req.user);
    sendResponse(res, 200, "User profile fetched successfully", data);
  } catch (error) {
    next(error);
  }
};

/* Update User */
export const updateUserController = async (req, res, next) => {
  try {
    const data = await updateUserService(req.params.userId, req.body, req.user);
    sendResponse(res, 200, "User updated successfully", data);
  } catch (error) {
    next(error);
  }
};

/* Toggle User Status */
export const toggleUserStatusController = async (req, res, next) => {
  try {
    const data = await toggleUserStatusService(req.params.userId, req.user);
    sendResponse(res, 200, data.message, data);
  } catch (error) {
    next(error);
  }
};

/* Get View Password (Admin only) */
export const getViewPasswordController = async (req, res, next) => {
  try {
    const data = await getViewPasswordService(req.params.userId, req.user);
    sendResponse(res, 200, "Password retrieved successfully", data);
  } catch (error) {
    next(error);
  }
};

/* Delete User */
export const deleteUserController = async (req, res, next) => {
  try {
    const data = await deleteUserService(req.params.userId, req.user);
    sendResponse(res, 200, data.message, data);
  } catch (error) {
    next(error);
  }
};

/* Assign User to Manager */
export const assignUserToManagerController = async (req, res, next) => {
  try {
    const { userId, managerId } = req.body;
    const data = await assignUserToManagerService(userId, managerId, req.user);
    sendResponse(res, 200, data.message, data);
  } catch (error) {
    next(error);
  }
};

/* Get Manager List */
export const getManagerListController = async (req, res, next) => {
  try {
    const data = await getManagerList(req.query, req.user._id);
    sendResponse(res, 200, "Manager list fetched successfully", data);
  } catch (error) {
    next(error);
  }
};

/* Get User List */
export const getManagerUnderUserListController = async (req, res, next) => {
  try {
    const data = await getTeamUnderAsmList(req.query, req.user._id);
    sendResponse(res, 200, "Manager list fetched successfully", data);
  } catch (error) {
    next(error);
  }
};
