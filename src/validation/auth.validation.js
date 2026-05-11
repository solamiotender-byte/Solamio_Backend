import { body, param } from "express-validator";

export const validateRegister = [
  body("email")
    .notEmpty()
    .withMessage("email is required")
    .isEmail()
    .withMessage("Invalid email address")
    .trim(),

  body("password")
    .notEmpty()
    .withMessage("password is required")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long")
    .matches(/\d/)
    .withMessage("Password must contain at least one number")
    .matches(/[A-Z]/)
    .withMessage("Password must contain at least one uppercase letter")
    .matches(/[a-z]/)
    .withMessage("Password must contain at least one lowercase letter")
    .matches(/[@$!%*?&]/)
    .withMessage("Password must contain at least one special character")
    .trim(),

  body("firstName").notEmpty().withMessage("First name is required"),
  body("lastName").optional(),

  body("phoneNumber")
    .notEmpty()
    .withMessage("phone number is required")
    .matches(/^[0-9]{10}$/)
    .withMessage("phone number must be exactly 10 digits")
    .trim(),
];

export const validateLogin = [
  body("email")
    .notEmpty()
    .withMessage("email is required")
    .isEmail()
    .withMessage("Invalid email address")
    .trim()
    .toLowerCase(),

  body("password")
    .notEmpty()
    .withMessage("password is required")
    .trim(),
];
