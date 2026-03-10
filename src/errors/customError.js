
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
    constructor(errors, message = 'Validation failed') {
        super(message, 400);
        this.metadata = { validationErrors: errors };
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