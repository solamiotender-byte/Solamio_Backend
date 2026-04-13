import { getIO } from "./index.js";
import {
  getHeadOfficeIdForUser,
  getScopedManagerRoomNames,
} from "../../utils/headOfficeScope.js";

const emitToScopedManagers = async (eventName, payload, user) => {
  const io = getIO();
  const headOfficeId = await getHeadOfficeIdForUser(user);

  for (const room of getScopedManagerRoomNames(headOfficeId)) {
    io.to(room).emit(eventName, payload);
  }
};

export const emitPunchIn = (attendance, user) => {
  const io = getIO();

  io.to(`user-${user._id}`).emit("punched-in", attendance);

  if (user.supervisor) {
    io.to(`supervisor-${user.supervisor}`).emit("team-member-punched-in", {
      attendance,
      teamMember: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`,
        time: attendance.punchIn.time,
      },
    });
  }

  emitToScopedManagers(
    "user-punched-in",
    {
      userId: user._id,
      userName: `${user.firstName} ${user.lastName}`,
      time: attendance.punchIn.time,
    },
    user
  ).catch((error) => {
    console.error("Scoped punch-in emit failed:", error.message);
  });
};

export const emitPunchOut = (attendance, user) => {
  const io = getIO();

  io.to(`user-${user._id}`).emit("punched-out", attendance);

  if (user.supervisor) {
    io.to(`supervisor-${user.supervisor}`).emit("team-member-punched-out", {
      attendance,
      teamMember: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`,
        totalHours: attendance.totalHours,
      },
    });
  }

  emitToScopedManagers(
    "user-punched-out",
    {
      userId: user._id,
      userName: `${user.firstName} ${user.lastName}`,
      totalHours: attendance.totalHours,
    },
    user
  ).catch((error) => {
    console.error("Scoped punch-out emit failed:", error.message);
  });
};
