/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud SyncService (Phase 2 Initial Metadata Sync)
 * 
 * Domain service managing Google Drive metadata synchronization and quota refreshes.
 * Synchronizes file/folder metadata into PostgreSQL without downloading actual file contents.
 */

import crypto from 'crypto';
import { query } from '../../db/client.js';
import { AppError } from '../utils/errors.js';
import { ErrorCode } from '../../types/api.js';
import { logger } from '../utils/logger.js';
import { accountService } from './AccountService.js';
import { ProviderRegistry } from '../providers/ProviderRegistry.js';
import { GoogleDriveProvider } from '../providers/GoogleDriveProvider.js';
import { ProviderType, AccountStatus } from '../../types/account.js';

export interface SyncResult {
  accountId: string;
  filesDiscovered: number;
  filesAddedOrUpdated: number;
  quotaUpdated: boolean;
  timestamp: string;
}

export class SyncService {
  /**
   * Synchronizes an individual connected Google Drive account:
   * 1. Refreshes OAuth access token using stored encrypted refresh token.
   * 2. Retrieves actual storage quota via Google Drive v3 `about.get` and persists it.
   * 3. Queries Google Drive v3 `files.list` and maps files and folders into virtual filesystem tables.
   * 4. Updates last_synced_at timestamp and records sync history.
   */
  async syncAccount(userId: string, accountId: string): Promise<SyncResult> {
    logger.info(`Starting sync for account ${accountId}, user ${userId}`);

    // Verify ownership and get credentials
    const credentials = await accountService.getDecryptedCredentials(userId, accountId);
    const provider = ProviderRegistry.get(credentials.provider) as GoogleDriveProvider;

    try {
      // 1. Refresh Access Token
      const { accessToken } = await provider.refreshAuthentication(credentials.refreshToken);

      // 2. Fetch & Update Quota
      const quota = await provider.getStorageQuota(accessToken);
      await accountService.updateQuota(userId, accountId, quota);

      // 3. Query Drive Metadata (Files & Folders)
      const listResult = await provider.listFiles(accessToken, { pageSize: 100 });
      let filesCount = 0;

      // 4. Upsert virtual files & folders
      for (const item of listResult.files) {
        if (item.isFolder) {
          // Check if folder already exists
          const existingFolder = await query(
            `SELECT id FROM virtual_folders 
             WHERE storage_account_id = $1 AND provider_folder_id = $2`,
            [accountId, item.providerFileId]
          );

          if (existingFolder.rows.length === 0) {
            const folderId = crypto.randomUUID();
            await query(
              `INSERT INTO virtual_folders (
                id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
                name, is_starred, is_trashed, created_at, updated_at
              ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                folderId,
                userId,
                accountId,
                ProviderType.GOOGLE_DRIVE,
                item.providerFileId,
                item.name,
                item.isStarred,
                item.isTrashed,
                item.createdAt,
                item.modifiedAt,
              ]
            );
          }
        } else {
          // Upsert file
          const existingFile = await query(
            `SELECT id FROM virtual_files 
             WHERE storage_account_id = $1 AND provider_file_id = $2`,
            [accountId, item.providerFileId]
          );

          if (existingFile.rows.length === 0) {
            const fileId = crypto.randomUUID();
            await query(
              `INSERT INTO virtual_files (
                id, user_id, storage_account_id, parent_id, provider, provider_file_id,
                name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
                provider_created_at, provider_modified_at, synced_at, created_at, updated_at
              ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW(), NOW())`,
              [
                fileId,
                userId,
                accountId,
                ProviderType.GOOGLE_DRIVE,
                item.providerFileId,
                item.name,
                item.mimeType,
                item.sizeBytes,
                item.md5Checksum || null,
                item.webUrl || null,
                item.isStarred,
                item.isTrashed,
                item.createdAt,
                item.modifiedAt,
              ]
            );
          } else {
            // Update existing file metadata
            await query(
              `UPDATE virtual_files SET
                name = $1,
                mime_type = $2,
                size_bytes = $3,
                web_url = $4,
                is_starred = $5,
                is_trashed = $6,
                provider_modified_at = $7,
                synced_at = NOW(),
                updated_at = NOW()
               WHERE id = $8 AND user_id = $9`,
              [
                item.name,
                item.mimeType,
                item.sizeBytes,
                item.webUrl || null,
                item.isStarred,
                item.isTrashed,
                item.modifiedAt,
                existingFile.rows[0].id,
                userId,
              ]
            );
          }
          filesCount++;
        }
      }

      // Mark account active and clear any error
      await accountService.updateAccountStatus(userId, accountId, AccountStatus.ACTIVE, null);

      logger.info(`Successfully synced account ${accountId}: ${filesCount} files processed`);

      return {
        accountId,
        filesDiscovered: listResult.files.length,
        filesAddedOrUpdated: filesCount,
        quotaUpdated: true,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      logger.error(`Failed to sync account ${accountId}`, { error: err.message });
      const status = err.code === ErrorCode.TOKEN_EXPIRED ? AccountStatus.TOKEN_EXPIRED : AccountStatus.ERROR;
      await accountService.updateAccountStatus(userId, accountId, status, err.message);
      throw err;
    }
  }
}

export const syncService = new SyncService();
