// routes/attendance.routes.js
import express from 'express';
import { authenticate, allowRoles } from '../middlewares/verifyToken.js';
import { upload } from '../middlewares/upload.js';
import {
  punchIn,
  punchOut,
  markHoliday,
  getAllAttendance,
  getAttendanceById,
  updateAttendance,
  deleteAttendance,
  getAttendanceStats,
} from '../controllers/attendance.controller.js';

const router = express.Router();

// All roles that can access attendance
const attendanceRoles = ['TEAM', 'ASM', 'ZSM', 'Head_office'];
const managerRoles = ['ASM', 'ZSM', 'Head_office'];
const adminRoles = ['Head_office'];

// ==================== PUNCH IN/OUT (TEAM only) ====================
router.post(
  '/punch-in',
  authenticate,
  allowRoles(['TEAM']),
  upload.array('photos', 5),
  punchIn
);

router.post(
  '/punch-out',
  authenticate,
  allowRoles(['TEAM']),
  upload.array('photos', 5),
  punchOut
);

router.post(
  '/holiday',
  authenticate,
  allowRoles(adminRoles),
  markHoliday
);

// ==================== GET ALL ATTENDANCE ====================
router.get(
  '/',
  authenticate,
  allowRoles(attendanceRoles),
  getAllAttendance
);

// ==================== GET ATTENDANCE STATS ====================
router.get(
  '/stats',
  authenticate,
  allowRoles(attendanceRoles),
  getAttendanceStats
);

// ==================== GET ATTENDANCE BY ID ====================
router.get(
  '/:id',
  authenticate,
  allowRoles(attendanceRoles),
  getAttendanceById
);

// ==================== UPDATE ATTENDANCE ====================
router.put(
  '/:id',
  authenticate,
  allowRoles(managerRoles),
  updateAttendance
);


// ==================== DELETE ATTENDANCE ====================
router.delete(
  '/:id',
  authenticate,
  allowRoles(adminRoles),
  deleteAttendance
);

export default router;
