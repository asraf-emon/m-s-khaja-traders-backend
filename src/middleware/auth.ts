import type { NextFunction, Request, Response } from 'express';
import type { Permission } from '../config/shop';
import { AppError, asyncHandler, hasPermission } from '../common/http';
import { getFirebase, resolveStaff } from '../services/platform';

export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AppError('Authentication required', 401);

  const firebase = getFirebase();
  if (!firebase) throw new AppError('Firebase Admin is not configured', 503);

  try {
    const decoded = await firebase.auth().verifyIdToken(header.slice(7));
    req.auth = await resolveStaff(decoded);
    next();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Authentication failed', 401);
  }
});

export function requireRole(role: 'ADMIN' | 'STAFF') {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.auth?.role !== role) {
      return next(new AppError('Only an admin can do this', 403));
    }
    return next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!hasPermission(req.auth, permission)) {
      return next(new AppError('You do not have permission for this action', 403));
    }
    return next();
  };
}
