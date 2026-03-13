import { Router } from "express";
import {
  createUserController,
  getUsersController,
  getUserProfileController,
  updateUserController,
  deleteUserController,
  assignUserToManagerController,
  toggleUserStatusController,
  getViewPasswordController,
  getManagerListController,
  getManagerUnderUserListController,
} from "../controllers/user.controller.js";

import {
  createUserValidation,
  updateUserValidation,
  getUserByIdValidation,
  assignToManagerValidation,
  getUsersQueryValidation,
} from "../validation/user.validation.js";

import { handleValidation } from "../validation/validationResult.js";
import { authenticate, allowRoles } from "../middlewares/verifyToken.js";

const router = Router();

/* Create User */
router.post(
  "/create",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM"]),
  createUserValidation,
  handleValidation,
  createUserController
);


/* Get All Users with filters */
router.get(
  "/getAllUsers",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  getUsersQueryValidation,
  handleValidation,
  getUsersController
);

/* Get User Profile */
router.get(
  "/getUserById/:userId",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM"]),
  getUserByIdValidation,
  handleValidation,
  getUserProfileController
);

/* Update User */
router.put(
  "/update/:userId",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM"]),
  updateUserValidation,
  handleValidation,
  updateUserController
);

/* Toggle User Status */
router.patch(
  "/toggleStatus/:userId",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM"]),
  getUserByIdValidation,
  handleValidation,
  toggleUserStatusController
);

/* Get View Password (Admin only) */
router.get(
  "/getViewPassword/:userId",
  authenticate,
  allowRoles(["Head_office"]),
  getUserByIdValidation,
  handleValidation,
  getViewPasswordController
);

/* Delete User */
router.delete(
  "/delete/:userId",
  authenticate,
  allowRoles(["Head_office"]),
  getUserByIdValidation,
  handleValidation,
  deleteUserController
);

/* Assign User to Manager */
router.post(
  "/asignUserToManager",
  authenticate,
  allowRoles(["Head_office", "ZSM"]),
  assignToManagerValidation,
  handleValidation,
  assignUserToManagerController
);

/* Assign User to Manager */
router.get(
  "/managerList",
  authenticate,
  allowRoles(["Head_office", "ZSM"]),
  getManagerListController
);

router.get(
  "/getManagerUnderUserList",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM"]),
  getManagerUnderUserListController
);

export default router;
