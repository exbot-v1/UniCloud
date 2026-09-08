/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud UploadService & Routing Engine Interface
 * 
 * CORE ARCHITECTURAL PRINCIPLE:
 * Incoming files are dynamically routed to the connected Google Drive account
 * with the most appropriate capacity and health.
 */

import crypto from 'crypto';
import {
  UploadInitiateRequest,
  UploadJob,
  UploadRoutingDecision,
  UploadRoutingStrategy,
  UploadStatus,
} from '../../types/upload.js';
import { StorageAccount, ProviderType } from '../../types/account.js';
import { AppError } from '../utils/errors.js';
import { ErrorCode } from '../../types/api.js';
import { logger } from '../utils/logger.js';
import { accountService } from './AccountService.js';
import { ProviderRegistry } from '../providers/ProviderRegistry.js';
import { query, transaction } from '../../db/client.js';
import { normalizeFolderId } from './FileService.js';

export class UploadService {
  private mapDbToJob(row: any): UploadJob {
    return {
      id: row.id,
      userId: row.user_id,
      targetFolderId: row.target_folder_id || null,
      fileName: row.file_name,
      mimeType: row.mime_type,
      totalSizeBytes: Number(row.total_size_bytes || 0),
      bytesUploaded: Number(row.bytes_uploaded || 0),
      status: row.status as UploadStatus,
      assignedAccountId: row.storage_account_id || null,
      resumableSessionUrl: row.resumable_session_url || undefined,
      errorMessage: row.error_message || undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Evaluates available storage accounts and selects the optimal account for upload.
   */
  evaluateRouting(
    accounts: StorageAccount[],
    fileSizeBytes: number,
    strategy: UploadRoutingStrategy = UploadRoutingStrategy.MOST_FREE_SPACE,
    preferredAccountId?: string
  ): UploadRoutingDecision {
    // Filter accounts that are active and not disabled
    const activeAccounts = accounts.filter(
      (a) => a.status === 'active' && a.isEnabled !== false
    );

    if (activeAccounts.length === 0) {
      throw new AppError(
        ErrorCode.ACCOUNT_NOT_CONNECTED,
        'No active storage accounts available. Please connect at least one Google Drive account.',
        400
      );
    }

    // 1. Manual selection if requested or if strategy is MANUAL
    if (strategy === UploadRoutingStrategy.MANUAL || preferredAccountId) {
      if (!preferredAccountId) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'A target account ID must be provided when using manual upload routing.',
          400
        );
      }
      const matched = activeAccounts.find((a) => a.id === preferredAccountId);
      if (!matched) {
        throw new AppError(
          ErrorCode.ACCOUNT_NOT_CONNECTED,
          `Selected storage account ${preferredAccountId} is disabled, disconnected, or unavailable.`,
          400
        );
      }
      if (matched.quota.freeBytes < fileSizeBytes) {
        throw new AppError(
          ErrorCode.INSUFFICIENT_POOL_STORAGE,
          `Selected account '${matched.displayName || matched.email}' has insufficient space (${Math.round(
            matched.quota.freeBytes / (1024 * 1024)
          )} MB free, ${Math.round(fileSizeBytes / (1024 * 1024))} MB needed).`,
          400
        );
      }
      return {
        selectedAccountId: matched.id,
        strategyUsed: UploadRoutingStrategy.MANUAL,
        reason: `Selected manually by user preference: '${matched.displayName || matched.email}'`,
        availableCapacityBeforeBytes: matched.quota.freeBytes,
        projectedCapacityAfterBytes: matched.quota.freeBytes - fileSizeBytes,
      };
    }

    // 2. Filter accounts with sufficient free space
    const capableAccounts = activeAccounts.filter((a) => a.quota.freeBytes >= fileSizeBytes);

    if (capableAccounts.length === 0) {
      throw new AppError(
        ErrorCode.INSUFFICIENT_POOL_STORAGE,
        `None of the connected active accounts have sufficient free space for ${Math.round(
          fileSizeBytes / (1024 * 1024)
        )} MB.`,
        400
      );
    }

    // 3. Balanced routing strategy: minimize projected percentage utilization across pool
    if (strategy === UploadRoutingStrategy.BALANCED) {
      capableAccounts.sort((a, b) => {
        const ratioA = a.quota.totalBytes > 0 ? (a.quota.usedBytes + fileSizeBytes) / a.quota.totalBytes : 1;
        const ratioB = b.quota.totalBytes > 0 ? (b.quota.usedBytes + fileSizeBytes) / b.quota.totalBytes : 1;
        return ratioA - ratioB;
      });
      const chosen = capableAccounts[0];
      const projPct = chosen.quota.totalBytes > 0
        ? (((chosen.quota.usedBytes + fileSizeBytes) / chosen.quota.totalBytes) * 100).toFixed(1)
        : '0';

      return {
        selectedAccountId: chosen.id,
        strategyUsed: UploadRoutingStrategy.BALANCED,
        reason: `Account '${chosen.displayName || chosen.email}' selected for balanced capacity utilization (projected ${projPct}% used).`,
        availableCapacityBeforeBytes: chosen.quota.freeBytes,
        projectedCapacityAfterBytes: chosen.quota.freeBytes - fileSizeBytes,
      };
    }

    // 4. Most Free Space strategy (default / auto)
    capableAccounts.sort((a, b) => b.quota.freeBytes - a.quota.freeBytes);
    const chosen = capableAccounts[0];

    return {
      selectedAccountId: chosen.id,
      strategyUsed: UploadRoutingStrategy.MOST_FREE_SPACE,
      reason: `Account '${chosen.displayName || chosen.email}' selected with highest available capacity (${Math.round(
        chosen.quota.freeBytes / (1024 * 1024)
      )} MB free).`,
      availableCapacityBeforeBytes: chosen.quota.freeBytes,
      projectedCapacityAfterBytes: chosen.quota.freeBytes - fileSizeBytes,
    };
  }

  /**
   * Initiates an upload job, establishes a Google Drive resumable session,
   * and persists the job in upload_jobs.
   */
  async initiateUpload(
    userId: string,
    req: UploadInitiateRequest,
    accounts?: StorageAccount[]
  ): Promise<UploadJob> {
    if (!req.fileName || typeof req.fileName !== 'string' || req.fileName.trim() === '') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'fileName is required for upload initiation.', 400);
    }
    if (req.fileName.length > 255) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'fileName exceeds maximum length of 255 characters.', 400);
    }
    if (typeof req.sizeBytes !== 'number' || !Number.isFinite(req.sizeBytes) || req.sizeBytes <= 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'sizeBytes must be a positive finite number greater than 0.', 400);
    }

    // 1. Target folder validation if specified
    let parentFolderProviderId: string | undefined = undefined;
    const rawTarget = req.targetFolderId || (req as any).parentId || (req as any).folderId;
    const cleanTargetFolderId = rawTarget ? normalizeFolderId(rawTarget) : null;
    if (cleanTargetFolderId) {
      const folderRes = await query(
        'SELECT * FROM virtual_folders WHERE id = $1 AND user_id = $2',
        [cleanTargetFolderId, userId]
      );
      if (folderRes.rows.length === 0) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Target folder was not found.', 404);
      }
      parentFolderProviderId = folderRes.rows[0].provider_folder_id || undefined;
    }

    // 2. Retrieve user storage accounts
    const userAccounts = accounts || (await accountService.getAccountsForUser(userId));

    // 3. Evaluate routing decision
    const routingDecision = this.evaluateRouting(
      userAccounts,
      req.sizeBytes,
      req.strategy || UploadRoutingStrategy.MOST_FREE_SPACE,
      req.preferredAccountId
    );

    // 4. Obtain valid decrypted access token server-side
    const accessToken = await accountService.getValidAccessToken(
      userId,
      routingDecision.selectedAccountId
    );

    // 5. Initiate resumable upload with Google Drive Provider
    const provider = ProviderRegistry.get(ProviderType.GOOGLE_DRIVE);
    const session = await provider.initiateResumableUpload(accessToken, {
      name: req.fileName,
      mimeType: req.mimeType || 'application/octet-stream',
      sizeBytes: req.sizeBytes,
      parentFolderId: parentFolderProviderId,
    });

    // 6. Persist initial upload job in upload_jobs table
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();

    await query(
      `INSERT INTO upload_jobs (
        id, user_id, storage_account_id, target_folder_id,
        file_name, mime_type, total_size_bytes, bytes_uploaded,
        status, routing_strategy, routing_reason,
        resumable_session_url, error_message, started_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
      [
        jobId,
        userId,
        routingDecision.selectedAccountId,
        cleanTargetFolderId || null,
        req.fileName,
        req.mimeType || 'application/octet-stream',
        req.sizeBytes,
        0,
        UploadStatus.UPLOADING,
        routingDecision.strategyUsed,
        routingDecision.reason,
        session.uploadUri,
        null,
      ]
    );

    logger.info('Resumable upload session initiated', {
      jobId,
      userId,
      targetAccount: routingDecision.selectedAccountId,
      fileName: req.fileName,
      sizeBytes: req.sizeBytes,
    });

    return {
      id: jobId,
      userId,
      targetFolderId: req.targetFolderId || null,
      fileName: req.fileName,
      mimeType: req.mimeType || 'application/octet-stream',
      totalSizeBytes: req.sizeBytes,
      bytesUploaded: 0,
      status: UploadStatus.UPLOADING,
      routingDecision,
      assignedAccountId: routingDecision.selectedAccountId,
      resumableSessionUrl: session.uploadUri,
      startedAt: now,
      updatedAt: now,
    };
  }

  /**
   * Uploads a chunk of data to the Google Drive resumable session for a given job.
   * On completion, safely maps the virtual file and updates storage account quota.
   */
  async uploadChunk(
    userId: string,
    jobId: string,
    chunk: Buffer | Uint8Array,
    contentRange?: string
  ): Promise<{ completed: boolean; bytesUploaded: number; job: UploadJob; file?: any }> {
    // 1. Retrieve job and verify tenant isolation
    const res = await query('SELECT * FROM upload_jobs WHERE id = $1 AND user_id = $2', [
      jobId,
      userId,
    ]);
    if (res.rows.length === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Upload job not found or unauthorized.', 404);
    }
    const job = this.mapDbToJob(res.rows[0]);

    if (job.status === UploadStatus.COMPLETED) {
      return { completed: true, bytesUploaded: job.totalSizeBytes, job };
    }
    if (job.status === UploadStatus.ABORTED) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'This upload job has been aborted.', 400);
    }
    if (!job.resumableSessionUrl) {
      throw new AppError(ErrorCode.PROVIDER_ERROR, 'Resumable upload session URL is missing.', 500);
    }

    // Verify assigned storage account is enabled
    if (job.assignedAccountId) {
      const account = await accountService.getAccountById(userId, job.assignedAccountId);
      if (account.isEnabled === false) {
        throw new AppError(ErrorCode.ACCOUNT_DISABLED, 'Assigned storage account is currently disabled.', 400);
      }
    }

    // 2. Parse chunk ranges
    let startByte = job.bytesUploaded;
    let endByte = startByte + chunk.byteLength - 1;
    let totalBytes = job.totalSizeBytes;

    if (contentRange) {
      const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/.exec(contentRange);
      if (match) {
        startByte = parseInt(match[1], 10);
        endByte = parseInt(match[2], 10);
        if (match[3] !== '*') {
          totalBytes = parseInt(match[3], 10);
        }
      }
    }

    // 3. Delegate to Google Drive Provider
    const provider = ProviderRegistry.get(ProviderType.GOOGLE_DRIVE);
    let chunkResult;
    try {
      chunkResult = await provider.uploadChunk!(job.resumableSessionUrl, chunk, {
        startByte,
        endByte,
        totalBytes,
        mimeType: job.mimeType,
      });
    } catch (err: any) {
      logger.error('Resumable chunk upload failed', {
        jobId,
        error: err.message,
      });
      await query(
        'UPDATE upload_jobs SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4',
        [UploadStatus.FAILED, err.message, jobId, userId]
      );
      throw err;
    }

    // 4. Handle partial chunk vs completion
    if (!chunkResult.completed) {
      await query(
        'UPDATE upload_jobs SET bytes_uploaded = $1, status = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4',
        [chunkResult.bytesUploaded, UploadStatus.UPLOADING, jobId, userId]
      );
      job.bytesUploaded = chunkResult.bytesUploaded;
      job.status = UploadStatus.UPLOADING;
      return { completed: false, bytesUploaded: chunkResult.bytesUploaded, job };
    }

    // 5. Completion flow: atomically claim completion first to avoid race conditions and double-counting quota
    const virtualFileId = crypto.randomUUID();
    const providerFileId = chunkResult.file?.providerFileId || `gdrive_${jobId}`;
    let vfRow: any = null;
    let alreadyCompleted = false;

    await transaction(async (tx) => {
      const claimRes = await tx.query(
        `UPDATE upload_jobs 
         SET bytes_uploaded = $1, status = $2, completed_at = NOW(), updated_at = NOW() 
         WHERE id = $3 AND user_id = $4 AND status != $2
         RETURNING id`,
        [job.totalSizeBytes, UploadStatus.COMPLETED, jobId, userId]
      );

      if (claimRes.rowCount === 0) {
        alreadyCompleted = true;
        return;
      }

      const vfRes = await tx.query(
        `INSERT INTO virtual_files (
          id, user_id, storage_account_id, parent_id, provider, provider_file_id,
          name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
          provider_created_at, provider_modified_at, synced_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE, FALSE, $12, $13, NOW(), NOW(), NOW())
        ON CONFLICT (storage_account_id, provider_file_id) DO UPDATE SET
          name = EXCLUDED.name,
          mime_type = EXCLUDED.mime_type,
          size_bytes = EXCLUDED.size_bytes,
          synced_at = NOW(),
          updated_at = NOW()
        RETURNING *`,
        [
          virtualFileId,
          userId,
          job.assignedAccountId,
          job.targetFolderId || null,
          'google_drive',
          providerFileId,
          job.fileName,
          job.mimeType,
          job.totalSizeBytes,
          chunkResult.file?.md5Checksum || null,
          chunkResult.file?.webUrl || null,
          chunkResult.file?.createdAt || new Date().toISOString(),
          chunkResult.file?.modifiedAt || new Date().toISOString(),
        ]
      );
      vfRow = vfRes.rows[0];

      // Update storage account used / free quota atomically
      if (job.assignedAccountId && job.totalSizeBytes > 0) {
        await tx.query(
          `UPDATE storage_accounts SET 
            used_bytes = used_bytes + $1, 
            free_bytes = GREATEST(0, free_bytes - $1), 
            updated_at = NOW() 
           WHERE id = $2 AND user_id = $3`,
          [job.totalSizeBytes, job.assignedAccountId, userId]
        );
      }
    });

    if (alreadyCompleted) {
      logger.info(`Upload job ${jobId} was already completed concurrently; avoiding double quota deduction.`);
      const existingJob = await this.getJobStatus(userId, jobId);
      return { completed: true, bytesUploaded: job.totalSizeBytes, job: existingJob };
    }

    job.bytesUploaded = job.totalSizeBytes;
    job.status = UploadStatus.COMPLETED;
    job.completedAt = new Date().toISOString();

    logger.info('Resumable upload completed successfully', {
      jobId,
      virtualFileId,
      providerFileId,
      totalBytes: job.totalSizeBytes,
    });

    return {
      completed: true,
      bytesUploaded: job.totalSizeBytes,
      job,
      file: vfRow,
    };
  }

  /**
   * Retrieves current status and progress of an upload job.
   */
  async getJobStatus(userId: string, jobId: string): Promise<UploadJob> {
    const res = await query('SELECT * FROM upload_jobs WHERE id = $1 AND user_id = $2', [
      jobId,
      userId,
    ]);
    if (res.rows.length === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Upload job not found or unauthorized.', 404);
    }
    return this.mapDbToJob(res.rows[0]);
  }

  /**
   * Aborts an in-progress upload job without corrupting the virtual filesystem.
   */
  async abortUpload(userId: string, jobId: string): Promise<UploadJob> {
    const res = await query('SELECT * FROM upload_jobs WHERE id = $1 AND user_id = $2', [
      jobId,
      userId,
    ]);
    if (res.rows.length === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Upload job not found or unauthorized.', 404);
    }
    const job = this.mapDbToJob(res.rows[0]);
    if (job.status === UploadStatus.COMPLETED) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Cannot abort an already completed upload.', 400);
    }

    await query(
      'UPDATE upload_jobs SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
      [UploadStatus.ABORTED, jobId, userId]
    );
    job.status = UploadStatus.ABORTED;
    return job;
  }

  /**
   * Attempts to recover or retry an interrupted or failed upload job.
   */
  async retryUpload(userId: string, jobId: string): Promise<UploadJob> {
    const res = await query('SELECT * FROM upload_jobs WHERE id = $1 AND user_id = $2', [
      jobId,
      userId,
    ]);
    if (res.rows.length === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Upload job not found or unauthorized.', 404);
    }
    const job = this.mapDbToJob(res.rows[0]);
    if (job.status === UploadStatus.COMPLETED) {
      return job;
    }

    // 1. Attempt to check upstream status with Google Drive if session exists
    if (job.resumableSessionUrl) {
      try {
        const provider = ProviderRegistry.get(ProviderType.GOOGLE_DRIVE);
        const status = await provider.getUploadStatus!(
          job.resumableSessionUrl,
          job.totalSizeBytes
        );
        if (status.completed) {
          const finished = await this.uploadChunk(
            userId,
            jobId,
            Buffer.alloc(0),
            `bytes */${job.totalSizeBytes}`
          );
          return finished.job;
        } else {
          await query(
            'UPDATE upload_jobs SET bytes_uploaded = $1, status = $2, error_message = NULL, updated_at = NOW() WHERE id = $3 AND user_id = $4',
            [status.bytesUploaded, UploadStatus.UPLOADING, jobId, userId]
          );
          job.bytesUploaded = status.bytesUploaded;
          job.status = UploadStatus.UPLOADING;
          job.errorMessage = undefined;
          return job;
        }
      } catch (err: any) {
        logger.warn('Google Drive session recovery failed; re-initiating session', {
          error: err.message,
        });
      }
    }

    // 2. If upstream session expired or unreachable, re-initiate on target account
    if (!job.assignedAccountId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'No assigned account found on job to retry.', 400);
    }
    const account = await accountService.getAccountById(userId, job.assignedAccountId);
    if (account.isEnabled === false) {
      throw new AppError(ErrorCode.ACCOUNT_DISABLED, 'Assigned storage account is currently disabled.', 400);
    }
    const accessToken = await accountService.getValidAccessToken(userId, job.assignedAccountId);
    const provider = ProviderRegistry.get(ProviderType.GOOGLE_DRIVE);
    const session = await provider.initiateResumableUpload(accessToken, {
      name: job.fileName,
      mimeType: job.mimeType,
      sizeBytes: job.totalSizeBytes,
    });

    await query(
      'UPDATE upload_jobs SET resumable_session_url = $1, bytes_uploaded = 0, status = $2, error_message = NULL, updated_at = NOW() WHERE id = $3 AND user_id = $4',
      [session.uploadUri, UploadStatus.UPLOADING, jobId, userId]
    );

    job.resumableSessionUrl = session.uploadUri;
    job.bytesUploaded = 0;
    job.status = UploadStatus.UPLOADING;
    job.errorMessage = undefined;
    return job;
  }

  /**
   * Lists recent upload jobs for a user.
   */
  async listJobs(userId: string, limit: number = 20): Promise<UploadJob[]> {
    const res = await query(
      'SELECT * FROM upload_jobs WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2',
      [userId, limit]
    );
    return res.rows.map((r) => this.mapDbToJob(r));
  }
}

export const uploadService = new UploadService();

