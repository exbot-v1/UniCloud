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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#262c36] pb-4">
        <div>
          <h1 className="text-xl font-bold text-white">Connected Storage Accounts</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage Google Drive accounts comprising your unified virtual storage pool.
          </p>
        </div>
        <button
          id="btn-add-account-main"
          onClick={onOpenAddAccount}
          className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl text-xs font-bold shadow-md shadow-cyan-950/50 border border-cyan-400/40 transition-all active:scale-[0.98]"
        >
          <Plus className="h-4 w-4 text-slate-950" />
          <span>Add Google Drive Account</span>
        </button>
      </div>

      {/* Aggregate Storage Pool Summary Bar */}
      <div className="rounded-xl border border-[#262c36] bg-[#161b24] p-5 shadow-sm grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs font-medium text-slate-400">Connected Accounts</p>
          <p className="text-xl font-black text-white mt-1">{poolSummary.totalAccounts}</p>
          <p className="text-[11px] text-slate-400">All Google Drive v3</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-400">Total Virtual Pool</p>
          <p className="text-xl font-black text-white mt-1">{formatBytes(poolSummary.totalCapacityBytes)}</p>
          <p className="text-[11px] text-slate-400">Aggregate capacity</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-400">Total Consumed</p>
          <p className="text-xl font-black text-cyan-300 mt-1">{formatBytes(poolSummary.totalUsedBytes)}</p>
          <p className="text-[11px] text-slate-400">{poolSummary.usagePercentage}% utilized</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-400">Available Headroom</p>
          <p className="text-xl font-black text-teal-400 mt-1">{formatBytes(poolSummary.totalFreeBytes)}</p>
          <p className="text-[11px] text-teal-300 font-medium">Ready for allocation</p>
        </div>
      </div>

      {/* Action Notification */}
      {actionNotice && (
        <div
          className={`flex items-center justify-between p-3.5 rounded-xl border text-xs animate-in fade-in ${
            actionNotice.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-200'
              : 'bg-rose-950/40 border-rose-800/50 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionNotice.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            )}
            <span>{actionNotice.message}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className="text-slate-400 hover:text-white text-xs font-bold ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Account Cards Grid or Empty State */}
      {poolSummary.accounts.length === 0 ? (
        <div className="rounded-2xl border border-[#262c36] bg-[#161b24] p-12 text-center max-w-xl mx-auto space-y-4">
          <div className="h-14 w-14 rounded-2xl bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center mx-auto text-cyan-400">
            <HardDrive className="h-7 w-7" />
          </div>
          <h3 className="text-lg font-bold text-white">No Connected Storage Accounts</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Your virtual storage pool currently has 0 connected accounts. Connect your personal or organizational Google Drive accounts to begin pooling capacity.
          </p>
          <button
            onClick={onOpenAddAccount}
            className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl text-xs font-bold shadow-md transition-all"
          >
            <Plus className="h-4 w-4 text-slate-950" />
            <span>Connect First Google Drive Account</span>
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
                className="rounded-xl border border-[#262c36] bg-[#161b24] p-5 shadow-xs hover:border-cyan-500/40 hover:bg-[#1a202c] transition-all flex flex-col justify-between space-y-4"
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
                          className="h-10 w-10 rounded-xl border border-[#262c36] object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-xl bg-cyan-950/60 text-cyan-300 flex items-center justify-center font-bold text-sm shrink-0 border border-cyan-800/50">
                          #{index + 1}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-white truncate">
                          {account.displayName || account.email}
                        </h3>
                        <p className="text-xs text-slate-400 truncate">{account.email}</p>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${
                        account.status === AccountStatus.ACTIVE
                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50'
                          : account.status === AccountStatus.TOKEN_EXPIRED
                          ? 'bg-amber-950/60 text-amber-300 border-amber-800/50'
                          : 'bg-rose-950/60 text-rose-300 border-rose-800/50'
                      }`}
                    >
                      {account.status === AccountStatus.ACTIVE && <CheckCircle2 className="h-3 w-3" />}
                      {account.status === AccountStatus.TOKEN_EXPIRED && <Clock className="h-3 w-3" />}
                      {account.status === AccountStatus.ERROR && <AlertTriangle className="h-3 w-3" />}
                      {account.status}
                    </span>
                  </div>

                  {/* Quota Progress */}
                  <div className="mt-5 space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Drive Storage Quota</span>
                      <span className="font-bold text-white">
                        {formatBytes(account.quota.usedBytes)} / {formatBytes(account.quota.totalBytes)}
                      </span>
                    </div>

                    <div className="h-2.5 w-full bg-[#0e1117] border border-[#262c36] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isFull ? 'bg-amber-500' : 'bg-gradient-to-r from-cyan-500 to-teal-400'
                        }`}
                        style={{ width: `${Math.min(100, account.quota.usagePercentage)}%` }}
                      />
                    </div>

                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>{account.quota.usagePercentage}% utilized</span>
                      <span className="text-teal-300 font-medium">
                        {formatBytes(account.quota.freeBytes)} free
                      </span>
                    </div>
                  </div>

                  {/* Account Metadata */}
                  <div className="mt-4 pt-3 border-t border-[#262c36] space-y-1.5 text-[11px] text-slate-400">
                    <div className="flex justify-between">
                      <span>Provider</span>
                      <span className="font-medium text-slate-200">Google Drive API v3</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Last Synced</span>
                      <span className="text-slate-200">{formatDate(account.lastSyncedAt || account.updatedAt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Token Security</span>
                      <span className="text-teal-400 font-medium">AES-256-GCM Encrypted</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-[#262c36] flex items-center justify-between gap-2">
                  <button
                    disabled={isSyncing}
                    onClick={() => handleSync(account)}
                    className="flex-1 py-1.5 px-2.5 text-xs font-semibold text-slate-300 hover:text-white bg-[#10141b] hover:bg-[#1a202c] border border-[#262c36] rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 text-cyan-400 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'Syncing...' : 'Sync'}</span>
                  </button>

                  <button
                    onClick={() => setDisconnectModalAccount(account)}
                    className="py-1.5 px-2.5 text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 rounded-lg transition-colors"
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
            className="rounded-xl border-2 border-dashed border-[#262c36] hover:border-cyan-500/50 bg-[#161b24]/50 hover:bg-[#161b24] p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all space-y-3 min-h-[260px]"
          >
            <div className="p-3.5 rounded-full bg-cyan-500/15 text-cyan-400 shadow-sm border border-cyan-500/30">
              <Plus className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Add Another Google Drive</h3>
              <p className="text-xs text-slate-400 max-w-xs mt-1">
                Connect additional Google accounts to expand your virtual storage pool seamlessly.
              </p>
            </div>
            <span className="text-xs font-semibold text-cyan-400">+ Expand Pool Capacity</span>
          </div>
        </div>
      )}

      {/* Disconnect Confirmation Dialog */}
      {disconnectModalAccount && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#12161f] rounded-2xl p-6 shadow-2xl border border-[#262c36] space-y-4 text-slate-100">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-white">Disconnect Account?</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Are you sure you want to disconnect <strong>{disconnectModalAccount.email}</strong>?
                </p>
                <div className="p-3 bg-[#0e1117] rounded-xl border border-[#262c36] text-[11px] text-slate-400 space-y-1">
                  <div>• Your storage pool capacity will decrease by {formatBytes(disconnectModalAccount.quota.totalBytes)}.</div>
                  <div>• <strong>No files will be deleted</strong> on your Google Drive. Only the local UniCloud connection will be removed.</div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={disconnecting}
                onClick={() => setDisconnectModalAccount(null)}
                className="px-4 py-2 bg-[#1a202c] hover:bg-[#222a38] text-white rounded-xl text-xs font-semibold border border-[#262c36] transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={disconnecting}
                onClick={handleConfirmDisconnect}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
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
