import { Router } from "express";
import { authenticate, allowRoles } from "../middlewares/verifyToken.js";

import {
  createExpenseController,
  getExpensesController,
  getExpenseController,
  updateExpenseController,
  deleteExpenseController,
  approveExpenseController,
  rejectExpenseController,
  getExpenseStatsController,
  getUserSummaryController,
} from "../controllers/expense.controller.js";
import { upload } from '../middlewares/upload.js';

const router = Router();

// All roles that can create/update expenses
const expenseRoles = ["Head_office", "ZSM", "ASM", "TEAM"];
// Roles that can approve/reject expenses
const approverRoles = ["Head_office", "ZSM", "ASM"];

/**
 * @route POST /api/expenses/create
 * @desc Create a new expense with optional bill attachment
 * @access Private (All expense roles)
 */
router.post(
  "/create",
  authenticate,
  allowRoles(expenseRoles),
  upload.single('billAttachment'),
  createExpenseController
);

/**
 * @route GET /api/expenses/getAll
 * @desc Get all expenses with filtering, pagination, and sorting
 * @access Private (All expense roles)
 */
router.get(
  "/getAll",
  authenticate,
  allowRoles(expenseRoles),
  getExpensesController
);

/**
 * @route GET /api/expenses/stats
 * @desc Get expense statistics
 * @access Private (All expense roles)
 */
router.get(
  "/stats",
  authenticate,
  allowRoles(expenseRoles),
  getExpenseStatsController
);

/**
 * @route GET /api/expenses/user/:userId/summary
 * @desc Get expense summary for a specific user
 * @access Private (Approver roles only)
 */
router.get(
  "/user/:userId/summary",
  authenticate,
  allowRoles(["Head_office", "ZSM", "ASM"]),
  getUserSummaryController
);

/**
 * @route GET /api/expenses/getById/:id
 * @desc Get a single expense by ID
 * @access Private (All expense roles)
 */
router.get(
  "/getById/:id",
  authenticate,
  allowRoles(expenseRoles),
  getExpenseController
);

/**
 * @route PUT /api/expenses/update/:id
 * @desc Update an expense with optional bill attachment
 * @access Private (All expense roles)
 */
router.put(
  "/update/:id",
  authenticate,
  allowRoles(expenseRoles),
  upload.single('billAttachment'),
  updateExpenseController
);

/**
 * @route PUT /api/expenses/approve/:id
 * @desc Approve an expense
 * @access Private (Approver roles only)
 */
router.put(
  "/approve/:id",
  authenticate,
  allowRoles(approverRoles),
  approveExpenseController
);

/**
 * @route PUT /api/expenses/reject/:id
 * @desc Reject an expense with reason
 * @access Private (Approver roles only)
 */
router.put(
  "/reject/:id",
  authenticate,
  allowRoles(approverRoles),
  rejectExpenseController
);

/**
 * @route DELETE /api/expenses/delete/:id
 * @desc Delete an expense (permanent)
 * @access Private (Head_office only)
 */
router.delete(
  "/delete/:id",
  authenticate,
  allowRoles(["Head_office"]),
  deleteExpenseController
);

export default router;