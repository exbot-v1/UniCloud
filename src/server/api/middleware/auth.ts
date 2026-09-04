/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Authentication Middleware
 * 
 * Extracts and validates session tokens from HTTP-only cookies or Authorization headers.
 * Attaches validated UserPublicProfile to request context.
 */

import { Request, Response, NextFunction } from 'express';
import { UserService, UserPublicProfile } from '../../services/UserService.js';
import { sendApiError, AppError, ErrorCode } from '../../utils/errors.js';

export const SESSION_COOKIE_NAME = 'unicloud_session';

// Extend Express Request interface to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: UserPublicProfile;
    }
  }
}

/**
 * Cookie configuration helper
 */
export function getSessionCookieOptions(req?: Request) {
  // If running on HTTPS (or Cloud Run / forwarded proxy), enable secure and sameSite: 'none' for iframes
  const isSecure = process.env.NODE_ENV === 'production' ||
                   Boolean(process.env.APP_URL?.startsWith('https')) ||
                   Boolean(req?.secure) ||
                   req?.get('x-forwarded-proto') === 'https';

  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: (isSecure ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  };
}

/**
 * Extract session token from cookie, Authorization header, or query param
 */
export function extractSessionToken(req: Request): string | null {
  if (req.cookies && req.cookies[SESSION_COOKIE_NAME]) {
    return req.cookies[SESSION_COOKIE_NAME];
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  if (typeof req.query?.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }

  return null;
}

/**
 * Required authentication middleware
 * Rejects with 401 if unauthenticated
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractSessionToken(req);
    if (!token) {
      sendApiError(
        res,
        new AppError(
          ErrorCode.UNAUTHORIZED,
          'Authentication required. Please log in to access this resource.',
          401
        )
      );
      return;
    }

    const user = await UserService.validateSession(token);
    if (!user) {
      // Clear invalid cookie
      res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions(req));
      sendApiError(
        res,
        new AppError(
          ErrorCode.UNAUTHORIZED,
          'Session expired or invalid. Please log in again.',
          401
        )
      );
      return;
    }

    // Attach authenticated user identity
    req.user = user;
    next();
  } catch (err) {
    sendApiError(res, err);
  }
}

/**
 * Optional authentication middleware
 * Attaches user if valid session exists, but doesn't block if missing
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractSessionToken(req);
    if (token) {
      const user = await UserService.validateSession(token);
      if (user) {
        req.user = user;
      }
    }
    next();
  } catch {
    // Continue unauthenticated on error
    next();
  }
}
