/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Vercel Serverless Function Entrypoint
 * 
 * Routes incoming /api/* serverless invocations into the Express application.
 * Enforces fail-closed security validation, single-initialization per warm instance,
 * zero production demo authentication mutation, and bounded-memory streaming.
 */

import type { Request, Response } from 'express';
import { app } from '../src/server/app.js';
import { UserService } from '../src/server/services/UserService.js';
import { validateSecurityConfiguration } from '../src/server/utils/config.js';
import { sendApiError } from '../src/server/utils/errors.js';
import { logger } from '../src/server/utils/logger.js';

// Serverless warm instance state
let isInitialized = false;
let initPromise: Promise<void> | null = null;
let initError: Error | null = null;
let initExecutionCount = 0;

/**
 * Diagnostic access for regression tests to verify initialization lifecycle
 */
export function getServerlessInitStats() {
  return {
    isInitialized,
    initExecutionCount,
    hasError: initError !== null,
    error: initError,
  };
}

/**
 * Reset initialization state (used exclusively for regression test scenarios)
 */
export function resetServerlessInitStateForTesting(): void {
  isInitialized = false;
  initPromise = null;
  initError = null;
  initExecutionCount = 0;
}

/**
 * Initializes the serverless instance safely exactly once per warm instance.
 * Concurrency-safe: parallel cold-start requests share the same initialization promise.
 * Fail-closed: if security validation fails, initError is stored and re-thrown.
 */
export async function initializeServerlessInstance(): Promise<void> {
  // If already initialized safely on this warm instance, return immediately (exactly-once execution)
  if (isInitialized) {
    return;
  }

  // If a previous initialization failed closed, re-throw to block all traffic to this instance
  if (initError) {
    throw initError;
  }

  // Coalesce concurrent cold-start requests into a single execution
  if (!initPromise) {
    initPromise = (async () => {
      try {
        initExecutionCount++;

        // 1. Validate security configuration — MUST fail closed if invalid
        validateSecurityConfiguration();

        // 2. Demo user creation strictly disallowed in production
        const isProduction =
          process.env.NODE_ENV === 'production' ||
          process.env.VERCEL_ENV === 'production';

        if (!isProduction) {
          await UserService.ensureDemoUser().catch((err: any) => {
            logger.debug('Serverless demo user initialization note (non-production):', {
              message: err?.message,
            });
          });
        }

        isInitialized = true;
      } catch (err: any) {
        initError = err instanceof Error ? err : new Error(String(err));
        logger.error('CRITICAL: Serverless warm instance initialization failed closed', {
          error: initError.message,
        });
        throw initError;
      } finally {
        initPromise = null;
      }
    })();
  }

  return initPromise;
}

/**
 * Standard Vercel Serverless Function Handler
 */
export default async function handler(req: Request, res: Response) {
  try {
    await initializeServerlessInstance();
  } catch (err: any) {
    // Fail-closed security boundary: never continue to Express if security validation fails.
    // sendApiError sanitizes credentials, passwords, tokens, and suppresses production stack traces.
    sendApiError(res, err);
    return;
  }

  return app(req, res);
}

export { app };
