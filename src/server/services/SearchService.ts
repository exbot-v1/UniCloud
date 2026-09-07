/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud SearchService
 * 
 * Domain service providing unified full-text, filename, and attribute search
 * across the entire multi-account virtual storage pool with strict tenant isolation.
 */

import { query } from '../../db/client.js';
import { DbVirtualFile, DbVirtualFolder } from '../../db/schema.js';
import { SearchOptions, SearchResult, SearchResultItem, VirtualFile } from '../../types/filesystem.js';
import { accountService } from './AccountService.js';
import { fileService } from './FileService.js';
import { logger } from '../utils/logger.js';

export class SearchService {
  /**
   * Performs unified search across all connected storage accounts in the virtual filesystem.
   * Searches the virtual filesystem/database first and returns tenant-isolated results
   * with owning Drive account metadata, location path, filtering, sorting, and pagination.
   */
  async search(userId: string, options: SearchOptions = {}): Promise<SearchResult> {
    logger.debug(`SearchService.search for user ${userId}`, { options });

    // 1. Fetch user accounts to resolve account details and enforce account state
    const accounts = await accountService.getAccountsForUser(userId);
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    // 2. Fetch all user virtual folders to resolve parent paths and support folder searching
    const foldersResult = await query<DbVirtualFolder>(
      'SELECT * FROM virtual_folders WHERE user_id = $1',
      [userId]
    );
    const folderMap = new Map(foldersResult.rows.map((f) => [f.id, f]));

    const resolveLocation = (parentId: string | null): string => {
      if (!parentId) return 'My Files';
      const parent = folderMap.get(parentId);
      return parent ? parent.name : 'My Files';
    };

    // 3. Fetch all user virtual files
    const result = await query<DbVirtualFile>(
      'SELECT * FROM virtual_files WHERE user_id = $1',
      [userId]
    );

    let rows = result.rows;

    // Filter files by query string
    if (options.query && options.query.trim().length > 0) {
      const q = options.query.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    }

    // Filter files by folder ID
    if (options.folderId !== undefined) {
      if (options.folderId === null) {
        rows = rows.filter((r) => r.parent_id === null);
      } else {
        rows = rows.filter((r) => r.parent_id === options.folderId);
      }
    }

    // Filter files by storage account ID
    if (options.storageAccountId) {
      rows = rows.filter((r) => r.storage_account_id === options.storageAccountId);
    }

    // Filter files by MIME type
    if (options.mimeType) {
      const mime = options.mimeType.toLowerCase();
      rows = rows.filter((r) => {
        if (!r.mime_type) return false;
        return r.mime_type.toLowerCase().includes(mime);
      });
    }

    // Filter files by starred status
    if (options.isStarred !== undefined) {
      rows = rows.filter((r) => Boolean(r.is_starred) === options.isStarred);
    }

    // Filter files by trashed status (defaults to false if omitted)
    if (options.isTrashed !== undefined) {
      rows = rows.filter((r) => Boolean(r.is_trashed) === options.isTrashed);
    } else {
      rows = rows.filter((r) => !r.is_trashed);
    }

    // Map file rows to SearchResultItem
    const fileItems: SearchResultItem[] = rows.map((row) => {
      const baseFile = fileService.mapDbFileToDomain(row);
      const acc = accountMap.get(row.storage_account_id);

      return {
        ...baseFile,
        accountEmail: acc?.email || 'Unified Storage',
        accountDisplayName: acc?.displayName || acc?.email || 'Unified Storage',
        accountAvatarUrl: acc?.avatarUrl,
        location: resolveLocation(row.parent_id),
      };
    });

    // Handle Folder Search if requested or enabled
    let folderItems: SearchResultItem[] = [];
    const includeFolders = options.includeFolders !== false && (!options.mimeType || options.mimeType.toLowerCase().includes('folder'));

    if (includeFolders) {
      let folderRows = foldersResult.rows;

      if (options.query && options.query.trim().length > 0) {
        const q = options.query.trim().toLowerCase();
        folderRows = folderRows.filter((r) => r.name.toLowerCase().includes(q));
      }

      if (options.folderId !== undefined) {
        if (options.folderId === null) {
          folderRows = folderRows.filter((r) => r.parent_id === null);
        } else {
          folderRows = folderRows.filter((r) => r.parent_id === options.folderId);
        }
      }

      if (options.storageAccountId) {
        folderRows = folderRows.filter((r) => r.storage_account_id === options.storageAccountId);
      }

      if (options.isStarred !== undefined) {
        folderRows = folderRows.filter((r) => Boolean(r.is_starred) === options.isStarred);
      }

      if (options.isTrashed !== undefined) {
        folderRows = folderRows.filter((r) => Boolean(r.is_trashed) === options.isTrashed);
      } else {
        folderRows = folderRows.filter((r) => !r.is_trashed);
      }

      folderItems = folderRows.map((f) => {
        const acc = f.storage_account_id ? accountMap.get(f.storage_account_id) : undefined;
        return {
          id: f.id,
          userId: f.user_id,
          storageAccountId: f.storage_account_id || '',
          provider: (f.provider as any) || 'google_drive',
          providerFileId: f.provider_folder_id || '',
          parentId: f.parent_id,
          name: f.name,
          mimeType: 'application/vnd.google-apps.folder',
          sizeBytes: 0,
          isFolder: true,
          isStarred: Boolean(f.is_starred),
          isTrashed: Boolean(f.is_trashed),
          createdAt: f.created_at,
          modifiedAt: f.updated_at,
          syncedAt: f.updated_at,
          accountEmail: acc?.email || 'Unified Storage',
          accountDisplayName: acc?.displayName || acc?.email || 'Unified Storage',
          accountAvatarUrl: acc?.avatarUrl,
          location: resolveLocation(f.parent_id),
        };
      });
    }

    const allCombined = [...folderItems, ...fileItems];

    // Sort results
    const sortBy = options.sortBy || 'modifiedAt';
    const sortOrder = options.sortOrder || (sortBy === 'name' ? 'asc' : 'desc');
    const factor = sortOrder === 'asc' ? 1 : -1;

    allCombined.sort((a, b) => {
      // Keep folders before files if sorting by name
      if (a.isFolder !== b.isFolder) {
        return a.isFolder ? -1 : 1;
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name) * factor;
      }
      if (sortBy === 'size') {
        return (a.sizeBytes - b.sizeBytes) * factor;
      }
      if (sortBy === 'createdAt') {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return (timeA - timeB) * factor;
      }
      // default: modifiedAt
      const timeA = new Date(a.modifiedAt || 0).getTime();
      const timeB = new Date(b.modifiedAt || 0).getTime();
      return (timeA - timeB) * factor;
    });

    // Pagination
    const total = allCombined.length;
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.max(1, Math.min(100, options.limit || 20));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = options.offset !== undefined ? options.offset : (page - 1) * pageSize;

    const items = allCombined.slice(offset, offset + pageSize);

    return {
      items,
      total,
      totalCount: total,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages,
    };
  }

  /**
   * Backwards compatible search method returning SearchResultItem array
   */
  async searchVirtualFilesystem(
    userId: string,
    query: string,
    limit: number = 20
  ): Promise<SearchResultItem[]> {
    const res = await this.search(userId, { query, limit });
    return res.items;
  }
}

export const searchService = new SearchService();
