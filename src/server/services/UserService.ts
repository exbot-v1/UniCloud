/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud User Authentication & Session Service
 * 
 * Server-side only: Secure password hashing with bcrypt, session token generation,
 * SHA-256 token storage, and database persistence.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../../db/client.js';
import { DbUser, DbUserSession } from '../../db/schema.js';
import { AppError, ErrorCode } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { UserPublicProfile } from '../../types/auth.js';

export type { UserPublicProfile };

export interface AuthenticatedSession {
  user: UserPublicProfile;
  sessionToken: string;
  expiresAt: Date;
}

export class UserService {
  private static BCRYPT_ROUNDS = 12;
  private static SESSION_DURATION_DAYS = 7;

  /**
   * Helper to map a database user row to safe public profile
   */
  private static toPublicProfile(dbUser: DbUser): UserPublicProfile {
    return {
      id: dbUser.id,
      email: dbUser.email,
      displayName: dbUser.display_name,
      avatarUrl: dbUser.avatar_url,
      createdAt: dbUser.created_at,
    };
  }

  /**
   * Register a new user with secure password hashing
   */
  public static async createUser(params: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<AuthenticatedSession> {
    const email = params.email.trim().toLowerCase();
    const displayName = params.displayName?.trim() || email.split('@')[0];

    // Validate inputs
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Please provide a valid email address.', 400);
    }

    if (!params.password || params.password.length < 8) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Password must be at least 8 characters in length.', 400);
    }

    // Check if user already exists
    const existing = await query<DbUser>('SELECT id FROM users WHERE LOWER(TRIM(email)) = $1', [email]);
    if (existing.rowCount > 0) {
      throw new AppError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        'An account with this email address already exists.',
        409
      );
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(params.password, this.BCRYPT_ROUNDS);
    const userId = crypto.randomUUID();

    const insertResult = await query<DbUser>(
      `INSERT INTO users (id, email, password_hash, display_name, avatar_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, email, passwordHash, displayName, null]
    );

    const newUser = insertResult.rows[0];
    logger.info('New user registered successfully', { userId: newUser.id, email: newUser.email });

    // Create initial session
    return this.createSession(newUser);
  }

  /**
   * Authenticate a user by email and password
   */
  public static async authenticateUser(params: {
    email: string;
    password: string;
  }): Promise<AuthenticatedSession> {
    const email = params.email.trim().toLowerCase();

    if (!email || !params.password) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Email and password are required.', 400);
    }

    const result = await query<DbUser>(
      'SELECT * FROM users WHERE LOWER(TRIM(email)) = $1',
      [email]
    );

    if (result.rowCount === 0) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password.', 401);
    }

    const user = result.rows[0];
    if (!user.password_hash) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Account requires password setup.', 401);
    }

    const isMatch = await bcrypt.compare(params.password, user.password_hash);
    if (!isMatch) {
      logger.warn('Failed login attempt', { email });
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password.', 401);
    }

    logger.info('User authenticated successfully', { userId: user.id, email: user.email });
    return this.createSession(user);
  }

  /**
   * Retrieve user public profile by ID
   */
  public static async getUserById(userId: string): Promise<UserPublicProfile | null> {
    const result = await query<DbUser>('SELECT * FROM users WHERE id = $1', [userId]);
    if (result.rowCount === 0) return null;
    return this.toPublicProfile(result.rows[0]);
  }

  /**
   * Retrieve user public profile by email
   */
  public static async getUserByEmail(email: string): Promise<UserPublicProfile | null> {
    const result = await query<DbUser>(
      'SELECT * FROM users WHERE LOWER(TRIM(email)) = $1',
      [email.trim().toLowerCase()]
    );
    if (result.rowCount === 0) return null;
    return this.toPublicProfile(result.rows[0]);
  }

  /**
   * Create a persistent authenticated session
   */
  public static async createSession(user: DbUser): Promise<AuthenticatedSession> {
    // Generate high-entropy 256-bit session token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, user.id, tokenHash, expiresAt.toISOString()]
    );

    return {
      user: this.toPublicProfile(user),
      sessionToken: rawToken,
      expiresAt,
    };
  }

  /**
   * Validate session token from cookie and retrieve user
   */
  public static async validateSession(sessionToken: string): Promise<UserPublicProfile | null> {
    if (!sessionToken || typeof sessionToken !== 'string') {
      return null;
    }

    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');

    const sessionResult = await query<DbUserSession>(
      `SELECT * FROM user_sessions WHERE token_hash = $1`,
      [tokenHash]
    );

    if (sessionResult.rowCount === 0) {
      return null;
    }

    const session = sessionResult.rows[0];
    if (new Date(session.expires_at) < new Date()) {
      // Clean expired session
      await query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
      return null;
    }

    const userResult = await query<DbUser>('SELECT * FROM users WHERE id = $1', [session.user_id]);
    if (userResult.rowCount === 0) {
      return null;
    }

    return this.toPublicProfile(userResult.rows[0]);
  }

  /**
   * Invalidate a session (logout)
   */
  public static async invalidateSession(sessionToken: string): Promise<void> {
    if (!sessionToken) return;
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    await query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
  }

  /**
   * Invalidate all sessions for a user (logout all devices)
   */
  public static async invalidateAllUserSessions(userId: string): Promise<void> {
    await query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
  }

  /**
   * Ensure default demo/developer user (socialdoodle7@gmail.com) exists.
   * STRICT SECURITY: Demo user creation is strictly prohibited in production environments.
   */
  public static async ensureDemoUser(): Promise<UserPublicProfile | null> {
    const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
    if (isProd) {
      logger.info('Production mode: skipping demo user initialization to preserve production database integrity');
      return null;
    }

    const email = 'socialdoodle7@gmail.com';
    try {
      const existing = await this.getUserByEmail(email);
      if (existing) return existing;

      const session = await this.createUser({
        email,
        password: 'Password123!',
        displayName: 'socialdoodle7',
      });
      return session.user;
    } catch (err: any) {
      logger.debug('Non-production demo user initialization note:', { message: err?.message });
      try {
        const retry = await this.getUserByEmail(email);
        if (retry) return retry;
      } catch {
        // DB might be temporarily unavailable
      }
      return null;
    }
  }
}

