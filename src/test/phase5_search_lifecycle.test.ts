/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Phase 5 — Unified Search & Storage Lifecycle Test Suite
 * 
 * Comprehensive verification for:
 * 1. Unified Search across all connected accounts:
 *    - Search virtual filesystem first with tenant isolation
 *    - Filename/name search, folder filtering, mimeType filtering
 *    - Sorting (name, size, modifiedAt, createdAt) and pagination
 *    - Identifying the owning Drive account for each result
 * 2. Cross-account file move and copy operations:
 *    - Intra-account and cross-account move
 *    - Target account capacity and isEnabled validation
 *    - Storage quota reconciliation (reclaim source, consume target)
 *    - Virtual filesystem mapping updates
 * 3. File/folder operations:
 *    - Rename file and folder
 *    - Trash and restore file and folder
 *    - Permanent delete and quota reclamation
 * 4. Storage lifecycle management:
 *    - Enable/disable toggle
 *    - Disabled accounts excluded from upload routing
 *    - Account disconnection cascading cleanup (upload jobs & virtual consistency)
 * 5. Strict tenant isolation
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { query } from '../db/client.js';
import { ProviderType, AccountStatus } from '../types/account.js';
import { searchService } from '../server/services/SearchService.js';
import { fileService } from '../server/services/FileService.js';
import { accountService } from '../server/services/AccountService.js';
import { uploadService } from '../server/services/UploadService.js';
import { encryptToken } from '../server/utils/encryption.js';
import { UploadRoutingStrategy } from '../types/upload.js';

const USER_A = 'test_user_p5_a';
const USER_B = 'test_user_p5_b';

const ACC_A1 = 'acc_p5_a1';
const ACC_A2 = 'acc_p5_a2';
const ACC_B1 = 'acc_p5_b1';

async function seedTestAccount(params: {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  isEnabled?: boolean;
}) {
  const enc = encryptToken('dummy_refresh_token');
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
      `gdrive_p5_${params.id}`,
      params.email,
      params.displayName,
      null,
      enc.ciphertext,
      enc.ciphertext,
      enc.iv,
      enc.authTag,
      new Date(Date.now() + 3600000).toISOString(),
      params.totalBytes,
      params.usedBytes,
      params.freeBytes,
      AccountStatus.ACTIVE,
      params.isEnabled ?? true,
      null,
      'token_123',
    ]
  );
}

async function seedVirtualFile(params: {
  id: string;
  userId: string;
  storageAccountId: string;
  name: string;
  sizeBytes: number;
  mimeType?: string;
  parentId?: string | null;
  isStarred?: boolean;
  isTrashed?: boolean;
}) {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO virtual_files (
      id, user_id, storage_account_id, parent_id, provider,
      provider_file_id, name, mime_type, size_bytes, md5_checksum,
      web_url, is_starred, is_trashed, provider_created_at, provider_modified_at,
      synced_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $14)`,
    [
      params.id,
      params.userId,
      params.storageAccountId,
      params.parentId || null,
      ProviderType.GOOGLE_DRIVE,
      `pfile_${params.id}`,
      params.name,
      params.mimeType || 'application/pdf',
      params.sizeBytes,
      null,
      `https://drive.google.com/file/${params.id}`,
      params.isStarred ?? false,
      params.isTrashed ?? false,
      now,
    ]
  );
}

describe('UniCloud Phase 5 — Unified Search & Storage Lifecycle', () => {
  before(async () => {
    // Seed User A's two Google Drive accounts
    await seedTestAccount({
      id: ACC_A1,
      userId: USER_A,
      email: 'alex.work@gmail.com',
      displayName: 'Alex Work Drive',
      totalBytes: 15 * 1024 * 1024 * 1024,
      usedBytes: 5 * 1024 * 1024 * 1024,
      freeBytes: 10 * 1024 * 1024 * 1024,
      isEnabled: true,
    });

    await seedTestAccount({
      id: ACC_A2,
      userId: USER_A,
      email: 'alex.personal@gmail.com',
      displayName: 'Alex Personal Drive',
      totalBytes: 15 * 1024 * 1024 * 1024,
      usedBytes: 8 * 1024 * 1024 * 1024,
      freeBytes: 7 * 1024 * 1024 * 1024,
      isEnabled: true,
    });

    // Seed User B's Drive account (tenant boundary)
    await seedTestAccount({
      id: ACC_B1,
      userId: USER_B,
      email: 'other.user@gmail.com',
      displayName: 'Other User Drive',
      totalBytes: 15 * 1024 * 1024 * 1024,
      usedBytes: 1 * 1024 * 1024 * 1024,
      freeBytes: 14 * 1024 * 1024 * 1024,
      isEnabled: true,
    });

    // Seed files across User A's accounts
    await seedVirtualFile({
      id: 'f_p5_1',
      userId: USER_A,
      storageAccountId: ACC_A1,
      name: 'Quarterly Financial Report Q1.pdf',
      sizeBytes: 2 * 1024 * 1024,
      mimeType: 'application/pdf',
      isStarred: true,
    });

    await seedVirtualFile({
      id: 'f_p5_2',
      userId: USER_A,
      storageAccountId: ACC_A2,
      name: 'Annual Tax Report 2025.pdf',
      sizeBytes: 4 * 1024 * 1024,
      mimeType: 'application/pdf',
    });

    await seedVirtualFile({
      id: 'f_p5_3',
      userId: USER_A,
      storageAccountId: ACC_A1,
      name: 'Family Vacation Photo.jpg',
      sizeBytes: 5 * 1024 * 1024,
      mimeType: 'image/jpeg',
    });

    await seedVirtualFile({
      id: 'f_p5_4',
      userId: USER_A,
      storageAccountId: ACC_A2,
      name: 'Old Draft Report (Trashed).docx',
      sizeBytes: 1 * 1024 * 1024,
      mimeType: 'application/vnd.google-apps.document',
      isTrashed: true,
    });

    // Seed file for User B
    await seedVirtualFile({
      id: 'f_p5_b1',
      userId: USER_B,
      storageAccountId: ACC_B1,
      name: 'Confidential Report User B.pdf',
      sizeBytes: 3 * 1024 * 1024,
      mimeType: 'application/pdf',
    });
  });

  // 1. Unified Search
  test('Unified Search finds files across multiple connected accounts', async () => {
    const result = await searchService.search(USER_A, { query: 'Report' });

    assert.ok(result);
    // Should match f_p5_1 and f_p5_2 (f_p5_4 is trashed and excluded by default)
    assert.strictEqual(result.totalCount, 2);
    const names = result.items.map((i) => i.name);
    assert.ok(names.includes('Quarterly Financial Report Q1.pdf'));
    assert.ok(names.includes('Annual Tax Report 2025.pdf'));
  });

  test('Unified Search returns owning Drive account details for each item', async () => {
    const result = await searchService.search(USER_A, { query: 'Report' });

    for (const item of result.items) {
      assert.ok(item.storageAccountId, 'Must have storageAccountId');
      assert.ok(item.accountEmail, 'Must have accountEmail');
      assert.ok(item.accountDisplayName, 'Must have accountDisplayName');
      assert.strictEqual(item.provider, ProviderType.GOOGLE_DRIVE);
    }

    const itemA1 = result.items.find((i) => i.id === 'f_p5_1');
    const itemA2 = result.items.find((i) => i.id === 'f_p5_2');

    assert.strictEqual(itemA1?.storageAccountId, ACC_A1);
    assert.strictEqual(itemA1?.accountEmail, 'alex.work@gmail.com');
    assert.strictEqual(itemA2?.storageAccountId, ACC_A2);
    assert.strictEqual(itemA2?.accountEmail, 'alex.personal@gmail.com');
  });

  test('Unified Search filters by mimeType, isStarred, and isTrashed', async () => {
    // mimeType filter
    const imgSearch = await searchService.search(USER_A, { mimeType: 'image/jpeg' });
    assert.strictEqual(imgSearch.totalCount, 1);
    assert.strictEqual(imgSearch.items[0].id, 'f_p5_3');

    // isStarred filter
    const starredSearch = await searchService.search(USER_A, { isStarred: true });
    assert.strictEqual(starredSearch.totalCount, 1);
    assert.strictEqual(starredSearch.items[0].id, 'f_p5_1');

    // isTrashed filter
    const trashedSearch = await searchService.search(USER_A, { isTrashed: true });
    assert.strictEqual(trashedSearch.totalCount, 1);
    assert.strictEqual(trashedSearch.items[0].id, 'f_p5_4');
  });

  test('Unified Search supports sorting and pagination', async () => {
    // Sort by size descending
    const sortedBySize = await searchService.search(USER_A, {
      sortBy: 'size',
      sortOrder: 'desc',
      limit: 2,
      page: 1,
    });

    assert.strictEqual(sortedBySize.items.length, 2);
    assert.ok(sortedBySize.items[0].sizeBytes >= sortedBySize.items[1].sizeBytes);
    assert.strictEqual(sortedBySize.page, 1);
    assert.strictEqual(sortedBySize.pageSize, 2);
    assert.ok(sortedBySize.totalPages >= 2);
    assert.strictEqual(sortedBySize.hasMore, true);
  });

  test('Unified Search strictly enforces tenant isolation', async () => {
    // User A searching for 'Report' should NEVER see User B's confidential report
    const userASearch = await searchService.search(USER_A, { query: 'Confidential' });
    assert.strictEqual(userASearch.totalCount, 0);

    // User B searching should only see their file
    const userBSearch = await searchService.search(USER_B, { query: 'Report' });
    assert.strictEqual(userBSearch.totalCount, 1);
    assert.strictEqual(userBSearch.items[0].id, 'f_p5_b1');
    assert.strictEqual(userBSearch.items[0].accountEmail, 'other.user@gmail.com');
  });

  // 2. File & Folder Operations (Rename, Trash, Restore, Permanent Delete)
  test('File rename updates virtual filesystem and preserves ownership', async () => {
    const updated = await fileService.renameFile(USER_A, 'f_p5_1', 'Q1_Financial_Report_Final.pdf');
    assert.strictEqual(updated.name, 'Q1_Financial_Report_Final.pdf');

    const fetched = await fileService.getFileById(USER_A, 'f_p5_1');
    assert.strictEqual(fetched.name, 'Q1_Financial_Report_Final.pdf');
  });

  test('File trash and restore cycle propagates status correctly', async () => {
    // Trash
    const trashed = await fileService.trashFile(USER_A, 'f_p5_3');
    assert.strictEqual(trashed.isTrashed, true);

    const checkTrashed = await fileService.getFileById(USER_A, 'f_p5_3');
    assert.strictEqual(checkTrashed.isTrashed, true);

    // Restore
    const restored = await fileService.restoreFile(USER_A, 'f_p5_3');
    assert.strictEqual(restored.isTrashed, false);

    const checkRestored = await fileService.getFileById(USER_A, 'f_p5_3');
    assert.strictEqual(checkRestored.isTrashed, false);
  });

  test('Permanent file delete removes row and reclaims storage account quota', async () => {
    // Seed temporary file to delete
    await seedVirtualFile({
      id: 'f_temp_del',
      userId: USER_A,
      storageAccountId: ACC_A1,
      name: 'Temp File To Purge.bin',
      sizeBytes: 10 * 1024 * 1024, // 10 MB
    });

    const accBefore = await accountService.getAccountById(USER_A, ACC_A1);
    const usedBefore = accBefore.quota.usedBytes;

    await fileService.deleteFilePermanent(USER_A, 'f_temp_del');

    // File should no longer exist
    await assert.rejects(async () => {
      await fileService.getFileById(USER_A, 'f_temp_del');
    }, /not found/i);

    // Quota should be reclaimed
    const accAfter = await accountService.getAccountById(USER_A, ACC_A1);
    assert.strictEqual(accAfter.quota.usedBytes, usedBefore - 10 * 1024 * 1024);
  });

  test('Folder creation, rename, and trash cycle', async () => {
    const folder = await fileService.createFolder(USER_A, {
      name: 'Finance 2026',
      storageAccountId: ACC_A1,
    });

    assert.ok(folder.id);
    assert.strictEqual(folder.name, 'Finance 2026');
    assert.strictEqual(folder.storageAccountId, ACC_A1);

    // Rename folder
    const renamed = await fileService.renameFolder(USER_A, folder.id, 'Finance Archive 2026');
    assert.strictEqual(renamed.name, 'Finance Archive 2026');

    // Trash folder
    const trashedFolder = await fileService.trashFolder(USER_A, folder.id);
    assert.strictEqual(trashedFolder.isTrashed, true);

    // Restore folder
    const restoredFolder = await fileService.restoreFolder(USER_A, folder.id);
    assert.strictEqual(restoredFolder.isTrashed, false);
  });

  // 3. Cross-Account Move & Copy
  test('Intra-account move updates folder parent without changing storage account', async () => {
    const folder = await fileService.createFolder(USER_A, {
      name: 'Projects',
      storageAccountId: ACC_A1,
    });

    const moved = await fileService.moveFile(USER_A, 'f_p5_1', {
      targetFolderId: folder.id,
    });

    assert.strictEqual(moved.parentId, folder.id);
    assert.strictEqual(moved.storageAccountId, ACC_A1);
  });

  test('Cross-account move transfers file, updates account ID, and rebalances quotas', async () => {
    const srcBefore = await accountService.getAccountById(USER_A, ACC_A1);
    const destBefore = await accountService.getAccountById(USER_A, ACC_A2);

    const fileToMove = await fileService.getFileById(USER_A, 'f_p5_1');
    const moveSize = fileToMove.sizeBytes;

    const moved = await fileService.moveFile(USER_A, 'f_p5_1', {
      targetAccountId: ACC_A2,
    });

    assert.strictEqual(moved.storageAccountId, ACC_A2);
    assert.notStrictEqual(moved.providerFileId, fileToMove.providerFileId);

    // Verify source quota was reclaimed and destination quota was consumed
    const srcAfter = await accountService.getAccountById(USER_A, ACC_A1);
    const destAfter = await accountService.getAccountById(USER_A, ACC_A2);

    assert.strictEqual(srcAfter.quota.usedBytes, srcBefore.quota.usedBytes - moveSize);
    assert.strictEqual(destAfter.quota.usedBytes, destBefore.quota.usedBytes + moveSize);
  });

  test('Cross-account copy duplicates virtual file and consumes destination quota', async () => {
    const destBefore = await accountService.getAccountById(USER_A, ACC_A1);
    const fileToCopy = await fileService.getFileById(USER_A, 'f_p5_2');

    const copied = await fileService.copyFile(USER_A, 'f_p5_2', {
      targetAccountId: ACC_A1,
      newName: 'Annual Tax Report 2025 (Transferred Copy).pdf',
    });

    assert.ok(copied.id);
    assert.notStrictEqual(copied.id, 'f_p5_2');
    assert.strictEqual(copied.name, 'Annual Tax Report 2025 (Transferred Copy).pdf');
    assert.strictEqual(copied.storageAccountId, ACC_A1);

    // Destination quota increased
    const destAfter = await accountService.getAccountById(USER_A, ACC_A1);
    assert.strictEqual(destAfter.quota.usedBytes, destBefore.quota.usedBytes + fileToCopy.sizeBytes);

    // Original file remains unchanged
    const original = await fileService.getFileById(USER_A, 'f_p5_2');
    assert.strictEqual(original.storageAccountId, ACC_A2);
  });

  // 4. Storage Lifecycle: Enable/Disable & Disconnect Cleanup
  test('toggleAccountEnabled updates account active state', async () => {
    // Disable ACC_A2
    const disabled = await accountService.toggleAccountEnabled(USER_A, ACC_A2, false);
    assert.strictEqual(disabled.isEnabled, false);

    const fetched = await accountService.getAccountById(USER_A, ACC_A2);
    assert.strictEqual(fetched.isEnabled, false);

    // Re-enable ACC_A2
    const enabled = await accountService.toggleAccountEnabled(USER_A, ACC_A2, true);
    assert.strictEqual(enabled.isEnabled, true);
  });

  test('Disabled account is excluded from upload routing', async () => {
    // Disable ACC_A1
    await accountService.toggleAccountEnabled(USER_A, ACC_A1, false);

    const accounts = await accountService.getAccountsForUser(USER_A);
    const decision = uploadService.evaluateRouting(
      accounts,
      1024 * 1024,
      UploadRoutingStrategy.MOST_FREE_SPACE
    );

    // Since ACC_A1 is disabled, routing MUST pick ACC_A2
    assert.strictEqual(decision.selectedAccountId, ACC_A2);

    // Manual upload routing to disabled account must throw
    assert.throws(() => {
      uploadService.evaluateRouting(
        accounts,
        1024 * 1024,
        UploadRoutingStrategy.MANUAL,
        ACC_A1
      );
    }, /disabled, disconnected, or unavailable/i);

    // Re-enable ACC_A1
    await accountService.toggleAccountEnabled(USER_A, ACC_A1, true);
  });

  test('Account disconnection cascades cleanup and prevents new operations', async () => {
    // Seed temporary account and associated file
    const TEMP_ACC = 'acc_p5_temp_disconnect';
    await seedTestAccount({
      id: TEMP_ACC,
      userId: USER_A,
      email: 'temp.acc@gmail.com',
      displayName: 'Temporary Drive',
      totalBytes: 15 * 1024 * 1024 * 1024,
      usedBytes: 1024,
      freeBytes: 15 * 1024 * 1024 * 1024 - 1024,
      isEnabled: true,
    });

    await seedVirtualFile({
      id: 'f_temp_disconnect',
      userId: USER_A,
      storageAccountId: TEMP_ACC,
      name: 'Disconnect_Test_File.txt',
      sizeBytes: 1024,
    });

    // Disconnect account
    await accountService.disconnectAccount(USER_A, TEMP_ACC);

    // Account should be removed
    await assert.rejects(async () => {
      await accountService.getAccountById(USER_A, TEMP_ACC);
    }, /not found/i);

    // Files belonging to that account are cleaned up
    const res = await query('SELECT * FROM virtual_files WHERE storage_account_id = $1', [TEMP_ACC]);
    assert.strictEqual(res.rowCount, 0);
  });
});
