/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Core Express Application Setup
 * 
 * Configures middleware, security boundaries, selective body parsers,
 * and API routing. Compatible with both standard Node.js servers (Cloud Run,
 * Docker, local dev) and serverless function runtimes (Vercel Functions).
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { apiRouter } from './api/routes.js';
import { sendApiError } from './utils/errors.js';
import { ErrorCode } from '../types/api.js';

/**
 * Predicate to identify binary and streaming upload routes that must NOT
 * be parsed by express.json() to prevent body buffering, stream consumption,
 * or JSON parse errors on binary slices.
 */
export function isUploadPayloadRoute(path: string): boolean {
  return path.includes('/upload/') && (path.endsWith('/chunk') || path.endsWith('/stream'));
}

/**
 * Creates and configures a clean Express application instance.
 */
export function createApp(): Express {
  const app = express();

  // Trust reverse proxies, Cloud Run, and Vercel edge routers
  app.set('trust proxy', 1);

  // Security headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  // Cookie parser for session management
  app.use(cookieParser());

  // Selective body parsing:
  // Upload chunk and stream routes bypass express.json() so raw binary chunks
  // can be parsed by express.raw() or streamed directly via req with bounded memory.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const checkPath = req.path || req.url || '';
    if (isUploadPayloadRoute(checkPath)) {
      return next();
    }
    express.json({ limit: '10mb' })(req, res, next);
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const checkPath = req.path || req.url || '';
    if (isUploadPayloadRoute(checkPath)) {
      return next();
    }
    express.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
  });

  // Mount API router under /api
  app.use('/api', apiRouter);

  // Fallback: In some serverless rewrites or proxies, the /api prefix might be stripped.
  // This ensures routes like /health or /spec/status still resolve to apiRouter.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.url.startsWith('/api')) {
      return next();
    }
    return apiRouter(req, res, next);
  });

  // Dedicated 404 handler for API routes to avoid returning HTML from SPA fallback
  app.all('/api/*', (req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: ErrorCode.NOT_FOUND,
        message: `API endpoint not found: ${req.method} ${req.path}`,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.7.0-phase7',
      },
    });
  });

  // Centralized API error handling
  app.use('/api', (err: any, _req: Request, res: Response, _next: NextFunction) => {
    sendApiError(res, err);
  });

  return app;
}

export const app: Express = createApp();
export default app;
