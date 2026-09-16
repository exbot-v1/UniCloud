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
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, '$1***$2')
    // Mask raw connection string parameters
    .replace(/(DATABASE_URL=)([^&\s]+)/gi, '$1***')
    // Mask bearer tokens
    .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]+/gi, '$1***')
    // Mask client secrets and tokens in key-value format
    .replace(/(client_secret|refresh_token|access_token|password|secret)=([^&\s]+)/gi, '$1=***')
    // Mask raw encryption keys or auth tags (64 hex characters)
    .replace(/\b[0-9a-fA-F]{64}\b/g, '[REDACTED_SECRET]');
}

export function extractStatusCode(err: unknown): number {
  if (err instanceof AppError && typeof err.statusCode === 'number') {
    return err.statusCode;
  }
  const anyErr = err as any;
  if (typeof anyErr?.statusCode === 'number' && anyErr.statusCode >= 400 && anyErr.statusCode < 600) {
    return anyErr.statusCode;
  }
  if (typeof anyErr?.status === 'number' && anyErr.status >= 400 && anyErr.status < 600) {
    return anyErr.status;
  }
  if (typeof anyErr?.response?.status === 'number' && anyErr.response.status >= 400 && anyErr.response.status < 600) {
    return anyErr.response.status;
  }
  return 500;
}

export function extractErrorCode(err: unknown, statusCode: number): ErrorCode | string {
  if (err instanceof AppError) {
    return err.errorCode;
  }
  const anyErr = err as any;
  if (typeof anyErr?.errorCode === 'string' && anyErr.errorCode) {
    return anyErr.errorCode;
  }
  if (typeof anyErr?.code === 'string' && anyErr.code in ErrorCode) {
    return anyErr.code;
  }

  // Derive by HTTP status
  switch (statusCode) {
    case 400:
      return ErrorCode.BAD_REQUEST;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.RESOURCE_NOT_FOUND;
    case 409:
      return ErrorCode.ALREADY_EXISTS;
    case 429:
      return ErrorCode.RATE_LIMITED;
    case 502:
      return ErrorCode.PROVIDER_ERROR;
    case 503:
      return ErrorCode.SERVICE_UNAVAILABLE;
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}

export function formatErrorResponse(err: unknown): ApiResponse<never> {
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  const statusCode = extractStatusCode(err);
  const errorCode = extractErrorCode(err, statusCode);

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

  const rawMessage = err instanceof Error ? err.message : String(err || 'An unexpected error occurred');
  // In production, suppress unhandled internal errors, stack traces, and database/code syntax errors
  const isInternalStackOrSyntax = /(?:syntax error|relation ".*" does not exist|column ".*" does not exist|pg_catalog|\bat\s+|:\d+:\d+|TypeError|ReferenceError)/i.test(rawMessage);
  const isInternalUnhandled = statusCode === 500 || isInternalStackOrSyntax;

  const finalErrorCode = (isProd && isInternalUnhandled) ? ErrorCode.INTERNAL_ERROR : errorCode;
  const safeMessage = (isProd && isInternalUnhandled)
    ? 'An internal server error occurred. Please try again later.'
    : sanitizeErrorMessage(rawMessage);

  return {
    success: false,
    error: {
      code: finalErrorCode,
      message: safeMessage,
      details: (err as any)?.details,
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.7.0-phase7',
    },
  };
}

export function sendApiError(res: Response, err: unknown): void {
  try {
    if (res.headersSent || (res as any).writableEnded || (res as any).ended) {
      return;
    }
    const statusCode = extractStatusCode(err);
    const errorResponse = formatErrorResponse(err);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(statusCode).json(errorResponse);
  } catch (sendErr) {
    try {
      if (!res.headersSent && !(res as any).writableEnded && !(res as any).ended) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.status(500).end(JSON.stringify({
          success: false,
          error: {
            code: ErrorCode.INTERNAL_ERROR,
            message: 'An unexpected internal error occurred.',
          },
          meta: {
            timestamp: new Date().toISOString(),
            version: '1.7.0-phase7',
          },
        }));
      }
    } catch {
      // Socket or stream already closed
    }
  }
}
