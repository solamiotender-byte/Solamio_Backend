// socket/index.js
import { Server } from "socket.io";
import jwt        from "jsonwebtoken";
import { registerLocationEvents } from "./location.events.js"; // ✅ ADD THIS

let io = null;

export const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin:         process.env.CLIENT_URL || "https://solar-frontend-lake.vercel.app",
      methods:        ["GET", "POST", "PUT", "DELETE"],
      credentials:    true,
      allowedHeaders: ["Authorization", "Content-Type"],
    },
    pingTimeout:  60000,
    pingInterval: 25000,
    transports:   ["websocket", "polling"],
  });

  // ── Auth middleware ──────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.split(" ")[1];

      if (!token) return next(new Error("Authentication required"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = {
        id:         decoded._id,   // ✅ FIX: your JWT signs _id not id
        role:       decoded.role,
        supervisor: decoded.supervisor ?? null,
      };

      next();
    } catch (error) {
      console.error("Socket authentication error:", error);
      next(new Error("Invalid token"));
    }
  });

  // ── Connection handler ───────────────────────────────────────────────────────
  io.on("connection", (socket) => {
    //console.log(`User connected: ${socket.user.id} (${socket.user.role})`);

    // Join personal + role rooms
    socket.join(`user-${socket.user.id}`);
    socket.join(`role-${socket.user.role}`);

    if (socket.user.supervisor) {
      socket.join(`supervisor-${socket.user.supervisor}`);
    }

    // Managers can join a team room
    socket.on("join-team-room", (teamId) => {
      if (["Head_office", "ZSM", "ASM"].includes(socket.user.role)) {
        socket.join(`team-${teamId}`);
      }
    });

    // ✅ Register all location events from dedicated file
    registerLocationEvents(socket);

    // Typing indicators
    socket.on("typing", (data) => {
      socket.to(`user-${data.to}`).emit("user-typing", {
        from:     socket.user.id,
        isTyping: data.isTyping,
      });
    });

    // Disconnect — location cleanup is handled inside registerLocationEvents
    socket.on("disconnect", (reason) => {
      //console.log(`User disconnected: ${socket.user.id} - Reason: ${reason}`);
    });

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