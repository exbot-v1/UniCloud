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
  override async listFiles(opts?: any) {
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
      syncService.syncAccount = origSyncAccount;
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
});
