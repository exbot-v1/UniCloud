/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud API Routes Architecture (Phase 1)
 * 
 * Central API router establishing authenticated route conventions, tenant isolation,
 * error boundaries, and unified response envelopes.
 */

import express, { Router, Request, Response } from 'express';
import { sendApiError, AppError } from '../utils/errors.js';
import { ApiResponse, ErrorCode } from '../../types/api.js';
import { checkDatabaseHealth, query } from '../../db/client.js';
import { UserService } from '../services/UserService.js';
import { requireAuth, optionalAuth, SESSION_COOKIE_NAME, getSessionCookieOptions, getClearCookieOptions, extractSessionToken } from './middleware/auth.js';
import { accountService } from '../services/AccountService.js';
import { fileService } from '../services/FileService.js';
import { storageService } from '../services/StorageService.js';
import { uploadService } from '../services/UploadService.js';
import { UploadRoutingStrategy } from '../../types/upload.js';
import { ProviderType, AccountStatus, StorageQuota } from '../../types/account.js';
import { OAuthStateService } from '../services/OAuthStateService.js';
import { syncService } from '../services/SyncService.js';
import { ProviderRegistry } from '../providers/ProviderRegistry.js';
import { GoogleDriveProvider } from '../providers/GoogleDriveProvider.js';
import { searchService } from '../services/SearchService.js';
import { logger } from '../utils/logger.js';

export const apiRouter = Router();

// =============================================================================
// 1. SYSTEM HEALTH & SPECIFICATION STATUS
// =============================================================================

/**
 * GET /api/health
 * Verifies system readiness, uptime, and database connection
 */
apiRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    const isHealthy = dbHealth.isConnected;

    const isProd = process.env.NODE_ENV === 'production';
    const safeDbError = isProd && dbHealth.error ? 'Database connection unavailable' : dbHealth.error;

    const response: ApiResponse<{
      status: string;
      version: string;
      phase: string;
      environment: string;
      runtime: string;
      database: {
        connected: boolean;
        mode: string;
        latencyMs?: number;
        error?: string;
      };
      serverTime: string;
    }> = {
      success: isHealthy,
      data: {
        status: isHealthy ? 'healthy' : 'degraded',
        version: '1.7.0-phase7',
        phase: 'Phase 7: Production & Vercel Readiness',
        environment: process.env.NODE_ENV || 'development',
        runtime: process.env.VERCEL ? 'vercel-serverless' : 'node-container',
        database: {
          connected: dbHealth.isConnected,
          mode: dbHealth.mode,
          latencyMs: dbHealth.latencyMs,
          error: safeDbError,
        },
        serverTime: new Date().toISOString(),
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.7.0-phase7',
      },
    };

    res.status(isHealthy ? 200 : 503).json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * GET /api/spec/status
 * Real architectural implementation matrix
 */
apiRouter.get('/spec/status', (_req: Request, res: Response) => {
  const response: ApiResponse<{
    currentPhase: number;
    phaseName: string;
    completedMilestones: string[];
    upcomingPhases: string[];
    architecturalGuarantees: string[];
  }> = {
    success: true,
    data: {
      currentPhase: 7,
      phaseName: 'Phase 7: Production & Vercel Readiness',
      completedMilestones: [
        'Phase 0: Architectural foundation, unified state model, responsive UI framework',
        'Phase 1: Multi-tenant PostgreSQL database engine, user auth, sessions, virtual filesystem',
        'Phase 2: Google OAuth 2.0, AES-256-GCM token encryption, Google Drive v3 quota & metadata',
        'Phase 3: Incremental delta sync via Google Drive Changes API with token recovery',
        'Phase 4: Resumable chunked upload engine, bounded memory streaming, intelligent storage routing',
        'Phase 5: Unified cross-account search, filtering, trashing, file restore, and quota rebalancing',
        'Phase 6: Transactional integrity, concurrent sync coalescing, account lifecycle hardening',
        'Phase 7: Production & Vercel deployment readiness, serverless functions entrypoint, binary chunk routing, connection storm protection, sanitized error boundaries',
      ],
      upcomingPhases: [],
      architecturalGuarantees: [
        'Zero client exposure: Google OAuth tokens, encryption keys, and database credentials NEVER reach browser',
        'Strict tenant isolation: All database queries and storage operations enforce user_id scoping at service boundaries',
        'Serverless and container dual-runtime compatibility (Vercel Functions + Cloud Run / Docker)',
        'Bounded-memory resumable uploads direct to Google Drive without intermediate disk or memory saturation',
        'Binary upload chunks isolated from JSON body parser',
        'Serverless-safe database connection pooling with connection storm mitigation',
        'Cryptographic secret masking and sanitized production error responses',
        'Stateless backend: Designed for seamless deployment to Cloud Run, Docker, and Vercel',
        'Provider agnostic: StorageProvider abstraction decoupled from Google Drive details',
      ],
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.7.0-phase7',
    },
  };
  res.json(response);
});

// =============================================================================
// 2. USER AUTHENTICATION & IDENTITY
// =============================================================================

/**
 * POST /api/auth/register
 * Register a new user with password hashing and establish a session cookie
 */
apiRouter.post('/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || !password) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Email and password are required', 400);
    }

    const session = await UserService.createUser({ email, password, displayName });

    // Set secure HTTP-only cookie
    res.cookie(SESSION_COOKIE_NAME, session.sessionToken, getSessionCookieOptions(req));

    const response: ApiResponse<{
      user: typeof session.user;
      expiresAt: string;
    }> = {
      success: true,
      data: {
        user: session.user,
        expiresAt: session.expiresAt.toISOString(),
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.2.1-phase2.1',
      },
    };

    res.status(201).json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * POST /api/auth/login
 * Authenticate existing user, set session cookie
 */
apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Email and password are required', 400);
    }

    const session = await UserService.authenticateUser({ email, password });

    // Set secure HTTP-only cookie
    res.cookie(SESSION_COOKIE_NAME, session.sessionToken, getSessionCookieOptions(req));

    const response: ApiResponse<{
      user: typeof session.user;
      expiresAt: string;
    }> = {
      success: true,
      data: {
        user: session.user,
        expiresAt: session.expiresAt.toISOString(),
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.2.1-phase2.1',
      },
    };

    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * POST /api/auth/logout
 * Invalidate session token in database and clear browser cookie
 */
apiRouter.post('/auth/logout', async (req: Request, res: Response) => {
  try {
    const token = extractSessionToken(req);
    if (token) {
      await UserService.invalidateSession(token);
    }

    res.clearCookie(SESSION_COOKIE_NAME, getClearCookieOptions(req));

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Logged out successfully' },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.2.1-phase2.1',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * GET /api/auth/me
 * Retrieve currently authenticated user profile (or null if unauthenticated)
 */
apiRouter.get('/auth/me', optionalAuth, (req: Request, res: Response) => {
  const response: ApiResponse<typeof req.user | null> = {
    success: true,
    data: req.user || null,
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.2.1-phase2.1',
    },
  };
  res.json(response);
});

// =============================================================================
// 3. STORAGE ACCOUNTS & GOOGLE OAUTH 2.0 (TENANT-ISOLATED)
// =============================================================================

/**
 * Resolves the canonical Google OAuth callback URL.
 * Uses GOOGLE_REDIRECT_URI as the production source of truth.
 * Guarantees /api/accounts/google/callback is the single canonical callback path.
 */
export function getGoogleRedirectUri(req?: Request): string {
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (configured) {
    // If GOOGLE_REDIRECT_URI points to the legacy or ambiguous /api/auth/google/callback path,
    // normalize to the canonical /api/accounts/google/callback path.
    if (configured.endsWith('/api/auth/google/callback')) {
      return configured.replace(/\/api\/auth\/google\/callback$/, '/api/accounts/google/callback');
    }
    // If configured as an origin URL (e.g. https://unicloud1.vercel.app or https://unicloud1.vercel.app/)
    if (configured.startsWith('http://') || configured.startsWith('https://')) {
      try {
        const parsed = new URL(configured);
        if (parsed.pathname === '/' || parsed.pathname === '' || parsed.pathname === '/api/auth/google/callback') {
          parsed.pathname = '/api/accounts/google/callback';
          return parsed.toString();
        }
      } catch {
        // use as-is
      }
    }
    return configured;
  }

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    return `${appUrl.replace(/\/+$/, '')}/api/accounts/google/callback`;
  }

  if (req) {
    const host = req.get('host') || 'localhost:3000';
    const protocol = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    return `${protocol}://${host}/api/accounts/google/callback`;
  }

  return 'http://localhost:3000/api/accounts/google/callback';
}

/**
 * GET /api/accounts/google/config
 * Returns OAuth readiness status and configuration parameters without exposing secrets.
 */
apiRouter.get('/accounts/google/config', (req: Request, res: Response) => {
  const isConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const redirectUri = getGoogleRedirectUri(req);

  res.json({
    success: true,
    data: {
      isConfigured,
      clientIdAvailable: Boolean(process.env.GOOGLE_CLIENT_ID),
      redirectUri,
      requiredScopes: GoogleDriveProvider.REQUIRED_SCOPES,
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.2.0-phase2',
    },
  });
});

/**
 * GET /api/accounts/google/connect
 * Initiates the Google OAuth 2.0 authorization sequence for the authenticated user.
 * Generates an unpredictable CSRF state token bound to the active user session.
 */
apiRouter.get('/accounts/google/connect', requireAuth, async (req: Request, res: Response) => {
  try {
    const redirectUri = getGoogleRedirectUri(req);
    const driveProvider = ProviderRegistry.get(ProviderType.GOOGLE_DRIVE) as GoogleDriveProvider;

    // Check configuration
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new AppError(
        ErrorCode.CONFIGURATION_ERROR,
        `Google OAuth credentials (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET) are not configured on the server. Please configure them in Settings with redirect URI: ${redirectUri}`,
        503,
        { redirectUri, requiredScopes: GoogleDriveProvider.REQUIRED_SCOPES }
      );
    }

    // Generate cryptographic, single-use state token
    const state = await OAuthStateService.createState(req.user!.id, redirectUri);
    const authUrl = driveProvider.getAuthorizationUrl(state, redirectUri);

    // Support both JSON URL delivery (for popups) and direct HTTP redirect
    const wantsJson = req.query.json === 'true' || req.headers.accept?.includes('application/json');
    if (wantsJson) {
      res.json({
        success: true,
        data: {
          url: authUrl,
          state,
          redirectUri,
        },
        meta: {
          timestamp: new Date().toISOString(),
          version: '1.2.0-phase2',
        },
      });
      return;
    }

    res.redirect(authUrl);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * GET /api/accounts/google/callback & GET /api/auth/google/callback
 * Google OAuth 2.0 redirect callback endpoint.
 * Validates state token, exchanges code for credentials, persists account in PostgreSQL,
 * runs initial metadata sync, and notifies parent window via postMessage.
 */
const handleGoogleOAuthCallback = async (req: Request, res: Response) => {
  // 1. Check for user-cancelled or denied consent
  if (req.query.error) {
    const errorMsg = String(req.query.error_description || req.query.error);
    logger.warn('Google OAuth consent denied by user', { error: errorMsg });

    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google Connection Cancelled</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0e1117; color: #f0f6fc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: #161b24; border: 1px solid #262c36; border-radius: 16px; padding: 32px; text-align: center; max-width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.6); }
          h2 { margin: 0 0 8px; color: #f87171; font-size: 18px; }
          p { margin: 0 0 16px; color: #94a3b8; font-size: 13px; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Authorization Cancelled</h2>
          <p>${errorMsg}</p>
          <p style="font-size: 12px; color: #64748b;">Closing window...</p>
        </div>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'GOOGLE_ACCOUNT_ERROR', message: ${JSON.stringify(errorMsg)} }, '*');
            setTimeout(() => window.close(), 1500);
          } else {
            setTimeout(() => { window.location.href = '/?oauth_error=' + encodeURIComponent(${JSON.stringify(errorMsg)}); }, 2000);
          }
        </script>
      </body>
      </html>
    `);
    return;
  }

  const code = req.query.code as string;
  const state = req.query.state as string;

  if (!code || !state) {
    res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Invalid OAuth Callback</title></head>
      <body style="font-family:sans-serif;background:#0e1117;color:#f87171;text-align:center;padding:50px;">
        <h2>Missing code or state parameter</h2>
        <script>setTimeout(() => window.close(), 2500);</script>
      </body>
      </html>
    `);
    return;
  }

  try {
    // 2. Validate and consume CSRF state token atomically
    const { userId, redirectUri: storedRedirectUri } = await OAuthStateService.verifyAndConsumeState(state, {
      expectedProvider: ProviderType.GOOGLE_DRIVE,
      expectedUserId: req.user?.id,
    });
    const redirectUri = storedRedirectUri || getGoogleRedirectUri(req);

    // 3. Exchange code for credentials and Google user profile
    const driveProvider = ProviderRegistry.get(ProviderType.GOOGLE_DRIVE) as GoogleDriveProvider;
    const { tokens, profile } = await driveProvider.exchangeAuthCode(code, redirectUri);

    if (!tokens.refresh_token) {
      logger.warn('Google did not return a refresh_token (prompt=consent may have been bypassed)');
    }

    // 4. Retrieve real storage quota from Drive v3 about.get
    let quota: StorageQuota = { totalBytes: 0, usedBytes: 0, freeBytes: 0, usagePercentage: 0 };
    if (tokens.access_token) {
      try {
        quota = await driveProvider.getStorageQuota(tokens.access_token);
      } catch (err: any) {
        logger.warn('Initial quota query during OAuth callback encountered error', { error: err.message });
      }
    }

    // 5. Connect or update account in PostgreSQL with AES-256-GCM encryption
    const { account, isNew } = await accountService.connectOrUpdateAccount({
      userId,
      provider: ProviderType.GOOGLE_DRIVE,
      providerAccountId: profile.id,
      email: profile.email,
      displayName: profile.name,
      avatarUrl: profile.avatarUrl,
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
      quota,
    });

    // 6. Perform initial metadata synchronization (non-blocking if slow)
    try {
      await syncService.syncAccount(userId, account.id);
    } catch (syncErr: any) {
      logger.warn('Initial metadata sync encountered non-fatal error', { error: syncErr.message });
    }

    logger.info(`Successfully linked Google Drive account ${profile.email} (${isNew ? 'New' : 'Updated'}) for user ${userId}`);

    // 7. Render success HTML and dispatch postMessage to opener
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google Drive Connected</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0e1117; color: #f0f6fc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: #161b24; border: 1px solid #262c36; border-radius: 16px; padding: 32px; text-align: center; max-width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.6); }
          .icon { height: 48px; width: 48px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 14px; display: inline-flex; align-items: center; justify-content: center; color: #34d399; font-size: 24px; margin-bottom: 16px; }
          h2 { margin: 0 0 8px; color: #ffffff; font-size: 18px; font-weight: 700; }
          p { margin: 0 0 16px; color: #94a3b8; font-size: 13px; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✓</div>
          <h2>Account Connected!</h2>
          <p><strong>${account.email}</strong> is now securely linked to your UniCloud virtual pool.</p>
          <p style="font-size: 12px; color: #38bdf8;">Completing connection...</p>
        </div>
        <script>
          const payload = {
            type: 'GOOGLE_ACCOUNT_CONNECTED',
            account: ${JSON.stringify(account)}
          };
          if (window.opener) {
            window.opener.postMessage(payload, '*');
            setTimeout(() => window.close(), 1200);
          } else {
            setTimeout(() => { window.location.href = '/?oauth_success=true&email=' + encodeURIComponent(${JSON.stringify(account.email)}); }, 1500);
          }
        </script>
      </body>
      </html>
    `);
  } catch (err: any) {
    logger.error('Google OAuth callback handler failure', { error: err.message });
    const errorMessage = err.message || 'OAuth authentication sequence failed';
    const statusCode = err instanceof AppError ? err.statusCode : 400;

    res.status(statusCode).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Connection Error</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0e1117; color: #f0f6fc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: #161b24; border: 1px solid #262c36; border-radius: 16px; padding: 32px; text-align: center; max-width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.6); }
          h2 { margin: 0 0 8px; color: #f87171; font-size: 18px; }
          p { margin: 0 0 16px; color: #94a3b8; font-size: 13px; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Connection Error</h2>
          <p>${errorMessage}</p>
          <p style="font-size: 12px; color: #64748b;">Closing window...</p>
        </div>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'GOOGLE_ACCOUNT_ERROR', message: ${JSON.stringify(errorMessage)} }, '*');
            setTimeout(() => window.close(), 3000);
          } else {
            setTimeout(() => { window.location.href = '/?oauth_error=' + encodeURIComponent(${JSON.stringify(errorMessage)}); }, 3500);
          }
        </script>
      </body>
      </html>
    `);
  }
};

// Canonical Google OAuth callback endpoint
apiRouter.get('/accounts/google/callback', handleGoogleOAuthCallback);

// Disambiguation: permanently redirect legacy /api/auth/google/callback to canonical /api/accounts/google/callback
apiRouter.get('/auth/google/callback', (req: Request, res: Response) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/api/accounts/google/callback${query}`);
});

/**
 * POST /api/accounts/:id/sync
 * Triggers metadata and quota refresh for an individual connected Google Drive account.
 * Supports mode: 'delta' | 'full'. Defaults to delta sync when change token is established.
 */
apiRouter.post('/accounts/:id/sync', requireAuth, async (req: Request, res: Response) => {
  try {
    const mode = req.body?.mode || req.query?.mode;
    let syncResult;

    if (mode === 'full') {
      syncResult = await syncService.syncAccount(req.user!.id, req.params.id);
    } else if (mode === 'delta') {
      syncResult = await syncService.syncDelta(req.user!.id, req.params.id);
    } else {
      // Default: if change token exists, run incremental delta sync; otherwise run full sync
      const token = await accountService.getChangeToken(req.user!.id, req.params.id);
      if (token) {
        syncResult = await syncService.syncDelta(req.user!.id, req.params.id);
      } else {
        syncResult = await syncService.syncAccount(req.user!.id, req.params.id);
      }
    }

    const updatedAccount = await accountService.getAccountById(req.user!.id, req.params.id);
    const pool = await storageService.getStoragePoolForUser(req.user!.id);

    const response: ApiResponse<{
      syncResult: typeof syncResult;
      account: typeof updatedAccount;
      pool: typeof pool;
    }> = {
      success: true,
      data: {
        syncResult,
        account: updatedAccount,
        pool,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.3.0-phase3',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * POST /api/accounts/:id/sync/delta
 * Explicit endpoint for Phase 3 incremental delta synchronization via Google Drive Changes API.
 */
apiRouter.post('/accounts/:id/sync/delta', requireAuth, async (req: Request, res: Response) => {
  try {
    const syncResult = await syncService.syncDelta(req.user!.id, req.params.id);
    const updatedAccount = await accountService.getAccountById(req.user!.id, req.params.id);
    const pool = await storageService.getStoragePoolForUser(req.user!.id);

    const response: ApiResponse<{
      syncResult: typeof syncResult;
      account: typeof updatedAccount;
      pool: typeof pool;
    }> = {
      success: true,
      data: {
        syncResult,
        account: updatedAccount,
        pool,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.3.0-phase3',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * POST /api/accounts/:id/token/init
 * Establishes an initial Google Drive change token for an existing connected account.
 */
apiRouter.post('/accounts/:id/token/init', requireAuth, async (req: Request, res: Response) => {
  try {
    const token = await syncService.establishInitialToken(req.user!.id, req.params.id);
    const updatedAccount = await accountService.getAccountById(req.user!.id, req.params.id);

    const response: ApiResponse<{
      changeToken: string;
      account: typeof updatedAccount;
    }> = {
      success: true,
      data: {
        changeToken: token,
        account: updatedAccount,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.3.0-phase3',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * GET /api/accounts/:id/sync/history
 * Returns sync audit history records for an account (including full, delta, and recovery runs).
 */
apiRouter.get('/accounts/:id/sync/history', requireAuth, async (req: Request, res: Response) => {
  try {
    // Verify ownership
    await accountService.getAccountById(req.user!.id, req.params.id);

    const historyResult = await query(
      `SELECT * FROM sync_history 
       WHERE storage_account_id = $1 AND user_id = $2 
       ORDER BY started_at DESC LIMIT 50`,
      [req.params.id, req.user!.id]
    );

    const response: ApiResponse<any[]> = {
      success: true,
      data: historyResult.rows,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.3.0-phase3',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

// =============================================================================
// STORAGE ACCOUNTS CRUD (TENANT-ISOLATED)
// =============================================================================

/**
 * GET /api/accounts
 * Retrieve connected storage accounts for authenticated user
 */
apiRouter.get('/accounts', requireAuth, async (req: Request, res: Response) => {
  try {
    const accounts = await accountService.getAccountsForUser(req.user!.id);
    const response: ApiResponse<typeof accounts> = {
      success: true,
      data: accounts,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.1.0-phase1',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * GET /api/accounts/:id
 * Retrieve single account by ID
 */
apiRouter.get('/accounts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const account = await accountService.getAccountById(req.user!.id, req.params.id);
    const response: ApiResponse<typeof account> = {
      success: true,
      data: account,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.1.0-phase1',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * DELETE /api/accounts/:id
 * Disconnect an account
 */
apiRouter.delete('/accounts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    await accountService.disconnectAccount(req.user!.id, req.params.id);
    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: `Account ${req.params.id} disconnected` },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.1.0-phase1',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * PATCH /api/accounts/:id/enable
 * Storage Lifecycle management: toggles enabled/disabled state of a connected account.
 */
apiRouter.patch('/accounts/:id/enable', requireAuth, async (req: Request, res: Response) => {
  try {
    const isEnabled = req.body?.isEnabled !== undefined ? Boolean(req.body.isEnabled) : undefined;
    const account = await accountService.toggleAccountEnabled(req.user!.id, req.params.id, isEnabled);
    const response: ApiResponse<typeof account> = {
      success: true,
      data: account,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.5.0-phase5',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * GET /api/storage/pool & GET /api/storage
 * Aggregated virtual pool summary computed from PostgreSQL
 */
const getStoragePoolHandler = async (req: Request, res: Response) => {
  try {
    const pool = await storageService.getStoragePoolForUser(req.user!.id);
    const response: ApiResponse<typeof pool> = {
      success: true,
      data: pool,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.1.0-phase1',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
};

apiRouter.get('/storage', requireAuth, getStoragePoolHandler);
apiRouter.get('/storage/pool', requireAuth, getStoragePoolHandler);

// =============================================================================
// 4. VIRTUAL FILESYSTEM (TENANT-ISOLATED)
// =============================================================================

/**
 * GET /api/files
 * List virtual files and folders for authenticated user
 */
apiRouter.get('/files', requireAuth, async (req: Request, res: Response) => {
  try {
    const folderId = req.query.folderId ? String(req.query.folderId) : null;
    const starredOnly = req.query.starredOnly === 'true';
    const trashedOnly = req.query.trashedOnly === 'true';
    const storageAccountId = req.query.storageAccountId ? String(req.query.storageAccountId) : undefined;
    const searchQuery = req.query.search ? String(req.query.search) : undefined;

    const [files, folders] = await Promise.all([
      fileService.getFilesInFolder(req.user!.id, folderId, {
        starredOnly,
        trashedOnly,
        storageAccountId,
        searchQuery,
      }),
      fileService.getFoldersInFolder(req.user!.id, folderId),
    ]);

    const response: ApiResponse<{ files: typeof files; folders: typeof folders }> = {
      success: true,
      data: { files, folders },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.1.0-phase1',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * GET /api/files/:id
 * Retrieve single virtual file metadata
 */
apiRouter.get('/files/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const file = await fileService.getFileById(req.user!.id, req.params.id);
    const response: ApiResponse<typeof file> = {
      success: true,
      data: file,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.1.0-phase1',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * PATCH /api/files/:id/star
 * Toggle starred status on virtual file
 */
apiRouter.patch('/files/:id/star', requireAuth, async (req: Request, res: Response) => {
  try {
    const isStarred = await fileService.toggleStarred(req.user!.id, req.params.id);
    const response: ApiResponse<{ isStarred: boolean }> = {
      success: true,
      data: { isStarred },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.1.0-phase1',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * DELETE /api/files/:id
 * Move virtual file to trash (or permanent delete if ?permanent=true)
 */
apiRouter.delete('/files/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const permanent = req.query.permanent === 'true';
    if (permanent) {
      await fileService.deleteFilePermanent(req.user!.id, req.params.id);
      const response: ApiResponse<{ message: string }> = {
        success: true,
        data: { message: `File ${req.params.id} permanently deleted` },
        meta: {
          timestamp: new Date().toISOString(),
          version: '1.5.0-phase5',
        },
      };
      return res.json(response);
    }

    await fileService.moveToTrash(req.user!.id, req.params.id);
    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: `File ${req.params.id} moved to trash` },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.1.0-phase1',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * PATCH /api/files/:id/rename
 * Renames a virtual file and propagates upstream to the owning Drive account.
 */
apiRouter.patch('/files/:id/rename', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    const file = await fileService.renameFile(req.user!.id, req.params.id, name);
    const response: ApiResponse<typeof file> = {
      success: true,
      data: file,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.5.0-phase5',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * POST /api/files/:id/restore
 * Restores a file from trash.
 */
apiRouter.post('/files/:id/restore', requireAuth, async (req: Request, res: Response) => {
  try {
    const file = await fileService.restoreFile(req.user!.id, req.params.id);
    const response: ApiResponse<typeof file> = {
      success: true,
      data: file,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.5.0-phase5',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * DELETE /api/files/:id/permanent
 * Permanently deletes a virtual file and purges it from Google Drive.
 */
apiRouter.delete('/files/:id/permanent', requireAuth, async (req: Request, res: Response) => {
  try {
    await fileService.deleteFilePermanent(req.user!.id, req.params.id);
    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: `File ${req.params.id} permanently deleted` },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.5.0-phase5',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * POST /api/files/:id/move
 * Moves a file to another folder or across accounts.
 */
apiRouter.post('/files/:id/move', requireAuth, async (req: Request, res: Response) => {
  try {
    const { targetFolderId, targetAccountId } = req.body;
    const file = await fileService.moveFile(req.user!.id, req.params.id, {
      targetFolderId,
      targetAccountId,
    });
    const response: ApiResponse<typeof file> = {
      success: true,
      data: file,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.5.0-phase5',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * POST /api/files/:id/copy
 * Copies a file to another folder or across accounts.
 */
apiRouter.post('/files/:id/copy', requireAuth, async (req: Request, res: Response) => {
  try {
    const { newName, targetFolderId, targetAccountId } = req.body;
    const file = await fileService.copyFile(req.user!.id, req.params.id, {
      newName,
      targetFolderId,
      targetAccountId,
    });
    const response: ApiResponse<typeof file> = {
      success: true,
      data: file,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.5.0-phase5',
      },
    };
    res.status(201).json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * POST /api/folders
 * Creates a virtual folder backed by storage account / Drive folder.
 */
apiRouter.post('/folders', requireAuth, async (req: Request, res: Response) => {
  try {
    const folder = await fileService.createFolder(req.user!.id, req.body);
    const response: ApiResponse<typeof folder> = {
      success: true,
      data: folder,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.5.0-phase5',
      },
    };
    res.status(201).json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * PATCH /api/folders/:id/rename
 * Renames a virtual folder.
 */
apiRouter.patch('/folders/:id/rename', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    const folder = await fileService.renameFolder(req.user!.id, req.params.id, name);
    const response: ApiResponse<typeof folder> = {
      success: true,
      data: folder,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.5.0-phase5',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * DELETE /api/folders/:id
 * Trashes or permanently deletes a virtual folder.
 */
apiRouter.delete('/folders/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const permanent = req.query.permanent === 'true';
    if (permanent) {
      await fileService.deleteFolderPermanent(req.user!.id, req.params.id);
      const response: ApiResponse<{ message: string }> = {
        success: true,
        data: { message: `Folder ${req.params.id} permanently deleted` },
        meta: {
          timestamp: new Date().toISOString(),
          version: '1.5.0-phase5',
        },
      };
      return res.json(response);
    }

    const folder = await fileService.trashFolder(req.user!.id, req.params.id);
    const response: ApiResponse<typeof folder> = {
      success: true,
      data: folder,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.5.0-phase5',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * POST /api/folders/:id/restore
 * Restores a trashed folder.
 */
apiRouter.post('/folders/:id/restore', requireAuth, async (req: Request, res: Response) => {
  try {
    const folder = await fileService.restoreFolder(req.user!.id, req.params.id);
    const response: ApiResponse<typeof folder> = {
      success: true,
      data: folder,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.5.0-phase5',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * GET /api/search
 * Unified cross-account virtual filesystem search.
 */
apiRouter.get('/search', requireAuth, async (req: Request, res: Response) => {
  try {
    const queryStr = req.query.q !== undefined ? String(req.query.q) : (req.query.query !== undefined ? String(req.query.query) : undefined);
    const folderId = req.query.folderId !== undefined ? (req.query.folderId === '' || req.query.folderId === 'root' ? null : String(req.query.folderId)) : undefined;
    const storageAccountId = req.query.storageAccountId ? String(req.query.storageAccountId) : undefined;
    const mimeType = req.query.mimeType ? String(req.query.mimeType) : undefined;
    const isStarred = req.query.isStarred !== undefined ? req.query.isStarred === 'true' : undefined;
    const isTrashed = req.query.isTrashed !== undefined ? req.query.isTrashed === 'true' : undefined;
    const sortBy = (req.query.sortBy as any) || undefined;
    const sortOrder = (req.query.sortOrder as any) || undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : (req.query.pageSize ? Number(req.query.pageSize) : undefined);

    const searchResult = await searchService.search(req.user!.id, {
      query: queryStr,
      folderId,
      storageAccountId,
      mimeType,
      isStarred,
      isTrashed,
      sortBy,
      sortOrder,
      page,
      limit,
    });

    const response: ApiResponse<typeof searchResult> = {
      success: true,
      data: searchResult,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.5.0-phase5',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

// =============================================================================
// 5. UPLOAD ROUTING PREVIEW (SUPPORTING REAL & DEMO ACCOUNTS)
// =============================================================================

/**
 * POST /api/upload/route-check
 * Evaluates best storage destination based on free bytes and strategy
 */
apiRouter.post('/upload/route-check', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { sizeBytes, strategy } = req.body;
    if (!sizeBytes || typeof sizeBytes !== 'number' || sizeBytes <= 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'sizeBytes must be a positive number', 400);
    }

    let accounts: any[] = [];
    if (req.user) {
      accounts = await accountService.getAccountsForUser(req.user.id);
    }

    // Fallback to sample accounts if user has 0 connected accounts yet,
    // ensuring the interactive routing simulation continues to function
    if (accounts.length === 0) {
      accounts = [
        {
          id: 'demo-acc-1',
          userId: 'demo-user',
          provider: ProviderType.GOOGLE_DRIVE,
          providerAccountId: 'google-demo-1',
          email: 'demo.drive1@gmail.com',
          displayName: 'Demo Drive 01',
          status: AccountStatus.ACTIVE,
          tokenExpiresAt: null,
          quota: {
            totalBytes: 15 * 1024 * 1024 * 1024,
            usedBytes: 10.4 * 1024 * 1024 * 1024,
            freeBytes: 4.6 * 1024 * 1024 * 1024,
            usagePercentage: 69.3,
          },
          lastSyncedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'demo-acc-2',
          userId: 'demo-user',
          provider: ProviderType.GOOGLE_DRIVE,
          providerAccountId: 'google-demo-2',
          email: 'demo.drive2@gmail.com',
          displayName: 'Demo Drive 02',
          status: AccountStatus.ACTIVE,
          tokenExpiresAt: null,
          quota: {
            totalBytes: 15 * 1024 * 1024 * 1024,
            usedBytes: 6.2 * 1024 * 1024 * 1024,
            freeBytes: 8.8 * 1024 * 1024 * 1024,
            usagePercentage: 41.3,
          },
          lastSyncedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'demo-acc-3',
          userId: 'demo-user',
          provider: ProviderType.GOOGLE_DRIVE,
          providerAccountId: 'google-demo-3',
          email: 'demo.drive3@gmail.com',
          displayName: 'Demo Drive 03',
          status: AccountStatus.ACTIVE,
          tokenExpiresAt: null,
          quota: {
            totalBytes: 15 * 1024 * 1024 * 1024,
            usedBytes: 13.8 * 1024 * 1024 * 1024,
            freeBytes: 1.2 * 1024 * 1024 * 1024,
            usagePercentage: 92.0,
          },
          lastSyncedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
    }

    const decision = uploadService.evaluateRouting(
      accounts,
      sizeBytes,
      strategy || UploadRoutingStrategy.MOST_FREE_SPACE,
      req.body.preferredAccountId
    );

    const response: ApiResponse<typeof decision> = {
      success: true,
      data: decision,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.4.0-phase4',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

// =============================================================================
// 6. PHASE 4 RESUMABLE UPLOADS & UPLOAD ROUTING
// =============================================================================

/**
 * POST /api/upload/initiate
 * Evaluates routing, establishes Google Drive resumable session, and persists upload job.
 */
apiRouter.post('/upload/initiate', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = await uploadService.initiateUpload(req.user!.id, req.body);
    const response: ApiResponse<typeof job> = {
      success: true,
      data: job,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.4.0-phase4',
      },
    };
    res.status(201).json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * PUT /api/upload/:jobId/chunk
 * Streams/chunks binary data directly to Google Drive upstream session.
 * Updates byte progress and finalizes virtual file mapping on completion.
 */
apiRouter.put(
  '/upload/:jobId/chunk',
  requireAuth,
  express.raw({ type: () => true, limit: '50mb' }),
  async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const contentRange = req.headers['content-range'] as string | undefined;
      const chunkBuffer = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body || '');

      const result = await uploadService.uploadChunk(
        req.user!.id,
        jobId,
        chunkBuffer,
        contentRange
      );

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          version: '1.4.0-phase4',
        },
      };
      res.json(response);
    } catch (err) {
      sendApiError(res, err);
    }
  }
);

/**
 * POST /api/upload/stream
 * Direct streaming upload for large files without buffering entire file in memory.
 */
apiRouter.post('/upload/stream', requireAuth, async (req: Request, res: Response) => {
  try {
    const fileName =
      (req.query.fileName as string) ||
      (req.headers['x-file-name'] as string) ||
      'upload.bin';
    const mimeType =
      (req.query.mimeType as string) ||
      (req.headers['content-type'] as string) ||
      'application/octet-stream';
    const sizeBytes = Number(req.query.sizeBytes || req.headers['content-length'] || 0);
    const targetFolderId = (req.query.targetFolderId as string) || undefined;
    const strategy = (req.query.strategy as UploadRoutingStrategy) || undefined;
    const preferredAccountId = (req.query.preferredAccountId as string) || undefined;

    if (!sizeBytes || sizeBytes <= 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Content-Length header or sizeBytes query parameter required.',
        400
      );
    }

    const job = await uploadService.initiateUpload(req.user!.id, {
      fileName,
      mimeType,
      sizeBytes,
      targetFolderId,
      strategy,
      preferredAccountId,
    });

    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB buffer chunks
    let buffer = Buffer.alloc(0);
    let bytesUploaded = 0;
    let lastResult: any = null;

    for await (const data of req) {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= CHUNK_SIZE && bytesUploaded + CHUNK_SIZE <= sizeBytes) {
        const chunk = buffer.subarray(0, CHUNK_SIZE);
        buffer = buffer.subarray(CHUNK_SIZE);
        const start = bytesUploaded;
        const end = start + chunk.length - 1;
        lastResult = await uploadService.uploadChunk(
          req.user!.id,
          job.id,
          chunk,
          `bytes ${start}-${end}/${sizeBytes}`
        );
        bytesUploaded += chunk.length;
      }
    }

    if (buffer.length > 0 || bytesUploaded < sizeBytes) {
      const start = bytesUploaded;
      const end = start + buffer.length - 1;
      lastResult = await uploadService.uploadChunk(
        req.user!.id,
        job.id,
        buffer,
        `bytes ${start}-${end}/${sizeBytes}`
      );
    }

    const response: ApiResponse<typeof lastResult> = {
      success: true,
      data: lastResult || job,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.4.0-phase4',
      },
    };
    res.status(201).json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * GET /api/upload/:jobId/status
 * Queries the current progress and status of an upload job.
 */
apiRouter.get('/upload/:jobId/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = await uploadService.getJobStatus(req.user!.id, req.params.jobId);
    const response: ApiResponse<typeof job> = {
      success: true,
      data: job,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.4.0-phase4',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * POST /api/upload/:jobId/abort
 * Cancels an upload job without corrupting the virtual filesystem.
 */
apiRouter.post('/upload/:jobId/abort', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = await uploadService.abortUpload(req.user!.id, req.params.jobId);
    const response: ApiResponse<typeof job> = {
      success: true,
      data: job,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.4.0-phase4',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * POST /api/upload/:jobId/retry
 * Attempts session recovery or re-initialization of an interrupted upload.
 */
apiRouter.post('/upload/:jobId/retry', requireAuth, async (req: Request, res: Response) => {
  try {
    const job = await uploadService.retryUpload(req.user!.id, req.params.jobId);
    const response: ApiResponse<typeof job> = {
      success: true,
      data: job,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.4.0-phase4',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

/**
 * GET /api/upload/jobs
 * Lists recent upload jobs for the authenticated user.
 */
apiRouter.get('/upload/jobs', requireAuth, async (req: Request, res: Response) => {
  try {
    const jobs = await uploadService.listJobs(req.user!.id, 25);
    const response: ApiResponse<typeof jobs> = {
      success: true,
      data: jobs,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.4.0-phase4',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});
