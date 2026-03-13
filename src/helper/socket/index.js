// socket/index.js
import { Server } from "socket.io";
import jwt from "jsonwebtoken";

let io = null;

export const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:5000",
      methods: ["GET", "POST", "PUT", "DELETE"],
      credentials: true,
      allowedHeaders: ["Authorization", "Content-Type"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || 
                    socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error("Authentication required"));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Attach user data to socket
      socket.user = {
        id: decoded.id,
        role: decoded.role,
        email: decoded.email
      };

      next();
    } catch (error) {
      console.error("Socket authentication error:", error);
      next(new Error("Invalid token"));
    }
  });

  // Connection handler
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.user.id} (${socket.user.role})`);

    // Join user-specific room
    socket.join(`user-${socket.user.id}`);
    
    // Join role-specific room
    socket.join(`role-${socket.user.role}`);

    // If user has supervisor, join supervisor room
    if (socket.user.supervisor) {
      socket.join(`supervisor-${socket.user.supervisor}`);
    }

    // Handle joining team room (for managers)
    socket.on("join-team-room", (teamId) => {
      if (["Head_office", "ZSM", "ASM"].includes(socket.user.role)) {
        socket.join(`team-${teamId}`);
        console.log(`User ${socket.user.id} joined team room: team-${teamId}`);
      }
    });

    // Handle location updates
    socket.on("location-update", (data) => {
      // Broadcast to supervisor if user is TEAM
      if (socket.user.role === "TEAM" && socket.user.supervisor) {
        io.to(`supervisor-${socket.user.supervisor}`).emit("team-location-update", {
          userId: socket.user.id,
          location: data,
          timestamp: new Date().toISOString()
        });
      }
      
      // Broadcast to all managers in Head_office
      io.to("role-Head_office").emit("user-location-update", {
        userId: socket.user.id,
        location: data,
        timestamp: new Date().toISOString()
      });
    });

    // Handle typing indicators
    socket.on("typing", (data) => {
      socket.to(`user-${data.to}`).emit("user-typing", {
        from: socket.user.id,
        isTyping: data.isTyping
      });
    });

    // Handle disconnection
    socket.on("disconnect", (reason) => {
      console.log(`User disconnected: ${socket.user.id} - Reason: ${reason}`);
      
      // Leave all rooms
      socket.leave(`user-${socket.user.id}`);
      socket.leave(`role-${socket.user.role}`);
      if (socket.user.supervisor) {
        socket.leave(`supervisor-${socket.user.supervisor}`);
      }
    });

    // Handle errors
    socket.on("error", (error) => {
      console.error(`Socket error for user ${socket.user.id}:`, error);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized");
  }
  return io;
};