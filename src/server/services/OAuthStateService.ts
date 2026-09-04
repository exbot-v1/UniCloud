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

function getHmacSecret(): string {
  return process.env.AUTH_SECRET || process.env.SESSION_SECRET || 'unicloud-dev-hmac-secret-32-chars-minimum!';
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

    logger.debug(`Generated OAuth state token for user ${userId}`);
    return stateToken;
  }

  /**
   * Validates and immediately consumes (deletes) the state token.
   * Prevents replay attacks and verifies user tenancy.
   * Returns the bound userId and redirectUri if valid.
   */
  public static async verifyAndConsumeState(stateToken: string): Promise<{ userId: string; redirectUri?: string }> {
    if (!stateToken || typeof stateToken !== 'string') {
      throw new AppError(ErrorCode.INVALID_STATE, 'Missing OAuth state parameter', 400);
    }

    const parts = stateToken.split('.');
    if (parts.length !== 4) {
      throw new AppError(ErrorCode.INVALID_STATE, 'Malformed OAuth state token format', 400);
    }

    const [stateId, userId, expiresAtStr, signature] = parts;
    const expiresAtMs = parseInt(expiresAtStr, 10);

    // 1. Verify cryptographic signature
    const payload = `${stateId}.${userId}.${expiresAtStr}`;
    const expectedHmac = crypto.createHmac('sha256', getHmacSecret()).update(payload).digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedHmac))) {
      logger.warn('OAuth state cryptographic signature verification failed');
      throw new AppError(ErrorCode.INVALID_STATE, 'Invalid OAuth state signature (potential CSRF attack)', 400);
    }

    // 2. Verify expiration
    if (Date.now() > expiresAtMs) {
      // Clean up if exists
      await query('DELETE FROM oauth_states WHERE state_id = $1', [stateId]).catch(() => {});
      throw new AppError(ErrorCode.INVALID_STATE, 'OAuth session expired. Please try connecting your account again.', 400);
    }

    // 3. Verify existence in database (enforce single-use)
    const result = await query(
      'SELECT * FROM oauth_states WHERE state_id = $1',
      [stateId]
    );

    if (result.rows.length === 0) {
      throw new AppError(ErrorCode.INVALID_STATE, 'OAuth state has already been used or was not recognized (replay detected)', 400);
    }

    const stateRow = result.rows[0];

    // Verify user ID matches
    if (stateRow.user_id !== userId) {
      throw new AppError(ErrorCode.INVALID_STATE, 'OAuth state user binding mismatch', 400);
    }

    // 4. Consume immediately
    await query('DELETE FROM oauth_states WHERE state_id = $1', [stateId]);

    return {
      userId,
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
