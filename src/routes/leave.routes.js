import express from "express";
import { authenticate, allowRoles } from "../middlewares/verifyToken.js";
import {
  createLeaveRequest,
  getLeaves,
  updateLeaveStatus,
} from "../controllers/leave.controller.js";

const router = express.Router();

const allRoles = ["TEAM", "ASM", "ZSM", "Head_office"];
const managerRoles = ["ASM", "ZSM", "Head_office"];

router.get("/", authenticate, allowRoles(allRoles), getLeaves);
router.post("/", authenticate, allowRoles(allRoles), createLeaveRequest);
router.patch("/:id/status", authenticate, allowRoles(managerRoles), updateLeaveStatus);

export default router;
