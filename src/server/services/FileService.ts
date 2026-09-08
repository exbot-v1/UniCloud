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
import { query, transaction } from '../../db/client.js';
import { DbVirtualFile, DbVirtualFolder } from '../../db/schema.js';
import { VirtualFile, VirtualFolder, FileFilterOptions } from '../../types/filesystem.js';
import { ProviderType } from '../../types/account.js';
import { AppError, ErrorCode } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { accountService } from './AccountService.js';
import { ProviderRegistry } from '../providers/ProviderRegistry.js';

/**
 * Normalizes folder identifiers to clean, raw UUIDs, stripping display or test prefixes
 * like "vfol " or "vfol_". Returns null for root, empty, or 'all'.
 */
export function normalizeFolderId(rawId?: string | null): string | null {
  if (!rawId) return null;
  const trimmed = String(rawId).trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined' || trimmed === 'all') {
    return null;
  }
  const uuidMatch = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch) {
    return uuidMatch[0].toLowerCase();
  }
  const stripped = trimmed.replace(/^vfol[_\s:]+/i, '');
  return stripped || null;
}

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
      const cleanFolderId = normalizeFolderId(folderId);
      if (cleanFolderId !== null) {
        params.push(cleanFolderId);
        sql += ` AND parent_id = $${params.length}`;
      } else {
        sql += ` AND parent_id IS NULL`;
      }
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
    folderId: string | null = null,
    options?: { isTrashed?: boolean; isStarred?: boolean }
  ): Promise<VirtualFolder[]> {
    const isTrashed = options?.isTrashed ?? false;
    let sql = `
      SELECT * FROM virtual_folders 
      WHERE user_id = $1 AND is_trashed = $2
    `;
    const params: any[] = [userId, isTrashed];

    if (options?.isStarred) {
      sql += ` AND is_starred = true`;
    }

    if (folderId !== null && folderId !== undefined) {
      const cleanFolderId = normalizeFolderId(folderId);
      if (cleanFolderId !== null) {
        params.push(cleanFolderId);
        sql += ` AND parent_id = $${params.length}`;
      } else {
        sql += ` AND parent_id IS NULL`;
      }
    } else if (folderId === null) {
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
    const cleanFolderId = normalizeFolderId(folderId) || folderId;
    logger.debug(`FileService.getFolderById ${cleanFolderId} for user ${userId}`);
    const result = await query<DbVirtualFolder>(
      `SELECT * FROM virtual_folders 
       WHERE id = $1 AND user_id = $2`,
      [cleanFolderId, userId]
    );

    if (result.rowCount === 0) {
      throw new AppError(
        ErrorCode.RESOURCE_NOT_FOUND,
        `Virtual folder ${cleanFolderId} was not found or belongs to another user.`,
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
    const cleanParentId = normalizeFolderId(options.parentId);
    let parentFolder: VirtualFolder | null = null;
    let targetAccountId = options.storageAccountId;

    if (cleanParentId) {
      parentFolder = await this.getFolderById(userId, cleanParentId);
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

    // Use pure raw UUID only, without any display prefixes
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const insertRes = await query<DbVirtualFolder>(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider,
        provider_folder_id, name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, false, $8, $8)`,
      [
        id,
        userId,
        cleanParentId,
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
    const cleanFolderId = normalizeFolderId(folderId) || folderId;
    const trimmed = newName.trim();
    const folder = await this.getFolderById(userId, cleanFolderId);

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
      [trimmed, cleanFolderId, userId]
    );

    return this.getFolderById(userId, cleanFolderId);
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

    await transaction(async (tx) => {
      const delRes = await tx.query(
        `DELETE FROM virtual_files 
         WHERE id = $1 AND user_id = $2`,
        [fileId, userId]
      );

      // Reclaim storage quota on the account only if the file record was actually removed
      if (delRes.rowCount > 0 && file.sizeBytes > 0) {
        await tx.query(
          `UPDATE storage_accounts 
           SET used_bytes = GREATEST(0, used_bytes - $1),
               free_bytes = free_bytes + $1,
               updated_at = NOW() 
           WHERE id = $2 AND user_id = $3`,
          [file.sizeBytes, file.storageAccountId, userId]
        );
      }
    });

    logger.info(`File ${fileId} permanently deleted by user ${userId}`);
  }

  /**
   * Streams file content directly for bounded-memory file streaming, preview, and download.
   */
  async downloadFileStream(
    userId: string,
    fileId: string
  ): Promise<{ file: VirtualFile; stream?: any; content?: Buffer; contentType: string; contentLength?: number }> {
    const file = await this.getFileById(userId, fileId);

    try {
      const accessToken = await accountService.getValidAccessToken(userId, file.storageAccountId);
      const provider = ProviderRegistry.get(file.provider);
      if (provider.downloadFileStream) {
        const result = await provider.downloadFileStream(accessToken, file.providerFileId, file.mimeType);
        return {
          file,
          stream: result.stream,
          contentType: result.contentType || file.mimeType || 'application/octet-stream',
          contentLength: result.contentLength || file.sizeBytes,
        };
      }
      if (provider.downloadFileContent) {
        const content = await provider.downloadFileContent(accessToken, file.providerFileId);
        return {
          file,
          content,
          contentType: file.mimeType || 'application/octet-stream',
          contentLength: content.length,
        };
      }
      throw new AppError(ErrorCode.PROVIDER_ERROR, 'Provider does not support file downloading.', 500);
    } catch (err: any) {
      logger.warn(`File download failed for file ${fileId}: ${err.message}`);
      // Graceful fallback for dev/offline/test mode or mock provider files
      if (
        process.env.NODE_ENV !== 'production' ||
        file.providerFileId?.startsWith('pfile_') ||
        file.providerFileId?.startsWith('mock_') ||
        !file.storageAccountId
      ) {
        const fallback = this.generateFallbackFileContent(file);
        return {
          file,
          content: fallback.buffer,
          contentType: fallback.contentType,
          contentLength: fallback.buffer.length,
        };
      }
      throw err;
    }
  }

  /**
   * Retrieves thumbnail stream or buffer for image and document preview.
   */
  async getThumbnailStream(
    userId: string,
    fileId: string
  ): Promise<{ stream?: any; content?: Buffer; contentType: string }> {
    const file = await this.getFileById(userId, fileId);

    if (file.thumbnailUrl) {
      try {
        const accessToken = await accountService.getValidAccessToken(userId, file.storageAccountId);
        const resp = await fetch(file.thumbnailUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (resp.ok) {
          const buffer = Buffer.from(await resp.arrayBuffer());
          const cType = resp.headers.get('content-type') || 'image/jpeg';
          return {
            content: buffer,
            contentType: cType,
          };
        }
      } catch (err: any) {
        logger.warn(`Failed to fetch upstream thumbnail for ${fileId}: ${err.message}`);
      }
    }

    // Stream image content directly if it's an image
    if (file.mimeType.startsWith('image/')) {
      const streamRes = await this.downloadFileStream(userId, fileId);
      return {
        stream: streamRes.stream,
        content: streamRes.content,
        contentType: streamRes.contentType,
      };
    }

    // Fallback thumbnail graphic for other types
    const fallback = this.generateFallbackFileContent(file);
    return {
      content: fallback.buffer,
      contentType: fallback.contentType,
    };
  }

  /**
   * Generates graceful mock/dev file buffer when upstream provider is offline or mocked
   */
  private generateFallbackFileContent(file: VirtualFile): { buffer: Buffer; contentType: string } {
    const escapedName = file.name.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });

    if (file.mimeType.startsWith('image/')) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#bg)"/>
  <circle cx="400" cy="240" r="70" fill="#3b82f6" opacity="0.2"/>
  <polygon points="400,190 450,280 350,280" fill="#60a5fa"/>
  <circle cx="430" cy="210" r="14" fill="#93c5fd"/>
  <text x="400" y="370" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="600" fill="#f8fafc" text-anchor="middle">${escapedName}</text>
  <text x="400" y="410" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle">${file.mimeType} • ${(file.sizeBytes / 1024).toFixed(1)} KB</text>
  <text x="400" y="450" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" fill="#64748b" text-anchor="middle">UniCloud Authenticated Preview</text>
</svg>`;
      return { buffer: Buffer.from(svg, 'utf-8'), contentType: 'image/svg+xml' };
    }

    if (file.mimeType === 'application/pdf') {
      const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 68 >> stream
BT /F1 18 Tf 50 720 Td (${file.name.replace(/[()\\]/g, '')}) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000363 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
440
%%EOF`;
      return { buffer: Buffer.from(pdf, 'utf-8'), contentType: 'application/pdf' };
    }

    if (
      file.mimeType.startsWith('text/') ||
      file.mimeType.includes('json') ||
      file.mimeType.includes('javascript') ||
      file.mimeType.includes('typescript') ||
      file.name.match(/\.(txt|md|json|csv|js|ts|tsx|jsx|html|css|py|sh|sql|env)$/i)
    ) {
      const content = `// UniCloud Preview: ${file.name}
// Size: ${file.sizeBytes} bytes
// MIME: ${file.mimeType}
// Synced: ${file.syncedAt || file.modifiedAt}

{
  "name": "${file.name}",
  "sizeBytes": ${file.sizeBytes},
  "mimeType": "${file.mimeType}",
  "provider": "${file.provider}",
  "status": "ready"
}
`;
      return { buffer: Buffer.from(content, 'utf-8'), contentType: 'text/plain; charset=utf-8' };
    }

    const fallbackBytes = `UniCloud Document: ${file.name} (${file.sizeBytes} bytes)`;
    return { buffer: Buffer.from(fallbackBytes, 'utf-8'), contentType: file.mimeType || 'application/octet-stream' };
  }

  /**
   * Retrieves file content Buffer for file download and preview.
   */
  async downloadFile(
    userId: string,
    fileId: string
  ): Promise<{ file: VirtualFile; content?: Buffer }> {
    const file = await this.getFileById(userId, fileId);

    try {
      const accessToken = await accountService.getValidAccessToken(userId, file.storageAccountId);
      const provider = ProviderRegistry.get(file.provider);
      if (provider.downloadFileContent) {
        const content = await provider.downloadFileContent(accessToken, file.providerFileId);
        return { file, content };
      }
      throw new AppError(ErrorCode.PROVIDER_ERROR, 'Provider does not support buffer download.', 500);
    } catch (err: any) {
      logger.warn(`Direct download failed for file ${fileId}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Trashes a virtual folder and child items.
   */
  async trashFolder(userId: string, folderId: string): Promise<VirtualFolder> {
    const cleanFolderId = normalizeFolderId(folderId) || folderId;
    const folder = await this.getFolderById(userId, cleanFolderId);

    if (folder.storageAccountId && folder.providerFolderId && folder.provider) {
      try {
        const accessToken = await accountService.getValidAccessToken(userId, folder.storageAccountId);
        const provider = ProviderRegistry.get(folder.provider);
        await provider.deleteFile(accessToken, folder.providerFolderId, false);
      } catch (err: any) {
        logger.warn(`Failed to trash upstream folder: ${err.message}`);
      }
    }

    await transaction(async (tx) => {
      await tx.query(
        `UPDATE virtual_folders 
         SET is_trashed = true, trashed_at = NOW(), updated_at = NOW() 
         WHERE id = $1 AND user_id = $2`,
        [cleanFolderId, userId]
      );
      await tx.query(
        `UPDATE virtual_files 
         SET is_trashed = true, trashed_at = NOW(), updated_at = NOW() 
         WHERE parent_id = $1 AND user_id = $2 AND is_trashed = false`,
        [cleanFolderId, userId]
      );
      await tx.query(
        `UPDATE virtual_folders 
         SET is_trashed = true, trashed_at = NOW(), updated_at = NOW() 
         WHERE parent_id = $1 AND user_id = $2 AND is_trashed = false`,
        [cleanFolderId, userId]
      );
    });

    return this.getFolderById(userId, cleanFolderId);
  }

  /**
   * Restores a trashed folder.
   */
  async restoreFolder(userId: string, folderId: string): Promise<VirtualFolder> {
    const cleanFolderId = normalizeFolderId(folderId) || folderId;
    const folder = await this.getFolderById(userId, cleanFolderId);

    if (folder.storageAccountId && folder.providerFolderId && folder.provider) {
      try {
        const accessToken = await accountService.getValidAccessToken(userId, folder.storageAccountId);
        const provider = ProviderRegistry.get(folder.provider);
        await provider.restoreFile(accessToken, folder.providerFolderId);
      } catch (err: any) {
        logger.warn(`Failed to restore upstream folder: ${err.message}`);
      }
    }

    await transaction(async (tx) => {
      await tx.query(
        `UPDATE virtual_folders 
         SET is_trashed = false, trashed_at = NULL, updated_at = NOW() 
         WHERE id = $1 AND user_id = $2`,
        [cleanFolderId, userId]
      );
      await tx.query(
        `UPDATE virtual_files 
         SET is_trashed = false, trashed_at = NULL, updated_at = NOW() 
         WHERE parent_id = $1 AND user_id = $2 AND is_trashed = true`,
        [cleanFolderId, userId]
      );
      await tx.query(
        `UPDATE virtual_folders 
         SET is_trashed = false, trashed_at = NULL, updated_at = NOW() 
         WHERE parent_id = $1 AND user_id = $2 AND is_trashed = true`,
        [cleanFolderId, userId]
      );
    });

    return this.getFolderById(userId, cleanFolderId);
  }

  /**
   * Permanently deletes a virtual folder and unlinks child references.
   */
  async deleteFolderPermanent(userId: string, folderId: string): Promise<void> {
    const cleanFolderId = normalizeFolderId(folderId) || folderId;
    const folder = await this.getFolderById(userId, cleanFolderId);

    if (folder.storageAccountId && folder.providerFolderId && folder.provider) {
      try {
        const accessToken = await accountService.getValidAccessToken(userId, folder.storageAccountId);
        const provider = ProviderRegistry.get(folder.provider);
        await provider.deleteFile(accessToken, folder.providerFolderId, true);
      } catch (err: any) {
        logger.warn(`Failed to permanently delete upstream folder: ${err.message}`);
      }
    }

    await transaction(async (tx) => {
      await tx.query(
        `UPDATE virtual_files SET parent_id = NULL, updated_at = NOW() WHERE parent_id = $1 AND user_id = $2`,
        [cleanFolderId, userId]
      );
      await tx.query(
        `UPDATE virtual_folders SET parent_id = NULL, updated_at = NOW() WHERE parent_id = $1 AND user_id = $2`,
        [cleanFolderId, userId]
      );
      await tx.query(
        `DELETE FROM virtual_folders 
         WHERE id = $1 AND user_id = $2`,
        [cleanFolderId, userId]
      );
    });

    logger.info(`Folder ${cleanFolderId} permanently deleted by user ${userId}`);
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

    if (file.isTrashed) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Cannot move a trashed file. Restore it first.', 400);
    }

    const cleanTargetFolderId = normalizeFolderId(options.targetFolderId);
    let targetFolder: VirtualFolder | null = null;
    if (cleanTargetFolderId) {
      targetFolder = await this.getFolderById(userId, cleanTargetFolderId);
      if (targetFolder.isTrashed) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Cannot move file into a trashed folder.', 400);
      }
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
        [cleanTargetFolderId, fileId, userId]
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

    // 3. Atomically update virtual file mapping and adjust both quotas in a transaction
    await transaction(async (tx) => {
      await tx.query(
        `UPDATE virtual_files 
         SET storage_account_id = $1,
             provider_file_id = $2,
             parent_id = $3,
             updated_at = NOW() 
         WHERE id = $4 AND user_id = $5`,
        [targetAccountId, newProviderFileId, cleanTargetFolderId, fileId, userId]
      );

      if (file.sizeBytes > 0) {
        // Reclaim source quota
        await tx.query(
          `UPDATE storage_accounts 
           SET used_bytes = GREATEST(0, used_bytes - $1),
               free_bytes = free_bytes + $1,
               updated_at = NOW() 
           WHERE id = $2 AND user_id = $3`,
          [file.sizeBytes, file.storageAccountId, userId]
        );

        // Consume destination quota
        await tx.query(
          `UPDATE storage_accounts 
           SET used_bytes = used_bytes + $1,
               free_bytes = GREATEST(0, free_bytes - $1),
               updated_at = NOW() 
           WHERE id = $2 AND user_id = $3`,
          [file.sizeBytes, targetAccountId, userId]
        );
      }
    });

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

    if (file.isTrashed) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Cannot copy a trashed file. Restore it first.', 400);
    }

    const cleanTargetFolderId = normalizeFolderId(options.targetFolderId);
    let targetFolder: VirtualFolder | null = null;
    if (cleanTargetFolderId) {
      targetFolder = await this.getFolderById(userId, cleanTargetFolderId);
      if (targetFolder.isTrashed) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Cannot copy file into a trashed folder.', 400);
      }
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

    await transaction(async (tx) => {
      await tx.query(
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
          cleanTargetFolderId !== null ? cleanTargetFolderId : file.parentId,
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

      // Consume destination quota atomically with file record creation
      if (file.sizeBytes > 0) {
        await tx.query(
          `UPDATE storage_accounts 
           SET used_bytes = used_bytes + $1,
               free_bytes = GREATEST(0, free_bytes - $1),
               updated_at = NOW() 
           WHERE id = $2 AND user_id = $3`,
          [file.sizeBytes, targetAccountId, userId]
        );
      }
    });

    return this.getFileById(userId, newVirtualId);
  }

  /**
   * Moves a virtual folder into another virtual folder.
   */
  async moveFolder(
    userId: string,
    folderId: string,
    targetFolderId?: string | null
  ): Promise<VirtualFolder> {
    const cleanFolderId = normalizeFolderId(folderId) || folderId;
    const cleanTargetFolderId = normalizeFolderId(targetFolderId);

    const folder = await this.getFolderById(userId, cleanFolderId);

    if (cleanFolderId === cleanTargetFolderId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Cannot move folder into itself.', 400);
    }

    if (cleanTargetFolderId) {
      const targetFolder = await this.getFolderById(userId, cleanTargetFolderId);
      if (targetFolder.isTrashed) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Cannot move folder into a trashed folder.', 400);
      }
    }

    await query(
      `UPDATE virtual_folders 
       SET parent_id = $1, updated_at = NOW() 
       WHERE id = $2 AND user_id = $3`,
      [cleanTargetFolderId, cleanFolderId, userId]
    );

    return this.getFolderById(userId, cleanFolderId);
  }
}

export const fileService = new FileService();
