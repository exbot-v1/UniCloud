/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud StorageService
 * 
 * Domain service calculating virtual storage pool capacity, account quota health,
 * and capacity distribution.
 */

import { StoragePoolSummary, StorageAccount } from '../../types/account';
import { logger } from '../utils/logger';

export class StorageService {
  /**
   * Aggregates multiple storage accounts into a single virtual pool.
   * Virtual capacity = Sum of individual quotas.
   */
  calculatePoolMetrics(accounts: StorageAccount[]): StoragePoolSummary {
    logger.debug(`Aggregating storage pool across ${accounts.length} accounts`);

    let totalCapacity = 0;
    let totalUsed = 0;
    let activeCount = 0;

    for (const acc of accounts) {
      if (acc.status === 'active') {
        activeCount++;
      }
      totalCapacity += acc.quota.totalBytes;
      totalUsed += acc.quota.usedBytes;
    }

    const totalFree = Math.max(0, totalCapacity - totalUsed);
    const usagePercentage = totalCapacity > 0 ? (totalUsed / totalCapacity) * 100 : 0;

    return {
      totalAccounts: accounts.length,
      activeAccounts: activeCount,
      totalCapacityBytes: totalCapacity,
      totalUsedBytes: totalUsed,
      totalFreeBytes: totalFree,
      usagePercentage: Math.round(usagePercentage * 10) / 10,
      accounts,
    };
  }
}

export const storageService = new StorageService();
