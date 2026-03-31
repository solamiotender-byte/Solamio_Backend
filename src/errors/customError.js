class AppError extends Error {
    constructor(message, statusCode, metadata = {}) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode || 500;
        this.metadata = metadata;
        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends AppError {
    constructor(message, statusCode = 400) {
        super(message, statusCode);
        this.name = "ValidationError";
    }
}

class NotFoundError extends AppError {
    constructor(resource, id) {
        super(`${resource} with id ${id} not found`, 404);
        this.metadata = { resource, id };
    }
}

class AuthorizationError extends AppError {
    constructor(message = 'Authentication failed') {
        super(message, 401);
    }
}

export {
    AppError,
    ValidationError,
    NotFoundError,
    AuthorizationError,
};