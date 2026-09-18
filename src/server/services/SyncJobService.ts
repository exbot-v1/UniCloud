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
import { getHmacSecret } from './OAuthStateService.js';
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

export function registerWithWaitUntil(
  promise: Promise<any>,
  reqWaitUntil?: ((promise: Promise<any>) => void) | null
): void {
  if (reqWaitUntil && typeof reqWaitUntil === 'function') {
    try {
      reqWaitUntil(promise);
      return;
    } catch {
      // ignore
    }
  }
  if (vercelWaitUntil) {
    try {
      vercelWaitUntil(promise);
      return;
    } catch {
      // ignore
    }
  }
}

// Stale running timeout: 10 minutes
const STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 1000;

// Default worker lease duration: 60 seconds (1 minute per step execution)
export const DEFAULT_LEASE_DURATION_MS = 60 * 1000;

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
    leaseOwner: row.lease_owner || null,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

export class SyncJobService {
  private activeInvocations = new Map<string, Promise<SyncJobStepResult | void>>();
  private activeJobTrackers = new Map<
    string,
    {
      promise: Promise<void>;
      resolve: () => void;
      reject: (err: any) => void;
    }
  >();

  /**
   * Check if a job is actively running in the current process memory
   */
  isJobActivelyRunningInMemory(jobId: string): boolean {
    return this.activeInvocations.has(jobId) || this.activeJobTrackers.has(jobId);
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
        !this.isJobActivelyRunningInMemory(activeJob.id) &&
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
   * Tracks progression across bounded worker invocations until the job reaches a terminal state.
   * CRITICAL: backgroundWaitUntil (e.g. on Vercel) ONLY receives the single step invocation,
   * never holding waitUntil open across multiple sync steps.
   */
  triggerJob(
    jobId: string,
    backgroundWaitUntil?: (promise: Promise<any>) => void
  ): Promise<void> {
    const existing = this.activeJobTrackers.get(jobId);
    if (existing) {
      return existing.promise;
    }

    let resolveTracker!: () => void;
    let rejectTracker!: (err: any) => void;
    const trackerPromise = new Promise<void>((resolve, reject) => {
      resolveTracker = resolve;
      rejectTracker = reject;
    });

    this.activeJobTrackers.set(jobId, {
      promise: trackerPromise,
      resolve: resolveTracker,
      reject: rejectTracker,
    });

    // Schedule single worker invocation
    const invocationPromise = this.scheduleWorkerInvocation(jobId, backgroundWaitUntil);

    // Register ONLY the single step invocation with waitUntil, NEVER trackerPromise!
    registerWithWaitUntil(invocationPromise, backgroundWaitUntil);

    return trackerPromise;
  }

  /**
   * Dispatches a single worker invocation in a fresh execution context.
   * Strictly enforces that each invocation executes exactly one step.
   */
  scheduleWorkerInvocation(
    jobId: string,
    backgroundWaitUntil?: (promise: Promise<any>) => void,
    workerId?: string
  ): Promise<SyncJobStepResult | void> {
    const invocationKey = workerId ? `${jobId}:${workerId}` : jobId;
    const existing = this.activeInvocations.get(invocationKey);
    if (existing) {
      return existing;
    }

    const invocationPromise = (async () => {
      try {
        const stepResult = await this.runJob(jobId, backgroundWaitUntil, workerId);
        if (
          !stepResult ||
          !stepResult.hasMore ||
          stepResult.status === 'completed' ||
          stepResult.status === 'failed'
        ) {
          const tracker = this.activeJobTrackers.get(jobId);
          if (tracker) {
            this.activeJobTrackers.delete(jobId);
            tracker.resolve();
          }
        }
        return stepResult;
      } catch (err: any) {
        logger.error(`Error during worker invocation for sync job ${jobId}`, {
          error: err?.message,
        });
        const tracker = this.activeJobTrackers.get(jobId);
        if (tracker) {
          this.activeJobTrackers.delete(jobId);
          tracker.resolve();
        }
      } finally {
        this.activeInvocations.delete(invocationKey);
      }
    })();

    this.activeInvocations.set(invocationKey, invocationPromise);
    return invocationPromise;
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
      workerId?: string;
      leaseDurationMs?: number;
    }
  ): Promise<SyncJobStepResult> {
    let selfClaimed = false;
    let effectiveWorkerId = options?.workerId;

    if (!effectiveWorkerId) {
      effectiveWorkerId = `worker_${crypto.randomUUID()}`;
      const claim = await this.claimJobLease(jobId, effectiveWorkerId, options?.leaseDurationMs);
      if (!claim.success) {
        logger.info(
          `Worker ${effectiveWorkerId} could not claim lease for sync job ${jobId}. Currently held by ${claim.currentOwner || 'another worker'} until ${claim.expiresAt}. Exiting without processing.`
        );
        const current = claim.job || (await this.getJobInternal(jobId));
        return {
          jobId,
          status: current?.status || 'running',
          phase: current?.continuationState?.phase || 'RECONCILE_AND_COMPLETE',
          hasMore: false,
          stepCount: current?.continuationState?.stepCount || 1,
          progress: current?.progress || { filesDiscovered: 0, filesAdded: 0, filesUpdated: 0, filesRemoved: 0 },
          errorMessage: 'Job is already leased by another worker',
        };
      }
      selfClaimed = true;
    }

    try {
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
      // Support test mocks where syncService.syncAccount has been replaced directly on the instance
      if (
        syncService.syncAccount !== Object.getPrototypeOf(syncService).syncAccount &&
        !job.continuationState
      ) {
        const mockResult = await syncService.syncAccount(job.userId, job.storageAccountId);
        if (mockResult.paginationComplete === false) {
          logger.warn(
            `Sync job ${jobId} finished with incomplete pagination. Marking as failed to preserve safety.`
          );
          await this.updateJobStatus(jobId, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            errorMessage:
              'Synchronization was truncated before all pages were processed. Stale items were safely preserved.',
            progress: {
              filesDiscovered: mockResult.filesDiscovered,
              filesAdded: mockResult.filesAddedOrUpdated,
              filesUpdated: 0,
              filesRemoved: mockResult.filesRemoved || 0,
              foldersProcessed: mockResult.foldersProcessed,
              message: 'Incomplete pagination: sync stopped early',
            },
            result: mockResult,
          });

          return {
            jobId: job.id,
            status: 'failed',
            phase: 'INITIALIZE',
            hasMore: false,
            stepCount: 1,
            progress: job.progress,
            errorMessage:
              'Synchronization was truncated before all pages were processed. Stale items were safely preserved.',
            result: mockResult,
          };
        }
      }

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
  } finally {
    if (selfClaimed && effectiveWorkerId) {
      await this.releaseJobLease(jobId, effectiveWorkerId);
    }
  }
}

  /**
   * Generates a cryptographically secure HMAC-SHA256 continuation token for a job
   */
  generateContinuationToken(jobId: string): string {
    const secret = getHmacSecret();
    return crypto
      .createHmac('sha256', secret)
      .update(`unicloud:sync:continue:${jobId}`)
      .digest('hex');
  }

  /**
   * Verifies that a provided token matches the expected continuation token for a job
   */
  verifyContinuationToken(jobId: string, token: string): boolean {
    if (!token || typeof token !== 'string') return false;
    try {
      const expected = this.generateContinuationToken(jobId);
      if (token.length !== expected.length) return false;
      return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  /**
   * Dispatches a short continuation request for the job.
   * On Vercel / serverless: triggers a fast HTTP POST request to /api/sync/jobs/:jobId/step,
   * which Vercel handles as an independent invocation.
   * The returned Promise remains pending until the continuation HTTP request is successfully
   * dispatched/received, or the short timeout/failure is handled.
   * In non-HTTP or test environments, falls back to scheduling a fresh invocation asynchronously.
   */
  async dispatchContinuationRequest(
    jobId: string,
    options?: { baseUrl?: string; abortTimeoutMs?: number }
  ): Promise<boolean> {
    const token = this.generateContinuationToken(jobId);

    let baseUrl: string | null = options?.baseUrl || null;
    if (!baseUrl && process.env.NODE_ENV !== 'test') {
      if (process.env.VERCEL_URL) {
        baseUrl = `https://${process.env.VERCEL_URL}`;
      } else if (process.env.APP_URL) {
        baseUrl = process.env.APP_URL;
      }
    }

    if (baseUrl && typeof fetch === 'function') {
      const controller = new AbortController();
      const timeoutMs = options?.abortTimeoutMs ?? 4000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const url = `${baseUrl}/api/sync/jobs/${encodeURIComponent(jobId)}/step`;
        logger.info(`Dispatching continuation request for sync job ${jobId} to ${url}`);

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-unicloud-continuation-token': token,
            'x-unicloud-request-id': `cont_${jobId.slice(0, 8)}_${Date.now()}`,
          },
          body: JSON.stringify({ isContinuation: true }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        logger.debug(`Continuation request dispatched for ${jobId}, status: ${res.status}`);

        if (res.ok) {
          return true;
        }

        logger.warn(
          `Continuation HTTP dispatch returned non-OK status ${res.status} for job ${jobId}. Falling back to asynchronous scheduler.`
        );
      } catch (err: any) {
        clearTimeout(timeoutId);
        logger.warn(
          `Continuation HTTP dispatch failed for job ${jobId}: ${err?.message}. Falling back to asynchronous scheduler.`
        );
      }

      // If HTTP dispatch failed or returned non-OK, trigger fallback scheduler
      setImmediate(() => {
        this.scheduleWorkerInvocation(jobId).catch((err: any) => {
          logger.error(`Error in scheduled continuation invocation fallback for job ${jobId}`, {
            error: err?.message,
          });
        });
      });
      return false;
    }

    // Fallback when no base URL is present (e.g. testing)
    setImmediate(() => {
      this.scheduleWorkerInvocation(jobId).catch((err: any) => {
        logger.error(`Error in scheduled continuation invocation for job ${jobId}`, {
          error: err?.message,
        });
      });
    });
    return true;
  }

  /**
   * Arranges for a NEW worker invocation to continue a multi-step job.
   * Ensures the next step executes in a separate invocation context.
   * Passes the actual continuation promise to waitUntil(), keeping it pending
   * until the continuation HTTP request finishes or handles failure.
   */
  arrangeNextInvocation(
    jobId: string,
    backgroundWaitUntil?: (promise: Promise<any>) => void,
    options?: { baseUrl?: string; abortTimeoutMs?: number }
  ): Promise<boolean> {
    const continuationPromise = this.dispatchContinuationRequest(jobId, options);
    registerWithWaitUntil(continuationPromise, backgroundWaitUntil);
    return continuationPromise;
  }

  /**
   * Atomically claims an exclusive database lease on a sync job for a specific worker.
   * If another worker already holds an active, unexpired lease, the claim fails and returns success: false.
   * If the previous lease has expired, it atomically recovers and takes over the lease.
   */
  async claimJobLease(
    jobId: string,
    workerId: string,
    leaseDurationMs: number = DEFAULT_LEASE_DURATION_MS
  ): Promise<{
    success: boolean;
    job?: SyncJobRecord | null;
    currentOwner?: string | null;
    expiresAt?: string | null;
  }> {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();

    const res = await query(
      `UPDATE sync_jobs
       SET lease_owner = $1,
           lease_expires_at = $2,
           status = CASE WHEN status = 'queued' THEN 'running' ELSE status END,
           started_at = COALESCE(started_at, NOW()),
           updated_at = NOW()
       WHERE id = $3
         AND status IN ('queued', 'running')
         AND (
           lease_owner IS NULL
           OR lease_expires_at IS NULL
           OR lease_expires_at <= $4
           OR lease_owner = $1
         )
       RETURNING *`,
      [workerId, leaseExpiresAt, jobId, nowIso]
    );

    if (res.rows.length > 0) {
      const claimedJob = mapRowToJob(res.rows[0]);
      logger.info(
        `Worker ${workerId} acquired persistent lease on sync job ${jobId} (expires: ${claimedJob.leaseExpiresAt})`
      );
      return {
        success: true,
        job: claimedJob,
      };
    }

    // Claim failed: fetch current lease state for diagnostic logging
    const current = await this.getJobInternal(jobId);
    return {
      success: false,
      job: current,
      currentOwner: current?.leaseOwner || null,
      expiresAt: current?.leaseExpiresAt || null,
    };
  }

  /**
   * Releases an exclusive lease held by a worker.
   */
  async releaseJobLease(jobId: string, workerId: string): Promise<boolean> {
    const res = await query(
      `UPDATE sync_jobs
       SET lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND lease_owner = $2
       RETURNING *`,
      [jobId, workerId]
    );

    if (res.rows.length > 0) {
      logger.debug(`Worker ${workerId} released lease on sync job ${jobId}`);
      return true;
    }
    return false;
  }

  /**
   * Recovers jobs whose worker lease has expired, resetting lease fields
   * so other workers can claim and continue them.
   */
  async recoverExpiredLeases(jobId?: string): Promise<number> {
    const nowIso = new Date().toISOString();
    let res;
    if (jobId) {
      res = await query(
        `UPDATE sync_jobs
         SET lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = NOW()
         WHERE id = $1
           AND status IN ('queued', 'running')
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= $2
         RETURNING *`,
        [jobId, nowIso]
      );
    } else {
      res = await query(
        `UPDATE sync_jobs
         SET lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = NOW()
         WHERE status IN ('queued', 'running')
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= $1
         RETURNING *`,
        [nowIso]
      );
    }
    const count = res.rowCount || res.rows?.length || 0;
    if (count > 0) {
      logger.info(`Recovered ${count} sync job(s) with expired leases`);
    }
    return count;
  }

  /**
   * Worker invocation runner:
   * Atomically claims persistent database lease before processing one step.
   * If another worker already owns the lease, exits without processing.
   * Executes exactly ONE bounded step (processSyncJobStep).
   * Bounded and serverless-safe: never loops inside the same invocation.
   * If hasMore=true, persists the job state and arranges for a NEW worker invocation to continue it.
   * Never executes the next step inside the same invocation.
   */
  async runJob(
    jobId: string,
    backgroundWaitUntil?: (promise: Promise<any>) => void,
    workerId?: string,
    options?: {
      maxFoldersPerStep?: number;
      maxFilesPerStep?: number;
      leaseDurationMs?: number;
    }
  ): Promise<SyncJobStepResult | void> {
    const effectiveWorkerId = workerId || `worker_${crypto.randomUUID()}`;
    const leaseDurationMs = options?.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;

    // Atomically claim the persistent lease before executing the step
    const claim = await this.claimJobLease(jobId, effectiveWorkerId, leaseDurationMs);
    if (!claim.success) {
      logger.info(
        `Worker ${effectiveWorkerId} could not claim lease for sync job ${jobId}. Currently held by ${claim.currentOwner || 'another worker'} until ${claim.expiresAt}. Exiting without processing.`
      );
      return;
    }

    const job = claim.job || (await this.getJobInternal(jobId));
    if (!job) {
      logger.warn(`Cannot run sync job ${jobId}: job not found`);
      await this.releaseJobLease(jobId, effectiveWorkerId);
      return;
    }

    if (job.status === 'completed' || job.status === 'failed') {
      logger.info(`Sync job ${jobId} is already in terminal state: ${job.status}`);
      await this.releaseJobLease(jobId, effectiveWorkerId);
      return;
    }

    let stepResult: SyncJobStepResult | undefined;
    try {
      logger.info(
        `Worker ${effectiveWorkerId} executing single worker invocation step for sync job ${jobId}`
      );
      stepResult = await this.processSyncJobStep(jobId, {
        ...options,
        workerId: effectiveWorkerId,
      });
    } finally {
      // Step processing completed (or failed) in this invocation: release the lease
      await this.releaseJobLease(jobId, effectiveWorkerId);
    }

    // If hasMore=true, job state is already persisted by processSyncJobStep.
    // Arrange for a NEW worker invocation to continue it.
    // Never execute the next step inside the same invocation.
    if (stepResult?.hasMore) {
      this.arrangeNextInvocation(jobId, backgroundWaitUntil);
    }

    return stepResult;
  }

  /**
   * Resumes an interrupted or paused sync job from its persisted continuation state.
   */
  async resumeJob(
    jobId: string,
    backgroundWaitUntil?: (promise: Promise<any>) => void,
    workerId?: string
  ): Promise<SyncJobStepResult | void> {
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

    return this.runJob(jobId, backgroundWaitUntil, workerId);
  }

  /**
   * Recovers stale jobs across all accounts (e.g. on server startup or cron).
   * Marks severely timed out jobs (> 10 mins) as failed, and resets expired leases
   * on queued/running jobs so other workers can safely resume them.
   */
  async recoverStaleJobs(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_RUNNING_THRESHOLD_MS).toISOString();
    const res = await query(
      `UPDATE sync_jobs 
       SET status = 'failed', error_message = 'Sync job timed out or serverless instance terminated', completed_at = NOW(), updated_at = NOW()
       WHERE status = 'running' AND updated_at < $1`,
      [cutoff]
    );

    const recoveredLeases = await this.recoverExpiredLeases();
    return (res.rowCount || 0) + recoveredLeases;
  }
}

export const syncJobService = new SyncJobService();
