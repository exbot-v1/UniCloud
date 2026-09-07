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
  Upload,
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
  isDemoData?: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  poolSummary,
  recentFiles,
  onOpenUpload,
  onOpenAddAccount,
  onNavigateFiles,
  onNavigateAccounts,
  isDemoData = false,
}) => {
  return (
    <div id="dashboard-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Banner: Architecture Notice */}
      <div className="rounded-2xl border border-[#262c36] bg-[#161b24] p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 mt-0.5">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white tracking-tight">Virtual Storage Layer Active</h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-950/60 text-cyan-300 border border-cyan-800/60">
                  Phase 2.1.1
                </span>
              </div>
              <p className="text-sm text-slate-300 mt-1 max-w-3xl leading-relaxed">
                Google Drive quotas remain separate. UniCloud provides a virtual storage layer that maps files and folders across connected accounts into one unified namespace.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={onOpenAddAccount}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#1a202c] hover:bg-[#222a38] text-slate-200 border border-[#262c36] rounded-xl shadow-xs transition-all"
            >
              <Plus className="h-3.5 w-3.5 text-cyan-400" />
              Add Google Account
            </button>
            <button
              id="btn-hero-upload"
              onClick={onOpenUpload}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl shadow-xs transition-all"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload File
            </button>
          </div>
        </div>
      </div>

      {/* Main Stats Grid: Unified Storage Pool & Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Card 1: Virtual Pool Gauge (Span 2 cols on lg) */}
        <div className="lg:col-span-2 rounded-2xl border border-[#262c36] bg-[#161b24] p-5 sm:p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Unified Storage Pool</h2>
                  <p className="text-xs text-slate-400">Aggregated virtual capacity across all connected drives</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isDemoData ? (
                  <>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-950/60 border border-cyan-800/60 text-cyan-300 uppercase tracking-wider">
                      Demo Preview
                    </span>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#10141b] border border-[#262c36] text-slate-300">
                      {poolSummary.accounts.length} Demo Accounts
                    </span>
                  </>
                ) : (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#10141b] border border-[#262c36] text-slate-300">
                    {poolSummary.accounts.length} Connected Accounts
                  </span>
                )}
              </div>
            </div>

            {/* Metrics Display - Tightened spacing */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 my-3.5 p-3.5 rounded-xl bg-[#10141b] border border-[#262c36]">
              <div>
                <p className="text-xs font-medium text-slate-400">Total Virtual Capacity</p>
                <p className="text-2xl font-black text-white mt-0.5">
                  {formatBytes(poolSummary.totalCapacityBytes)}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">Aggregate storage quota</p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-400">Aggregate Used Storage</p>
                <p className="text-2xl font-black text-cyan-300 mt-0.5">
                  {formatBytes(poolSummary.totalUsedBytes)}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">{poolSummary.usagePercentage}% utilized</p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-400">Available Pool Storage</p>
                <p className="text-2xl font-black text-teal-400 mt-0.5">
                  {formatBytes(poolSummary.totalFreeBytes)}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">Free virtual headroom</p>
              </div>
            </div>

            {/* Master Progress Bar with Account Segmentation */}
            <div className="space-y-1.5 mt-2">
              <div className="flex justify-between text-xs text-slate-300">
                <span>Storage Distribution</span>
                <span className="font-semibold text-cyan-300">{poolSummary.usagePercentage}% full</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-[#0e1117] border border-[#262c36] overflow-hidden flex">
                {poolSummary.accounts.map((acc, index) => {
                  const pct = poolSummary.totalCapacityBytes > 0 
                    ? (acc.quota.usedBytes / poolSummary.totalCapacityBytes) * 100 
                    : 0;
                  const colors = ['bg-cyan-500', 'bg-teal-400', 'bg-sky-500', 'bg-emerald-400'];
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
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {poolSummary.accounts.map((acc, index) => {
                  const colors = ['bg-cyan-500', 'bg-teal-400', 'bg-sky-500', 'bg-emerald-400'];
                  return (
                    <div key={acc.id} className="flex items-center gap-1.5 text-xs text-slate-300">
                      <span className={`h-2 w-2 rounded-full ${colors[index % colors.length]}`} />
                      <span className="truncate max-w-[140px] font-medium">{acc.email.split('@')[0]}</span>
                      <span className="text-slate-400 text-[11px]">({formatBytes(acc.quota.usedBytes)})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#262c36] flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5">
              {isDemoData ? (
                <>
                  <AlertCircle className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Demo Data Preview — Google OAuth available</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Google Drive metadata synchronized</span>
                </>
              )}
            </span>
            <button
              onClick={onNavigateAccounts}
              className="font-semibold text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1 transition-colors"
            >
              Manage Accounts <ArrowUpRight className="h-3.5 w-3.5 text-cyan-400" />
            </button>
          </div>
        </div>

        {/* Card 2: Routing & Architecture Info */}
        <div className="rounded-2xl border border-[#262c36] bg-[#161b24] p-5 sm:p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-300">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Upload Routing</h2>
                  <p className="text-xs text-slate-400">Multi-account capacity balancer</p>
                </div>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#10141b] text-slate-400 border border-[#262c36] uppercase tracking-wider">
                Planned — Phase 4
              </span>
            </div>

            <p className="text-xs text-slate-400 mb-3 leading-relaxed">
              Upload routing will distribute new files across connected Drive accounts according to available capacity and the selected routing strategy.
            </p>

            <div className="space-y-2.5 text-xs text-slate-300">
              <div className="p-3 rounded-xl bg-[#10141b] border border-[#262c36] space-y-1">
                <p className="font-semibold text-white">Planned Strategy</p>
                <p className="text-cyan-300 font-medium">Most Free Space (Auto)</p>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Files will be dynamically directed to whichever connected account has the highest available capacity.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-[#10141b] border border-[#262c36] space-y-1">
                <p className="font-semibold text-white">Large File Upload</p>
                <p className="text-teal-400 font-medium">Planned — Phase 4</p>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Resumable and serverless-safe large-file uploads are planned for Phase 4.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-[#10141b] border border-[#262c36] space-y-1">
                <p className="font-semibold text-white">Security Architecture</p>
                <p className="text-cyan-400 font-medium">AES-256-GCM Encrypted</p>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Refresh tokens encrypted at rest; zero browser JavaScript exposure.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#262c36]">
            <button
              id="btn-routing-preview"
              disabled
              title="Upload routing is not yet operational."
              className="w-full py-2.5 px-4 bg-[#10141b] text-slate-500 border border-[#262c36] rounded-xl text-xs font-semibold text-center cursor-not-allowed"
            >
              Routing Preview — Phase 4
            </button>
          </div>
        </div>
      </div>

      {/* Connected Google Drive Accounts Row */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">
              {isDemoData ? 'Google Drive Accounts' : 'Connected Google Drive Accounts'}
            </h2>
            <p className="text-xs text-slate-400">
              {isDemoData
                ? `${poolSummary.accounts.length} demo accounts showing simulated capacity`
                : 'Each account maintains its individual quota while sharing a unified virtual namespace'}
            </p>
          </div>
          {isDemoData ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-950/60 text-cyan-300 border border-cyan-800/60">
              Demo Preview Data
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
              Live Google Drive Quotas
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {poolSummary.accounts.map((acc: StorageAccount, index: number) => (
            <div
              key={acc.id}
              className="rounded-xl border border-[#262c36] bg-[#161b24] p-4 shadow-xs hover:border-cyan-500/40 hover:bg-[#1a202c] transition-all space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-xl bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center font-bold text-cyan-300 text-xs">
                    #{String(index + 1).padStart(2, '0')}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white truncate max-w-[160px]">{acc.displayName || acc.email}</p>
                    <p className="text-[11px] text-slate-400 truncate max-w-[160px]">{acc.email}</p>
                  </div>
                </div>
                {isDemoData ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                    DEMO
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-950/60 text-teal-300 border border-teal-800/50">
                    {acc.status}
                  </span>
                )}
              </div>

              {/* Account Quota Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-slate-300">
                  <span>Usage</span>
                  <span className="font-semibold text-white">
                    {formatBytes(acc.quota.usedBytes)} / {formatBytes(acc.quota.totalBytes)}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-[#0e1117] border border-[#262c36] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-teal-400 rounded-full"
                    style={{ width: `${acc.quota.usagePercentage}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>{acc.quota.usagePercentage}% used</span>
                  <span className="text-teal-400 font-medium">{formatBytes(acc.quota.freeBytes)} available</span>
                </div>
              </div>

              <div className="pt-2 border-t border-[#262c36] flex items-center justify-between text-[11px] text-slate-400">
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
      <div className="rounded-2xl border border-[#262c36] bg-[#161b24] p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-cyan-400" />
            <h2 className="text-base font-bold text-white">Recent Virtual Files</h2>
          </div>
          <button
            onClick={onNavigateFiles}
            className="text-xs font-semibold text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1 transition-colors"
          >
            Open File Browser <ArrowUpRight className="h-3.5 w-3.5 text-cyan-400" />
          </button>
        </div>

        {recentFiles.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-[#262c36] bg-[#10141b]">
            <FileText className="h-6 w-6 text-slate-500 mx-auto mb-2" />
            <p className="text-xs font-semibold text-slate-300">No virtual files yet</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Files in your connected Google Drive accounts will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#262c36] text-slate-400 font-semibold">
                  <th className="pb-3 pl-2">File Name</th>
                  <th className="pb-3">Physical Storage Account</th>
                  <th className="pb-3">Size</th>
                  <th className="pb-3">Modified</th>
                  <th className="pb-3 pr-2 text-right">Provider Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#262c36]/60 text-slate-300">
                {recentFiles.map((file) => {
                  const account = poolSummary.accounts.find((a) => a.id === file.storageAccountId);
                  return (
                    <tr key={file.id} className="hover:bg-[#1c222b] transition-colors">
                      <td className="py-3 pl-2 font-medium text-white flex items-center gap-2.5">
                        <FileText className="h-4 w-4 text-cyan-400 shrink-0" />
                        <span className="truncate max-w-xs">{file.name}</span>
                      </td>
                      <td className="py-3">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#10141b] border border-[#262c36] text-slate-200 text-[11px] font-medium">
                          <HardDrive className="h-3 w-3 text-cyan-400" />
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
                            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-medium transition-colors"
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
        )}
      </div>
    </div>
  );
};
