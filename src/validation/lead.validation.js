import { body, param } from "express-validator";

export const createLeadValidation = [
  body("firstName")
    .notEmpty()
    .withMessage("First name is required")
    .isString()
    .withMessage("First name must be a string"),

  body("lastName")
    .optional()
    .isString()
    .withMessage("Last name must be a string"),

  body("email")
    .optional()
    .matches(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .withMessage("Invalid email address"),

  body("phone")
     .optional()                          // ← change notEmpty() to optional()
  .matches(/^[0-9]{7,15}$/)
  .withMessage("Phone must be 7 to 15 digits only"),
];

export const updateLeadValidation = [
  param("id").isMongoId().withMessage("Invalid lead id"),
  body("firstName")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("First name cannot be empty"),

  body("lastName")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Last name cannot be empty"),

  body("email")
    .optional()
    .matches(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .withMessage("Invalid email address"),

  body("phone")
    .optional()
    .matches(/^[0-9]{7,15}$/)
    .withMessage("Phone number must be 10 digits"),

  body("status")
    .optional()
    .isIn([
      "Visit",
      "Registration",
      "Bank Loan Apply",
      "Document Submission",
      "Bank at Pending",
      "Disbursement",
      "Installation Completion",
      "Missed Leads",
    ])
    .withMessage("Invalid status"),
  body("approvePending")
    .optional()
    .isBoolean()
    .withMessage("approvePending must be true or false"),
];

export const assignLeadValidation = [
  body("leadId").isMongoId().withMessage("Invalid leadId"),
  body("managerId").optional().isMongoId().withMessage("Invalid managerId"),
  body("userId").optional().isMongoId().withMessage("Invalid userId"),
];

export const importLeadsValidation = [
  // multer handles file, but we can check file existence in controller, keep a placeholder
  body().custom((_, { req }) => {
    if (!req.file) throw new Error("File is required");
    return true;
  }),
];
