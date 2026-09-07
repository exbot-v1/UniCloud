/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Top Header Component
 */

import React from 'react';
import { Search, UploadCloud, Menu, LogIn, LogOut, User } from 'lucide-react';
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
  onNavigateProfile?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  searchQuery,
  onSearchChange,
  onOpenUpload,
  user,
  onOpenAuth,
  onLogout,
  onNavigateProfile,
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
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            id="global-search-input"
            type="text"
            value={searchQuery}
            disabled
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search files and folders..."
            className="w-full pl-10 pr-4 py-2 text-sm bg-[#0e1117]/60 text-slate-400 placeholder:text-slate-500 rounded-xl border border-[#262c36] cursor-not-allowed transition-all"
          />
        </div>
      </div>

      {/* Right section: Upload & User Actions */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Upload Action Button */}
        <button
          id="btn-quick-upload"
          onClick={onOpenUpload}
          title="Upload file"
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-cyan-950/40 border border-cyan-400/40 transition-all active:scale-[0.98] cursor-pointer"
        >
          <UploadCloud className="h-4 w-4 text-white" />
          <span className="hidden sm:inline">Upload File</span>
          <span className="sm:hidden">Upload</span>
        </button>

        {/* User Profile / Auth State */}
        {user ? (
          <div className="flex items-center gap-2.5 pl-3 border-l border-[#262c36]">
            <button
              id="btn-header-profile"
              onClick={onNavigateProfile}
              title="View Profile"
              className="flex items-center gap-2.5 hover:opacity-85 transition-opacity text-left cursor-pointer"
            >
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center text-slate-950 text-xs font-black ring-2 ring-cyan-500/30 shadow-sm">
                {getInitials()}
              </div>
              <div className="hidden xl:block">
                <p className="text-xs font-semibold text-white leading-tight">
                  {user.displayName || user.email.split('@')[0]}
                </p>
                <p className="text-[11px] text-slate-400 leading-tight truncate max-w-[120px]">
                  {user.email}
                </p>
              </div>
            </button>
            <button
              id="btn-header-logout"
              onClick={onLogout}
              title="Sign Out"
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-[#161b24] rounded-lg transition-colors ml-1 cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="pl-3 border-l border-[#262c36]">
            <button
              onClick={onOpenAuth}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#1a202c] hover:bg-[#222a38] text-cyan-300 border border-cyan-800/40 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
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
