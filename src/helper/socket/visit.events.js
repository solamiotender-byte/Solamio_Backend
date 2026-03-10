// socket/events/visit.events.js
import { getIO } from "./index.js";

export const emitVisitCreated = (visit, user) => {
  const io = getIO();

  // Emit to the user who created the visit
  io.to(`user-${user._id}`).emit("visit-created", visit);

  // Emit to user's supervisor if exists
  if (user.supervisor) {
    io.to(`supervisor-${user.supervisor}`).emit("team-visit-created", {
      visit,
      teamMember: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email
      }
    });
  }

  // Emit to all managers (Head_office, ZSM, ASM)
  io.to("role-Head_office").emit("visit-created", visit);
  io.to("role-ZSM").emit("visit-created", visit);
  
  // Emit to specific ASM if they manage this user
  if (user.role === "TEAM" && user.supervisor) {
    io.to(`user-${user.supervisor}`).emit("team-visit-created", {
      visit,
      teamMember: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`
      }
    });
  }
};

export const emitVisitUpdated = (visit, user) => {
  const io = getIO();

  // Emit to the user who updated the visit
  io.to(`user-${user._id}`).emit("visit-updated", visit);

  // Emit to supervisors/managers
  if (user.supervisor) {
    io.to(`supervisor-${user.supervisor}`).emit("team-visit-updated", {
      visit,
      teamMember: user._id
    });
  }

  // Emit to all managers
  io.to("role-Head_office").emit("visit-updated", visit);
  io.to("role-ZSM").emit("visit-updated", visit);
};

export const emitVisitDeleted = (visitId, user) => {
  const io = getIO();

  // Emit to the user who deleted the visit
  io.to(`user-${user._id}`).emit("visit-deleted", visitId);

  // Emit to supervisors/managers
  if (user.supervisor) {
    io.to(`supervisor-${user.supervisor}`).emit("team-visit-deleted", {
      visitId,
      teamMember: user._id
    });
  }

  // Emit to all managers
  io.to("role-Head_office").emit("visit-deleted", visitId);
  io.to("role-ZSM").emit("visit-deleted", visitId);
};

export const emitVisitCompleted = (visit, user) => {
  const io = getIO();

  // Emit to the user who completed the visit
  io.to(`user-${user._id}`).emit("visit-completed", visit);

  // Emit to supervisors/managers
  if (user.supervisor) {
    io.to(`supervisor-${user.supervisor}`).emit("team-visit-completed", {
      visit,
      teamMember: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`
      }
    });
  }

  // Emit to all managers
  io.to("role-Head_office").emit("visit-completed", visit);
  io.to("role-ZSM").emit("visit-completed", visit);
};