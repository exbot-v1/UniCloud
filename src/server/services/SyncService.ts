/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud SyncService (Phase 2 & Phase 3 Incremental Delta Sync)
 * 
 * Domain service managing Google Drive metadata synchronization, quota refreshes,
 * and incremental delta change consumption via the Google Drive Changes API.
 * Synchronizes file/folder metadata into PostgreSQL without downloading actual file contents.
 */

import crypto from 'crypto';
import { query } from '../../db/client.js';
import { AppError } from '../utils/errors.js';
import { ErrorCode } from '../../types/api.js';
import { logger } from '../utils/logger.js';
import { accountService } from './AccountService.js';
import { ProviderRegistry } from '../providers/ProviderRegistry.js';
import { GoogleDriveProvider, isInvalidPageTokenError } from '../providers/GoogleDriveProvider.js';
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
  syncType?: 'full' | 'delta' | 'rebuild';
  changeToken?: string | null;
  recoveredFromInvalidToken?: boolean;
}

export class SyncService {
  private inFlightSyncs = new Map<string, Promise<SyncResult>>();

  /**
   * Checks if any synchronization operation is currently active for the given account.
   */
  isSyncInProgress(userId: string, accountId: string): boolean {
    return this.inFlightSyncs.has(`account:${userId}:${accountId}`);
  }

  /**
   * Returns the active in-flight sync promise for the account if one exists.
   */
  getActiveSync(userId: string, accountId: string): Promise<SyncResult> | undefined {
    return this.inFlightSyncs.get(`account:${userId}:${accountId}`);
  }

  /**
   * Triggers initial metadata synchronization for a connected storage account asynchronously.
   * Does NOT block the OAuth callback HTTP response.
   * Coalesces with any active in-flight sync for the same account to prevent duplicate runs.
   * Catches errors internally so callers are protected against unhandled promise rejections.
   */
  triggerInitialSync(userId: string, accountId: string): Promise<SyncResult> {
    logger.info(`Triggering non-blocking initial metadata sync for account ${accountId}, user ${userId}`);
    const syncPromise = this.syncAccount(userId, accountId);

    // Non-fatal background error handler prevents unhandled rejection warnings in server runtimes
    syncPromise.catch((err: any) => {
      logger.warn(`Initial background sync completed with non-fatal error for account ${accountId}: ${err.message}`);
    });

    return syncPromise;
  }

  /**
   * Synchronizes an individual connected Google Drive account (Full Sync):
   * 1. Refreshes OAuth access token using stored encrypted refresh token.
   * 2. Retrieves actual storage quota via Google Drive v3 `about.get` and persists it.
   * 3. Establishes baseline change token BEFORE listing files to prevent baseline race condition.
   * 4. Queries Google Drive v3 `files.list` with full pagination.
   * 5. Resolves folder hierarchy in two passes (folders first, link parents, then files).
   * 6. Idempotently upserts files and folders.
   * 7. Marks stale/removed upstream files as trashed ONLY when pagination was complete.
   * 8. Establishes initial change token for future delta syncs.
   * 9. Records audit record in sync_history.
   */
  syncAccount(userId: string, accountId: string): Promise<SyncResult> {
    const syncKey = `account:${userId}:${accountId}`;
    const existing = this.inFlightSyncs.get(syncKey);
    if (existing) {
      logger.info(`Sync already in progress for account ${accountId}, coalescing with active run`);
      return existing;
    }

    const promise = (async () => {
      try {
        return await this.executeSyncAccount(userId, accountId);
      } finally {
        this.inFlightSyncs.delete(syncKey);
      }
    })();

    this.inFlightSyncs.set(syncKey, promise);
    return promise;
  }

  private async executeSyncAccount(userId: string, accountId: string): Promise<SyncResult> {
    const syncStartTime = new Date();
    logger.info(`Starting full sync for account ${accountId}, user ${userId}`);

    // Verify account is enabled
    const account = await accountService.getAccountById(userId, accountId);
    if (account.isEnabled === false) {
      throw new AppError(ErrorCode.ACCOUNT_DISABLED, 'Account is disabled. Enable it before syncing.', 400);
    }

    // Verify ownership and get credentials
    const credentials = await accountService.getDecryptedCredentials(userId, accountId);
    const provider = ProviderRegistry.get(credentials.provider) as GoogleDriveProvider;

    try {
      // 1. Refresh Access Token
      const { accessToken } = await provider.refreshAuthentication(credentials.refreshToken);

      // 2. Fetch & Update Quota
      const quota = await provider.getStorageQuota(accessToken);
      await accountService.updateQuota(userId, accountId, quota);

      // 3. Establish baseline change token BEFORE listing files to prevent race condition
      let baselineChangeToken: string | null = null;
      try {
        baselineChangeToken = await provider.getStartPageToken(accessToken);
      } catch (tokenErr: any) {
        logger.warn(`Could not establish baseline start page token: ${tokenErr.message}`);
      }

      // 4. Query Drive Metadata with complete pagination
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

      // 6. Establish and persist start change token for subsequent delta syncs (Phase 3)
      let startChangeToken = baselineChangeToken;
      if (!startChangeToken) {
        try {
          startChangeToken = await provider.getStartPageToken(accessToken);
        } catch (tokenErr: any) {
          logger.warn(`Could not establish start page token during full sync: ${tokenErr.message}`);
        }
      }
      if (startChangeToken) {
        await accountService.updateChangeToken(userId, accountId, startChangeToken);
      }

      // 7. Record sync audit record
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
        syncType: 'full',
        changeToken: startChangeToken,
      };
    } catch (err: any) {
      logger.error(`Failed to sync account ${accountId}`, { error: err.message });
      const status = err.code === ErrorCode.TOKEN_EXPIRED ? AccountStatus.TOKEN_EXPIRED : AccountStatus.ERROR;
      await accountService.updateAccountStatus(userId, accountId, status, err.message);

      // Record failed sync history record for audit and observability
      try {
        await query(
          `INSERT INTO sync_history (
            id, user_id, storage_account_id, status, files_discovered,
            files_added, files_updated, files_removed, error_message, started_at, completed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [
            crypto.randomUUID(),
            userId,
            accountId,
            'failed',
            0,
            0,
            0,
            0,
            err.message || 'Full sync failed',
            syncStartTime.toISOString(),
          ]
        );
      } catch (histErr: any) {
        logger.warn(`Failed to record sync failure in sync_history: ${histErr.message}`);
      }

      throw err;
    }
  }

  /**
   * Incrementally synchronizes an account via Google Drive Changes API (Phase 3).
   * 1. Checks if a change token exists; establishes an initial token if missing.
   * 2. Queries changes using pagination starting from the stored token.
   * 3. Safely recovers via full metadata rebuild if token is expired/invalid.
   * 4. Updates folders, files, trashed items, and deletes removed files.
   * 5. Persists the new token ONLY after successful change processing.
   * 6. Audits delta sync in sync_history.
   */
  syncDelta(userId: string, accountId: string): Promise<SyncResult> {
    const syncKey = `account:${userId}:${accountId}`;
    const existing = this.inFlightSyncs.get(syncKey);
    if (existing) {
      logger.info(`Sync already in progress for account ${accountId}, coalescing with active run`);
      return existing;
    }

    const promise = (async () => {
      try {
        return await this.executeSyncDelta(userId, accountId);
      } finally {
        this.inFlightSyncs.delete(syncKey);
      }
    })();

    this.inFlightSyncs.set(syncKey, promise);
    return promise;
  }

  private async executeSyncDelta(userId: string, accountId: string): Promise<SyncResult> {
    const syncStartTime = new Date();
    logger.info(`Starting delta sync for account ${accountId}, user ${userId}`);

    // Verify account is enabled
    const account = await accountService.getAccountById(userId, accountId);
    if (account.isEnabled === false) {
      throw new AppError(ErrorCode.ACCOUNT_DISABLED, 'Account is disabled. Enable it before syncing.', 400);
    }

    // Verify ownership and get credentials
    const credentials = await accountService.getDecryptedCredentials(userId, accountId);
    const provider = ProviderRegistry.get(credentials.provider) as GoogleDriveProvider;

    try {
      // 1. Refresh Access Token
      const { accessToken } = await provider.refreshAuthentication(credentials.refreshToken);

      // 2. Retrieve Stored Change Token
      let storedToken = await accountService.getChangeToken(userId, accountId);

      // 3. Establish initial token if account does not have one
      if (!storedToken) {
        const fileCountResult = await query(
          `SELECT count(*) as cnt FROM virtual_files WHERE storage_account_id = $1 AND user_id = $2`,
          [accountId, userId]
        );
        const existingCount = Number(fileCountResult.rows[0]?.cnt || fileCountResult.rows[0]?.count || 0);

        if (existingCount > 0) {
          logger.info(`Establishing initial change token for existing account ${accountId}`);
          storedToken = await provider.getStartPageToken(accessToken);
          await accountService.updateChangeToken(userId, accountId, storedToken);

          // Refresh quota
          const quota = await provider.getStorageQuota(accessToken);
          await accountService.updateQuota(userId, accountId, quota);

          await query(
            `INSERT INTO sync_history (
              id, user_id, storage_account_id, status, files_discovered,
              files_added, files_updated, files_removed, error_message, started_at, completed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
            [
              crypto.randomUUID(),
              userId,
              accountId,
              'completed',
              0,
              0,
              0,
              0,
              'Established initial change token for existing account',
              syncStartTime.toISOString(),
            ]
          );

          return {
            accountId,
            filesDiscovered: 0,
            filesAddedOrUpdated: 0,
            filesRemoved: 0,
            foldersProcessed: 0,
            quotaUpdated: true,
            paginationComplete: true,
            timestamp: new Date().toISOString(),
            syncType: 'delta',
            changeToken: storedToken,
          };
        } else {
          logger.info(`No existing files found for account ${accountId}; executing initial full sync.`);
          return await this.executeSyncAccount(userId, accountId);
        }
      }

      // 4. Query changes from Google Drive (consuming all available change pages)
      const allChanges: any[] = [];
      let currentToken: string = storedToken;
      let newStartToken: string | null = null;
      let pagesFetched = 0;
      const maxDeltaPages = 20;

      while (currentToken && pagesFetched < maxDeltaPages) {
        pagesFetched++;
        let pageResult: any;
        try {
          pageResult = await provider.listChanges(accessToken, {
            pageToken: currentToken,
            pageSize: 100,
            includeRemoved: true,
          });
        } catch (err: any) {
          if (isInvalidPageTokenError(err)) {
            logger.warn(`Stored change token for account ${accountId} is invalid or expired. Safely recovering by rebuilding sync state.`);
            return await this.recoverSyncState(userId, accountId, provider, accessToken);
          }
          throw err;
        }

        allChanges.push(...pageResult.changes);

        if (pageResult.newStartPageToken) {
          newStartToken = pageResult.newStartPageToken;
          break;
        } else if (pageResult.nextPageToken) {
          currentToken = pageResult.nextPageToken;
        } else {
          break;
        }
      }

      const changeResult = {
        changes: allChanges,
        newStartPageToken: newStartToken,
        nextPageToken: newStartToken ? undefined : currentToken,
        paginationComplete: newStartToken !== null,
      };

      // 5. Process changes
      let filesAddedCount = 0;
      let filesUpdatedCount = 0;
      let filesRemovedCount = 0;
      let foldersProcessedCount = 0;

      // Load folder mappings for parent resolution
      const existingFolderRows = await query(
        `SELECT id, provider_folder_id, parent_id FROM virtual_folders 
         WHERE storage_account_id = $1 AND user_id = $2 AND provider_folder_id IS NOT NULL`,
        [accountId, userId]
      );
      const folderMap = new Map<string, string>();
      for (const row of existingFolderRows.rows) {
        folderMap.set(row.provider_folder_id, row.id);
      }

      // Separate changes into folders and files so folders exist before files resolve parents
      const folderChanges = changeResult.changes.filter(c => c.file && c.file.isFolder);
      const otherChanges = changeResult.changes.filter(c => !c.file || !c.file.isFolder);

      // Process folder changes first
      for (const change of folderChanges) {
        const fileMeta = change.file!;
        const providerFolderId = change.fileId || fileMeta.providerFileId;

        if (fileMeta.isTrashed) {
          await query(
            `UPDATE virtual_folders SET
              is_trashed = TRUE,
              trashed_at = NOW(),
              updated_at = NOW()
             WHERE storage_account_id = $1 AND provider_folder_id = $2 AND user_id = $3`,
            [accountId, providerFolderId, userId]
          );
          filesUpdatedCount++;
        } else {
          // Resolve parent
          let resolvedParentId: string | null = null;
          if (fileMeta.parentFolderId && folderMap.has(fileMeta.parentFolderId)) {
            resolvedParentId = folderMap.get(fileMeta.parentFolderId)!;
          }

          const existingFolderId = folderMap.get(providerFolderId) || crypto.randomUUID();

          const upsertRes = await query<{ id: string }>(
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
              existingFolderId,
              userId,
              accountId,
              ProviderType.GOOGLE_DRIVE,
              providerFolderId,
              fileMeta.name,
              fileMeta.isStarred ?? false,
              false,
              fileMeta.createdAt,
              fileMeta.modifiedAt,
            ]
          );

          const folderId = upsertRes.rows[0]?.id || existingFolderId;
          folderMap.set(providerFolderId, folderId);

          if (resolvedParentId) {
            await query(
              `UPDATE virtual_folders SET parent_id = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
              [resolvedParentId, folderId, userId]
            );
          }

          foldersProcessedCount++;
          filesUpdatedCount++;
        }
      }

      // Process file and removal changes
      for (const change of otherChanges) {
        const providerFileId = change.fileId;

        if (change.removed || !change.file) {
          // Hard deletion upstream
          const delFileRes = await query(
            `DELETE FROM virtual_files 
             WHERE storage_account_id = $1 AND provider_file_id = $2 AND user_id = $3`,
            [accountId, providerFileId, userId]
          );
          const delFolderRes = await query(
            `DELETE FROM virtual_folders 
             WHERE storage_account_id = $1 AND provider_folder_id = $2 AND user_id = $3`,
            [accountId, providerFileId, userId]
          );
          folderMap.delete(providerFileId);
          if ((delFileRes.rowCount || 0) > 0 || (delFolderRes.rowCount || 0) > 0) {
            filesRemovedCount++;
          }
        } else if (change.file.isTrashed) {
          // Trashed upstream
          await query(
            `UPDATE virtual_files SET
              is_trashed = TRUE,
              trashed_at = NOW(),
              updated_at = NOW()
             WHERE storage_account_id = $1 AND provider_file_id = $2 AND user_id = $3`,
            [accountId, providerFileId, userId]
          );
          filesUpdatedCount++;
        } else {
          // Active file create or update
          const fileMeta = change.file;
          let resolvedParentId: string | null = null;
          if (fileMeta.parentFolderId && folderMap.has(fileMeta.parentFolderId)) {
            resolvedParentId = folderMap.get(fileMeta.parentFolderId)!;
          }

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
              trashed_at = NULL,
              provider_modified_at = EXCLUDED.provider_modified_at,
              synced_at = NOW(),
              updated_at = NOW()`,
            [
              fileId,
              userId,
              accountId,
              resolvedParentId,
              ProviderType.GOOGLE_DRIVE,
              fileMeta.providerFileId,
              fileMeta.name,
              fileMeta.mimeType,
              fileMeta.sizeBytes,
              fileMeta.md5Checksum || null,
              fileMeta.webUrl || null,
              fileMeta.isStarred ?? false,
              false,
              fileMeta.createdAt,
              fileMeta.modifiedAt,
            ]
          );
          filesAddedCount++;
        }
      }

      // 6. Refresh Quota
      const quota = await provider.getStorageQuota(accessToken);
      await accountService.updateQuota(userId, accountId, quota);

      // 7. Persist the New Token ONLY After Successful Processing
      const tokenToPersist = changeResult.newStartPageToken || changeResult.nextPageToken;
      if (tokenToPersist) {
        await accountService.updateChangeToken(userId, accountId, tokenToPersist);
      }

      // 8. Record audit record
      const syncStatus = changeResult.paginationComplete ? 'completed' : 'partial';
      const syncNote = `Delta sync processed ${changeResult.changes.length} upstream changes.`;

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
          changeResult.changes.length,
          filesAddedCount,
          filesUpdatedCount,
          filesRemovedCount,
          syncNote,
          syncStartTime.toISOString(),
        ]
      );

      // Update account status to ACTIVE
      await accountService.updateAccountStatus(userId, accountId, AccountStatus.ACTIVE, null);

      logger.info(
        `Successfully delta-synced account ${accountId}: ${changeResult.changes.length} changes (${filesAddedCount} added, ${filesUpdatedCount} updated, ${filesRemovedCount} removed)`
      );

      return {
        accountId,
        filesDiscovered: changeResult.changes.length,
        filesAddedOrUpdated: filesAddedCount + filesUpdatedCount,
        filesRemoved: filesRemovedCount,
        foldersProcessed: foldersProcessedCount,
        quotaUpdated: true,
        paginationComplete: changeResult.paginationComplete,
        timestamp: new Date().toISOString(),
        syncType: 'delta',
        changeToken: tokenToPersist || storedToken,
      };
    } catch (err: any) {
      logger.error(`Failed to delta sync account ${accountId}`, { error: err.message });
      const status = err.code === ErrorCode.TOKEN_EXPIRED ? AccountStatus.TOKEN_EXPIRED : AccountStatus.ERROR;
      await accountService.updateAccountStatus(userId, accountId, status, err.message);

      // Record failed delta sync history record for audit and observability
      try {
        await query(
          `INSERT INTO sync_history (
            id, user_id, storage_account_id, status, files_discovered,
            files_added, files_updated, files_removed, error_message, started_at, completed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [
            crypto.randomUUID(),
            userId,
            accountId,
            'failed',
            0,
            0,
            0,
            0,
            err.message || 'Delta sync failed',
            syncStartTime.toISOString(),
          ]
        );
      } catch (histErr: any) {
        logger.warn(`Failed to record delta sync failure in sync_history: ${histErr.message}`);
      }

      throw err;
    }
  }

  /**
   * Recovers sync state when an invalid or expired page token is detected.
   * Rebuilds the account metadata via full sync, establishes a fresh start page token,
   * and logs the recovery event in sync_history.
   */
  async recoverSyncState(
    userId: string,
    accountId: string,
    provider: GoogleDriveProvider,
    accessToken: string
  ): Promise<SyncResult> {
    logger.warn(`Recovering sync state for account ${accountId} following invalid/expired change token.`);
    const recoveryStart = new Date();

    // 1. Run full sync to rebuild metadata state
    const fullResult = await this.executeSyncAccount(userId, accountId);

    // 2. Fetch fresh startPageToken
    const freshToken = await provider.getStartPageToken(accessToken);

    // 3. Persist the fresh token
    await accountService.updateChangeToken(userId, accountId, freshToken);

    // 4. Audit record in sync_history
    await query(
      `INSERT INTO sync_history (
        id, user_id, storage_account_id, status, files_discovered,
        files_added, files_updated, files_removed, error_message, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        crypto.randomUUID(),
        userId,
        accountId,
        'completed',
        fullResult.filesDiscovered,
        fullResult.filesAddedOrUpdated,
        0,
        fullResult.filesRemoved || 0,
        'Recovered from invalid/expired change token via full rebuild',
        new Date().toISOString(),
      ]
    );

    return {
      ...fullResult,
      syncType: 'rebuild',
      changeToken: freshToken,
      recoveredFromInvalidToken: true,
    };
  }

  /**
   * Establishes an initial Google Drive change token for an existing connected account (Phase 3).
   */
  async establishInitialToken(userId: string, accountId: string): Promise<string> {
    const credentials = await accountService.getDecryptedCredentials(userId, accountId);
    const provider = ProviderRegistry.get(credentials.provider) as GoogleDriveProvider;
    const { accessToken } = await provider.refreshAuthentication(credentials.refreshToken);
    const token = await provider.getStartPageToken(accessToken);
    await accountService.updateChangeToken(userId, accountId, token);
    return token;
  }
}

export const syncService = new SyncService();
