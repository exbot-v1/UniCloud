/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Primary Navigation Sidebar
 */

import React from 'react';
import {
  LayoutDashboard,
  FolderSync,
  Clock,
  Star,
  Trash2,
  HardDrive,
  BookOpen,
  Settings,
  Cloud,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { cn, formatBytes } from '../lib/formatters';
import { StoragePoolSummary } from '../types/account';

export type ActiveNavTab =
  | 'dashboard'
  | 'files'
  | 'recent'
  | 'starred'
  | 'trash'
  | 'accounts'
  | 'spec'
  | 'settings';

interface SidebarProps {
  activeTab: ActiveNavTab;
  onSelectTab: (tab: ActiveNavTab) => void;
  poolSummary: StoragePoolSummary;
  className?: string;
  onOpenAddAccount: () => void;
  isDemoData?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  poolSummary,
  className,
  onOpenAddAccount,
  isDemoData = false,
}) => {
  const navItems = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'files' as const, label: 'My Files', icon: FolderSync },
    { id: 'recent' as const, label: 'Recent', icon: Clock },
    { id: 'starred' as const, label: 'Starred', icon: Star },
    { id: 'trash' as const, label: 'Trash', icon: Trash2 },
    { id: 'accounts' as const, label: 'Storage Accounts', icon: HardDrive, badge: poolSummary.accounts.length },
    { id: 'spec' as const, label: 'Architecture & Spec', icon: BookOpen, tag: 'Phase 2.1.1' },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
  ];

  return (
    <aside
      id="unicloud-sidebar"
      className={cn(
        'w-64 flex flex-col justify-between border-r border-[#262c36] bg-[#12161f] p-4 select-none shrink-0 transition-all text-slate-200',
        className
      )}
    >
      {/* Brand & Logo */}
      <div>
        <div className="flex items-center gap-3 px-2 py-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 text-slate-950 font-black shadow-md shadow-cyan-950/40">
            <Cloud className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold tracking-tight text-white text-lg">UniCloud</span>
              <span className="rounded-full bg-cyan-950/60 border border-cyan-800/60 px-2 py-0.5 text-[10px] font-semibold text-cyan-300 uppercase tracking-wider">
                Virtual
              </span>
            </div>
            <p className="text-xs text-slate-400">Multi-Account Drive Layer</p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`nav-item-${item.id}`}
                onClick={() => onSelectTab(item.id)}
                className={cn(
                  'w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left',
                  isActive
                    ? 'bg-[#1a202c] text-cyan-200 border border-cyan-500/30 shadow-xs'
                    : 'text-slate-400 hover:bg-[#161b24] hover:text-slate-200 border border-transparent'
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full transition-all',
                      isActive ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]' : 'bg-transparent'
                    )}
                  />
                  <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-cyan-400' : 'text-slate-400')} />
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span
                    className={cn(
                      'text-xs font-semibold px-2 py-0.5 rounded-full',
                      isActive ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/30' : 'bg-[#161b24] text-slate-400 border border-[#262c36]'
                    )}
                  >
                    {item.badge}
                  </span>
                )}
                {item.tag && (
                  <span
                    className={cn(
                      'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
                      isActive ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/40' : 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/40'
                    )}
                  >
                    {item.tag}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Storage Pool Widget & Account Action */}
      <div className="mt-6 pt-4 border-t border-[#262c36] space-y-3">
        <div className="rounded-2xl border border-[#262c36] bg-[#161b24] p-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-cyan-400" />
              Storage Pool
            </span>
            <span className="font-medium text-cyan-300">{poolSummary.usagePercentage}%</span>
          </div>

          {/* Progress Bar */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#0e1117] border border-[#262c36] mb-2">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-teal-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, poolSummary.usagePercentage)}%` }}
            />
          </div>

          <div className="flex justify-between items-center text-[11px] text-slate-400">
            <span>{formatBytes(poolSummary.totalUsedBytes)} used</span>
            <span>{formatBytes(poolSummary.totalCapacityBytes)} pool</span>
          </div>
          
          <div className="mt-2 pt-2 border-t border-[#262c36] text-[10px] text-slate-400 flex items-center justify-between">
            <span>{poolSummary.accounts.length} {isDemoData ? 'Demo Accounts' : 'Connected Accounts'}</span>
            <span className="text-teal-400 font-medium">{formatBytes(poolSummary.totalFreeBytes)} free</span>
          </div>
        </div>

        <button
          id="btn-add-account-sidebar"
          onClick={onOpenAddAccount}
          className="w-full flex items-center justify-between text-xs font-semibold text-cyan-300 hover:text-white bg-[#1a202c] hover:bg-[#222a38] border border-cyan-500/30 rounded-xl px-3 py-2 transition-all shadow-xs"
        >
          <span>+ Connect Google Drive</span>
          <ChevronRight className="h-3.5 w-3.5 text-cyan-400" />
        </button>
      </div>
    </aside>
  );
};
