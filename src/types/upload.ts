/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Upload & Routing Models
 * 
 * Future upload router routes incoming files to the most appropriate
 * Google Drive account based on available capacity and health.
 */

export enum UploadStatus {
  PENDING = 'pending',
  ROUTED = 'routed',
  INITIALIZING = 'initializing',
  UPLOADING = 'uploading',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ABORTED = 'aborted',
}

export enum UploadRoutingStrategy {
  MOST_FREE_SPACE = 'most_free_space',
  BALANCED = 'balanced',
  MANUAL = 'manual',
  HEALTH_WEIGHTED = 'health_weighted',
}

export interface UploadRoutingDecision {
  selectedAccountId: string;
  strategyUsed: UploadRoutingStrategy;
  reason: string;
  availableCapacityBeforeBytes: number;
  projectedCapacityAfterBytes: number;
}

export interface UploadJob {
  id: string;
  userId: string;
  targetFolderId: string | null;
  fileName: string;
  mimeType: string;
  totalSizeBytes: number;
  bytesUploaded: number;
  status: UploadStatus;
  routingDecision?: UploadRoutingDecision;
  /** Storage account assigned for this upload */
  assignedAccountId: string | null;
  /** Provider-specific session URI (e.g. Google Drive Resumable Upload URI) */
  resumableSessionUrl?: string;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
}

export interface UploadInitiateRequest {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  targetFolderId?: string | null;
  preferredAccountId?: string;
  strategy?: UploadRoutingStrategy;
}
