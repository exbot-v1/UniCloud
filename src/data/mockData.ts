/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Phase 0 Architecture Demonstration Data
 * 
 * ARCHITECTURAL NOTICE:
 * This data is used solely to demonstrate the virtual filesystem UI,
 * multi-account quota aggregation, and storage-provider mapping in Phase 0.
 * It is clearly tagged as demo data and does not represent real OAuth sessions.
 */

import { StorageAccount, AccountStatus, ProviderType } from '../types/account';
import { VirtualFile, VirtualFolder } from '../types/filesystem';

export const DEMO_STORAGE_ACCOUNTS: StorageAccount[] = [
  {
    id: 'acc-demo-01',
    userId: 'demo-user-001',
    provider: ProviderType.GOOGLE_DRIVE,
    providerAccountId: 'google-demo-1049281',
    email: 'demo.drive1@gmail.com',
    displayName: 'Demo Drive 01',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
    status: AccountStatus.ACTIVE,
    tokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    quota: {
      totalBytes: 15 * 1024 * 1024 * 1024, // 15 GB
      usedBytes: 10.4 * 1024 * 1024 * 1024, // 10.4 GB
      freeBytes: 4.6 * 1024 * 1024 * 1024, // 4.6 GB
      usagePercentage: 69.3,
    },
    lastSyncedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-09-04T08:00:00Z',
  },
  {
    id: 'acc-demo-02',
    userId: 'demo-user-001',
    provider: ProviderType.GOOGLE_DRIVE,
    providerAccountId: 'google-demo-2098412',
    email: 'demo.drive2@gmail.com',
    displayName: 'Demo Drive 02',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80',
    status: AccountStatus.ACTIVE,
    tokenExpiresAt: new Date(Date.now() + 2400 * 1000).toISOString(),
    quota: {
      totalBytes: 15 * 1024 * 1024 * 1024, // 15 GB
      usedBytes: 6.2 * 1024 * 1024 * 1024, // 6.2 GB
      freeBytes: 8.8 * 1024 * 1024 * 1024, // 8.8 GB
      usagePercentage: 41.3,
    },
    lastSyncedAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
    createdAt: '2026-08-12T14:30:00Z',
    updatedAt: '2026-09-04T08:00:00Z',
  },
  {
    id: 'acc-demo-03',
    userId: 'demo-user-001',
    provider: ProviderType.GOOGLE_DRIVE,
    providerAccountId: 'google-demo-3981023',
    email: 'demo.drive3@gmail.com',
    displayName: 'Demo Drive 03',
    avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&auto=format&fit=crop&q=80',
    status: AccountStatus.ACTIVE,
    tokenExpiresAt: new Date(Date.now() + 1200 * 1000).toISOString(),
    quota: {
      totalBytes: 15 * 1024 * 1024 * 1024, // 15 GB
      usedBytes: 13.8 * 1024 * 1024 * 1024, // 13.8 GB
      freeBytes: 1.2 * 1024 * 1024 * 1024, // 1.2 GB
      usagePercentage: 92.0,
    },
    lastSyncedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    createdAt: '2026-08-20T09:15:00Z',
    updatedAt: '2026-09-04T08:00:00Z',
  },
];

export const DEMO_VIRTUAL_FOLDERS: VirtualFolder[] = [
  {
    id: 'folder-01',
    userId: 'user-001',
    storageAccountId: null, // Purely virtual folder spanning multiple accounts
    provider: null,
    providerFolderId: null,
    parentId: null,
    name: 'Work Documents',
    isFolder: true,
    isStarred: true,
    isTrashed: false,
    itemCount: 14,
    totalSizeBytes: 3.4 * 1024 * 1024 * 1024,
    createdAt: '2026-08-15T11:00:00Z',
    modifiedAt: '2026-09-02T16:20:00Z',
  },
  {
    id: 'folder-02',
    userId: 'user-001',
    storageAccountId: null,
    provider: null,
    providerFolderId: null,
    parentId: null,
    name: 'Raw Photos & Creative',
    isFolder: true,
    isStarred: false,
    isTrashed: false,
    itemCount: 38,
    totalSizeBytes: 12.1 * 1024 * 1024 * 1024,
    createdAt: '2026-08-22T08:00:00Z',
    modifiedAt: '2026-09-03T19:45:00Z',
  },
  {
    id: 'folder-03',
    userId: 'user-001',
    storageAccountId: null,
    provider: null,
    providerFolderId: null,
    parentId: null,
    name: 'System Archives & Backups',
    isFolder: true,
    isStarred: false,
    isTrashed: false,
    itemCount: 8,
    totalSizeBytes: 5.6 * 1024 * 1024 * 1024,
    createdAt: '2026-08-25T13:10:00Z',
    modifiedAt: '2026-09-01T12:00:00Z',
  },
];

export const DEMO_VIRTUAL_FILES: VirtualFile[] = [
  {
    id: 'file-01',
    userId: 'user-001',
    storageAccountId: 'acc-gdrive-02',
    provider: ProviderType.GOOGLE_DRIVE,
    providerFileId: '1AbC9823kLmNpQrStUvWxYz',
    parentId: 'folder-01',
    name: 'Q3_Financial_Forecast_Master.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 4.8 * 1024 * 1024, // 4.8 MB
    webUrl: 'https://docs.google.com/spreadsheets/d/1AbC9823kLmNpQrStUvWxYz',
    isFolder: false,
    isStarred: true,
    isTrashed: false,
    createdAt: '2026-08-28T10:14:00Z',
    modifiedAt: '2026-09-03T14:22:00Z',
    syncedAt: '2026-09-04T07:30:00Z',
  },
  {
    id: 'file-02',
    userId: 'user-001',
    storageAccountId: 'acc-gdrive-01',
    provider: ProviderType.GOOGLE_DRIVE,
    providerFileId: '2BcD8712mNoPqRsTuVwXyZa',
    parentId: 'folder-01',
    name: 'UniCloud_Architecture_Whitepaper.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 12.4 * 1024 * 1024, // 12.4 MB
    webUrl: 'https://drive.google.com/file/d/2BcD8712mNoPqRsTuVwXyZa/view',
    isFolder: false,
    isStarred: true,
    isTrashed: false,
    createdAt: '2026-08-30T16:00:00Z',
    modifiedAt: '2026-09-04T02:15:00Z',
    syncedAt: '2026-09-04T07:30:00Z',
  },
  {
    id: 'file-03',
    userId: 'user-001',
    storageAccountId: 'acc-gdrive-03',
    provider: ProviderType.GOOGLE_DRIVE,
    providerFileId: '3CdE7601nOpQrStUvWxYzAb',
    parentId: 'folder-02',
    name: 'Landscape_Hokkaido_Winter_RAW.dng',
    mimeType: 'image/x-adobe-dng',
    sizeBytes: 48.2 * 1024 * 1024, // 48.2 MB
    webUrl: 'https://drive.google.com/file/d/3CdE7601nOpQrStUvWxYzAb/view',
    isFolder: false,
    isStarred: false,
    isTrashed: false,
    createdAt: '2026-08-24T18:40:00Z',
    modifiedAt: '2026-08-24T18:40:00Z',
    syncedAt: '2026-09-04T07:30:00Z',
  },
  {
    id: 'file-04',
    userId: 'user-001',
    storageAccountId: 'acc-gdrive-02',
    provider: ProviderType.GOOGLE_DRIVE,
    providerFileId: '4DeF6590oPqRsTuVwXyZaBc',
    parentId: 'folder-01',
    name: 'Product_Roadmap_2026_Q4.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    sizeBytes: 28.6 * 1024 * 1024, // 28.6 MB
    webUrl: 'https://docs.google.com/presentation/d/4DeF6590oPqRsTuVwXyZaBc',
    isFolder: false,
    isStarred: false,
    isTrashed: false,
    createdAt: '2026-09-01T09:30:00Z',
    modifiedAt: '2026-09-03T11:10:00Z',
    syncedAt: '2026-09-04T07:30:00Z',
  },
  {
    id: 'file-05',
    userId: 'user-001',
    storageAccountId: 'acc-gdrive-03',
    provider: ProviderType.GOOGLE_DRIVE,
    providerFileId: '5EfG5489pQrStUvWxYzAbCd',
    parentId: 'folder-03',
    name: 'PostgreSQL_Database_Backup_20260901.sql.gz',
    mimeType: 'application/gzip',
    sizeBytes: 184.5 * 1024 * 1024, // 184.5 MB
    webUrl: 'https://drive.google.com/file/d/5EfG5489pQrStUvWxYzAbCd/view',
    isFolder: false,
    isStarred: false,
    isTrashed: false,
    createdAt: '2026-09-01T01:00:00Z',
    modifiedAt: '2026-09-01T01:05:00Z',
    syncedAt: '2026-09-04T07:30:00Z',
  },
  {
    id: 'file-06',
    userId: 'user-001',
    storageAccountId: 'acc-gdrive-01',
    provider: ProviderType.GOOGLE_DRIVE,
    providerFileId: '6FgH4378qRsTuVwXyZaBcDe',
    parentId: null, // Root file
    name: 'Executive_Summary_Brief.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 1.8 * 1024 * 1024,
    webUrl: 'https://docs.google.com/document/d/6FgH4378qRsTuVwXyZaBcDe',
    isFolder: false,
    isStarred: true,
    isTrashed: false,
    createdAt: '2026-09-02T15:12:00Z',
    modifiedAt: '2026-09-04T01:50:00Z',
    syncedAt: '2026-09-04T07:30:00Z',
  },
];
