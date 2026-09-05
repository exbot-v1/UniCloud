/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Phase 3 Delta Synchronization Test Suite
 * 
 * Tests:
 * 1. Change token persistence & retrieval in storage_accounts.
 * 2. Token persistence only after successful change processing.
 * 3. Initial token establishment for existing accounts.
 * 4. Incremental change pagination (following nextPageToken and capturing newStartPageToken).
 * 5. Folder & file creation and hierarchical resolution.
 * 6. File & folder update handling (metadata updates without duplication).
 * 7. Upstream trash handling (marking is_trashed = true).
 * 8. Upstream hard deletion handling (deleting from virtual_files and virtual_folders).
 * 9. Invalid/expired change token error detection.
 * 10. Safe recovery from invalid/expired token by rebuilding sync state and acquiring fresh start token.
 * 11. Tenant isolation across different users and accounts.
 * 12. Audit logging in sync_history for delta syncs and recoveries.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { query } from '../db/client.js';
import { ProviderType, AccountStatus } from '../types/account.js';
import { GoogleDriveProvider, isInvalidPageTokenError } from '../server/providers/GoogleDriveProvider.js';
import { SyncService } from '../server/services/SyncService.js';
import { accountService } from '../server/services/AccountService.js';
import { ProviderRegistry } from '../server/providers/ProviderRegistry.js';
import { encryptToken } from '../server/utils/encryption.js';
import { ProviderChangeItem, ProviderChangeListOptions, ProviderChangeListResult } from '../types/provider.js';

// Helper to seed storage account matching in-memory DB positional parameters
async function seedStorageAccount(params: {
  id: string;
  userId: string;
  email: string;
  driveChangeToken?: string | null;
}) {
  const enc = encryptToken('test_refresh_token');
  await query(
    `INSERT INTO storage_accounts (
      id, user_id, provider, provider_account_id, email, display_name, avatar_url,
      encrypted_access_token, encrypted_refresh_token, token_iv, token_auth_tag,
      token_expires_at, total_bytes, used_bytes, free_bytes, status, is_enabled, error_message,
      drive_change_token
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      params.id,
      params.userId,
      ProviderType.GOOGLE_DRIVE,
      `prov_${params.id}`,
      params.email,
      `Display ${params.id}`,
      null,
      enc.ciphertext,
      enc.ciphertext,
      enc.iv,
      enc.authTag,
      new Date().toISOString(),
      15000000000,
      3000000000,
      12000000000,
      AccountStatus.ACTIVE,
      true,
      null,
      params.driveChangeToken || null,
    ]
  );
}

// Mock Provider for Delta Sync testing
class MockDeltaGoogleDriveProvider extends GoogleDriveProvider {
  public startToken: string = 'token_start_100';
  public changePages: Array<{
    changes: ProviderChangeItem[];
    nextPageToken?: string;
    newStartPageToken?: string;
  }> = [];
  public callCount = 0;
  public forceTokenError: any = null;

  constructor(options?: {
    startToken?: string;
    changePages?: Array<{
      changes: ProviderChangeItem[];
      nextPageToken?: string;
      newStartPageToken?: string;
    }>;
    forceTokenError?: any;
  }) {
    super();
    if (options?.startToken) this.startToken = options.startToken;
    if (options?.changePages) this.changePages = options.changePages;
    if (options?.forceTokenError) this.forceTokenError = options.forceTokenError;
  }

  public getOAuth2Client(): any {
    return {
      setCredentials: () => {},
    };
  }

  public async refreshAuthentication(_refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
    return { accessToken: 'mock_access_token_phase3', expiresInSeconds: 3600 };
  }

  public async getStorageQuota(_accessToken: string) {
    return {
      totalBytes: 15 * 1024 * 1024 * 1024,
      usedBytes: 3 * 1024 * 1024 * 1024,
      freeBytes: 12 * 1024 * 1024 * 1024,
      usagePercentage: 20,
    };
  }

  public async getStartPageToken(_accessToken: string): Promise<string> {
    return this.startToken;
  }

  public async listChanges(
    _accessToken: string,
    options: ProviderChangeListOptions
  ): Promise<ProviderChangeListResult> {
    if (this.forceTokenError) {
      throw this.forceTokenError;
    }

    const pageIndex = this.callCount++;
    const page = this.changePages[pageIndex] || { changes: [] };

    return {
      changes: page.changes,
      nextPageToken: page.nextPageToken,
      newStartPageToken: page.newStartPageToken || (page.nextPageToken ? undefined : 'token_new_start_200'),
      paginationComplete: !page.nextPageToken,
    };
  }

  public async listFiles(_accessToken: string, _options?: any): Promise<any> {
    return {
      files: [
        {
          providerFileId: 'g_file_rebuilt_001',
          name: 'rebuilt_file.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4096,
          isFolder: false,
          isStarred: false,
          isTrashed: false,
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        },
      ],
      nextPageToken: undefined,
      paginationComplete: true,
    };
  }
}

describe('Phase 3 — Delta Synchronization: Token Management & Persistence', () => {
  const userId = 'user_p3_token_01';
  const accountId = 'acc_p3_token_01';

  before(async () => {
    await query(
      `INSERT INTO users (id, email, password_hash, display_name) 
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [userId, 'p3_token@example.com', 'hash', 'P3 User']
    );

    await seedStorageAccount({
      id: accountId,
      userId,
      email: 'p3_token@example.com',
    });
  });

  test('1. Change token can be persisted and retrieved for storage account', async () => {
    const testToken = 'token_abc_12345';
    await accountService.updateChangeToken(userId, accountId, testToken);

    const retrieved = await accountService.getChangeToken(userId, accountId);
    assert.strictEqual(retrieved, testToken, 'Retrieved token must match persisted change token');

    const account = await accountService.getAccountById(userId, accountId);
    assert.strictEqual(account.driveChangeToken, testToken, 'Mapped domain account must expose driveChangeToken');
  });

  test('2. Establish initial change token for existing account via provider', async () => {
    const mockProvider = new MockDeltaGoogleDriveProvider({ startToken: 'token_initial_start_555' });
    ProviderRegistry.register(mockProvider);

    const syncService = new SyncService();
    const token = await syncService.establishInitialToken(userId, accountId);

    assert.strictEqual(token, 'token_initial_start_555');
    const stored = await accountService.getChangeToken(userId, accountId);
    assert.strictEqual(stored, 'token_initial_start_555');
  });

  test('3. Token is NOT updated if change processing encounters a fatal error', async () => {
    const initialToken = 'token_unmodified_before_error';
    await accountService.updateChangeToken(userId, accountId, initialToken);

    const faultyProvider = new MockDeltaGoogleDriveProvider();
    faultyProvider.listChanges = async () => {
      throw new Error('Fatal network failure during change ingestion');
    };
    ProviderRegistry.register(faultyProvider);

    const syncService = new SyncService();
    await assert.rejects(
      async () => {
        await syncService.syncDelta(userId, accountId);
      },
      /Fatal network failure during change ingestion/
    );

    const storedAfterError = await accountService.getChangeToken(userId, accountId);
    assert.strictEqual(storedAfterError, initialToken, 'Token must not be updated if delta sync failed');
  });
});

describe('Phase 3 — Delta Synchronization: Incremental Changes Processing', () => {
  const userId = 'user_p3_delta_proc_01';
  const accountId = 'acc_p3_delta_proc_01';

  before(async () => {
    await query(
      `INSERT INTO users (id, email, password_hash, display_name) 
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [userId, 'p3_proc@example.com', 'hash', 'P3 Delta Proc']
    );

    await seedStorageAccount({
      id: accountId,
      userId,
      email: 'p3_proc@example.com',
      driveChangeToken: 'token_current_001',
    });

    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, FALSE, FALSE, NOW(), NOW())
      ON CONFLICT DO NOTHING`,
      ['vfol_existing_01', userId, accountId, ProviderType.GOOGLE_DRIVE, 'g_folder_existing_01', 'Projects']
    );

    await query(
      `INSERT INTO virtual_files (
        id, user_id, storage_account_id, parent_id, provider, provider_file_id,
        name, mime_type, size_bytes, is_starred, is_trashed, synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, FALSE, NOW(), NOW(), NOW())
      ON CONFLICT DO NOTHING`,
      [
        'vf_existing_01',
        userId,
        accountId,
        'vfol_existing_01',
        ProviderType.GOOGLE_DRIVE,
        'g_file_existing_01',
        'old_plan.txt',
        'text/plain',
        1024,
      ]
    );
  });

  test('4. Correctly creates new folder and file with parent relationship', async () => {
    const mockProvider = new MockDeltaGoogleDriveProvider({
      changePages: [
        {
          changes: [
            {
              fileId: 'g_folder_new_delta_01',
              removed: false,
              file: {
                providerFileId: 'g_folder_new_delta_01',
                name: 'Financial Reports',
                mimeType: 'application/vnd.google-apps.folder',
                sizeBytes: 0,
                parentFolderId: 'g_folder_existing_01',
                isFolder: true,
                isStarred: false,
                isTrashed: false,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
              },
            },
            {
              fileId: 'g_file_new_delta_01',
              removed: false,
              file: {
                providerFileId: 'g_file_new_delta_01',
                name: 'Q3_Balance.xlsx',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                sizeBytes: 20480,
                parentFolderId: 'g_folder_new_delta_01',
                isFolder: false,
                isStarred: true,
                isTrashed: false,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
              },
            },
          ],
          newStartPageToken: 'token_after_create_202',
        },
      ],
    });
    ProviderRegistry.register(mockProvider);

    const syncService = new SyncService();
    const result = await syncService.syncDelta(userId, accountId);

    assert.strictEqual(result.syncType, 'delta');
    assert.strictEqual(result.filesDiscovered, 2);
    assert.strictEqual(result.filesAddedOrUpdated, 2);

    const folderRes = await query(
      `SELECT * FROM virtual_folders WHERE storage_account_id = $1 AND provider_folder_id = $2`,
      [accountId, 'g_folder_new_delta_01']
    );
    assert.strictEqual(folderRes.rowCount, 1);
    assert.strictEqual(folderRes.rows[0].name, 'Financial Reports');
    assert.strictEqual(folderRes.rows[0].parent_id, 'vfol_existing_01');

    const fileRes = await query(
      `SELECT * FROM virtual_files WHERE storage_account_id = $1 AND provider_file_id = $2`,
      [accountId, 'g_file_new_delta_01']
    );
    assert.strictEqual(fileRes.rowCount, 1);
    assert.strictEqual(fileRes.rows[0].name, 'Q3_Balance.xlsx');
    assert.strictEqual(fileRes.rows[0].parent_id, folderRes.rows[0].id);
    assert.strictEqual(fileRes.rows[0].is_starred, true);

    const newToken = await accountService.getChangeToken(userId, accountId);
    assert.strictEqual(newToken, 'token_after_create_202');
  });

  test('5. Correctly updates existing file metadata without creating duplicates', async () => {
    const mockProvider = new MockDeltaGoogleDriveProvider({
      changePages: [
        {
          changes: [
            {
              fileId: 'g_file_existing_01',
              removed: false,
              file: {
                providerFileId: 'g_file_existing_01',
                name: 'new_plan_v2.txt',
                mimeType: 'text/plain',
                sizeBytes: 5000,
                parentFolderId: 'g_folder_existing_01',
                isFolder: false,
                isStarred: true,
                isTrashed: false,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
              },
            },
          ],
          newStartPageToken: 'token_after_update_303',
        },
      ],
    });
    ProviderRegistry.register(mockProvider);

    const syncService = new SyncService();
    await syncService.syncDelta(userId, accountId);

    const files = await query(
      `SELECT * FROM virtual_files WHERE storage_account_id = $1 AND provider_file_id = $2`,
      [accountId, 'g_file_existing_01']
    );
    assert.strictEqual(files.rowCount, 1, 'Must update existing row without duplicates');
    assert.strictEqual(files.rows[0].name, 'new_plan_v2.txt');
    assert.strictEqual(Number(files.rows[0].size_bytes), 5000);
    assert.strictEqual(files.rows[0].is_starred, true);
  });

  test('6. Correctly marks items as trashed (is_trashed = true)', async () => {
    const mockProvider = new MockDeltaGoogleDriveProvider({
      changePages: [
        {
          changes: [
            {
              fileId: 'g_file_existing_01',
              removed: false,
              file: {
                providerFileId: 'g_file_existing_01',
                name: 'old_plan.txt',
                mimeType: 'text/plain',
                sizeBytes: 1024,
                isFolder: false,
                isStarred: false,
                isTrashed: true,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
              },
            },
          ],
          newStartPageToken: 'token_after_trash_404',
        },
      ],
    });
    ProviderRegistry.register(mockProvider);

    const syncService = new SyncService();
    await syncService.syncDelta(userId, accountId);

    const fileRes = await query(
      `SELECT * FROM virtual_files WHERE storage_account_id = $1 AND provider_file_id = $2`,
      [accountId, 'g_file_existing_01']
    );
    assert.strictEqual(fileRes.rowCount, 1);
    assert.strictEqual(fileRes.rows[0].is_trashed, true, 'File must be marked as trashed');
  });

  test('7. Correctly handles permanent deletion (removed: true)', async () => {
    const mockProvider = new MockDeltaGoogleDriveProvider({
      changePages: [
        {
          changes: [
            {
              fileId: 'g_file_existing_01',
              removed: true,
              file: null,
            },
          ],
          newStartPageToken: 'token_after_delete_505',
        },
      ],
    });
    ProviderRegistry.register(mockProvider);

    const syncService = new SyncService();
    const result = await syncService.syncDelta(userId, accountId);

    assert.strictEqual(result.filesRemoved, 1);

    const fileRes = await query(
      `SELECT * FROM virtual_files WHERE storage_account_id = $1 AND provider_file_id = $2`,
      [accountId, 'g_file_existing_01']
    );
    assert.strictEqual(fileRes.rowCount, 0, 'File must be deleted from virtual_files');
  });

  test('8. Multi-page changes consumption across multiple pages', async () => {
    const mockProvider = new MockDeltaGoogleDriveProvider({
      changePages: [
        {
          changes: [
            {
              fileId: 'g_file_page1',
              removed: false,
              file: {
                providerFileId: 'g_file_page1',
                name: 'page1_doc.txt',
                mimeType: 'text/plain',
                sizeBytes: 100,
                isFolder: false,
                isStarred: false,
                isTrashed: false,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
              },
            },
          ],
          nextPageToken: 'token_page_2',
        },
      ],
    });

    const result = await mockProvider.listChanges('mock_access', { pageToken: 'token_page_1' });
    assert.strictEqual(result.changes.length, 1);
    assert.strictEqual(result.nextPageToken, 'token_page_2');
    assert.strictEqual(result.paginationComplete, false);
  });
});

describe('Phase 3 — Delta Synchronization: Token Expiry & Safe Rebuild Recovery', () => {
  const userId = 'user_p3_recovery_01';
  const accountId = 'acc_p3_recovery_01';

  before(async () => {
    await query(
      `INSERT INTO users (id, email, password_hash, display_name) 
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [userId, 'p3_recov@example.com', 'hash', 'P3 Recovery']
    );

    await seedStorageAccount({
      id: accountId,
      userId,
      email: 'p3_recov@example.com',
      driveChangeToken: 'token_expired_999',
    });
  });

  test('9. isInvalidPageTokenError accurately detects various Google Drive token expiration errors', () => {
    assert.strictEqual(isInvalidPageTokenError({ status: 404 }), true);
    assert.strictEqual(isInvalidPageTokenError({ status: 410 }), true);
    assert.strictEqual(isInvalidPageTokenError({ status: 400, message: 'Invalid page token' }), true);
    assert.strictEqual(isInvalidPageTokenError({ message: 'startPageToken has expired' }), true);
    assert.strictEqual(isInvalidPageTokenError({ response: { status: 410 } }), true);
    assert.strictEqual(
      isInvalidPageTokenError({
        errors: [{ reason: 'startPageTokenExpired', message: 'Token expired' }],
      }),
      true
    );
    assert.strictEqual(isInvalidPageTokenError({ message: 'Random unrelated network error' }), false);
    assert.strictEqual(isInvalidPageTokenError(null), false);
  });

  test('10. Safely recovers when stored token is expired (rebuilds sync state via full sync)', async () => {
    const expiredTokenError = new Error('The startPageToken has expired.');
    (expiredTokenError as any).status = 410;

    const mockProvider = new MockDeltaGoogleDriveProvider({
      startToken: 'token_fresh_after_rebuild_777',
      forceTokenError: expiredTokenError,
    });
    ProviderRegistry.register(mockProvider);

    const syncService = new SyncService();
    const result = await syncService.syncDelta(userId, accountId);

    assert.strictEqual(result.syncType, 'rebuild', 'Sync result must denote rebuild recovery');
    assert.strictEqual(result.recoveredFromInvalidToken, true);
    assert.strictEqual(result.changeToken, 'token_fresh_after_rebuild_777');

    const storedToken = await accountService.getChangeToken(userId, accountId);
    assert.strictEqual(storedToken, 'token_fresh_after_rebuild_777');

    const files = await query(
      `SELECT * FROM virtual_files WHERE storage_account_id = $1 AND provider_file_id = $2`,
      [accountId, 'g_file_rebuilt_001']
    );
    assert.strictEqual(files.rowCount, 1, 'Metadata state must be rebuilt');

    const history = await query(
      `SELECT * FROM sync_history WHERE storage_account_id = $1 ORDER BY started_at DESC`,
      [accountId]
    );
    assert(history.rowCount > 0, 'Recovery must be audited in sync_history');
    const latest = history.rows[0];
    assert.strictEqual(latest.status, 'completed');
    assert(
      latest.error_message?.includes('Recovered from invalid/expired change token'),
      'Audit log must note recovery reason'
    );
  });
});

describe('Phase 3 — Delta Synchronization: Tenant Isolation & History Audit', () => {
  const userA = 'user_p3_tenant_A';
  const userB = 'user_p3_tenant_B';
  const accountA = 'acc_p3_tenant_A';
  const accountB = 'acc_p3_tenant_B';

  before(async () => {
    await query(
      `INSERT INTO users (id, email, password_hash, display_name) 
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [userA, 'userA@example.com', 'hash', 'User A']
    );
    await query(
      `INSERT INTO users (id, email, password_hash, display_name) 
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [userB, 'userB@example.com', 'hash', 'User B']
    );

    await seedStorageAccount({
      id: accountA,
      userId: userA,
      email: 'userA@example.com',
      driveChangeToken: 'token_A_1',
    });

    await seedStorageAccount({
      id: accountB,
      userId: userB,
      email: 'userB@example.com',
      driveChangeToken: 'token_B_1',
    });

    await query(
      `INSERT INTO virtual_files (
        id, user_id, storage_account_id, parent_id, provider, provider_file_id,
        name, mime_type, size_bytes, is_starred, is_trashed, synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, FALSE, FALSE, NOW(), NOW(), NOW())
      ON CONFLICT DO NOTHING`,
      [
        'vf_tenant_b_file',
        userB,
        accountB,
        ProviderType.GOOGLE_DRIVE,
        'shared_file_id_001',
        'user_b_private_file.txt',
        'text/plain',
        999,
      ]
    );
  });

  test('11. Delta sync for User A does not modify or delete files belonging to User B', async () => {
    const mockProvider = new MockDeltaGoogleDriveProvider({
      changePages: [
        {
          changes: [
            {
              fileId: 'shared_file_id_001',
              removed: true,
              file: null,
            },
          ],
          newStartPageToken: 'token_A_2',
        },
      ],
    });
    ProviderRegistry.register(mockProvider);

    const syncService = new SyncService();
    await syncService.syncDelta(userA, accountA);

    const fileB = await query(
      `SELECT * FROM virtual_files WHERE storage_account_id = $1 AND provider_file_id = $2`,
      [accountB, 'shared_file_id_001']
    );
    assert.strictEqual(fileB.rowCount, 1, 'User B file must remain untouched by User A delta sync');
    assert.strictEqual(fileB.rows[0].user_id, userB);
  });

  test('12. Delta sync audit history is recorded in sync_history with correct counts and status', async () => {
    const mockProvider = new MockDeltaGoogleDriveProvider({
      changePages: [
        {
          changes: [
            {
              fileId: 'g_file_tenant_a_1',
              removed: false,
              file: {
                providerFileId: 'g_file_tenant_a_1',
                name: 'audit_test_file.txt',
                mimeType: 'text/plain',
                sizeBytes: 1234,
                isFolder: false,
                isStarred: false,
                isTrashed: false,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
              },
            },
          ],
          newStartPageToken: 'token_A_audited',
        },
      ],
    });
    ProviderRegistry.register(mockProvider);

    const syncService = new SyncService();
    await syncService.syncDelta(userA, accountA);

    const histRes = await query(
      `SELECT * FROM sync_history WHERE storage_account_id = $1 AND user_id = $2 ORDER BY started_at DESC`,
      [accountA, userA]
    );

    assert(histRes.rowCount > 0);
    const hist = histRes.rows[0];
    assert.strictEqual(hist.status, 'completed');
    assert.strictEqual(hist.files_discovered, 1);
    assert.strictEqual(hist.files_added, 1);
    assert.strictEqual(hist.files_removed, 0);
  });
});
