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

export const emitLeadCreated = (lead, user) => {
  const io = getIO();

  if (lead.assignedUser) {
    io.to(`user-${lead.assignedUser}`).emit("lead-assigned", lead);
  }

  if (lead.assignedManager) {
    io.to(`user-${lead.assignedManager}`).emit("lead-assigned", lead);
  }

  io.to(`user-${user._id}`).emit("lead-created", lead);

  emitToScopedManagers("lead-created", lead, user).catch((error) => {
    console.error("Scoped lead-created emit failed:", error.message);
  });
};

export const emitLeadUpdated = (lead, user) => {
  const io = getIO();

  if (lead.assignedUser) {
    io.to(`user-${lead.assignedUser}`).emit("lead-updated", lead);
  }

  if (lead.assignedManager) {
    io.to(`user-${lead.assignedManager}`).emit("lead-updated", lead);
  }

  emitToScopedManagers("lead-updated", lead, user).catch((error) => {
    console.error("Scoped lead-updated emit failed:", error.message);
  });
};

export const emitLeadStatusChanged = (lead, oldStatus, newStatus, user) => {
  const io = getIO();

  const data = {
    lead,
    oldStatus,
    newStatus,
    updatedBy: {
      id: user._id,
      name: `${user.firstName} ${user.lastName}`,
      role: user.role,
    },
    timestamp: new Date().toISOString(),
  };

  if (lead.assignedUser) {
    io.to(`user-${lead.assignedUser}`).emit("lead-status-changed", data);
  }

  if (lead.assignedManager) {
    io.to(`user-${lead.assignedManager}`).emit("lead-status-changed", data);
  }

  emitToScopedManagers("lead-status-changed", data, user).catch((error) => {
    console.error("Scoped lead-status emit failed:", error.message);
  });
};
