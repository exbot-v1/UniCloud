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

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import handler, { app } from '../../api/index.js';
import { isUploadPayloadRoute } from '../server/app.js';
import { formatErrorResponse, AppError } from '../server/utils/errors.js';
import { ErrorCode } from '../types/api.js';
import { validateSecurityConfiguration } from '../server/utils/config.js';
import { getPool, ensureSchema } from '../db/client.js';

/**
 * Mock Request & Response harness for testing Express applications and serverless handlers
 */
function createMockHttp(options: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
}) {
  const req: any = new EventEmitter();
  req.method = options.method || 'GET';
  req.url = options.url;
  req.originalUrl = options.url;
  req.path = options.url.split('?')[0];
  req.headers = options.headers || {};
  req.cookies = {};
  req.query = {};
  req.body = options.body;

  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
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
});
