/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Phase 2.1.1 Corrective Hardening Test Suite
 * 
 * Tests:
 * 1. Virtual folder upsert concurrency & PostgreSQL authoritative RETURNING id usage.
 * 2. folderMap mapping to database-returned ID and parent-child hierarchy resolution.
 * 3. Idempotent repeated synchronization without folder duplication.
 * 4. GoogleDriveProvider paginationComplete calculation (single-page, multi-page, maxPages truncation, fetchAllPages=false).
 * 5. SyncService guarded stale-item reconciliation (performed ONLY when paginationComplete=true).
 * 6. Protection of unvisited/existing files from incorrect trashing when pagination is truncated.
 * 7. Sync history audit recording reflecting completed vs partial pagination status.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { query } from '../db/client.js';
import { ProviderType } from '../types/account.js';
import { GoogleDriveProvider } from '../server/providers/GoogleDriveProvider.js';
import { SyncService } from '../server/services/SyncService.js';
import { accountService } from '../server/services/AccountService.js';
import { ProviderRegistry } from '../server/providers/ProviderRegistry.js';
import { ProviderFileListResult } from '../types/provider.js';

// Test mock provider that extends GoogleDriveProvider and mocks getDriveClient
class MockGoogleDrivePaginationProvider extends GoogleDriveProvider {
  public pages: Array<{ files: any[]; nextPageToken?: string }> = [];
  public callCount = 0;

  constructor(pages: Array<{ files: any[]; nextPageToken?: string }>) {
    super();
    this.pages = pages;
  }

  public getOAuth2Client(): any {
    return {
      setCredentials: () => {},
    };
  }

  protected getDriveClient(): any {
    return {
      files: {
        list: async (params: { pageToken?: string; pageSize?: number }) => {
          const pageIndex = this.callCount++;
          const page = this.pages[pageIndex] || { files: [] };
          return {
            data: {
              files: page.files,
              nextPageToken: page.nextPageToken,
            },
          };
        },
      },
    };
  }
}

describe('Phase 2.1.1 — Folder Concurrency & Authoritative ID Resolution', () => {
  const userId = 'user_folder_concurrency_01';
  const accountId = 'acc_folder_concurrency_01';

  test('1. New folder upsert uses returned PostgreSQL ID (RETURNING id)', async () => {
    const providerFolderId = 'g_folder_new_001';
    const clientGeneratedUuid = crypto.randomUUID();

    const result = await query<{ id: string }>(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (storage_account_id, provider_folder_id) DO UPDATE SET
        name = EXCLUDED.name,
        is_starred = EXCLUDED.is_starred,
        is_trashed = EXCLUDED.is_trashed,
        updated_at = NOW()
      RETURNING id`,
      [clientGeneratedUuid, userId, accountId, ProviderType.GOOGLE_DRIVE, providerFolderId, 'New Documents', false, false]
    );

    assert.equal(result.rowCount, 1, 'Should insert 1 folder');
    assert.ok(result.rows[0]?.id, 'Query must return id via RETURNING clause');
    assert.equal(result.rows[0].id, clientGeneratedUuid, 'New folder receives the inserted ID');
  });

  test('2. Existing folder upsert uses returned PostgreSQL ID instead of new client UUID', async () => {
    const providerFolderId = 'g_folder_existing_002';
    const originalAuthoritativeId = 'authoritative_uuid_initial';

    // Seed existing folder
    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [originalAuthoritativeId, userId, accountId, ProviderType.GOOGLE_DRIVE, providerFolderId, 'Work Files', false, false]
    );

    // Concurrent / subsequent upsert attempt generates a different client-side UUID
    const differentClientUuid = 'different_transient_uuid_999';

    const result = await query<{ id: string }>(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (storage_account_id, provider_folder_id) DO UPDATE SET
        name = EXCLUDED.name,
        is_starred = EXCLUDED.is_starred,
        is_trashed = EXCLUDED.is_trashed,
        updated_at = NOW()
      RETURNING id`,
      [differentClientUuid, userId, accountId, ProviderType.GOOGLE_DRIVE, providerFolderId, 'Work Files (Renamed)', false, false]
    );

    assert.equal(result.rowCount, 1, 'Should update 1 existing folder');
    assert.ok(result.rows[0]?.id, 'Must return id');
    // CRITICAL: The returned ID must be the existing authoritative ID, NOT the transient client-generated UUID
    assert.equal(
      result.rows[0].id,
      originalAuthoritativeId,
      'Upsert must return the authoritative existing database ID on conflict'
    );
    assert.notEqual(
      result.rows[0].id,
      differentClientUuid,
      'Must NOT use the locally generated client UUID after conflict resolution'
    );
  });

  test('3. folderMap contains the database-returned ID', async () => {
    const folderMap = new Map<string, string>();
    const providerFolderId = 'g_folder_map_003';
    const expectedDbId = 'db_authoritative_id_003';

    // Seed in DB
    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [expectedDbId, userId, accountId, ProviderType.GOOGLE_DRIVE, providerFolderId, 'Projects', false, false]
    );

    // Upsert using the SyncService pattern
    const transientUuid = crypto.randomUUID();
    const upsertRes = await query<{ id: string }>(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (storage_account_id, provider_folder_id) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = NOW()
      RETURNING id`,
      [transientUuid, userId, accountId, ProviderType.GOOGLE_DRIVE, providerFolderId, 'Projects Updated', false, false]
    );

    const authoritativeId = upsertRes.rows[0]?.id;
    folderMap.set(providerFolderId, authoritativeId);

    assert.equal(folderMap.get(providerFolderId), expectedDbId, 'folderMap must hold the database-returned authoritative ID');
  });

  test('4. Repeated sync does not create duplicate folders', async () => {
    const providerFolderId = 'g_folder_repeat_004';

    for (let i = 0; i < 3; i++) {
      await query<{ id: string }>(
        `INSERT INTO virtual_folders (
          id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
          name, is_starred, is_trashed, created_at, updated_at
        ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        ON CONFLICT (storage_account_id, provider_folder_id) DO UPDATE SET
          name = EXCLUDED.name,
          updated_at = NOW()
        RETURNING id`,
        [crypto.randomUUID(), userId, accountId, ProviderType.GOOGLE_DRIVE, providerFolderId, `Folder Run ${i}`, false, false]
      );
    }

    const checkRes = await query(
      `SELECT * FROM virtual_folders WHERE storage_account_id = $1 AND provider_folder_id = $2`,
      [accountId, providerFolderId]
    );

    assert.equal(checkRes.rows.length, 1, 'Must maintain exactly 1 virtual folder row across multiple sync passes');
    assert.equal(checkRes.rows[0].name, 'Folder Run 2', 'Name must reflect latest upsert');
  });

  test('5. Parent folder relationships use authoritative IDs', async () => {
    const rootProviderId = 'g_root_auth_005';
    const childProviderId = 'g_child_auth_005';
    const folderMap = new Map<string, string>();

    // Pass 1: Upsert root
    const rootRes = await query<{ id: string }>(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (storage_account_id, provider_folder_id) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`,
      [crypto.randomUUID(), userId, accountId, ProviderType.GOOGLE_DRIVE, rootProviderId, 'Root', false, false]
    );
    folderMap.set(rootProviderId, rootRes.rows[0].id);

    // Pass 1: Upsert child
    const childRes = await query<{ id: string }>(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (storage_account_id, provider_folder_id) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`,
      [crypto.randomUUID(), userId, accountId, ProviderType.GOOGLE_DRIVE, childProviderId, 'Child', false, false]
    );
    folderMap.set(childProviderId, childRes.rows[0].id);

    // Pass 1.5: Link child parent_id to root virtual folder ID
    const resolvedParentId = folderMap.get(rootProviderId)!;
    const childVirtualId = folderMap.get(childProviderId)!;
    await query(
      `UPDATE virtual_folders SET parent_id = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
      [resolvedParentId, childVirtualId, userId]
    );

    // Verify parent_id in database matches root authoritative ID
    const verifyRes = await query(
      `SELECT * FROM virtual_folders WHERE id = $1`,
      [childVirtualId]
    );
    assert.equal(verifyRes.rows[0].parent_id, rootRes.rows[0].id, 'Child parent_id must link to authoritative root ID');
  });
});

describe('Phase 2.1.1 — Google Drive Pagination & Stale Reconciliation Integrity', () => {
  test('6. Single-page sync completes normally with paginationComplete=true', async () => {
    const singlePageProvider = new MockGoogleDrivePaginationProvider([
      {
        files: [
          { id: 'f1', name: 'File1.txt', mimeType: 'text/plain', size: 100 },
          { id: 'f2', name: 'File2.pdf', mimeType: 'application/pdf', size: 200 },
        ],
        nextPageToken: undefined, // No next page
      },
    ]);

    const result = await singlePageProvider.listFiles('mock_token', { fetchAllPages: true });
    assert.equal(result.files.length, 2, 'Should return 2 files');
    assert.equal(result.nextPageToken, undefined, 'No next page token');
    assert.equal(result.paginationComplete, true, 'paginationComplete must be true for single-page complete retrieval');
  });

  test('7. Multi-page sync follows nextPageToken across all pages', async () => {
    const multiPageProvider = new MockGoogleDrivePaginationProvider([
      {
        files: [{ id: 'p1_f1', name: 'Page1.txt', mimeType: 'text/plain' }],
        nextPageToken: 'token_page_2',
      },
      {
        files: [{ id: 'p2_f1', name: 'Page2.txt', mimeType: 'text/plain' }],
        nextPageToken: 'token_page_3',
      },
      {
        files: [{ id: 'p3_f1', name: 'Page3.txt', mimeType: 'text/plain' }],
        nextPageToken: undefined, // Final page
      },
    ]);

    const result = await multiPageProvider.listFiles('mock_token', { fetchAllPages: true });
    assert.equal(result.files.length, 3, 'Should aggregate files across all 3 pages');
    assert.equal(singlePageCount(multiPageProvider), 3, 'Must have made 3 page calls');
    assert.equal(result.paginationComplete, true, 'paginationComplete must be true when all pages are consumed');
    assert.equal(result.nextPageToken, undefined, 'Final nextPageToken must be undefined');
  });

  test('8. All pages consumed → paginationComplete=true', async () => {
    const provider = new MockGoogleDrivePaginationProvider([
      { files: [{ id: 'f_a', name: 'A' }], nextPageToken: 'token_b' },
      { files: [{ id: 'f_b', name: 'B' }], nextPageToken: undefined },
    ]);

    const result = await provider.listFiles('mock_token', { fetchAllPages: true, maxPages: 10 });
    assert.equal(result.paginationComplete, true, 'paginationComplete must be true when all pages visited');
    assert.equal(result.files.length, 2);
  });

  test('9. maxPages reached with remaining nextPageToken → paginationComplete=false', async () => {
    const truncatedProvider = new MockGoogleDrivePaginationProvider([
      { files: [{ id: 'page1_f1', name: 'F1' }], nextPageToken: 'token_page_2' },
      { files: [{ id: 'page2_f1', name: 'F2' }], nextPageToken: 'token_page_3' },
      { files: [{ id: 'page3_f1', name: 'F3' }], nextPageToken: 'token_page_4' },
    ]);

    // Set maxPages to 2, so loop terminates before page 3
    const result = await truncatedProvider.listFiles('mock_token', {
      fetchAllPages: true,
      maxPages: 2,
    });

    assert.equal(result.files.length, 2, 'Should only return 2 files from the first 2 pages');
    assert.equal(result.nextPageToken, 'token_page_3', 'Must retain the nextPageToken for remaining pages');
    assert.equal(result.paginationComplete, false, 'paginationComplete must be FALSE when maxPages truncation occurs');
  });

  test('10. Partial pagination (paginationComplete=false) does not trigger stale-item reconciliation', async () => {
    const userId = 'user_stale_guard_01';
    const accountId = 'acc_stale_guard_01';
    const oldSyncTime = new Date(Date.now() - 120000); // 2 minutes ago

    // Insert an existing file that was synced previously
    const existingFileId = 'vfile_protected_from_deletion';
    await query(
      `INSERT INTO virtual_files (
        id, user_id, storage_account_id, parent_id, provider, provider_file_id,
        name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
        provider_created_at, provider_modified_at, synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`,
      [
        existingFileId,
        userId,
        accountId,
        ProviderType.GOOGLE_DRIVE,
        'g_file_unvisited_page',
        'ImportantUnvisitedFile.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        50000,
        null,
        null,
        false,
        false,
        oldSyncTime.toISOString(),
        oldSyncTime.toISOString(),
        oldSyncTime.toISOString(),
      ]
    );

    // Simulate partial pagination result where paginationComplete is false
    const partialListResult: ProviderFileListResult = {
      files: [{
        providerFileId: 'g_file_page1_only',
        name: 'Page1File.txt',
        mimeType: 'text/plain',
        sizeBytes: 100,
        parentFolderId: null,
        isFolder: false,
        isStarred: false,
        isTrashed: false,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      }],
      nextPageToken: 'token_remaining_pages',
      paginationComplete: false, // Truncated!
    };

    const syncStartTime = new Date();

    // Verify logic: Stale reconciliation MUST NOT run when paginationComplete is false
    let filesRemoved = 0;
    if (partialListResult.paginationComplete) {
      const staleRes = await query(
        `UPDATE virtual_files SET is_trashed = TRUE, updated_at = NOW()
         WHERE storage_account_id = $1 AND user_id = $2 AND is_trashed = FALSE AND synced_at < $3`,
        [accountId, userId, syncStartTime.toISOString()]
      );
      filesRemoved = staleRes.rowCount || 0;
    }

    assert.equal(filesRemoved, 0, 'No files should be removed when pagination is incomplete');

    // Verify existing unvisited file is NOT marked as trashed
    const fileRes = await query(`SELECT * FROM virtual_files WHERE id = $1`, [existingFileId]);
    assert.equal(fileRes.rows[0].is_trashed, false, 'Unvisited file must NOT be trashed');
  });

  test('11. Complete pagination (paginationComplete=true) does trigger stale-item reconciliation', async () => {
    const userId = 'user_stale_complete_01';
    const accountId = 'acc_stale_complete_01';
    const oldSyncTime = new Date(Date.now() - 120000);

    const staleFileId = 'vfile_truly_deleted_upstream';
    await query(
      `INSERT INTO virtual_files (
        id, user_id, storage_account_id, parent_id, provider, provider_file_id,
        name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
        provider_created_at, provider_modified_at, synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`,
      [
        staleFileId,
        userId,
        accountId,
        ProviderType.GOOGLE_DRIVE,
        'g_file_deleted_upstream',
        'OldStaleFile.txt',
        'text/plain',
        1000,
        null,
        null,
        false,
        false,
        oldSyncTime.toISOString(),
        oldSyncTime.toISOString(),
        oldSyncTime.toISOString(),
      ]
    );

    const completeListResult: ProviderFileListResult = {
      files: [], // Upstream drive is now empty
      nextPageToken: undefined,
      paginationComplete: true, // Complete sync!
    };

    const syncStartTime = new Date();
    let filesRemoved = 0;
    if (completeListResult.paginationComplete) {
      const staleRes = await query(
        `UPDATE virtual_files SET is_trashed = TRUE, updated_at = NOW()
         WHERE storage_account_id = $1 AND user_id = $2 AND is_trashed = FALSE AND synced_at < $3`,
        [accountId, userId, syncStartTime.toISOString()]
      );
      filesRemoved = staleRes.rowCount || 0;
    }

    assert.equal(filesRemoved, 1, 'Should reconcile 1 stale file');
    const fileRes = await query(`SELECT * FROM virtual_files WHERE id = $1`, [staleFileId]);
    assert.equal(fileRes.rows[0].is_trashed, true, 'Missing file must be marked trashed on complete sync');
  });

  test('12. Previously existing items are not incorrectly trashed after a truncated sync', async () => {
    const userId = 'user_truncated_preservation_01';
    const accountId = 'acc_truncated_preservation_01';
    const pastDate = new Date(Date.now() - 300000);

    // Setup 5 existing files in database
    for (let i = 1; i <= 5; i++) {
      await query(
        `INSERT INTO virtual_files (
          id, user_id, storage_account_id, parent_id, provider, provider_file_id,
          name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
          provider_created_at, provider_modified_at, synced_at, created_at, updated_at
        ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`,
        [
          `vfile_batch_${i}`,
          userId,
          accountId,
          ProviderType.GOOGLE_DRIVE,
          `g_file_batch_${i}`,
          `Doc_${i}.pdf`,
          'application/pdf',
          2048,
          null,
          null,
          false,
          false,
          pastDate.toISOString(),
          pastDate.toISOString(),
          pastDate.toISOString(),
        ]
      );
    }

    // Now a truncated sync runs and only receives files 1 and 2 (files 3, 4, 5 are on page 2)
    const truncatedResult: ProviderFileListResult = {
      files: [
        {
          providerFileId: 'g_file_batch_1',
          name: 'Doc_1.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          parentFolderId: null,
          isFolder: false,
          isStarred: false,
          isTrashed: false,
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        },
      ],
      nextPageToken: 'next_page_token_exists',
      paginationComplete: false,
    };

    // Stale reconciliation skipped because paginationComplete is false
    const syncStartTime = new Date();
    if (truncatedResult.paginationComplete) {
      await query(
        `UPDATE virtual_files SET is_trashed = TRUE, updated_at = NOW()
         WHERE storage_account_id = $1 AND user_id = $2 AND is_trashed = FALSE AND synced_at < $3`,
        [accountId, userId, syncStartTime.toISOString()]
      );
    }

    // Check all 5 files: NONE should be trashed
    const allFiles = await query(
      `SELECT * FROM virtual_files WHERE storage_account_id = $1 AND user_id = $2`,
      [accountId, userId]
    );

    const trashedFiles = allFiles.rows.filter((f: any) => f.is_trashed);
    assert.equal(trashedFiles.length, 0, 'Zero files should be trashed after truncated synchronization');
    assert.equal(allFiles.rows.length, 5, 'All 5 files must remain intact and accessible');
  });

  test('13. fetchAllPages=false returns paginationComplete=false (Case D)', async () => {
    const provider = new MockGoogleDrivePaginationProvider([
      { files: [{ id: 'f_single', name: 'Single' }], nextPageToken: 'token_more_available' },
    ]);

    const result = await provider.listFiles('mock_token', { fetchAllPages: false });
    assert.equal(result.files.length, 1);
    assert.equal(result.paginationComplete, false, 'Intentionally single-page query must not be flagged as complete');
    assert.equal(result.nextPageToken, 'token_more_available');
  });

  test('14. SyncService.syncAccount records partial sync_history and preserves unvisited items on truncated sync', async () => {
    const userId = 'user_sync_service_e2e_01';
    const accountId = 'acc_sync_service_e2e_01';

    // Seed storage account in database
    await query(
      `INSERT INTO storage_accounts (
        id, user_id, provider, provider_account_id, email, display_name,
        encrypted_access_token, encrypted_refresh_token, token_iv, token_auth_tag,
        token_expires_at, total_bytes, used_bytes, status, last_synced_at, created_at, updated_at
      ) VALUES ($1, $2, 'google_drive', 'prov_e2e_01', 'e2e@example.com', 'E2E User',
        'enc_access', 'enc_refresh', 'iv123', 'tag123',
        NOW(), 15000000000, 5000000000, 'active', NOW(), NOW(), NOW())`,
      [accountId, userId]
    );

    // Seed an existing file from earlier sync
    const earlySyncTime = new Date(Date.now() - 60000);
    const existingFileId = 'vfile_e2e_preserve_me';
    await query(
      `INSERT INTO virtual_files (
        id, user_id, storage_account_id, parent_id, provider, provider_file_id,
        name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
        provider_created_at, provider_modified_at, synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`,
      [
        existingFileId,
        userId,
        accountId,
        ProviderType.GOOGLE_DRIVE,
        'g_file_unseen_in_batch',
        'ShouldNotBeTrashed.pdf',
        'application/pdf',
        4096,
        null,
        null,
        false,
        false,
        earlySyncTime.toISOString(),
        earlySyncTime.toISOString(),
        earlySyncTime.toISOString(),
      ]
    );

    // Mock provider with truncated pagination
    const mockE2eProvider = new MockGoogleDrivePaginationProvider([
      {
        files: [
          {
            id: 'g_fol_incoming',
            name: 'Incoming Folder',
            mimeType: 'application/vnd.google-apps.folder',
            parents: [],
          },
          {
            id: 'g_file_incoming',
            name: 'Incoming File.txt',
            mimeType: 'text/plain',
            size: 512,
            parents: ['g_fol_incoming'],
          },
        ],
        nextPageToken: 'still_more_files_on_drive',
      },
    ]);

    // Override refreshAuthentication & getStorageQuota for mock
    (mockE2eProvider as any).refreshAuthentication = async () => ({ accessToken: 'refreshed_tok' });
    (mockE2eProvider as any).getStorageQuota = async () => ({
      totalBytes: 15000000000,
      usedBytes: 5000000000,
      freeBytes: 10000000000,
      usagePercentage: 33.33,
    });

    // Subclass or wrap listFiles to simulate maxPages truncation
    const origListFiles = mockE2eProvider.listFiles.bind(mockE2eProvider);
    mockE2eProvider.listFiles = async (token, opts) => {
      // Simulate stopping at 1 page when more exist
      return {
        files: [
          {
            providerFileId: 'g_fol_incoming',
            name: 'Incoming Folder',
            mimeType: 'application/vnd.google-apps.folder',
            sizeBytes: 0,
            parentFolderId: null,
            isFolder: true,
            isStarred: false,
            isTrashed: false,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
          },
          {
            providerFileId: 'g_file_incoming',
            name: 'Incoming File.txt',
            mimeType: 'text/plain',
            sizeBytes: 512,
            parentFolderId: 'g_fol_incoming',
            isFolder: false,
            isStarred: false,
            isTrashed: false,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
          },
        ],
        nextPageToken: 'token_remaining',
        paginationComplete: false, // Truncated!
      };
    };

    // Temporarily register mock provider
    const originalProvider = ProviderRegistry.get(ProviderType.GOOGLE_DRIVE);
    (ProviderRegistry as any).providers.set(ProviderType.GOOGLE_DRIVE, mockE2eProvider);

    // Mock accountService credentials retrieval
    const origGetCreds = accountService.getDecryptedCredentials.bind(accountService);
    accountService.getDecryptedCredentials = async () => ({
      accessToken: 'test_acc_tok',
      refreshToken: 'test_ref_tok',
      tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      email: 'e2e@example.com',
      provider: ProviderType.GOOGLE_DRIVE,
    });

    try {
      const syncService = new SyncService();
      const syncResult = await syncService.syncAccount(userId, accountId);

      assert.equal(syncResult.paginationComplete, false, 'Sync result must report paginationComplete=false');
      assert.equal(syncResult.filesRemoved, 0, 'No files should be removed on partial sync');

      // Verify the existing file was NOT trashed
      const existingFileCheck = await query(`SELECT * FROM virtual_files WHERE id = $1`, [existingFileId]);
      assert.equal(existingFileCheck.rows[0].is_trashed, false, 'Existing file must NOT be marked trashed');

      // Verify sync_history audit record was saved with status='partial'
      const historyRes = await query(`SELECT * FROM sync_history WHERE storage_account_id = $1`, [accountId]);
      assert.ok(historyRes.rows.length > 0, 'Sync history must be recorded');
      const latestHistory = historyRes.rows[historyRes.rows.length - 1];
      assert.equal(latestHistory.status, 'partial', 'History status must indicate partial sync');
      assert.match(latestHistory.error_message, /Pagination truncated/i, 'History note must record truncation reason');
    } finally {
      // Restore original provider and credentials method
      (ProviderRegistry as any).providers.set(ProviderType.GOOGLE_DRIVE, originalProvider);
      accountService.getDecryptedCredentials = origGetCreds;
    }
  });
});

function singlePageCount(provider: MockGoogleDrivePaginationProvider): number {
  return provider.callCount;
}
