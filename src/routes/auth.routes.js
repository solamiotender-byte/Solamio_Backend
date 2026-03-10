import { Router } from "express";
import {
  registerController,
  loginController,
  logoutController,
} from "../controllers/auth.controller.js";
import {
  validateRegister,
  validateLogin,
} from "../validation/auth.validation.js";
import { handleValidation } from "../validation/validationResult.js";
import { authenticate, allowRoles } from "../middlewares/verifyToken.js";
const authRouter = Router();

authRouter.post(
  "/register",
  validateRegister,
  handleValidation,
  registerController
);
authRouter.post("/login", validateLogin, handleValidation, loginController);
authRouter.get(
  "/logout",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM", "TEAM"]),
  logoutController
);


export default authRouter;
