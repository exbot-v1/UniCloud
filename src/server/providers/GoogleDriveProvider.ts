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
import { ProviderType, StorageQuota } from '../../types/account.js';
import {
  StorageProvider,
  ProviderFileMetadata,
  ProviderFileListOptions,
  ProviderFileListResult,
  ResumableUploadSession,
  ProviderHealthCheckResult,
} from '../../types/provider.js';
import { AppError } from '../utils/errors.js';
import { ErrorCode } from '../../types/api.js';
import { logger } from '../utils/logger.js';

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

    const defaultRedirect = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/accounts/google/callback';
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri || defaultRedirect);
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
   * Queries Google Drive v3 `files.list` endpoint for file and folder metadata.
   */
  async listFiles(accessToken: string, options?: ProviderFileListOptions): Promise<ProviderFileListResult> {
    const client = this.getOAuth2Client();
    client.setCredentials({ access_token: accessToken });

    const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: client as any });

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

      return {
        files: allFiles,
        nextPageToken: currentPageToken,
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
   * Initiates a resumable upload session (prepared for Phase 4).
   */
  async initiateResumableUpload(): Promise<ResumableUploadSession> {
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      'Resumable upload session initialization is scheduled for Phase 4: Resumable Upload Engine.',
      501
    );
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
}
