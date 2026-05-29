import { getIO } from "./index.js";
import LocationPoint from "../../models/locationPoint.js";
import { calculateDistanceKm } from "../../utils/locationUtils.js";
import {
  getScopedManagerRoomNames,
} from "../../utils/headOfficeScope.js";

const activeSalesmen = new Map();

const emitToScopedManagers = (io, headOfficeId, eventName, payload) => {
  for (const room of getScopedManagerRoomNames(headOfficeId)) {
    io.to(room).emit(eventName, payload);
  }
};

export const registerLocationEvents = (socket) => {
  const io = getIO();

  socket.on("location:start", (data) => {
    if (socket.user.role !== "TEAM") return;

    activeSalesmen.set(socket.user.id, {
      lat: data.lat,
      lng: data.lng,
      speed: data.speed ?? 0,
      accuracy: data.accuracy ?? 0,
      recordedAt: new Date().toISOString(),
      socketId: socket.id,
      isPunchedIn: true,
      headOfficeId: socket.user.headOfficeId,
    });

    const payload = {
      userId: socket.user.id,
      lat: data.lat,
      lng: data.lng,
      timestamp: new Date().toISOString(),
    };

    emitToScopedManagers(
      io,
      socket.user.headOfficeId,
      "location:user_online",
      payload
    );

    if (socket.user.supervisor) {
      io.to(`supervisor-${socket.user.supervisor}`).emit(
        "location:user_online",
        payload
      );
    }
  });

  socket.on("location:update", async (data) => {
    try {
      const { lat, lng } = data;

      if (
        lat == null ||
        lng == null ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        socket.emit("location:error", { message: "Invalid coordinates" });
        return;
      }

      if (socket.user.role !== "TEAM") return;

      const now = new Date();
      const today = now.toISOString().split("T")[0];
      const userId = socket.user.id;

      const lastPoint = await LocationPoint.findOne(
        { salesmanId: userId, date: today },
        { recordedAt: 1, lat: 1, lng: 1 },
        { sort: { recordedAt: -1 } }
      );

      if (lastPoint) {
        const secondsSinceLast = (now - lastPoint.recordedAt) / 1000;
        if (secondsSinceLast < 8) {
          socket.emit("location:ack", {
            saved: false,
            skipped: true,
            reason: `too_soon (${secondsSinceLast.toFixed(0)}s since last)`,
            timestamp: now.toISOString(),
          });
          return;
        }
      }

      let distanceFromPrevious = 0;
      if (lastPoint) {
        const dist = calculateDistanceKm(lastPoint.lat, lastPoint.lng, lat, lng);
        if (dist > 5 || dist < 0.005) {
          distanceFromPrevious = 0;
        } else {
          distanceFromPrevious = dist;
        }
      }

      await LocationPoint.create({
        salesmanId: userId,
        date: today,
        lat,
        lng,
        speed: data.speed ?? 0,
        accuracy: data.accuracy ?? 0,
        recordedAt: data.time ? new Date(data.time) : now,
        distanceFromPrevious,
      });

      const prev = activeSalesmen.get(userId);
      let distanceSinceLast = 0;
      if (prev) {
        distanceSinceLast = calculateDistanceKm(prev.lat, prev.lng, lat, lng);
      }

      activeSalesmen.set(userId, {
        lat,
        lng,
        speed: data.speed ?? 0,
        accuracy: data.accuracy ?? 0,
        recordedAt: now.toISOString(),
        socketId: socket.id,
        isPunchedIn: true,
        headOfficeId: socket.user.headOfficeId,
      });

      const payload = {
        userId,
        lat,
        lng,
        speed: data.speed ?? 0,
        accuracy: data.accuracy ?? 0,
        distanceSinceLast,
        timestamp: now.toISOString(),
      };

      emitToScopedManagers(
        io,
        socket.user.headOfficeId,
        "location:live_update",
        payload
      );

      if (socket.user.supervisor) {
        io.to(`supervisor-${socket.user.supervisor}`).emit(
          "location:live_update",
          payload
        );
      }

      socket.emit("location:ack", {
        saved: true,
        skipped: false,
        timestamp: now.toISOString(),
      });
    } catch (error) {
      console.error(
        `[location:update] Error for user ${socket.user.id}:`,
        error.message
      );
      socket.emit("location:error", { message: "Failed to save location point" });
    }
  });

  socket.on("location:bulk_sync", async (data) => {
    try {
      const { points } = data;

      if (!Array.isArray(points) || points.length === 0) {
        socket.emit("location:error", {
          message: "points must be a non-empty array",
        });
        return;
      }

      const userId = socket.user.id;

      const sorted = [...points]
        .filter((p) => p.lat != null && p.lng != null)
        .sort((a, b) => (a.time ? new Date(a.time) : 0) - (b.time ? new Date(b.time) : 0));

      if (sorted.length === 0) {
        socket.emit("location:error", { message: "No valid points to sync" });
        return;
      }

      const lastSaved = await LocationPoint.findOne(
        { salesmanId: userId },
        { lat: 1, lng: 1 },
        { sort: { recordedAt: -1 } }
      );

      let prevLat = lastSaved?.lat ?? null;
      let prevLng = lastSaved?.lng ?? null;

      const docs = sorted.map((p) => {
        const recordedAt = p.time ? new Date(p.time) : new Date();
        let distanceFromPrevious = 0;

        if (prevLat !== null) {
          const dist = calculateDistanceKm(prevLat, prevLng, p.lat, p.lng);
          distanceFromPrevious = dist > 5 || dist < 0.005 ? 0 : dist;
        }

        prevLat = p.lat;
        prevLng = p.lng;

        return {
          salesmanId: userId,
          date: recordedAt.toISOString().split("T")[0],
          lat: p.lat,
          lng: p.lng,
          speed: p.speed ?? 0,
          accuracy: p.accuracy ?? 0,
          recordedAt,
          distanceFromPrevious,
        };
      });

      await LocationPoint.insertMany(docs, { ordered: false });

      socket.emit("location:bulk_ack", {
        saved: docs.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(
        `[location:bulk_sync] Error for user ${socket.user.id}:`,
        error.message
      );
      socket.emit("location:error", { message: "Bulk sync failed" });
    }
  });

  socket.on("location:get_active_users", () => {
    if (!["Head_office", "ZSM", "ASM"].includes(socket.user.role)) {
      socket.emit("location:error", { message: "Not authorized" });
      return;
    }

    const activeList = [];
    activeSalesmen.forEach((value, userId) => {
      if (value.headOfficeId === socket.user.headOfficeId) {
        activeList.push({ userId, ...value });
      }
    });

    socket.emit("location:active_users", { users: activeList });
  });

  socket.on("location:watch_user", (data) => {
    if (!["Head_office", "ZSM", "ASM"].includes(socket.user.role)) {
      socket.emit("location:error", { message: "Not authorized" });
      return;
    }

    const { userId } = data;
    const latest = activeSalesmen.get(userId);

    if (latest?.headOfficeId !== socket.user.headOfficeId) {
      socket.emit("location:error", { message: "Not authorized" });
      return;
    }

    socket.join(`watching-${userId}`);

    if (latest) {
      socket.emit("location:live_update", { userId, ...latest });
    }
  });

  socket.on("location:stop", () => {
    const userId = socket.user.id;
    activeSalesmen.delete(userId);

    const payload = {
      userId,
      timestamp: new Date().toISOString(),
    };

    emitToScopedManagers(
      io,
      socket.user.headOfficeId,
      "location:user_offline",
      payload
    );

    if (socket.user.supervisor) {
      io.to(`supervisor-${socket.user.supervisor}`).emit(
        "location:user_offline",
        payload
      );
    }
  });

  socket.on("disconnect", () => {
    const userId = socket.user.id;
    const entry = activeSalesmen.get(userId);

    if (entry?.socketId === socket.id) {
      activeSalesmen.delete(userId);

      const payload = {
        userId,
        timestamp: new Date().toISOString(),
      };

      emitToScopedManagers(
        io,
        socket.user.headOfficeId,
        "location:user_offline",
        payload
      );

      if (socket.user.supervisor) {
        io.to(`supervisor-${socket.user.supervisor}`).emit(
          "location:user_offline",
          payload
        );
      }
    }
  });
};

export const broadcastLocationUpdate = () => {};
