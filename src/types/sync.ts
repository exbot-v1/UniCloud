/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Sync & Background Job Types
 */

export type SyncJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type SyncJobMode = 'full' | 'delta' | 'auto';

export type SyncPhase =
  | 'INITIALIZE'
  | 'DISCOVER_GLOBAL'
  | 'ENUMERATE_FOLDERS'
  | 'RESOLVE_REMAINING_FILES'
  | 'RECONCILE_AND_COMPLETE';

export interface ResumableFolderTarget {
  providerFolderId: string;
  virtualFolderId: string | null;
}

export interface DiscoveredFileItem {
  providerFileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  md5Checksum?: string | null;
  webUrl?: string | null;
  isStarred?: boolean;
  isTrashed?: boolean;
  createdAt?: string;
  modifiedAt?: string;
  parentFolderId?: string | null;
  parentFolderIds?: string[];
}

export interface SyncContinuationState {
  phase: SyncPhase;
  syncStartTime: string;
  stepCount: number;
  
  // Phase DISCOVER_GLOBAL
  globalPageToken?: string | null;
  allQueriesPaginationComplete: boolean;
  allDiscoveredItemIds: string[];
  
  // Folders to process
  // Google provider folder ID -> authoritative virtual_folders UUID
  folderMap: Record<string, string>;
  rootVirtualFolderIds: string[];
  rootProviderFolderIds: string[];
  
  // Folders queue for ENUMERATE_FOLDERS
  foldersToQuery: ResumableFolderTarget[];
  visitedFolders: string[];
  
  // Current folder being paginated (if a folder has multiple pages of children)
  currentFolderPagination?: {
    providerFolderId: string;
    virtualFolderId: string | null;
    pageToken?: string | null;
  } | null;

  // Unresolved file items that were discovered globally
  initialFileItems: DiscoveredFileItem[];
  seenFileProviderIds: string[];
  
  // Progress counters
  filesDiscovered: number;
  filesAddedOrUpdated: number;
  filesRemoved: number;
  foldersProcessed: number;
  
  // Authoritative enumeration tracking
  isEnumerationComplete: boolean;
  isReconciliationComplete: boolean;
}

export interface SyncJobProgress {
  filesDiscovered: number;
  filesAdded: number;
  filesUpdated: number;
  filesRemoved: number;
  foldersProcessed?: number;
  message?: string;
  phase?: SyncPhase;
  stepCount?: number;
  hasMore?: boolean;
}

export interface SyncJobRecord {
  id: string;
  userId: string;
  storageAccountId: string;
  mode: SyncJobMode;
  status: SyncJobStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
  progress: SyncJobProgress;
  result?: any;
  clientRequestId?: string | null;
  continuationState?: SyncContinuationState | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSyncJobResponse {
  jobId: string;
  status: SyncJobStatus;
  job: SyncJobRecord;
  isNew: boolean;
}

export interface SyncJobStepResult {
  jobId: string;
  status: SyncJobStatus;
  phase: SyncPhase;
  hasMore: boolean;
  stepCount: number;
  progress: SyncJobProgress;
  errorMessage?: string | null;
  result?: any;
}

