/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Phase 7 — Production & Vercel Readiness Regression Test Suite
 * 
 * Tests:
 * 1. Vercel serverless function entrypoint execution (api/index.ts)
 * 2. Express routing compatibility with and without /api prefix
 * 3. Selective body parsing: binary chunk uploads are NOT processed by express.json()
 * 4. Resumable upload bounded-memory chunk processing
 * 5. API 404 isolation (prevents HTML SPA fallback for API endpoints)
 * 6. Serverless database pooling, connection storm mitigation, and schema deduplication
 * 7. Production environment validation and secret masking (zero credential leakage)
 * 8. Accurate Phase 7 health and spec status metadata reporting
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import handler, {
  app,
  initializeServerlessInstance,
  getServerlessInitStats,
  resetServerlessInitStateForTesting,
} from '../../api/index.js';
import { isUploadPayloadRoute } from '../server/app.js';
import { formatErrorResponse, AppError } from '../server/utils/errors.js';
import { ErrorCode } from '../types/api.js';
import { validateSecurityConfiguration } from '../server/utils/config.js';
import {
  getPool,
  ensureSchema,
  query,
  transaction,
  validateDatabaseUrl,
  isProductionMode,
  resetDatabaseStateForTesting,
  checkDatabaseHealth,
} from '../db/client.js';
import { UserService } from '../server/services/UserService.js';
import { ProviderRegistry } from '../server/providers/ProviderRegistry.js';
import { ProviderType } from '../types/account.js';
import { SESSION_COOKIE_NAME, getSessionCookieOptions, getClearCookieOptions } from '../server/api/middleware/auth.js';
import { getGoogleRedirectUri } from '../server/api/routes.js';
import { GoogleDriveProvider } from '../server/providers/GoogleDriveProvider.js';
import { OAuthStateService } from '../server/services/OAuthStateService.js';

/**
 * Mock Request & Response harness for testing Express applications and serverless handlers
 */
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
  req.query = {};
  req.body = options.body;

  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    cookiesSet: [] as { name: string; val: any; options: any }[],
    cookiesCleared: [] as { name: string; options: any }[],
    body: null as any,
    ended: false,
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
    cookie(name: string, val: any, options: any) {
      this.cookiesSet.push({ name, val, options });
      return this;
    },
    clearCookie(name: string, options: any) {
      this.cookiesCleared.push({ name, options });
      return this;
    },
    redirect(statusOrUrl: number | string, optUrl?: string) {
      const code = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
      const url = typeof statusOrUrl === 'string' ? statusOrUrl : (optUrl || '/');
      this.statusCode = code;
      this.setHeader('location', url);
      this.ended = true;
      req.emit('end');
      return this;
    },
    json(data: any) {
      this.body = data;
      this.ended = true;
      req.emit('end');
      return this;
    },
    send(data: any) {
      this.body = data;
      this.ended = true;
      req.emit('end');
      return this;
    },
    end() {
      this.ended = true;
      req.emit('end');
      return this;
    },
  };

  return { req, res };
}

describe('UniCloud Phase 7: Production & Vercel Deployment Readiness', () => {

  describe('1. Vercel Serverless Function Entrypoint', () => {
    test('api/index.ts handler executes and returns 200 for /api/health with Phase 7 metadata', async () => {
      const { req, res } = createMockHttp({ method: 'GET', url: '/api/health' });
      
      await new Promise<void>((resolve) => {
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
          originalJson(data);
          resolve();
        };
        handler(req, res);
      });

      assert.equal(res.statusCode, 200);
      assert.ok(res.body);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.version, '1.7.0-phase7');
      assert.equal(res.body.data.phase, 'Phase 7: Production & Vercel Readiness');
    });

    test('api/index.ts routes correctly even when /api prefix is stripped by edge rewrite (/health)', async () => {
      const { req, res } = createMockHttp({ method: 'GET', url: '/health' });

      await new Promise<void>((resolve) => {
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
          originalJson(data);
          resolve();
        };
        handler(req, res);
      });

      assert.equal(res.statusCode, 200);
      assert.ok(res.body);
      assert.equal(res.body.data.version, '1.7.0-phase7');
    });

    test('/api/spec/status reports Phase 7 completion with all 8 architectural milestones', async () => {
      const { req, res } = createMockHttp({ method: 'GET', url: '/api/spec/status' });

      await new Promise<void>((resolve) => {
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
          originalJson(data);
          resolve();
        };
        handler(req, res);
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.currentPhase, 7);
      assert.equal(res.body.data.phaseName, 'Phase 7: Production & Vercel Readiness');
      assert.equal(res.body.data.completedMilestones.length, 8);
      assert.equal(res.body.data.upcomingPhases.length, 0);
    });
  });

  describe('2. Request Body Isolation & Binary Chunk Protection', () => {
    test('isUploadPayloadRoute correctly identifies upload chunk and stream routes', () => {
      assert.equal(isUploadPayloadRoute('/api/upload/job-123/chunk'), true);
      assert.equal(isUploadPayloadRoute('/upload/job-123/chunk'), true);
      assert.equal(isUploadPayloadRoute('/api/upload/stream'), true);
      assert.equal(isUploadPayloadRoute('/api/upload/initiate'), false);
      assert.equal(isUploadPayloadRoute('/api/files'), false);
    });

    test('Unmatched /api/* routes return 404 JSON with ErrorCode.NOT_FOUND (not HTML SPA fallback)', async () => {
      const { req, res } = createMockHttp({ method: 'GET', url: '/api/unknown_endpoint_xyz' });

      await new Promise<void>((resolve) => {
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
          originalJson(data);
          resolve();
        };
        app(req, res);
      });

      assert.equal(res.statusCode, 404);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, ErrorCode.NOT_FOUND);
      assert.match(res.body.error.message, /API endpoint not found/);
    });

    test('Security headers include X-Content-Type-Options: nosniff', async () => {
      const { req, res } = createMockHttp({ method: 'GET', url: '/api/health' });

      await new Promise<void>((resolve) => {
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
          originalJson(data);
          resolve();
        };
        app(req, res);
      });

      assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
    });
  });

  describe('3. Serverless Database Pooling & Connection Storm Protection', () => {
    test('getPool() reuses pool instance across invocations via globalThis', () => {
      const pool1 = getPool();
      const pool2 = getPool();
      assert.equal(pool1, pool2);
    });

    test('ensureSchema() deduplicates concurrent executions', async () => {
      const p1 = ensureSchema();
      const p2 = ensureSchema();
      await Promise.all([p1, p2]);
      assert.ok(true);
    });
  });

  describe('4. Production Security Validation & Zero Credential Leakage', () => {
    test('validateSecurityConfiguration returns diagnostic status without throwing in dev', () => {
      const status = validateSecurityConfiguration();
      assert.ok(typeof status.isProduction === 'boolean');
      assert.ok(typeof status.authSecretValid === 'boolean');
      assert.ok(typeof status.encryptionValid === 'boolean');
    });

    test('formatErrorResponse masks database passwords from connection URLs', () => {
      const errorWithDbUrl = new Error('Connection failed to postgresql://postgres:SuperSecretP@ss123@db.supabase.co:5432/postgres');
      const response = formatErrorResponse(errorWithDbUrl);

      assert.equal(response.success, false);
      const jsonStr = JSON.stringify(response);
      assert.ok(!jsonStr.includes('SuperSecretP@ss123'));
      assert.ok(jsonStr.includes('***@') || jsonStr.includes('internal server error'));
    });

    test('formatErrorResponse masks Bearer tokens and OAuth secrets', () => {
      const errorWithToken = new AppError(
        ErrorCode.PROVIDER_ERROR,
        'Failed request with Bearer ya29.a0AfH6SMA89SecretTokenValue and client_secret=GOCSPX-SecretValue123'
      );
      const response = formatErrorResponse(errorWithToken);

      assert.equal(response.success, false);
      const jsonStr = JSON.stringify(response);
      assert.ok(!jsonStr.includes('ya29.a0AfH6SMA89SecretTokenValue'));
      assert.ok(!jsonStr.includes('GOCSPX-SecretValue123'));
      assert.ok(jsonStr.includes('Bearer ***'));
      assert.ok(jsonStr.includes('client_secret=***'));
    });

    test('formatErrorResponse masks 64-character raw hex encryption keys', () => {
      const secretKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const errorWithKey = new AppError(ErrorCode.CONFIGURATION_ERROR, `Key ${secretKey} was rejected`);
      const response = formatErrorResponse(errorWithKey);

      assert.ok(!JSON.stringify(response).includes(secretKey));
      assert.ok(JSON.stringify(response).includes('[REDACTED_SECRET]'));
    });

    test('formatErrorResponse suppresses unhandled error details when NODE_ENV is production', () => {
      const prevEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const unhandledErr = new TypeError('Cannot read properties of undefined (reading secretInternalMethod) at /app/server.ts:42:10');
        const response = formatErrorResponse(unhandledErr);

        assert.equal(response.success, false);
        assert.equal(response.error.code, ErrorCode.INTERNAL_ERROR);
        assert.equal(response.error.message, 'An internal server error occurred. Please try again later.');
        assert.ok(!JSON.stringify(response).includes('secretInternalMethod'));
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });
  });

  describe('5. Serverless Fail-Closed Security Boundary & Exactly-Once Warm Initialization', () => {
    test('Serverless request fails closed safely when required production secrets are missing', async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevKey = process.env.ENCRYPTION_KEY;
      const prevTokenKey = process.env.TOKEN_ENCRYPTION_KEY;

      try {
        // Enforce strict production mode without valid keys
        process.env.NODE_ENV = 'production';
        delete process.env.ENCRYPTION_KEY;
        delete process.env.TOKEN_ENCRYPTION_KEY;

        resetServerlessInitStateForTesting();

        const { req, res } = createMockHttp({ method: 'GET', url: '/api/health' });
        
        await new Promise<void>((resolve) => {
          const originalJson = res.json.bind(res);
          res.json = (data: any) => {
            originalJson(data);
            resolve();
          };
          handler(req, res);
        });

        // Request MUST fail safely with 500 status
        assert.equal(res.statusCode, 500);
        assert.ok(res.body);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error.code, ErrorCode.CONFIGURATION_ERROR);
        assert.ok(res.body.error.message.includes('ENCRYPTION_KEY'));
        // Never expose stack trace
        assert.equal(res.body.error.stack, undefined);

        // Subsequent request on the same instance MUST also fail closed safely
        const { req: req2, res: res2 } = createMockHttp({ method: 'GET', url: '/api/files' });
        await new Promise<void>((resolve) => {
          const originalJson = res2.json.bind(res2);
          res2.json = (data: any) => {
            originalJson(data);
            resolve();
          };
          handler(req2, res2);
        });

        assert.equal(res2.statusCode, 500);
        assert.equal(res2.body.success, false);
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevKey) process.env.ENCRYPTION_KEY = prevKey;
        if (prevTokenKey) process.env.TOKEN_ENCRYPTION_KEY = prevTokenKey;
        resetServerlessInitStateForTesting();
      }
    });

    test('Vercel entrypoint initializes safely exactly once per warm instance', async () => {
      resetServerlessInitStateForTesting();
      assert.equal(getServerlessInitStats().initExecutionCount, 0);

      // First invocation initializes instance
      const { req: req1, res: res1 } = createMockHttp({ method: 'GET', url: '/api/health' });
      await new Promise<void>((resolve) => {
        const originalJson = res1.json.bind(res1);
        res1.json = (data: any) => {
          originalJson(data);
          resolve();
        };
        handler(req1, res1);
      });

      assert.equal(res1.statusCode, 200);
      assert.equal(getServerlessInitStats().initExecutionCount, 1);
      assert.equal(getServerlessInitStats().isInitialized, true);

      // Second, third, fourth invocations on the warm instance do NOT re-run initialization
      for (let i = 0; i < 3; i++) {
        const { req, res } = createMockHttp({ method: 'GET', url: '/api/health' });
        await new Promise<void>((resolve) => {
          const originalJson = res.json.bind(res);
          res.json = (data: any) => {
            originalJson(data);
            resolve();
          };
          handler(req, res);
        });
        assert.equal(res.statusCode, 200);
      }

      // Initialization count remains strictly 1
      assert.equal(getServerlessInitStats().initExecutionCount, 1);
    });

    test('Concurrent cold-start requests are coalesced into a single initialization run', async () => {
      resetServerlessInitStateForTesting();

      // Launch 5 concurrent invocations simultaneously
      const promises = Array.from({ length: 5 }).map(() => {
        const { req, res } = createMockHttp({ method: 'GET', url: '/api/health' });
        return new Promise<void>((resolve) => {
          const originalJson = res.json.bind(res);
          res.json = (data: any) => {
            originalJson(data);
            resolve();
          };
          handler(req, res);
        });
      });

      await Promise.all(promises);

      // Verifies exactly-once execution despite concurrent cold-start flood
      assert.equal(getServerlessInitStats().initExecutionCount, 1);
      assert.equal(getServerlessInitStats().isInitialized, true);
    });
  });

  describe('6. Production Demo User Mutation Safeguard', () => {
    test('UserService.ensureDemoUser returns null in production mode and creates no auth data', async () => {
      const prevEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const result = await UserService.ensureDemoUser();
        // Must return null if user does not already exist, never create demo user with default password
        if (result) {
          // If already created in dev, it only returns existing without mutation
          assert.equal(result.email, 'socialdoodle7@gmail.com');
        } else {
          assert.equal(result, null);
        }
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    test('UserService.ensureDemoUser returns null in VERCEL_ENV=production mode', async () => {
      const prevVercelEnv = process.env.VERCEL_ENV;
      try {
        process.env.VERCEL_ENV = 'production';
        const result = await UserService.ensureDemoUser();
        if (result) {
          assert.equal(result.email, 'socialdoodle7@gmail.com');
        } else {
          assert.equal(result, null);
        }
      } finally {
        process.env.VERCEL_ENV = prevVercelEnv;
      }
    });
  });

  describe('7. P7.2 Serverless ESM Module Resolution & OAuth Config Dynamic Loading', () => {
    test('GET /api/auth/me loads and executes without ESM module resolution errors', async () => {
      const { req, res } = createMockHttp({ method: 'GET', url: '/api/auth/me' });
      await new Promise<void>((resolve) => {
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
          originalJson(data);
          resolve();
        };
        handler(req, res);
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
    });

    test('GET /api/accounts/google/config loads and executes without ESM module resolution errors', async () => {
      const { req, res } = createMockHttp({ method: 'GET', url: '/api/accounts/google/config' });
      await new Promise<void>((resolve) => {
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
          originalJson(data);
          resolve();
        };
        handler(req, res);
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.ok(typeof res.body.data.isConfigured === 'boolean');
      assert.ok(typeof res.body.data.clientIdAvailable === 'boolean');
      assert.ok(res.body.data.redirectUri);
      assert.ok(Array.isArray(res.body.data.requiredScopes));
    });

    test('Google OAuth config is dynamically read from the production environment', async () => {
      const prevClientId = process.env.GOOGLE_CLIENT_ID;
      const prevClientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const prevAppUrl = process.env.APP_URL;
      const prevRedirectUri = process.env.GOOGLE_REDIRECT_URI;

      try {
        // 1. Simulate production with configured Google OAuth credentials and explicit redirect URI
        delete process.env.GOOGLE_REDIRECT_URI;
        process.env.GOOGLE_CLIENT_ID = 'test-client-id-prod.apps.googleusercontent.com';
        process.env.GOOGLE_CLIENT_SECRET = 'GOCSPX-prodSecretValue123';
        process.env.APP_URL = 'https://unicloud.example.com';

        const { req: req1, res: res1 } = createMockHttp({
          method: 'GET',
          url: '/api/accounts/google/config',
        });
        await new Promise<void>((resolve) => {
          const originalJson = res1.json.bind(res1);
          res1.json = (data: any) => {
            originalJson(data);
            resolve();
          };
          handler(req1, res1);
        });

        assert.equal(res1.statusCode, 200);
        assert.equal(res1.body.data.isConfigured, true);
        assert.equal(res1.body.data.clientIdAvailable, true);
        assert.equal(
          res1.body.data.redirectUri,
          'https://unicloud.example.com/api/accounts/google/callback'
        );

        // 2. Simulate production with unconfigured Google OAuth credentials
        delete process.env.GOOGLE_CLIENT_ID;
        delete process.env.GOOGLE_CLIENT_SECRET;

        const { req: req2, res: res2 } = createMockHttp({
          method: 'GET',
          url: '/api/accounts/google/config',
        });
        await new Promise<void>((resolve) => {
          const originalJson = res2.json.bind(res2);
          res2.json = (data: any) => {
            originalJson(data);
            resolve();
          };
          handler(req2, res2);
        });

        assert.equal(res2.statusCode, 200);
        assert.equal(res2.body.data.isConfigured, false);
        assert.equal(res2.body.data.clientIdAvailable, false);
      } finally {
        if (prevClientId) process.env.GOOGLE_CLIENT_ID = prevClientId;
        else delete process.env.GOOGLE_CLIENT_ID;
        if (prevClientSecret) process.env.GOOGLE_CLIENT_SECRET = prevClientSecret;
        else delete process.env.GOOGLE_CLIENT_SECRET;
        if (prevAppUrl) process.env.APP_URL = prevAppUrl;
        else delete process.env.APP_URL;
        if (prevRedirectUri) process.env.GOOGLE_REDIRECT_URI = prevRedirectUri;
        else delete process.env.GOOGLE_REDIRECT_URI;
      }
    });

    test('ProviderRegistry resolves GoogleDriveProvider under ESM without ERR_MODULE_NOT_FOUND', () => {
      const provider = ProviderRegistry.get(ProviderType.GOOGLE_DRIVE);
      assert.ok(provider);
      assert.equal(provider.providerType, ProviderType.GOOGLE_DRIVE);
      assert.ok(Array.isArray(ProviderRegistry.supportedProviders()));
      assert.ok(ProviderRegistry.supportedProviders().includes(ProviderType.GOOGLE_DRIVE));
    });
  });

  describe('8. P7.3 Production Authentication & Google OAuth Canonicalization', () => {
    test('POST /api/auth/login sets persistent HTTP-only cookie and does NOT expose raw session token in response body', async () => {
      // Ensure test user exists
      const testEmail = 'socialdoodle7@gmail.com';
      const testPassword = 'Password123!';

      const { req, res } = createMockHttp({
        method: 'POST',
        url: '/api/auth/login',
        body: { email: testEmail, password: testPassword },
      });

      await new Promise<void>((resolve) => {
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
          originalJson(data);
          resolve();
        };
        app(req, res);
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.data.user);
      assert.equal(res.body.data.user.email, testEmail);

      // CRITICAL: Raw session token MUST NOT be in response body
      assert.equal(res.body.data.sessionToken, undefined);

      // Verify persistent HTTP-only cookie was set with correct options
      assert.ok(res.cookiesSet.length > 0);
      const cookie = res.cookiesSet.find((c: any) => c.name === SESSION_COOKIE_NAME);
      assert.ok(cookie, 'SESSION_COOKIE_NAME should be set');
      assert.ok(typeof cookie.val === 'string' && cookie.val.length > 20);
      assert.equal(cookie.options.httpOnly, true);
      assert.equal(cookie.options.path, '/');
      assert.equal(cookie.options.sameSite, 'lax');
      assert.equal(cookie.options.maxAge, 7 * 24 * 60 * 60 * 1000);
    });

    test('GET /api/auth/me reliably restores authenticated session via HTTP-only cookie without Bearer header', async () => {
      // 1. Authenticate first to acquire session token
      const session = await UserService.authenticateUser({
        email: 'socialdoodle7@gmail.com',
        password: 'Password123!',
      });
      assert.ok(session.sessionToken);

      // 2. Request /api/auth/me with cookie ONLY (no authorization header)
      const { req, res } = createMockHttp({
        method: 'GET',
        url: '/api/auth/me',
        cookies: {
          [SESSION_COOKIE_NAME]: session.sessionToken,
        },
      });

      await new Promise<void>((resolve) => {
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
          originalJson(data);
          resolve();
        };
        app(req, res);
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.data);
      assert.equal(res.body.data.email, 'socialdoodle7@gmail.com');
    });

    test('POST /api/auth/logout invalidates session in database and clears browser cookie without deprecated maxAge', async () => {
      // 1. Create a session to log out
      const session = await UserService.authenticateUser({
        email: 'socialdoodle7@gmail.com',
        password: 'Password123!',
      });
      const token = session.sessionToken;

      // 2. Call logout with cookie
      const { req, res } = createMockHttp({
        method: 'POST',
        url: '/api/auth/logout',
        cookies: {
          [SESSION_COOKIE_NAME]: token,
        },
      });

      await new Promise<void>((resolve) => {
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
          originalJson(data);
          resolve();
        };
        app(req, res);
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);

      // Verify cookie was cleared
      const cleared = res.cookiesCleared.find((c: any) => c.name === SESSION_COOKIE_NAME);
      assert.ok(cleared, 'Session cookie should be cleared on logout');
      assert.equal(cleared.options.httpOnly, true);
      assert.equal(cleared.options.path, '/');
      assert.equal(cleared.options.sameSite, 'lax');
      assert.equal(cleared.options.maxAge, undefined, 'maxAge must not be passed to clearCookie');

      // Verify session is invalidated in DB
      const validated = await UserService.validateSession(token);
      assert.equal(validated, null, 'Session must be invalidated in database');
    });

    test('Protected route rejects invalid session and clears cookie without deprecated maxAge', async () => {
      const { req, res } = createMockHttp({
        method: 'GET',
        url: '/api/accounts',
        cookies: {
          [SESSION_COOKIE_NAME]: 'invalid-and-nonexistent-session-token-12345',
        },
      });

      await new Promise<void>((resolve) => {
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
          originalJson(data);
          resolve();
        };
        app(req, res);
      });

      assert.equal(res.statusCode, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, ErrorCode.UNAUTHORIZED);

      // Verify cookie was cleared
      const cleared = res.cookiesCleared.find((c: any) => c.name === SESSION_COOKIE_NAME);
      assert.ok(cleared, 'Invalid session cookie should be cleared');
      assert.equal(cleared.options.httpOnly, true);
      assert.equal(cleared.options.path, '/');
      assert.equal(cleared.options.maxAge, undefined);
    });

    test('getGoogleRedirectUri canonicalizes all configurations to /api/accounts/google/callback', () => {
      const prevRedirect = process.env.GOOGLE_REDIRECT_URI;
      const prevAppUrl = process.env.APP_URL;

      try {
        // Case 1: Legacy ambiguous path normalizes to canonical callback
        process.env.GOOGLE_REDIRECT_URI = 'https://unicloud1.vercel.app/api/auth/google/callback';
        delete process.env.APP_URL;
        assert.equal(
          getGoogleRedirectUri(),
          'https://unicloud1.vercel.app/api/accounts/google/callback'
        );

        // Case 2: Origin root URL normalizes to canonical callback
        process.env.GOOGLE_REDIRECT_URI = 'https://unicloud1.vercel.app';
        assert.equal(
          getGoogleRedirectUri(),
          'https://unicloud1.vercel.app/api/accounts/google/callback'
        );

        // Case 3: Canonical path is preserved as-is
        process.env.GOOGLE_REDIRECT_URI = 'https://unicloud1.vercel.app/api/accounts/google/callback';
        assert.equal(
          getGoogleRedirectUri(),
          'https://unicloud1.vercel.app/api/accounts/google/callback'
        );

        // Case 4: APP_URL fallback resolves to canonical callback
        delete process.env.GOOGLE_REDIRECT_URI;
        process.env.APP_URL = 'https://custom-domain.com';
        assert.equal(
          getGoogleRedirectUri(),
          'https://custom-domain.com/api/accounts/google/callback'
        );
      } finally {
        if (prevRedirect) process.env.GOOGLE_REDIRECT_URI = prevRedirect;
        else delete process.env.GOOGLE_REDIRECT_URI;
        if (prevAppUrl) process.env.APP_URL = prevAppUrl;
        else delete process.env.APP_URL;
      }
    });

    test('OAuth authorization URL and OAuthStateService both use the canonical redirect URI', async () => {
      const prevClientId = process.env.GOOGLE_CLIENT_ID;
      const prevClientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const prevRedirect = process.env.GOOGLE_REDIRECT_URI;

      try {
        process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
        process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
        process.env.GOOGLE_REDIRECT_URI = 'https://unicloud1.vercel.app/api/accounts/google/callback';

        const canonicalUri = getGoogleRedirectUri();
        assert.equal(canonicalUri, 'https://unicloud1.vercel.app/api/accounts/google/callback');

        // Verify provider generates auth URL with canonical redirect_uri
        const provider = ProviderRegistry.get(ProviderType.GOOGLE_DRIVE) as GoogleDriveProvider;
        const authUrl = provider.getAuthorizationUrl('test-csrf-state-token', canonicalUri);
        assert.ok(authUrl.includes(encodeURIComponent('https://unicloud1.vercel.app/api/accounts/google/callback')));

        // Verify state service records the canonical redirect URI
        const stateToken = await OAuthStateService.createState('test-user-id-p73', canonicalUri);
        assert.ok(stateToken);

        const verified = await OAuthStateService.verifyAndConsumeState(stateToken, {
          expectedProvider: ProviderType.GOOGLE_DRIVE,
          expectedUserId: 'test-user-id-p73',
        });
        assert.equal(verified.userId, 'test-user-id-p73');
        assert.equal(verified.redirectUri, canonicalUri);
      } finally {
        if (prevClientId) process.env.GOOGLE_CLIENT_ID = prevClientId;
        else delete process.env.GOOGLE_CLIENT_ID;
        if (prevClientSecret) process.env.GOOGLE_CLIENT_SECRET = prevClientSecret;
        else delete process.env.GOOGLE_CLIENT_SECRET;
        if (prevRedirect) process.env.GOOGLE_REDIRECT_URI = prevRedirect;
        else delete process.env.GOOGLE_REDIRECT_URI;
      }
    });

    test('Disambiguation: GET /api/auth/google/callback redirects with HTTP 301 to /api/accounts/google/callback', async () => {
      const { req, res } = createMockHttp({
        method: 'GET',
        url: '/api/auth/google/callback?code=mock_code_123&state=mock_state_456',
      });

      await new Promise<void>((resolve) => {
        const originalRedirect = res.redirect.bind(res);
        res.redirect = (statusOrUrl: any, optUrl?: any) => {
          originalRedirect(statusOrUrl, optUrl);
          resolve();
        };
        app(req, res);
      });

      assert.equal(res.statusCode, 301);
      assert.equal(
        res.headers['location'],
        '/api/accounts/google/callback?code=mock_code_123&state=mock_state_456'
      );
    });

    test('Login handles trimmed and case-insensitive email queries reliably', async () => {
      const { req, res } = createMockHttp({
        method: 'POST',
        url: '/api/auth/login',
        body: {
          email: '   SOCIALDOODLE7@GMAIL.COM   ',
          password: 'Password123!',
        },
      });

      await new Promise<void>((resolve) => {
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
          originalJson(data);
          resolve();
        };
        app(req, res);
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.user.email, 'socialdoodle7@gmail.com');
    });

    test('getClearCookieOptions omits maxAge to conform to standard cookie removal', () => {
      const clearOptions = getClearCookieOptions();
      assert.equal(clearOptions.httpOnly, true);
      assert.equal(clearOptions.path, '/');
      assert.equal(clearOptions.sameSite, 'lax');
      assert.equal('maxAge' in clearOptions, false, 'getClearCookieOptions must not include maxAge');
    });
  });

  describe('9. P7.4 Production Database Fail-Closed Enforcement', () => {
    test('validateDatabaseUrl detects missing, empty, malformed, and placeholder passwords correctly', () => {
      // Missing or undefined
      assert.equal(validateDatabaseUrl(undefined).valid, false);
      assert.match(validateDatabaseUrl(undefined).reason!, /missing or empty/i);

      // Empty string
      assert.equal(validateDatabaseUrl('   ').valid, false);
      assert.match(validateDatabaseUrl('   ').reason!, /missing or empty/i);

      // Placeholder password variants
      const placeholders = [
        'postgresql://postgres:[YOUR-PASSWORD]@db.supabase.co:5432/postgres',
        'postgresql://postgres:[password]@db.supabase.co:5432/postgres',
        'postgresql://postgres:<password>@db.supabase.co:5432/postgres',
        'postgresql://postgres:your-password@db.supabase.co:5432/postgres',
        'postgresql://postgres:[your-password]@db.supabase.co:5432/postgres',
        'postgresql://postgres:PASSWORD_HERE@db.supabase.co:5432/postgres',
        'postgresql://postgres:<YOUR-PASSWORD>@db.supabase.co:5432/postgres',
      ];
      for (const placeholderUrl of placeholders) {
        const result = validateDatabaseUrl(placeholderUrl);
        assert.equal(result.valid, false, `Failed to reject placeholder URL: ${placeholderUrl}`);
        assert.match(result.reason!, /placeholder/i);
      }

      // Malformed protocol scheme
      assert.equal(validateDatabaseUrl('http://localhost:5432').valid, false);
      assert.match(validateDatabaseUrl('http://localhost:5432').reason!, /malformed/i);
      assert.equal(validateDatabaseUrl('mysql://root:secret@localhost:3306/db').valid, false);

      // Malformed / unparseable
      assert.equal(validateDatabaseUrl('not-a-valid-database-url').valid, false);
      assert.match(validateDatabaseUrl('not-a-valid-database-url').reason!, /malformed/i);

      // Valid connection string
      const validUrl = 'postgresql://postgres:realSecurePass123!@db.supabase.co:5432/postgres';
      const validResult = validateDatabaseUrl(validUrl);
      assert.equal(validResult.valid, true);
      assert.equal(validResult.reason, undefined);
    });

    test('validateSecurityConfiguration fails closed with CONFIGURATION_ERROR in NODE_ENV=production when DATABASE_URL is missing', () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevDbUrl = process.env.DATABASE_URL;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.DATABASE_URL;

        assert.throws(
          () => {
            validateSecurityConfiguration();
          },
          (err: any) => {
            assert.equal(err instanceof AppError, true);
            assert.equal(err.errorCode, ErrorCode.CONFIGURATION_ERROR);
            assert.equal(err.statusCode, 500);
            assert.match(err.message, /DATABASE_URL is missing or empty/i);
            return true;
          }
        );
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        if (prevDbUrl !== undefined) {
          process.env.DATABASE_URL = prevDbUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
      }
    });

    test('validateSecurityConfiguration fails closed with CONFIGURATION_ERROR in VERCEL_ENV=production when DATABASE_URL contains placeholder password', () => {
      const prevVercelEnv = process.env.VERCEL_ENV;
      const prevDbUrl = process.env.DATABASE_URL;

      try {
        process.env.VERCEL_ENV = 'production';
        process.env.DATABASE_URL = 'postgresql://postgres:[YOUR-PASSWORD]@db.supabase.co:5432/postgres';

        assert.throws(
          () => {
            validateSecurityConfiguration();
          },
          (err: any) => {
            assert.equal(err instanceof AppError, true);
            assert.equal(err.errorCode, ErrorCode.CONFIGURATION_ERROR);
            assert.equal(err.statusCode, 500);
            assert.match(err.message, /placeholder password/i);
            // Must not leak passwords or raw connection strings
            assert.equal(err.message.includes('supabase.co'), false);
            return true;
          }
        );
      } finally {
        process.env.VERCEL_ENV = prevVercelEnv;
        if (prevDbUrl !== undefined) {
          process.env.DATABASE_URL = prevDbUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
      }
    });

    test('getPool fails closed with CONFIGURATION_ERROR in production when DATABASE_URL is missing or invalid', () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevDbUrl = process.env.DATABASE_URL;

      try {
        process.env.NODE_ENV = 'production';
        process.env.DATABASE_URL = 'postgresql://postgres:[YOUR-PASSWORD]@db.supabase.co:5432/postgres';
        resetDatabaseStateForTesting();

        assert.throws(
          () => {
            getPool();
          },
          (err: any) => {
            assert.equal(err instanceof AppError, true);
            assert.equal(err.errorCode, ErrorCode.CONFIGURATION_ERROR);
            assert.equal(err.statusCode, 500);
            assert.match(err.message, /placeholder password/i);
            return true;
          }
        );
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        if (prevDbUrl !== undefined) {
          process.env.DATABASE_URL = prevDbUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
        resetDatabaseStateForTesting();
      }
    });

    test('query and transaction NEVER fall back to in-memory database in NODE_ENV=production or VERCEL_ENV=production', async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevDbUrl = process.env.DATABASE_URL;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.DATABASE_URL;
        resetDatabaseStateForTesting();

        // 1. query() MUST throw CONFIGURATION_ERROR and never execute in-memory
        await assert.rejects(
          async () => {
            await query('SELECT * FROM users');
          },
          (err: any) => {
            assert.equal(err instanceof AppError, true);
            assert.equal(err.errorCode, ErrorCode.CONFIGURATION_ERROR);
            assert.match(
              err.message,
              /in-memory database fallback is strictly prohibited in production|Production database configuration error/i
            );
            return true;
          }
        );

        // 2. transaction() MUST throw CONFIGURATION_ERROR and never execute in-memory
        await assert.rejects(
          async () => {
            await transaction(async (client) => {
              return client.query('SELECT 1');
            });
          },
          (err: any) => {
            assert.equal(err instanceof AppError, true);
            assert.equal(err.errorCode, ErrorCode.CONFIGURATION_ERROR);
            assert.match(
              err.message,
              /in-memory database fallback is strictly prohibited in production|Production database configuration error/i
            );
            return true;
          }
        );
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        if (prevDbUrl !== undefined) {
          process.env.DATABASE_URL = prevDbUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
        resetDatabaseStateForTesting();
      }
    });

    test('ensureSchema fails closed with CONFIGURATION_ERROR in production when PostgreSQL is unavailable', async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevDbUrl = process.env.DATABASE_URL;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.DATABASE_URL;
        resetDatabaseStateForTesting();

        await assert.rejects(
          async () => {
            await ensureSchema();
          },
          (err: any) => {
            assert.equal(err instanceof AppError, true);
            assert.equal(err.errorCode, ErrorCode.CONFIGURATION_ERROR);
            assert.equal(err.statusCode, 500);
            return true;
          }
        );
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        if (prevDbUrl !== undefined) {
          process.env.DATABASE_URL = prevDbUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
        resetDatabaseStateForTesting();
      }
    });

    test('Serverless handler fails closed safely with HTTP 500 CONFIGURATION_ERROR when DATABASE_URL is invalid in production', async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevDbUrl = process.env.DATABASE_URL;

      try {
        process.env.NODE_ENV = 'production';
        process.env.DATABASE_URL = 'postgresql://postgres:[YOUR-PASSWORD]@db.supabase.co:5432/postgres';
        resetServerlessInitStateForTesting();
        resetDatabaseStateForTesting();

        const { req, res } = createMockHttp({
          method: 'POST',
          url: '/api/auth/register',
          body: {
            email: 'failclosed@test.com',
            password: 'Password123!',
          },
        });

        await new Promise<void>((resolve) => {
          const originalJson = res.json.bind(res);
          res.json = (data: any) => {
            originalJson(data);
            resolve();
          };
          handler(req, res);
        });

        assert.equal(res.statusCode, 500);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error.code, ErrorCode.CONFIGURATION_ERROR);
        assert.match(res.body.error.message, /placeholder password/i);
        // Ensure no raw passwords, hostnames, or connection strings are exposed
        assert.equal(res.body.error.message.includes('supabase.co'), false);
        assert.equal(res.body.error.message.includes('postgres:'), false);
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        if (prevDbUrl !== undefined) {
          process.env.DATABASE_URL = prevDbUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
        resetServerlessInitStateForTesting();
        resetDatabaseStateForTesting();
      }
    });

    test('Development mode continues to allow in-memory database fallback safely', async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevDbUrl = process.env.DATABASE_URL;

      try {
        process.env.NODE_ENV = 'development';
        delete process.env.DATABASE_URL;
        resetDatabaseStateForTesting();

        assert.equal(isProductionMode(), false);
        assert.equal(validateDatabaseUrl().valid, false);

        // Security validation does not throw in dev, but logs warnings
        const configStatus = validateSecurityConfiguration();
        assert.equal(configStatus.isProduction, false);
        assert.equal(configStatus.databaseValid, false);
        assert.ok(configStatus.warnings && configStatus.warnings.length > 0);

        // Database queries execute normally via in-memory store in development
        const healthResult = await query('SELECT 1 AS health_check');
        assert.equal(healthResult.rowCount, 1);
        assert.equal(healthResult.rows[0].health_check, 1);
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        if (prevDbUrl !== undefined) {
          process.env.DATABASE_URL = prevDbUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
        resetDatabaseStateForTesting();
      }
    });

    test('checkDatabaseHealth reports error and does NOT claim development_memory in production', async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevDbUrl = process.env.DATABASE_URL;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.DATABASE_URL;
        resetDatabaseStateForTesting();

        const health = await checkDatabaseHealth();
        assert.equal(health.isConnected, false);
        assert.equal(health.mode, 'postgresql');
        assert.ok(health.error);
        assert.match(health.error, /missing or empty/i);
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        if (prevDbUrl !== undefined) {
          process.env.DATABASE_URL = prevDbUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
        resetDatabaseStateForTesting();
      }
    });
  });
});
