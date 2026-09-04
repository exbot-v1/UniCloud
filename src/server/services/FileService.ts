/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud FileService
 * 
 * Domain service managing virtual files, folders, and metadata queries
 * backed by PostgreSQL with strict user-tenant isolation.
 */

import { query } from '../../db/client.js';
import { DbVirtualFile, DbVirtualFolder } from '../../db/schema.js';
import { VirtualFile, VirtualFolder, FileFilterOptions } from '../../types/filesystem.js';
import { ProviderType } from '../../types/account.js';
import { AppError, ErrorCode } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

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
   * Soft-deletes a virtual file into the virtual trash.
   */
  async moveToTrash(userId: string, fileId: string): Promise<void> {
    // Verify file ownership first
    await this.getFileById(userId, fileId);

    await query(
      `UPDATE virtual_files 
       SET is_trashed = true, trashed_at = NOW(), updated_at = NOW() 
       WHERE id = $1 AND user_id = $2`,
      [fileId, userId]
    );

    logger.info(`File ${fileId} moved to trash by user ${userId}`);
  }
}

export const fileService = new FileService();
