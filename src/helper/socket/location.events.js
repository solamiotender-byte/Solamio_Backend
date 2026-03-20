// socket/location.events.js
import { getIO }         from "./index.js";
import LocationPoint     from "../../models/locationPoint.js";
import { calculateDistanceKm } from "../../utils/locationUtils.js";

// ─── In-memory store ──────────────────────────────────────────────────────────
// Tracks the latest known position of every active salesman.
// Shape: { [userId]: { lat, lng, speed, accuracy, recordedAt, socketId } }
const activeSalesmen = new Map();

// ─── Register all location events on a socket ─────────────────────────────────
export const registerLocationEvents = (socket) => {
  const io = getIO();

  // ── 1. Salesman starts tracking (punch in) ──────────────────────────────────
  socket.on("location:start", (data) => {
    if (socket.user.role !== "TEAM") return;

    activeSalesmen.set(socket.user.id, {
      lat:        data.lat,
      lng:        data.lng,
      speed:      data.speed      ?? 0,
      accuracy:   data.accuracy   ?? 0,
      recordedAt: new Date().toISOString(),
      socketId:   socket.id,
      isPunchedIn: true,
    });

    // Tell all admins/supervisors this user just went live
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

    //console.log(`[location:start] User ${socket.user.id} started tracking`);
  });

  // ── 2. Live GPS update (fires every N seconds from device) ──────────────────
  socket.on("location:update", async (data) => {
    try {
      // Basic validation — reject garbage coordinates
      const { lat, lng } = data;
      if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        socket.emit("location:error", { message: "Invalid coordinates" });
        return;
      }

      if (socket.user.role !== "TEAM") return;

      const now     = new Date();
      const today   = now.toISOString().split("T")[0];
      const userId  = socket.user.id;

      // ── Persist to DB ──────────────────────────────────────────────────────
      await LocationPoint.create({
        salesmanId: userId,
        date:       today,
        lat,
        lng,
        speed:      data.speed    ?? 0,
        accuracy:   data.accuracy ?? 0,
        recordedAt: data.time ? new Date(data.time) : now,
      });

      // ── Update in-memory latest position ───────────────────────────────────
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

      // ── Broadcast live position to admins ──────────────────────────────────
      const payload = {
        userId,
        lat,
        lng,
        speed:            data.speed    ?? 0,
        accuracy:         data.accuracy ?? 0,
        distanceSinceLast,
        timestamp:        now.toISOString(),
      };

      // Head office sees everyone
      io.to("role-Head_office").emit("location:live_update", payload);

      // Supervisor sees their own team member
      if (socket.user.supervisor) {
        io.to(`supervisor-${socket.user.supervisor}`).emit("location:live_update", payload);
      }

      // ZSM and ASM roles also get updates
      io.to("role-ZSM").emit("location:live_update", payload);
      io.to("role-ASM").emit("location:live_update", payload);

      // Acknowledge back to the device so it knows the point was saved
      socket.emit("location:ack", { saved: true, timestamp: now.toISOString() });

    } catch (error) {
      console.error(`[location:update] Error for user ${socket.user.id}:`, error.message);
      socket.emit("location:error", { message: "Failed to save location point" });
    }
  });

  // ── 3. Bulk sync (offline points queued on device) ──────────────────────────
  socket.on("location:bulk_sync", async (data) => {
    try {
      const { points } = data;

      if (!Array.isArray(points) || points.length === 0) {
        socket.emit("location:error", { message: "points must be a non-empty array" });
        return;
      }

      const today  = new Date().toISOString().split("T")[0];
      const userId = socket.user.id;

      const docs = points
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({
          salesmanId: userId,
          date:       p.time ? new Date(p.time).toISOString().split("T")[0] : today,
          lat:        p.lat,
          lng:        p.lng,
          speed:      p.speed    ?? 0,
          accuracy:   p.accuracy ?? 0,
          recordedAt: p.time ? new Date(p.time) : new Date(),
        }));

      if (docs.length === 0) {
        socket.emit("location:error", { message: "No valid points to sync" });
        return;
      }

      await LocationPoint.insertMany(docs, { ordered: false });

      socket.emit("location:bulk_ack", {
        saved:     docs.length,
        timestamp: new Date().toISOString(),
      });

      //console.log(`[location:bulk_sync] Saved ${docs.length} points for user ${userId}`);

    } catch (error) {
      console.error(`[location:bulk_sync] Error for user ${socket.user.id}:`, error.message);
      socket.emit("location:error", { message: "Bulk sync failed" });
    }
  });

  // ── 4. Admin requests live snapshot of all active salesmen ──────────────────
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
    //console.log(`[location:watch_user] Admin ${socket.user.id} watching user ${userId}`);

    // Send the latest known position immediately
    const latest = activeSalesmen.get(userId);
    if (latest) {
      socket.emit("location:live_update", { userId, ...latest });
    }
  });

  // ── 6. Salesman stops tracking (punch out) ──────────────────────────────────
  socket.on("location:stop", () => {
    const userId = socket.user.id;
    activeSalesmen.delete(userId);

    // Tell admins this user went offline
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

    //console.log(`[location:stop] User ${userId} stopped tracking`);
  });

  // ── 7. Clean up on disconnect ────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const userId = socket.user.id;

    // Only remove if this socket is still the active one
    const entry = activeSalesmen.get(userId);
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

// ─── Helper: broadcast a location update from REST controller ─────────────────
// Call this from your HTTP /track controller if you want REST + socket together
export const broadcastLocationUpdate = (userId, supervisorId, payload) => {
  try {
    const io = getIO();
    io.to("role-Head_office").emit("location:live_update", { userId, ...payload });
    io.to("role-ZSM").emit("location:live_update", { userId, ...payload });
    io.to("role-ASM").emit("location:live_update", { userId, ...payload });
    if (supervisorId) {
      io.to(`supervisor-${supervisorId}`).emit("location:live_update", { userId, ...payload });
    }
  } catch {
    // Socket not initialized yet — safe to ignore during startup
  }
};