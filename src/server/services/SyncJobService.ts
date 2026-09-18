/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud SyncJobService
 * 
 * Manages persistent, asynchronous synchronization jobs for storage accounts.
 * Enables non-blocking execution suitable for serverless runtimes (Vercel)
 * and long-running background tasks with pollable progress, idempotent resume,
 * and duplicate-execution protection.
 */

import crypto from 'crypto';
import { query } from '../../db/client.js';
import { AppError } from '../utils/errors.js';
import { ErrorCode } from '../../types/api.js';
import { logger } from '../utils/logger.js';
import { accountService } from './AccountService.js';
import { syncService } from './SyncService.js';
import {
  SyncJobRecord,
  SyncJobStatus,
  SyncJobMode,
  SyncJobProgress,
  CreateSyncJobResponse,
  SyncContinuationState,
  SyncJobStepResult,
} from '../../types/sync.js';

// Safe dynamic waitUntil wrapper for @vercel/functions
let vercelWaitUntil: ((promise: Promise<any>) => void) | null = null;
try {
  // @ts-ignore
  import('@vercel/functions').then((mod) => {
    if (mod && typeof mod.waitUntil === 'function') {
      vercelWaitUntil = mod.waitUntil;
    }
  }).catch(() => {
    // Not running on Vercel or module not present
  });
} catch {
  // Ignore
}

// Stale running timeout: 10 minutes
const STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 1000;

function mapRowToJob(row: any): SyncJobRecord {
  let progress: SyncJobProgress = {
    filesDiscovered: 0,
    filesAdded: 0,
    filesUpdated: 0,
    filesRemoved: 0,
  };

  if (row.progress) {
    if (typeof row.progress === 'string') {
      try {
        progress = JSON.parse(row.progress);
      } catch {
        // use default
      }
    } else if (typeof row.progress === 'object') {
      progress = row.progress;
    }
  }

  let result = row.result;
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result);
    } catch {
      // keep raw or null
    }
  }

  let continuationState = null;
  if (row.continuation_state) {
    if (typeof row.continuation_state === 'string') {
      try {
        continuationState = JSON.parse(row.continuation_state);
      } catch {
        // keep null
      }
    } else if (typeof row.continuation_state === 'object') {
      continuationState = row.continuation_state;
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    storageAccountId: row.storage_account_id,
    mode: (row.mode as SyncJobMode) || 'full',
    status: (row.status as SyncJobStatus) || 'queued',
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    errorMessage: row.error_message || null,
    progress,
    result: result || null,
    clientRequestId: row.client_request_id || null,
    continuationState: continuationState || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

export class SyncJobService {
  private activeExecutions = new Map<string, Promise<void>>();

  /**
   * Check if a job is actively running in the current process memory
   */
  isJobActivelyRunningInMemory(jobId: string): boolean {
    return this.activeExecutions.has(jobId);
  }

  /**
   * Finds an active (queued or running) job for the specified account, or creates a new one.
   * Prevents duplicate concurrent jobs for the same account.
   */
  async createOrGetActiveJob(
    userId: string,
    accountId: string,
    mode: SyncJobMode = 'full',
    clientRequestId?: string
  ): Promise<CreateSyncJobResponse> {
    // 1. Authorize: Verify account exists and belongs to user
    const account = await accountService.getAccountById(userId, accountId);
    if (account.isEnabled === false) {
      throw new AppError(
        ErrorCode.ACCOUNT_DISABLED,
        'Account is disabled. Enable it before syncing.',
        400
      );
    }

    // 2. Check for an active job for this account
    const activeRes = await query(
      `SELECT * FROM sync_jobs 
       WHERE user_id = $1 AND storage_account_id = $2 AND status IN ('queued', 'running')
       ORDER BY created_at DESC 
       LIMIT 1`,
      [userId, accountId]
    );

    if (activeRes.rows.length > 0) {
      const activeJob = mapRowToJob(activeRes.rows[0]);
      const now = Date.now();
      const updatedTime = new Date(activeJob.updatedAt).getTime();
      const isStale =
        activeJob.status === 'running' &&
        !this.activeExecutions.has(activeJob.id) &&
        now - updatedTime > STALE_RUNNING_THRESHOLD_MS;

      if (isStale) {
        logger.warn(
          `Detected stale running sync job ${activeJob.id} for account ${accountId}. Marking as failed and allowing new job.`
        );
        await this.updateJobStatus(activeJob.id, {
          status: 'failed',
          errorMessage: 'Previous synchronization job timed out or container terminated.',
          completedAt: new Date().toISOString(),
        });
      } else {
        logger.info(
          `Active sync job ${activeJob.id} (status: ${activeJob.status}) already exists for account ${accountId}. Reusing.`
        );
        return {
          jobId: activeJob.id,
          status: activeJob.status,
          job: activeJob,
          isNew: false,
        };
      }
    }

    // 3. Create a new queued job
    const newJobId = crypto.randomUUID();
    const initialProgress: SyncJobProgress = {
      filesDiscovered: 0,
      filesAdded: 0,
      filesUpdated: 0,
      filesRemoved: 0,
      message: 'Job queued for background synchronization',
    };

    const insertRes = await query(
      `INSERT INTO sync_jobs (
        id, user_id, storage_account_id, mode, status, client_request_id, progress, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *`,
      [
        newJobId,
        userId,
        accountId,
        mode,
        'queued',
        clientRequestId || null,
        JSON.stringify(initialProgress),
      ]
    );

    const createdJob = mapRowToJob(insertRes.rows[0]);
    logger.info(`Created new sync job ${createdJob.id} for account ${accountId}`, {
      userId,
      mode,
      clientRequestId,
    });

    return {
      jobId: createdJob.id,
      status: createdJob.status,
      job: createdJob,
      isNew: true,
    };
  }

  /**
   * Retrieves a job by ID and verifies user ownership.
   */
  async getJobById(userId: string, jobId: string): Promise<SyncJobRecord | null> {
    const res = await query(
      `SELECT * FROM sync_jobs WHERE id = $1 AND user_id = $2`,
      [jobId, userId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return mapRowToJob(res.rows[0]);
  }

  /**
   * Retrieves a job by ID for internal workers (no user check).
   */
  async getJobInternal(jobId: string): Promise<SyncJobRecord | null> {
    const res = await query(`SELECT * FROM sync_jobs WHERE id = $1`, [jobId]);
    if (res.rows.length === 0) {
      return null;
    }
    return mapRowToJob(res.rows[0]);
  }

  /**
   * Updates job attributes in the database.
   */
  async updateJobStatus(
    jobId: string,
    updates: {
      status?: SyncJobStatus;
      startedAt?: string | null;
      completedAt?: string | null;
      errorMessage?: string | null;
      progress?: SyncJobProgress;
      result?: any;
      continuationState?: SyncContinuationState | null;
    }
  ): Promise<SyncJobRecord | null> {
    const existing = await this.getJobInternal(jobId);
    if (!existing) return null;

    const newStatus = updates.status || existing.status;
    const newStartedAt = updates.startedAt !== undefined ? updates.startedAt : existing.startedAt;
    const newCompletedAt = updates.completedAt !== undefined ? updates.completedAt : existing.completedAt;
    const newErrorMessage = updates.errorMessage !== undefined ? updates.errorMessage : existing.errorMessage;
    const newProgress = updates.progress || existing.progress;
    const newResult = updates.result !== undefined ? updates.result : existing.result;
    const newContinuationState =
      updates.continuationState !== undefined ? updates.continuationState : existing.continuationState;

    const res = await query(
      `UPDATE sync_jobs 
       SET status = $1, started_at = $2, completed_at = $3, error_message = $4, progress = $5, result = $6, continuation_state = $7, updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        newStatus,
        newStartedAt,
        newCompletedAt,
        newErrorMessage,
        JSON.stringify(newProgress),
        newResult ? JSON.stringify(newResult) : null,
        newContinuationState ? JSON.stringify(newContinuationState) : null,
        jobId,
      ]
    );

    return res.rows[0] ? mapRowToJob(res.rows[0]) : null;
  }

  /**
   * Triggers the background execution of a sync job if not already running in this process.
   */
  triggerJob(jobId: string, backgroundWaitUntil?: (promise: Promise<any>) => void): Promise<void> {
    const existingExecution = this.activeExecutions.get(jobId);
    if (existingExecution) {
      return existingExecution;
    }

    const executionPromise = (async () => {
      try {
        await this.runJob(jobId);
      } catch (err: any) {
        logger.error(`Error during background sync job ${jobId}`, {
          error: err?.message,
        });
      } finally {
        this.activeExecutions.delete(jobId);
      }
    })();

    this.activeExecutions.set(jobId, executionPromise);

    // Register with waitUntil if available
    if (backgroundWaitUntil && typeof backgroundWaitUntil === 'function') {
      try {
        backgroundWaitUntil(executionPromise);
      } catch {
        // ignore
      }
    } else if (vercelWaitUntil) {
      try {
        vercelWaitUntil(executionPromise);
      } catch {
        // ignore
      }
    }

    return executionPromise;
  }

  /**
   * Advances a sync job by one bounded execution step.
   * Persists updated continuation_state to ensure execution survives timeouts or restarts.
   */
  async processSyncJobStep(
    jobId: string,
    options?: {
      maxFoldersPerStep?: number;
      maxFilesPerStep?: number;
    }
  ): Promise<SyncJobStepResult> {
    const job = await this.getJobInternal(jobId);
    if (!job) {
      throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, `Sync job ${jobId} not found`, 404);
    }

    if (job.status === 'completed' || job.status === 'failed') {
      return {
        jobId: job.id,
        status: job.status,
        phase: job.continuationState?.phase || 'RECONCILE_AND_COMPLETE',
        hasMore: false,
        stepCount: job.continuationState?.stepCount || 1,
        progress: job.progress,
        errorMessage: job.errorMessage,
        result: job.result,
      };
    }

    if (job.status === 'queued') {
      await this.updateJobStatus(jobId, {
        status: 'running',
        startedAt: job.startedAt || new Date().toISOString(),
      });
    }

    try {
      const stepOutput = await syncService.executeBoundedStep(
        job.userId,
        job.storageAccountId,
        job.continuationState || null,
        job.mode,
        options
      );

      if (stepOutput.hasMore) {
        await this.updateJobStatus(jobId, {
          status: 'running',
          continuationState: stepOutput.state,
          progress: stepOutput.progress,
        });

        return {
          jobId: job.id,
          status: 'running',
          phase: stepOutput.state.phase,
          hasMore: true,
          stepCount: stepOutput.state.stepCount,
          progress: stepOutput.progress,
        };
      } else {
        // Final phase reached
        if (stepOutput.syncResult?.paginationComplete === false) {
          logger.warn(
            `Sync job ${jobId} finished with incomplete pagination. Marking as failed to preserve safety.`
          );
          await this.updateJobStatus(jobId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            errorMessage:
              'Synchronization was truncated before all pages were processed. Stale items were safely preserved.',
            continuationState: stepOutput.state,
            progress: {
              ...stepOutput.progress,
              message: 'Incomplete pagination: sync stopped early',
            },
            result: stepOutput.syncResult,
          });

          return {
            jobId: job.id,
            status: 'failed',
            phase: stepOutput.state.phase,
            hasMore: false,
            stepCount: stepOutput.state.stepCount,
            progress: stepOutput.progress,
            errorMessage:
              'Synchronization was truncated before all pages were processed. Stale items were safely preserved.',
            result: stepOutput.syncResult,
          };
        }

        await this.updateJobStatus(jobId, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          continuationState: stepOutput.state,
          progress: {
            ...stepOutput.progress,
            message: 'Synchronization completed successfully',
          },
          result: stepOutput.syncResult,
        });

        return {
          jobId: job.id,
          status: 'completed',
          phase: stepOutput.state.phase,
          hasMore: false,
          stepCount: stepOutput.state.stepCount,
          progress: stepOutput.progress,
          result: stepOutput.syncResult,
        };
      }
    } catch (err: any) {
      logger.error(`Error processing step for sync job ${jobId}`, {
        error: err?.message,
      });

      await this.updateJobStatus(jobId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        errorMessage: err?.message || 'Sync step execution failed',
        progress: {
          ...job.progress,
          message: err?.message || 'Sync step execution failed',
        },
      });

      return {
        jobId: job.id,
        status: 'failed',
        phase: job.continuationState?.phase || 'INITIALIZE',
        hasMore: false,
        stepCount: (job.continuationState?.stepCount || 0) + 1,
        progress: job.progress,
        errorMessage: err?.message || 'Sync step execution failed',
      };
    }
  }

  /**
   * Internal job runner: executes sync job to completion.
   * If continuationState exists, advances bounded steps sequentially.
   * Otherwise invokes syncService directly (which delegates to bounded steps, or mocks in test suites).
   */
  private async runJob(jobId: string): Promise<void> {
    const job = await this.getJobInternal(jobId);
    if (!job) {
      logger.warn(`Cannot run sync job ${jobId}: job not found`);
      return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
      logger.info(`Sync job ${jobId} is already in terminal state: ${job.status}`);
      return;
    }

    if (job.continuationState) {
      logger.info(`Resuming existing continuation state for sync job ${jobId}`);
      let hasMore = true;
      while (hasMore) {
        const stepResult = await this.processSyncJobStep(jobId);
        hasMore = stepResult.hasMore;
        if (stepResult.status === 'failed' || stepResult.status === 'completed') {
          break;
        }
      }
      return;
    }

    const startTime = new Date().toISOString();
    logger.info(`Beginning execution of sync job ${jobId} for account ${job.storageAccountId}`);

    await this.updateJobStatus(jobId, {
      status: 'running',
      startedAt: startTime,
      progress: {
        ...job.progress,
        message: 'Synchronizing Drive metadata...',
      },
    });

    try {
      let syncResult;

      if (job.mode === 'full') {
        syncResult = await syncService.syncAccount(job.userId, job.storageAccountId);
      } else if (job.mode === 'delta') {
        syncResult = await syncService.syncDelta(job.userId, job.storageAccountId);
      } else {
        // auto
        const isInitComplete = await syncService.isInitialSyncComplete(
          job.userId,
          job.storageAccountId
        );
        const token = await accountService.getChangeToken(job.userId, job.storageAccountId);
        if (token && isInitComplete) {
          syncResult = await syncService.syncDelta(job.userId, job.storageAccountId);
        } else {
          syncResult = await syncService.syncAccount(job.userId, job.storageAccountId);
        }
      }

      if (syncResult.paginationComplete === false) {
        logger.warn(
          `Sync job ${jobId} finished with incomplete pagination. Marking as failed to preserve safety.`
        );
        await this.updateJobStatus(jobId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          errorMessage:
            'Synchronization was truncated before all pages were processed. Stale items were safely preserved.',
          progress: {
            filesDiscovered: syncResult.filesDiscovered,
            filesAdded: syncResult.filesAddedOrUpdated,
            filesUpdated: 0,
            filesRemoved: syncResult.filesRemoved || 0,
            foldersProcessed: syncResult.foldersProcessed,
            message: 'Incomplete pagination: sync stopped early',
          },
          result: syncResult,
        });
        return;
      }

      const completedTime = new Date().toISOString();
      await this.updateJobStatus(jobId, {
        status: 'completed',
        completedAt: completedTime,
        progress: {
          filesDiscovered: syncResult.filesDiscovered,
          filesAdded: syncResult.filesAddedOrUpdated,
          filesUpdated: 0,
          filesRemoved: syncResult.filesRemoved || 0,
          foldersProcessed: syncResult.foldersProcessed,
          message: 'Synchronization completed successfully',
        },
        result: syncResult,
      });

      logger.info(`Sync job ${jobId} completed successfully`, {
        accountId: job.storageAccountId,
        filesDiscovered: syncResult.filesDiscovered,
        filesAdded: syncResult.filesAddedOrUpdated,
        filesRemoved: syncResult.filesRemoved,
      });
    } catch (err: any) {
      logger.error(`Sync job ${jobId} execution failed`, {
        error: err?.message,
      });

      const failedTime = new Date().toISOString();
      await this.updateJobStatus(jobId, {
        status: 'failed',
        completedAt: failedTime,
        errorMessage: err?.message || 'Synchronization failed',
        progress: {
          ...job.progress,
          message: err?.message || 'Synchronization failed',
        },
      });
    }
  }

  /**
   * Recovers stale jobs across all accounts (e.g. on server startup or cron)
   */
  async recoverStaleJobs(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_RUNNING_THRESHOLD_MS).toISOString();
    const res = await query(
      `UPDATE sync_jobs 
       SET status = 'failed', error_message = 'Sync job timed out or serverless instance terminated', completed_at = NOW(), updated_at = NOW()
       WHERE status = 'running' AND updated_at < $1`,
      [cutoff]
    );
    return res.rowCount || 0;
  }
}

export const syncJobService = new SyncJobService();
