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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Connected Storage Accounts</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage Google Drive accounts comprising your unified storage pool.
          </p>
        </div>
        <button
          id="btn-add-account-main"
          onClick={onOpenAddAccount}
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>Connect Google Drive</span>
        </button>
      </div>

      {/* Aggregate Storage Pool Summary Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">Connected Accounts</p>
          <p className="text-xl font-semibold text-slate-900 mt-0.5">{poolSummary.totalAccounts}</p>
          <p className="text-[11px] text-slate-400">Active Google Drive pools</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Total Pool Capacity</p>
          <p className="text-xl font-semibold text-slate-900 mt-0.5">{formatBytes(poolSummary.totalCapacityBytes)}</p>
          <p className="text-[11px] text-slate-400">Aggregate storage</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Total Consumed</p>
          <p className="text-xl font-semibold text-slate-900 mt-0.5">{formatBytes(poolSummary.totalUsedBytes)}</p>
          <p className="text-[11px] text-slate-400">{poolSummary.usagePercentage}% utilized</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Available Free Space</p>
          <p className="text-xl font-semibold text-slate-900 mt-0.5">{formatBytes(poolSummary.totalFreeBytes)}</p>
          <p className="text-[11px] text-emerald-600 font-medium">Ready for allocation</p>
        </div>
      </div>

      {/* Action Notification */}
      {actionNotice && (
        <div
          className={`flex items-center justify-between p-3 rounded-lg border text-xs ${
            actionNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionNotice.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            )}
            <span>{actionNotice.message}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className="text-slate-500 hover:text-slate-800 text-xs font-medium ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Account Cards Grid or Empty State */}
      {poolSummary.accounts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center max-w-md mx-auto space-y-4 my-8 shadow-xs">
          <div className="h-12 w-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto text-blue-600">
            <HardDrive className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-900">No Connected Storage Accounts</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              Your unified storage pool currently has 0 connected accounts. Connect a Google Drive account to start pooling capacity.
            </p>
          </div>
          <button
            onClick={onOpenAddAccount}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium shadow-xs transition-colors cursor-pointer"
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
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs hover:border-slate-300 hover:shadow-xs transition-all flex flex-col justify-between space-y-4"
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
                          className="h-10 w-10 rounded-lg border border-slate-200 object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center font-semibold text-sm shrink-0 border border-blue-100">
                          #{index + 1}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900 truncate">
                          {account.displayName || account.email}
                        </h3>
                        <p className="text-xs text-slate-500 truncate">{account.email}</p>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ${
                        account.status === AccountStatus.ACTIVE
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : account.status === AccountStatus.TOKEN_EXPIRED
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
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
                      <span className="text-slate-500">Storage Used</span>
                      <span className="font-medium text-slate-900">
                        {formatBytes(account.quota.usedBytes)} of {formatBytes(account.quota.totalBytes)}
                      </span>
                    </div>

                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isFull ? 'bg-amber-500' : 'bg-blue-600'
                        }`}
                        style={{ width: `${Math.min(100, account.quota.usagePercentage)}%` }}
                      />
                    </div>

                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>{account.quota.usagePercentage}% used</span>
                      <span className="text-slate-600 font-medium">
                        {formatBytes(account.quota.freeBytes)} free
                      </span>
                    </div>
                  </div>

                  {/* Account Metadata */}
                  <div className="mt-4 pt-3 border-t border-slate-100 space-y-1 text-[11px] text-slate-500">
                    <div className="flex justify-between">
                      <span>Provider</span>
                      <span className="font-medium text-slate-700">Google Drive API v3</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Last Synced</span>
                      <span className="text-slate-700">{formatDate(account.lastSyncedAt || account.updatedAt)}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    disabled={isSyncing}
                    onClick={() => handleSync(account)}
                    className="flex-1 py-1.5 px-3 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-2xs"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
                  </button>

                  <button
                    onClick={() => setDisconnectModalAccount(account)}
                    className="py-1.5 px-2.5 text-xs font-medium text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
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
            className="rounded-xl border-2 border-dashed border-slate-200 hover:border-blue-400 bg-slate-50/40 hover:bg-blue-50/20 p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all space-y-2.5 min-h-[220px]"
          >
            <div className="p-3 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Connect Another Google Drive</h3>
              <p className="text-xs text-slate-500 max-w-xs mt-1">
                Link additional Google accounts to expand total available storage capacity.
              </p>
            </div>
            <span className="text-xs font-medium text-blue-600">+ Expand Capacity</span>
          </div>
        </div>
      )}

      {/* Disconnect Confirmation Dialog */}
      {disconnectModalAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 shadow-xl border border-slate-200 space-y-4 text-slate-900">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold text-slate-900">Disconnect Account?</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Are you sure you want to disconnect <strong>{disconnectModalAccount.email}</strong>?
                </p>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600 space-y-1">
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
                className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium border border-slate-200 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={disconnecting}
                onClick={handleConfirmDisconnect}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
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
