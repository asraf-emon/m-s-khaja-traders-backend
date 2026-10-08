import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { Permission } from '../config/shop';

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

export type AuthStaff = {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'STAFF';
  permissions: string[];
};

export function ok<T>(res: Response, data: T, message = 'OK', status = 200) {
  return res.status(status).json({ success: true, message, data });
}

export function fail(res: Response, message: string, status = 400, error?: unknown) {
  return res.status(status).json({
    success: false,
    message,
    error: error ?? null,
  });
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function hasPermission(auth: AuthStaff | undefined, permission: Permission) {
  if (!auth) return false;
  return auth.role === 'ADMIN' || auth.permissions.includes(permission);
}

export function bdtToPaisa(amount: number) {
  if (!Number.isFinite(amount)) throw new AppError('Invalid amount', 422);
  return Math.round(amount * 100);
}

export function paisaToBdt(paisa: number) {
  return Math.round(paisa) / 100;
}

export function roundQty(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** Integer poisha multiplied by a quantity, rounded to the nearest poisha. */
export function moneyTimesQty(paisa: number, qty: number) {
  return Math.round(paisa * qty);
}

export function weightedAverage(oldQty: number, oldPaisa: number, addQty: number, addPaisa: number) {
  const totalQty = oldQty + addQty;
  if (totalQty <= 0) return addPaisa;
  return Math.round((oldQty * oldPaisa + addQty * addPaisa) / totalQty);
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function dhakaDayRange(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return {
    start: new Date(`${parts}T00:00:00.000+06:00`),
    end: new Date(`${parts}T23:59:59.999+06:00`),
  };
}

export function parseDateRange(from?: string, to?: string) {
  const end = to ? new Date(`${to}T23:59:59.999+06:00`) : new Date();
  const start = from ? new Date(`${from}T00:00:00.000+06:00`) : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError('Invalid date range', 422);
  }
  return { start, end };
}

export function dateBounds(from?: string, to?: string) {
  if (!from && !to) return null;
  const start = from ? new Date(`${from}T00:00:00.000+06:00`) : undefined;
  const end = to ? new Date(`${to}T23:59:59.999+06:00`) : undefined;
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) {
    throw new AppError('Invalid date range', 422);
  }
  const range: { $gte?: Date; $lte?: Date } = {};
  if (start) range.$gte = start;
  if (end) range.$lte = end;
  return range;
}

export function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError;
}

export function idOf(value: { _id: { toString(): string } } | string) {
  return typeof value === 'string' ? value : value._id.toString();
}
