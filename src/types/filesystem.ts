/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Virtual Filesystem Models
 * 
 * CORE PRINCIPLE:
 * UniCloud creates a virtual filesystem layer that maps virtual folders
 * and files onto physical files stored across disparate Google Drive accounts.
 */

import { ProviderType } from './account.js';

export interface VirtualFile {
  /** Internal UniCloud virtual file UUID */
  id: string;
  /** Owner UniCloud user ID */
  userId: string;
  /** Storage account that physically hosts this file */
  storageAccountId: string;
  /** Storage provider type (e.g. google_drive) */
  provider: ProviderType;
  /** The actual file ID in the upstream provider (e.g. Google Drive file ID) */
  providerFileId: string;
  /** Virtual parent folder ID (null for virtual root) */
  parentId: string | null;
  /** Display name of the file */
  name: string;
  /** MIME type of the file */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Web link to view file directly on the provider, if permitted */
  webUrl?: string;
  /** Download URL or proxy endpoint */
  downloadUrl?: string;
  /** Thumbnail image preview link */
  thumbnailUrl?: string;
  /** Checksum or hash for integrity checking */
  md5Checksum?: string;
  /** Whether the item is a folder */
  isFolder: false;
  /** Whether the item is marked as favorite */
  isStarred: boolean;
  /** Whether the item is in the virtual trash */
  isTrashed: boolean;
  /** Timestamp when file was created */
  createdAt: string;
  /** Timestamp when file was last modified */
  modifiedAt: string;
  /** Timestamp when metadata was last synced with provider */
  syncedAt: string;
}

export interface VirtualFolder {
  /** Internal UniCloud virtual folder UUID */
  id: string;
  /** Owner UniCloud user ID */
  userId: string;
  /** 
   * Storage account mapping. For purely logical folders spanning multiple accounts,
   * this may be null or bound to a primary designated account.
   */
  storageAccountId: string | null;
  /** Provider type if bound to a physical folder */
  provider: ProviderType | null;
  /** Physical folder ID in Google Drive if 1:1 mapped, or null if purely virtual */
  providerFolderId: string | null;
  /** Virtual parent folder ID (null for root) */
  parentId: string | null;
  /** Display name of folder */
  name: string;
  /** Whether the item is a folder (always true) */
  isFolder: true;
  /** Whether the item is marked as favorite */
  isStarred: boolean;
  /** Whether the item is in the virtual trash */
  isTrashed: boolean;
  /** Child count (cached) */
  itemCount?: number;
  /** Total calculated size (cached) */
  totalSizeBytes?: number;
  createdAt: string;
  modifiedAt: string;
}

export type VirtualNode = VirtualFile | VirtualFolder;

export interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export type ViewMode = 'grid' | 'list';

export type FileSortField = 'name' | 'modifiedAt' | 'sizeBytes' | 'provider';
export type SortDirection = 'asc' | 'desc';

export interface FileSortOption {
  field: FileSortField;
  direction: SortDirection;
}

export interface FileFilterOptions {
  mimeTypeCategory?: 'all' | 'documents' | 'images' | 'videos' | 'audio' | 'archives';
  starredOnly?: boolean;
  trashedOnly?: boolean;
  storageAccountId?: string;
  searchQuery?: string;
}

export interface SearchOptions {
  query?: string;
  folderId?: string | null;
  storageAccountId?: string;
  mimeType?: string;
  isStarred?: boolean;
  isTrashed?: boolean;
  sortBy?: 'name' | 'size' | 'modifiedAt' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  page?: number;
  includeFolders?: boolean;
}

export interface SearchResultItem extends Omit<VirtualFile, 'isFolder'> {
  isFolder: boolean;
  accountEmail: string;
  accountDisplayName?: string;
  accountAvatarUrl?: string;
  location?: string;
}

export interface SearchResult {
  items: SearchResultItem[];
  total: number;
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
}
