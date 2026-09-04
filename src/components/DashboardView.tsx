/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Dashboard View (Phase 0)
 * Demonstrates the unified storage pool abstraction across multiple Google Drive accounts.
 */

import React from 'react';
import {
  Layers,
  HardDrive,
  ArrowUpRight,
  ShieldCheck,
  AlertCircle,
  FileText,
  Clock,
  ExternalLink,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { StoragePoolSummary, StorageAccount } from '../types/account';
import { VirtualFile } from '../types/filesystem';
import { formatBytes, formatDate } from '../lib/formatters';

interface DashboardViewProps {
  poolSummary: StoragePoolSummary;
  recentFiles: VirtualFile[];
  onOpenUpload: () => void;
  onOpenAddAccount: () => void;
  onNavigateFiles: () => void;
  onNavigateAccounts: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  poolSummary,
  recentFiles,
  onOpenUpload,
  onOpenAddAccount,
  onNavigateFiles,
  onNavigateAccounts,
}) => {
  return (
    <div id="dashboard-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Banner: Architecture Notice */}
      <div className="rounded-3xl border border-white/10 bg-gradient-to-r from-purple-900/30 via-indigo-900/20 to-white/[0.02] backdrop-blur-xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 text-white shadow-lg shadow-purple-500/30 mt-0.5">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white tracking-tight">Virtual Storage Pool Active</h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Phase 0 Foundation
                </span>
              </div>
              <p className="text-sm text-slate-300 mt-1 max-w-3xl leading-relaxed">
                Google Drive quotas are not physically merged. UniCloud establishes a virtual storage abstraction layer 
                over your accounts, maintaining metadata mappings to present files as one seamless filesystem.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={onOpenAddAccount}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white/10 hover:bg-white/15 text-slate-200 border border-white/15 rounded-xl shadow-xs transition-all backdrop-blur-md"
            >
              <Plus className="h-3.5 w-3.5 text-purple-400" />
              Add Google Account
            </button>
            <button
              onClick={onOpenUpload}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white rounded-xl shadow-lg shadow-purple-500/25 border border-purple-400/30 transition-all"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              Upload File
            </button>
          </div>
        </div>
      </div>

      {/* Main Stats Grid: Unified Storage Pool & Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Card 1: Virtual Pool Gauge (Span 2 cols on lg) */}
        <div className="lg:col-span-2 rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-2xl bg-purple-500/15 border border-purple-500/20 text-purple-300">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Unified Storage Pool</h2>
                  <p className="text-xs text-slate-400">Aggregated virtual capacity across all connected drives</p>
                </div>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/10 border border-white/10 text-slate-300">
                {poolSummary.activeAccounts} Active Drives
              </span>
            </div>

            {/* Metrics Display */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-6 p-4 rounded-2xl bg-white/[0.03] border border-white/10">
              <div>
                <p className="text-xs font-medium text-slate-400">Total Virtual Capacity</p>
                <p className="text-2xl font-black text-white mt-1">
                  {formatBytes(poolSummary.totalCapacityBytes)}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">Sum of all drives</p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-400">Aggregate Used Storage</p>
                <p className="text-2xl font-black text-purple-300 mt-1">
                  {formatBytes(poolSummary.totalUsedBytes)}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">{poolSummary.usagePercentage}% utilized</p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-400">Available Pool Storage</p>
                <p className="text-2xl font-black text-emerald-400 mt-1">
                  {formatBytes(poolSummary.totalFreeBytes)}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">Ready for upload routing</p>
              </div>
            </div>

            {/* Master Progress Bar with Account Segmentation */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-slate-300">
                <span>Storage Distribution</span>
                <span className="font-semibold text-purple-300">{poolSummary.usagePercentage}% full</span>
              </div>
              <div className="h-3 w-full rounded-full bg-white/10 overflow-hidden flex">
                {poolSummary.accounts.map((acc, index) => {
                  const pct = poolSummary.totalCapacityBytes > 0 
                    ? (acc.quota.usedBytes / poolSummary.totalCapacityBytes) * 100 
                    : 0;
                  const colors = ['bg-purple-500', 'bg-blue-500', 'bg-indigo-400', 'bg-teal-400'];
                  return (
                    <div
                      key={acc.id}
                      title={`${acc.email}: ${formatBytes(acc.quota.usedBytes)}`}
                      className={`h-full ${colors[index % colors.length]} transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  );
                })}
              </div>
              {/* Account Legend */}
              <div className="flex flex-wrap items-center gap-4 pt-2">
                {poolSummary.accounts.map((acc, index) => {
                  const colors = ['bg-purple-500', 'bg-blue-500', 'bg-indigo-400', 'bg-teal-400'];
                  return (
                    <div key={acc.id} className="flex items-center gap-1.5 text-xs text-slate-300">
                      <span className={`h-2.5 w-2.5 rounded-full ${colors[index % colors.length]}`} />
                      <span className="truncate max-w-[140px] font-medium">{acc.email.split('@')[0]}</span>
                      <span className="text-slate-400">({formatBytes(acc.quota.usedBytes)})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5 text-slate-400" />
              Demo Data Preview (Real OAuth in Phase 2)
            </span>
            <button
              onClick={onNavigateAccounts}
              className="font-semibold text-purple-300 hover:text-purple-200 inline-flex items-center gap-1 transition-colors"
            >
              Manage Accounts <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Card 2: Routing & Architecture Info */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="p-2.5 rounded-2xl bg-blue-500/15 border border-blue-500/20 text-blue-300">
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Upload Routing Engine</h2>
                <p className="text-xs text-slate-400">Autonomous capacity balancer</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-1">
                <p className="font-semibold text-white">Current Active Strategy</p>
                <p className="text-purple-300 font-medium">Most Free Space (Auto)</p>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Files are dynamically directed to whichever connected account has the most remaining gigabytes.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-1">
                <p className="font-semibold text-white">Large File Streaming</p>
                <p className="text-emerald-400 font-medium">Resumable Chunking Ready</p>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Designed for serverless memory caps. Files &gt;5MB stream directly via Google Drive resumable sessions.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-1">
                <p className="font-semibold text-white">Security Architecture</p>
                <p className="text-blue-300 font-medium">AES-256-GCM Encrypted</p>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Refresh tokens encrypted at rest; zero browser JavaScript exposure.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/10">
            <button
              onClick={onOpenUpload}
              className="w-full py-2.5 px-4 bg-white/10 hover:bg-white/15 text-white border border-white/15 rounded-xl text-xs font-semibold text-center transition-all backdrop-blur-md"
            >
              Test Routing Engine Dry-Run
            </button>
          </div>
        </div>
      </div>

      {/* Connected Google Drive Accounts Row */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Connected Google Drive Accounts</h2>
            <p className="text-xs text-slate-400">Each account maintains its individual quota while sharing a unified virtual namespace</p>
          </div>
          <span className="text-xs font-medium text-slate-400">
            Tagged: <span className="font-semibold text-amber-400">Phase 0 Architecture Demo Data</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {poolSummary.accounts.map((acc: StorageAccount, index: number) => (
            <div
              key={acc.id}
              className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-4 shadow-sm hover:border-purple-400/40 hover:bg-white/[0.06] transition-all space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center font-bold text-purple-300 text-xs">
                    #{String(index + 1).padStart(2, '0')}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white truncate max-w-[160px]">{acc.displayName || acc.email}</p>
                    <p className="text-[11px] text-slate-400 truncate max-w-[160px]">{acc.email}</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {acc.status}
                </span>
              </div>

              {/* Account Quota Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-slate-300">
                  <span>Usage</span>
                  <span className="font-semibold text-white">
                    {formatBytes(acc.quota.usedBytes)} / {formatBytes(acc.quota.totalBytes)}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full"
                    style={{ width: `${acc.quota.usagePercentage}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>{acc.quota.usagePercentage}% used</span>
                  <span className="text-emerald-400 font-medium">{formatBytes(acc.quota.freeBytes)} available</span>
                </div>
              </div>

              <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Synced {formatDate(acc.lastSyncedAt || acc.updatedAt)}
                </span>
                <span className="text-slate-500">Google v3</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Virtual Files Preview */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-purple-400" />
            <h2 className="text-base font-bold text-white">Recent Virtual Files</h2>
          </div>
          <button
            onClick={onNavigateFiles}
            className="text-xs font-semibold text-purple-300 hover:text-purple-200 inline-flex items-center gap-1 transition-colors"
          >
            Open File Browser <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 font-semibold">
                <th className="pb-3 pl-2">File Name</th>
                <th className="pb-3">Physical Storage Account</th>
                <th className="pb-3">Size</th>
                <th className="pb-3">Modified</th>
                <th className="pb-3 pr-2 text-right">Provider Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-300">
              {recentFiles.map((file) => {
                const account = poolSummary.accounts.find((a) => a.id === file.storageAccountId);
                return (
                  <tr key={file.id} className="hover:bg-white/[0.04] transition-colors">
                    <td className="py-3 pl-2 font-medium text-white flex items-center gap-2.5">
                      <FileText className="h-4 w-4 text-purple-400 shrink-0" />
                      <span className="truncate max-w-xs">{file.name}</span>
                    </td>
                    <td className="py-3">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-200 text-[11px] font-medium">
                        <HardDrive className="h-3 w-3 text-purple-400" />
                        {account?.email || file.storageAccountId}
                      </span>
                    </td>
                    <td className="py-3 text-slate-300">{formatBytes(file.sizeBytes)}</td>
                    <td className="py-3 text-slate-400">{formatDate(file.modifiedAt)}</td>
                    <td className="py-3 pr-2 text-right">
                      {file.webUrl ? (
                        <a
                          href={file.webUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-purple-300 hover:text-purple-200 font-medium transition-colors"
                        >
                          Drive <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
