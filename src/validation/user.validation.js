import { body, param, query } from "express-validator";

export const createUserValidation = [
  body("firstName")
    .notEmpty()
    .withMessage("First name is required")
    .trim()
    .isLength({ min: 2 })
    .withMessage("First name must be at least 2 characters")
    .isLength({ max: 50 })
    .withMessage("First name must be less than 50 characters"),

  body("lastName")
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage("Last name must be less than 50 characters"),

  body("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Valid email address is required")
    .normalizeEmail()
    .isLength({ max: 100 })
    .withMessage("Email must be less than 100 characters"),

  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage(
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),

  body("phoneNumber")
    .notEmpty()
    .withMessage("Phone number is required")
    .matches(/^[0-9]{10}$/)
    .withMessage("Phone number must be exactly 10 digits")
    .trim(),

  body("role")
    .notEmpty()
    .withMessage("Role is required")
    .isIn(["HEAD_OFFICE", "ZSM", "ASM", "TEAM", "COMMERCIAL_HEAD"])
    .withMessage(
      "Invalid role. Valid roles: Head_office, ZSM, ASM, TEAM, Sales Executive, Support"
    ),

  body("supervisor")
    .optional()
    .isMongoId()
    .withMessage("Invalid supervisor ID"),

  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Status must be either active or inactive"),
];

export const updateUserValidation = [
  param("userId").isMongoId().withMessage("Invalid user ID"),

  body("firstName")
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage("First name must be at least 2 characters")
    .isLength({ max: 50 })
    .withMessage("First name must be less than 50 characters"),

  body("lastName")
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage("Last name must be less than 50 characters"),

  body("email")
    .optional()
    .isEmail()
    .withMessage("Valid email address is required")
    .normalizeEmail()
    .isLength({ max: 100 })
    .withMessage("Email must be less than 100 characters"),

  body("phoneNumber")
    .optional()
    .matches(/^[0-9]{10}$/)
    .withMessage("Phone number must be exactly 10 digits")
    .trim(),

  body("role")
    .optional()
    .isIn(["HEAD_OFFICE", "ZSM", "ASM", "TEAM", "COMMERCIAL_HEAD"])
    .withMessage("Invalid role"),

  body("supervisor")
    .optional()
    .isMongoId()
    .withMessage("Invalid supervisor ID"),

  body("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("Status must be either active or inactive"),
];

export const getUserByIdValidation = [
  param("userId").isMongoId().withMessage("Invalid user ID"),
];

export const deleteUserValidation = [
  param("userId").isMongoId().withMessage("Invalid user ID"),
];

export const toggleStatusValidation = [
  param("userId").isMongoId().withMessage("Invalid user ID"),
];

export const getViewPasswordValidation = [
  param("userId").isMongoId().withMessage("Invalid user ID"),
];

export const assignToManagerValidation = [
  body("userId")
    .notEmpty()
    .withMessage("User ID is required")
    .isMongoId()
    .withMessage("Invalid user ID"),

  body("managerId")
    .notEmpty()
    .withMessage("Manager ID is required")
    .isMongoId()
    .withMessage("Invalid manager ID"),
];

export const getUserHierarchyValidation = [
  param("userId").isMongoId().withMessage("Invalid user ID"),
];

export const getUsersQueryValidation = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer")
    .toInt(),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100")
    .toInt(),

  query("search")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Search term too long"),

  query("role")
    .optional()
    .isIn(["HEAD_OFFICE", "ZSM", "ASM", "TEAM", "COMMERCIAL_HEAD"])
    .withMessage("Invalid role filter"),

  query("status")
    .optional()
    .isIn(["active", "inactive", "all"])
    .withMessage("Status must be active, inactive"),

  query("sortBy")
    .optional()
    .isIn([
      "firstName",
      "lastName",
      "email",
      "role",
      "status",
      "createdAt",
      "updatedAt",
    ])
    .withMessage("Invalid sort field"),

  query("sortOrder")
    .optional()
    .isIn(["asc", "desc"])
    .withMessage("Sort order must be asc or desc"),
];
