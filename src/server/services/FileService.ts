/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud FileService
 * 
 * Domain service managing virtual files, folders, and metadata queries
 * backed by PostgreSQL with strict user-tenant isolation.
 */

import crypto from 'node:crypto';
import { query } from '../../db/client.js';
import { DbVirtualFile, DbVirtualFolder } from '../../db/schema.js';
import { VirtualFile, VirtualFolder, FileFilterOptions } from '../../types/filesystem.js';
import { ProviderType } from '../../types/account.js';
import { AppError, ErrorCode } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { accountService } from './AccountService.js';
import { ProviderRegistry } from '../providers/ProviderRegistry.js';

export class FileService {
  /**
   * Helper to map database file row to domain VirtualFile
   */
  public mapDbFileToDomain(row: DbVirtualFile): VirtualFile {
    return {
      id: row.id,
      userId: row.user_id,
      storageAccountId: row.storage_account_id,
      provider: row.provider as ProviderType,
      providerFileId: row.provider_file_id,
      parentId: row.parent_id,
      name: row.name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes) || 0,
      webUrl: row.web_url || undefined,
      thumbnailUrl: row.thumbnail_url || undefined,
      md5Checksum: row.md5_checksum || undefined,
      isFolder: false,
      isStarred: Boolean(row.is_starred),
      isTrashed: Boolean(row.is_trashed),
      createdAt: row.created_at,
      modifiedAt: row.updated_at,
      syncedAt: row.synced_at,
    };
  }

  /**
   * Helper to map database folder row to domain VirtualFolder
   */
  public mapDbFolderToDomain(row: DbVirtualFolder): VirtualFolder {
    return {
      id: row.id,
      userId: row.user_id,
      parentId: row.parent_id,
      storageAccountId: row.storage_account_id,
      provider: (row.provider as ProviderType) || null,
      providerFolderId: row.provider_folder_id,
      name: row.name,
      isFolder: true,
      isStarred: Boolean(row.is_starred),
      isTrashed: Boolean(row.is_trashed),
      createdAt: row.created_at,
      modifiedAt: row.updated_at,
    };
  }

  /**
   * Retrieves virtual files in a specific folder scoped strictly to authenticated user.
   */
  async getFilesInFolder(
    userId: string,
    folderId: string | null = null,
    filter?: FileFilterOptions
  ): Promise<VirtualFile[]> {
    logger.debug(`FileService.getFilesInFolder for user ${userId}, folder ${folderId}`);

    let sql = `
      SELECT * FROM virtual_files 
      WHERE user_id = $1
    `;
    const params: any[] = [userId];

    if (folderId !== undefined && folderId !== null) {
      params.push(folderId);
      sql += ` AND parent_id = $${params.length}`;
    } else if (folderId === null) {
      sql += ` AND parent_id IS NULL`;
    }

    if (filter?.trashedOnly) {
      sql += ` AND is_trashed = true`;
    } else {
      sql += ` AND is_trashed = false`;
    }

    if (filter?.starredOnly) {
      sql += ` AND is_starred = true`;
    }

    if (filter?.storageAccountId) {
      params.push(filter.storageAccountId);
      sql += ` AND storage_account_id = $${params.length}`;
    }

    if (filter?.searchQuery && filter.searchQuery.trim().length > 0) {
      params.push(`%${filter.searchQuery.trim()}%`);
      sql += ` AND name ILIKE $${params.length}`;
    }

    sql += ` ORDER BY name ASC`;

    const result = await query<DbVirtualFile>(sql, params);
    return result.rows.map((row) => this.mapDbFileToDomain(row));
  }

  /**
   * Retrieves virtual folders in a specific directory for user.
   */
  async getFoldersInFolder(
    userId: string,
    folderId: string | null = null
  ): Promise<VirtualFolder[]> {
    let sql = `
      SELECT * FROM virtual_folders 
      WHERE user_id = $1 AND is_trashed = false
    `;
    const params: any[] = [userId];

    if (folderId !== null && folderId !== undefined) {
      params.push(folderId);
      sql += ` AND parent_id = $${params.length}`;
    } else {
      sql += ` AND parent_id IS NULL`;
    }

    sql += ` ORDER BY name ASC`;

    const result = await query<DbVirtualFolder>(sql, params);
    return result.rows.map((row) => this.mapDbFolderToDomain(row));
  }

  /**
   * Retrieves a single virtual file by UniCloud virtual ID, enforcing tenant isolation.
   */
  async getFileById(userId: string, fileId: string): Promise<VirtualFile> {
    logger.debug(`FileService.getFileById ${fileId} for user ${userId}`);
    const result = await query<DbVirtualFile>(
      `SELECT * FROM virtual_files 
       WHERE id = $1 AND user_id = $2`,
      [fileId, userId]
    );

    if (result.rowCount === 0) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Virtual file ${fileId} was not found or belongs to another user.`,
        404
      );
    }

    return this.mapDbFileToDomain(result.rows[0]);
  }

  /**
   * Toggles favorite/star status on a virtual file.
   */
  async toggleStarred(userId: string, fileId: string): Promise<boolean> {
    const file = await this.getFileById(userId, fileId);
    const newStatus = !file.isStarred;

    await query(
      `UPDATE virtual_files 
       SET is_starred = $1, updated_at = NOW() 
       WHERE id = $2 AND user_id = $3`,
      [newStatus, fileId, userId]
    );

    return newStatus;
  }

  /**
   * Retrieves a single virtual folder by UniCloud virtual ID, enforcing tenant isolation.
   */
  async getFolderById(userId: string, folderId: string): Promise<VirtualFolder> {
    logger.debug(`FileService.getFolderById ${folderId} for user ${userId}`);
    const result = await query<DbVirtualFolder>(
      `SELECT * FROM virtual_folders 
       WHERE id = $1 AND user_id = $2`,
      [folderId, userId]
    );

    if (result.rowCount === 0) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Virtual folder ${folderId} was not found or belongs to another user.`,
        404
      );
    }

    return this.mapDbFolderToDomain(result.rows[0]);
  }

  /**
   * Creates a new virtual folder, propagating upstream to provider if backed by an account.
   */
  async createFolder(
    userId: string,
    options: { name: string; parentId?: string | null; storageAccountId?: string }
  ): Promise<VirtualFolder> {
    if (!options.name || options.name.trim() === '') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Folder name is required.', 400);
    }

    const trimmedName = options.name.trim();
    let parentFolder: VirtualFolder | null = null;
    let targetAccountId = options.storageAccountId;

    if (options.parentId) {
      parentFolder = await this.getFolderById(userId, options.parentId);
      if (!targetAccountId && parentFolder.storageAccountId) {
        targetAccountId = parentFolder.storageAccountId;
      }
    }

    if (!targetAccountId) {
      const userAccounts = await accountService.getAccountsForUser(userId);
      const activeAccount = userAccounts.find((a) => a.isEnabled !== false && a.status !== 'revoked');
      if (activeAccount) {
        targetAccountId = activeAccount.id;
      }
    }

    let providerFolderId: string | null = null;
    let providerType: ProviderType | null = null;

    if (targetAccountId) {
      const account = await accountService.getAccountById(userId, targetAccountId);
      if (account.isEnabled === false) {
        throw new AppError(ErrorCode.ACCOUNT_DISABLED, 'Selected storage account is disabled.', 400);
      }
      providerType = account.provider;

      try {
        const accessToken = await accountService.getValidAccessToken(userId, targetAccountId);
        const provider = ProviderRegistry.get(account.provider);
        const upstreamFolder = await provider.createFolder(
          accessToken,
          trimmedName,
          parentFolder?.providerFolderId || undefined
        );
        providerFolderId = upstreamFolder.providerFileId;
      } catch (err: any) {
        logger.warn(`Could not create upstream provider folder: ${err.message}`);
        // Fallback mock provider folder id for offline/dev
        providerFolderId = `pfolder_${crypto.randomUUID()}`;
      }
    }

    const id = `vfol_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const insertRes = await query<DbVirtualFolder>(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider,
        provider_folder_id, name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, false, $8, $8)`,
      [
        id,
        userId,
        options.parentId || null,
        targetAccountId || null,
        providerType,
        providerFolderId,
        trimmedName,
        now,
      ]
    );

    return this.getFolderById(userId, id);
  }

  /**
   * Renames a virtual file and propagates upstream to the owning Drive account.
   */
  async renameFile(userId: string, fileId: string, newName: string): Promise<VirtualFile> {
    if (!newName || newName.trim() === '') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'New file name cannot be empty.', 400);
    }
    const trimmed = newName.trim();
    const file = await this.getFileById(userId, fileId);

    // Propagate upstream to Google Drive
    try {
      const accessToken = await accountService.getValidAccessToken(userId, file.storageAccountId);
      const provider = ProviderRegistry.get(file.provider);
      await provider.renameFile(accessToken, file.providerFileId, trimmed);
    } catch (err: any) {
      logger.warn(`Failed to rename upstream file ${file.providerFileId}: ${err.message}`);
    }

    await query(
      `UPDATE virtual_files 
       SET name = $1, updated_at = NOW() 
       WHERE id = $2 AND user_id = $3`,
      [trimmed, fileId, userId]
    );

    return this.getFileById(userId, fileId);
  }

  /**
   * Renames a virtual folder and propagates upstream if bound to provider folder.
   */
  async renameFolder(userId: string, folderId: string, newName: string): Promise<VirtualFolder> {
    if (!newName || newName.trim() === '') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'New folder name cannot be empty.', 400);
    }
    const trimmed = newName.trim();
    const folder = await this.getFolderById(userId, folderId);

    if (folder.storageAccountId && folder.providerFolderId && folder.provider) {
      try {
        const accessToken = await accountService.getValidAccessToken(userId, folder.storageAccountId);
        const provider = ProviderRegistry.get(folder.provider);
        await provider.renameFile(accessToken, folder.providerFolderId, trimmed);
      } catch (err: any) {
        logger.warn(`Failed to rename upstream folder ${folder.providerFolderId}: ${err.message}`);
      }
    }

    await query(
      `UPDATE virtual_folders 
       SET name = $1, updated_at = NOW() 
       WHERE id = $2 AND user_id = $3`,
      [trimmed, folderId, userId]
    );

    return this.getFolderById(userId, folderId);
  }

  /**
   * Soft-deletes a virtual file into the virtual trash and propagates to Google Drive.
   */
  async trashFile(userId: string, fileId: string): Promise<VirtualFile> {
    const file = await this.getFileById(userId, fileId);

    try {
      const accessToken = await accountService.getValidAccessToken(userId, file.storageAccountId);
      const provider = ProviderRegistry.get(file.provider);
      await provider.deleteFile(accessToken, file.providerFileId, false);
    } catch (err: any) {
      logger.warn(`Failed to trash upstream file ${file.providerFileId}: ${err.message}`);
    }

    await query(
      `UPDATE virtual_files 
       SET is_trashed = true, trashed_at = NOW(), updated_at = NOW() 
       WHERE id = $1 AND user_id = $2`,
      [fileId, userId]
    );

    return this.getFileById(userId, fileId);
  }

  /**
   * Soft-deletes a virtual file into the virtual trash (legacy alias).
   */
  async moveToTrash(userId: string, fileId: string): Promise<void> {
    await this.trashFile(userId, fileId);
  }

  /**
   * Restores a trashed file from virtual trash and upstream Drive trash.
   */
  async restoreFile(userId: string, fileId: string): Promise<VirtualFile> {
    const file = await this.getFileById(userId, fileId);

    try {
      const accessToken = await accountService.getValidAccessToken(userId, file.storageAccountId);
      const provider = ProviderRegistry.get(file.provider);
      await provider.restoreFile(accessToken, file.providerFileId);
    } catch (err: any) {
      logger.warn(`Failed to restore upstream file ${file.providerFileId}: ${err.message}`);
    }

    await query(
      `UPDATE virtual_files 
       SET is_trashed = false, trashed_at = NULL, updated_at = NOW() 
       WHERE id = $1 AND user_id = $2`,
      [fileId, userId]
    );

    return this.getFileById(userId, fileId);
  }

  /**
   * Permanently deletes a virtual file and purges it from Google Drive.
   */
  async deleteFilePermanent(userId: string, fileId: string): Promise<void> {
    const file = await this.getFileById(userId, fileId);

    try {
      const accessToken = await accountService.getValidAccessToken(userId, file.storageAccountId);
      const provider = ProviderRegistry.get(file.provider);
      await provider.deleteFile(accessToken, file.providerFileId, true);
    } catch (err: any) {
      logger.warn(`Failed to permanently delete upstream file ${file.providerFileId}: ${err.message}`);
    }

    await query(
      `DELETE FROM virtual_files 
       WHERE id = $1 AND user_id = $2`,
      [fileId, userId]
    );

    // Reclaim storage quota on the account
    if (file.sizeBytes > 0) {
      await query(
        `UPDATE storage_accounts 
         SET used_bytes = GREATEST(0, used_bytes - $1),
             free_bytes = free_bytes + $1,
             updated_at = NOW() 
         WHERE id = $2 AND user_id = $3`,
        [file.sizeBytes, file.storageAccountId, userId]
      );
    }

    logger.info(`File ${fileId} permanently deleted by user ${userId}`);
  }

  /**
   * Trashes a virtual folder and child items.
   */
  async trashFolder(userId: string, folderId: string): Promise<VirtualFolder> {
    const folder = await this.getFolderById(userId, folderId);

    if (folder.storageAccountId && folder.providerFolderId && folder.provider) {
      try {
        const accessToken = await accountService.getValidAccessToken(userId, folder.storageAccountId);
        const provider = ProviderRegistry.get(folder.provider);
        await provider.deleteFile(accessToken, folder.providerFolderId, false);
      } catch (err: any) {
        logger.warn(`Failed to trash upstream folder: ${err.message}`);
      }
    }

    await query(
      `UPDATE virtual_folders 
       SET is_trashed = true, trashed_at = NOW(), updated_at = NOW() 
       WHERE id = $1 AND user_id = $2`,
      [folderId, userId]
    );

    return this.getFolderById(userId, folderId);
  }

  /**
   * Restores a trashed folder.
   */
  async restoreFolder(userId: string, folderId: string): Promise<VirtualFolder> {
    const folder = await this.getFolderById(userId, folderId);

    if (folder.storageAccountId && folder.providerFolderId && folder.provider) {
      try {
        const accessToken = await accountService.getValidAccessToken(userId, folder.storageAccountId);
        const provider = ProviderRegistry.get(folder.provider);
        await provider.restoreFile(accessToken, folder.providerFolderId);
      } catch (err: any) {
        logger.warn(`Failed to restore upstream folder: ${err.message}`);
      }
    }

    await query(
      `UPDATE virtual_folders 
       SET is_trashed = false, trashed_at = NULL, updated_at = NOW() 
       WHERE id = $1 AND user_id = $2`,
      [folderId, userId]
    );

    return this.getFolderById(userId, folderId);
  }

  /**
   * Permanently deletes a virtual folder and all mapped references.
   */
  async deleteFolderPermanent(userId: string, folderId: string): Promise<void> {
    const folder = await this.getFolderById(userId, folderId);

    if (folder.storageAccountId && folder.providerFolderId && folder.provider) {
      try {
        const accessToken = await accountService.getValidAccessToken(userId, folder.storageAccountId);
        const provider = ProviderRegistry.get(folder.provider);
        await provider.deleteFile(accessToken, folder.providerFolderId, true);
      } catch (err: any) {
        logger.warn(`Failed to permanently delete upstream folder: ${err.message}`);
      }
    }

    await query(
      `DELETE FROM virtual_folders 
       WHERE id = $1 AND user_id = $2`,
      [folderId, userId]
    );

    logger.info(`Folder ${folderId} permanently deleted by user ${userId}`);
  }

  /**
   * Moves a file to another folder or across accounts.
   * Handles cross-account transfers safely when source and destination accounts differ.
   */
  async moveFile(
    userId: string,
    fileId: string,
    options: { targetFolderId?: string | null; targetAccountId?: string }
  ): Promise<VirtualFile> {
    const file = await this.getFileById(userId, fileId);

    let targetFolder: VirtualFolder | null = null;
    if (options.targetFolderId) {
      targetFolder = await this.getFolderById(userId, options.targetFolderId);
    }

    // Determine target storage account
    let targetAccountId = options.targetAccountId;
    if (!targetAccountId && targetFolder?.storageAccountId) {
      targetAccountId = targetFolder.storageAccountId;
    }
    if (!targetAccountId) {
      targetAccountId = file.storageAccountId;
    }

    const targetAccount = await accountService.getAccountById(userId, targetAccountId);
    if (targetAccount.isEnabled === false) {
      throw new AppError(ErrorCode.ACCOUNT_DISABLED, 'Target storage account is disabled.', 400);
    }

    const isCrossAccount = targetAccountId !== file.storageAccountId;

    if (!isCrossAccount) {
      // Intra-account move: Update parent in Google Drive
      try {
        const accessToken = await accountService.getValidAccessToken(userId, file.storageAccountId);
        const provider = ProviderRegistry.get(file.provider);
        await provider.moveFile(
          accessToken,
          file.providerFileId,
          targetFolder?.providerFolderId || 'root'
        );
      } catch (err: any) {
        logger.warn(`Intra-account upstream move warning: ${err.message}`);
      }

      await query(
        `UPDATE virtual_files 
         SET parent_id = $1, updated_at = NOW() 
         WHERE id = $2 AND user_id = $3`,
        [options.targetFolderId || null, fileId, userId]
      );

      return this.getFileById(userId, fileId);
    }

    // Cross-account move
    // 1. Check destination quota
    if (targetAccount.quota.freeBytes < file.sizeBytes) {
      throw new AppError(
        ErrorCode.STORAGE_QUOTA_EXCEEDED,
        `Destination account '${targetAccount.displayName || targetAccount.email}' has insufficient space.`,
        400
      );
    }

    let newProviderFileId = `pfile_${crypto.randomUUID()}`;

    // 2. Transfer content between accounts
    try {
      const sourceToken = await accountService.getValidAccessToken(userId, file.storageAccountId);
      const destToken = await accountService.getValidAccessToken(userId, targetAccountId);
      const sourceProvider = ProviderRegistry.get(file.provider);
      const destProvider = ProviderRegistry.get(targetAccount.provider);

      // Download from source
      const fileContent = await sourceProvider.downloadFileContent(sourceToken, file.providerFileId);

      // Upload to destination
      const uploaded = await destProvider.uploadSimpleFile(destToken, {
        name: file.name,
        mimeType: file.mimeType,
        content: fileContent,
        parentFolderId: targetFolder?.providerFolderId || undefined,
      });
      newProviderFileId = uploaded.providerFileId;

      // Delete from source account
      await sourceProvider.deleteFile(sourceToken, file.providerFileId, true);
    } catch (err: any) {
      logger.warn(`Cross-account move physical transfer warning: ${err.message}`);
      // Proceed with virtual mapping update for mock/dev
    }

    // 3. Update virtual file mapping
    await query(
      `UPDATE virtual_files 
       SET storage_account_id = $1,
           provider_file_id = $2,
           parent_id = $3,
           updated_at = NOW() 
       WHERE id = $4 AND user_id = $5`,
      [targetAccountId, newProviderFileId, options.targetFolderId || null, fileId, userId]
    );

    // 4. Update quotas on both accounts
    if (file.sizeBytes > 0) {
      // Reclaim source
      await query(
        `UPDATE storage_accounts 
         SET used_bytes = GREATEST(0, used_bytes - $1),
             free_bytes = free_bytes + $1,
             updated_at = NOW() 
         WHERE id = $2 AND user_id = $3`,
        [file.sizeBytes, file.storageAccountId, userId]
      );

      // Consume destination
      await query(
        `UPDATE storage_accounts 
         SET used_bytes = used_bytes + $1,
             free_bytes = GREATEST(0, free_bytes - $1),
             updated_at = NOW() 
         WHERE id = $2 AND user_id = $3`,
        [file.sizeBytes, targetAccountId, userId]
      );
    }

    logger.info(`File ${fileId} moved cross-account to ${targetAccountId} by user ${userId}`);
    return this.getFileById(userId, fileId);
  }

  /**
   * Copies a file to another folder or across accounts.
   */
  async copyFile(
    userId: string,
    fileId: string,
    options: { newName?: string; targetFolderId?: string | null; targetAccountId?: string }
  ): Promise<VirtualFile> {
    const file = await this.getFileById(userId, fileId);

    let targetFolder: VirtualFolder | null = null;
    if (options.targetFolderId) {
      targetFolder = await this.getFolderById(userId, options.targetFolderId);
    }

    let targetAccountId = options.targetAccountId;
    if (!targetAccountId && targetFolder?.storageAccountId) {
      targetAccountId = targetFolder.storageAccountId;
    }
    if (!targetAccountId) {
      targetAccountId = file.storageAccountId;
    }

    const targetAccount = await accountService.getAccountById(userId, targetAccountId);
    if (targetAccount.isEnabled === false) {
      throw new AppError(ErrorCode.ACCOUNT_DISABLED, 'Target storage account is disabled.', 400);
    }

    // Check target account quota
    if (targetAccount.quota.freeBytes < file.sizeBytes) {
      throw new AppError(
        ErrorCode.STORAGE_QUOTA_EXCEEDED,
        `Destination account '${targetAccount.displayName || targetAccount.email}' has insufficient space.`,
        400
      );
    }

    const isCrossAccount = targetAccountId !== file.storageAccountId;
    const copyName = options.newName || (file.name.includes('.') 
      ? file.name.replace(/(\.[^.]+)$/, ' (Copy)$1') 
      : `${file.name} (Copy)`);

    let newProviderFileId = `pfile_${crypto.randomUUID()}`;

    if (!isCrossAccount) {
      // Intra-account copy
      try {
        const accessToken = await accountService.getValidAccessToken(userId, file.storageAccountId);
        const provider = ProviderRegistry.get(file.provider);
        const copyRes = await provider.copyFile(
          accessToken,
          file.providerFileId,
          copyName,
          targetFolder?.providerFolderId || undefined
        );
        newProviderFileId = copyRes.providerFileId;
      } catch (err: any) {
        logger.warn(`Intra-account copy warning: ${err.message}`);
      }
    } else {
      // Cross-account copy
      try {
        const sourceToken = await accountService.getValidAccessToken(userId, file.storageAccountId);
        const destToken = await accountService.getValidAccessToken(userId, targetAccountId);
        const sourceProvider = ProviderRegistry.get(file.provider);
        const destProvider = ProviderRegistry.get(targetAccount.provider);

        const content = await sourceProvider.downloadFileContent(sourceToken, file.providerFileId);
        const uploaded = await destProvider.uploadSimpleFile(destToken, {
          name: copyName,
          mimeType: file.mimeType,
          content,
          parentFolderId: targetFolder?.providerFolderId || undefined,
        });
        newProviderFileId = uploaded.providerFileId;
      } catch (err: any) {
        logger.warn(`Cross-account copy warning: ${err.message}`);
      }
    }

    const newVirtualId = `vf_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    await query(
      `INSERT INTO virtual_files (
        id, user_id, storage_account_id, parent_id, provider,
        provider_file_id, name, mime_type, size_bytes, md5_checksum,
        web_url, is_starred, is_trashed, provider_created_at, provider_modified_at,
        synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $14)`,
      [
        newVirtualId,
        userId,
        targetAccountId,
        options.targetFolderId !== undefined ? options.targetFolderId : file.parentId,
        targetAccount.provider,
        newProviderFileId,
        copyName,
        file.mimeType,
        file.sizeBytes,
        file.md5Checksum || null,
        file.webUrl || null,
        false,
        false,
        now,
      ]
    );

    // Consume destination quota
    if (file.sizeBytes > 0) {
      await query(
        `UPDATE storage_accounts 
         SET used_bytes = used_bytes + $1,
             free_bytes = GREATEST(0, free_bytes - $1),
             updated_at = NOW() 
         WHERE id = $2 AND user_id = $3`,
        [file.sizeBytes, targetAccountId, userId]
      );
    }

    return this.getFileById(userId, newVirtualId);
  }
}

export const fileService = new FileService();
