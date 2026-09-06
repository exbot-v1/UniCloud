/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Security & Configuration Validator
 * 
 * Enforces production secrets, verifies encryption keys, and prevents
 * silent hardcoded fallbacks in production environments.
 */

import { AppError } from './errors.js';
import { ErrorCode } from '../../types/api.js';
import { logger } from './logger.js';
import { getEncryptionKey } from './encryption.js';
import { getHmacSecret } from '../services/OAuthStateService.js';
import { validateDatabaseUrl } from '../../db/client.js';

export interface SecurityConfigStatus {
  isProduction: boolean;
  isVercel: boolean;
  databaseConfigured: boolean;
  databaseValid: boolean;
  encryptionValid: boolean;
  authSecretValid: boolean;
  googleOAuthConfigured: boolean;
  warnings?: string[];
}

/**
 * Validates critical security configuration at server startup or request time.
 * Throws AppError(ErrorCode.CONFIGURATION_ERROR) immediately if production
 * secrets are missing or invalid in strict production mode.
 */
export function validateSecurityConfiguration(): SecurityConfigStatus {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  const isVercel = Boolean(process.env.VERCEL);
  const warnings: string[] = [];

  // 1. Verify 256-bit encryption key
  let encryptionValid = false;
  try {
    const keyBuf = getEncryptionKey();
    if (keyBuf.length === 32) {
      encryptionValid = true;
    } else if (isProduction) {
      throw new AppError(
        ErrorCode.CONFIGURATION_ERROR,
        'Production security requirement: ENCRYPTION_KEY must decode to exactly 32 bytes (256 bits).',
        500
      );
    }
  } catch (err: any) {
    if (isProduction) {
      logger.error('CRITICAL: Production encryption key validation failed');
      throw err;
    } else {
      warnings.push('Encryption key not configured; using development fallback key.');
    }
  }

  // 2. Verify HMAC / Session secret
  let authSecretValid = false;
  try {
    const secret = getHmacSecret();
    if (secret && secret.length >= 16) {
      authSecretValid = true;
    } else if (isProduction) {
      throw new AppError(
        ErrorCode.CONFIGURATION_ERROR,
        'Production security requirement: AUTH_SECRET or SESSION_SECRET must be at least 16 characters in production.',
        500
      );
    }
  } catch (err: any) {
    if (isProduction) {
      logger.error('CRITICAL: Production auth secret validation failed');
      throw err;
    } else {
      warnings.push('Auth secret not configured; using development fallback secret.');
    }
  }

  // 3. Verify Database URL (PostgreSQL / Supabase) — MUST fail closed in production
  const dbStatus = validateDatabaseUrl();
  const databaseConfigured = dbStatus.valid;

  if (isProduction || (isVercel && process.env.VERCEL_ENV !== 'development')) {
    if (!dbStatus.valid) {
      logger.error('CRITICAL: Production database configuration validation failed closed', {
        reason: dbStatus.reason,
      });
      throw new AppError(
        ErrorCode.CONFIGURATION_ERROR,
        `Production security requirement: ${dbStatus.reason}`,
        500
      );
    }
  } else {
    if (!dbStatus.valid) {
      warnings.push(`Database not configured or invalid (${dbStatus.reason}); using development in-memory database fallback.`);
    }
  }

  // 4. Verify Google OAuth credentials consistency
  const hasClientId = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID.trim().length > 0);
  const hasClientSecret = Boolean(process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CLIENT_SECRET.trim().length > 0);
  const googleOAuthConfigured = hasClientId && hasClientSecret;

  if ((hasClientId && !hasClientSecret) || (!hasClientId && hasClientSecret)) {
    const msg = 'Incomplete Google OAuth configuration: Both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be provided together.';
    if (isProduction) {
      throw new AppError(ErrorCode.CONFIGURATION_ERROR, msg, 500);
    } else {
      logger.warn(msg);
      warnings.push(msg);
    }
  } else if (!googleOAuthConfigured) {
    warnings.push('Google OAuth credentials not configured; live Google account linking will run in demo/simulation mode.');
  }

  if (isProduction) {
    logger.info('Production security configuration validated successfully: cryptographic keys and database verified.');
  } else {
    logger.info('Development configuration active (development fallback secrets enabled).');
  }

  return {
    isProduction,
    isVercel,
    databaseConfigured,
    databaseValid: dbStatus.valid,
    encryptionValid,
    authSecretValid,
    googleOAuthConfigured,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
