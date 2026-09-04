/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Top Header Component
 */

import React from 'react';
import { Search, UploadCloud, Menu, CheckCircle2, LogIn, LogOut, User } from 'lucide-react';
import { StoragePoolSummary } from '../types/account';
import { UserPublicProfile } from '../types/auth';

interface HeaderProps {
  onToggleSidebar?: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onOpenUpload: () => void;
  poolSummary: StoragePoolSummary;
  user: UserPublicProfile | null;
  onOpenAuth: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  searchQuery,
  onSearchChange,
  onOpenUpload,
  user,
  onOpenAuth,
  onLogout,
}) => {
  const getInitials = () => {
    if (!user) return '??';
    if (user.displayName) {
      return user.displayName.slice(0, 2).toUpperCase();
    }
    return user.email.slice(0, 2).toUpperCase();
  };

  return (
    <header
      id="unicloud-header"
      className="h-16 border-b border-[#262c36] bg-[#12161f] px-4 md:px-6 flex items-center justify-between gap-4 sticky top-0 z-20 text-slate-100"
    >
      {/* Left section: mobile toggle & search */}
      <div className="flex items-center gap-3 flex-1 max-w-xl">
        <button
          id="btn-sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label="Toggle Navigation Sidebar"
          className="md:hidden p-2 text-slate-400 hover:text-slate-200 hover:bg-[#161b24] rounded-xl transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="relative w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-cyan-400/70" />
          <input
            id="global-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search across all connected Google Drives..."
            className="w-full pl-10 pr-12 py-2 text-sm bg-[#0e1117] hover:bg-[#161b24] focus:bg-[#161b24] text-slate-100 placeholder:text-slate-400 rounded-xl border border-[#262c36] focus:border-cyan-500/70 focus:outline-hidden transition-all"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-[#1a202c] border border-[#262c36] rounded">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right section: System Status & User Actions */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Architecture Status Badge */}
        <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 bg-cyan-950/50 border border-cyan-800/60 rounded-full text-xs text-cyan-300 font-medium">
          <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400" />
          <span>Phase 1: DB &amp; Auth Active</span>
        </div>

        {/* Upload Action Button */}
        <button
          id="btn-quick-upload"
          onClick={onOpenUpload}
          className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl text-sm font-bold shadow-md shadow-cyan-950/50 border border-cyan-400/50 transition-all active:scale-[0.98]"
        >
          <UploadCloud className="h-4 w-4 text-slate-950" />
          <span className="hidden sm:inline">Upload File</span>
        </button>

        {/* User Profile / Auth State */}
        {user ? (
          <div className="flex items-center gap-2.5 pl-3 border-l border-[#262c36]">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center text-slate-950 text-xs font-black ring-2 ring-cyan-500/30 shadow-sm">
              {getInitials()}
            </div>
            <div className="hidden xl:block text-left">
              <p className="text-xs font-semibold text-white leading-tight">
                {user.displayName || user.email.split('@')[0]}
              </p>
              <p className="text-[11px] text-slate-400 leading-tight truncate max-w-[120px]">
                {user.email}
              </p>
            </div>
            <button
              onClick={onLogout}
              title="Sign Out"
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-[#161b24] rounded-lg transition-colors ml-1"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="pl-3 border-l border-[#262c36]">
            <button
              onClick={onOpenAuth}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#1a202c] hover:bg-[#222a38] text-cyan-300 border border-cyan-800/40 rounded-xl text-xs font-bold transition-all shadow-xs"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Sign In</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
