/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Error Handling Infrastructure
 * Standardizes API error responses across all routes and services.
 */

import { Response } from 'express';
import { ErrorCode, ApiResponse } from '../../types/api.js';

export { ErrorCode };

export class AppError extends Error {
  public readonly errorCode: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    errorCode: ErrorCode,
    message: string,
    statusCode: number = 400,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

function sanitizeErrorMessage(msg: string): string {
  if (!msg) return msg;
  return msg
    // Mask postgres / database connection URLs with passwords
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, '$1***$2')
    // Mask bearer tokens
    .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]+/gi, '$1***')
    // Mask client secrets and tokens in key-value format
    .replace(/(client_secret|refresh_token|access_token|password|secret)=([^&\s]+)/gi, '$1=***')
    // Mask raw encryption keys or auth tags (64 hex characters)
    .replace(/\b[0-9a-fA-F]{64}\b/g, '[REDACTED_SECRET]');
}

export function formatErrorResponse(err: unknown): ApiResponse<never> {
  const isProd = process.env.NODE_ENV === 'production';

  if (err instanceof AppError) {
    return {
      success: false,
      error: {
        code: err.errorCode,
        message: sanitizeErrorMessage(err.message),
        details: err.details,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.7.0-phase7',
      },
    };
  }

  // Never expose internal unhandled errors, stack traces, or credentials in production
  const rawMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
  const safeMessage = isProd
    ? 'An internal server error occurred. Please try again later.'
    : sanitizeErrorMessage(rawMessage);

  return {
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: safeMessage,
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.7.0-phase7',
    },
  };
}

export function sendApiError(res: Response, err: unknown): void {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  res.status(statusCode).json(formatErrorResponse(err));
}
