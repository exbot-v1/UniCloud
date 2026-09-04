/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Top Header Component
 */

import React from 'react';
import { Search, UploadCloud, Menu, CheckCircle2 } from 'lucide-react';
import { StoragePoolSummary } from '../types/account';

interface HeaderProps {
  onToggleSidebar?: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onOpenUpload: () => void;
  poolSummary: StoragePoolSummary;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  searchQuery,
  onSearchChange,
  onOpenUpload,
}) => {
  return (
    <header
      id="unicloud-header"
      className="h-16 border-b border-white/10 bg-white/[0.02] backdrop-blur-xl px-4 md:px-6 flex items-center justify-between gap-4 sticky top-0 z-20 text-slate-100"
    >
      {/* Left section: mobile toggle & search */}
      <div className="flex items-center gap-3 flex-1 max-w-xl">
        <button
          id="btn-sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label="Toggle Navigation Sidebar"
          className="md:hidden p-2 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded-xl transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="relative w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="global-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search across all connected Google Drives..."
            className="w-full pl-10 pr-12 py-2 text-sm bg-white/[0.05] hover:bg-white/[0.08] focus:bg-white/[0.1] text-slate-100 placeholder:text-slate-400 rounded-xl border border-white/10 focus:border-purple-400/60 focus:outline-hidden transition-all backdrop-blur-sm"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-white/10 border border-white/15 rounded">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right section: System Status & User Actions */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Architecture Status Badge */}
        <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 bg-purple-500/15 border border-purple-500/30 rounded-full text-xs text-purple-300 font-medium backdrop-blur-sm">
          <CheckCircle2 className="h-3.5 w-3.5 text-purple-400" />
          <span>Phase 0: Foundation Active</span>
        </div>

        {/* Upload Action Button */}
        <button
          id="btn-quick-upload"
          onClick={onOpenUpload}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-purple-500/25 border border-purple-400/30 transition-all active:scale-[0.98]"
        >
          <UploadCloud className="h-4 w-4" />
          <span className="hidden sm:inline">Upload File</span>
        </button>

        {/* User Avatar */}
        <div className="flex items-center gap-2.5 pl-3 border-l border-white/10">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold ring-2 ring-white/15 shadow-md shadow-purple-500/20">
            SD
          </div>
          <div className="hidden xl:block text-left">
            <p className="text-xs font-semibold text-white leading-tight">socialdoodle7</p>
            <p className="text-[11px] text-slate-400 leading-tight">Storage Architect</p>
          </div>
        </div>
      </div>
    </header>
  );
};
