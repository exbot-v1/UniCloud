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
import { ProviderFileListResult } from '../../types/provider.js';

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
   * Checks whether the account has completed a verified full initial sync.
   * Requirement 1: A change token MUST NOT be treated as proof that the initial filesystem is complete.
   */
  async isInitialSyncComplete(
    userId: string,
    accountId: string,
    account?: any
  ): Promise<boolean> {
    // 1. Check account metadata if available
    let meta = account?.provider_metadata || account?.providerMetadata;
    let driveChangeToken = account?.drive_change_token || account?.driveChangeToken;

    if (!meta || driveChangeToken === undefined) {
      const res = await query<{ provider_metadata: any; drive_change_token: string | null }>(
        `SELECT drive_change_token, provider_metadata FROM storage_accounts WHERE id = $1 AND user_id = $2`,
        [accountId, userId]
      );
      if (res.rowCount === 0) return false;
      meta = res.rows[0].provider_metadata;
      driveChangeToken = res.rows[0].drive_change_token || (meta as any)?.driveChangeToken;
    }

    if (typeof meta === 'string') {
      try {
        meta = JSON.parse(meta);
      } catch {
        meta = {};
      }
    }

    // Explicit flag in provider_metadata
    if ((meta as any)?.initialSyncCompleted === true) {
      return true;
    }
    if ((meta as any)?.initialSyncCompleted === false) {
      return false;
    }

    // If there is no change token at all, initial sync is definitely incomplete
    if (!driveChangeToken) {
      return false;
    }

    // Check sync_history for a verified, completed full sync
    const historyRes = await query<{
      status: string;
      error_message: string | null;
      files_discovered: number;
    }>(
      `SELECT status, error_message, files_discovered FROM sync_history 
       WHERE storage_account_id = $1 AND user_id = $2
       ORDER BY started_at DESC`,
      [accountId, userId]
    );

    if (historyRes.rows.length === 0) {
      return false;
    }

    // Account has a verified completed initial sync if there is at least one completed full sync
    // that was not merely an initial token establishment or delta sync
    const hasCompletedFullSync = historyRes.rows.some((row) => {
      if (row.status !== 'completed') return false;
      const msg = row.error_message || '';
      if (msg.includes('Established initial change token')) return false;
      if (msg.includes('Delta sync')) return false;
      return true;
    });

    return hasCompletedFullSync;
  }

  /**
   * Helper to detect whether a virtual folder row represents the synthetic or root folder.
   * Supports Google Drive's "root" alias and any persisted My Drive root mapping.
   * Does not rely solely on a hard-coded provider ID.
   */
  private isRootVirtualFolderRecord(
    folder: {
      id?: string;
      provider_folder_id?: string | null;
      parent_id?: string | null;
      name?: string | null;
    },
    providerMetadata?: any
  ): boolean {
    if (!folder) return false;

    // 1. Google Drive canonical alias
    if (folder.provider_folder_id === 'root') {
      return true;
    }

    // 2. Name is "My Drive" (case-insensitive)
    const normName = folder.name?.trim().toLowerCase();
    if (normName === 'my drive') {
      return true;
    }

    // 3. Name is "root" with null/undefined parent
    if (normName === 'root' && (folder.parent_id === null || folder.parent_id === undefined)) {
      return true;
    }

    // 4. Matches account provider_metadata root mapping
    if (providerMetadata) {
      if (providerMetadata.rootFolderId && folder.provider_folder_id === providerMetadata.rootFolderId) {
        return true;
      }
      if (providerMetadata.driveRootId && folder.provider_folder_id === providerMetadata.driveRootId) {
        return true;
      }
      if (providerMetadata.virtualRootFolderId && folder.id === providerMetadata.virtualRootFolderId) {
        return true;
      }
      if (providerMetadata.rootVirtualFolderId && folder.id === providerMetadata.rootVirtualFolderId) {
        return true;
      }
    }

    return false;
  }

  /**
   * Resolves the authoritative virtual folder UUID for a provider folder ID.
   * Checks the in-memory folderMap, then PostgreSQL virtual_folders, then queries Google Drive
   * to discover and upsert any missing parent folder.
   * Never stores Google provider folder ID in parent_id and never prematurely falls back to root.
   */
  private async resolveAuthoritativeParentId(
    providerParentId: string | null | undefined,
    folderMap: Map<string, string>,
    userId: string,
    accountId: string,
    provider: GoogleDriveProvider,
    accessToken: string,
    existingParentId?: string | null
  ): Promise<string | null> {
    if (!providerParentId || providerParentId === 'root') {
      return null;
    }

    // 1. Check in-memory folderMap
    if (folderMap.has(providerParentId)) {
      return folderMap.get(providerParentId)!;
    }

    // 2. Check database
    const dbRes = await query<{ id: string }>(
      `SELECT id FROM virtual_folders 
       WHERE storage_account_id = $1 AND provider_folder_id = $2 AND user_id = $3
       LIMIT 1`,
      [accountId, providerParentId, userId]
    );
    if (dbRes.rows.length > 0) {
      const vId = dbRes.rows[0].id;
      folderMap.set(providerParentId, vId);
      return vId;
    }

    // 3. Resolve from upstream Google Drive if parent folder record is missing
    try {
      const parentMeta = await provider.getFileMetadata(accessToken, providerParentId);
      if (parentMeta && parentMeta.isFolder && (parentMeta.ownedByMe !== false && !parentMeta.isShared)) {
        const grandParentId = await this.resolveAuthoritativeParentId(
          parentMeta.parentFolderId,
          folderMap,
          userId,
          accountId,
          provider,
          accessToken
        );

        const newFolderId = crypto.randomUUID();
        const upsertRes = await query<{ id: string }>(
          `INSERT INTO virtual_folders (
            id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
            name, is_starred, is_trashed, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
          ON CONFLICT (storage_account_id, provider_folder_id) DO UPDATE SET
            parent_id = COALESCE(EXCLUDED.parent_id, virtual_folders.parent_id),
            name = EXCLUDED.name,
            is_starred = EXCLUDED.is_starred,
            is_trashed = EXCLUDED.is_trashed,
            updated_at = NOW()
          RETURNING id`,
          [
            newFolderId,
            userId,
            grandParentId,
            accountId,
            ProviderType.GOOGLE_DRIVE,
            providerParentId,
            parentMeta.name,
            parentMeta.isStarred ?? false,
            parentMeta.isTrashed ?? false,
            parentMeta.createdAt,
          ]
        );
        const resolvedId = upsertRes.rows[0]?.id || newFolderId;
        folderMap.set(providerParentId, resolvedId);
        return resolvedId;
      }
    } catch (parentErr: any) {
      logger.warn(`Could not resolve upstream parent folder ${providerParentId}: ${parentErr.message}`);
    }

    // 4. Safety: Never re-parent missing children to root merely because a mapping is temporarily missing.
    // If existingParentId was already set, preserve it.
    if (existingParentId !== undefined && existingParentId !== null) {
      return existingParentId;
    }

    // Default to root only if item has no previous parent
    return null;
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

      // 3. Query Drive Metadata with complete pagination (owned items only)
      const listResult = await provider.listFiles(accessToken, {
        fetchAllPages: true,
        pageSize: 100,
        includeShared: false,
      });

      // Filter out unowned and shared items to strictly respect ownership
      const ownedFiles = listResult.files.filter(
        (item) => item.ownedByMe !== false && !item.isShared
      );
      const initialFolderItems = ownedFiles.filter((item) => item.isFolder);
      const initialFileItems = ownedFiles.filter((item) => !item.isFolder);

      // Load existing folder mappings for this account
      const existingFolderRows = await query<{
        id: string;
        provider_folder_id: string | null;
        parent_id: string | null;
        name: string;
        is_trashed: boolean;
      }>(
        `SELECT id, provider_folder_id, parent_id, name, is_trashed FROM virtual_folders 
         WHERE storage_account_id = $1`,
        [accountId]
      );

      const rootVirtualFolderIds = new Set<string>();
      const rootProviderFolderIds = new Set<string>(['root']);

      const providerMetadata = (account as any)?.providerMetadata || (account as any)?.provider_metadata;
      if (providerMetadata) {
        if (providerMetadata.rootFolderId) rootProviderFolderIds.add(providerMetadata.rootFolderId);
        if (providerMetadata.driveRootId) rootProviderFolderIds.add(providerMetadata.driveRootId);
        if (providerMetadata.virtualRootFolderId) rootVirtualFolderIds.add(providerMetadata.virtualRootFolderId);
        if (providerMetadata.rootVirtualFolderId) rootVirtualFolderIds.add(providerMetadata.rootVirtualFolderId);
      }

      for (const row of existingFolderRows.rows) {
        if (this.isRootVirtualFolderRecord(row, providerMetadata)) {
          rootVirtualFolderIds.add(row.id);
          if (row.provider_folder_id) {
            rootProviderFolderIds.add(row.provider_folder_id);
          }
        }
      }

      const folderMap = new Map<string, string>(); // Google provider folder ID -> authoritative virtual_folders UUID
      for (const row of existingFolderRows.rows) {
        if (row.provider_folder_id) {
          folderMap.set(row.provider_folder_id, row.id);
        }
      }

      // If we identified root virtual folders, ensure root aliases map to it in folderMap
      for (const rootId of rootVirtualFolderIds) {
        for (const pId of rootProviderFolderIds) {
          if (!folderMap.has(pId)) {
            folderMap.set(pId, rootId);
          }
        }
      }

      // PASS 1: Upsert all initially discovered folders and establish authoritative virtual folder IDs
      for (const folder of initialFolderItems) {
        const existingId = folderMap.get(folder.providerFileId);
        const folderId = existingId || crypto.randomUUID();

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
            folderId,
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

        const authoritativeFolderId = upsertResult.rows[0]?.id || folderId;
        folderMap.set(folder.providerFileId, authoritativeFolderId);
      }

      // PASS 1.5: Resolve folder-to-folder parent relationships
      for (const folder of initialFolderItems) {
        const virtualFolderId = folderMap.get(folder.providerFileId)!;
        const candidateParents = [
          ...(folder.parentFolderIds || []),
          folder.parentFolderId,
        ].filter((p): p is string => Boolean(p));

        let resolvedParentId: string | null = null;
        for (const p of candidateParents) {
          resolvedParentId = await this.resolveAuthoritativeParentId(
            p,
            folderMap,
            userId,
            accountId,
            provider,
            accessToken
          );
          if (resolvedParentId) {
            break;
          }
        }

        // Prevent self-referencing hierarchy
        if (resolvedParentId === virtualFolderId) {
          resolvedParentId = null;
        }

        await query(
          `UPDATE virtual_folders SET
            parent_id = $1,
            updated_at = NOW()
           WHERE id = $2 AND user_id = $3`,
          [resolvedParentId, virtualFolderId, userId]
        );
      }

      // PASS 2: Authoritative Direct-Folder Reconciliation
      // Query direct children for root and every known folder from Google Drive
      let allQueriesPaginationComplete = listResult.paginationComplete;
      const seenFileProviderIds = new Set<string>();
      const allDiscoveredItemIds = new Set<string>(ownedFiles.map(f => f.providerFileId));
      let filesAddedOrUpdatedCount = 0;

      const foldersToQuery: Array<{ providerFolderId: string; virtualFolderId: string | null }> = [];

      for (const [pFolderId, vFolderUuid] of folderMap.entries()) {
        foldersToQuery.push({ providerFolderId: pFolderId, virtualFolderId: vFolderUuid });
      }

      const visitedFolders = new Set<string>();

      const fetchFolderContents = async (
        targetFolderId: string
      ): Promise<ProviderFileListResult> => {
        if (typeof provider.listFilesInFolder === 'function') {
          return await provider.listFilesInFolder(accessToken, targetFolderId, {
            fetchAllPages: true,
            pageSize: 100,
            includeShared: false,
            includeTrashed: false,
          });
        }
        if (typeof provider.listFolderChildren === 'function') {
          return await provider.listFolderChildren(accessToken, targetFolderId, {
            fetchAllPages: true,
            pageSize: 100,
            includeShared: false,
            includeTrashed: false,
          });
        }
        return await provider.listFiles(accessToken, {
          folderId: targetFolderId,
          fetchAllPages: true,
          pageSize: 100,
          includeShared: false,
          includeTrashed: false,
        });
      };

      while (foldersToQuery.length > 0) {
        const target = foldersToQuery.shift()!;
        if (visitedFolders.has(target.providerFolderId)) {
          continue;
        }
        visitedFolders.add(target.providerFolderId);

        let directChildren: ProviderFileListResult;
        try {
          directChildren = await fetchFolderContents(target.providerFolderId);
        } catch (folderListErr: any) {
          logger.warn(
            `Failed to query direct folder contents for ${target.providerFolderId}: ${folderListErr.message}`
          );
          allQueriesPaginationComplete = false;
          continue;
        }

        if (!directChildren.paginationComplete) {
          allQueriesPaginationComplete = false;
        }

        const isTargetRoot =
          target.providerFolderId === 'root' ||
          rootProviderFolderIds.has(target.providerFolderId) ||
          (target.virtualFolderId !== null && rootVirtualFolderIds.has(target.virtualFolderId));

        // When child enumeration succeeds for the target folder:
        // If it's the root/My Drive virtual folder, touch its updated_at timestamp and ensure is_trashed is false
        if (target.virtualFolderId && isTargetRoot) {
          await query(
            `UPDATE virtual_folders SET
              updated_at = NOW(),
              is_trashed = FALSE,
              trashed_at = NULL
             WHERE id = $1 AND user_id = $2`,
            [target.virtualFolderId, userId]
          );
        }

        for (const child of directChildren.files) {
          // Ownership rule: only sync owned files/folders, exclude unowned/shared items
          if (child.ownedByMe === false || child.isShared) {
            continue;
          }

          allDiscoveredItemIds.add(child.providerFileId);

          // Verify child is directly under target folder.
          const isDirectChild = isTargetRoot
            ? (!child.parentFolderId || child.parentFolderId === 'root' || rootProviderFolderIds.has(child.parentFolderId) || child.parentFolderIds?.includes('root') || child.parentFolderIds?.some(p => rootProviderFolderIds.has(p)))
            : (
                child.parentFolderId === target.providerFolderId ||
                (child.parentFolderIds && child.parentFolderIds.includes(target.providerFolderId))
              );

          if (!isDirectChild) {
            continue;
          }

          if (!child.parentFolderId && !isTargetRoot) {
            child.parentFolderId = target.providerFolderId;
          }

          if (child.isFolder) {
            const existingFolderId = folderMap.get(child.providerFileId);
            const folderId = existingFolderId || crypto.randomUUID();

            const upsertResult = await query<{ id: string }>(
              `INSERT INTO virtual_folders (
                id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
                name, is_starred, is_trashed, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (storage_account_id, provider_folder_id) DO UPDATE SET
                parent_id = EXCLUDED.parent_id,
                name = EXCLUDED.name,
                is_starred = EXCLUDED.is_starred,
                is_trashed = EXCLUDED.is_trashed,
                updated_at = NOW()
              RETURNING id`,
              [
                folderId,
                userId,
                target.virtualFolderId, // Authoritative parent virtual UUID
                accountId,
                ProviderType.GOOGLE_DRIVE,
                child.providerFileId,
                child.name,
                child.isStarred ?? false,
                child.isTrashed ?? false,
                child.createdAt,
                child.modifiedAt,
              ]
            );

            const authoritativeFolderId = upsertResult.rows[0]?.id || folderId;
            folderMap.set(child.providerFileId, authoritativeFolderId);

            if (!visitedFolders.has(child.providerFileId)) {
              foldersToQuery.push({
                providerFolderId: child.providerFileId,
                virtualFolderId: authoritativeFolderId,
              });
            }
          } else {
            // Child File: authoritatively set parent_id to current virtual folder UUID
            seenFileProviderIds.add(child.providerFileId);
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
                target.virtualFolderId, // Authoritative virtual folder UUID (or null for root)
                ProviderType.GOOGLE_DRIVE,
                child.providerFileId,
                child.name,
                child.mimeType,
                child.sizeBytes,
                child.md5Checksum || null,
                child.webUrl || null,
                child.isStarred ?? false,
                child.isTrashed ?? false,
                child.createdAt,
                child.modifiedAt,
              ]
            );
            filesAddedOrUpdatedCount++;
          }
        }
      }

      // PASS 3: Upsert any remaining file items from initial listing not covered in folder listings
      for (const file of initialFileItems) {
        if (seenFileProviderIds.has(file.providerFileId)) {
          continue;
        }

        if (file.ownedByMe === false || file.isShared) {
          continue;
        }

        const candidateParents = [
          ...(file.parentFolderIds || []),
          file.parentFolderId,
        ].filter((p): p is string => Boolean(p));

        let resolvedParentId: string | null = null;
        for (const p of candidateParents) {
          resolvedParentId = await this.resolveAuthoritativeParentId(
            p,
            folderMap,
            userId,
            accountId,
            provider,
            accessToken
          );
          if (resolvedParentId) {
            break;
          }
        }

        const fileId = crypto.randomUUID();
        await query(
          `INSERT INTO virtual_files (
            id, user_id, storage_account_id, parent_id, provider, provider_file_id,
            name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
            provider_created_at, provider_modified_at, synced_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW(), NOW())
          ON CONFLICT (storage_account_id, provider_file_id) DO UPDATE SET
            parent_id = COALESCE(EXCLUDED.parent_id, virtual_files.parent_id),
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
        seenFileProviderIds.add(file.providerFileId);
        filesAddedOrUpdatedCount++;
      }

      // 5. Detect and mark stale / unowned / deleted upstream files as trashed ONLY when pagination was complete
      let filesRemoved = 0;
      let startChangeToken: string | null = null;

      if (allQueriesPaginationComplete) {
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

        // Reconcile stale / unowned folders (e.g. shared folders previously imported)
        // Root-safe: Never mark the special My Drive/root virtual folder as trashed
        const rootIdsArray = Array.from(rootVirtualFolderIds);
        if (rootIdsArray.length > 0) {
          await query(
            `UPDATE virtual_folders SET
              is_trashed = TRUE,
              trashed_at = NOW(),
              updated_at = NOW()
             WHERE storage_account_id = $1
               AND user_id = $2
               AND is_trashed = FALSE
               AND updated_at < $3
               AND id != ALL($4)
               AND (provider_folder_id IS NULL OR provider_folder_id != 'root')
               AND LOWER(TRIM(name)) != 'my drive'
               AND (parent_id IS NOT NULL OR LOWER(TRIM(name)) != 'root')`,
            [accountId, userId, syncStartTime.toISOString(), rootIdsArray]
          );
        } else {
          await query(
            `UPDATE virtual_folders SET
              is_trashed = TRUE,
              trashed_at = NOW(),
              updated_at = NOW()
             WHERE storage_account_id = $1
               AND user_id = $2
               AND is_trashed = FALSE
               AND updated_at < $3
               AND (provider_folder_id IS NULL OR provider_folder_id != 'root')
               AND LOWER(TRIM(name)) != 'my drive'
               AND (parent_id IS NOT NULL OR LOWER(TRIM(name)) != 'root')`,
            [accountId, userId, syncStartTime.toISOString()]
          );
        }

        // Ensure any existing root/My Drive virtual folders remain active and not trashed
        if (rootIdsArray.length > 0) {
          await query(
            `UPDATE virtual_folders SET
              is_trashed = FALSE,
              trashed_at = NULL,
              updated_at = NOW()
             WHERE storage_account_id = $1
               AND user_id = $2
               AND id = ANY($3)`,
            [accountId, userId, rootIdsArray]
          );
        }
        await query(
          `UPDATE virtual_folders SET
            is_trashed = FALSE,
            trashed_at = NULL,
            updated_at = NOW()
           WHERE storage_account_id = $1
             AND user_id = $2
             AND (
               provider_folder_id = 'root'
               OR LOWER(TRIM(name)) = 'my drive'
               OR (parent_id IS NULL AND LOWER(TRIM(name)) = 'root')
             )`,
          [accountId, userId]
        );

        // Mark initial sync complete in account metadata
        await accountService.setInitialSyncCompleted(userId, accountId, true);

        // Establish and persist baseline start change token ONLY after successful complete full sync (Phase 3)
        try {
          startChangeToken = await provider.getStartPageToken(accessToken);
        } catch (tokenErr: any) {
          logger.warn(`Could not establish start page token during full sync: ${tokenErr.message}`);
        }
        if (startChangeToken) {
          await accountService.updateChangeToken(userId, accountId, startChangeToken);
        }
      } else {
        logger.warn(
          `Account ${accountId} sync pagination was truncated or incomplete. Stale file reconciliation skipped, change token will NOT be established, and initial sync is marked incomplete.`
        );
        await accountService.setInitialSyncCompleted(userId, accountId, false);
      }

      // 7. Record sync audit record
      const syncStatus = allQueriesPaginationComplete ? 'completed' : 'partial';
      const syncNote = allQueriesPaginationComplete
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
          allDiscoveredItemIds.size,
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
        `Successfully synced account ${accountId}: ${filesAddedOrUpdatedCount} files, ${folderMap.size} folders, ${filesRemoved} stale files marked trashed (paginationComplete: ${allQueriesPaginationComplete})`
      );

      return {
        accountId,
        filesDiscovered: allDiscoveredItemIds.size,
        filesAddedOrUpdated: filesAddedOrUpdatedCount,
        filesRemoved,
        foldersProcessed: folderMap.size,
        quotaUpdated: true,
        paginationComplete: allQueriesPaginationComplete,
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

      // 2. Verify account has completed a verified full initial sync
      const isInitComplete = await this.isInitialSyncComplete(userId, accountId, account);
      if (!isInitComplete) {
        logger.info(
          `Account ${accountId} lacks a verified completed initial sync. Redirecting to full sync rebuild.`
        );
        return await this.executeSyncAccount(userId, accountId);
      }

      // 3. Retrieve Stored Change Token
      let storedToken = await accountService.getChangeToken(userId, accountId);
      if (!storedToken) {
        logger.info(
          `Account ${accountId} has no stored change token. Redirecting to full sync.`
        );
        return await this.executeSyncAccount(userId, accountId);
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

        // Apply ownership rule: exclude unowned / shared folders
        if (fileMeta.ownedByMe === false || fileMeta.isShared) {
          continue;
        }

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
          const candidateParents = [
            ...(fileMeta.parentFolderIds || []),
            fileMeta.parentFolderId,
          ].filter((p): p is string => Boolean(p));

          let resolvedParentId: string | null = null;
          for (const p of candidateParents) {
            resolvedParentId = await this.resolveAuthoritativeParentId(
              p,
              folderMap,
              userId,
              accountId,
              provider,
              accessToken
            );
            if (resolvedParentId) break;
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

          if (resolvedParentId && resolvedParentId !== folderId) {
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

          // Apply ownership rule: exclude unowned / shared files
          if (fileMeta.ownedByMe === false || fileMeta.isShared) {
            continue;
          }

          const candidateParents = [
            ...(fileMeta.parentFolderIds || []),
            fileMeta.parentFolderId,
          ].filter((p): p is string => Boolean(p));

          let resolvedParentId: string | null = null;
          for (const p of candidateParents) {
            resolvedParentId = await this.resolveAuthoritativeParentId(
              p,
              folderMap,
              userId,
              accountId,
              provider,
              accessToken
            );
            if (resolvedParentId) break;
          }

          const fileId = crypto.randomUUID();
          await query(
            `INSERT INTO virtual_files (
              id, user_id, storage_account_id, parent_id, provider, provider_file_id,
              name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
              provider_created_at, provider_modified_at, synced_at, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW(), NOW())
            ON CONFLICT (storage_account_id, provider_file_id) DO UPDATE SET
              parent_id = COALESCE(EXCLUDED.parent_id, virtual_files.parent_id),
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

  /**
   * Synchronizes the contents of a specific folder from the cloud provider on-demand.
   * Resolves the target virtual folder, retrieves direct children via listFilesInFolder (owned only),
   * and upserts all discovered files and subfolders into virtual_files and virtual_folders.
   * When pagination is complete, safely reconciles and marks stale direct children as trashed.
   */
  async syncFolder(
    userId: string,
    folderId: string
  ): Promise<{ filesCount: number; foldersCount: number }> {
    const folRes = await query<{
      id: string;
      storage_account_id: string;
      provider: ProviderType;
      provider_folder_id: string;
      name: string;
    }>(
      `SELECT id, storage_account_id, provider, provider_folder_id, name 
       FROM virtual_folders 
       WHERE (id = $1 OR provider_folder_id = $1) AND user_id = $2
       LIMIT 1`,
      [folderId, userId]
    );

    if (folRes.rows.length === 0) {
      throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Folder not found', 404);
    }

    const folderRow = folRes.rows[0];
    const accountId = folderRow.storage_account_id;
    const providerFolderId = folderRow.provider_folder_id;
    const virtualFolderId = folderRow.id;

    const credentials = await accountService.getDecryptedCredentials(userId, accountId);
    const provider = ProviderRegistry.get(credentials.provider);
    const { accessToken } = await provider.refreshAuthentication(credentials.refreshToken);

    const folderSyncStartTime = new Date();

    const directChildren = await provider.listFilesInFolder(accessToken, providerFolderId, {
      fetchAllPages: true,
      pageSize: 100,
      includeShared: false,
      includeTrashed: false,
    });

    let filesCount = 0;
    let foldersCount = 0;

    for (const child of directChildren.files) {
      // Apply ownership rule: exclude unowned / shared items
      if (child.ownedByMe === false || child.isShared) {
        continue;
      }

      if (child.isFolder) {
        foldersCount++;
        await query(
          `INSERT INTO virtual_folders (
            id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
            name, is_starred, is_trashed, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (storage_account_id, provider_folder_id) DO UPDATE SET
            parent_id = EXCLUDED.parent_id,
            name = EXCLUDED.name,
            is_starred = EXCLUDED.is_starred,
            is_trashed = EXCLUDED.is_trashed,
            updated_at = NOW()`,
          [
            crypto.randomUUID(),
            userId,
            virtualFolderId, // Always authoritative virtual UUID, never provider ID
            accountId,
            folderRow.provider,
            child.providerFileId,
            child.name,
            child.isStarred ?? false,
            child.isTrashed ?? false,
            child.createdAt,
            child.modifiedAt,
          ]
        );
      } else {
        filesCount++;
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
            crypto.randomUUID(),
            userId,
            accountId,
            virtualFolderId, // Always authoritative virtual UUID, never provider ID
            folderRow.provider,
            child.providerFileId,
            child.name,
            child.mimeType,
            child.sizeBytes,
            child.md5Checksum || null,
            child.webUrl || null,
            child.isStarred ?? false,
            child.isTrashed ?? false,
            child.createdAt,
            child.modifiedAt,
          ]
        );
      }
    }

    // Reconcile direct children against PostgreSQL safely (ONLY if pagination completed)
    if (directChildren.paginationComplete) {
      await query(
        `UPDATE virtual_files SET
          is_trashed = TRUE,
          trashed_at = NOW(),
          updated_at = NOW()
         WHERE storage_account_id = $1
           AND user_id = $2
           AND parent_id = $3
           AND is_trashed = FALSE
           AND synced_at < $4`,
        [accountId, userId, virtualFolderId, folderSyncStartTime.toISOString()]
      );

      await query(
        `UPDATE virtual_folders SET
          is_trashed = TRUE,
          trashed_at = NOW(),
          updated_at = NOW()
         WHERE storage_account_id = $1
           AND user_id = $2
           AND parent_id = $3
           AND is_trashed = FALSE
           AND updated_at < $4
           AND (provider_folder_id IS NULL OR provider_folder_id != 'root')
           AND LOWER(TRIM(name)) != 'my drive'`,
        [accountId, userId, virtualFolderId, folderSyncStartTime.toISOString()]
      );
    }

    logger.info(
      `Synchronized folder ${folderRow.name} (${virtualFolderId}): ${filesCount} files, ${foldersCount} subfolders`
    );
    return { filesCount, foldersCount };
  }
}

export const syncService = new SyncService();
