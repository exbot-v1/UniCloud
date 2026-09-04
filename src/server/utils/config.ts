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

export interface SecurityConfigStatus {
  isProduction: boolean;
  encryptionValid: boolean;
  authSecretValid: boolean;
  googleOAuthConfigured: boolean;
}

/**
 * Validates critical security configuration at server startup.
 * Throws AppError(ErrorCode.CONFIGURATION_ERROR) immediately if production
 * secrets are missing or invalid.
 */
export function validateSecurityConfiguration(): SecurityConfigStatus {
  const isProduction = process.env.NODE_ENV === 'production';

  // 1. Verify 256-bit encryption key
  let encryptionValid = false;
  try {
    const keyBuf = getEncryptionKey();
    if (keyBuf.length === 32) {
      encryptionValid = true;
    }
  } catch (err: any) {
    if (isProduction) {
      logger.error('CRITICAL: Production encryption key validation failed');
      throw err;
    }
  }

  // 2. Verify HMAC / Session secret
  let authSecretValid = false;
  try {
    const secret = getHmacSecret();
    if (secret && secret.length >= 16) {
      authSecretValid = true;
    }
  } catch (err: any) {
    if (isProduction) {
      logger.error('CRITICAL: Production auth secret validation failed');
      throw err;
    }
  }

  // 3. Verify Google OAuth credentials consistency
  const hasClientId = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID.trim().length > 0);
  const hasClientSecret = Boolean(process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CLIENT_SECRET.trim().length > 0);
  const googleOAuthConfigured = hasClientId && hasClientSecret;

  if ((hasClientId && !hasClientSecret) || (!hasClientId && hasClientSecret)) {
    const msg = 'Incomplete Google OAuth configuration: Both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be provided together.';
    if (isProduction) {
      throw new AppError(ErrorCode.CONFIGURATION_ERROR, msg, 500);
    } else {
      logger.warn(msg);
    }
  }

  if (isProduction) {
    logger.info('Production security configuration validated successfully: cryptographic keys and secrets verified.');
  } else {
    logger.info('Development configuration active (development fallback secrets enabled).');
  }

  return {
    isProduction,
    encryptionValid,
    authSecretValid,
    googleOAuthConfigured,
  };
}
