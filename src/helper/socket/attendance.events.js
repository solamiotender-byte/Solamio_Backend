// socket/events/attendance.events.js
import { getIO } from "./index.js";

export const emitPunchIn = (attendance, user) => {
  const io = getIO();

  // Emit to the user
  io.to(`user-${user._id}`).emit("punched-in", attendance);

  // Emit to supervisor
  if (user.supervisor) {
    io.to(`supervisor-${user.supervisor}`).emit("team-member-punched-in", {
      attendance,
      teamMember: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`,
        time: attendance.punchIn.time
      }
    });
  }

  // Emit to managers
  io.to("role-Head_office").emit("user-punched-in", {
    userId: user._id,
    userName: `${user.firstName} ${user.lastName}`,
    time: attendance.punchIn.time
  });
};

export const emitPunchOut = (attendance, user) => {
  const io = getIO();

  // Emit to the user
  io.to(`user-${user._id}`).emit("punched-out", attendance);

  // Emit to supervisor
  if (user.supervisor) {
    io.to(`supervisor-${user.supervisor}`).emit("team-member-punched-out", {
      attendance,
      teamMember: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`,
        totalHours: attendance.totalHours
      }
    });
  }

  // Emit to managers
  io.to("role-Head_office").emit("user-punched-out", {
    userId: user._id,
    userName: `${user.firstName} ${user.lastName}`,
    totalHours: attendance.totalHours
  });
};