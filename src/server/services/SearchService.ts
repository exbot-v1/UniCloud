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
import { DbVirtualFile } from '../../db/schema.js';
import { SearchOptions, SearchResult, SearchResultItem, VirtualFile } from '../../types/filesystem.js';
import { accountService } from './AccountService.js';
import { fileService } from './FileService.js';
import { logger } from '../utils/logger.js';

export class SearchService {
  /**
   * Performs unified search across all connected storage accounts in the virtual filesystem.
   * Searches the virtual filesystem/database first and returns tenant-isolated results
   * with owning Drive account metadata, filtering, sorting, and pagination.
   */
  async search(userId: string, options: SearchOptions = {}): Promise<SearchResult> {
    logger.debug(`SearchService.search for user ${userId}`, { options });

    // 1. Fetch user accounts to resolve account details and enforce account state
    const accounts = await accountService.getAccountsForUser(userId);
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    // 2. Fetch all user virtual files
    const result = await query<DbVirtualFile>(
      'SELECT * FROM virtual_files WHERE user_id = $1',
      [userId]
    );

    let rows = result.rows;

    // 3. Filter by query string (filename / name)
    if (options.query && options.query.trim().length > 0) {
      const q = options.query.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    }

    // 4. Filter by folder ID
    if (options.folderId !== undefined) {
      if (options.folderId === null) {
        rows = rows.filter((r) => r.parent_id === null);
      } else {
        rows = rows.filter((r) => r.parent_id === options.folderId);
      }
    }

    // 5. Filter by storage account ID
    if (options.storageAccountId) {
      rows = rows.filter((r) => r.storage_account_id === options.storageAccountId);
    }

    // 6. Filter by MIME type
    if (options.mimeType) {
      const mime = options.mimeType.toLowerCase();
      rows = rows.filter((r) => {
        if (!r.mime_type) return false;
        return r.mime_type.toLowerCase().includes(mime);
      });
    }

    // 7. Filter by starred status
    if (options.isStarred !== undefined) {
      rows = rows.filter((r) => Boolean(r.is_starred) === options.isStarred);
    }

    // 8. Filter by trashed status (defaults to false if omitted)
    if (options.isTrashed !== undefined) {
      rows = rows.filter((r) => Boolean(r.is_trashed) === options.isTrashed);
    } else {
      rows = rows.filter((r) => !r.is_trashed);
    }

    // 9. Sort results
    const sortBy = options.sortBy || 'modifiedAt';
    const sortOrder = options.sortOrder || (sortBy === 'name' ? 'asc' : 'desc');
    const factor = sortOrder === 'asc' ? 1 : -1;

    rows.sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name) * factor;
      }
      if (sortBy === 'size') {
        const sizeA = Number(a.size_bytes) || 0;
        const sizeB = Number(b.size_bytes) || 0;
        return (sizeA - sizeB) * factor;
      }
      if (sortBy === 'createdAt') {
        const timeA = new Date(a.created_at || 0).getTime();
        const timeB = new Date(b.created_at || 0).getTime();
        return (timeA - timeB) * factor;
      }
      // default: modifiedAt
      const timeA = new Date(a.updated_at || a.provider_modified_at || 0).getTime();
      const timeB = new Date(b.updated_at || b.provider_modified_at || 0).getTime();
      return (timeA - timeB) * factor;
    });

    // 10. Pagination
    const total = rows.length;
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.max(1, Math.min(100, options.limit || 20));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = options.offset !== undefined ? options.offset : (page - 1) * pageSize;

    const pageSlice = rows.slice(offset, offset + pageSize);

    // 11. Map to SearchResultItem attaching owning account details
    const items: SearchResultItem[] = pageSlice.map((row) => {
      const baseFile = fileService.mapDbFileToDomain(row);
      const acc = accountMap.get(row.storage_account_id);

      return {
        ...baseFile,
        accountEmail: acc?.email || 'unknown@drive.google.com',
        accountDisplayName: acc?.displayName || acc?.email,
        accountAvatarUrl: acc?.avatarUrl,
      };
    });

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
   * Backwards compatible search method returning VirtualFile array
   */
  async searchVirtualFilesystem(
    userId: string,
    query: string,
    limit: number = 20
  ): Promise<VirtualFile[]> {
    const res = await this.search(userId, { query, limit });
    return res.items;
  }
}

export const searchService = new SearchService();
