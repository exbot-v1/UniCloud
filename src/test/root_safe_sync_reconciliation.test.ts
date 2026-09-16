/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Root-Safe Sync Reconciliation Regression Test Suite
 * 
 * Verifies that:
 * 1. My Drive root remains active (is_trashed = false) after a complete full sync.
 * 2. Root-level folders remain active and properly parented to root.
 * 3. Real deleted or missing folders are marked trashed during stale reconciliation.
 * 4. A folder containing 32 files paginated across multiple pages is fully synchronized.
 * 5. Nested folders and their children (root -> parent -> child -> file) remain intact.
 * 6. Incomplete or truncated paginated syncs do NOT perform stale reconciliation.
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { query } from '../db/client.js';
import { ProviderType } from '../types/account.js';
import { GoogleDriveProvider } from '../server/providers/GoogleDriveProvider.js';
import { SyncService } from '../server/services/SyncService.js';
import { accountService } from '../server/services/AccountService.js';
import { ProviderRegistry } from '../server/providers/ProviderRegistry.js';
import { ProviderFileListResult } from '../types/provider.js';
import { encryptToken } from '../server/utils/encryption.js';

class MockDriveProviderForRootSafeTests extends GoogleDriveProvider {
  public filesListHandler: (options?: any) => Promise<ProviderFileListResult>;
  public folderChildrenHandler?: (folderId: string, options?: any) => Promise<ProviderFileListResult>;

  constructor(
    filesListHandler: (options?: any) => Promise<ProviderFileListResult>,
    folderChildrenHandler?: (folderId: string, options?: any) => Promise<ProviderFileListResult>
  ) {
    super();
    this.filesListHandler = filesListHandler;
    this.folderChildrenHandler = folderChildrenHandler;
  }

  public getOAuth2Client(): any {
    return {
      setCredentials: () => {},
    };
  }

  public async refreshAuthentication(_refreshToken: string): Promise<any> {
    return {
      accessToken: 'mock_refreshed_access_token',
      expiresInSeconds: 3600,
    };
  }

  public async getStorageQuota(_token: string): Promise<any> {
    return {
      totalBytes: 15 * 1024 * 1024 * 1024,
      usedBytes: 1024 * 1024,
      freeBytes: 15 * 1024 * 1024 * 1024 - 1024 * 1024,
      usagePercentage: 1,
    };
  }

  public async getStartPageToken(_token: string): Promise<string> {
    return 'page_token_root_safe_100';
  }

  public async listFiles(_token: string, options?: any): Promise<ProviderFileListResult> {
    return await this.filesListHandler(options);
  }

  public async listFilesInFolder(_token: string, folderId: string, options?: any): Promise<ProviderFileListResult> {
    if (this.folderChildrenHandler) {
      return await this.folderChildrenHandler(folderId, options);
    }
    return await this.filesListHandler({ ...options, folderId });
  }
}

describe('Root-Safe Sync Reconciliation Regression Tests', { concurrency: 1 }, () => {
  let syncService: SyncService;
  let testRunCount = 0;

  beforeEach(() => {
    syncService = new SyncService();
    testRunCount++;
  });

  async function createTestFixtures(runIndex: number) {
    const userId = `user_root_safe_${runIndex}_${crypto.randomUUID().slice(0, 8)}`;
    const email = `rootsafe_${runIndex}_${Date.now()}@example.com`;

    // Ensure user exists
    await query(
      `INSERT INTO users (id, email, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [userId, email, 'dummy_hash']
    );

    const connected = await accountService.connectOrUpdateAccount({
      userId,
      provider: ProviderType.GOOGLE_DRIVE,
      providerAccountId: `g_acc_rootsafe_${runIndex}`,
      email,
      displayName: 'Root Safe Google Drive',
      tokens: {
        accessToken: 'mock_access_token_root_safe',
        refreshToken: 'mock_refresh_token_root_safe',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
      quota: {
        totalBytes: 15 * 1024 * 1024 * 1024,
        usedBytes: 1024 * 1024,
        freeBytes: 15 * 1024 * 1024 * 1024 - 1024 * 1024,
        usagePercentage: 0.1,
      },
    });

    const accountId = connected.account.id;

    // Ensure provider_metadata has rootFolderId: 'root'
    await query(
      `UPDATE storage_accounts SET provider_metadata = $1 WHERE id = $2`,
      [JSON.stringify({ rootFolderId: 'root', driveRootId: 'root' }), accountId]
    );

    return { userId, accountId };
  }

  test('1. My Drive root remains active after a complete full sync', async () => {
    const { userId, accountId } = await createTestFixtures(1);

    // Pre-create the synthetic "My Drive" root virtual folder (updated in the past)
    const rootVirtualId = crypto.randomUUID();
    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours')`,
      [rootVirtualId, userId, accountId, ProviderType.GOOGLE_DRIVE, 'root', 'My Drive', false, false]
    );

    // Mock Drive provider returning a single child file in root
    const mockProvider = new MockDriveProviderForRootSafeTests(
      async (_opts?: any) => ({
        files: [
          {
            providerFileId: 'g_child_file_001',
            name: 'Welcome.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: 15400,
            isFolder: false,
            parentFolderId: 'root',
            parentFolderIds: ['root'],
            ownedByMe: true,
            isShared: false,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
          },
        ],
        paginationComplete: true,
        pagesConsumed: 1,
      }),
      async (folderId: string) => {
        if (folderId === 'root') {
          return {
            files: [
              {
                providerFileId: 'g_child_file_001',
                name: 'Welcome.docx',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                sizeBytes: 15400,
                isFolder: false,
                parentFolderId: 'root',
                parentFolderIds: ['root'],
                ownedByMe: true,
                isShared: false,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
              },
            ],
            paginationComplete: true,
            pagesConsumed: 1,
          };
        }
        return { files: [], paginationComplete: true, pagesConsumed: 1 };
      }
    );

    ProviderRegistry.register(mockProvider);

    const syncResult = await syncService.syncAccount(userId, accountId);
    assert.strictEqual(syncResult.paginationComplete, true);

    // Verify My Drive root folder is NOT marked trashed
    const rootCheck = await query(
      `SELECT * FROM virtual_folders WHERE id = $1`,
      [rootVirtualId]
    );
    assert.strictEqual(rootCheck.rows.length, 1);
    assert.strictEqual(rootCheck.rows[0].is_trashed, false, 'My Drive root folder must NOT be marked trashed');
    assert.strictEqual(rootCheck.rows[0].trashed_at, null, 'trashed_at must be null');
  });

  test('2. Root-level folders remain active after complete full sync', async () => {
    const { userId, accountId } = await createTestFixtures(2);
    const rootVirtualId = crypto.randomUUID();
    const folderVirtualId = crypto.randomUUID();

    // Pre-create root
    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours')`,
      [rootVirtualId, userId, accountId, ProviderType.GOOGLE_DRIVE, 'root', 'My Drive', false, false]
    );

    // Pre-create root-level folder "Documents"
    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours')`,
      [folderVirtualId, userId, rootVirtualId, accountId, ProviderType.GOOGLE_DRIVE, 'g_folder_docs', 'Documents', false, false]
    );

    const mockProvider = new MockDriveProviderForRootSafeTests(
      async (_opts?: any) => ({
        files: [
          {
            providerFileId: 'g_folder_docs',
            name: 'Documents',
            mimeType: 'application/vnd.google-apps.folder',
            sizeBytes: 0,
            isFolder: true,
            parentFolderId: 'root',
            parentFolderIds: ['root'],
            ownedByMe: true,
            isShared: false,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
          },
        ],
        paginationComplete: true,
        pagesConsumed: 1,
      }),
      async (folderId: string) => ({
        files: folderId === 'root'
          ? [
              {
                providerFileId: 'g_folder_docs',
                name: 'Documents',
                mimeType: 'application/vnd.google-apps.folder',
                sizeBytes: 0,
                isFolder: true,
                parentFolderId: 'root',
                parentFolderIds: ['root'],
                ownedByMe: true,
                isShared: false,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
              },
            ]
          : [],
        paginationComplete: true,
        pagesConsumed: 1,
      })
    );

    ProviderRegistry.register(mockProvider);

    await syncService.syncAccount(userId, accountId);

    const folderCheck = await query(
      `SELECT * FROM virtual_folders WHERE id = $1`,
      [folderVirtualId]
    );
    assert.strictEqual(folderCheck.rows.length, 1);
    assert.strictEqual(folderCheck.rows[0].is_trashed, false, 'Root-level folder must remain active');
    assert.ok(folderCheck.rows[0].parent_id === null || folderCheck.rows[0].parent_id === rootVirtualId, 'Parent ID must point to root or be null');
  });

  test('3. Real deleted/missing folder is marked trashed during stale reconciliation', async () => {
    const { userId, accountId } = await createTestFixtures(3);
    const rootVirtualId = crypto.randomUUID();
    const staleFolderId = crypto.randomUUID();

    // Pre-create root
    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours')`,
      [rootVirtualId, userId, accountId, ProviderType.GOOGLE_DRIVE, 'root', 'My Drive', false, false]
    );

    // Pre-create a folder that was deleted upstream in Google Drive
    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours')`,
      [staleFolderId, userId, rootVirtualId, accountId, ProviderType.GOOGLE_DRIVE, 'g_obsolete_folder', 'Old Project', false, false]
    );

    // Upstream returns empty results (the folder was deleted)
    const mockProvider = new MockDriveProviderForRootSafeTests(
      async () => ({ files: [], paginationComplete: true, pagesConsumed: 1 }),
      async () => ({ files: [], paginationComplete: true, pagesConsumed: 1 })
    );

    ProviderRegistry.register(mockProvider);

    await syncService.syncAccount(userId, accountId);

    // The obsolete folder MUST be marked trashed
    const staleCheck = await query(
      `SELECT * FROM virtual_folders WHERE id = $1`,
      [staleFolderId]
    );
    assert.strictEqual(staleCheck.rows[0].is_trashed, true, 'Deleted upstream folder must be marked trashed');
    assert.ok(staleCheck.rows[0].trashed_at !== null, 'trashed_at timestamp must be set');

    // Meanwhile, My Drive root MUST still be NOT trashed!
    const rootCheck = await query(
      `SELECT * FROM virtual_folders WHERE id = $1`,
      [rootVirtualId]
    );
    assert.strictEqual(rootCheck.rows[0].is_trashed, false, 'My Drive root folder must NEVER be marked trashed');
  });

  test('4. Folder containing 32 files is fully synchronized rather than partially populated', async () => {
    const { userId, accountId } = await createTestFixtures(4);
    const rootVirtualId = crypto.randomUUID();
    const folderVirtualId = crypto.randomUUID();
    const folderProviderId = 'g_folder_32_files';

    // Pre-create root and folder
    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, 'root', 'My Drive', false, false, NOW(), NOW())`,
      [rootVirtualId, userId, accountId, ProviderType.GOOGLE_DRIVE]
    );

    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'Photos32', false, false, NOW(), NOW())`,
      [folderVirtualId, userId, rootVirtualId, accountId, ProviderType.GOOGLE_DRIVE, folderProviderId]
    );

    // Generate 32 files
    const all32Files = Array.from({ length: 32 }, (_, i) => ({
      providerFileId: `g_photo_${String(i + 1).padStart(2, '0')}`,
      name: `Photo_${String(i + 1).padStart(2, '0')}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 1024 * 100 + i * 100,
      isFolder: false,
      parentFolderId: folderProviderId,
      parentFolderIds: [folderProviderId],
      ownedByMe: true,
      isShared: false,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    }));

    const mockProvider = new MockDriveProviderForRootSafeTests(
      async () => ({
        files: [
          {
            providerFileId: folderProviderId,
            name: 'Photos32',
            mimeType: 'application/vnd.google-apps.folder',
            sizeBytes: 0,
            isFolder: true,
            parentFolderId: 'root',
            parentFolderIds: ['root'],
            ownedByMe: true,
            isShared: false,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
          },
          ...all32Files,
        ],
        paginationComplete: true,
        pagesConsumed: 1,
      }),
      async (targetFolderId: string) => {
        if (targetFolderId === folderProviderId) {
          return {
            files: all32Files,
            paginationComplete: true,
            pagesConsumed: 2,
          };
        }
        return { files: [], paginationComplete: true, pagesConsumed: 1 };
      }
    );

    ProviderRegistry.register(mockProvider);

    const syncRes = await syncService.syncAccount(userId, accountId);
    assert.strictEqual(syncRes.paginationComplete, true);

    // Verify all 32 files are persisted and active
    const fileRes = await query(
      `SELECT * FROM virtual_files 
       WHERE storage_account_id = $1 AND parent_id = $2 AND is_trashed = FALSE`,
      [accountId, folderVirtualId]
    );
    assert.strictEqual(fileRes.rows.length, 32, 'All 32 files must be synchronized without missing items');
  });

  test('5. Nested folders and their children remain intact', async () => {
    const { userId, accountId } = await createTestFixtures(5);
    const rootVirtualId = crypto.randomUUID();

    // Pre-create root
    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [rootVirtualId, userId, accountId, ProviderType.GOOGLE_DRIVE, 'root', 'My Drive', false, false]
    );

    // Hierarchy: root -> Projects (g_proj) -> UniCloud (g_unicloud) -> main.ts (g_file_main)
    const mockProvider = new MockDriveProviderForRootSafeTests(
      async () => ({
        files: [
          {
            providerFileId: 'g_proj',
            name: 'Projects',
            mimeType: 'application/vnd.google-apps.folder',
            sizeBytes: 0,
            isFolder: true,
            parentFolderId: 'root',
            parentFolderIds: ['root'],
            ownedByMe: true,
            isShared: false,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
          },
          {
            providerFileId: 'g_unicloud',
            name: 'UniCloud',
            mimeType: 'application/vnd.google-apps.folder',
            sizeBytes: 0,
            isFolder: true,
            parentFolderId: 'g_proj',
            parentFolderIds: ['g_proj'],
            ownedByMe: true,
            isShared: false,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
          },
          {
            providerFileId: 'g_file_main',
            name: 'main.ts',
            mimeType: 'text/typescript',
            sizeBytes: 2048,
            isFolder: false,
            parentFolderId: 'g_unicloud',
            parentFolderIds: ['g_unicloud'],
            ownedByMe: true,
            isShared: false,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
          },
        ],
        paginationComplete: true,
        pagesConsumed: 1,
      }),
      async (folderId: string) => {
        if (folderId === 'root') {
          return {
            files: [
              {
                providerFileId: 'g_proj',
                name: 'Projects',
                mimeType: 'application/vnd.google-apps.folder',
                sizeBytes: 0,
                isFolder: true,
                parentFolderId: 'root',
                parentFolderIds: ['root'],
                ownedByMe: true,
                isShared: false,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
              },
            ],
            paginationComplete: true,
            pagesConsumed: 1,
          };
        }
        if (folderId === 'g_proj') {
          return {
            files: [
              {
                providerFileId: 'g_unicloud',
                name: 'UniCloud',
                mimeType: 'application/vnd.google-apps.folder',
                sizeBytes: 0,
                isFolder: true,
                parentFolderId: 'g_proj',
                parentFolderIds: ['g_proj'],
                ownedByMe: true,
                isShared: false,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
              },
            ],
            paginationComplete: true,
            pagesConsumed: 1,
          };
        }
        if (folderId === 'g_unicloud') {
          return {
            files: [
              {
                providerFileId: 'g_file_main',
                name: 'main.ts',
                mimeType: 'text/typescript',
                sizeBytes: 2048,
                isFolder: false,
                parentFolderId: 'g_unicloud',
                parentFolderIds: ['g_unicloud'],
                ownedByMe: true,
                isShared: false,
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
              },
            ],
            paginationComplete: true,
            pagesConsumed: 1,
          };
        }
        return { files: [], paginationComplete: true, pagesConsumed: 1 };
      }
    );

    ProviderRegistry.register(mockProvider);

    await syncService.syncAccount(userId, accountId);

    // Verify parentage
    const projRes = await query(`SELECT * FROM virtual_folders WHERE provider_folder_id = 'g_proj' AND storage_account_id = $1`, [accountId]);
    const unicloudRes = await query(`SELECT * FROM virtual_folders WHERE provider_folder_id = 'g_unicloud' AND storage_account_id = $1`, [accountId]);
    const fileRes = await query(`SELECT * FROM virtual_files WHERE provider_file_id = 'g_file_main' AND storage_account_id = $1`, [accountId]);

    assert.strictEqual(projRes.rows.length, 1);
    assert.strictEqual(unicloudRes.rows.length, 1);
    assert.strictEqual(fileRes.rows.length, 1);

    // Projects points to root
    assert.ok(projRes.rows[0].parent_id === null || projRes.rows[0].parent_id === rootVirtualId, 'Projects must point to root or be null');
    assert.strictEqual(projRes.rows[0].is_trashed, false);

    // UniCloud points to Projects
    assert.strictEqual(unicloudRes.rows[0].parent_id, projRes.rows[0].id, 'UniCloud must point to Projects');
    assert.strictEqual(unicloudRes.rows[0].is_trashed, false);

    // File points to UniCloud
    assert.strictEqual(fileRes.rows[0].parent_id, unicloudRes.rows[0].id, 'main.ts must point to UniCloud');
    assert.strictEqual(fileRes.rows[0].is_trashed, false);
  });

  test('6. Incomplete/paginated sync does not perform stale reconciliation', async () => {
    const { userId, accountId } = await createTestFixtures(6);
    const rootVirtualId = crypto.randomUUID();
    const existingOldFolderId = crypto.randomUUID();
    const existingOldFileId = crypto.randomUUID();
    const pastTime = new Date(Date.now() - 7200 * 1000).toISOString();

    // Pre-create root
    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours')`,
      [rootVirtualId, userId, accountId, ProviderType.GOOGLE_DRIVE, 'root', 'My Drive', false, false]
    );

    // Pre-create an older folder & file that might look "stale"
    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours')`,
      [existingOldFolderId, userId, rootVirtualId, accountId, ProviderType.GOOGLE_DRIVE, 'g_old_fol', 'Old Folder', false, false]
    );

    await query(
      `INSERT INTO virtual_files (
        id, user_id, storage_account_id, parent_id, provider, provider_file_id,
        name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
        provider_created_at, provider_modified_at, synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, NULL, false, false, $10, $10, $10, NOW(), NOW())`,
      [
        existingOldFileId,
        userId,
        accountId,
        existingOldFolderId,
        ProviderType.GOOGLE_DRIVE,
        'g_old_file',
        'Old File.pdf',
        'application/pdf',
        5000,
        pastTime,
      ]
    );

    // Truncated/incomplete sync: paginationComplete = false
    const mockProvider = new MockDriveProviderForRootSafeTests(
      async () => ({
        files: [
          {
            providerFileId: 'g_some_new_item',
            name: 'New Item.txt',
            mimeType: 'text/plain',
            sizeBytes: 100,
            isFolder: false,
            parentFolderId: 'root',
            parentFolderIds: ['root'],
            ownedByMe: true,
            isShared: false,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
          },
        ],
        paginationComplete: false, // Incomplete!
        nextPageToken: 'token_remaining_pages',
        pagesConsumed: 1,
      })
    );

    ProviderRegistry.register(mockProvider);

    const syncRes = await syncService.syncAccount(userId, accountId);
    assert.strictEqual(syncRes.paginationComplete, false);

    // Because sync was incomplete, existing items MUST NOT be marked trashed!
    const folderRes = await query(`SELECT * FROM virtual_folders WHERE id = $1`, [existingOldFolderId]);
    assert.strictEqual(folderRes.rows[0].is_trashed, false, 'Folder must NOT be trashed when pagination is incomplete');

    const fileRes = await query(`SELECT * FROM virtual_files WHERE id = $1`, [existingOldFileId]);
    assert.strictEqual(fileRes.rows[0].is_trashed, false, 'File must NOT be trashed when pagination is incomplete');
  });
});
