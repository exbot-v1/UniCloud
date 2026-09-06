/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud PostgreSQL Database Client & Connection Pool
 * 
 * Server-side only: Manages pooled connections, parameterized queries,
 * transaction boundaries, and health checks.
 */

import pg from 'pg';
import { AppError, ErrorCode } from '../server/utils/errors.js';
import { logger } from '../server/utils/logger.js';

const { Pool } = pg;

// Singleton pool instance
let pool: pg.Pool | null = null;
let schemaInitialized = false;

/**
 * Check whether a valid PostgreSQL connection string is configured
 */
export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
}

/**
 * Initialize or retrieve the PostgreSQL connection pool
 */
export function getPool(): pg.Pool | null {
  if (!hasDatabaseUrl()) {
    return null;
  }

  if (!pool) {
    const connectionString = process.env.DATABASE_URL!;
    const isLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

    pool = new Pool({
      connectionString,
      max: process.env.DATABASE_MAX_CONNECTIONS ? parseInt(process.env.DATABASE_MAX_CONNECTIONS, 10) : 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
      ssl: isLocalhost || process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    });

    pool.on('error', (err) => {
      logger.error('Unexpected idle PostgreSQL client error', { error: err.message });
    });

    logger.info('PostgreSQL connection pool established', {
      max: pool.options.max,
      ssl: Boolean(pool.options.ssl),
    });
  }

  return pool;
}

/**
 * Ensure baseline schema tables exist when connecting to PostgreSQL
 */
export async function ensureSchema(): Promise<void> {
  if (schemaInitialized) return;

  const currentPool = getPool();
  if (!currentPool) {
    schemaInitialized = true;
    return;
  }

  try {
    // Create users & user_sessions & baseline tables if not present
    await currentPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255),
        display_name VARCHAR(255),
        avatar_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

      CREATE TABLE IF NOT EXISTS storage_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL DEFAULT 'google_drive',
        provider_account_id VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        avatar_url TEXT,
        encrypted_access_token TEXT,
        encrypted_refresh_token TEXT NOT NULL,
        token_iv VARCHAR(64) NOT NULL,
        token_auth_tag VARCHAR(64) NOT NULL,
        token_expires_at TIMESTAMPTZ,
        total_bytes BIGINT NOT NULL DEFAULT 0,
        used_bytes BIGINT NOT NULL DEFAULT 0,
        free_bytes BIGINT NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        error_message TEXT,
        last_synced_at TIMESTAMPTZ,
        last_health_check_at TIMESTAMPTZ,
        provider_metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_user_provider_account UNIQUE(user_id, provider, provider_account_id)
      );

      CREATE INDEX IF NOT EXISTS idx_storage_accounts_user ON storage_accounts(user_id);

      CREATE TABLE IF NOT EXISTS virtual_folders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id UUID REFERENCES virtual_folders(id) ON DELETE CASCADE,
        storage_account_id UUID REFERENCES storage_accounts(id) ON DELETE SET NULL,
        provider VARCHAR(50),
        provider_folder_id VARCHAR(255),
        name VARCHAR(255) NOT NULL,
        is_starred BOOLEAN NOT NULL DEFAULT FALSE,
        is_trashed BOOLEAN NOT NULL DEFAULT FALSE,
        trashed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_virtual_folders_user_parent ON virtual_folders(user_id, parent_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_virtual_folders_account_provider ON virtual_folders (storage_account_id, provider_folder_id);

      CREATE TABLE IF NOT EXISTS virtual_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        storage_account_id UUID NOT NULL REFERENCES storage_accounts(id) ON DELETE RESTRICT,
        parent_id UUID REFERENCES virtual_folders(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL DEFAULT 'google_drive',
        provider_file_id VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(150) NOT NULL DEFAULT 'application/octet-stream',
        size_bytes BIGINT NOT NULL DEFAULT 0,
        md5_checksum VARCHAR(64),
        web_url TEXT,
        thumbnail_url TEXT,
        is_starred BOOLEAN NOT NULL DEFAULT FALSE,
        is_trashed BOOLEAN NOT NULL DEFAULT FALSE,
        trashed_at TIMESTAMPTZ,
        provider_created_at TIMESTAMPTZ,
        provider_modified_at TIMESTAMPTZ,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_account_provider_file UNIQUE(storage_account_id, provider_file_id)
      );

      CREATE INDEX IF NOT EXISTS idx_virtual_files_user_parent ON virtual_files(user_id, parent_id);

      CREATE TABLE IF NOT EXISTS oauth_states (
        state_id VARCHAR(64) PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL DEFAULT 'google_drive',
        redirect_uri TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON oauth_states(user_id);

      CREATE TABLE IF NOT EXISTS sync_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        storage_account_id UUID NOT NULL REFERENCES storage_accounts(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL DEFAULT 'running',
        files_discovered INTEGER NOT NULL DEFAULT 0,
        files_added INTEGER NOT NULL DEFAULT 0,
        files_updated INTEGER NOT NULL DEFAULT 0,
        files_removed INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_sync_history_account ON sync_history(storage_account_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS upload_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        storage_account_id UUID REFERENCES storage_accounts(id) ON DELETE SET NULL,
        target_folder_id UUID REFERENCES virtual_folders(id) ON DELETE SET NULL,
        file_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(150) NOT NULL,
        total_size_bytes BIGINT NOT NULL,
        bytes_uploaded BIGINT NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        routing_strategy VARCHAR(50) NOT NULL DEFAULT 'most_free_space',
        routing_reason TEXT,
        resumable_session_url TEXT,
        error_message TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_upload_jobs_user_status ON upload_jobs(user_id, status);

      -- Migration: Ensure drive_change_token exists for Delta Sync (Phase 3)
      ALTER TABLE storage_accounts ADD COLUMN IF NOT EXISTS drive_change_token TEXT;
    `);

    schemaInitialized = true;
    logger.info('Database schema verified and active');
  } catch (err: any) {
    logger.error('Failed to verify PostgreSQL schema', { error: err.message });
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      `Database initialization error: ${err.message}`,
      500,
      { originalError: err.message }
    );
  }
}

// ---------------------------------------------------------------------------
// In-Memory Fallback Store (Used when DATABASE_URL is not set for local dev)
// ---------------------------------------------------------------------------
interface MemoryDb {
  users: Map<string, any>;
  userSessions: Map<string, any>;
  storageAccounts: Map<string, any>;
  virtualFolders: Map<string, any>;
  virtualFiles: Map<string, any>;
  oauthStates: Map<string, any>;
  syncHistory: Map<string, any>;
  uploadJobs: Map<string, any>;
}

const memoryDb: MemoryDb = {
  users: new Map(),
  userSessions: new Map(),
  storageAccounts: new Map(),
  virtualFolders: new Map(),
  virtualFiles: new Map(),
  oauthStates: new Map(),
  syncHistory: new Map(),
  uploadJobs: new Map(),
};

/**
 * Execute parameterized query against PostgreSQL or In-Memory Dev Store
 */
export async function query<T = any>(
  text: string,
  params: any[] = []
): Promise<{ rows: T[]; rowCount: number }> {
  const currentPool = getPool();

  if (currentPool) {
    try {
      const start = Date.now();
      const result = await currentPool.query(text, params);
      const duration = Date.now() - start;

      if (duration > 1000) {
        logger.warn('Slow database query detected', { durationMs: duration, query: text.substring(0, 100) });
      }

      return {
        rows: result.rows as T[],
        rowCount: result.rowCount ?? result.rows.length,
      };
    } catch (err: any) {
      logger.error('Database query execution error', {
        error: err.message,
        code: err.code,
        query: text.substring(0, 150),
      });

      // PostgreSQL unique constraint violation (code 23505)
      if (err.code === '23505') {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          'A record with these details already exists.',
          409,
          { detail: err.detail }
        );
      }

      throw new AppError(
        ErrorCode.DATABASE_ERROR,
        `Database query failed: ${err.message}`,
        500,
        { originalCode: err.code }
      );
    }
  }

  // In-memory fallback simulation for development without DATABASE_URL
  return executeInMemoryQuery<T>(text, params);
}

/**
 * Transaction Helper
 */
export async function transaction<T>(
  callback: (client: { query: (text: string, params?: any[]) => Promise<any> }) => Promise<T>
): Promise<T> {
  const currentPool = getPool();

  if (currentPool) {
    const client = await currentPool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // In-memory atomic execution
  return callback({
    query: (text, params) => query(text, params),
  });
}

/**
 * Health check verification
 */
export async function checkDatabaseHealth(): Promise<{
  isConnected: boolean;
  latencyMs?: number;
  mode: 'postgresql' | 'development_memory';
  error?: string;
}> {
  const currentPool = getPool();

  if (!currentPool) {
    return {
      isConnected: true,
      mode: 'development_memory',
    };
  }

  const start = Date.now();
  try {
    await currentPool.query('SELECT 1 AS health_check');
    return {
      isConnected: true,
      latencyMs: Date.now() - start,
      mode: 'postgresql',
    };
  } catch (err: any) {
    return {
      isConnected: false,
      mode: 'postgresql',
      error: err.message,
    };
  }
}

/**
 * Gracefully close the connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    schemaInitialized = false;
    logger.info('PostgreSQL connection pool closed');
  }
}

// ---------------------------------------------------------------------------
// In-Memory Query Evaluator for local dev when DATABASE_URL is not set
// ---------------------------------------------------------------------------
function executeInMemoryQuery<T>(sql: string, params: any[]): { rows: T[]; rowCount: number } {
  const normalizedSql = sql.trim().replace(/\s+/g, ' ');

  // SELECT 1 (Health check)
  if (/^SELECT 1/i.test(normalizedSql)) {
    return { rows: [{ health_check: 1 } as any], rowCount: 1 };
  }

  // 1. Users Queries
  if (/INSERT INTO users/i.test(normalizedSql)) {
    // INSERT INTO users (id, email, password_hash, display_name, avatar_url) VALUES ($1, $2, $3, $4, $5) RETURNING *
    const id = params[0];
    const email = params[1]?.toLowerCase();
    const password_hash = params[2];
    const display_name = params[3] || null;
    const avatar_url = params[4] || null;

    // Check unique email
    for (const u of memoryDb.users.values()) {
      if (u.email === email) {
        throw new AppError(
          ErrorCode.RESOURCE_ALREADY_EXISTS,
          `A user with email ${email} already exists.`,
          409
        );
      }
    }

    const now = new Date().toISOString();
    const newUser = {
      id,
      email,
      password_hash,
      display_name,
      avatar_url,
      created_at: now,
      updated_at: now,
    };
    memoryDb.users.set(id, newUser);
    return { rows: [newUser as any], rowCount: 1 };
  }

  if (/SELECT .* FROM users WHERE email =/i.test(normalizedSql)) {
    const email = params[0]?.toLowerCase();
    for (const u of memoryDb.users.values()) {
      if (u.email === email) {
        return { rows: [u as any], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }

  if (/SELECT .* FROM users WHERE id =/i.test(normalizedSql)) {
    const id = params[0];
    const user = memoryDb.users.get(id);
    return { rows: user ? [user as any] : [], rowCount: user ? 1 : 0 };
  }

  // 2. User Sessions Queries
  if (/INSERT INTO user_sessions/i.test(normalizedSql)) {
    const id = params[0];
    const user_id = params[1];
    const token_hash = params[2];
    const expires_at = params[3];
    const now = new Date().toISOString();

    const newSession = {
      id,
      user_id,
      token_hash,
      expires_at: typeof expires_at === 'string' ? expires_at : expires_at.toISOString(),
      created_at: now,
    };
    memoryDb.userSessions.set(token_hash, newSession);
    return { rows: [newSession as any], rowCount: 1 };
  }

  if (/SELECT .* FROM user_sessions WHERE token_hash =/i.test(normalizedSql)) {
    const token_hash = params[0];
    const session = memoryDb.userSessions.get(token_hash);
    if (!session) return { rows: [], rowCount: 0 };

    // Check expiry
    if (new Date(session.expires_at) < new Date()) {
      memoryDb.userSessions.delete(token_hash);
      return { rows: [], rowCount: 0 };
    }

    return { rows: [session as any], rowCount: 1 };
  }

  if (/DELETE FROM user_sessions WHERE token_hash =/i.test(normalizedSql)) {
    const token_hash = params[0];
    const deleted = memoryDb.userSessions.delete(token_hash);
    return { rows: [], rowCount: deleted ? 1 : 0 };
  }

  if (/DELETE FROM user_sessions WHERE user_id =/i.test(normalizedSql)) {
    const user_id = params[0];
    let count = 0;
    for (const [key, sess] of memoryDb.userSessions.entries()) {
      if (sess.user_id === user_id) {
        memoryDb.userSessions.delete(key);
        count++;
      }
    }
    return { rows: [], rowCount: count };
  }

  // 3. Storage Accounts Queries
  if (/SELECT .* FROM storage_accounts WHERE user_id =/i.test(normalizedSql)) {
    const userId = params[0];
    const accounts: any[] = [];
    for (const acc of memoryDb.storageAccounts.values()) {
      if (acc.user_id === userId) {
        accounts.push(acc);
      }
    }
    return { rows: accounts as any[], rowCount: accounts.length };
  }

  if (/SELECT .* FROM storage_accounts WHERE user_id = .* AND provider = .* AND provider_account_id =/i.test(normalizedSql)) {
    const userId = params[0];
    const provider = params[1];
    const providerAccountId = params[2];
    for (const acc of memoryDb.storageAccounts.values()) {
      if (acc.user_id === userId && acc.provider === provider && acc.provider_account_id === providerAccountId) {
        return { rows: [acc as any], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }

  if (/SELECT .* FROM storage_accounts WHERE id = .* AND user_id =/i.test(normalizedSql)) {
    const accountId = params[0];
    const userId = params[1];
    const acc = memoryDb.storageAccounts.get(accountId);
    if (acc && acc.user_id === userId) {
      return { rows: [acc as any], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (/SELECT .* FROM storage_accounts WHERE id =/i.test(normalizedSql)) {
    const accountId = params[0];
    const acc = memoryDb.storageAccounts.get(accountId);
    if (acc) {
      return { rows: [acc as any], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (/UPDATE storage_accounts/i.test(normalizedSql)) {
    // Handle status / quota / sync / change token update
    const id = params[params.length - 2] || params[params.length - 1];
    const acc = memoryDb.storageAccounts.get(id);
    if (acc) {
      acc.updated_at = new Date().toISOString();
      if (/used_bytes\s*=\s*used_bytes\s*\+/i.test(normalizedSql)) {
        const delta = Number(params[0]) || 0;
        acc.used_bytes = Number(acc.used_bytes || 0) + delta;
        acc.free_bytes = Math.max(0, Number(acc.free_bytes || 0) - delta);
      }
      if (/drive_change_token/i.test(normalizedSql)) {
        acc.drive_change_token = params[0];
        if (typeof acc.provider_metadata === 'object' && acc.provider_metadata !== null) {
          acc.provider_metadata = { ...acc.provider_metadata, driveChangeToken: params[0] };
        } else {
          acc.provider_metadata = { driveChangeToken: params[0] };
        }
      }
      if (/total_bytes/i.test(normalizedSql)) {
        acc.total_bytes = params[0];
        acc.used_bytes = params[1];
        acc.free_bytes = params[2];
        acc.last_synced_at = params[3];
      }
      if (/status\s*=/i.test(normalizedSql)) {
        acc.status = params[0];
        acc.error_message = params[1];
      }
      return { rows: [acc as any], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (/DELETE FROM storage_accounts WHERE id = .* AND user_id =/i.test(normalizedSql)) {
    const accountId = params[0];
    const userId = params[1];
    const acc = memoryDb.storageAccounts.get(accountId);
    if (acc && acc.user_id === userId) {
      memoryDb.storageAccounts.delete(accountId);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (/INSERT INTO storage_accounts/i.test(normalizedSql)) {
    const id = params[0];
    const user_id = params[1];
    const provider = params[2] || 'google_drive';
    const provider_account_id = params[3];
    const email = params[4];
    const display_name = params[5] || null;
    const avatar_url = params[6] || null;
    const encrypted_access_token = params[7] || null;
    const encrypted_refresh_token = params[8];
    const token_iv = params[9];
    const token_auth_tag = params[10];
    const token_expires_at = params[11] || null;
    const total_bytes = params[12] || 0;
    const used_bytes = params[13] || 0;
    const free_bytes = params[14] || 0;
    const status = params[15] || 'active';
    const is_enabled = params[16] ?? true;
    const error_message = params[17] || null;
    const drive_change_token = params[18] || null;
    const now = new Date().toISOString();

    // Check if account already exists for user + provider + provider_account_id
    for (const [existingId, acc] of memoryDb.storageAccounts.entries()) {
      if (acc.user_id === user_id && acc.provider === provider && acc.provider_account_id === provider_account_id) {
        acc.email = email;
        acc.display_name = display_name;
        acc.avatar_url = avatar_url;
        acc.encrypted_access_token = encrypted_access_token;
        acc.encrypted_refresh_token = encrypted_refresh_token;
        acc.token_iv = token_iv;
        acc.token_auth_tag = token_auth_tag;
        acc.token_expires_at = token_expires_at;
        acc.total_bytes = total_bytes;
        acc.used_bytes = used_bytes;
        acc.free_bytes = free_bytes;
        acc.status = status;
        acc.error_message = error_message;
        if (drive_change_token !== null) acc.drive_change_token = drive_change_token;
        acc.updated_at = now;
        return { rows: [acc as any], rowCount: 1 };
      }
    }

    const newAcc = {
      id,
      user_id,
      provider,
      provider_account_id,
      email,
      display_name,
      avatar_url,
      encrypted_access_token,
      encrypted_refresh_token,
      token_iv,
      token_auth_tag,
      token_expires_at,
      total_bytes,
      used_bytes,
      free_bytes,
      status,
      is_enabled,
      error_message,
      drive_change_token: drive_change_token || null,
      last_synced_at: null,
      last_health_check_at: now,
      provider_metadata: {},
      created_at: now,
      updated_at: now,
    };
    memoryDb.storageAccounts.set(id, newAcc);
    return { rows: [newAcc as any], rowCount: 1 };
  }

  // 4. OAuth States Queries
  if (/INSERT INTO oauth_states/i.test(normalizedSql)) {
    const state_id = params[0];
    const user_id = params[1];
    const provider = params[2] || 'google_drive';
    const redirect_uri = params[3] || null;
    const expires_at = params[4];
    const stateObj = {
      state_id,
      user_id,
      provider,
      redirect_uri,
      expires_at,
      created_at: new Date().toISOString(),
    };
    memoryDb.oauthStates.set(state_id, stateObj);
    return { rows: [stateObj as any], rowCount: 1 };
  }

  if (/SELECT .* FROM oauth_states WHERE state_id =/i.test(normalizedSql)) {
    const state_id = params[0];
    const stateObj = memoryDb.oauthStates.get(state_id);
    if (stateObj) {
      return { rows: [stateObj as any], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (/DELETE FROM oauth_states WHERE state_id =/i.test(normalizedSql)) {
    const state_id = params[0];
    const stateObj = memoryDb.oauthStates.get(state_id);
    if (stateObj) {
      memoryDb.oauthStates.delete(state_id);
      return { rows: [stateObj as any], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // 5. Virtual Files Queries
  if (/DELETE FROM virtual_files WHERE storage_account_id = .* AND provider_file_id =/i.test(normalizedSql)) {
    const accountId = params[0];
    const providerFileId = params[1];
    const userId = params[2];
    let deletedCount = 0;
    for (const [id, f] of memoryDb.virtualFiles.entries()) {
      if (f.storage_account_id === accountId && f.provider_file_id === providerFileId && (!userId || f.user_id === userId)) {
        memoryDb.virtualFiles.delete(id);
        deletedCount++;
      }
    }
    return { rows: [], rowCount: deletedCount };
  }

  if (/DELETE FROM virtual_files WHERE storage_account_id =/i.test(normalizedSql)) {
    const accountId = params[0];
    for (const [id, f] of memoryDb.virtualFiles.entries()) {
      if (f.storage_account_id === accountId) {
        memoryDb.virtualFiles.delete(id);
      }
    }
    return { rows: [], rowCount: 1 };
  }

  if (/DELETE FROM virtual_folders WHERE storage_account_id = .* AND provider_folder_id =/i.test(normalizedSql)) {
    const accountId = params[0];
    const providerFolderId = params[1];
    const userId = params[2];
    let deletedCount = 0;
    for (const [id, f] of memoryDb.virtualFolders.entries()) {
      if (f.storage_account_id === accountId && f.provider_folder_id === providerFolderId && (!userId || f.user_id === userId)) {
        memoryDb.virtualFolders.delete(id);
        deletedCount++;
      }
    }
    return { rows: [], rowCount: deletedCount };
  }

  if (/DELETE FROM virtual_folders WHERE storage_account_id =/i.test(normalizedSql)) {
    const accountId = params[0];
    for (const [id, f] of memoryDb.virtualFolders.entries()) {
      if (f.storage_account_id === accountId) {
        memoryDb.virtualFolders.delete(id);
      }
    }
    return { rows: [], rowCount: 1 };
  }

  if (/SELECT count\(\*\) .* FROM virtual_files WHERE storage_account_id =/i.test(normalizedSql)) {
    const accountId = params[0];
    const userId = params[1];
    let count = 0;
    for (const f of memoryDb.virtualFiles.values()) {
      if (f.storage_account_id === accountId && (!userId || f.user_id === userId)) {
        count++;
      }
    }
    return { rows: [{ cnt: count, count }] as any[], rowCount: 1 };
  }

  if (/SELECT .* FROM virtual_files WHERE id =/i.test(normalizedSql)) {
    const fileId = params[0];
    const file = memoryDb.virtualFiles.get(fileId);
    return { rows: file ? [file as any] : [], rowCount: file ? 1 : 0 };
  }

  if (/SELECT .* FROM virtual_files WHERE storage_account_id = .* AND provider_file_id =/i.test(normalizedSql)) {
    const accountId = params[0];
    const providerFileId = params[1];
    const files = Array.from(memoryDb.virtualFiles.values()).filter(
      (f: any) => f.storage_account_id === accountId && f.provider_file_id === providerFileId
    );
    return { rows: files as any[], rowCount: files.length };
  }

  if (/SELECT .* FROM virtual_files WHERE storage_account_id = .* AND user_id =/i.test(normalizedSql)) {
    const accountId = params[0];
    const userId = params[1];
    const files = Array.from(memoryDb.virtualFiles.values()).filter(
      (f: any) => f.storage_account_id === accountId && f.user_id === userId
    );
    return { rows: files as any[], rowCount: files.length };
  }

  if (/SELECT .* FROM virtual_files WHERE user_id =/i.test(normalizedSql)) {
    const userId = params[0];
    const files: any[] = [];
    for (const f of memoryDb.virtualFiles.values()) {
      if (f.user_id === userId) {
        files.push(f);
      }
    }
    return { rows: files as any[], rowCount: files.length };
  }

  if (/UPDATE virtual_files SET is_trashed = TRUE/i.test(normalizedSql)) {
    if (/provider_file_id/i.test(normalizedSql)) {
      const accountId = params[0];
      const providerFileId = params[1];
      const userId = params[2];
      let updated = 0;
      for (const f of memoryDb.virtualFiles.values()) {
        if (f.storage_account_id === accountId && f.provider_file_id === providerFileId && (!userId || f.user_id === userId)) {
          f.is_trashed = true;
          f.trashed_at = new Date().toISOString();
          f.updated_at = new Date().toISOString();
          updated++;
        }
      }
      return { rows: [], rowCount: updated };
    }

    const accountId = params[0];
    const userId = params[1];
    const syncTimeStr = params[2];
    const syncTime = new Date(syncTimeStr).getTime();
    let count = 0;
    for (const f of memoryDb.virtualFiles.values()) {
      if (
        f.storage_account_id === accountId &&
        f.user_id === userId &&
        !f.is_trashed &&
        new Date(f.synced_at).getTime() < syncTime
      ) {
        f.is_trashed = true;
        f.trashed_at = new Date().toISOString();
        f.updated_at = new Date().toISOString();
        count++;
      }
    }
    return { rows: [], rowCount: count };
  }

  if (/INSERT INTO virtual_files/i.test(normalizedSql)) {
    const hasNullParent = /values\s*\(\s*\$1\s*,\s*\$2\s*,\s*\$3\s*,\s*null/i.test(normalizedSql);
    const id = params[0] || `vf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const user_id = params[1];
    const storage_account_id = params[2];
    const parent_id = hasNullParent ? null : (params[3] || null);
    const baseIdx = hasNullParent ? 3 : 4;

    const provider = params[baseIdx] || 'google_drive';
    const provider_file_id = params[baseIdx + 1];
    const name = params[baseIdx + 2];
    const mime_type = params[baseIdx + 3] || 'application/octet-stream';
    const size_bytes = Number(params[baseIdx + 4]) || 0;
    const md5_checksum = params[baseIdx + 5] || null;
    const web_url = params[baseIdx + 6] || null;
    const is_starred = Boolean(params[baseIdx + 7]);
    const is_trashed = Boolean(params[baseIdx + 8]);
    const provider_created_at = params[baseIdx + 9] || new Date().toISOString();
    const provider_modified_at = params[baseIdx + 10] || new Date().toISOString();
    const synced_at = params[baseIdx + 11] || new Date().toISOString();

    // Check for conflict on (storage_account_id, provider_file_id)
    let existingFile: any = null;
    if (storage_account_id && provider_file_id) {
      for (const f of memoryDb.virtualFiles.values()) {
        if (f.storage_account_id === storage_account_id && f.provider_file_id === provider_file_id) {
          existingFile = f;
          break;
        }
      }
    }

    if (existingFile) {
      existingFile.parent_id = parent_id;
      existingFile.name = name;
      existingFile.mime_type = mime_type;
      existingFile.size_bytes = size_bytes;
      existingFile.md5_checksum = md5_checksum;
      existingFile.web_url = web_url;
      existingFile.is_starred = is_starred;
      existingFile.is_trashed = is_trashed;
      existingFile.provider_modified_at = provider_modified_at;
      existingFile.synced_at = new Date().toISOString();
      existingFile.updated_at = new Date().toISOString();
      return { rows: [existingFile as any], rowCount: 1 };
    }

    const fileObj = {
      id,
      user_id,
      storage_account_id,
      parent_id,
      provider,
      provider_file_id,
      name,
      mime_type,
      size_bytes,
      md5_checksum,
      web_url,
      thumbnail_url: null,
      is_starred,
      is_trashed,
      provider_created_at,
      provider_modified_at,
      synced_at,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    memoryDb.virtualFiles.set(id, fileObj);
    return { rows: [fileObj as any], rowCount: 1 };
  }

  // 6. Virtual Folders Queries
  if (/SELECT .* FROM virtual_folders WHERE id =/i.test(normalizedSql)) {
    const folderId = params[0];
    const folder = memoryDb.virtualFolders.get(folderId);
    return { rows: folder ? [folder as any] : [], rowCount: folder ? 1 : 0 };
  }

  if (/SELECT .* FROM virtual_folders WHERE storage_account_id = .* AND provider_folder_id =/i.test(normalizedSql)) {
    const accountId = params[0];
    const providerFolderId = params[1];
    const folders: any[] = [];
    for (const fol of memoryDb.virtualFolders.values()) {
      if (fol.storage_account_id === accountId && fol.provider_folder_id === providerFolderId) {
        folders.push(fol);
      }
    }
    return { rows: folders as any[], rowCount: folders.length };
  }

  if (/SELECT .* FROM virtual_folders WHERE storage_account_id =/i.test(normalizedSql)) {
    const accountId = params[0];
    const folders: any[] = [];
    for (const fol of memoryDb.virtualFolders.values()) {
      if (fol.storage_account_id === accountId) {
        folders.push(fol);
      }
    }
    return { rows: folders as any[], rowCount: folders.length };
  }

  if (/UPDATE virtual_folders SET is_trashed = TRUE/i.test(normalizedSql)) {
    const accountId = params[0];
    const providerFolderId = params[1];
    const userId = params[2];
    let updated = 0;
    for (const f of memoryDb.virtualFolders.values()) {
      if (f.storage_account_id === accountId && f.provider_folder_id === providerFolderId && (!userId || f.user_id === userId)) {
        f.is_trashed = true;
        f.trashed_at = new Date().toISOString();
        f.updated_at = new Date().toISOString();
        updated++;
      }
    }
    return { rows: [], rowCount: updated };
  }

  if (/UPDATE virtual_folders SET parent_id =/i.test(normalizedSql)) {
    const parent_id = params[0];
    const id = params[1];
    const user_id = params[2];
    const folder = memoryDb.virtualFolders.get(id);
    if (folder && folder.user_id === user_id) {
      folder.parent_id = parent_id;
      folder.updated_at = new Date().toISOString();
      return { rows: [folder as any], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (/UPDATE virtual_folders SET name =/i.test(normalizedSql)) {
    const name = params[0];
    const is_starred = Boolean(params[1]);
    const is_trashed = Boolean(params[2]);
    const id = params[3];
    const user_id = params[4];
    const folder = memoryDb.virtualFolders.get(id);
    if (folder && folder.user_id === user_id) {
      folder.name = name;
      folder.is_starred = is_starred;
      folder.is_trashed = is_trashed;
      folder.updated_at = new Date().toISOString();
      return { rows: [folder as any], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (/INSERT INTO virtual_folders/i.test(normalizedSql)) {
    const hasExplicitNullParent = /values\s*\(\s*\$1\s*,\s*\$2\s*,\s*null/i.test(normalizedSql);
    const id = params[0] || `vfol_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const user_id = params[1];
    const parent_id = hasExplicitNullParent ? null : (params[2] || null);
    const baseIdx = hasExplicitNullParent ? 2 : 3;

    const storage_account_id = params[baseIdx] || null;
    const provider = params[baseIdx + 1] || 'google_drive';
    const provider_folder_id = params[baseIdx + 2] || null;
    const name = params[baseIdx + 3];
    const is_starred = Boolean(params[baseIdx + 4]);
    const is_trashed = Boolean(params[baseIdx + 5]);

    // Check for conflict on (storage_account_id, provider_folder_id)
    let existingFolder: any = null;
    if (storage_account_id && provider_folder_id) {
      for (const fol of memoryDb.virtualFolders.values()) {
        if (fol.storage_account_id === storage_account_id && fol.provider_folder_id === provider_folder_id) {
          existingFolder = fol;
          break;
        }
      }
    }

    if (existingFolder) {
      existingFolder.name = name;
      existingFolder.is_starred = is_starred;
      existingFolder.is_trashed = is_trashed;
      existingFolder.updated_at = new Date().toISOString();
      return { rows: [existingFolder as any], rowCount: 1 };
    }

    const folderObj = {
      id,
      user_id,
      parent_id,
      storage_account_id,
      provider,
      provider_folder_id,
      name,
      is_starred,
      is_trashed,
      trashed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    memoryDb.virtualFolders.set(id, folderObj);
    return { rows: [folderObj as any], rowCount: 1 };
  }

  if (/SELECT .* FROM virtual_folders WHERE user_id =/i.test(normalizedSql)) {
    const userId = params[0];
    const folders: any[] = [];
    for (const fol of memoryDb.virtualFolders.values()) {
      if (fol.user_id === userId) {
        folders.push(fol);
      }
    }
    return { rows: folders as any[], rowCount: folders.length };
  }

  // 7. Sync History
  if (/INSERT INTO sync_history/i.test(normalizedSql)) {
    const histRecord = {
      id: params[0],
      user_id: params[1],
      storage_account_id: params[2],
      status: params[3],
      files_discovered: params[4] || 0,
      files_added: params[5] || 0,
      files_updated: params[6] || 0,
      files_removed: params[7] || 0,
      error_message: params[8] || null,
      started_at: params[9] || new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };
    memoryDb.syncHistory.set(histRecord.id, histRecord);
    return { rows: [histRecord as any], rowCount: 1 };
  }

  if (/SELECT .* FROM sync_history/i.test(normalizedSql)) {
    let list = Array.from(memoryDb.syncHistory.values());
    if (params && params.length >= 2) {
      list = list.filter(h => h.storage_account_id === params[0] && h.user_id === params[1]);
    } else if (params && params.length === 1) {
      list = list.filter(h => h.storage_account_id === params[0] || h.user_id === params[0]);
    }
    if (/ORDER BY .* DESC/i.test(normalizedSql)) {
      list.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
    }
    return { rows: list as any[], rowCount: list.length };
  }

  // 8. Upload Jobs (Phase 4)
  if (/INSERT INTO upload_jobs/i.test(normalizedSql)) {
    const jobRecord = {
      id: params[0],
      user_id: params[1],
      storage_account_id: params[2] || null,
      target_folder_id: params[3] || null,
      file_name: params[4],
      mime_type: params[5],
      total_size_bytes: Number(params[6]) || 0,
      bytes_uploaded: Number(params[7]) || 0,
      status: params[8] || 'pending',
      routing_strategy: params[9] || 'most_free_space',
      routing_reason: params[10] || null,
      resumable_session_url: params[11] || null,
      error_message: params[12] || null,
      started_at: new Date().toISOString(),
      completed_at: null,
      updated_at: new Date().toISOString(),
    };
    memoryDb.uploadJobs.set(jobRecord.id, jobRecord);
    return { rows: [jobRecord as any], rowCount: 1 };
  }

  if (/SELECT .* FROM upload_jobs WHERE id = .* AND user_id =/i.test(normalizedSql)) {
    const id = params[0];
    const userId = params[1];
    const job = memoryDb.uploadJobs.get(id);
    if (job && job.user_id === userId) {
      return { rows: [job as any], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (/SELECT .* FROM upload_jobs WHERE user_id =/i.test(normalizedSql)) {
    const userId = params[0];
    let list = Array.from(memoryDb.uploadJobs.values()).filter(j => j.user_id === userId);
    if (/ORDER BY .* DESC/i.test(normalizedSql)) {
      list.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
    }
    return { rows: list as any[], rowCount: list.length };
  }

  if (/UPDATE upload_jobs SET/i.test(normalizedSql)) {
    const jobId = params[params.length - 2];
    const userId = params[params.length - 1];
    const job = memoryDb.uploadJobs.get(jobId);
    if (job && job.user_id === userId) {
      job.updated_at = new Date().toISOString();
      if (/bytes_uploaded\s*=/i.test(normalizedSql)) {
        job.bytes_uploaded = Number(params[0]) || 0;
      }
      for (const p of params) {
        if (typeof p === 'string' && ['pending', 'routed', 'initializing', 'uploading', 'completed', 'failed', 'aborted'].includes(p)) {
          job.status = p;
          break;
        }
      }
      if (/completed_at/i.test(normalizedSql) && job.status === 'completed') {
        job.completed_at = new Date().toISOString();
      }
      if (/error_message/i.test(normalizedSql)) {
        for (let i = 0; i < params.length - 2; i++) {
          if (typeof params[i] === 'string' && params[i] !== job.status && !params[i].startsWith('http')) {
            job.error_message = params[i];
          }
        }
      }
      if (/resumable_session_url\s*=/i.test(normalizedSql)) {
        for (let i = 0; i < params.length - 2; i++) {
          if (typeof params[i] === 'string' && params[i].startsWith('http')) {
            job.resumable_session_url = params[i];
            break;
          }
        }
      }
      return { rows: [job as any], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // Fallback generic empty
  return { rows: [], rowCount: 0 };
}
