// socket/location.events.js
import { getIO }                    from "./index.js";
import LocationPoint                from "../../models/locationPoint.js";
import { calculateDistanceKm }      from "../../utils/locationUtils.js";

// ── In-memory store ───────────────────────────────────────────────────────────
// { [userId]: { lat, lng, speed, accuracy, recordedAt, socketId, isPunchedIn } }
const activeSalesmen = new Map();

// ── Register all location events on a socket ──────────────────────────────────
export const registerLocationEvents = (socket) => {
  const io = getIO();

  // ── 1. Salesman punches in ──────────────────────────────────────────────────
  socket.on("location:start", (data) => {
    if (socket.user.role !== "TEAM") return;

    activeSalesmen.set(socket.user.id, {
      lat:         data.lat,
      lng:         data.lng,
      speed:       data.speed    ?? 0,
      accuracy:    data.accuracy ?? 0,
      recordedAt:  new Date().toISOString(),
      socketId:    socket.id,
      isPunchedIn: true,
    });

    io.to("role-Head_office").emit("location:user_online", {
      userId:    socket.user.id,
      lat:       data.lat,
      lng:       data.lng,
      timestamp: new Date().toISOString(),
    });

    if (socket.user.supervisor) {
      io.to(`supervisor-${socket.user.supervisor}`).emit("location:user_online", {
        userId:    socket.user.id,
        lat:       data.lat,
        lng:       data.lng,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── 2. Live GPS update ──────────────────────────────────────────────────────
  socket.on("location:update", async (data) => {
    try {
      const { lat, lng } = data;

      // Validate coordinates
      if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        socket.emit("location:error", { message: "Invalid coordinates" });
        return;
      }

      if (socket.user.role !== "TEAM") return;

      const now    = new Date();
      const today  = now.toISOString().split("T")[0];
      const userId = socket.user.id;

      // ── Server-side throttle: reject if last point < 25s ago ───────────────
      // This protects the DB even if the client sends faster than expected.
      const lastPoint = await LocationPoint.findOne(
        { salesmanId: userId, date: today },
        { recordedAt: 1, lat: 1, lng: 1 },
        { sort: { recordedAt: -1 } }
      );

      if (lastPoint) {
        const secondsSinceLast = (now - lastPoint.recordedAt) / 1000;
        if (secondsSinceLast < 25) {
          // Too soon — ack without saving so client knows we got it
          socket.emit("location:ack", {
            saved:     false,
            skipped:   true,
            reason:    `too_soon (${secondsSinceLast.toFixed(0)}s since last)`,
            timestamp: now.toISOString(),
          });
          return;
        }
      }

      // ── Calculate distance from previous point ──────────────────────────────
      let distanceFromPrevious = 0;
      if (lastPoint) {
        const dist = calculateDistanceKm(lastPoint.lat, lastPoint.lng, lat, lng);
        if (dist > 5) {
          distanceFromPrevious = 0; // impossible jump — ignore
        } else if (dist < 0.005) {
          distanceFromPrevious = 0; // < 5m movement — ignore
        } else {
          distanceFromPrevious = dist;
        }
      }

      // ── Save to DB ──────────────────────────────────────────────────────────
      await LocationPoint.create({
        salesmanId:          userId,
        date:                today,
        lat,
        lng,
        speed:               data.speed    ?? 0,
        accuracy:            data.accuracy ?? 0,
        recordedAt:          data.time ? new Date(data.time) : now,
        distanceFromPrevious,
        expiresAt:           new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });

      // ── Update in-memory position ───────────────────────────────────────────
      const prev = activeSalesmen.get(userId);
      let distanceSinceLast = 0;
      if (prev) {
        distanceSinceLast = calculateDistanceKm(prev.lat, prev.lng, lat, lng);
      }

      activeSalesmen.set(userId, {
        lat,
        lng,
        speed:       data.speed    ?? 0,
        accuracy:    data.accuracy ?? 0,
        recordedAt:  now.toISOString(),
        socketId:    socket.id,
        isPunchedIn: true,
      });

      // ── Broadcast live position to admins ───────────────────────────────────
      const payload = {
        userId,
        lat,
        lng,
        speed:            data.speed    ?? 0,
        accuracy:         data.accuracy ?? 0,
        distanceSinceLast,
        timestamp:        now.toISOString(),
      };

      io.to("role-Head_office").emit("location:live_update", payload);
      io.to("role-ZSM").emit("location:live_update", payload);
      io.to("role-ASM").emit("location:live_update", payload);

      if (socket.user.supervisor) {
        io.to(`supervisor-${socket.user.supervisor}`).emit("location:live_update", payload);
      }

      // Ack back to device
      socket.emit("location:ack", {
        saved:     true,
        skipped:   false,
        timestamp: now.toISOString(),
      });

    } catch (error) {
      console.error(`[location:update] Error for user ${socket.user.id}:`, error.message);
      socket.emit("location:error", { message: "Failed to save location point" });
    }
  });

  // ── 3. Bulk sync (offline points) ──────────────────────────────────────────
  socket.on("location:bulk_sync", async (data) => {
    try {
      const { points } = data;

      if (!Array.isArray(points) || points.length === 0) {
        socket.emit("location:error", { message: "points must be a non-empty array" });
        return;
      }

      const today  = new Date().toISOString().split("T")[0];
      const userId = socket.user.id;

      // Sort ascending so distance chain is correct
      const sorted = [...points]
        .filter((p) => p.lat != null && p.lng != null)
        .sort((a, b) => (a.time ? new Date(a.time) : 0) - (b.time ? new Date(b.time) : 0));

      if (sorted.length === 0) {
        socket.emit("location:error", { message: "No valid points to sync" });
        return;
      }

      // Chain distance from last saved point
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
          salesmanId:          userId,
          date:                recordedAt.toISOString().split("T")[0],
          lat:                 p.lat,
          lng:                 p.lng,
          speed:               p.speed    ?? 0,
          accuracy:            p.accuracy ?? 0,
          recordedAt,
          distanceFromPrevious,
          expiresAt:           new Date(recordedAt.getTime() + 24 * 60 * 60 * 1000),
        };
      });

      await LocationPoint.insertMany(docs, { ordered: false });

      socket.emit("location:bulk_ack", {
        saved:     docs.length,
        timestamp: new Date().toISOString(),
      });

    } catch (error) {
      console.error(`[location:bulk_sync] Error for user ${socket.user.id}:`, error.message);
      socket.emit("location:error", { message: "Bulk sync failed" });
    }
  });

  // ── 4. Admin requests snapshot of all active salesmen ──────────────────────
  socket.on("location:get_active_users", () => {
    if (!["Head_office", "ZSM", "ASM"].includes(socket.user.role)) {
      socket.emit("location:error", { message: "Not authorized" });
      return;
    }

    const activeList = [];
    activeSalesmen.forEach((value, userId) => {
      activeList.push({ userId, ...value });
    });

    socket.emit("location:active_users", { users: activeList });
  });

  // ── 5. Admin watches a specific salesman ────────────────────────────────────
  socket.on("location:watch_user", (data) => {
    if (!["Head_office", "ZSM", "ASM"].includes(socket.user.role)) {
      socket.emit("location:error", { message: "Not authorized" });
      return;
    }

    const { userId } = data;
    socket.join(`watching-${userId}`);

    const latest = activeSalesmen.get(userId);
    if (latest) {
      socket.emit("location:live_update", { userId, ...latest });
    }
  });

  // ── 6. Salesman punches out ─────────────────────────────────────────────────
  socket.on("location:stop", () => {
    const userId = socket.user.id;
    activeSalesmen.delete(userId);

    io.to("role-Head_office").emit("location:user_offline", {
      userId,
      timestamp: new Date().toISOString(),
    });

    if (socket.user.supervisor) {
      io.to(`supervisor-${socket.user.supervisor}`).emit("location:user_offline", {
        userId,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── 7. Clean up on disconnect ───────────────────────────────────────────────
  socket.on("disconnect", () => {
    const userId = socket.user.id;
    const entry  = activeSalesmen.get(userId);

    if (entry?.socketId === socket.id) {
      activeSalesmen.delete(userId);

      io.to("role-Head_office").emit("location:user_offline", {
        userId,
        timestamp: new Date().toISOString(),
      });

      if (socket.user.supervisor) {
        io.to(`supervisor-${socket.user.supervisor}`).emit("location:user_offline", {
          userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  });
};

// ── Helper: broadcast from REST controller ────────────────────────────────────
export const broadcastLocationUpdate = (userId, supervisorId, payload) => {
  try {
    const io = getIO();
    io.to("role-Head_office").emit("location:live_update", { userId, ...payload });
    io.to("role-ZSM").emit("location:live_update",         { userId, ...payload });
    io.to("role-ASM").emit("location:live_update",         { userId, ...payload });
    if (supervisorId) {
      io.to(`supervisor-${supervisorId}`).emit("location:live_update", { userId, ...payload });
    }
  } catch {
    // Socket not initialized yet — safe to ignore
  }
};