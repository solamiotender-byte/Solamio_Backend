// services/user.service.js
import User from "../models/user.model.js";
import {
  AppError,
  NotFoundError,
  ValidationError,
} from "../errors/customError.js";

const handleError = (error, defaultMessage) => {
  if (error instanceof AppError) throw error;
  throw new AppError(error.message || defaultMessage, 500);
};

/* ============================
  Create User with improved validation
============================ */
export const createUserService = async (data, createdById) => {
  try {
    const { email, phoneNumber, role, supervisor } = data;

    // Validate creator
    const createdBy = await User.findById(createdById);
    if (!createdBy) throw new NotFoundError("Creator", createdById);

    // Role-based permission check
    const allowedRoles = {
      Head_office: ["Head_office", "ZSM", "ASM", "TEAM"],
      ZSM: ["ASM", "TEAM"],
      ASM: ["TEAM"],
    };

    if (createdBy.role === "Head_office") {
      if (role === "Head_office" && createdBy.role !== "Head_office") {
        throw new AppError("Only Head Office can create Head Office users", 403);
      }
    } else if (allowedRoles[createdBy.role]) {
      if (!allowedRoles[createdBy.role].includes(role)) {
        throw new AppError(
          `You can only create users with roles: ${allowedRoles[createdBy.role].join(", ")}`,
          403
        );
      }
    } else {
      throw new AppError("You don't have permission to create users", 403);
    }

    // Check if email or phone already exists
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phoneNumber }],
    });
    if (existingUser) {
      throw new ValidationError(
        existingUser.email === email.toLowerCase()
          ? "Email already exists"
          : "Phone number already exists",
        400
      );
    }

    // Validate supervisor if provided
    if (supervisor) {
      const supervisorUser = await User.findById(supervisor);
      if (!supervisorUser) throw new NotFoundError("Supervisor", supervisor);

      const validSupervisorRoles = ["ZSM", "ASM", "Head_office"];
      if (!validSupervisorRoles.includes(supervisorUser.role)) {
        throw new ValidationError("Supervisor must be ZSM, ASM, or Head_office", 400);
      }
    }

    // Create new user
    const newUser = new User({
      ...data,
      email: email.toLowerCase(),
      supervisor: supervisor || (createdBy.role === "ASM" ? createdBy._id : null),
      createdBy: createdBy._id,
      viewPassword: data.password,
      status: data.status || "active",
    });

    await newUser.save();

    const userObj = newUser.toObject({ getters: true, virtuals: true });
    delete userObj.viewPassword;
    delete userObj.password;
    // ✅ createdAt is included via timestamps:true

    return userObj;
  } catch (error) {
    handleError(error, "Failed to create user");
  }
};

/* ============================
  Get Users with filters
============================ */
export const getUsersService = async (query, currentUser) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      role,
      status,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = query;

    /* =================================================
       🔒 TEAM → ONLY SELF (HARD OVERRIDE)
    ================================================= */
    if (currentUser.role === "TEAM") {
      // ✅ Using select("-password -viewPassword") keeps createdAt (it's not excluded)
      const user = await User.findById(currentUser._id)
        .select("-password -viewPassword")
        .populate("supervisor", "firstName lastName role email")
        .populate("createdBy", "firstName lastName role");

      return {
        users: user ? [user] : [],
        pagination: {
          total: user ? 1 : 0,
          page: 1,
          limit: 1,
          totalPages: user ? 1 : 0,
        },
        filters: {},
      };
    }

    /* =================================================
       PAGINATION
    ================================================= */
    const skip = (Number(page) - 1) * Number(limit);
    const filter = {};
    const andConditions = [];

    if (search) {
      andConditions.push({
        $or: [
          { firstName: { $regex: search, $options: "i" } },
          { lastName:  { $regex: search, $options: "i" } },
          { email:     { $regex: search, $options: "i" } },
          { phoneNumber: { $regex: search, $options: "i" } },
        ],
      });
    }

    if (role && role !== "all")     andConditions.push({ role });
    if (status && status !== "all") andConditions.push({ status });

    if (currentUser.role === "ZSM") {
      andConditions.push({ role: { $ne: "Head_office" } });
    }

    if (currentUser.role === "ASM") {
      andConditions.push({ supervisor: currentUser._id, role: "TEAM" });
    }

    if (andConditions.length > 0) filter.$and = andConditions;

    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    // ✅ "-password -viewPassword" keeps createdAt in results
    const users = await User.find(filter)
      .select("-password -viewPassword")
      .populate("supervisor", "firstName lastName role email")
      .populate("createdBy", "firstName lastName role")
      .skip(skip)
      .limit(Number(limit))
      .sort(sort);

    const total = await User.countDocuments(filter);

    return {
      users,
      pagination: {
        total,
        page:       Number(page),
        limit:      Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
      filters: { search, role, status },
    };
  } catch (error) {
    throw error;
  }
};

/* ============================
  Get User Profile
============================ */
export const getUserProfileService = async (userId, currentUser) => {
  try {
    // ✅ "-password -viewPassword" keeps createdAt
    const user = await User.findById(userId)
      .select("-password -viewPassword")
      .populate("supervisor", "firstName lastName role email")
      .populate("createdBy", "firstName lastName role");

    if (!user) throw new NotFoundError("User", userId);

    if (
      currentUser.role === "ASM" &&
      user.supervisor?.toString() !== currentUser._id.toString()
    ) {
      throw new AppError("You can only view profiles of users under your supervision", 403);
    } else if (currentUser.role === "ZSM") {
      const asmUsers = await User.find({
        supervisor: currentUser._id,
        role: "ASM",
      }).select("_id");
      const asmIds = asmUsers.map((u) => u._id);

      if (
        ![currentUser._id.toString(), ...asmIds.map((id) => id.toString())].includes(
          user.supervisor?.toString()
        )
      ) {
        throw new AppError("You can only view profiles of users under your zone", 403);
      }
    } else if (
      !["Head_office", "ZSM", "ASM"].includes(currentUser.role) &&
      user._id.toString() !== currentUser._id.toString()
    ) {
      throw new AppError("You can only view your own profile", 403);
    }

    return user;
  } catch (error) {
    handleError(error, "Failed to get profile");
  }
};

/* ============================
   Update User
============================ */
export const updateUserService = async (userId, data) => {
  try {
    const user = await User.findById(userId);
    if (!user) throw new NotFoundError("User", userId);

    const allowedFields = ["firstName", "lastName", "email", "phone", "role", "status"];

    Object.keys(data).forEach((key) => {
      if (!allowedFields.includes(key)) delete data[key];
    });

    Object.keys(data).forEach((key) => {
      if (data[key] !== undefined) user[key] = data[key];
    });

    await user.save();

    const updatedUser = user.toObject({ getters: true });
    delete updatedUser.password;
    delete updatedUser.viewPassword;
    // ✅ createdAt preserved via toObject()

    return updatedUser;
  } catch (error) {
    handleError(error, "Failed to update user");
  }
};

/* ============================
  Toggle User Status
============================ */
export const toggleUserStatusService = async (userId, currentUser) => {
  try {
    const user = await User.findById(userId);
    if (!user) throw new NotFoundError("User", userId);

    if (user._id.toString() === currentUser._id.toString()) {
      throw new AppError("You cannot change your own status", 400);
    }

    if (currentUser.role === "ASM") {
      if (user.supervisor?.toString() !== currentUser._id.toString()) {
        throw new AppError("You can only toggle status of users under your supervision", 403);
      }
    } else if (currentUser.role === "ZSM") {
      const asmUsers = await User.find({
        supervisor: currentUser._id,
        role: "ASM",
      }).select("_id");
      const asmIds = asmUsers.map((u) => u._id);

      if (!asmIds.map((id) => id.toString()).includes(user.supervisor?.toString())) {
        throw new AppError("You can only toggle status of users in your zone", 403);
      }
    } else if (currentUser.role !== "Head_office") {
      throw new AppError("You don't have permission to toggle user status", 403);
    }

    if (
      user.role === "Head_office" &&
      currentUser._id.toString() !== user._id.toString()
    ) {
      throw new AppError("Cannot change status of Head Office users", 403);
    }

    user.status = user.status === "active" ? "inactive" : "active";
    await user.save();

    return {
      userId:    user._id,
      newStatus: user.status,
      message:   `User ${user.status === "active" ? "activated" : "deactivated"} successfully`,
    };
  } catch (error) {
    handleError(error, "Failed to toggle user status");
  }
};

/* ============================
  Get View Password (Admin only)
============================ */
export const getViewPasswordService = async (userId, currentUser) => {
  try {
    if (currentUser.role !== "Head_office") {
      throw new AppError("Only Head Office can view passwords", 403);
    }

    const user = await User.findById(userId);
    if (!user) throw new NotFoundError("User", userId);

    if (!user.viewPassword) {
      throw new AppError("Password not available for viewing", 404);
    }

    return {
      userId:      user._id,
      email:       user.email,
      viewPassword: user.viewPassword,
      expiresAt:   new Date(Date.now() + 5 * 60000),
    };
  } catch (error) {
    handleError(error, "Failed to retrieve password");
  }
};

/* ============================
  Delete User
============================ */
export const deleteUserService = async (userId, currentUser) => {
  try {
    const user = await User.findById(userId);
    if (!user) throw new NotFoundError("User", userId);

    if (user._id.toString() === currentUser._id.toString()) {
      throw new AppError("You cannot delete your own account", 400);
    }

    if (user.role === "Head_office" && currentUser.role !== "Head_office") {
      throw new AppError("Only Head Office can delete Head Office users", 403);
    }

    const hasSubordinates = await User.exists({ supervisor: userId });
    if (hasSubordinates) {
      throw new AppError(
        "Cannot delete user with active subordinates. Reassign them first.",
        400
      );
    }

    await user.deleteOne();

    return {
      message: "User deleted successfully",
      deletedUser: { id: user._id, email: user.email, role: user.role },
    };
  } catch (error) {
    handleError(error, "Failed to delete user");
  }
};

/* ============================
  Assign User to Manager
============================ */
export const assignUserToManagerService = async (userId, managerId, currentUser) => {
  try {
    if (!["Head_office", "ZSM"].includes(currentUser.role)) {
      throw new AppError("Only Head Office or ZSM can assign users", 403);
    }

    const user    = await User.findById(userId);
    if (!user) throw new NotFoundError("User", userId);

    const manager = await User.findById(managerId);
    if (!manager) throw new NotFoundError("Manager", managerId);

    if (!["ZSM", "ASM"].includes(manager.role)) {
      throw new ValidationError("Selected user must be ZSM or ASM", 400);
    }

    if (
      currentUser.role === "ZSM" &&
      manager.role === "ZSM" &&
      manager._id.toString() !== currentUser._id.toString()
    ) {
      throw new AppError("ZSM can only assign to themselves or their ASMs", 403);
    }

    user.supervisor = manager._id;
    await user.save();

    return {
      message: "User assigned to manager successfully",
      user: {
        id:   user._id,
        name: `${user.firstName} ${user.lastName}`,
        role: user.role,
      },
      manager: {
        id:   manager._id,
        name: `${manager.firstName} ${manager.lastName}`,
        role: manager.role,
      },
    };
  } catch (error) {
    handleError(error, "Failed to assign user to manager");
  }
};

/* ==========================================
   Get TEAM List
========================================== */
export const getTeamUnderAsmList = async (query, userId) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = query;

    const skip = (page - 1) * limit;

    // ✅ Find requesting user's role
    const requestingUser = await User.findById(userId).select("role");
    if (!requestingUser) throw new AppError("User not found", 404);

    // ✅ Build role-based filter
    let filter = { role: "TEAM" };

    if (requestingUser.role === "ASM") {
      // ASM sees only users they created OR supervise
      filter.$or = [
        { createdBy: userId },
        { supervisor: userId },
      ];
    } else if (requestingUser.role === "ZSM") {
      // ZSM sees team under their ASMs + direct team
      const asmList = await User.find({
        $or: [{ createdBy: userId }, { supervisor: userId }],
        role: "ASM",
      }).select("_id");

      const asmIds = asmList.map((a) => a._id);

      filter.$or = [
        { createdBy: userId },
        { supervisor: userId },
        { createdBy: { $in: asmIds } },
        { supervisor: { $in: asmIds } },
      ];
    }
    // Head_office → no extra filter, sees all TEAM users

    // ✅ Search — merge safely with existing $or
    if (search) {
      const searchCond = [
        { firstName: new RegExp(search, "i") },
        { lastName:  new RegExp(search, "i") },
        { email:     new RegExp(search, "i") },
        { phoneNumber: new RegExp(search, "i") },
      ];

      if (filter.$or) {
        filter = {
          role: "TEAM",
          $and: [
            { $or: filter.$or },
            { $or: searchCond },
          ],
        };
      } else {
        filter.$or = searchCond;
      }
    }

    if (status) filter.status = status;

    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const users = await User.find(filter)
      .select("-password -viewPassword")
      .populate("supervisor", "firstName lastName role email")
      .populate("createdBy", "firstName lastName role")
      .skip(skip)
      .limit(Number(limit))
      .sort(sort);

    const total = await User.countDocuments(filter);

    return {
      users,
      pagination: {
        total,
        page:       Number(page),
        limit:      Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    handleError(error, "Failed to fetch TEAM list");
  }
};

/* ============================
  Get Manager List
============================ */
export const getManagerList = async (query) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
      search = "",
      status,
    } = query;

    const skip = (page - 1) * limit;
    let filter = { role: "ASM" };

    if (search) {
      filter.$or = [
        { firstName: new RegExp(search, "i") },
        { lastName:  new RegExp(search, "i") },
        { email:     new RegExp(search, "i") },
        { phone:     new RegExp(search, "i") },
      ];
    }

    if (status) filter.status = status;

    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    // ✅ createdAt included — only password & viewPassword excluded
    const users = await User.find(filter)
      .select("-password -viewPassword")
      .populate("supervisor", "firstName lastName role email")
      .populate("createdBy", "firstName lastName role")
      .skip(skip)
      .limit(Number(limit))
      .sort(sort);

    const total = await User.countDocuments(filter);
  if (requestingUser?.role === "ZSM") {
      filter.$or = [
        { createdBy: currentUserId },
        { supervisor: currentUserId }
      ];
    }
    return {
      users,
      pagination: {
        total,
        page:       Number(page),
        limit:      Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    handleError(error, "Failed to fetch manager list");
  }
};