import logger from '../utils/logger.js';
import { AppError } from '../errors/customError.js';

export const handleAsyncError = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

const globalErrorHandler = (err, req, res, next) => {
    // ✅ Fix: log as string + metadata object separately
    logger.error(`${req.method} ${req.path} — ${err.message}`, {
        stack: err.stack,
        metadata: {
            ...err.metadata,
            path: req.path,
            method: req.method,
            ip: req.ip,
        }
    });

    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,  // ✅ Fix: was success: 1
            message: err.message,
            ...(process.env.NODE_ENV === 'dev' && { stack: err.stack }),
            ...(err.metadata && { metadata: err.metadata })
        });
    }

    res.status(500).json({
        success: false,
        message: 'Internal server error',
        ...(process.env.NODE_ENV === 'dev' && { stack: err.stack })
    });
};

export default globalErrorHandler;