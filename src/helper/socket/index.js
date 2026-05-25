import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "../../models/user.model.js";
import { registerLocationEvents } from "./location.events.js";
import {
  getHeadOfficeIdForUser,
  getScopedRoleRoomName,
} from "../../utils/headOfficeScope.js";

let io = null;

export const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        callback(null, true);
      },
      methods: ["GET", "POST", "PUT", "DELETE"],
      credentials: true,
      allowedHeaders: ["Authorization", "Content-Type"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ["websocket", "polling"],
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.split(" ")[1];

      if (!token) return next(new Error("Authentication required"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const dbUser = await User.findById(decoded._id).select(
        "_id role supervisor email firstName lastName headOffice"
      );

      if (!dbUser) return next(new Error("User not found"));

      const headOfficeId = await getHeadOfficeIdForUser(dbUser);

      socket.user = {
        id: dbUser._id.toString(),
        role: dbUser.role,
        supervisor: dbUser.supervisor ?? null,
        headOfficeId,
        email: dbUser.email,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
      };

      next();
    } catch (error) {
      console.error("Socket authentication error:", error);
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user-${socket.user.id}`);
    socket.join(`role-${socket.user.role}`);

    if (socket.user.headOfficeId) {
      socket.join(`headOffice-${socket.user.headOfficeId}`);
      const scopedRoleRoom = getScopedRoleRoomName(
        socket.user.headOfficeId,
        socket.user.role
      );
      if (scopedRoleRoom) {
        socket.join(scopedRoleRoom);
      }
    }

    if (socket.user.supervisor) {
      socket.join(`supervisor-${socket.user.supervisor}`);
    }

    socket.on("join-team-room", (teamId) => {
      if (["Head_office", "ZSM", "ASM"].includes(socket.user.role)) {
        socket.join(`team-${teamId}`);
      }
    });

    registerLocationEvents(socket);

    socket.on("typing", (data) => {
      socket.to(`user-${data.to}`).emit("user-typing", {
        from: socket.user.id,
        isTyping: data.isTyping,
      });
    });

    socket.on("disconnect", () => {});

    socket.on("error", (error) => {
      console.error(`Socket error for user ${socket.user.id}:`, error);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized");
  return io;
};
