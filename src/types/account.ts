/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Storage Account Data Models
 */

export enum ProviderType {
  GOOGLE_DRIVE = 'google_drive',
  // Future providers reserved for later expansion:
  // ONEDRIVE = 'onedrive',
  // DROPBOX = 'dropbox',
  // S3 = 's3',
}

export enum AccountStatus {
  ACTIVE = 'active',
  TOKEN_EXPIRED = 'token_expired',
  REVOKED = 'revoked',
  QUOTA_FULL = 'quota_full',
  SYNCING = 'syncing',
  ERROR = 'error',
}

export interface EncryptedTokenBundle {
  /** Encrypted ciphertext encoded in base64 */
  ciphertext: string;
  /** Initialization vector (12 bytes for AES-GCM) in base64 */
  iv: string;
  /** Authentication tag (16 bytes for AES-GCM) in base64 */
  authTag: string;
}

export interface StorageQuota {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercentage: number;
}

export interface StorageAccount {
  id: string;
  userId: string;
  provider: ProviderType;
  providerAccountId: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  status: AccountStatus;
  tokenExpiresAt: string | null;
  quota: StorageQuota;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Persisted Google Drive change token for delta sync (Phase 3) */
  driveChangeToken?: string | null;
  /** Metadata specific to the provider */
  providerMetadata?: Record<string, unknown>;
}

export interface StoragePoolSummary {
  totalAccounts: number;
  activeAccounts: number;
  totalCapacityBytes: number;
  totalUsedBytes: number;
  totalFreeBytes: number;
  usagePercentage: number;
  accounts: StorageAccount[];
}
