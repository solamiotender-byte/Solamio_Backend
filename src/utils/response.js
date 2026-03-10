export const sendResponse = (res, statusCode, message, result = {}) => {
    res.status(statusCode).json({
        success: statusCode < 400,          // true for 2xx and 3xx responses
        statusCode,
        message,
        result,
    });
};