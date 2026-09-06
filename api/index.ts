/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Vercel Serverless Function Entrypoint
 * 
 * Routes incoming /api/* serverless invocations into the Express application.
 * Preserves bounded-memory uploads, serverless-safe connection pooling,
 * and sanitized error boundaries.
 */

import type { Request, Response } from 'express';
import { app } from '../src/server/app.js';
import { UserService } from '../src/server/services/UserService.js';
import { validateSecurityConfiguration } from '../src/server/utils/config.js';
import { logger } from '../src/server/utils/logger.js';

let initialized = false;

function ensureServerlessInitialization(): void {
  if (initialized) return;
  initialized = true;

  try {
    validateSecurityConfiguration();
  } catch (err: any) {
    logger.warn('Serverless configuration diagnostic:', { message: err?.message });
  }

  // Ensure demo user is available in preview/serverless cold starts
  UserService.ensureDemoUser().catch((err: any) => {
    logger.debug('Serverless demo user initialization note:', { message: err?.message });
  });
}

/**
 * Standard Vercel Serverless Function Handler
 */
export default function handler(req: Request, res: Response) {
  ensureServerlessInitialization();
  return app(req, res);
}

export { app };
