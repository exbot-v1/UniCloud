/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud AccountService (Phase 2 Upgrade)
 * 
 * Domain service managing connected storage accounts, credential encryption lifecycles,
 * and storage quota metrics backed by PostgreSQL with strict user-tenant isolation.
 */

import crypto from 'crypto';
import { query, transaction } from '../../db/client.js';
import { DbStorageAccount } from '../../db/schema.js';
import { StorageAccount, StoragePoolSummary, ProviderType, AccountStatus, StorageQuota } from '../../types/account.js';
import { AppError } from '../utils/errors.js';
import { ErrorCode } from '../../types/api.js';
import { logger } from '../utils/logger.js';
import { encryptToken, decryptToken } from '../utils/encryption.js';
import { storageService } from './StorageService.js';
import { ProviderRegistry } from '../providers/ProviderRegistry.js';
import { GoogleDriveProvider } from '../providers/GoogleDriveProvider.js';

export interface ConnectAccountParams {
  userId: string;
  provider: ProviderType;
  providerAccountId: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  tokens: {
    accessToken?: string | null;
    refreshToken: string;
    expiresAt?: Date | null;
  };
  quota: StorageQuota;
}

export class AccountService {
  /**
   * Helper to map database storage account row to domain StorageAccount.
   * SECURITY RULE: Never includes raw or encrypted token fields.
   */
  public mapDbAccountToDomain(row: DbStorageAccount): StorageAccount {
    const total = Number(row.total_bytes) || 0;
    const used = Number(row.used_bytes) || 0;
    const free = Number(row.free_bytes) || Math.max(0, total - used);
    const usagePercentage = total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0;

    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider as ProviderType,
      providerAccountId: row.provider_account_id,
      email: row.email,
      displayName: row.display_name || undefined,
      avatarUrl: row.avatar_url || undefined,
      status: row.status as AccountStatus,
      isEnabled: row.is_enabled !== false,
      tokenExpiresAt: row.token_expires_at,
      quota: {
        totalBytes: total,
        usedBytes: used,
        freeBytes: free,
        usagePercentage,
      },
      lastSyncedAt: row.last_synced_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      driveChangeToken: row.drive_change_token || (row.provider_metadata as any)?.driveChangeToken || null,
      providerMetadata: row.provider_metadata,
    };
  }

  /**
   * Connects a new Google account or updates an existing connected account.
   * Encrypts the refresh token using AES-256-GCM before database insertion.
   */
  async connectOrUpdateAccount(params: ConnectAccountParams): Promise<{ account: StorageAccount; isNew: boolean }> {
    const { userId, provider, providerAccountId, email, displayName, avatarUrl, tokens, quota } = params;
    logger.info(`Connecting/updating storage account ${email} for user ${userId}`);

    // Encrypt refresh token with AES-256-GCM
    const encryptedBundle = encryptToken(tokens.refreshToken);
    const encryptedAccessToken = tokens.accessToken ? encryptToken(tokens.accessToken).ciphertext : null;
    const tokenExpiresAt = tokens.expiresAt ? tokens.expiresAt.toISOString() : null;

    // Check if account already exists for this user + provider + providerAccountId
    const existingResult = await query<DbStorageAccount>(
      `SELECT * FROM storage_accounts 
       WHERE user_id = $1 AND provider = $2 AND provider_account_id = $3`,
      [userId, provider, providerAccountId]
    );

    const now = new Date().toISOString();

    if (existingResult.rows.length > 0) {
      // Update existing account
      const existing = existingResult.rows[0];
      const updateResult = await query<DbStorageAccount>(
        `UPDATE storage_accounts SET
          email = $1,
          display_name = $2,
          avatar_url = $3,
          encrypted_access_token = $4,
          encrypted_refresh_token = $5,
          token_iv = $6,
          token_auth_tag = $7,
          token_expires_at = $8,
          total_bytes = $9,
          used_bytes = $10,
          free_bytes = $11,
          status = $12,
          error_message = NULL,
          updated_at = $13
         WHERE id = $14 AND user_id = $15
         RETURNING *`,
        [
          email,
          displayName || null,
          avatarUrl || null,
          encryptedAccessToken,
          encryptedBundle.ciphertext,
          encryptedBundle.iv,
          encryptedBundle.authTag,
          tokenExpiresAt,
          quota.totalBytes,
          quota.usedBytes,
          quota.freeBytes,
          AccountStatus.ACTIVE,
          now,
          existing.id,
          userId,
        ]
      );

      const row = updateResult.rows[0] || existing;
      return {
        account: this.mapDbAccountToDomain(row),
        isNew: false,
      };
    }

    // Insert brand new account
    const id = crypto.randomUUID();
    const insertResult = await query<DbStorageAccount>(
      `INSERT INTO storage_accounts (
        id, user_id, provider, provider_account_id, email, display_name, avatar_url,
        encrypted_access_token, encrypted_refresh_token, token_iv, token_auth_tag,
        token_expires_at, total_bytes, used_bytes, free_bytes, status, is_enabled,
        error_message, last_synced_at, last_health_check_at, provider_metadata,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21,
        $22, $23
      ) RETURNING *`,
      [
        id,
        userId,
        provider,
        providerAccountId,
        email,
        displayName || null,
        avatarUrl || null,
        encryptedAccessToken,
        encryptedBundle.ciphertext,
        encryptedBundle.iv,
        encryptedBundle.authTag,
        tokenExpiresAt,
        quota.totalBytes,
        quota.usedBytes,
        quota.freeBytes,
        AccountStatus.ACTIVE,
        true,
        null,
        null,
        now,
        JSON.stringify({}),
        now,
        now,
      ]
    );

    const row = insertResult.rows[0];
    return {
      account: this.mapDbAccountToDomain(row),
      isNew: true,
    };
  }

  /**
   * Retrieves all connected storage accounts for a user from PostgreSQL.
   */
  async getAccountsForUser(userId: string): Promise<StorageAccount[]> {
    logger.debug(`Retrieving connected storage accounts for user ${userId}`);
    const result = await query<DbStorageAccount>(
      `SELECT * FROM storage_accounts 
       WHERE user_id = $1 
       ORDER BY created_at ASC`,
      [userId]
    );

    return result.rows.map((row) => this.mapDbAccountToDomain(row));
  }

  /**
   * Retrieves a single connected storage account by ID, strictly enforcing tenant isolation.
   */
  async getAccountById(userId: string, accountId: string): Promise<StorageAccount> {
    logger.debug(`Retrieving storage account ${accountId} for user ${userId}`);
    const result = await query<DbStorageAccount>(
      `SELECT * FROM storage_accounts 
       WHERE id = $1 AND user_id = $2`,
      [accountId, userId]
    );

    if (result.rowCount === 0) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Storage account with ID ${accountId} was not found or belongs to another user.`,
        404
      );
    }

    return this.mapDbAccountToDomain(result.rows[0]);
  }

  /**
   * Retrieves and decrypts the stored refresh token for internal server-side operations only.
   * SERVER-SIDE ONLY: This method is never invoked directly by client-facing API responses.
   */
  async getDecryptedCredentials(
    userId: string,
    accountId: string
  ): Promise<{
    refreshToken: string;
    tokenExpiresAt?: string | null;
    email: string;
    provider: ProviderType;
  }> {
    const result = await query<DbStorageAccount>(
      `SELECT * FROM storage_accounts 
       WHERE id = $1 AND user_id = $2`,
      [accountId, userId]
    );

    if (result.rowCount === 0) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Storage account ${accountId} was not found.`,
        404
      );
    }

    const row = result.rows[0];
    const refreshToken = decryptToken({
      ciphertext: row.encrypted_refresh_token,
      iv: row.token_iv,
      authTag: row.token_auth_tag,
    });

    return {
      refreshToken,
      tokenExpiresAt: row.token_expires_at,
      email: row.email,
      provider: row.provider as ProviderType,
    };
  }

  /**
   * Retrieves a refreshed, valid access token for the given account (Phase 4).
   */
  async getValidAccessToken(userId: string, accountId: string): Promise<string> {
    const credentials = await this.getDecryptedCredentials(userId, accountId);
    const provider = ProviderRegistry.get(credentials.provider) as GoogleDriveProvider;
    const auth = await provider.refreshAuthentication(credentials.refreshToken);
    return auth.accessToken;
  }

  /**
   * Updates an account's quota values in PostgreSQL.
   */
  async updateQuota(userId: string, accountId: string, quota: StorageQuota): Promise<void> {
    const now = new Date().toISOString();
    await query(
      `UPDATE storage_accounts SET
        total_bytes = $1,
        used_bytes = $2,
        free_bytes = $3,
        last_synced_at = $4,
        updated_at = $4
       WHERE id = $5 AND user_id = $6`,
      [quota.totalBytes, quota.usedBytes, quota.freeBytes, now, accountId, userId]
    );
  }

  /**
   * Retrieves persisted Google Drive change/page token for delta synchronization (Phase 3).
   */
  async getChangeToken(userId: string, accountId: string): Promise<string | null> {
    const result = await query<DbStorageAccount>(
      `SELECT drive_change_token, provider_metadata FROM storage_accounts 
       WHERE id = $1 AND user_id = $2`,
      [accountId, userId]
    );

    if (result.rowCount === 0) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Storage account ${accountId} was not found.`,
        404
      );
    }

    const row = result.rows[0];
    return row.drive_change_token || (row.provider_metadata as any)?.driveChangeToken || null;
  }

  /**
   * Persists a new Google Drive change/page token for an account after successful delta sync (Phase 3).
   * Persists only after processing completes successfully.
   */
  async updateChangeToken(userId: string, accountId: string, changeToken: string): Promise<void> {
    const now = new Date().toISOString();
    const metaPatch = JSON.stringify({ driveChangeToken: changeToken });
    await query(
      `UPDATE storage_accounts SET
        drive_change_token = $1,
        provider_metadata = COALESCE(provider_metadata, '{}'::jsonb) || $2::jsonb,
        last_synced_at = $3,
        updated_at = $3
       WHERE id = $4 AND user_id = $5`,
      [changeToken, metaPatch, now, accountId, userId]
    );
  }

  /**
   * Updates an account's status (active, token_expired, error).
   */
  async updateAccountStatus(
    userId: string,
    accountId: string,
    status: AccountStatus,
    errorMessage: string | null = null
  ): Promise<void> {
    const now = new Date().toISOString();
    await query(
      `UPDATE storage_accounts SET
        status = $1,
        error_message = $2,
        updated_at = $3
       WHERE id = $4 AND user_id = $5`,
      [status, errorMessage, now, accountId, userId]
    );
  }

  /**
   * Disconnects a storage account:
   * 1. Verifies authenticated ownership
   * 2. Attempts upstream token revocation
   * 3. Deletes local virtual files/folders metadata associated with this account
   * 4. Deletes account record from storage_accounts
   * NOTE: Does NOT delete any files on the user's actual Google Drive!
   */
  async disconnectAccount(userId: string, accountId: string): Promise<void> {
    logger.info(`Disconnecting storage account ${accountId} for user ${userId}`);

    // Verify ownership and get credentials
    const credentials = await this.getDecryptedCredentials(userId, accountId);

    // Attempt upstream revocation
    if (credentials.provider === ProviderType.GOOGLE_DRIVE) {
      try {
        const provider = ProviderRegistry.get(ProviderType.GOOGLE_DRIVE) as GoogleDriveProvider;
        await provider.revokeToken(credentials.refreshToken);
      } catch (err: any) {
        logger.warn(`Could not revoke Google token during disconnect: ${err.message}`);
      }
    }

    // Clean up local virtual file mappings, upload jobs, and sync history atomically with strict tenant isolation
    await transaction(async (tx) => {
      await tx.query(
        `UPDATE upload_jobs 
         SET status = 'aborted', error_message = 'Storage account disconnected', updated_at = NOW() 
         WHERE storage_account_id = $1 AND user_id = $2 AND status = 'uploading'`,
        [accountId, userId]
      );
      await tx.query('DELETE FROM virtual_files WHERE storage_account_id = $1 AND user_id = $2', [accountId, userId]);
      await tx.query('DELETE FROM virtual_folders WHERE storage_account_id = $1 AND user_id = $2', [accountId, userId]);
      await tx.query('DELETE FROM upload_jobs WHERE storage_account_id = $1 AND user_id = $2', [accountId, userId]);
      await tx.query('DELETE FROM sync_history WHERE storage_account_id = $1 AND user_id = $2', [accountId, userId]);

      // Delete account
      const deleteResult = await tx.query(
        `DELETE FROM storage_accounts 
         WHERE id = $1 AND user_id = $2`,
        [accountId, userId]
      );

      if (deleteResult.rowCount === 0) {
        throw new AppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Storage account with ID ${accountId} was not found or belongs to another user.`,
          404
        );
      }
    });

    logger.info(`Successfully disconnected account ${accountId} for user ${userId}`);
  }

  /**
   * Toggles an account's enabled state (Phase 5 Storage Lifecycle).
   * Disabled accounts are excluded from upload routing, cannot receive uploads or cross-account moves.
   */
  async toggleAccountEnabled(userId: string, accountId: string, isEnabled?: boolean): Promise<StorageAccount> {
    const current = await this.getAccountById(userId, accountId);
    const newEnabled = typeof isEnabled === 'boolean' ? isEnabled : !current.isEnabled;
    const now = new Date().toISOString();

    await transaction(async (tx) => {
      await tx.query(
        `UPDATE storage_accounts SET
          is_enabled = $1,
          updated_at = $2
         WHERE id = $3 AND user_id = $4`,
        [newEnabled, now, accountId, userId]
      );

      // If disabling account, abort in-flight uploads targeting this account
      if (!newEnabled) {
        await tx.query(
          `UPDATE upload_jobs 
           SET status = 'aborted', error_message = 'Storage account disabled during upload', updated_at = NOW() 
           WHERE storage_account_id = $1 AND user_id = $2 AND status = 'uploading'`,
          [accountId, userId]
        );
      }
    });

    return this.getAccountById(userId, accountId);
  }

  /**
   * Calculates storage pool aggregate summary for a user from PostgreSQL state.
   */
  async getStoragePoolSummary(userId: string): Promise<StoragePoolSummary> {
    const accounts = await this.getAccountsForUser(userId);
    return storageService.calculatePoolMetrics(accounts);
  }
}

export const accountService = new AccountService();
