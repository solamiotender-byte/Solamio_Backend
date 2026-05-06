import {
  createLeaveRequestService,
  getLeavesService,
  updateLeaveStatusService,
} from "../services/leave.service.js";
import { sendResponse } from "../utils/response.js";

export const createLeaveRequest = async (req, res, next) => {
  try {
    const data = await createLeaveRequestService(req.body, req.user);
    sendResponse(res, 201, "Leave request submitted successfully", data);
  } catch (error) {
    next(error);
  }
};

export const getLeaves = async (req, res, next) => {
  try {
    const data = await getLeavesService(req.query, req.user);
    sendResponse(res, 200, "Leave requests fetched successfully", data);
  } catch (error) {
    next(error);
  }
};

export const updateLeaveStatus = async (req, res, next) => {
  try {
    const data = await updateLeaveStatusService(req.params.id, req.body, req.user);
    sendResponse(res, 200, "Leave request updated successfully", data);
  } catch (error) {
    next(error);
  }
};
