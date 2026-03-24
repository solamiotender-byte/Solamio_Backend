import jwt from 'jsonwebtoken';
import { AuthorizationError } from '../errors/customError.js';
import User from '../models/user.model.js';


/**
 * Middleware to verify JWT token and attach user to request
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers?.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next(new AuthorizationError("Authorization token not provided", 401));
    }

    const token = authHeader.split(" ")[1];

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded._id).select('+supervisor');

    if (!user) {
      return next(new AuthorizationError("User associated with token not found", 401));
    }

    req.token = token;
    req.user = user;
    next();

  } catch (error) {
    console.error("Token verification error:", error.message);
    return next(new AuthorizationError("Token invalid or expired", 401));
  }
};



/**
 * Role-based access middleware
 * @param {Array<string>} allowedRoles - Roles allowed to access the route
 */
export const allowRoles = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      throw new AuthorizationError('Access denied: insufficient permissions');
    }
    next();
  };
};
