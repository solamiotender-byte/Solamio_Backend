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

export const emitVisitCreated = (visit, user) => {
  const io = getIO();

  io.to(`user-${user._id}`).emit("visit-created", visit);

  if (user.supervisor) {
    io.to(`supervisor-${user.supervisor}`).emit("team-visit-created", {
      visit,
      teamMember: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
      },
    });
  }

  emitToScopedManagers("visit-created", visit, user).catch((error) => {
    console.error("Scoped visit-created emit failed:", error.message);
  });

  if (user.role === "TEAM" && user.supervisor) {
    io.to(`user-${user.supervisor}`).emit("team-visit-created", {
      visit,
      teamMember: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`,
      },
    });
  }
};

export const emitVisitUpdated = (visit, user) => {
  const io = getIO();

  io.to(`user-${user._id}`).emit("visit-updated", visit);

  if (user.supervisor) {
    io.to(`supervisor-${user.supervisor}`).emit("team-visit-updated", {
      visit,
      teamMember: user._id,
    });
  }

  emitToScopedManagers("visit-updated", visit, user).catch((error) => {
    console.error("Scoped visit-updated emit failed:", error.message);
  });
};

export const emitVisitDeleted = (visitId, user) => {
  const io = getIO();

  io.to(`user-${user._id}`).emit("visit-deleted", visitId);

  if (user.supervisor) {
    io.to(`supervisor-${user.supervisor}`).emit("team-visit-deleted", {
      visitId,
      teamMember: user._id,
    });
  }

  emitToScopedManagers("visit-deleted", visitId, user).catch((error) => {
    console.error("Scoped visit-deleted emit failed:", error.message);
  });
};

export const emitVisitCompleted = (visit, user) => {
  const io = getIO();

  io.to(`user-${user._id}`).emit("visit-completed", visit);

  if (user.supervisor) {
    io.to(`supervisor-${user.supervisor}`).emit("team-visit-completed", {
      visit,
      teamMember: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`,
      },
    });
  }

  emitToScopedManagers("visit-completed", visit, user).catch((error) => {
    console.error("Scoped visit-completed emit failed:", error.message);
  });
};
