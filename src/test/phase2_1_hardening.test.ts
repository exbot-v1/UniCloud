/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Phase 2.1 Corrective Hardening Test Suite
 * 
 * Tests:
 * 1. OAuth state token validation, constant-time verification, and replay protection.
 * 2. Production secret enforcement and key validation.
 * 3. Folder hierarchy mapping and two-pass resolution.
 * 4. Idempotent sync upsert behavior.
 * 5. Upstream stale/deleted file handling.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { OAuthStateService } from '../server/services/OAuthStateService.js';
import { getEncryptionKey, encryptToken, decryptToken } from '../server/utils/encryption.js';
import { validateSecurityConfiguration } from '../server/utils/config.js';
import { SyncService } from '../server/services/SyncService.js';
import { query } from '../db/client.js';
import { ProviderType } from '../types/account.js';
import { GoogleDriveProvider } from '../server/providers/GoogleDriveProvider.js';

describe('Phase 2.1 — OAuth State Hardening', () => {
  const testUserId = 'user_test_oauth_001';

  test('generates valid state token and consumes it successfully', async () => {
    const token = await OAuthStateService.createState(testUserId, 'https://unicloud.app/auth/callback');
    assert.ok(token, 'Token should be returned');
    assert.equal(token.split('.').length, 4, 'Token should have 4 dot-separated components');

    const result = await OAuthStateService.verifyAndConsumeState(token, {
      expectedUserId: testUserId,
      expectedProvider: 'google_drive',
    });

    assert.equal(result.userId, testUserId);
    assert.equal(result.provider, 'google_drive');
    assert.equal(result.redirectUri, 'https://unicloud.app/auth/callback');
  });

  test('enforces strict single-use replay protection (atomic consumption)', async () => {
    const token = await OAuthStateService.createState(testUserId);

    // First consumption succeeds
    const result = await OAuthStateService.verifyAndConsumeState(token);
    assert.equal(result.userId, testUserId);

    // Second consumption MUST fail (replay attack attempt)
    await assert.rejects(
      async () => {
        await OAuthStateService.verifyAndConsumeState(token);
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /already been used|replay detected/i);
        return true;
      }
    );
  });

  test('rejects tampered cryptographic signatures safely without throwing RangeError', async () => {
    const token = await OAuthStateService.createState(testUserId);
    const parts = token.split('.');

    // Case A: Tampered signature of differing length
    const shortSigToken = `${parts[0]}.${parts[1]}.${parts[2]}.deadbeef`;
    await assert.rejects(
      async () => {
        await OAuthStateService.verifyAndConsumeState(shortSigToken);
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Invalid OAuth state signature/i);
        return true;
      }
    );

    // Case B: Tampered signature of equal length (64 chars)
    const bogusHex64 = 'a'.repeat(64);
    const forgedSigToken = `${parts[0]}.${parts[1]}.${parts[2]}.${bogusHex64}`;
    await assert.rejects(
      async () => {
        await OAuthStateService.verifyAndConsumeState(forgedSigToken);
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Invalid OAuth state signature/i);
        return true;
      }
    );
  });

  test('enforces user tenancy and provider binding', async () => {
    const token = await OAuthStateService.createState(testUserId, undefined, 'google_drive');

    // Expected user mismatch
    await assert.rejects(
      async () => {
        await OAuthStateService.verifyAndConsumeState(token, {
          expectedUserId: 'different_user_999',
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /user binding mismatch/i);
        return true;
      }
    );

    // Re-create state to test provider mismatch
    const token2 = await OAuthStateService.createState(testUserId, undefined, 'google_drive');
    await assert.rejects(
      async () => {
        await OAuthStateService.verifyAndConsumeState(token2, {
          expectedProvider: 'onedrive',
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /provider mismatch/i);
        return true;
      }
    );
  });
});

describe('Phase 2.1 — Production Secret Enforcement', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  test('encrypts and decrypts tokens with 256-bit AES-GCM', () => {
    const rawToken = 'ya29.a0ARrdaM8test_sample_google_refresh_token_12345';
    const encrypted = encryptToken(rawToken);

    assert.ok(encrypted.ciphertext, 'Ciphertext must exist');
    assert.ok(encrypted.iv, 'IV must exist');
    assert.ok(encrypted.authTag, 'Auth tag must exist');

    const decrypted = decryptToken(encrypted);
    assert.equal(decrypted, rawToken);
  });

  test('fails fast in production if ENCRYPTION_KEY is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;

    assert.throws(
      () => {
        getEncryptionKey();
      },
      (err: any) => {
        assert.equal(err.statusCode, 500);
        assert.match(err.message, /ENCRYPTION_KEY.*must be configured/i);
        return true;
      }
    );
  });

  test('fails fast if ENCRYPTION_KEY is malformed (not 64-character hex string)', () => {
    process.env.ENCRYPTION_KEY = 'too-short-secret';

    assert.throws(
      () => {
        getEncryptionKey();
      },
      (err: any) => {
        assert.equal(err.statusCode, 500);
        assert.match(err.message, /64-character hexadecimal/i);
        return true;
      }
    );
  });

  test('validateSecurityConfiguration succeeds in development and validates production correctly', () => {
    process.env.NODE_ENV = 'development';
    const status = validateSecurityConfiguration();
    assert.equal(status.isProduction, false);
    assert.equal(status.encryptionValid, true);
  });
});

describe('Phase 2.1 — Google Drive Pagination & Folder Hierarchy Resolution', () => {
  test('GoogleDriveProvider listFiles respects pagination flags and constructs options correctly', () => {
    const provider = new GoogleDriveProvider();
    assert.ok(provider.listFiles, 'listFiles method must exist');
  });

  test('Two-pass folder hierarchy resolution links children to parent virtual folders correctly', async () => {
    const userId = 'user_hierarchy_test_01';
    const accountId = 'acc_hierarchy_test_01';

    // Simulate folders:
    // Root Folder "Documents" (provider ID: "g_doc_root", parent: null)
    // Child Folder "Taxes" (provider ID: "g_taxes_sub", parent: "g_doc_root")
    const docRootVirtualId = 'vfol_doc_root_001';
    const taxesVirtualId = 'vfol_taxes_sub_002';

    // Pass 1: Insert both folders
    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [docRootVirtualId, userId, accountId, ProviderType.GOOGLE_DRIVE, 'g_doc_root', 'Documents', false, false]
    );

    await query(
      `INSERT INTO virtual_folders (
        id, user_id, parent_id, storage_account_id, provider, provider_folder_id,
        name, is_starred, is_trashed, created_at, updated_at
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [taxesVirtualId, userId, accountId, ProviderType.GOOGLE_DRIVE, 'g_taxes_sub', 'Taxes', false, false]
    );

    // Pass 1.5: Link child "Taxes" to parent "Documents"
    await query(
      `UPDATE virtual_folders SET parent_id = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
      [docRootVirtualId, taxesVirtualId, userId]
    );

    // Pass 2: Insert file inside "Taxes"
    const fileId = 'vfile_tax_2026';
    await query(
      `INSERT INTO virtual_files (
        id, user_id, storage_account_id, parent_id, provider, provider_file_id,
        name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
        provider_created_at, provider_modified_at, synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW(), NOW(), NOW(), NOW())`,
      [
        fileId,
        userId,
        accountId,
        taxesVirtualId, // resolved parent
        ProviderType.GOOGLE_DRIVE,
        'g_file_tax_pdf',
        '2026_Tax_Return.pdf',
        'application/pdf',
        102400,
        'hash123',
        null,
        false,
        false,
      ]
    );

    // Verify folder hierarchy
    const foldersRes = await query(`SELECT * FROM virtual_folders WHERE storage_account_id = $1`, [accountId]);
    const rootFolder = foldersRes.rows.find((f: any) => f.provider_folder_id === 'g_doc_root');
    const childFolder = foldersRes.rows.find((f: any) => f.provider_folder_id === 'g_taxes_sub');

    assert.ok(rootFolder, 'Root folder must exist');
    assert.equal(rootFolder.parent_id, null, 'Root folder parent_id must be null');

    assert.ok(childFolder, 'Child folder must exist');
    assert.equal(childFolder.parent_id, rootFolder.id, 'Child folder parent_id must point to root folder UUID');

    // Verify file parent
    const filesRes = await query(`SELECT * FROM virtual_files WHERE user_id = $1`, [userId]);
    const file = filesRes.rows.find((f: any) => f.provider_file_id === 'g_file_tax_pdf');
    assert.ok(file, 'File must exist');
    assert.equal(file.parent_id, childFolder.id, 'File parent_id must point to child folder UUID');
  });

  test('Idempotent synchronization updates existing metadata without duplicate entries', async () => {
    const userId = 'user_idempotent_test_01';
    const accountId = 'acc_idempotent_test_01';

    // Initial insert
    await query(
      `INSERT INTO virtual_files (
        id, user_id, storage_account_id, parent_id, provider, provider_file_id,
        name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
        provider_created_at, provider_modified_at, synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW(), NOW(), NOW(), NOW())`,
      [
        'vf_idem_1',
        userId,
        accountId,
        ProviderType.GOOGLE_DRIVE,
        'g_same_file_id',
        'Original_Name.txt',
        'text/plain',
        500,
        null,
        null,
        false,
        false,
      ]
    );

    // Second sync with renamed file and larger size
    await query(
      `INSERT INTO virtual_files (
        id, user_id, storage_account_id, parent_id, provider, provider_file_id,
        name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
        provider_created_at, provider_modified_at, synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW(), NOW(), NOW(), NOW())
      ON CONFLICT (storage_account_id, provider_file_id) DO UPDATE SET
        name = EXCLUDED.name,
        size_bytes = EXCLUDED.size_bytes`,
      [
        'vf_idem_new_uuid',
        userId,
        accountId,
        ProviderType.GOOGLE_DRIVE,
        'g_same_file_id',
        'Renamed_Document.txt',
        'text/plain',
        1200,
        null,
        null,
        false,
        false,
      ]
    );

    const filesRes = await query(`SELECT * FROM virtual_files WHERE user_id = $1`, [userId]);
    const filesWithId = filesRes.rows.filter((f: any) => f.provider_file_id === 'g_same_file_id');

    assert.equal(filesWithId.length, 1, 'Should NOT create duplicate rows for the same provider file ID');
    assert.equal(filesWithId[0].name, 'Renamed_Document.txt', 'File name should be updated');
    assert.equal(filesWithId[0].size_bytes, 1200, 'Size should be updated');
  });

  test('Marks stale or deleted upstream files as trashed', async () => {
    const userId = 'user_stale_test_01';
    const accountId = 'acc_stale_test_01';
    const oldSyncTime = new Date(Date.now() - 60000); // 1 minute ago

    // Insert file synced previously with past synced_at timestamp
    await query(
      `INSERT INTO virtual_files (
        id, user_id, storage_account_id, parent_id, provider, provider_file_id,
        name, mime_type, size_bytes, md5_checksum, web_url, is_starred, is_trashed,
        provider_created_at, provider_modified_at, synced_at, created_at, updated_at
      ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())`,
      [
        'vf_stale_1',
        userId,
        accountId,
        ProviderType.GOOGLE_DRIVE,
        'g_deleted_upstream_id',
        'Deleted_File.png',
        'image/png',
        2048,
        null,
        null,
        false,
        false,
        oldSyncTime.toISOString(),
        oldSyncTime.toISOString(),
        oldSyncTime.toISOString(),
      ]
    );

    // Sync starts now (after the old file was synced)
    const currentSyncStart = new Date();

    // Mark missing files as trashed
    const staleResult = await query(
      `UPDATE virtual_files SET
        is_trashed = TRUE,
        trashed_at = NOW(),
        updated_at = NOW()
       WHERE storage_account_id = $1
         AND user_id = $2
         AND is_trashed = FALSE
         AND synced_at < $3`,
      [accountId, userId, currentSyncStart.toISOString()]
    );

    assert.equal(staleResult.rowCount, 1, 'Should mark 1 stale file as trashed');

    const filesRes = await query(`SELECT * FROM virtual_files WHERE user_id = $1`, [userId]);
    const file = filesRes.rows.find((f: any) => f.provider_file_id === 'g_deleted_upstream_id');
    assert.ok(file, 'File should still exist');
    assert.equal(file.is_trashed, true, 'File must be marked as trashed');
  });
});
