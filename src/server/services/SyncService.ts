/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud SyncService
 * 
 * Domain service synchronizing upstream Google Drive changes into the virtual filesystem.
 */

import { AppError } from '../utils/errors';
import { ErrorCode } from '../../types/api';
import { logger } from '../utils/logger';

export class SyncService {
  /**
   * Triggers background synchronization for a connected storage account.
   */
  async syncAccount(_userId: string, accountId: string): Promise<void> {
    logger.info(`SyncService.syncAccount initiated for ${accountId}`);
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      'SyncService.syncAccount is scheduled for Phase 3 (Filesystem Sync).'
    );
  }
}

export const syncService = new SyncService();
