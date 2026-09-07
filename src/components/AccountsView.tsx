/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Storage Accounts Management View
 * Production-quality account manager for Google Drive accounts comprising
 * the unified virtual storage pool.
 */

import React, { useState } from 'react';
import {
  HardDrive,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Zap,
  Info,
  Loader2,
  AlertCircle,
  ExternalLink,
  Power,
  ToggleLeft,
  ToggleRight,
  Layers,
  Search,
  Check,
} from 'lucide-react';
import { StorageAccount, StoragePoolSummary, AccountStatus } from '../types/account';
import { formatBytes, formatDate, formatRelativeTime } from '../lib/formatters';
import { authFetch } from '../lib/api';
import { useToast } from './Toast';

interface AccountsViewProps {
  poolSummary: StoragePoolSummary;
  onOpenAddAccount: () => void;
  onRefreshAccounts?: () => Promise<void> | void;
  isLoading?: boolean;
}

export const AccountsView: React.FC<AccountsViewProps> = ({
  poolSummary,
  onOpenAddAccount,
  onRefreshAccounts,
  isLoading = false,
}) => {
  const { success, error, info } = useToast();
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [togglingAccountId, setTogglingAccountId] = useState<string | null>(null);
  const [disconnectModalAccount, setDisconnectModalAccount] = useState<StorageAccount | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);

  // Sync an individual account
  const handleSync = async (account: StorageAccount, mode: 'delta' | 'full' = 'delta') => {
    if (syncingAccountId) return;
    setSyncingAccountId(account.id);

    try {
      const res = await authFetch(`/api/accounts/${account.id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        const discovered = json.data?.syncResult?.filesDiscovered ?? 0;
        success(`Synchronized ${account.email}. Discovered ${discovered} items.`);
        if (onRefreshAccounts) {
          await onRefreshAccounts();
        }
      } else {
        error(json.error?.message || `Failed to synchronize ${account.email}`);
      }
    } catch (err: any) {
      error(err.message || `Network error synchronizing ${account.email}`);
    } finally {
      setSyncingAccountId(null);
    }
  };

  // Toggle enabled/disabled state of an account
  const handleToggleEnabled = async (account: StorageAccount) => {
    if (togglingAccountId) return;
    setTogglingAccountId(account.id);
    const newEnabledState = account.isEnabled === false ? true : false;

    try {
      const res = await authFetch(`/api/accounts/${account.id}/enable`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: newEnabledState }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        if (newEnabledState) {
          success(`Account ${account.email} enabled for uploads.`);
        } else {
          info(`Account ${account.email} paused. No new uploads will be routed here.`);
        }
        if (onRefreshAccounts) {
          await onRefreshAccounts();
        }
      } else {
        error(json.error?.message || `Failed to update account status.`);
      }
    } catch (err: any) {
      error(err.message || `Network error updating account.`);
    } finally {
      setTogglingAccountId(null);
    }
  };

  // Disconnect an account with confirmation
  const handleConfirmDisconnect = async () => {
    if (!disconnectModalAccount || disconnecting) return;
    setDisconnecting(true);

    try {
      const res = await authFetch(`/api/accounts/${disconnectModalAccount.id}`, {
        method: 'DELETE',
      });

      const json = await res.json();
      if (res.ok && json.success) {
        success(`Disconnected ${disconnectModalAccount.email} from storage pool.`);
        setDisconnectModalAccount(null);
        if (onRefreshAccounts) {
          await onRefreshAccounts();
        }
      } else {
        error(json.error?.message || `Failed to disconnect account.`);
      }
    } catch (err: any) {
      error(err.message || `Network error disconnecting account.`);
    } finally {
      setDisconnecting(false);
    }
  };

  // Refresh all accounts
  const handleRefreshAll = async () => {
    if (isRefreshingAll) return;
    setIsRefreshingAll(true);
    try {
      if (onRefreshAccounts) {
        await onRefreshAccounts();
        success('Storage accounts and quotas refreshed.');
      }
    } catch (err: any) {
      error('Failed to refresh accounts.');
    } finally {
      setIsRefreshingAll(false);
    }
  };

  // Filter accounts by search query
  const filteredAccounts = (poolSummary.accounts || []).filter((acc) => {
    if (!searchFilter.trim()) return true;
    const term = searchFilter.toLowerCase();
    return (
      acc.email.toLowerCase().includes(term) ||
      (acc.displayName && acc.displayName.toLowerCase().includes(term))
    );
  });

  const activeAccountsCount = poolSummary.accounts.filter(
    (a) => a.isEnabled !== false && a.status === AccountStatus.ACTIVE
  ).length;

  return (
    <div id="accounts-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Header & Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Connected Storage Accounts
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage the Google Drive accounts comprising your unified virtual storage pool.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {poolSummary.accounts.length > 0 && (
            <button
              id="btn-refresh-accounts"
              onClick={handleRefreshAll}
              disabled={isRefreshingAll}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
              title="Refresh all account quotas"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingAll ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh Quotas</span>
            </button>
          )}
          <button
            id="btn-add-account-main"
            onClick={onOpenAddAccount}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium shadow-xs transition-colors cursor-pointer shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Connect Google Drive</span>
          </button>
        </div>
      </div>

      {/* Aggregate Storage Pool Summary Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Accounts</p>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              {poolSummary.totalAccounts}
            </span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              ({activeAccountsCount} active)
            </span>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Google Drive pools</p>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Pool Capacity</p>
          <p className="text-xl font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
            {formatBytes(poolSummary.totalCapacityBytes)}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Aggregate storage</p>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Consumed</p>
          <p className="text-xl font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
            {formatBytes(poolSummary.totalUsedBytes)}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            {poolSummary.usagePercentage}% utilized
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Available Headroom</p>
          <p className="text-xl font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
            {formatBytes(poolSummary.totalFreeBytes)}
          </p>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-500 font-medium">
            Ready for allocation
          </p>
        </div>
      </div>

      {/* Account Search & Filter Bar (when multiple accounts exist) */}
      {poolSummary.accounts.length > 2 && (
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter by account email or name..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Showing {filteredAccounts.length} of {poolSummary.accounts.length}
          </span>
        </div>
      )}

      {/* Loading Skeletons */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-2xs"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-slate-200 dark:bg-slate-800" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-sm w-3/4" />
                  <div className="h-3 bg-slate-100 dark:bg-slate-850 rounded-sm w-1/2" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full w-full" />
                <div className="h-3 bg-slate-100 dark:bg-slate-850 rounded-sm w-1/3" />
              </div>
              <div className="h-8 bg-slate-100 dark:bg-slate-800 rounded-lg w-full" />
            </div>
          ))}
        </div>
      ) : poolSummary.accounts.length === 0 ? (
        /* Empty State */
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center max-w-md mx-auto space-y-4 my-8 shadow-xs">
          <div className="h-12 w-12 rounded-xl bg-blue-50 dark:bg-blue-950/70 border border-blue-100 dark:border-blue-900 flex items-center justify-center mx-auto text-blue-600 dark:text-blue-400">
            <HardDrive className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              No Connected Storage Accounts
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
              Your unified storage pool currently has 0 connected accounts. Connect a Google Drive account to start pooling capacity.
            </p>
          </div>
          <button
            onClick={onOpenAddAccount}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Connect Google Drive</span>
          </button>
        </div>
      ) : (
        /* Account Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAccounts.map((account: StorageAccount, index: number) => {
            const isFull = account.quota.usagePercentage > 90;
            const isSyncing = syncingAccountId === account.id;
            const isToggling = togglingAccountId === account.id;
            const isEnabled = account.isEnabled !== false;
            const isTokenExpired = account.status === AccountStatus.TOKEN_EXPIRED;
            const isError = account.status === AccountStatus.ERROR || account.status === AccountStatus.REVOKED;

            return (
              <div
                key={account.id}
                className={`rounded-xl border bg-white dark:bg-slate-900 p-5 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between space-y-4 ${
                  !isEnabled
                    ? 'border-slate-200 dark:border-slate-800/60 opacity-85 bg-slate-50/50 dark:bg-slate-900/60'
                    : isError
                    ? 'border-rose-300 dark:border-rose-900/50'
                    : isTokenExpired
                    ? 'border-amber-300 dark:border-amber-900/50'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div>
                  {/* Account Header: Identity & Status Badge */}
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      {account.avatarUrl ? (
                        <img
                          src={account.avatarUrl}
                          alt={account.email}
                          referrerPolicy="no-referrer"
                          className="h-10 w-10 rounded-lg border border-slate-200 dark:border-slate-700 object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-400 flex items-center justify-center font-semibold text-sm shrink-0 border border-blue-100 dark:border-blue-900">
                          #{index + 1}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {account.displayName || account.email.split('@')[0]}
                          </h3>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate" title={account.email}>
                          {account.email}
                        </p>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {!isEnabled ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700">
                          <Power className="h-3 w-3 text-slate-400" />
                          Paused
                        </span>
                      ) : isError ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium border bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800">
                          <AlertTriangle className="h-3 w-3" />
                          Revoked
                        </span>
                      ) : isTokenExpired ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium border bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                          <Clock className="h-3 w-3" />
                          Reauth Needed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium border bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          Active
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Warning banner for degraded accounts */}
                  {(isTokenExpired || isError) && (
                    <div className="mt-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span className="truncate">Credentials need renewal</span>
                      </div>
                      <button
                        onClick={onOpenAddAccount}
                        className="font-semibold underline hover:no-underline text-blue-600 dark:text-blue-400 shrink-0 cursor-pointer"
                      >
                        Reconnect
                      </button>
                    </div>
                  )}

                  {/* Quota Progress Bar */}
                  <div className="mt-4 space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400">Storage Used</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {formatBytes(account.quota.usedBytes)} of {formatBytes(account.quota.totalBytes)}
                      </span>
                    </div>

                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          !isEnabled
                            ? 'bg-slate-400 dark:bg-slate-600'
                            : isFull
                            ? 'bg-amber-500'
                            : 'bg-blue-600 dark:bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(100, account.quota.usagePercentage)}%` }}
                      />
                    </div>

                    <div className="flex justify-between text-[11px] text-slate-400 dark:text-slate-500">
                      <span>{account.quota.usagePercentage}% utilized</span>
                      <span className="text-slate-600 dark:text-slate-300 font-medium">
                        {formatBytes(account.quota.freeBytes)} free
                      </span>
                    </div>
                  </div>

                  {/* Account Metadata: Provider & Last Synced */}
                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <div className="flex justify-between items-center">
                      <span>Provider</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        Google Drive
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Last Synchronized</span>
                      <span
                        className="text-slate-700 dark:text-slate-300 font-medium"
                        title={account.lastSyncedAt ? formatDate(account.lastSyncedAt) : undefined}
                      >
                        {account.lastSyncedAt ? formatRelativeTime(account.lastSyncedAt) : 'Pending initial sync'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Upload Routing</span>
                      <span className={isEnabled ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-slate-400'}>
                        {isEnabled ? 'Enabled (Eligible)' : 'Disabled (Paused)'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions Toolbar */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                  {/* Sync Button */}
                  <button
                    disabled={isSyncing || !isEnabled}
                    onClick={() => handleSync(account)}
                    className="flex-1 py-1.5 px-3 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-2xs"
                    title="Synchronize files and update quota"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 text-slate-500 dark:text-slate-400 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'Syncing...' : 'Sync'}</span>
                  </button>

                  {/* Enable / Disable Toggle Button */}
                  <button
                    disabled={isToggling}
                    onClick={() => handleToggleEnabled(account)}
                    className={`py-1.5 px-2.5 text-xs font-medium rounded-lg border transition-colors inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                      isEnabled
                        ? 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                        : 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60 hover:bg-blue-100'
                    }`}
                    title={isEnabled ? 'Pause upload routing to this account' : 'Enable upload routing to this account'}
                  >
                    {isToggling ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isEnabled ? (
                      <ToggleRight className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <ToggleLeft className="h-4 w-4 text-slate-400" />
                    )}
                    <span className="hidden sm:inline">{isEnabled ? 'Enabled' : 'Paused'}</span>
                  </button>

                  {/* Disconnect Button */}
                  <button
                    onClick={() => setDisconnectModalAccount(account)}
                    className="py-1.5 px-2.5 text-xs font-medium text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                    title="Disconnect account from pool"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Add Account Placeholder Tile */}
          <div
            onClick={onOpenAddAccount}
            className="rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-500 bg-slate-50/40 dark:bg-slate-850/40 hover:bg-blue-50/20 dark:hover:bg-blue-950/20 p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all space-y-2.5 min-h-[220px]"
          >
            <div className="p-3 rounded-full bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Connect Another Google Drive
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mt-1">
                Link additional Google accounts to expand total available storage capacity.
              </p>
            </div>
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
              + Expand Capacity
            </span>
          </div>
        </div>
      )}

      {/* Disconnect Confirmation Dialog */}
      {disconnectModalAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 text-slate-900 dark:text-slate-100">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/50 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-1.5 flex-1 min-w-0">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Disconnect Account?
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Are you sure you want to disconnect <strong className="text-slate-900 dark:text-slate-100">{disconnectModalAccount.email}</strong>?
                </p>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/80 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-medium">
                    <span>•</span>
                    <span>Pool capacity will decrease by {formatBytes(disconnectModalAccount.quota.totalBytes)}.</span>
                  </div>
                  <div className="flex items-start gap-1.5 text-slate-600 dark:text-slate-300">
                    <span>•</span>
                    <span>
                      <strong>Your files in Google Drive remain safe.</strong> Disconnecting only removes the UniCloud index and access token.
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={disconnecting}
                onClick={() => setDisconnectModalAccount(null)}
                className="px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={disconnecting}
                onClick={handleConfirmDisconnect}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {disconnecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{disconnecting ? 'Disconnecting...' : 'Disconnect Account'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
