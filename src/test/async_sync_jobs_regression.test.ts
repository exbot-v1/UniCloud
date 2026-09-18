/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Asynchronous Sync Jobs & Serverless Non-Blocking Regression Test Suite
 * 
 * Verifies:
 * 1. POST /api/accounts/:id/sync returns HTTP 202 Accepted immediately without awaiting full sync.
 * 2. GET /api/sync/jobs/:jobId returns accurate status, progress, and result in valid JSON.
 * 3. Successful background completion records full metadata and sets status to completed.
 * 4. Background failure safely captures error messages and marks status as failed.
 * 5. Duplicate sync prevention reuses existing queued/running job without starting concurrent syncs.
 * 6. Serverless interruption recovery correctly detects and transitions stale running jobs.
 * 7. Incomplete/truncated sync strictly skips stale-file reconciliation and marks initial sync incomplete.
 * 8. Authoritative complete sync properly performs root-safe stale reconciliation.
 */

process.env.NODE_ENV = 'test';

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { app, initializeServerlessInstance } from '../../api/index.js';
import { ensureSchema, query } from '../db/client.js';
import { UserService } from '../server/services/UserService.js';
import { accountService } from '../server/services/AccountService.js';
import { syncService } from '../server/services/SyncService.js';
import { syncJobService } from '../server/services/SyncJobService.js';
import { ProviderRegistry } from '../server/providers/ProviderRegistry.js';
import { GoogleDriveProvider } from '../server/providers/GoogleDriveProvider.js';
import { SESSION_COOKIE_NAME } from '../server/api/middleware/auth.js';
import { ProviderType } from '../types/account.js';

function createMockHttp(options: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  body?: any;
}) {
  const req: any = new EventEmitter();
  req.method = options.method || 'GET';
  req.url = options.url;
  req.originalUrl = options.url;
  req.path = options.url.split('?')[0];
  req.headers = options.headers || {};
  req.cookies = options.cookies || {};
  if (req.headers.cookie) {
    const parts = req.headers.cookie.split(';');
    for (const part of parts) {
      const [key, val] = part.trim().split('=');
      if (key && val) {
        req.cookies[key] = decodeURIComponent(val);
      }
    }
  }
  const queryPart = options.url.split('?')[1];
  req.query = queryPart ? Object.fromEntries(new URLSearchParams(queryPart)) : {};
  req.body = options.body;

  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    headersSent: false,
    body: null as any,
    ended: false,
    writableEnded: false,
    setHeader(key: string, val: string) {
      this.headers[key.toLowerCase()] = val;
      return this;
    },
    getHeader(key: string) {
      return this.headers[key.toLowerCase()];
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.headersSent = true;
      this.setHeader('content-type', 'application/json; charset=utf-8');
      this.body = data;
      this.ended = true;
      this.writableEnded = true;
      req.emit('end');
      return this;
    },
    send(data: any) {
      this.headersSent = true;
      this.body = data;
      this.ended = true;
      this.writableEnded = true;
      req.emit('end');
      return this;
    },
    end(data?: any) {
      this.headersSent = true;
      if (data !== undefined) {
        this.body = data;
      }
      this.ended = true;
      this.writableEnded = true;
      req.emit('end');
      return this;
    },
  };

  return { req, res };
}

class ConfigurableMockDriveProvider extends GoogleDriveProvider {
  refreshHandler: () => Promise<{ accessToken: string; expiresInSeconds: number }> = async () => ({
    accessToken: 'mock_token',
    expiresInSeconds: 3600,
  });
  quotaHandler: () => Promise<any> = async () => ({
    totalBytes: 15 * 1024 * 1024 * 1024,
    usedBytes: 1024 * 1024,
    freeBytes: 14 * 1024 * 1024 * 1024,
    usagePercentage: 1,
  });
  listFilesHandler: (opts?: any) => Promise<any> = async () => ({
    files: [],
    paginationComplete: true,
  });
  getStartPageTokenHandler: () => Promise<string> = async () => 'mock_change_token_123';

  override async refreshAuthentication() {
    return this.refreshHandler();
  }
  override async getStorageQuota() {
    return this.quotaHandler();
  }
  override async listFiles(arg1?: any, arg2?: any) {
    const opts = typeof arg1 === 'string' ? arg2 : arg1;
    return this.listFilesHandler(opts);
  }
  override async getStartPageToken() {
    return this.getStartPageTokenHandler();
  }
}

describe('Asynchronous Sync Jobs & Serverless Non-Blocking Tests', () => {
  let testUser: any;
  let otherUser: any;
  let sessionToken: string;
  let otherSessionToken: string;
  let testAccount: any;
  const originalProvider = ProviderRegistry.get(ProviderType.GOOGLE_DRIVE);
  const mockProvider = new ConfigurableMockDriveProvider();

  before(async () => {
    await ensureSchema();
    await initializeServerlessInstance();

    ProviderRegistry.register(mockProvider);

    const email = `async_job_user_${Date.now()}@example.com`;
    const userSession = await UserService.createUser({
      email,
      password: 'Password123!',
      displayName: 'Async Test User',
    });
    testUser = userSession.user;
    sessionToken = userSession.sessionToken;

    const otherEmail = `async_job_other_${Date.now()}@example.com`;
    const otherSession = await UserService.createUser({
      email: otherEmail,
      password: 'Password123!',
      displayName: 'Other User',
    });
    otherUser = otherSession.user;
    otherSessionToken = otherSession.sessionToken;
  });

  beforeEach(async () => {
    mockProvider.refreshHandler = async () => ({
      accessToken: 'mock_token',
      expiresInSeconds: 3600,
    });
    mockProvider.quotaHandler = async () => ({
      totalBytes: 15 * 1024 * 1024 * 1024,
      usedBytes: 1024 * 1024,
      freeBytes: 14 * 1024 * 1024 * 1024,
      usagePercentage: 1,
    });
    mockProvider.listFilesHandler = async () => ({
      files: [],
      paginationComplete: true,
    });
    mockProvider.getStartPageTokenHandler = async () => 'mock_change_token_123';

    const connected = await accountService.connectOrUpdateAccount({
      userId: testUser.id,
      provider: ProviderType.GOOGLE_DRIVE,
      providerAccountId: `provider_async_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email: `account_async_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`,
      displayName: 'Async Test Drive',
      tokens: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
      quota: {
        totalBytes: 15 * 1024 * 1024 * 1024,
        usedBytes: 1024 * 1024,
        freeBytes: 15 * 1024 * 1024 * 1024 - 1024 * 1024,
        usagePercentage: 0.01,
      },
    });
    testAccount = connected.account;
  });

  after(async () => {
    if (originalProvider) {
      ProviderRegistry.register(originalProvider);
    }
  });

  test('1. POST /api/accounts/:id/sync returns HTTP 202 Accepted immediately with jobId', async () => {
    mockProvider.listFilesHandler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { files: [], paginationComplete: true };
    };

    const startTime = Date.now();
    const { req, res } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${testAccount.id}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        'x-unicloud-request-id': 'diag_async_req_1',
      },
      body: { mode: 'full' },
    });

    await new Promise<void>((resolve) => {
      const origJson = res.json.bind(res);
      res.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(req, res);
    });

    const duration = Date.now() - startTime;
    assert.equal(res.statusCode, 202);
    assert.ok(duration < 250, `POST returned in ${duration}ms (non-blocking)`);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.jobId);
    assert.ok(['queued', 'running'].includes(res.body.data.status));
    assert.equal(res.getHeader('x-unicloud-request-id'), 'diag_async_req_1');
    assert.ok(res.getHeader('content-type')?.includes('application/json'));

    // Settle the triggered background worker
    await syncJobService.triggerJob(res.body.data.jobId);
  });

  test('2. GET /api/sync/jobs/:jobId returns accurate status and prevents cross-tenant access', async () => {
    const { req: postReq, res: postRes } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${testAccount.id}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
    });

    await new Promise<void>((resolve) => {
      const origJson = postRes.json.bind(postRes);
      postRes.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(postReq, postRes);
    });

    assert.equal(postRes.statusCode, 202);
    const jobId = postRes.body.data.jobId;
    assert.ok(jobId);

    // Verify authorized user can get status
    const { req: getReq, res: getRes } = createMockHttp({
      method: 'GET',
      url: `/api/sync/jobs/${jobId}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
    });

    await new Promise<void>((resolve) => {
      const origJson = getRes.json.bind(getRes);
      getRes.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(getReq, getRes);
    });

    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.success, true);
    assert.equal(getRes.body.data.jobId, jobId);
    assert.ok(getRes.body.data.progress);

    // Verify cross-tenant isolation: other user cannot view this job
    const { req: otherReq, res: otherRes } = createMockHttp({
      method: 'GET',
      url: `/api/sync/jobs/${jobId}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${otherSessionToken}`,
      },
    });

    await new Promise<void>((resolve) => {
      const origJson = otherRes.json.bind(otherRes);
      otherRes.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(otherReq, otherRes);
    });

    assert.equal(otherRes.statusCode, 404);
    assert.equal(otherRes.body.success, false);

    // Settle job
    await syncJobService.triggerJob(jobId);
  });

  test('3. Background job completes successfully and records progress and result', async () => {
    mockProvider.listFilesHandler = async () => ({
      files: [
        {
          id: 'file_async_1',
          name: 'Report.pdf',
          mimeType: 'application/pdf',
          size: 10240,
          createdTime: new Date().toISOString(),
          modifiedTime: new Date().toISOString(),
          owners: [{ emailAddress: testAccount.email }],
          trashed: false,
        },
      ],
      paginationComplete: true,
    });

    const { req: postReq, res: postRes } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${testAccount.id}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
      body: { mode: 'full' },
    });

    await new Promise<void>((resolve) => {
      const origJson = postRes.json.bind(postRes);
      postRes.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(postReq, postRes);
    });

    const jobId = postRes.body.data.jobId;

    // Await background execution
    await syncJobService.triggerJob(jobId);

    // Check status
    const { req: getReq, res: getRes } = createMockHttp({
      method: 'GET',
      url: `/api/sync/jobs/${jobId}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
    });

    await new Promise<void>((resolve) => {
      const origJson = getRes.json.bind(getRes);
      getRes.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(getReq, getRes);
    });

    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.data.status, 'completed');
    assert.equal(getRes.body.data.progress.filesDiscovered, 1);
    assert.ok(getRes.body.data.completedAt);
    assert.ok(getRes.body.data.result);
  });

  test('4. Background job failure records error safely', async () => {
    mockProvider.listFilesHandler = async () => {
      throw new Error('Google Drive files API network timeout');
    };

    const { req: postReq, res: postRes } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${testAccount.id}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
      body: { mode: 'full' },
    });

    await new Promise<void>((resolve) => {
      const origJson = postRes.json.bind(postRes);
      postRes.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(postReq, postRes);
    });

    const jobId = postRes.body.data.jobId;
    await syncJobService.triggerJob(jobId);

    const { req: getReq, res: getRes } = createMockHttp({
      method: 'GET',
      url: `/api/sync/jobs/${jobId}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
    });

    await new Promise<void>((resolve) => {
      const origJson = getRes.json.bind(getRes);
      getRes.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(getReq, getRes);
    });

    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.data.status, 'failed');
    assert.ok(getRes.body.data.error.includes('files API network timeout'));
  });

  test('5. Duplicate concurrent sync prevention returns existing active job', async () => {
    // First request
    const { req: req1, res: res1 } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${testAccount.id}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
      body: { mode: 'full' },
    });

    await new Promise<void>((resolve) => {
      const origJson = res1.json.bind(res1);
      res1.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(req1, res1);
    });

    const firstJobId = res1.body.data.jobId;

    // Second concurrent request for same account
    const { req: req2, res: res2 } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${testAccount.id}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
      body: { mode: 'full' },
    });

    await new Promise<void>((resolve) => {
      const origJson = res2.json.bind(res2);
      res2.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(req2, res2);
    });

    const secondJobId = res2.body.data.jobId;

    assert.equal(firstJobId, secondJobId, 'Second concurrent request should reuse existing job');
    assert.equal(res2.body.data.isNew, false);

    // Settle job
    await syncJobService.triggerJob(firstJobId);
  });

  test('6. Stale running jobs from terminated instances are recovered and fail cleanly', async () => {
    // Settle any active jobs
    await query(`DELETE FROM sync_jobs WHERE storage_account_id = $1`, [testAccount.id]);

    // Insert a simulated stale running job (15 minutes old)
    const staleJobId = 'stale_job_test_' + Date.now();
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    await query(
      `INSERT INTO sync_jobs (
        id, user_id, storage_account_id, mode, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [staleJobId, testUser.id, testAccount.id, 'full', 'running', fifteenMinutesAgo, fifteenMinutesAgo]
    );

    // Creating a new job for this account should detect the stale job, mark it failed, and allow a new job
    const outcome = await syncJobService.createOrGetActiveJob(testUser.id, testAccount.id, 'full');
    assert.notEqual(outcome.jobId, staleJobId);
    assert.equal(outcome.isNew, true);

    // Verify stale job was marked failed
    const staleJob = await syncJobService.getJobById(testUser.id, staleJobId);
    assert.equal(staleJob?.status, 'failed');
    assert.ok(staleJob?.errorMessage?.includes('timed out'));

    await syncJobService.triggerJob(outcome.jobId);
  });

  test('7. Truncated/incomplete sync does NOT perform stale reconciliation and records failure', async () => {
    // 1. Seed an existing active file in the database
    const existingFileId = 'existing_safe_file_' + Date.now();
    await query(
      `INSERT INTO virtual_files (
        id, user_id, storage_account_id, provider, provider_file_id, name, mime_type, size_bytes,
        synced_at, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), false, NOW(), NOW())`,
      [
        existingFileId,
        testUser.id,
        testAccount.id,
        ProviderType.GOOGLE_DRIVE,
        'drive_item_safe_1',
        'PreExisting.txt',
        'text/plain',
        500,
      ]
    );

    // 2. Mock provider returns 0 items but simulates truncation (pagination incomplete)
    const origSyncAccount = syncService.syncAccount.bind(syncService);
    syncService.syncAccount = async () => {
      return {
        accountId: testAccount.id,
        filesDiscovered: 0,
        filesAddedOrUpdated: 0,
        filesRemoved: 0,
        foldersProcessed: 0,
        quotaUpdated: true,
        paginationComplete: false, // Incomplete!
        timestamp: new Date().toISOString(),
        syncType: 'full',
      } as any;
    };

    try {
      const outcome = await syncJobService.createOrGetActiveJob(testUser.id, testAccount.id, 'full');
      await syncJobService.triggerJob(outcome.jobId);

      const jobRecord = await syncJobService.getJobById(testUser.id, outcome.jobId);
      assert.equal(jobRecord?.status, 'failed');
      assert.ok(jobRecord?.errorMessage?.includes('truncated'));

      // Check that existing file was NOT trashed (stale reconciliation skipped)
      const fileRes = await query(`SELECT is_trashed FROM virtual_files WHERE id = $1`, [existingFileId]);
      assert.equal(fileRes.rows[0]?.is_trashed, false, 'Pre-existing file must NOT be trashed on incomplete sync');
    } finally {
      delete (syncService as any).syncAccount;
    }
  });

  test('8. Complete full sync properly performs root-safe stale reconciliation', async () => {
    // Seed an existing active file (synced 1 hour ago)
    const fileToTrashId = 'file_to_trash_' + Date.now();
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    await query(
      `INSERT INTO virtual_files (
        id, user_id, storage_account_id, provider, provider_file_id, name, mime_type, size_bytes,
        synced_at, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, NOW(), NOW())`,
      [
        fileToTrashId,
        testUser.id,
        testAccount.id,
        ProviderType.GOOGLE_DRIVE,
        'upstream_deleted_item_99',
        'OldFile.txt',
        'text/plain',
        500,
        oneHourAgo,
      ]
    );

    // Mock provider returns empty files and paginationComplete = true
    mockProvider.listFilesHandler = async () => ({
      files: [],
      paginationComplete: true,
    });

    const outcome = await syncJobService.createOrGetActiveJob(testUser.id, testAccount.id, 'full');
    await syncJobService.triggerJob(outcome.jobId);

    const jobRecord = await syncJobService.getJobById(testUser.id, outcome.jobId);
    assert.equal(jobRecord?.status, 'completed');

    // On complete full sync with 0 upstream items, the absent item is reconciled as trashed
    const fileRes = await query(`SELECT is_trashed FROM virtual_files WHERE id = $1`, [fileToTrashId]);
    assert.equal(fileRes.rows[0]?.is_trashed, true, 'Unreferenced file correctly reconciled as trashed');
  });

  test('9. Resumable sync worker: one invocation processes exactly one step', async () => {
    const connected = await accountService.connectOrUpdateAccount({
      userId: testUser.id,
      provider: ProviderType.GOOGLE_DRIVE,
      providerAccountId: `provider_step9_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email: `account_step9_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`,
      displayName: 'Step 9 Test Drive',
      tokens: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
      quota: {
        totalBytes: 15 * 1024 * 1024 * 1024,
        usedBytes: 1024 * 1024,
        freeBytes: 14 * 1024 * 1024 * 1024,
        usagePercentage: 0.01,
      },
    });
    const stepAccount = connected.account;

    let listFilesCalls = 0;
    mockProvider.listFilesHandler = async (opts?: any) => {
      listFilesCalls++;
      if (!opts?.pageToken) {
        return {
          files: [
            {
              id: 'file_page1_1',
              name: 'File1.txt',
              mimeType: 'text/plain',
              sizeBytes: 100,
              modifiedTime: new Date().toISOString(),
              trashed: false,
            },
          ],
          nextPageToken: 'token_page_2',
          paginationComplete: false,
        };
      } else {
        return {
          files: [
            {
              id: 'file_page2_1',
              name: 'File2.txt',
              mimeType: 'text/plain',
              sizeBytes: 200,
              modifiedTime: new Date().toISOString(),
              trashed: false,
            },
          ],
          paginationComplete: true,
        };
      }
    };

    // Prevent arrangeNextInvocation from immediately executing the second step in background
    const origArrange = syncJobService.arrangeNextInvocation.bind(syncJobService);
    let arrangeInvocationCalled = false;
    (syncJobService as any).arrangeNextInvocation = async () => {
      arrangeInvocationCalled = true;
      return true;
    };

    try {
      const outcome = await syncJobService.createOrGetActiveJob(testUser.id, stepAccount.id, 'full');
      const stepResult = await syncJobService.runJob(outcome.jobId);

      // Verify that one worker invocation executed exactly ONE processSyncJobStep
      assert.ok(stepResult, 'runJob should return a stepResult');
      assert.equal((stepResult as any)?.hasMore, true, 'step 1 should have hasMore=true');
      assert.equal(listFilesCalls, 1, 'Provider listFiles must be invoked exactly once in one worker invocation');
      assert.equal(arrangeInvocationCalled, true, 'arrangeNextInvocation must be called when hasMore=true');
    } finally {
      syncJobService.arrangeNextInvocation = origArrange;
    }
  });

  test('10. Resumable sync worker: hasMore=true does NOT cause another step in the same invocation', async () => {
    const connected = await accountService.connectOrUpdateAccount({
      userId: testUser.id,
      provider: ProviderType.GOOGLE_DRIVE,
      providerAccountId: `provider_step10_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email: `account_step10_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`,
      displayName: 'Step 10 Test Drive',
      tokens: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
      quota: {
        totalBytes: 15 * 1024 * 1024 * 1024,
        usedBytes: 1024 * 1024,
        freeBytes: 14 * 1024 * 1024 * 1024,
        usagePercentage: 0.01,
      },
    });
    const stepAccount = connected.account;

    let stepExecutionsInCurrentInvocation = 0;
    mockProvider.listFilesHandler = async (opts?: any) => {
      stepExecutionsInCurrentInvocation++;
      return {
        files: [
          {
            id: `file_${Date.now()}`,
            name: 'PagingFile.txt',
            mimeType: 'text/plain',
            sizeBytes: 100,
            modifiedTime: new Date().toISOString(),
            trashed: false,
          },
        ],
        nextPageToken: 'token_page_next',
        paginationComplete: false,
      };
    };

    // Spy on arrangeNextInvocation: captures scheduled jobId without executing immediately
    const origArrange = syncJobService.arrangeNextInvocation.bind(syncJobService);
    let scheduledJobId: string | null = null;
    (syncJobService as any).arrangeNextInvocation = async (jobId: string) => {
      scheduledJobId = jobId;
      return true;
    };

    try {
      const outcome = await syncJobService.createOrGetActiveJob(testUser.id, stepAccount.id, 'full');

      // Execute the single invocation
      const stepResult = await syncJobService.runJob(outcome.jobId);

      // Assert that hasMore is true
      assert.equal((stepResult as any)?.hasMore, true);
      // Assert that despite hasMore being true, no second step occurred inside this invocation
      assert.equal(stepExecutionsInCurrentInvocation, 1, 'Must NOT loop or execute second step in same invocation');
      // Assert that next invocation was arranged
      assert.equal(scheduledJobId, outcome.jobId, 'Must arrange for a NEW worker invocation to continue');
    } finally {
      syncJobService.arrangeNextInvocation = origArrange;
    }
  });

  test('11. Resumable sync worker: job state is persisted for continuation and resumes next invocation', async () => {
    const connected = await accountService.connectOrUpdateAccount({
      userId: testUser.id,
      provider: ProviderType.GOOGLE_DRIVE,
      providerAccountId: `provider_step11_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email: `account_step11_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`,
      displayName: 'Step 11 Test Drive',
      tokens: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
      quota: {
        totalBytes: 15 * 1024 * 1024 * 1024,
        usedBytes: 1024 * 1024,
        freeBytes: 14 * 1024 * 1024 * 1024,
        usagePercentage: 0.01,
      },
    });
    const stepAccount = connected.account;

    mockProvider.listFilesHandler = async (opts?: any) => {
      if (!opts?.pageToken) {
        return {
          files: [
            {
              id: 'persisted_step_file_1',
              name: 'File1.txt',
              mimeType: 'text/plain',
              sizeBytes: 100,
              modifiedTime: new Date().toISOString(),
              trashed: false,
            },
          ],
          nextPageToken: 'cursor_token_step_2',
          paginationComplete: false,
        };
      } else {
        assert.equal(opts.pageToken, 'cursor_token_step_2', 'Continuation token must match persisted state');
        return {
          files: [
            {
              id: 'persisted_step_file_2',
              name: 'File2.txt',
              mimeType: 'text/plain',
              sizeBytes: 200,
              modifiedTime: new Date().toISOString(),
              trashed: false,
            },
          ],
          paginationComplete: true,
        };
      }
    };

    // Block automatic chaining to inspect persisted intermediate DB state
    const origArrange = syncJobService.arrangeNextInvocation.bind(syncJobService);
    (syncJobService as any).arrangeNextInvocation = async () => true;

    try {
      const outcome = await syncJobService.createOrGetActiveJob(testUser.id, stepAccount.id, 'full');

      // INVOCATION 1: Executes step 1
      const step1Result = await syncJobService.runJob(outcome.jobId);
      assert.equal((step1Result as any)?.hasMore, true);

      // Verify persistence of job state in PostgreSQL directly
      const dbRow = await query(`SELECT * FROM sync_jobs WHERE id = $1`, [outcome.jobId]);
      assert.equal(dbRow.rows.length, 1);
      assert.equal(dbRow.rows[0].status, 'running');
      assert.ok(dbRow.rows[0].continuation_state, 'continuation_state must be persisted in database');

      const persistedState =
        typeof dbRow.rows[0].continuation_state === 'string'
          ? JSON.parse(dbRow.rows[0].continuation_state)
          : dbRow.rows[0].continuation_state;
      assert.ok(persistedState.stepCount >= 1, 'Persisted step count should be recorded');
      assert.equal(persistedState.globalPageToken, 'cursor_token_step_2');
      assert.equal(persistedState.phase, 'DISCOVER_GLOBAL');

      // INVOCATION 2: NEW worker invocation using persisted continuation state
      const step2Result = await syncJobService.runJob(outcome.jobId);
      assert.ok(step2Result, 'Invocation 2 must process next step');

      // Verify intermediate persisted state after second invocation
      const dbRow2 = await query(`SELECT * FROM sync_jobs WHERE id = $1`, [outcome.jobId]);
      assert.equal(dbRow2.rows.length, 1);
      const persistedState2 =
        typeof dbRow2.rows[0].continuation_state === 'string'
          ? JSON.parse(dbRow2.rows[0].continuation_state)
          : dbRow2.rows[0].continuation_state;
      assert.ok(persistedState2.stepCount > persistedState.stepCount, 'Step count advances on subsequent invocation');
    } finally {
      syncJobService.arrangeNextInvocation = origArrange;
    }
  });

  test('12. Resumable sync worker: step 1 schedules step 2, step 2 resumes from persisted state, and final completion occurs only on completion of last step', async () => {
    const connected = await accountService.connectOrUpdateAccount({
      userId: testUser.id,
      provider: ProviderType.GOOGLE_DRIVE,
      providerAccountId: `provider_step12_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email: `account_step12_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`,
      displayName: 'Step 12 Test Drive',
      tokens: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
      quota: {
        totalBytes: 15 * 1024 * 1024 * 1024,
        usedBytes: 1024 * 1024,
        freeBytes: 14 * 1024 * 1024 * 1024,
        usagePercentage: 0.01,
      },
    });
    const stepAccount = connected.account;

    const receivedTokens: (string | undefined)[] = [];
    mockProvider.listFilesHandler = async (opts?: any) => {
      const pageToken = opts?.pageToken;
      receivedTokens.push(pageToken);

      if (!pageToken) {
        return {
          files: [
            {
              id: 'file_step12_page1',
              name: 'Page1File.txt',
              mimeType: 'text/plain',
              sizeBytes: 1024,
              modifiedTime: new Date().toISOString(),
              trashed: false,
            },
          ],
          nextPageToken: 'cursor_step12_page2',
          paginationComplete: false,
        };
      } else {
        return {
          files: [
            {
              id: 'file_step12_page2',
              name: 'Page2File.txt',
              mimeType: 'text/plain',
              sizeBytes: 2048,
              modifiedTime: new Date().toISOString(),
              trashed: false,
            },
          ],
          paginationComplete: true,
        };
      }
    };

    const arrangedJobIds: string[] = [];
    const origArrange = syncJobService.arrangeNextInvocation.bind(syncJobService);
    (syncJobService as any).arrangeNextInvocation = async (jobId: string) => {
      arrangedJobIds.push(jobId);
      return true;
    };

    try {
      const outcome = await syncJobService.createOrGetActiveJob(testUser.id, stepAccount.id, 'full');

      // INVOCATION 1
      const step1Result = await syncJobService.runJob(outcome.jobId);
      assert.equal((step1Result as any)?.hasMore, true, 'Step 1 must have more pages');
      assert.equal(arrangedJobIds.length, 1, 'Step 1 must schedule step 2 via arrangeNextInvocation');
      assert.equal(arrangedJobIds[0], outcome.jobId);

      // Verify job is NOT marked completed prematurely
      const midJobRecord = await syncJobService.getJobById(testUser.id, outcome.jobId);
      assert.equal(midJobRecord?.status, 'running', 'Job must remain running before last step completes');
      assert.ok(midJobRecord?.continuationState, 'Continuation state must be saved');
      assert.equal(midJobRecord?.continuationState?.globalPageToken, 'cursor_step12_page2');

      // INVOCATION 2 (Continuation invocation)
      arrangedJobIds.length = 0; // reset
      const step2Result = await syncJobService.runJob(outcome.jobId);
      assert.ok(step2Result, 'Step 2 must return a step result');
      assert.equal(arrangedJobIds.length, 1, 'Step 2 schedules next step');

      // Continue running bounded invocations one-by-one until final completion
      let currentResult: any = step2Result;
      let invocationCount = 2;
      while (currentResult?.hasMore) {
        currentResult = await syncJobService.runJob(outcome.jobId);
        invocationCount++;
        assert.ok(invocationCount <= 10, 'Job must terminate in a bounded number of steps');
      }

      assert.equal(currentResult?.status, 'completed', 'Final step marks job as completed');

      // Verify final completion occurs only on completion of last step
      const finalJobRecord = await syncJobService.getJobById(testUser.id, outcome.jobId);
      assert.equal(finalJobRecord?.status, 'completed', 'Job marked completed only upon final step');
      assert.ok(finalJobRecord?.completedAt, 'completedAt timestamp is set');
      assert.deepEqual(
        receivedTokens.slice(0, 2),
        [undefined, 'cursor_step12_page2'],
        'Step 2 correctly resumed using persisted cursor'
      );
    } finally {
      syncJobService.arrangeNextInvocation = origArrange;
    }
  });

  test('13. Resumable sync worker: interrupted jobs can resume cleanly from persisted state', async () => {
    const connected = await accountService.connectOrUpdateAccount({
      userId: testUser.id,
      provider: ProviderType.GOOGLE_DRIVE,
      providerAccountId: `provider_step13_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email: `account_step13_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`,
      displayName: 'Step 13 Test Drive',
      tokens: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
      quota: {
        totalBytes: 15 * 1024 * 1024 * 1024,
        usedBytes: 1024 * 1024,
        freeBytes: 14 * 1024 * 1024 * 1024,
        usagePercentage: 0.01,
      },
    });
    const stepAccount = connected.account;

    mockProvider.listFilesHandler = async (opts?: any) => {
      if (!opts?.pageToken) {
        return {
          files: [
            {
              id: 'file_step13_p1',
              name: 'Part1.txt',
              mimeType: 'text/plain',
              sizeBytes: 100,
              modifiedTime: new Date().toISOString(),
              trashed: false,
            },
          ],
          nextPageToken: 'cursor_step13_interrupted',
          paginationComplete: false,
        };
      } else {
        return {
          files: [
            {
              id: 'file_step13_p2',
              name: 'Part2.txt',
              mimeType: 'text/plain',
              sizeBytes: 200,
              modifiedTime: new Date().toISOString(),
              trashed: false,
            },
          ],
          paginationComplete: true,
        };
      }
    };

    // Prevent automatic continuation so we can simulate an interrupted invocation / process crash
    const origArrange = syncJobService.arrangeNextInvocation.bind(syncJobService);
    (syncJobService as any).arrangeNextInvocation = async () => true;

    try {
      const outcome = await syncJobService.createOrGetActiveJob(testUser.id, stepAccount.id, 'full');

      // Worker 1 runs Step 1 then worker terminates unexpectedly
      const step1Result = await syncJobService.runJob(outcome.jobId);
      assert.equal((step1Result as any)?.hasMore, true);

      // Verify DB left in recoverable state
      const dbRow = await query(`SELECT status, continuation_state FROM sync_jobs WHERE id = $1`, [outcome.jobId]);
      assert.equal(dbRow.rows[0]?.status, 'running');
      assert.ok(dbRow.rows[0]?.continuation_state);

      // Simulate container reboot / clear in-memory execution trackers
      (syncJobService as any).activeInvocations.clear();
      (syncJobService as any).activeJobTrackers.clear();

      // Fresh worker invocation picks up the interrupted job from PostgreSQL and advances to completion
      let currentResult: any = await syncJobService.runJob(outcome.jobId);
      let attempts = 0;
      while (currentResult?.hasMore && attempts < 10) {
        currentResult = await syncJobService.runJob(outcome.jobId);
        attempts++;
      }
      assert.equal(currentResult?.status, 'completed');
      assert.equal(currentResult?.hasMore, false);

      const finalJob = await syncJobService.getJobById(testUser.id, outcome.jobId);
      assert.equal(finalJob?.status, 'completed');
    } finally {
      syncJobService.arrangeNextInvocation = origArrange;
    }
  });

  test('14. Concurrency Protection: Two workers attempting the same job simultaneously -> only one processes', async () => {
    const connected = await accountService.connectOrUpdateAccount({
      userId: testUser.id,
      provider: ProviderType.GOOGLE_DRIVE,
      providerAccountId: `provider_step14_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email: `account_step14_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`,
      displayName: 'Step 14 Concurrency Test Drive',
      tokens: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
      quota: {
        totalBytes: 15 * 1024 * 1024 * 1024,
        usedBytes: 1024 * 1024,
        freeBytes: 14 * 1024 * 1024 * 1024,
        usagePercentage: 0.01,
      },
    });
    const stepAccount = connected.account;

    let stepExecutionCount = 0;
    let slowStepStarted = false;
    let resolveSlowStep!: () => void;
    const slowStepPromise = new Promise<void>((resolve) => {
      resolveSlowStep = resolve;
    });

    mockProvider.listFilesHandler = async () => {
      stepExecutionCount++;
      slowStepStarted = true;
      // Hold worker 1 in-flight until worker 2 attempts to claim
      await slowStepPromise;
      return {
        files: [
          {
            id: 'file_concurrent_1',
            name: 'ConcurrentFile.txt',
            mimeType: 'text/plain',
            sizeBytes: 120,
            modifiedTime: new Date().toISOString(),
            trashed: false,
          },
        ],
        paginationComplete: true,
      };
    };

    const origArrange = syncJobService.arrangeNextInvocation.bind(syncJobService);
    (syncJobService as any).arrangeNextInvocation = async () => true;

    try {
      const outcome = await syncJobService.createOrGetActiveJob(testUser.id, stepAccount.id, 'full');

      // Worker 1 starts processing in the background and claims the database lease
      const worker1Promise = syncJobService.runJob(outcome.jobId, undefined, 'worker_instance_1');

      // Wait until Worker 1 has claimed lease and started execution
      while (!slowStepStarted) {
        await new Promise((r) => setTimeout(r, 5));
      }

      // Verify the persistent lease is currently owned by worker 1 in PostgreSQL
      const leasedRow = await query(`SELECT lease_owner, lease_expires_at, status FROM sync_jobs WHERE id = $1`, [
        outcome.jobId,
      ]);
      assert.equal(leasedRow.rows[0]?.lease_owner, 'worker_instance_1');
      assert.ok(leasedRow.rows[0]?.lease_expires_at);

      // Worker 2 (separate Vercel instance) attempts to process the same job while Worker 1 is still running
      const worker2Result = await syncJobService.runJob(outcome.jobId, undefined, 'worker_instance_2');

      // Worker 2 MUST exit without processing because Worker 1 owns the lease
      assert.strictEqual(
        worker2Result,
        undefined,
        'Worker 2 must exit without processing when job is leased by another worker'
      );

      // Now allow Worker 1 to complete its step
      resolveSlowStep();
      const worker1Result = await worker1Promise;

      assert.ok(worker1Result, 'Worker 1 should complete successfully');
      assert.equal(stepExecutionCount, 1, 'Provider listFiles should have been called exactly once');

      // Verify lease is safely cleared after completion
      const completedRow = await query(`SELECT lease_owner, lease_expires_at, status FROM sync_jobs WHERE id = $1`, [
        outcome.jobId,
      ]);
      assert.strictEqual(completedRow.rows[0]?.lease_owner, null, 'Lease owner should be cleared after step');
      assert.strictEqual(completedRow.rows[0]?.lease_expires_at, null, 'Lease expiration should be cleared after step');
    } finally {
      resolveSlowStep();
      syncJobService.arrangeNextInvocation = origArrange;
    }
  });

  test('15. Expired lease recovery: Worker recovers and takes over job whose lease expired', async () => {
    const connected = await accountService.connectOrUpdateAccount({
      userId: testUser.id,
      provider: ProviderType.GOOGLE_DRIVE,
      providerAccountId: `provider_step15_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email: `account_step15_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`,
      displayName: 'Step 15 Expired Lease Drive',
      tokens: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
      quota: {
        totalBytes: 15 * 1024 * 1024 * 1024,
        usedBytes: 1024 * 1024,
        freeBytes: 14 * 1024 * 1024 * 1024,
        usagePercentage: 0.01,
      },
    });
    const stepAccount = connected.account;

    let listFilesInvoked = 0;
    mockProvider.listFilesHandler = async () => {
      listFilesInvoked++;
      return {
        files: [
          {
            id: 'file_step15',
            name: 'RecoveredFile.txt',
            mimeType: 'text/plain',
            sizeBytes: 300,
            modifiedTime: new Date().toISOString(),
            trashed: false,
          },
        ],
        paginationComplete: true,
      };
    };

    const origArrange = syncJobService.arrangeNextInvocation.bind(syncJobService);
    (syncJobService as any).arrangeNextInvocation = async () => true;

    try {
      const outcome = await syncJobService.createOrGetActiveJob(testUser.id, stepAccount.id, 'full');

      // Simulate a dead worker holding an expired lease (e.g. serverless instance crashed 30 seconds ago)
      const expiredTime = new Date(Date.now() - 30 * 1000).toISOString();
      await query(
        `UPDATE sync_jobs
         SET status = 'running', lease_owner = $1, lease_expires_at = $2, updated_at = NOW()
         WHERE id = $3`,
        ['worker_crashed_instance', expiredTime, outcome.jobId]
      );

      // Verify the job initially has the expired lease
      const preCheck = await query(`SELECT lease_owner, lease_expires_at FROM sync_jobs WHERE id = $1`, [outcome.jobId]);
      assert.equal(preCheck.rows[0]?.lease_owner, 'worker_crashed_instance');

      // Test explicit recovery of expired leases
      const recoveredCount = await syncJobService.recoverExpiredLeases(outcome.jobId);
      assert.equal(recoveredCount, 1, 'Should recover exactly 1 expired lease');

      // Verify lease was reset to NULL
      const postRecovery = await query(`SELECT lease_owner, lease_expires_at FROM sync_jobs WHERE id = $1`, [
        outcome.jobId,
      ]);
      assert.strictEqual(postRecovery.rows[0]?.lease_owner, null);
      assert.strictEqual(postRecovery.rows[0]?.lease_expires_at, null);

      // New worker should now successfully claim and process the job
      const newWorkerResult = await syncJobService.runJob(outcome.jobId, undefined, 'worker_fresh_instance');
      assert.ok(newWorkerResult, 'Fresh worker should successfully run the job');
      assert.equal(listFilesInvoked, 1, 'File listing should succeed after lease recovery');
    } finally {
      syncJobService.arrangeNextInvocation = origArrange;
    }
  });

  test('16. Successful continuation after recovery: Multi-step job continues seamlessly from persisted state', async () => {
    const connected = await accountService.connectOrUpdateAccount({
      userId: testUser.id,
      provider: ProviderType.GOOGLE_DRIVE,
      providerAccountId: `provider_step16_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email: `account_step16_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`,
      displayName: 'Step 16 Continuation Drive',
      tokens: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
      quota: {
        totalBytes: 15 * 1024 * 1024 * 1024,
        usedBytes: 1024 * 1024,
        freeBytes: 14 * 1024 * 1024 * 1024,
        usagePercentage: 0.01,
      },
    });
    const stepAccount = connected.account;

    let pageRequested = 0;
    mockProvider.listFilesHandler = async (opts?: any) => {
      pageRequested++;
      if (!opts?.pageToken) {
        return {
          files: [
            {
              id: 'file_step16_p1',
              name: 'Page1File.txt',
              mimeType: 'text/plain',
              sizeBytes: 150,
              modifiedTime: new Date().toISOString(),
              trashed: false,
            },
          ],
          nextPageToken: 'token_step16_page2',
          paginationComplete: false,
        };
      } else {
        return {
          files: [
            {
              id: 'file_step16_p2',
              name: 'Page2File.txt',
              mimeType: 'text/plain',
              sizeBytes: 250,
              modifiedTime: new Date().toISOString(),
              trashed: false,
            },
          ],
          paginationComplete: true,
        };
      }
    };

    const origArrange = syncJobService.arrangeNextInvocation.bind(syncJobService);
    (syncJobService as any).arrangeNextInvocation = async () => true;

    try {
      const outcome = await syncJobService.createOrGetActiveJob(testUser.id, stepAccount.id, 'full');

      // Worker 1 runs Step 1
      const step1Result = await syncJobService.runJob(outcome.jobId, undefined, 'worker_step1');
      assert.ok(step1Result, 'Step 1 should produce a result');
      assert.equal((step1Result as any)?.hasMore, true, 'Step 1 should indicate more work remaining');
      assert.equal(pageRequested, 1, 'First page requested');

      // Simulate Worker 1 crashed while holding a lease on Step 2
      const expiredTime = new Date(Date.now() - 60 * 1000).toISOString();
      await query(
        `UPDATE sync_jobs
         SET lease_owner = 'worker_dead_step2', lease_expires_at = $1
         WHERE id = $2`,
        [expiredTime, outcome.jobId]
      );

      // Verify lease is expired
      const expiredCheck = await query(`SELECT lease_owner, lease_expires_at FROM sync_jobs WHERE id = $1`, [outcome.jobId]);
      assert.equal(expiredCheck.rows[0]?.lease_owner, 'worker_dead_step2');

      // Worker 2 takes over: atomic claim should automatically take over the expired lease
      const step2Result = await syncJobService.runJob(outcome.jobId, undefined, 'worker_step2_takeover');
      assert.ok(step2Result, 'Step 2 should run successfully after taking over expired lease');
      assert.equal(pageRequested, 2, 'Second page requested by Worker 2');

      // Advance to completion if any final step remains
      let finalResult: any = step2Result;
      let guard = 0;
      while (finalResult && (finalResult as any).hasMore && guard < 5) {
        finalResult = await syncJobService.runJob(outcome.jobId, undefined, 'worker_step2_takeover');
        guard++;
      }

      assert.equal((finalResult as any)?.status, 'completed');
      assert.equal((finalResult as any)?.hasMore, false);

      const completedJob = await syncJobService.getJobById(testUser.id, outcome.jobId);
      assert.equal(completedJob?.status, 'completed');
      assert.strictEqual(completedJob?.leaseOwner, null);
      assert.strictEqual(completedJob?.leaseExpiresAt, null);
    } finally {
      syncJobService.arrangeNextInvocation = origArrange;
    }
  });
});

