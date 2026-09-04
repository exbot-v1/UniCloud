/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Storage Pool Metrics Calculator (Pure Utility)
 * Safe for both client-side and server-side execution.
 */

import { StorageAccount, StoragePoolSummary, AccountStatus } from '../types/account';

export function calculateStoragePoolMetrics(accounts: StorageAccount[]): StoragePoolSummary {
  const activeAccounts = accounts.filter(
    (a) => a.status === AccountStatus.ACTIVE || (a.status as string) === 'active'
  );

  const totalCapacityBytes = accounts.reduce(
    (acc, a) => acc + (Number(a.quota?.totalBytes) || 0),
    0
  );
  const totalUsedBytes = accounts.reduce(
    (acc, a) => acc + (Number(a.quota?.usedBytes) || 0),
    0
  );
  const totalFreeBytes = accounts.reduce(
    (acc, a) => acc + (Number(a.quota?.freeBytes) || 0),
    0
  );

  const usagePercentage = totalCapacityBytes > 0
    ? Math.round((totalUsedBytes / totalCapacityBytes) * 1000) / 10
    : 0;

  return {
    totalAccounts: accounts.length,
    activeAccounts: activeAccounts.length,
    totalCapacityBytes,
    totalUsedBytes,
    totalFreeBytes,
    usagePercentage,
    accounts,
  };
}
