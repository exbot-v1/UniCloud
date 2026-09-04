/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud API Types & Standard Response Contracts
 */

export enum ErrorCode {
  // Authentication & Authorization
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  ACCOUNT_NOT_CONNECTED = 'ACCOUNT_NOT_CONNECTED',

  // Validation & Input
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  NOT_FOUND = 'NOT_FOUND',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',

  // Provider & Storage
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  INSUFFICIENT_POOL_STORAGE = 'INSUFFICIENT_POOL_STORAGE',
  RATE_LIMITED = 'RATE_LIMITED',
  OAUTH_ERROR = 'OAUTH_ERROR',
  INVALID_STATE = 'INVALID_STATE',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',

  // Upload & File System
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  UPLOAD_INTERRUPTED = 'UPLOAD_INTERRUPTED',
  INVALID_FILE_TYPE = 'INVALID_FILE_TYPE',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',

  // Internal & Infrastructure
  DATABASE_ERROR = 'DATABASE_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
}

export interface ApiErrorDetail {
  code: ErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
  field?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiErrorDetail;
  meta?: {
    timestamp: string;
    requestId?: string;
    version: string;
    page?: number;
    pageSize?: number;
    totalCount?: number;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
