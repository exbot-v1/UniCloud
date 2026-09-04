/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud API Routes Architecture (Phase 1)
 * 
 * Central API router establishing authenticated route conventions, tenant isolation,
 * error boundaries, and unified response envelopes.
 */

import { Router, Request, Response } from 'express';
import { sendApiError, AppError } from '../utils/errors.js';
import { ApiResponse, ErrorCode } from '../../types/api.js';
import { checkDatabaseHealth } from '../../db/client.js';
import { UserService } from '../services/UserService.js';
import { requireAuth, optionalAuth, SESSION_COOKIE_NAME, getSessionCookieOptions, extractSessionToken } from './middleware/auth.js';
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

    const response: ApiResponse<{
      status: string;
      version: string;
      phase: string;
      environment: string;
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
        version: '1.2.0-phase2',
        phase: 'Phase 2: Google OAuth & Real Google Drive Accounts',
        environment: process.env.NODE_ENV || 'development',
        database: {
          connected: dbHealth.isConnected,
          mode: dbHealth.mode,
          latencyMs: dbHealth.latencyMs,
          error: dbHealth.error,
        },
        serverTime: new Date().toISOString(),
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.2.0-phase2',
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
      currentPhase: 2,
      phaseName: 'Phase 2: Google OAuth & Real Google Drive Accounts',
      completedMilestones: [
        'PostgreSQL database connectivity, connection pooling, and in-memory dev engine',
        'User identity and secure password hashing (bcrypt, 12 rounds)',
        'Server-side session management with SHA-256 hashed token storage and HTTP-only cookies',
        'Authentication middleware with strict user-tenant isolation',
        'Database-backed AccountService with dynamic multi-account support (1, 10, 20+ accounts)',
        'Database-backed FileService and virtual filesystem queries',
        'Storage pool calculation dynamically querying database accounts',
        'Health check verifying database latency and connection pool status',
        'Google OAuth 2.0 flow with offline refresh_token and CSRF state token protection',
        'AES-256-GCM encryption of OAuth refresh tokens at rest with 96-bit IV and 128-bit auth tag',
        'GoogleDriveProvider with real Google Drive v3 about.get storage quota and files.list queries',
        'Multi-account support: user can link 1 to 20+ accounts without hardcoded ceilings',
        'Initial Drive metadata sync into virtual filesystem (virtual_files and virtual_folders)',
        'Secure account disconnect with upstream Google token revocation and local cleanup',
      ],
      upcomingPhases: [
        'Phase 3: Google Drive v3 API Sync & Virtual Filesystem Operations',
        'Phase 4: Resumable Chunked Upload Direct-to-Drive Engine',
        'Phase 5: Cross-Account Search, Trashing & Quota Optimization',
      ],
      architecturalGuarantees: [
        'Zero client exposure: Google OAuth tokens and password hashes NEVER reach browser JS',
        'Strict tenant isolation: All database queries enforce user_id scoping at service boundaries',
        'Stateless backend: Designed for seamless deployment to Cloud Run, Docker, and Vercel',
        'Provider agnostic: StorageProvider abstraction decoupled from Google Drive details',
      ],
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.2.0-phase2',
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
      sessionToken: string;
      expiresAt: string;
    }> = {
      success: true,
      data: {
        user: session.user,
        sessionToken: session.sessionToken,
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
      sessionToken: string;
      expiresAt: string;
    }> = {
      success: true,
      data: {
        user: session.user,
        sessionToken: session.sessionToken,
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

    res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions(req));

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
 * Resolves the appropriate Google OAuth callback URL.
 * Prioritizes GOOGLE_REDIRECT_URI, APP_URL, and dynamic request host with proto.
 */
function getGoogleRedirectUri(req: Request): string {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    return `${appUrl.replace(/\/+$/, '')}/api/accounts/google/callback`;
  }
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${protocol}://${host}/api/accounts/google/callback`;
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

apiRouter.get('/accounts/google/callback', handleGoogleOAuthCallback);
apiRouter.get('/auth/google/callback', handleGoogleOAuthCallback);

/**
 * POST /api/accounts/:id/sync
 * Triggers metadata and quota refresh for an individual connected Google Drive account.
 */
apiRouter.post('/accounts/:id/sync', requireAuth, async (req: Request, res: Response) => {
  try {
    const syncResult = await syncService.syncAccount(req.user!.id, req.params.id);
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
        version: '1.2.0-phase2',
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
 * Move virtual file to trash
 */
apiRouter.delete('/files/:id', requireAuth, async (req: Request, res: Response) => {
  try {
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
      strategy || UploadRoutingStrategy.MOST_FREE_SPACE
    );

    const response: ApiResponse<typeof decision> = {
      success: true,
      data: decision,
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
