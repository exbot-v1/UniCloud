/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Storage Accounts Management View (Phase 2 Upgrade)
 * 
 * Visualizes live connected Google Drive accounts, real Drive v3 quotas,
 * interactive metadata synchronization, and account disconnection.
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
} from 'lucide-react';
import { StorageAccount, StoragePoolSummary, AccountStatus } from '../types/account';
import { formatBytes, formatDate } from '../lib/formatters';
import { authFetch } from '../lib/api';

interface AccountsViewProps {
  poolSummary: StoragePoolSummary;
  onOpenAddAccount: () => void;
  onRefreshAccounts?: () => Promise<void> | void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({
  poolSummary,
  onOpenAddAccount,
  onRefreshAccounts,
}) => {
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [disconnectModalAccount, setDisconnectModalAccount] = useState<StorageAccount | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSync = async (account: StorageAccount) => {
    setSyncingAccountId(account.id);
    setActionNotice(null);

    try {
      const res = await authFetch(`/api/accounts/${account.id}/sync`, {
        method: 'POST',
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setActionNotice({
          type: 'success',
          message: `Successfully synced ${account.email}. Discovered ${json.data?.syncResult?.filesDiscovered ?? 0} files.`,
        });
        if (onRefreshAccounts) {
          await onRefreshAccounts();
        }
      } else {
        setActionNotice({
          type: 'error',
          message: json.error?.message || `Failed to synchronize ${account.email}`,
        });
      }
    } catch (err: any) {
      setActionNotice({
        type: 'error',
        message: err.message || `Network error synchronizing ${account.email}`,
      });
    } finally {
      setSyncingAccountId(null);
    }
  };

  const handleConfirmDisconnect = async () => {
    if (!disconnectModalAccount) return;
    setDisconnecting(true);
    setActionNotice(null);

    try {
      const res = await authFetch(`/api/accounts/${disconnectModalAccount.id}`, {
        method: 'DELETE',
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setActionNotice({
          type: 'success',
          message: `Disconnected ${disconnectModalAccount.email} from your virtual storage pool.`,
        });
        setDisconnectModalAccount(null);
        if (onRefreshAccounts) {
          await onRefreshAccounts();
        }
      } else {
        setActionNotice({
          type: 'error',
          message: json.error?.message || `Failed to disconnect account`,
        });
      }
    } catch (err: any) {
      setActionNotice({
        type: 'error',
        message: err.message || `Network error disconnecting account`,
      });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div id="accounts-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Banner & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Connected Storage Accounts</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage Google Drive accounts comprising your unified storage pool.
          </p>
        </div>
        <button
          id="btn-add-account-main"
          onClick={onOpenAddAccount}
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>Connect Google Drive</span>
        </button>
      </div>

      {/* Aggregate Storage Pool Summary Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Connected Accounts</p>
          <p className="text-xl font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{poolSummary.totalAccounts}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Active Google Drive pools</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Pool Capacity</p>
          <p className="text-xl font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{formatBytes(poolSummary.totalCapacityBytes)}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Aggregate storage</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Consumed</p>
          <p className="text-xl font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{formatBytes(poolSummary.totalUsedBytes)}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">{poolSummary.usagePercentage}% utilized</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Available Free Space</p>
          <p className="text-xl font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{formatBytes(poolSummary.totalFreeBytes)}</p>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Ready for allocation</p>
        </div>
      </div>

      {/* Action Notification */}
      {actionNotice && (
        <div
          className={`flex items-center justify-between p-3 rounded-lg border text-xs ${
            actionNotice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionNotice.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span>{actionNotice.message}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-xs font-medium ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Account Cards Grid or Empty State */}
      {poolSummary.accounts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center max-w-md mx-auto space-y-4 my-8 shadow-xs">
          <div className="h-12 w-12 rounded-xl bg-blue-50 dark:bg-blue-950/70 border border-blue-100 dark:border-blue-900 flex items-center justify-center mx-auto text-blue-600 dark:text-blue-400">
            <HardDrive className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">No Connected Storage Accounts</h3>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {poolSummary.accounts.map((account: StorageAccount, index: number) => {
            const isFull = account.quota.usagePercentage > 90;
            const isSyncing = syncingAccountId === account.id;

            return (
              <div
                key={account.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-xs transition-all flex flex-col justify-between space-y-4"
              >
                <div>
                  {/* Account Header */}
                  <div className="flex items-start justify-between gap-3">
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
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {account.displayName || account.email}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{account.email}</p>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ${
                        account.status === AccountStatus.ACTIVE
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                          : account.status === AccountStatus.TOKEN_EXPIRED
                          ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                          : 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                      }`}
                    >
                      {account.status === AccountStatus.ACTIVE && <CheckCircle2 className="h-3 w-3" />}
                      {account.status === AccountStatus.TOKEN_EXPIRED && <Clock className="h-3 w-3" />}
                      {account.status === AccountStatus.ERROR && <AlertTriangle className="h-3 w-3" />}
                      {account.status}
                    </span>
                  </div>

                  {/* Quota Progress */}
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
                          isFull ? 'bg-amber-500' : 'bg-blue-600 dark:bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(100, account.quota.usagePercentage)}%` }}
                      />
                    </div>

                    <div className="flex justify-between text-[11px] text-slate-400 dark:text-slate-500">
                      <span>{account.quota.usagePercentage}% used</span>
                      <span className="text-slate-600 dark:text-slate-300 font-medium">
                        {formatBytes(account.quota.freeBytes)} free
                      </span>
                    </div>
                  </div>

                  {/* Account Metadata */}
                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <div className="flex justify-between">
                      <span>Provider</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">Google Drive API v3</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Last Synced</span>
                      <span className="text-slate-700 dark:text-slate-300">{formatDate(account.lastSyncedAt || account.updatedAt)}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                  <button
                    disabled={isSyncing}
                    onClick={() => handleSync(account)}
                    className="flex-1 py-1.5 px-3 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-2xs"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 text-slate-500 dark:text-slate-400 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
                  </button>

                  <button
                    onClick={() => setDisconnectModalAccount(account)}
                    className="py-1.5 px-2.5 text-xs font-medium text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                    title="Disconnect Account"
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
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Connect Another Google Drive</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mt-1">
                Link additional Google accounts to expand total available storage capacity.
              </p>
            </div>
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">+ Expand Capacity</span>
          </div>
        </div>
      )}

      {/* Disconnect Confirmation Dialog */}
      {disconnectModalAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4 text-slate-900 dark:text-slate-100">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/50 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Disconnect Account?</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Are you sure you want to disconnect <strong>{disconnectModalAccount.email}</strong>?
                </p>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/80 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                  <div>• Storage pool capacity will decrease by {formatBytes(disconnectModalAccount.quota.totalBytes)}.</div>
                  <div>• <strong>No files will be deleted</strong> from your Google Drive. Only the UniCloud connection will be removed.</div>
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
                <span>{disconnecting ? 'Disconnecting...' : 'Disconnect'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
