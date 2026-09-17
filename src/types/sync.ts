/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Sync & Background Job Types
 */

export type SyncJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type SyncJobMode = 'full' | 'delta' | 'auto';

export interface SyncJobProgress {
  filesDiscovered: number;
  filesAdded: number;
  filesUpdated: number;
  filesRemoved: number;
  foldersProcessed?: number;
  message?: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface CreateSyncJobResponse {
  jobId: string;
  status: SyncJobStatus;
  job: SyncJobRecord;
  isNew: boolean;
}
