/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud UploadService & Routing Engine Interface
 * 
 * CORE ARCHITECTURAL PRINCIPLE:
 * Incoming files are dynamically routed to the connected Google Drive account
 * with the most appropriate capacity and health.
 */

import {
  UploadInitiateRequest,
  UploadJob,
  UploadRoutingDecision,
  UploadRoutingStrategy,
  UploadStatus,
} from '../../types/upload';
import { StorageAccount } from '../../types/account';
import { AppError } from '../utils/errors';
import { ErrorCode } from '../../types/api';
import { logger } from '../utils/logger';

export class UploadService {
  /**
   * Evaluates available storage accounts and selects the optimal account for upload.
   */
  evaluateRouting(
    accounts: StorageAccount[],
    fileSizeBytes: number,
    strategy: UploadRoutingStrategy = UploadRoutingStrategy.MOST_FREE_SPACE,
    preferredAccountId?: string
  ): UploadRoutingDecision {
    const activeAccounts = accounts.filter((a) => a.status === 'active');

    if (activeAccounts.length === 0) {
      throw new AppError(
        ErrorCode.ACCOUNT_NOT_CONNECTED,
        'No active storage accounts available. Please connect at least one Google Drive account.',
        400
      );
    }

    // 1. Manual selection if requested
    if (preferredAccountId) {
      const matched = activeAccounts.find((a) => a.id === preferredAccountId);
      if (!matched) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          `Preferred storage account ${preferredAccountId} is not active or found.`
        );
      }
      if (matched.quota.freeBytes < fileSizeBytes) {
        throw new AppError(
          ErrorCode.INSUFFICIENT_POOL_STORAGE,
          `Preferred account has insufficient space (${matched.quota.freeBytes} bytes available, ${fileSizeBytes} needed).`
        );
      }
      return {
        selectedAccountId: matched.id,
        strategyUsed: UploadRoutingStrategy.MANUAL,
        reason: 'Selected manually by user preference',
        availableCapacityBeforeBytes: matched.quota.freeBytes,
        projectedCapacityAfterBytes: matched.quota.freeBytes - fileSizeBytes,
      };
    }

    // 2. Filter accounts with sufficient free space
    const capableAccounts = activeAccounts.filter((a) => a.quota.freeBytes >= fileSizeBytes);

    if (capableAccounts.length === 0) {
      throw new AppError(
        ErrorCode.INSUFFICIENT_POOL_STORAGE,
        `None of the connected accounts have sufficient free space for ${fileSizeBytes} bytes.`
      );
    }

    // 3. Most Free Space strategy (default)
    capableAccounts.sort((a, b) => b.quota.freeBytes - a.quota.freeBytes);
    const chosen = capableAccounts[0];

    return {
      selectedAccountId: chosen.id,
      strategyUsed: strategy,
      reason: `Account '${chosen.email}' selected with highest available capacity (${Math.round(
        chosen.quota.freeBytes / (1024 * 1024)
      )} MB free).`,
      availableCapacityBeforeBytes: chosen.quota.freeBytes,
      projectedCapacityAfterBytes: chosen.quota.freeBytes - fileSizeBytes,
    };
  }

  /**
   * Initiates an upload job and returns the routing decision.
   */
  async initiateUpload(
    _userId: string,
    _req: UploadInitiateRequest,
    _accounts: StorageAccount[]
  ): Promise<UploadJob> {
    logger.info('UploadService.initiateUpload requested');
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      'UploadService.initiateUpload is scheduled for Phase 4 (Resumable Uploads).'
    );
  }
}

export const uploadService = new UploadService();
