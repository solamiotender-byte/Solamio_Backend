// socket/events/lead.events.js
import { getIO } from "./index.js";

export const emitLeadCreated = (lead, user) => {
  const io = getIO();

  // Emit to assigned user
  if (lead.assignedUser) {
    io.to(`user-${lead.assignedUser}`).emit("lead-assigned", lead);
  }

  // Emit to assigned manager
  if (lead.assignedManager) {
    io.to(`user-${lead.assignedManager}`).emit("lead-assigned", lead);
  }

  // Emit to creator
  io.to(`user-${user._id}`).emit("lead-created", lead);

  // Emit to managers
  io.to("role-Head_office").emit("lead-created", lead);
  io.to("role-ZSM").emit("lead-created", lead);
  io.to("role-ASM").emit("lead-created", lead);
};

export const emitLeadUpdated = (lead, user) => {
  const io = getIO();

  // Emit to assigned user
  if (lead.assignedUser) {
    io.to(`user-${lead.assignedUser}`).emit("lead-updated", lead);
  }

  // Emit to assigned manager
  if (lead.assignedManager) {
    io.to(`user-${lead.assignedManager}`).emit("lead-updated", lead);
  }

  // Emit to managers
  io.to("role-Head_office").emit("lead-updated", lead);
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
      role: user.role
    },
    timestamp: new Date().toISOString()
  };

  // Emit to assigned user
  if (lead.assignedUser) {
    io.to(`user-${lead.assignedUser}`).emit("lead-status-changed", data);
  }

  // Emit to assigned manager
  if (lead.assignedManager) {
    io.to(`user-${lead.assignedManager}`).emit("lead-status-changed", data);
  }

  // Emit to managers
  io.to("role-Head_office").emit("lead-status-changed", data);
};