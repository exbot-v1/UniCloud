/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Error Handling Infrastructure
 * Standardizes API error responses across all routes and services.
 */

import { Response } from 'express';
import { ErrorCode, ApiResponse } from '../../types/api';

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

export function formatErrorResponse(err: unknown): ApiResponse<never> {
  if (err instanceof AppError) {
    return {
      success: false,
      error: {
        code: err.errorCode,
        message: err.message,
        details: err.details,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0.0-phase0',
      },
    };
  }

  const message = err instanceof Error ? err.message : 'An unexpected error occurred';
  return {
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message,
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.0.0-phase0',
    },
  };
}

export function sendApiError(res: Response, err: unknown): void {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  res.status(statusCode).json(formatErrorResponse(err));
}
