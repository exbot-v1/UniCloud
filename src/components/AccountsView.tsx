/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Storage Accounts Management View (Phase 0)
 * Visualizes individual Google Drive connections, quotas, and multi-account capabilities.
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
} from 'lucide-react';
import { StorageAccount, StoragePoolSummary } from '../types/account';
import { formatBytes, formatDate } from '../lib/formatters';

interface AccountsViewProps {
  poolSummary: StoragePoolSummary;
  onOpenAddAccount: () => void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({
  poolSummary,
  onOpenAddAccount,
}) => {
  const [activeNotice, setActiveNotice] = useState<string | null>(null);

  return (
    <div id="accounts-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Banner & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white">Connected Storage Accounts</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage disparate Google Drive accounts comprising your virtual storage pool.
          </p>
        </div>
        <button
          id="btn-add-account-main"
          onClick={onOpenAddAccount}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white rounded-xl text-xs font-semibold shadow-lg shadow-purple-500/25 border border-purple-400/30 transition-all active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          <span>Add Google Drive Account</span>
        </button>
      </div>

      {/* Aggregate Storage Pool Summary Bar */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5 shadow-xl grid grid-cols-1 sm:grid-cols-4 gap-4">
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
          <p className="text-xl font-black text-purple-400 mt-1">{formatBytes(poolSummary.totalUsedBytes)}</p>
          <p className="text-[11px] text-slate-400">{poolSummary.usagePercentage}% utilized</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-400">Available Headroom</p>
          <p className="text-xl font-black text-blue-400 mt-1">{formatBytes(poolSummary.totalFreeBytes)}</p>
          <p className="text-[11px] text-blue-300 font-medium">Ready for routing</p>
        </div>
      </div>

      {/* Account Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {poolSummary.accounts.map((account: StorageAccount, index: number) => {
          const isFull = account.quota.usagePercentage > 90;
          return (
            <div
              key={account.id}
              className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5 shadow-xl hover:border-purple-400/40 hover:bg-white/[0.06] transition-all flex flex-col justify-between space-y-4"
            >
              <div>
                {/* Account Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-purple-600 to-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-md shadow-purple-500/20 border border-white/10">
                      #{index + 1}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white truncate">
                        {account.displayName || account.email}
                      </h3>
                      <p className="text-xs text-slate-400 truncate">{account.email}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                    <CheckCircle2 className="h-3 w-3" />
                    {account.status}
                  </span>
                </div>

                {/* Quota Progress */}
                <div className="mt-5 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Drive Storage</span>
                    <span className="font-bold text-white">
                      {formatBytes(account.quota.usedBytes)} / {formatBytes(account.quota.totalBytes)}
                    </span>
                  </div>

                  <div className="h-2.5 w-full bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isFull ? 'bg-amber-500' : 'bg-gradient-to-r from-purple-500 to-blue-500'
                      }`}
                      style={{ width: `${account.quota.usagePercentage}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>{account.quota.usagePercentage}% full</span>
                    <span className="text-blue-300 font-medium">
                      {formatBytes(account.quota.freeBytes)} remaining
                    </span>
                  </div>
                </div>

                {/* Account Metadata */}
                <div className="mt-4 pt-3 border-t border-white/10 space-y-1.5 text-[11px] text-slate-400">
                  <div className="flex justify-between">
                    <span>Provider</span>
                    <span className="font-medium text-slate-200">Google Drive API v3</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Last Sync</span>
                    <span className="text-slate-200">{formatDate(account.lastSyncedAt || account.updatedAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Token Security</span>
                    <span className="text-emerald-400 font-medium">AES-256-GCM Encrypted</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2">
                <button
                  onClick={() =>
                    setActiveNotice(`Account synchronization worker is scheduled for Phase 3 (Delta Sync).`)
                  }
                  className="flex-1 py-1.5 px-2.5 text-xs font-semibold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-purple-400" />
                  Sync
                </button>
                <button
                  onClick={() =>
                    setActiveNotice(`Account disconnection and token revocation is scheduled for Phase 2.`)
                  }
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
          className="rounded-2xl border-2 border-dashed border-white/15 hover:border-purple-400/50 bg-white/[0.02] hover:bg-purple-500/5 backdrop-blur-md p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all space-y-3 min-h-[260px]"
        >
          <div className="p-3.5 rounded-full bg-purple-500/20 text-purple-300 shadow-md border border-purple-500/30">
            <Plus className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Add Another Google Drive</h3>
            <p className="text-xs text-slate-400 max-w-xs mt-1">
              Connect additional accounts to expand your virtual storage pool seamlessly.
            </p>
          </div>
          <span className="text-xs font-semibold text-purple-400">+ Expand Pool Capacity</span>
        </div>
      </div>

      {/* Notice Dialog */}
      {activeNotice && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#090910]/95 backdrop-blur-2xl rounded-3xl p-6 shadow-2xl border border-white/15 space-y-4 text-slate-100">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-2xl bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                <Info className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Phase 0 Architectural Scope</h3>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">{activeNotice}</p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setActiveNotice(null)}
                className="px-4 py-2 bg-white/15 hover:bg-white/20 text-white rounded-xl text-xs font-semibold border border-white/20 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
