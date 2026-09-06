/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Credential Encryption Engine (AES-256-GCM)
 * 
 * SECURITY MANDATE:
 * OAuth refresh tokens and credentials must be encrypted at rest.
 * Uses AES-256-GCM with a 96-bit (12-byte) initialization vector
 * and a 128-bit authentication tag.
 */

import crypto from 'crypto';
import { EncryptedTokenBundle } from '../../types/account.js';
import { AppError } from './errors.js';
import { ErrorCode } from '../../types/api.js';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
let devWarningLogged = false;

export function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY;

  if (!keyHex) {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
      throw new AppError(
        ErrorCode.CONFIGURATION_ERROR,
        'Production security requirement: ENCRYPTION_KEY or TOKEN_ENCRYPTION_KEY must be configured as a 64-character hexadecimal 256-bit key.',
        500
      );
    }
    if (!devWarningLogged) {
      logger.info('Using development fallback encryption key. Configure ENCRYPTION_KEY in production.');
      devWarningLogged = true;
    }
    // Fallback development deterministic key
    const fallbackHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    return Buffer.from(fallbackHex, 'hex');
  }

  const cleanHex = keyHex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
    throw new AppError(
      ErrorCode.CONFIGURATION_ERROR,
      'ENCRYPTION_KEY must be a valid 64-character hexadecimal string representing a 256-bit key.',
      500
    );
  }

  const keyBuffer = Buffer.from(cleanHex, 'hex');
  if (keyBuffer.length !== 32) {
    throw new AppError(
      ErrorCode.CONFIGURATION_ERROR,
      'ENCRYPTION_KEY must decode to exactly 32 bytes (256 bits).',
      500
    );
  }

  return keyBuffer;
}

/**
 * Validates encryption configuration at server startup or during tests.
 * Fails fast if configuration is invalid.
 */
export function validateEncryptionKeyConfig(): void {
  getEncryptionKey();
}

export function encryptToken(plaintext: string): EncryptedTokenBundle {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptToken(bundle: EncryptedTokenBundle): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(bundle.iv, 'base64');
  const authTag = Buffer.from(bundle.authTag, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(bundle.ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
