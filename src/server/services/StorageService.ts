/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud StorageService
 * 
 * Domain service calculating virtual storage pool capacity, account quota health,
 * and capacity distribution from PostgreSQL storage account data.
 */

import { query } from '../../db/client.js';
import { DbStorageAccount } from '../../db/schema.js';
import { StoragePoolSummary, StorageAccount, ProviderType, AccountStatus } from '../../types/account.js';
import { logger } from '../utils/logger.js';

export class StorageService {
  /**
   * Helper to map a database account row to domain StorageAccount
   */
  private mapDbAccount(row: DbStorageAccount): StorageAccount {
    const total = Number(row.total_bytes) || 0;
    const used = Number(row.used_bytes) || 0;
    const free = Number(row.free_bytes) || Math.max(0, total - used);
    const usagePercentage = total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0;

    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider as ProviderType,
      providerAccountId: row.provider_account_id,
      email: row.email,
      displayName: row.display_name || undefined,
      avatarUrl: row.avatar_url || undefined,
      status: row.status as AccountStatus,
      tokenExpiresAt: row.token_expires_at,
      quota: {
        totalBytes: total,
        usedBytes: used,
        freeBytes: free,
        usagePercentage,
      },
      isEnabled: row.is_enabled !== false,
      lastSyncedAt: row.last_synced_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      providerMetadata: row.provider_metadata,
    };
  }

  /**
   * Retrieves account records from PostgreSQL for a user and calculates storage pool metrics.
   */
  async getStoragePoolForUser(userId: string): Promise<StoragePoolSummary> {
    logger.debug(`Retrieving storage accounts from database for user ${userId}`);
    const result = await query<DbStorageAccount>(
      `SELECT * FROM storage_accounts 
       WHERE user_id = $1 
       ORDER BY created_at ASC`,
      [userId]
    );

    const accounts = result.rows.map((row) => this.mapDbAccount(row));
    return this.calculatePoolMetrics(accounts);
  }

  /**
   * Aggregates multiple storage accounts into a virtual pool summary.
   * Virtual capacity = Sum of individual quotas.
   * Does NOT physically merge accounts; preserves per-account boundaries.
   */
  calculatePoolMetrics(accounts: StorageAccount[]): StoragePoolSummary {
    logger.debug(`Aggregating storage pool across ${accounts.length} accounts`);

    let totalCapacity = 0;
    let totalUsed = 0;
    let activeCount = 0;

    for (const acc of accounts) {
      if (acc.status === AccountStatus.ACTIVE && acc.isEnabled !== false) {
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
