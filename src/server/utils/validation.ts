/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Input Validation Utilities
 */

import { AppError } from './errors.js';
import { ErrorCode } from '../../types/api.js';

export function validateRequiredString(value: unknown, fieldName: string, minLength = 1, maxLength = 255): string {
  if (typeof value !== 'string' || value.trim().length < minLength) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Field '${fieldName}' is required and must have at least ${minLength} characters.`
    );
  }
  if (value.length > maxLength) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Field '${fieldName}' exceeds maximum allowed length of ${maxLength} characters.`
    );
  }
  return value.trim();
}

export function validatePositiveInteger(value: unknown, fieldName: string): number {
  const parsed = Number(value);
  if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Field '${fieldName}' must be a non-negative integer.`
    );
  }
  return parsed;
}

export function validateUuid(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `Field '${fieldName}' must be a valid UUID.`);
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value.trim())) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `Field '${fieldName}' is not a valid UUID format.`);
  }
  return value.trim();
}
