/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud OAuth State Service
 * 
 * Generates and validates cryptographically unpredictable, single-use,
 * user-bound CSRF state tokens for Google OAuth 2.0 flows.
 */

import crypto from 'crypto';
import { query } from '../../db/client.js';
import { AppError } from '../utils/errors.js';
import { ErrorCode } from '../../types/api.js';
import { logger } from '../utils/logger.js';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface OAuthStatePayload {
  stateId: string;
  userId: string;
  provider: string;
  redirectUri?: string;
  expiresAt: number;
}

export function getHmacSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
      throw new AppError(
        ErrorCode.CONFIGURATION_ERROR,
        'AUTH_SECRET or SESSION_SECRET must be configured in production environment',
        500
      );
    }
    return 'unicloud-dev-hmac-secret-32-chars-minimum!';
  }
  return secret;
}

export class OAuthStateService {
  /**
   * Generates a secure, cryptographically unpredictable, HMAC-signed state token
   * and persists it to the database to ensure strict single-use validation.
   */
  public static async createState(userId: string, redirectUri?: string, provider = 'google_drive'): Promise<string> {
    const stateId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + STATE_TTL_MS);

    // Persist to database
    await query(
      `INSERT INTO oauth_states (state_id, user_id, provider, redirect_uri, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [stateId, userId, provider, redirectUri || null, expiresAt.toISOString()]
    );

    // Create signed token: stateId.userId.expiresAtMs.signature
    const payload = `${stateId}.${userId}.${expiresAt.getTime()}`;
    const hmac = crypto.createHmac('sha256', getHmacSecret()).update(payload).digest('hex');
    const stateToken = `${payload}.${hmac}`;

    logger.debug(`Generated OAuth state token for user ${userId}, provider ${provider}`);
    return stateToken;
  }

  /**
   * Validates and immediately consumes (deletes) the state token atomically.
   * Prevents replay attacks, verifies user tenancy, and enforces provider binding.
   * Never throws unhandled RangeError on mismatched signature lengths.
   */
  public static async verifyAndConsumeState(
    stateToken: string,
    options?: {
      expectedProvider?: string;
      expectedUserId?: string;
    }
  ): Promise<{ userId: string; provider: string; redirectUri?: string }> {
    if (!stateToken || typeof stateToken !== 'string') {
      throw new AppError(ErrorCode.INVALID_STATE, 'Missing or empty OAuth state parameter', 400);
    }

    const parts = stateToken.split('.');
    if (parts.length !== 4) {
      throw new AppError(ErrorCode.INVALID_STATE, 'Malformed OAuth state token format', 400);
    }

    const [stateId, userId, expiresAtStr, signature] = parts;
    const expiresAtMs = parseInt(expiresAtStr, 10);

    if (!stateId || !userId || !signature || isNaN(expiresAtMs)) {
      throw new AppError(ErrorCode.INVALID_STATE, 'Malformed OAuth state token contents', 400);
    }

    // 1. Verify cryptographic signature
    const payload = `${stateId}.${userId}.${expiresAtStr}`;
    const expectedHmac = crypto.createHmac('sha256', getHmacSecret()).update(payload).digest('hex');

    const signatureBuf = Buffer.from(signature, 'utf8');
    const expectedBuf = Buffer.from(expectedHmac, 'utf8');

    // CRITICAL HARDENING: Validate buffer byte lengths match before timingSafeEqual
    // Prevents attacker-controlled signature lengths from causing an unhandled RangeError / 500
    if (signatureBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(signatureBuf, expectedBuf)) {
      logger.warn('OAuth state cryptographic signature verification failed (tampering detected)');
      throw new AppError(ErrorCode.INVALID_STATE, 'Invalid OAuth state signature (potential CSRF attack or tampering)', 400);
    }

    // 2. Verify expiration from payload
    if (Date.now() > expiresAtMs) {
      await query('DELETE FROM oauth_states WHERE state_id = $1', [stateId]).catch(() => {});
      throw new AppError(ErrorCode.INVALID_STATE, 'OAuth session expired. Please try connecting your account again.', 400);
    }

    // 3. ATOMIC CONSUMPTION & REPLAY PROTECTION
    // Single atomic statement: delete the state record and return it.
    // If already consumed, invalid stateId, or concurrent race, rowCount will be 0.
    const deleteResult = await query(
      'DELETE FROM oauth_states WHERE state_id = $1 RETURNING *',
      [stateId]
    );

    if (deleteResult.rows.length === 0) {
      throw new AppError(ErrorCode.INVALID_STATE, 'OAuth state has already been used or was not recognized (replay detected)', 400);
    }

    const stateRow = deleteResult.rows[0];

    // 4. Verify database expiration timestamp
    if (new Date(stateRow.expires_at).getTime() < Date.now()) {
      throw new AppError(ErrorCode.INVALID_STATE, 'OAuth session expired. Please try connecting your account again.', 400);
    }

    // 5. Verify user binding
    if (stateRow.user_id !== userId) {
      throw new AppError(ErrorCode.INVALID_STATE, 'OAuth state user signature mismatch', 400);
    }

    if (options?.expectedUserId && stateRow.user_id !== options.expectedUserId) {
      throw new AppError(ErrorCode.INVALID_STATE, 'OAuth state user binding mismatch', 400);
    }

    // 6. Verify provider binding
    const expectedProvider = options?.expectedProvider || 'google_drive';
    if (stateRow.provider !== expectedProvider) {
      throw new AppError(
        ErrorCode.INVALID_STATE,
        `OAuth state provider mismatch: expected ${expectedProvider}, found ${stateRow.provider}`,
        400
      );
    }

    return {
      userId: stateRow.user_id,
      provider: stateRow.provider,
      redirectUri: stateRow.redirect_uri || undefined,
    };
  }

  /**
   * Periodic cleanup of expired states
   */
  public static async cleanupExpired(): Promise<void> {
    try {
      await query('DELETE FROM oauth_states WHERE expires_at < NOW()');
    } catch {
      // Ignore cleanup error
    }
  }
}
