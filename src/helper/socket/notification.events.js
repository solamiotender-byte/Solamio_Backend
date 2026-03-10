// socket/events/notification.events.js
import { getIO } from "./index.js";

export const emitNotification = (userId, notification) => {
  const io = getIO();
  io.to(`user-${userId}`).emit("notification", notification);
};

export const emitTeamNotification = (supervisorId, notification) => {
  const io = getIO();
  io.to(`supervisor-${supervisorId}`).emit("team-notification", notification);
};

export const emitRoleNotification = (role, notification) => {
  const io = getIO();
  io.to(`role-${role}`).emit("notification", notification);
};

export const emitBroadcast = (notification, excludeUsers = []) => {
  const io = getIO();
  
  // Broadcast to all except excluded users
  io.sockets.sockets.forEach((socket) => {
    if (!excludeUsers.includes(socket.user?.id)) {
      socket.emit("broadcast", notification);
    }
  });
};