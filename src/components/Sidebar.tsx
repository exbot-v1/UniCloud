/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Primary Navigation Sidebar
 */

import React from 'react';
import {
  FolderSync,
  Clock,
  Star,
  Trash2,
  HardDrive,
  Settings,
  Cloud,
  Layers,
  ChevronRight,
  User,
} from 'lucide-react';
import { cn, formatBytes } from '../lib/formatters';
import { StoragePoolSummary } from '../types/account';

export type ActiveNavTab =
  | 'files'
  | 'recent'
  | 'starred'
  | 'trash'
  | 'accounts'
  | 'settings'
  | 'profile';

interface SidebarProps {
  activeTab: ActiveNavTab;
  onSelectTab: (tab: ActiveNavTab) => void;
  poolSummary: StoragePoolSummary;
  className?: string;
  onOpenAddAccount: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  poolSummary,
  className,
  onOpenAddAccount,
}) => {
  const navItems = [
    { id: 'files' as const, label: 'My Files', icon: FolderSync },
    { id: 'recent' as const, label: 'Recent', icon: Clock },
    { id: 'starred' as const, label: 'Starred', icon: Star },
    { id: 'trash' as const, label: 'Trash', icon: Trash2 },
    { id: 'accounts' as const, label: 'Storage Accounts', icon: HardDrive, badge: poolSummary.accounts.length > 0 ? poolSummary.accounts.length : undefined },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
    { id: 'profile' as const, label: 'Profile', icon: User },
  ];

  return (
    <aside
      id="unicloud-sidebar"
      className={cn(
        'w-60 flex flex-col justify-between border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 select-none shrink-0 transition-all text-slate-700 dark:text-slate-300',
        className
      )}
    >
      {/* Brand & Logo */}
      <div>
        <div className="flex items-center gap-2.5 px-2 py-2 mb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs">
            <Cloud className="h-4 w-4" />
          </div>
          <div>
            <span className="font-semibold tracking-tight text-slate-900 dark:text-white text-base">UniCloud</span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`nav-item-${item.id}`}
                onClick={() => onSelectTab(item.id)}
                className={cn(
                  'w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left group cursor-pointer',
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold dark:bg-blue-950/60 dark:text-blue-300'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className={cn('h-4 w-4 shrink-0 transition-colors', isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300')} />
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span
                    className={cn(
                      'text-xs font-medium px-2 py-0.5 rounded-full',
                      isActive ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Storage Summary & Connect Action */}
      <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
        <div className="px-2 py-1">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1.5 font-medium">
            <span>Storage</span>
            <span>{poolSummary.usagePercentage}%</span>
          </div>

          {/* Progress Bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 mb-1.5">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, poolSummary.usagePercentage)}%` }}
            />
          </div>

          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {formatBytes(poolSummary.totalUsedBytes)} of {formatBytes(poolSummary.totalCapacityBytes)} used
          </div>
        </div>

        <button
          id="btn-add-account-sidebar"
          onClick={onOpenAddAccount}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 dark:text-slate-200 dark:hover:text-white dark:bg-slate-800 dark:hover:bg-slate-750 dark:border-slate-700 rounded-lg py-2 px-3 transition-colors shadow-2xs cursor-pointer"
        >
          <span>Connect Google Drive</span>
        </button>
      </div>
    </aside>
  );
};
