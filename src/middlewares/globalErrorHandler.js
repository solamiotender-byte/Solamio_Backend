import logger from '../utils/logger.js';
import { AppError } from '../errors/customError.js';

// Higher-order function to handle async errors
export const handleAsyncError = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

const globalErrorHandler = (err, req, res, next) => {
    // Log error information
    logger.error({
        message: err.message,
        stack: err.stack,
        metadata: {
            ...err.metadata,
            path: req.path,
            method: req.method,
            ip: req.ip
        }
    });

    // Handle validation errors
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: 1,
            message: err.message,
            ...(process.env.NODE_ENV === 'dev' && { stack: err.stack }),
            ...(err.metadata && { metadata: err.metadata })
        });
    }

    // Handle unexpected errors
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        ...(process.env.NODE_ENV === 'dev' && { stack: err.stack })
    });
};

export default globalErrorHandler;