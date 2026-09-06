/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Storage Provider Abstraction
 * 
 * Architectural contract defining standard capabilities across cloud providers.
 * Initial implementation targets Google Drive in subsequent phases.
 */

import { ProviderType, StorageQuota } from './account';

export interface ProviderFileMetadata {
  providerFileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  isFolder: boolean;
  parentFolderId?: string | null;
  createdAt: string;
  modifiedAt: string;
  webUrl?: string;
  md5Checksum?: string;
  isStarred?: boolean;
  isTrashed?: boolean;
}

export interface ProviderFileListOptions {
  folderId?: string;
  pageSize?: number;
  pageToken?: string;
  includeTrashed?: boolean;
  query?: string;
  fetchAllPages?: boolean;
  maxPages?: number;
}

export interface ProviderFileListResult {
  files: ProviderFileMetadata[];
  nextPageToken?: string;
  totalEstimate?: number;
  paginationComplete: boolean;
}

export interface ProviderChangeItem {
  fileId: string;
  removed: boolean;
  time?: string;
  file?: ProviderFileMetadata | null;
}

export interface ProviderChangeListOptions {
  pageToken: string;
  pageSize?: number;
  includeTrashed?: boolean;
  includeRemoved?: boolean;
  restrictToMyDrive?: boolean;
  maxPages?: number;
}

export interface ProviderChangeListResult {
  changes: ProviderChangeItem[];
  newStartPageToken?: string;
  nextPageToken?: string;
  paginationComplete: boolean;
}

export interface ResumableUploadSession {
  sessionId: string;
  uploadUri: string;
  expiresAt: string;
  chunkSizeBytes?: number;
}

export interface ProviderAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
  providerAccountId: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface ProviderHealthCheckResult {
  isHealthy: boolean;
  latencyMs: number;
  statusMessage: string;
  quotaWarning?: boolean;
}

/**
 * Common Storage Provider Interface
 * All storage provider implementations (Google Drive, future OneDrive, S3, etc.)
 * MUST implement this interface to participate in the UniCloud storage pool.
 */
export interface StorageProvider {
  readonly providerType: ProviderType;

  /**
   * Validates or refreshes the access credentials for this account
   */
  refreshAuthentication(refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number }>;

  /**
   * Retrieves current storage quota information from the provider
   */
  getStorageQuota(accessToken: string): Promise<StorageQuota>;

  /**
   * Lists files and folders from the provider
   */
  listFiles(accessToken: string, options?: ProviderFileListOptions): Promise<ProviderFileListResult>;

  /**
   * Retrieves the current start page token for incremental changes tracking (Phase 3)
   */
  getStartPageToken(accessToken: string): Promise<string>;

  /**
   * Queries incremental changes from the provider using a change/page token (Phase 3)
   */
  listChanges(accessToken: string, options: ProviderChangeListOptions): Promise<ProviderChangeListResult>;

  /**
   * Retrieves single file/folder metadata
   */
  getFileMetadata(accessToken: string, providerFileId: string): Promise<ProviderFileMetadata>;

  /**
   * Creates a folder in the provider storage
   */
  createFolder(accessToken: string, name: string, parentFolderId?: string): Promise<ProviderFileMetadata>;

  /**
   * Initiates a resumable upload session (for large files / chunked uploads)
   */
  initiateResumableUpload(
    accessToken: string,
    metadata: { name: string; mimeType: string; sizeBytes: number; parentFolderId?: string }
  ): Promise<ResumableUploadSession>;

  /**
   * Uploads a byte chunk to an active resumable upload session (Phase 4)
   */
  uploadChunk?(
    uploadUri: string,
    chunk: Buffer | Uint8Array,
    options: { startByte: number; endByte: number; totalBytes: number; mimeType?: string }
  ): Promise<{ completed: boolean; bytesUploaded: number; file?: ProviderFileMetadata }>;

  /**
   * Queries upstream status/progress of an active resumable upload session (Phase 4)
   */
  getUploadStatus?(
    uploadUri: string,
    totalBytes: number
  ): Promise<{ completed: boolean; bytesUploaded: number; file?: ProviderFileMetadata }>;

  /**
   * Deletes a file or moves it to trash on the provider
   */
  deleteFile(accessToken: string, providerFileId: string, permanent?: boolean): Promise<void>;

  /**
   * Restores a trashed file on the provider (Phase 5)
   */
  restoreFile?(accessToken: string, providerFileId: string): Promise<ProviderFileMetadata>;

  /**
   * Renames a file or folder on the provider
   */
  renameFile(accessToken: string, providerFileId: string, newName: string): Promise<ProviderFileMetadata>;

  /**
   * Moves a file to a new parent folder on the provider
   */
  moveFile(accessToken: string, providerFileId: string, targetParentFolderId: string): Promise<ProviderFileMetadata>;

  /**
   * Copies a file on the provider (Phase 5)
   */
  copyFile?(accessToken: string, providerFileId: string, newName?: string, targetFolderId?: string): Promise<ProviderFileMetadata>;

  /**
   * Downloads raw file content as a buffer for cross-account transfer (Phase 5)
   */
  downloadFileContent?(accessToken: string, providerFileId: string): Promise<Buffer>;

  /**
   * Simple upload of file content buffer (Phase 5)
   */
  uploadSimpleFile?(
    accessToken: string,
    metadata: { name: string; mimeType: string; content: Buffer; parentFolderId?: string }
  ): Promise<ProviderFileMetadata>;

  /**
   * Obtains a secure read/download stream or URL
   */
  getDownloadUrl(accessToken: string, providerFileId: string): Promise<string>;

  /**
   * Performs a health check against the provider endpoint
   */
  checkHealth(accessToken: string): Promise<ProviderHealthCheckResult>;
}
