import mongoose from "mongoose";
import User from "../models/user.model.js";
import { AppError } from "../errors/customError.js";

const toIdString = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (value._id) return toIdString(value._id);
  if (value.id) return toIdString(value.id);
  return String(value);
};

const resolveHeadOfficeFromMap = (userId, usersMap, cache = new Map(), stack = new Set()) => {
  const normalizedId = toIdString(userId);
  if (!normalizedId) return null;
  if (cache.has(normalizedId)) return cache.get(normalizedId);
  if (stack.has(normalizedId)) return null;

  const user = usersMap.get(normalizedId);
  if (!user) return null;

  if (user.headOffice) {
    const resolved = toIdString(user.headOffice);
    cache.set(normalizedId, resolved);
    return resolved;
  }

  if (user.role === "Head_office") {
    cache.set(normalizedId, normalizedId);
    return normalizedId;
  }

  stack.add(normalizedId);

  const resolved =
    resolveHeadOfficeFromMap(user.supervisor, usersMap, cache, stack) ||
    resolveHeadOfficeFromMap(user.createdBy, usersMap, cache, stack) ||
    null;

  stack.delete(normalizedId);
  cache.set(normalizedId, resolved);
  return resolved;
};

export const getUsersScopeSnapshot = async () => {
  const users = await User.find({})
    .select("_id role supervisor createdBy headOffice status")
    .lean();

  const usersMap = new Map(users.map((user) => [toIdString(user._id), user]));
  const cache = new Map();

  for (const user of users) {
    resolveHeadOfficeFromMap(user._id, usersMap, cache);
  }

  return { users, usersMap, cache };
};

export const getHeadOfficeIdForUser = async (userOrId, snapshot = null) => {
  if (!userOrId) return null;

  const normalizedId = toIdString(userOrId);
  const directHeadOffice = toIdString(userOrId.headOffice);
  const directRole = userOrId.role;

  if (directHeadOffice) return directHeadOffice;
  if (directRole === "Head_office" && normalizedId) return normalizedId;

  const scopeSnapshot = snapshot || (await getUsersScopeSnapshot());
  const resolved = resolveHeadOfficeFromMap(
    normalizedId,
    scopeSnapshot.usersMap,
    scopeSnapshot.cache
  );

  return resolved;
};

export const getHeadOfficeScopedUserIds = async (userOrId, options = {}) => {
  const { roles = null, includeInactive = true } = options;
  const snapshot = await getUsersScopeSnapshot();
  const headOfficeId = await getHeadOfficeIdForUser(userOrId, snapshot);

  if (!headOfficeId) return [];

  return snapshot.users
    .filter((user) => {
      const userHeadOfficeId = resolveHeadOfficeFromMap(
        user._id,
        snapshot.usersMap,
        snapshot.cache
      );

      if (userHeadOfficeId !== headOfficeId) return false;
      if (roles && !roles.includes(user.role)) return false;
      if (!includeInactive && user.status === "inactive") return false;
      return true;
    })
    .map((user) => user._id);
};

export const assertSameHeadOffice = async (currentUser, targetUser) => {
  const [currentHeadOfficeId, targetHeadOfficeId] = await Promise.all([
    getHeadOfficeIdForUser(currentUser),
    getHeadOfficeIdForUser(targetUser),
  ]);

  if (!currentHeadOfficeId || !targetHeadOfficeId || currentHeadOfficeId !== targetHeadOfficeId) {
    throw new AppError("You can only access data from your own Head Office", 403);
  }

  return currentHeadOfficeId;
};

export const getScopedManagerRoomNames = (headOfficeId) => {
  if (!headOfficeId) return [];

  return [
    `headOffice-${headOfficeId}-role-Head_office`,
    `headOffice-${headOfficeId}-role-ZSM`,
    `headOffice-${headOfficeId}-role-ASM`,
  ];
};

export const getScopedRoleRoomName = (headOfficeId, role) => {
  if (!headOfficeId || !role) return null;
  return `headOffice-${headOfficeId}-role-${role}`;
};

