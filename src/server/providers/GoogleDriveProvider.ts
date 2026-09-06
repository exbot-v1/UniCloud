/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud GoogleDriveProvider (Phase 2 Implementation)
 * 
 * Implements real Google OAuth 2.0 authentication, quota inspection via Drive v3 about.get,
 * metadata listing via files.list, and token lifecycle management.
 * 
 * SECURITY MANDATE:
 * Tokens and client secrets are never exposed to browser or logged in plaintext.
 */

import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { ProviderType, StorageQuota } from '../../types/account.js';
import {
  StorageProvider,
  ProviderFileMetadata,
  ProviderFileListOptions,
  ProviderFileListResult,
  ProviderChangeItem,
  ProviderChangeListOptions,
  ProviderChangeListResult,
  ResumableUploadSession,
  ProviderHealthCheckResult,
} from '../../types/provider.js';
import { AppError } from '../utils/errors.js';
import { ErrorCode } from '../../types/api.js';
import { logger } from '../utils/logger.js';

/**
 * Detects whether an error returned from Google Drive Changes API represents
 * an invalid, expired, or non-existent change token.
 */
export function isInvalidPageTokenError(err: any): boolean {
  if (!err) return false;
  const message = String(err.message || '').toLowerCase();
  const status = err.status || err.statusCode || (err.response && err.response.status);

  if (status === 404 || status === 410) {
    return true;
  }
  if (status === 400 && (
    message.includes('token') ||
    message.includes('page') ||
    message.includes('invalid') ||
    message.includes('expired')
  )) {
    return true;
  }
  if (
    message.includes('startpagetoken') ||
    message.includes('invalidpagetoken') ||
    message.includes('token expired') ||
    message.includes('page token expired') ||
    message.includes('token has expired') ||
    message.includes('invalid change token')
  ) {
    return true;
  }
  const errors = err.errors || (err.response && err.response.data && err.response.data.error && err.response.data.error.errors);
  if (Array.isArray(errors)) {
    for (const e of errors) {
      const reason = String(e.reason || '').toLowerCase();
      if (
        reason === 'startpagetokenexpired' ||
        reason === 'invalidpagetoken' ||
        reason === 'locationnotexists' ||
        reason === 'notfound'
      ) {
        return true;
      }
    }
  }
  return false;
}

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export class GoogleDriveProvider implements StorageProvider {
  public readonly providerType = ProviderType.GOOGLE_DRIVE;

  /**
   * Narrowest Google OAuth scopes required for UniCloud multi-account storage pooling
   * and virtual filesystem metadata synchronization.
   */
  public static readonly REQUIRED_SCOPES = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/drive.file',
  ];

  /**
   * Instantiates Google OAuth2 client from server environment variables.
   * Throws configuration error if credentials have not been configured.
   */
  public getOAuth2Client(redirectUri?: string): OAuth2Client {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new AppError(
        ErrorCode.CONFIGURATION_ERROR,
        'Google OAuth credentials (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET) must be configured in environment variables to link live Google accounts.',
        503
      );
    }

    const configured = process.env.GOOGLE_REDIRECT_URI?.trim();
    let defaultRedirect = 'http://localhost:3000/api/accounts/google/callback';
    if (configured) {
      if (configured.endsWith('/api/auth/google/callback')) {
        defaultRedirect = configured.replace(/\/api\/auth\/google\/callback$/, '/api/accounts/google/callback');
      } else {
        defaultRedirect = configured;
      }
    } else if (process.env.APP_URL) {
      defaultRedirect = `${process.env.APP_URL.replace(/\/+$/, '')}/api/accounts/google/callback`;
    }

    const effectiveRedirect = (redirectUri && redirectUri.endsWith('/api/auth/google/callback'))
      ? redirectUri.replace(/\/api\/auth\/google\/callback$/, '/api/accounts/google/callback')
      : (redirectUri || defaultRedirect);

    return new google.auth.OAuth2(clientId, clientSecret, effectiveRedirect);
  }

  /**
   * Generates the Google OAuth 2.0 consent authorization URL.
   * Requires offline access and consent prompt to guarantee a refresh_token is returned.
   */
  public getAuthorizationUrl(state: string, redirectUri?: string): string {
    const client = this.getOAuth2Client(redirectUri);
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GoogleDriveProvider.REQUIRED_SCOPES,
      state,
      include_granted_scopes: true,
    });
  }

  /**
   * Exchanges an authorization code for tokens and fetches the Google user profile.
   */
  public async exchangeAuthCode(
    code: string,
    redirectUri?: string
  ): Promise<{
    tokens: any;
    profile: {
      id: string;
      email: string;
      name: string | null;
      avatarUrl: string | null;
    };
  }> {
    const client = this.getOAuth2Client(redirectUri);

    try {
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      const oauth2 = google.oauth2({ version: 'v2', auth: client as any });
      const userinfoRes = await oauth2.userinfo.get();
      const info = userinfoRes.data;

      if (!info.id || !info.email) {
        throw new AppError(
          ErrorCode.OAUTH_ERROR,
          'Failed to retrieve essential Google account identity (email/id) during OAuth exchange.',
          400
        );
      }

      return {
        tokens,
        profile: {
          id: info.id,
          email: info.email,
          name: info.name || null,
          avatarUrl: info.picture || null,
        },
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error('Google OAuth exchange error', { error: err.message });
      throw new AppError(
        ErrorCode.OAUTH_ERROR,
        `Google authorization exchange failed: ${err.message}`,
        400
      );
    }
  }

  /**
   * Validates or refreshes access credentials using the account's refresh_token.
   */
  async refreshAuthentication(
    refreshToken: string
  ): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const client = this.getOAuth2Client();
    client.setCredentials({ refresh_token: refreshToken });

    try {
      const { credentials } = await client.refreshAccessToken();
      const accessToken = credentials.access_token;
      if (!accessToken) {
        throw new AppError(ErrorCode.TOKEN_EXPIRED, 'Google did not return an access token.');
      }

      // Default Google access token lifespan is 3600 seconds (1 hour)
      const expiresInSeconds = credentials.expiry_date
        ? Math.max(60, Math.floor((credentials.expiry_date - Date.now()) / 1000))
        : 3600;

      return { accessToken, expiresInSeconds };
    } catch (err: any) {
      logger.error('Failed to refresh Google OAuth token', { error: err.message });
      throw new AppError(
        ErrorCode.TOKEN_EXPIRED,
        `Failed to refresh Google Drive access token: ${err.message}`,
        401
      );
    }
  }

  /**
   * Queries Google Drive v3 `about.get` endpoint for real storage quota.
   */
  async getStorageQuota(accessToken: string): Promise<StorageQuota> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });

    const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: client as any });

    try {
      const res = await drive.about.get({
        fields: 'storageQuota,user',
      });

      const quota = res.data.storageQuota;
      if (!quota) {
        throw new AppError(ErrorCode.PROVIDER_ERROR, 'Google Drive API did not return storageQuota fields.');
      }

      // Note: limit can be missing for unlimited Google Workspace accounts
      const totalBytes = quota.limit ? Number(quota.limit) : 0;
      const usedBytes = quota.usage ? Number(quota.usage) : 0;
      const freeBytes = totalBytes > 0 ? Math.max(0, totalBytes - usedBytes) : 0;
      const usagePercentage = totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0;

      return {
        totalBytes,
        usedBytes,
        freeBytes,
        usagePercentage,
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error('Failed to fetch Google Drive storage quota', { error: err.message });
      throw new AppError(
        ErrorCode.PROVIDER_ERROR,
        `Google Drive quota query failed: ${err.message}`,
        502
      );
    }
  }

  /**
   * Instantiates Google Drive v3 client from authenticated OAuth2 client.
   * Overridable in test suites for Google API boundary mocking.
   */
  protected getDriveClient(client: any): drive_v3.Drive {
    return google.drive({ version: 'v3', auth: client });
  }

  /**
   * Queries Google Drive v3 `files.list` endpoint for file and folder metadata.
   */
  async listFiles(accessToken: string, options?: ProviderFileListOptions): Promise<ProviderFileListResult> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });

    const drive: drive_v3.Drive = this.getDriveClient(client);

    try {
      // Build query string
      const qParts: string[] = [];

      if (options?.includeTrashed) {
        // Include both or only trashed
      } else {
        qParts.push('trashed = false');
      }

      if (options?.folderId) {
        qParts.push(`'${options.folderId}' in parents`);
      }

      if (options?.query) {
        qParts.push(`name contains '${options.query.replace(/'/g, "\\'")}'`);
      }

      const q = qParts.length > 0 ? qParts.join(' and ') : undefined;
      const shouldFetchAllPages = options?.fetchAllPages ?? true;
      const maxPages = options?.maxPages || 100;
      const pageSize = Math.min(options?.pageSize || 100, 100);

      const allFiles: ProviderFileMetadata[] = [];
      let currentPageToken: string | undefined = options?.pageToken;
      let pageCount = 0;

      do {
        const res = await drive.files.list({
          q,
          pageSize,
          pageToken: currentPageToken,
          fields: 'nextPageToken, files(id, name, mimeType, size, parents, createdTime, modifiedTime, webViewLink, iconLink, md5Checksum, trashed, starred)',
          orderBy: 'folder,modifiedTime desc',
        });

        const pageFiles: ProviderFileMetadata[] = (res.data.files || []).map((f) => ({
          providerFileId: f.id || '',
          name: f.name || 'Untitled',
          mimeType: f.mimeType || 'application/octet-stream',
          sizeBytes: f.size ? Number(f.size) : 0,
          parentFolderId: f.parents && f.parents.length > 0 ? f.parents[0] : null,
          isFolder: f.mimeType === 'application/vnd.google-apps.folder',
          webUrl: f.webViewLink || undefined,
          md5Checksum: f.md5Checksum || undefined,
          isStarred: Boolean(f.starred),
          isTrashed: Boolean(f.trashed),
          createdAt: f.createdTime || new Date().toISOString(),
          modifiedAt: f.modifiedTime || new Date().toISOString(),
        }));

        allFiles.push(...pageFiles);
        currentPageToken = res.data.nextPageToken || undefined;
        pageCount++;

        // If caller explicitly requested only a single page, stop after one page
        if (!shouldFetchAllPages) {
          break;
        }
      } while (currentPageToken && pageCount < maxPages);

      // Pagination is complete when all pages have been visited and no nextPageToken remains.
      // If multi-page fetching was disabled (fetchAllPages: false) or pagination stopped due to maxPages with remaining items,
      // paginationComplete is false to prevent treating partial results as full-drive reconciliation.
      const paginationComplete = shouldFetchAllPages ? !currentPageToken : false;

      return {
        files: allFiles,
        nextPageToken: currentPageToken,
        paginationComplete,
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error('Failed to list Google Drive files', { error: err.message });
      throw new AppError(
        ErrorCode.PROVIDER_ERROR,
        `Google Drive files query failed: ${err.message}`,
        502
      );
    }
  }

  /**
   * Retrieves current start page token from Google Drive v3 `changes.getStartPageToken` (Phase 3)
   * used as baseline for future incremental changes tracking.
   */
  async getStartPageToken(accessToken: string): Promise<string> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });

    const drive: drive_v3.Drive = this.getDriveClient(client);

    try {
      const res = await drive.changes.getStartPageToken({
        supportsAllDrives: false,
      });

      const token = res.data.startPageToken;
      if (!token) {
        throw new AppError(
          ErrorCode.PROVIDER_ERROR,
          'Google Drive API did not return a startPageToken.',
          502
        );
      }

      return token;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error('Failed to get Google Drive start page token', { error: err.message });
      throw new AppError(
        ErrorCode.PROVIDER_ERROR,
        `Google Drive getStartPageToken failed: ${err.message}`,
        502
      );
    }
  }

  /**
   * Queries Google Drive v3 `changes.list` for incremental changes using a change/page token (Phase 3).
   * Paginates through all available change pages and captures newStartPageToken.
   */
  async listChanges(accessToken: string, options: ProviderChangeListOptions): Promise<ProviderChangeListResult> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });

    const drive: drive_v3.Drive = this.getDriveClient(client);

    try {
      const pageSize = Math.min(options.pageSize || 100, 100);
      const maxPages = options.maxPages || 100;
      const allChanges: ProviderChangeItem[] = [];
      let currentPageToken: string | undefined = options.pageToken;
      let newStartPageToken: string | undefined;
      let pageCount = 0;

      do {
        const res = await drive.changes.list({
          pageToken: currentPageToken,
          pageSize,
          fields: 'nextPageToken, newStartPageToken, changes(fileId, removed, time, file(id, name, mimeType, size, parents, createdTime, modifiedTime, webViewLink, iconLink, md5Checksum, trashed, starred))',
          includeRemoved: options.includeRemoved ?? true,
          supportsAllDrives: false,
          includeItemsFromAllDrives: false,
          restrictToMyDrive: options.restrictToMyDrive ?? true,
        });

        const pageChanges: ProviderChangeItem[] = (res.data.changes || []).map((c) => {
          let fileMeta: ProviderFileMetadata | null = null;
          if (c.file && !c.removed) {
            fileMeta = {
              providerFileId: c.file.id || c.fileId || '',
              name: c.file.name || 'Untitled',
              mimeType: c.file.mimeType || 'application/octet-stream',
              sizeBytes: c.file.size ? Number(c.file.size) : 0,
              parentFolderId: c.file.parents && c.file.parents.length > 0 ? c.file.parents[0] : null,
              isFolder: c.file.mimeType === 'application/vnd.google-apps.folder',
              webUrl: c.file.webViewLink || undefined,
              md5Checksum: c.file.md5Checksum || undefined,
              isStarred: Boolean(c.file.starred),
              isTrashed: Boolean(c.file.trashed),
              createdAt: c.file.createdTime || new Date().toISOString(),
              modifiedAt: c.file.modifiedTime || new Date().toISOString(),
            };
          }

          return {
            fileId: c.fileId || (c.file && c.file.id) || '',
            removed: Boolean(c.removed),
            time: c.time || undefined,
            file: fileMeta,
          };
        });

        allChanges.push(...pageChanges);
        currentPageToken = res.data.nextPageToken || undefined;
        if (res.data.newStartPageToken) {
          newStartPageToken = res.data.newStartPageToken;
        }
        pageCount++;
      } while (currentPageToken && pageCount < maxPages);

      // Pagination is complete when all change pages have been consumed
      const paginationComplete = !currentPageToken;

      return {
        changes: allChanges,
        newStartPageToken,
        nextPageToken: currentPageToken,
        paginationComplete,
      };
    } catch (err: any) {
      if (isInvalidPageTokenError(err)) {
        throw err; // Re-throw directly so caller can detect token expiry and trigger recovery
      }
      if (err instanceof AppError) throw err;
      logger.error('Failed to list Google Drive changes', { error: err.message });
      throw new AppError(
        ErrorCode.PROVIDER_ERROR,
        `Google Drive changes query failed: ${err.message}`,
        502
      );
    }
  }

  /**
   * Queries Google Drive v3 `files.get` endpoint for single file metadata.
   */
  async getFileMetadata(accessToken: string, providerFileId: string): Promise<ProviderFileMetadata> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });

    const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: client as any });

    try {
      const res = await drive.files.get({
        fileId: providerFileId,
        fields: 'id, name, mimeType, size, parents, createdTime, modifiedTime, webViewLink, iconLink, md5Checksum, trashed, starred',
      });

      const f = res.data;
      return {
        providerFileId: f.id || providerFileId,
        name: f.name || 'Untitled',
        mimeType: f.mimeType || 'application/octet-stream',
        sizeBytes: f.size ? Number(f.size) : 0,
        parentFolderId: f.parents && f.parents.length > 0 ? f.parents[0] : null,
        isFolder: f.mimeType === 'application/vnd.google-apps.folder',
        webUrl: f.webViewLink || undefined,
        md5Checksum: f.md5Checksum || undefined,
        isStarred: Boolean(f.starred),
        isTrashed: Boolean(f.trashed),
        createdAt: f.createdTime || new Date().toISOString(),
        modifiedAt: f.modifiedTime || new Date().toISOString(),
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error('Failed to get Google Drive file metadata', { error: err.message });
      throw new AppError(
        ErrorCode.PROVIDER_ERROR,
        `Google Drive file lookup failed: ${err.message}`,
        502
      );
    }
  }

  /**
   * Performs an API ping/health check.
   */
  async checkHealth(accessToken: string): Promise<ProviderHealthCheckResult> {
    const startTime = Date.now();
    try {
      const client = this.getOAuth2Client();
      client.setCredentials({ access_token: accessToken });
      const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: client as any });
      await drive.about.get({ fields: 'user' });

      return {
        isHealthy: true,
        latencyMs: Date.now() - startTime,
        statusMessage: 'Google Drive API v3 connected and responsive',
      };
    } catch (err: any) {
      return {
        isHealthy: false,
        latencyMs: Date.now() - startTime,
        statusMessage: err.message || 'Health check failed',
      };
    }
  }

  /**
   * Revokes an OAuth token at Google servers.
   */
  async revokeToken(token: string): Promise<void> {
    try {
      const client = this.getOAuth2Client();
      await client.revokeToken(token);
      logger.info('Successfully revoked Google OAuth token upstream.');
    } catch (err: any) {
      // Non-fatal: even if upstream revocation returns 400 (e.g. already revoked), local account is cleared
      logger.warn('Google token revocation warning (non-fatal)', { error: err.message });
    }
  }

  /**
   * Creates a folder in Google Drive.
   */
  async createFolder(accessToken: string, name: string, parentFolderId?: string): Promise<ProviderFileMetadata> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: client as any });

    try {
      const fileMetadata: drive_v3.Schema$File = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentFolderId ? [parentFolderId] : undefined,
      };

      const res = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name, mimeType, parents, createdTime, modifiedTime',
      });

      const f = res.data;
      return {
        providerFileId: f.id || '',
        name: f.name || name,
        mimeType: 'application/vnd.google-apps.folder',
        sizeBytes: 0,
        parentFolderId: f.parents && f.parents.length > 0 ? f.parents[0] : null,
        isFolder: true,
        isStarred: false,
        isTrashed: false,
        createdAt: f.createdTime || new Date().toISOString(),
        modifiedAt: f.modifiedTime || new Date().toISOString(),
      };
    } catch (err: any) {
      throw new AppError(ErrorCode.PROVIDER_ERROR, `Failed to create Google Drive folder: ${err.message}`, 502);
    }
  }

  /**
   * Initiates a resumable upload session with Google Drive API v3 (Phase 4).
   * Makes POST to https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable
   * Returns session URI for chunk streaming.
   */
  async initiateResumableUpload(
    accessToken: string,
    metadata: { name: string; mimeType: string; sizeBytes: number; parentFolderId?: string }
  ): Promise<ResumableUploadSession> {
    try {
      const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
      const bodyMetadata: Record<string, any> = {
        name: metadata.name,
        mimeType: metadata.mimeType || 'application/octet-stream',
      };
      if (metadata.parentFolderId) {
        bodyMetadata.parents = [metadata.parentFolderId];
      }

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': metadata.mimeType || 'application/octet-stream',
      };
      if (metadata.sizeBytes && metadata.sizeBytes > 0) {
        headers['X-Upload-Content-Length'] = String(metadata.sizeBytes);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyMetadata),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        logger.error('Google Drive initiate resumable upload failed', {
          status: response.status,
          error: errText,
        });
        throw new AppError(
          ErrorCode.PROVIDER_ERROR,
          `Google Drive failed to initiate resumable upload: ${response.status} ${errText}`,
          502
        );
      }

      const uploadUri = response.headers.get('location');
      if (!uploadUri) {
        throw new AppError(
          ErrorCode.PROVIDER_ERROR,
          'Google Drive did not return a resumable session Location URI',
          502
        );
      }

      return {
        sessionId: crypto.randomUUID(),
        uploadUri,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        chunkSizeBytes: 5 * 1024 * 1024, // 5MB standard chunk recommendation
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        ErrorCode.PROVIDER_ERROR,
        `Failed to initiate Google Drive upload session: ${err.message}`,
        502
      );
    }
  }

  /**
   * Uploads a chunk of data to the Google Drive resumable session URL (Phase 4).
   */
  async uploadChunk(
    uploadUri: string,
    chunk: Buffer | Uint8Array,
    options: { startByte: number; endByte: number; totalBytes: number; mimeType?: string }
  ): Promise<{ completed: boolean; bytesUploaded: number; file?: ProviderFileMetadata }> {
    try {
      const headers: Record<string, string> = {
        'Content-Length': String(chunk.byteLength),
        'Content-Range': `bytes ${options.startByte}-${options.endByte}/${options.totalBytes}`,
        'Content-Type': options.mimeType || 'application/octet-stream',
      };

      const response = await fetch(uploadUri, {
        method: 'PUT',
        headers,
        body: chunk,
      });

      if (response.status === 308) {
        // Incomplete upload - more chunks required
        const range = response.headers.get('range');
        let bytesUploaded = options.endByte + 1;
        if (range) {
          const match = /bytes=0-(\d+)/.exec(range);
          if (match) {
            bytesUploaded = parseInt(match[1], 10) + 1;
          }
        }
        return {
          completed: false,
          bytesUploaded,
        };
      }

      if (response.status === 200 || response.status === 201) {
        const data = (await response.json()) as drive_v3.Schema$File;
        const fileMetadata: ProviderFileMetadata = {
          providerFileId: data.id || '',
          name: data.name || '',
          mimeType: data.mimeType || 'application/octet-stream',
          sizeBytes: Number(data.size || options.totalBytes),
          isFolder: false,
          webUrl: data.webViewLink || undefined,
          md5Checksum: data.md5Checksum || undefined,
          createdAt: data.createdTime || new Date().toISOString(),
          modifiedAt: data.modifiedTime || new Date().toISOString(),
        };
        return {
          completed: true,
          bytesUploaded: options.totalBytes,
          file: fileMetadata,
        };
      }

      const errText = await response.text().catch(() => '');
      throw new AppError(
        ErrorCode.PROVIDER_ERROR,
        `Google Drive resumable chunk upload failed with status ${response.status}: ${errText}`,
        502
      );
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        ErrorCode.PROVIDER_ERROR,
        `Failed to upload chunk to Google Drive: ${err.message}`,
        502
      );
    }
  }

  /**
   * Queries upstream status of an active resumable upload session (Phase 4).
   */
  async getUploadStatus(
    uploadUri: string,
    totalBytes: number
  ): Promise<{ completed: boolean; bytesUploaded: number; file?: ProviderFileMetadata }> {
    try {
      const response = await fetch(uploadUri, {
        method: 'PUT',
        headers: {
          'Content-Length': '0',
          'Content-Range': `bytes */${totalBytes}`,
        },
      });

      if (response.status === 308) {
        const range = response.headers.get('range');
        let bytesUploaded = 0;
        if (range) {
          const match = /bytes=0-(\d+)/.exec(range);
          if (match) {
            bytesUploaded = parseInt(match[1], 10) + 1;
          }
        }
        return {
          completed: false,
          bytesUploaded,
        };
      }

      if (response.status === 200 || response.status === 201) {
        const data = (await response.json()) as drive_v3.Schema$File;
        return {
          completed: true,
          bytesUploaded: totalBytes,
          file: {
            providerFileId: data.id || '',
            name: data.name || '',
            mimeType: data.mimeType || 'application/octet-stream',
            sizeBytes: Number(data.size || totalBytes),
            isFolder: false,
            webUrl: data.webViewLink || undefined,
            md5Checksum: data.md5Checksum || undefined,
            createdAt: data.createdTime || new Date().toISOString(),
            modifiedAt: data.modifiedTime || new Date().toISOString(),
          },
        };
      }

      if (response.status === 404 || response.status === 410) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Resumable upload session has expired or does not exist.',
          404
        );
      }

      throw new AppError(
        ErrorCode.PROVIDER_ERROR,
        `Failed to query Google Drive upload status: ${response.status}`,
        502
      );
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        ErrorCode.PROVIDER_ERROR,
        `Failed to check Google Drive upload status: ${err.message}`,
        502
      );
    }
  }

  /**
   * Deletes or trashes a file in Google Drive.
   */
  async deleteFile(accessToken: string, providerFileId: string, permanent: boolean = false): Promise<void> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: client as any });

    try {
      if (permanent) {
        await drive.files.delete({ fileId: providerFileId });
      } else {
        await drive.files.update({
          fileId: providerFileId,
          requestBody: { trashed: true },
        });
      }
    } catch (err: any) {
      throw new AppError(ErrorCode.PROVIDER_ERROR, `Failed to delete file from Google Drive: ${err.message}`, 502);
    }
  }

  /**
   * Renames a file in Google Drive.
   */
  async renameFile(accessToken: string, providerFileId: string, newName: string): Promise<ProviderFileMetadata> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: client as any });

    try {
      const res = await drive.files.update({
        fileId: providerFileId,
        requestBody: { name: newName },
        fields: 'id, name, mimeType, size, parents, createdTime, modifiedTime',
      });

      const f = res.data;
      return {
        providerFileId: f.id || providerFileId,
        name: f.name || newName,
        mimeType: f.mimeType || 'application/octet-stream',
        sizeBytes: f.size ? Number(f.size) : 0,
        parentFolderId: f.parents && f.parents.length > 0 ? f.parents[0] : null,
        isFolder: f.mimeType === 'application/vnd.google-apps.folder',
        isStarred: Boolean(f.starred),
        isTrashed: Boolean(f.trashed),
        createdAt: f.createdTime || new Date().toISOString(),
        modifiedAt: f.modifiedTime || new Date().toISOString(),
      };
    } catch (err: any) {
      throw new AppError(ErrorCode.PROVIDER_ERROR, `Failed to rename Google Drive file: ${err.message}`, 502);
    }
  }

  /**
   * Moves a file to a new parent folder in Google Drive.
   */
  async moveFile(accessToken: string, providerFileId: string, targetFolderId: string): Promise<ProviderFileMetadata> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: client as any });

    try {
      // Retrieve existing parents
      const file = await drive.files.get({
        fileId: providerFileId,
        fields: 'parents',
      });

      const previousParents = (file.data.parents || []).join(',');

      const res = await drive.files.update({
        fileId: providerFileId,
        addParents: targetFolderId,
        removeParents: previousParents,
        fields: 'id, name, mimeType, size, parents, createdTime, modifiedTime',
      });

      const f = res.data;
      return {
        providerFileId: f.id || providerFileId,
        name: f.name || 'Untitled',
        mimeType: f.mimeType || 'application/octet-stream',
        sizeBytes: f.size ? Number(f.size) : 0,
        parentFolderId: targetFolderId,
        isFolder: f.mimeType === 'application/vnd.google-apps.folder',
        isStarred: Boolean(f.starred),
        isTrashed: Boolean(f.trashed),
        createdAt: f.createdTime || new Date().toISOString(),
        modifiedAt: f.modifiedTime || new Date().toISOString(),
      };
    } catch (err: any) {
      throw new AppError(ErrorCode.PROVIDER_ERROR, `Failed to move Google Drive file: ${err.message}`, 502);
    }
  }

  /**
   * Retrieves web link or download URL for a file.
   */
  async getDownloadUrl(accessToken: string, providerFileId: string): Promise<string> {
    const metadata = await this.getFileMetadata(accessToken, providerFileId);
    if (metadata.webUrl) {
      return metadata.webUrl;
    }
    return `https://drive.google.com/uc?id=${providerFileId}&export=download`;
  }

  /**
   * Restores a trashed file in Google Drive (Phase 5).
   */
  async restoreFile(accessToken: string, providerFileId: string): Promise<ProviderFileMetadata> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: client as any });

    try {
      const res = await drive.files.update({
        fileId: providerFileId,
        requestBody: { trashed: false },
        fields: 'id, name, mimeType, size, parents, createdTime, modifiedTime, webViewLink, md5Checksum',
      });

      const f = res.data;
      return {
        providerFileId: f.id || providerFileId,
        name: f.name || 'Untitled',
        mimeType: f.mimeType || 'application/octet-stream',
        sizeBytes: f.size ? Number(f.size) : 0,
        parentFolderId: f.parents && f.parents.length > 0 ? f.parents[0] : null,
        isFolder: f.mimeType === 'application/vnd.google-apps.folder',
        isStarred: Boolean(f.starred),
        isTrashed: false,
        webUrl: f.webViewLink || undefined,
        md5Checksum: f.md5Checksum || undefined,
        createdAt: f.createdTime || new Date().toISOString(),
        modifiedAt: f.modifiedTime || new Date().toISOString(),
      };
    } catch (err: any) {
      throw new AppError(ErrorCode.PROVIDER_ERROR, `Failed to restore Google Drive file: ${err.message}`, 502);
    }
  }

  /**
   * Copies a file in Google Drive (Phase 5).
   */
  async copyFile(accessToken: string, providerFileId: string, newName?: string, targetFolderId?: string): Promise<ProviderFileMetadata> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: client as any });

    try {
      const res = await drive.files.copy({
        fileId: providerFileId,
        requestBody: {
          name: newName,
          parents: targetFolderId ? [targetFolderId] : undefined,
        },
        fields: 'id, name, mimeType, size, parents, createdTime, modifiedTime, webViewLink, md5Checksum',
      });

      const f = res.data;
      return {
        providerFileId: f.id || '',
        name: f.name || newName || 'Copy',
        mimeType: f.mimeType || 'application/octet-stream',
        sizeBytes: f.size ? Number(f.size) : 0,
        parentFolderId: targetFolderId || (f.parents && f.parents.length > 0 ? f.parents[0] : null),
        isFolder: false,
        isStarred: false,
        isTrashed: false,
        webUrl: f.webViewLink || undefined,
        md5Checksum: f.md5Checksum || undefined,
        createdAt: f.createdTime || new Date().toISOString(),
        modifiedAt: f.modifiedTime || new Date().toISOString(),
      };
    } catch (err: any) {
      throw new AppError(ErrorCode.PROVIDER_ERROR, `Failed to copy Google Drive file: ${err.message}`, 502);
    }
  }

  /**
   * Downloads raw file content as a Buffer for cross-account moves/copies (Phase 5).
   */
  async downloadFileContent(accessToken: string, providerFileId: string): Promise<Buffer> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: client as any });

    try {
      const res = await drive.files.get(
        { fileId: providerFileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      return Buffer.from(res.data as ArrayBuffer);
    } catch (err: any) {
      throw new AppError(ErrorCode.PROVIDER_ERROR, `Failed to download Google Drive file content: ${err.message}`, 502);
    }
  }

  /**
   * Simple upload of file content Buffer (Phase 5).
   */
  async uploadSimpleFile(
    accessToken: string,
    metadata: { name: string; mimeType: string; content: Buffer; parentFolderId?: string }
  ): Promise<ProviderFileMetadata> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });
    const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: client as any });

    try {
      const stream = new Readable();
      stream.push(metadata.content);
      stream.push(null);

      const res = await drive.files.create({
        requestBody: {
          name: metadata.name,
          mimeType: metadata.mimeType,
          parents: metadata.parentFolderId ? [metadata.parentFolderId] : undefined,
        },
        media: {
          mimeType: metadata.mimeType,
          body: stream,
        },
        fields: 'id, name, mimeType, size, parents, createdTime, modifiedTime, webViewLink, md5Checksum',
      });

      const f = res.data;
      return {
        providerFileId: f.id || '',
        name: f.name || metadata.name,
        mimeType: f.mimeType || metadata.mimeType,
        sizeBytes: f.size ? Number(f.size) : metadata.content.length,
        parentFolderId: f.parents && f.parents.length > 0 ? f.parents[0] : null,
        isFolder: false,
        isStarred: false,
        isTrashed: false,
        webUrl: f.webViewLink || undefined,
        md5Checksum: f.md5Checksum || undefined,
        createdAt: f.createdTime || new Date().toISOString(),
        modifiedAt: f.modifiedTime || new Date().toISOString(),
      };
    } catch (err: any) {
      throw new AppError(ErrorCode.PROVIDER_ERROR, `Failed to upload file to Google Drive: ${err.message}`, 502);
    }
  }
}
