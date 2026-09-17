/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Sync API Error Handling & JSON Delivery Regression Test Suite
 * 
 * Verifies:
 * 1. POST /api/accounts/:id/sync always returns valid JSON with ApiResponse format on success.
 * 2. POST /api/accounts/:id/sync always returns valid JSON with ApiResponse format on error (never plain-text).
 * 3. Actual HTTP status codes are preserved (404 for not found, 400 for disabled, 401 for expired token, 502 for provider error, 500 for unexpected).
 * 4. Content-Type is always application/json; charset=utf-8.
 * 5. Vercel serverless entrypoint handler (api/index.ts) properly awaits completion and delivers valid JSON.
 * 6. Frontend parseApiResponse handles both JSON and non-JSON (HTML/plain-text) responses gracefully without throwing SyntaxError.
 */

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import handler, { app, initializeServerlessInstance } from '../../api/index.js';
import { ensureSchema, query } from '../db/client.js';
import { UserService } from '../server/services/UserService.js';
import { accountService } from '../server/services/AccountService.js';
import { syncService } from '../server/services/SyncService.js';
import { ProviderRegistry } from '../server/providers/ProviderRegistry.js';
import { GoogleDriveProvider } from '../server/providers/GoogleDriveProvider.js';
import { SESSION_COOKIE_NAME } from '../server/api/middleware/auth.js';
import { AppError, formatErrorResponse, extractStatusCode } from '../server/utils/errors.js';
import { ErrorCode, ApiResponse } from '../types/api.js';
import { ProviderType, AccountStatus } from '../types/account.js';
import { parseApiResponse } from '../lib/api.js';

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

describe('Sync API Error Handling & JSON Delivery', () => {
  let testUser: any;
  let sessionToken: string;
  let testAccount: any;
  const originalProvider = ProviderRegistry.get(ProviderType.GOOGLE_DRIVE);

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
    listFilesHandler: () => Promise<any> = async () => ({
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
    override async listFiles() {
      return this.listFilesHandler();
    }
    override async getStartPageToken() {
      return this.getStartPageTokenHandler();
    }
  }

  const mockProvider = new ConfigurableMockDriveProvider();

  before(async () => {
    await ensureSchema();
    await initializeServerlessInstance();

    ProviderRegistry.register(mockProvider);

    const result = await UserService.createUser({
      email: `sync_json_test_${Date.now()}@example.com`,
      password: 'ValidPassword123!',
      displayName: 'Sync JSON Test User',
    });
    testUser = result.user;
    sessionToken = result.sessionToken;
  });

  after(async () => {
    if (originalProvider) {
      ProviderRegistry.register(originalProvider);
    }
    if (testUser?.id) {
      await query(`DELETE FROM users WHERE id = $1`, [testUser.id]);
    }
  });

  beforeEach(async () => {
    // Reset mock handlers to success defaults
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

    // Connect a clean test storage account
    const connected = await accountService.connectOrUpdateAccount({
      userId: testUser.id,
      provider: ProviderType.GOOGLE_DRIVE,
      providerAccountId: `provider_sync_${Date.now()}`,
      email: `account_sync_${Date.now()}@example.com`,
      displayName: 'Sync JSON Storage',
      tokens: {
        accessToken: 'valid_mock_access_token',
        refreshToken: 'valid_mock_refresh_token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
      quota: {
        totalBytes: 15 * 1024 * 1024 * 1024,
        usedBytes: 1024 * 1024,
        freeBytes: 15 * 1024 * 1024 * 1024 - 1024 * 1024,
        usagePercentage: 1,
      },
    });
    testAccount = connected.account;

    // Ensure account is enabled for each test
    await query(`UPDATE storage_accounts SET is_enabled = true WHERE id = $1`, [testAccount.id]);

    // Await background sync if running
    const activeSync = syncService.getActiveSync(testUser.id, testAccount.id);
    if (activeSync) {
      try {
        await activeSync;
      } catch {
        // ignore
      }
    }
  });

  test('1. Successful sync returns valid JSON with ApiResponse envelope', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${testAccount.id}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
    });

    await new Promise<void>((resolve) => {
      const origJson = res.json.bind(res);
      res.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.getHeader('content-type')?.includes('application/json'));
    assert.equal(typeof res.body, 'object');
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.syncResult);
    assert.ok(res.body.meta?.timestamp);
  });

  test('2. Sync non-existent account returns HTTP 404 with valid JSON', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    const { req, res } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${nonExistentId}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
    });

    await new Promise<void>((resolve) => {
      const origJson = res.json.bind(res);
      res.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(req, res);
    });

    assert.equal(res.statusCode, 404);
    assert.ok(res.getHeader('content-type')?.includes('application/json'));
    assert.equal(typeof res.body, 'object');
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, ErrorCode.RESOURCE_NOT_FOUND);
    assert.ok(res.body.error.message.includes(nonExistentId) || res.body.error.message.includes('not found'));
  });

  test('3. Sync disabled account returns HTTP 400 with valid JSON', async () => {
    await accountService.toggleAccountEnabled(testUser.id, testAccount.id, false);

    const { req, res } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${testAccount.id}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
    });

    await new Promise<void>((resolve) => {
      const origJson = res.json.bind(res);
      res.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(req, res);
    });

    assert.equal(res.statusCode, 400);
    assert.ok(res.getHeader('content-type')?.includes('application/json'));
    assert.equal(typeof res.body, 'object');
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, ErrorCode.ACCOUNT_DISABLED);
    assert.ok(res.body.error.message.includes('disabled'));
  });

  test('4. Sync with expired token preserves HTTP 401 and valid JSON', async () => {
    mockProvider.refreshHandler = async () => {
      throw new AppError(
        ErrorCode.TOKEN_EXPIRED,
        'Google Drive access token expired: invalid_grant',
        401
      );
    };

    const { req, res } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${testAccount.id}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
    });

    await new Promise<void>((resolve) => {
      const origJson = res.json.bind(res);
      res.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(req, res);
    });

    assert.equal(res.statusCode, 401);
    assert.ok(res.getHeader('content-type')?.includes('application/json'));
    assert.equal(typeof res.body, 'object');
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, ErrorCode.TOKEN_EXPIRED);
    assert.ok(res.body.error.message.includes('expired'));
  });

  test('5. Sync with upstream provider network error preserves HTTP 502 and valid JSON', async () => {
    mockProvider.quotaHandler = async () => {
      throw new AppError(
        ErrorCode.PROVIDER_ERROR,
        'Google Drive quota query failed: connect ETIMEDOUT',
        502
      );
    };

    const { req, res } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${testAccount.id}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
    });

    await new Promise<void>((resolve) => {
      const origJson = res.json.bind(res);
      res.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(req, res);
    });

    assert.equal(res.statusCode, 502);
    assert.ok(res.getHeader('content-type')?.includes('application/json'));
    assert.equal(typeof res.body, 'object');
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, ErrorCode.PROVIDER_ERROR);
    assert.ok(res.body.error.message.includes('ETIMEDOUT') || res.body.error.message.includes('Google Drive'));
  });

  test('6. Sync with unexpected non-AppError preserves HTTP status or 500 and returns valid JSON', async () => {
    mockProvider.refreshHandler = async () => {
      const customErr = new Error('Unexpected network socket hang up');
      (customErr as any).status = 503;
      throw customErr;
    };

    const { req, res } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${testAccount.id}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
    });

    await new Promise<void>((resolve) => {
      const origJson = res.json.bind(res);
      res.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(req, res);
    });

    assert.equal(res.statusCode, 503);
    assert.ok(res.getHeader('content-type')?.includes('application/json'));
    assert.equal(typeof res.body, 'object');
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, ErrorCode.SERVICE_UNAVAILABLE);
    assert.ok(res.body.error.message.includes('Unexpected network socket hang up'));
  });

  test('7. Vercel serverless handler (api/index.ts) awaits response and returns valid JSON on sync failure', async () => {
    mockProvider.refreshHandler = async () => {
      throw new AppError(ErrorCode.TOKEN_EXPIRED, 'Serverless sync token expired', 401);
    };

    const { req, res } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${testAccount.id}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      },
    });

    // Invoke handler and await its Promise directly
    await handler(req, res);

    assert.equal(res.statusCode, 401);
    assert.ok(res.getHeader('content-type')?.includes('application/json'));
    assert.equal(typeof res.body, 'object');
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, ErrorCode.TOKEN_EXPIRED);
  });

  test('8. Client parseApiResponse parses JSON and non-JSON (plain-text/HTML) safely', async () => {
    // Test 8a: Valid JSON response
    const mockJsonResponse = new Response(
      JSON.stringify({
        success: true,
        data: { filesDiscovered: 42 },
        meta: { timestamp: new Date().toISOString() },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const parsedJson = await parseApiResponse(mockJsonResponse);
    assert.equal(parsedJson.ok, true);
    assert.equal(parsedJson.status, 200);
    assert.equal(parsedJson.data.filesDiscovered, 42);

    // Test 8b: Plain-text error response starting with "An error o"
    const mockPlainTextResponse = new Response('An error occurred with your deployment: FUNCTION_INVOCATION_FAILED', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
    const parsedText = await parseApiResponse(mockPlainTextResponse);
    assert.equal(parsedText.ok, false);
    assert.equal(parsedText.status, 500);
    assert.ok(parsedText.error?.message.includes('500'));
    assert.ok(parsedText.error?.message.includes('An error occurred'));

    // Test 8c: HTML error page
    const mockHtmlResponse = new Response('<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1><p>Nginx</p></body></html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    });
    const parsedHtml = await parseApiResponse(mockHtmlResponse);
    assert.equal(parsedHtml.ok, false);
    assert.equal(parsedHtml.status, 502);
    assert.ok(parsedHtml.error?.message.includes('502'));
    assert.ok(!parsedHtml.error?.message.includes('<!DOCTYPE html>')); // Stripped HTML tags
  });

  test('9. GET /api/debug/version returns valid JSON with build metadata and no secrets', async () => {
    const { req, res } = createMockHttp({
      method: 'GET',
      url: '/api/debug/version',
    });

    await new Promise<void>((resolve) => {
      const origJson = res.json.bind(res);
      res.json = (body: any) => {
        origJson(body);
        resolve();
      };
      app(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.getHeader('content-type')?.includes('application/json'));
    assert.equal(typeof res.body, 'object');
    assert.equal(res.body.success, true);
    assert.ok(typeof res.body.data.buildId === 'string' && res.body.data.buildId.length > 0);
    assert.ok(typeof res.body.data.apiVersion === 'string' && res.body.data.apiVersion.length > 0);
    assert.ok(typeof res.body.data.serverTimestamp === 'string');
    // Ensure no secrets are leaked
    const rawBody = JSON.stringify(res.body).toLowerCase();
    assert.ok(!rawBody.includes('password'));
    assert.ok(!rawBody.includes('secret'));
    assert.ok(!rawBody.includes('token'));
    assert.ok(!rawBody.includes('cookie'));
  });

  test('10. POST /api/accounts/:id/sync propagates X-UniCloud-Request-ID and Build-ID headers', async () => {
    const customReqId = 'diag_sync_test_req_12345';
    const { req, res } = createMockHttp({
      method: 'POST',
      url: `/api/accounts/${testAccount.id}/sync`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        'x-unicloud-request-id': customReqId,
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

    assert.equal(res.statusCode, 200);
    assert.equal(res.getHeader('x-unicloud-request-id'), customReqId);
    assert.ok(typeof res.getHeader('x-unicloud-build-id') === 'string');
  });
});
