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
  filesRemoved?: number;
  foldersProcessed?: number;
  quotaUpdated: boolean;
  paginationComplete: boolean;
  timestamp: string;
}

export class SyncService {
  /**
   * Synchronizes an individual connected Google Drive account:
   * 1. Refreshes OAuth access token using stored encrypted refresh token.
   * 2. Retrieves actual storage quota via Google Drive v3 `about.get` and persists it.
   * 3. Queries Google Drive v3 `files.list` with full pagination.
   * 4. Resolves folder hierarchy in two passes (folders first, link parents, then files).
   * 5. Idempotently upserts files and folders.
   * 6. Marks stale/removed upstream files as trashed ONLY when pagination was complete.
   * 7. Records audit record in sync_history.
   */
  async syncAccount(userId: string, accountId: string): Promise<SyncResult> {
    const syncStartTime = new Date();
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

      // 3. Query Drive Metadata with complete pagination
      const listResult = await provider.listFiles(accessToken, {
        fetchAllPages: true,
        pageSize: 100,
      });

      const folderItems = listResult.files.filter((item) => item.isFolder);
      const fileItems = listResult.files.filter((item) => !item.isFolder);

      // 4. Load existing folder mappings for this account
      const existingFolderRows = await query(
        `SELECT id, provider_folder_id, parent_id FROM virtual_folders 
         WHERE storage_account_id = $1 AND provider_folder_id IS NOT NULL`,
        [accountId]
      );

      const folderMap = new Map<string, string>(); // Google provider folder ID -> authoritative virtual_folders UUID
      for (const row of existingFolderRows.rows) {
        folderMap.set(row.provider_folder_id, row.id);
      }

      // PASS 1: Upsert all folders and establish authoritative virtual folder IDs
      for (const folder of folderItems) {
        const upsertResult = await query<{ id: string }>(
          `INSERT INTO virtual_folders (
            id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
            name, is_starred, is_trashed, created_at, updated_at
          ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (storage_account_id, provider_folder_id) DO UPDATE SET
            name = EXCLUDED.name,
            is_starred = EXCLUDED.is_starred,
            is_trashed = EXCLUDED.is_trashed,
            updated_at = NOW()
          RETURNING id`,
          [
            crypto.randomUUID(),
            userId,
            accountId,
            ProviderType.GOOGLE_DRIVE,
            folder.providerFileId,
            folder.name,
            folder.isStarred ?? false,
            folder.isTrashed ?? false,
            folder.createdAt,
            folder.modifiedAt,
          ]
        );

        const authoritativeFolderId = upsertResult.rows[0]?.id;
        if (authoritativeFolderId) {
          folderMap.set(folder.providerFileId, authoritativeFolderId);
        }
      }

      // PASS 1.5: Resolve folder-to-folder parent relationships
      for (const folder of folderItems) {
        const virtualFolderId = folderMap.get(folder.providerFileId)!;
        const gDriveParentId = folder.parentFolderId;
        const resolvedParentId = (gDriveParentId && folderMap.has(gDriveParentId))
          ? folderMap.get(gDriveParentId)!
          : null;

        await query(
          `UPDATE virtual_folders SET
            parent_id = $1,
            updated_at = NOW()
           WHERE id = $2 AND user_id = $3`,
          [resolvedParentId, virtualFolderId, userId]
        );
      }

      // PASS 2: Upsert files with parent_id mapped to corresponding virtual_folder.id
      let filesAddedOrUpdatedCount = 0;
      for (const file of fileItems) {
        const gDriveParentId = file.parentFolderId;
        const resolvedParentId = (gDriveParentId && folderMap.has(gDriveParentId))
          ? folderMap.get(gDriveParentId)!
          : null;

        const fileId = crypto.randomUUID();
        await query(
          `INSERT INTO virtual_files (
            id, user_id, storage_account_id, parent_id, provider, provider_file_id,
            name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
            provider_created_at, provider_modified_at, synced_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW(), NOW())
          ON CONFLICT (storage_account_id, provider_file_id) DO UPDATE SET
            parent_id = EXCLUDED.parent_id,
            name = EXCLUDED.name,
            mime_type = EXCLUDED.mime_type,
            size_bytes = EXCLUDED.size_bytes,
            md5_checksum = EXCLUDED.md5_checksum,
            web_url = EXCLUDED.web_url,
            is_starred = EXCLUDED.is_starred,
            is_trashed = EXCLUDED.is_trashed,
            provider_modified_at = EXCLUDED.provider_modified_at,
            synced_at = NOW(),
            updated_at = NOW()`,
          [
            fileId,
            userId,
            accountId,
            resolvedParentId,
            ProviderType.GOOGLE_DRIVE,
            file.providerFileId,
            file.name,
            file.mimeType,
            file.sizeBytes,
            file.md5Checksum || null,
            file.webUrl || null,
            file.isStarred ?? false,
            file.isTrashed ?? false,
            file.createdAt,
            file.modifiedAt,
          ]
        );
        filesAddedOrUpdatedCount++;
      }

      // 5. Detect and mark stale / deleted upstream files as trashed ONLY when pagination was complete
      let filesRemoved = 0;
      if (listResult.paginationComplete) {
        const staleFilesResult = await query(
          `UPDATE virtual_files SET
            is_trashed = TRUE,
            trashed_at = NOW(),
            updated_at = NOW()
           WHERE storage_account_id = $1
             AND user_id = $2
             AND is_trashed = FALSE
             AND synced_at < $3`,
          [accountId, userId, syncStartTime.toISOString()]
        );
        filesRemoved = staleFilesResult.rowCount || 0;
      } else {
        logger.warn(
          `Account ${accountId} sync pagination was truncated or incomplete. Stale file reconciliation skipped to protect unvisited files.`
        );
      }

      // 6. Record sync audit record
      const syncStatus = listResult.paginationComplete ? 'completed' : 'partial';
      const syncNote = listResult.paginationComplete
        ? null
        : 'Pagination truncated: maxPages reached before consuming all upstream pages. Stale-item reconciliation skipped.';

      await query(
        `INSERT INTO sync_history (
          id, user_id, storage_account_id, status, files_discovered,
          files_added, files_updated, files_removed, error_message, started_at, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          crypto.randomUUID(),
          userId,
          accountId,
          syncStatus,
          listResult.files.length,
          filesAddedOrUpdatedCount,
          0,
          filesRemoved,
          syncNote,
          syncStartTime.toISOString(),
        ]
      );

      // Mark account active and clear any error
      await accountService.updateAccountStatus(userId, accountId, AccountStatus.ACTIVE, null);

      logger.info(
        `Successfully synced account ${accountId}: ${filesAddedOrUpdatedCount} files, ${folderItems.length} folders, ${filesRemoved} stale files marked trashed (paginationComplete: ${listResult.paginationComplete})`
      );

      return {
        accountId,
        filesDiscovered: listResult.files.length,
        filesAddedOrUpdated: filesAddedOrUpdatedCount,
        filesRemoved,
        foldersProcessed: folderItems.length,
        quotaUpdated: true,
        paginationComplete: listResult.paginationComplete,
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
