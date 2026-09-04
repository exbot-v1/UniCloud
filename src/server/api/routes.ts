/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud API Routes Architecture
 * 
 * Central API router establishing route conventions, error boundaries,
 * and unified response formats.
 */

import { Router, Request, Response } from 'express';
import { sendApiError, AppError } from '../utils/errors';
import { ApiResponse, ErrorCode } from '../../types/api';
import { storageService } from '../services/StorageService';
import { uploadService } from '../services/UploadService';
import { UploadRoutingStrategy } from '../../types/upload';
import { ProviderType, AccountStatus } from '../../types/account';

export const apiRouter = Router();

// -----------------------------------------------------------------------------
// GET /api/health
// -----------------------------------------------------------------------------
apiRouter.get('/health', (_req: Request, res: Response) => {
  const response: ApiResponse<{
    status: string;
    version: string;
    phase: string;
    environment: string;
    serverTime: string;
  }> = {
    success: true,
    data: {
      status: 'operational',
      version: '1.0.0-phase0',
      phase: 'Phase 0: Master Architecture & Project Foundation',
      environment: process.env.NODE_ENV || 'development',
      serverTime: new Date().toISOString(),
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.0.0-phase0',
    },
  };
  res.json(response);
});

// -----------------------------------------------------------------------------
// GET /api/spec/status
// Architectural status overview
// -----------------------------------------------------------------------------
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
      currentPhase: 0,
      phaseName: 'Phase 0: Master Architecture & Project Foundation',
      completedMilestones: [
        'StorageProvider interface & GoogleDriveProvider scaffold',
        'AES-256-GCM token encryption utilities (zero client-token exposure)',
        'PostgreSQL schema DDL (users, storage_accounts, virtual_files, virtual_folders, upload_jobs)',
        'Domain service abstraction layer (Account, File, Folder, Storage, Upload, Sync, Search)',
        'Upload routing interface supporting dynamic capacity balancing',
        'Standardized API error models and redacting logger',
        'UniCloud modern desktop/responsive application shell',
      ],
      upcomingPhases: [
        'Phase 1: Database Setup & User Authentication',
        'Phase 2: Google OAuth 2.0 & Drive API Connection',
        'Phase 3: Virtual Filesystem Synchronization & Operations',
        'Phase 4: Resumable Upload Routing Engine',
        'Phase 5: Advanced Search & Quota Optimization',
      ],
      architecturalGuarantees: [
        'Zero client exposure: Google OAuth refresh tokens NEVER touch browser JS',
        'Virtual filesystem abstraction: Files physically stay in individual Google Drive accounts',
        'Scalable multi-account design: Unlimited connected accounts per user',
        'Provider agnostic: Extensible to OneDrive/S3 via StorageProvider interface',
      ],
    },
  };
  res.json(response);
});

// -----------------------------------------------------------------------------
// GET /api/storage/pool
// -----------------------------------------------------------------------------
apiRouter.get('/storage/pool', (_req: Request, res: Response) => {
  try {
    // In Phase 0, returns the initial zero-state pool contract
    const summary = storageService.calculatePoolMetrics([]);
    const response: ApiResponse<typeof summary> = {
      success: true,
      data: summary,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0.0-phase0',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});

// -----------------------------------------------------------------------------
// POST /api/upload/route-check
// Dry-run preview of the upload routing algorithm
// -----------------------------------------------------------------------------
apiRouter.post('/upload/route-check', (req: Request, res: Response) => {
  try {
    const { sizeBytes, strategy } = req.body;
    if (!sizeBytes || typeof sizeBytes !== 'number' || sizeBytes <= 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'sizeBytes must be a positive number');
    }

    // Demo accounts for previewing routing behavior
    const demoAccounts = [
      {
        id: 'acc-1',
        userId: 'demo-user',
        provider: ProviderType.GOOGLE_DRIVE,
        providerAccountId: 'google-sub-1',
        email: 'personal.drive@gmail.com',
        displayName: 'Personal Drive',
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
        id: 'acc-2',
        userId: 'demo-user',
        provider: ProviderType.GOOGLE_DRIVE,
        providerAccountId: 'google-sub-2',
        email: 'work.vault@gmail.com',
        displayName: 'Work Vault',
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
        id: 'acc-3',
        userId: 'demo-user',
        provider: ProviderType.GOOGLE_DRIVE,
        providerAccountId: 'google-sub-3',
        email: 'media.archive@gmail.com',
        displayName: 'Media Archive',
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

    const decision = uploadService.evaluateRouting(
      demoAccounts,
      sizeBytes,
      strategy || UploadRoutingStrategy.MOST_FREE_SPACE
    );

    const response: ApiResponse<typeof decision> = {
      success: true,
      data: decision,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0.0-phase0',
      },
    };
    res.json(response);
  } catch (err) {
    sendApiError(res, err);
  }
});
