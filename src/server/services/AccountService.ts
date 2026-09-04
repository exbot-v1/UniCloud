/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud AccountService
 * 
 * Domain service managing connected storage accounts, credential lifecycles,
 * and account health verification.
 */

import { StorageAccount, StoragePoolSummary } from '../../types/account';
import { AppError } from '../utils/errors';
import { ErrorCode } from '../../types/api';
import { logger } from '../utils/logger';

export class AccountService {
  /**
   * Retrieves all connected storage accounts for a user.
   * Phase 0 returns foundational contract; Phase 2 connects to PostgreSQL.
   */
  async getAccountsForUser(userId: string): Promise<StorageAccount[]> {
    logger.debug(`Retrieving connected storage accounts for user ${userId}`);
    // Database query will be connected in Phase 1/2
    return [];
  }

  /**
   * Retrieves a single connected storage account by ID.
   */
  async getAccountById(accountId: string): Promise<StorageAccount> {
    logger.debug(`Retrieving storage account ${accountId}`);
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      `AccountService.getAccountById is scheduled for Phase 1 database integration.`
    );
  }

  /**
   * Disconnects a storage account from the pool.
   */
  async disconnectAccount(_userId: string, accountId: string): Promise<void> {
    logger.info(`Disconnecting storage account ${accountId}`);
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      `AccountService.disconnectAccount is scheduled for Phase 1.`
    );
  }

  /**
   * Calculates storage pool aggregate summary.
   */
  async getStoragePoolSummary(_userId: string): Promise<StoragePoolSummary> {
    return {
      totalAccounts: 0,
      activeAccounts: 0,
      totalCapacityBytes: 0,
      totalUsedBytes: 0,
      totalFreeBytes: 0,
      usagePercentage: 0,
      accounts: [],
    };
  }
}

export const accountService = new AccountService();
