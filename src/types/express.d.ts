import type { AuthStaff } from '../common/http';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthStaff;
    }
  }
}

export {};
