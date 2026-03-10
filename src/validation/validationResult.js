import { validationResult } from 'express-validator';
import { AppError } from '../errors/customError.js';

export const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const extractedErrors = errors.array().map(err => err.msg);
    throw new AppError(extractedErrors.join(', '), 400);
  }
  next();
};
