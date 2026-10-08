import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { AppError, fail } from '../common/http';

export function notFound(_req: Request, res: Response) {
  return fail(res, 'Resource not found', 404);
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return fail(res, 'Validation failed', 422, error.flatten());
  }
  if (error instanceof AppError) {
    return fail(res, error.message, error.statusCode, error.details ?? null);
  }
  if (error instanceof mongoose.Error.CastError) {
    return fail(res, 'Invalid id', 400);
  }
  if (error instanceof mongoose.Error.ValidationError) {
    return fail(res, 'Validation failed', 422, error.errors);
  }
  const mongo = error as { code?: number };
  if (mongo.code === 11000) {
    return fail(res, 'A record with the same unique value already exists', 409);
  }

  console.error(error);
  return fail(res, 'Server error', 500, env.isProd ? null : error instanceof Error ? error.message : 'Unknown error');
}
