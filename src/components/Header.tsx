/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Top Header Component
 */

import React, { useState, useRef, useEffect } from 'react';
import { Search, UploadCloud, Menu, LogIn, LogOut, Sun, Moon, X, Command } from 'lucide-react';
import { StoragePoolSummary } from '../types/account';
import { UserPublicProfile } from '../types/auth';
import { SearchResultItem } from '../types/filesystem';
import { useTheme } from '../lib/theme';
import { GlobalSearch } from './GlobalSearch';

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
  onSelectSearchFile?: (file: SearchResultItem) => void;
  onSelectSearchFolder?: (folderId: string, folderName: string) => void;
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
  onSelectSearchFile,
  onSelectSearchFolder,
}) => {
  const { theme, toggleTheme } = useTheme();
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcut: Ctrl+K or Cmd+K or / to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsSearchOpen(true);
      } else if (e.key === '/' && document.activeElement !== searchInputRef.current) {
        // Only if not already typing in another input/textarea
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault();
          searchInputRef.current?.focus();
          setIsSearchOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const getInitials = () => {
    if (!user) return '??';
    if (user.displayName) {
      return user.displayName.slice(0, 2).toUpperCase();
    }
    return user.email.slice(0, 2).toUpperCase();
  };

  const handleClearSearch = () => {
    onSearchChange('');
    setIsSearchOpen(false);
    searchInputRef.current?.focus();
  };

  return (
    <header
      id="unicloud-header"
      className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 md:px-6 flex items-center justify-between gap-4 sticky top-0 z-20 text-slate-900 dark:text-slate-100"
    >
      {/* Left section: mobile toggle & search */}
      <div className="flex items-center gap-3 flex-1 max-w-xl">
        <button
          id="btn-sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label="Toggle Navigation Sidebar"
          className="md:hidden p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="relative w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
          <input
            ref={searchInputRef}
            id="global-search-input"
            type="text"
            value={searchQuery}
            onFocus={() => setIsSearchOpen(true)}
            onChange={(e) => {
              onSearchChange(e.target.value);
              setIsSearchOpen(true);
            }}
            placeholder="Search across all Google Drive accounts..."
            className="w-full pl-9.5 pr-14 py-2 text-sm bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl border border-slate-200 dark:border-slate-750 focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800 transition-colors shadow-2xs"
          />

          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {searchQuery ? (
              <button
                type="button"
                onClick={handleClearSearch}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors cursor-pointer"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-slate-200/50 dark:bg-slate-750 rounded border border-slate-300/60 dark:border-slate-700 select-none pointer-events-none">
                <Command className="h-2.5 w-2.5" />K
              </kbd>
            )}
          </div>

          {/* Connected Global Search Dropdown */}
          {isSearchOpen && (
            <GlobalSearch
              searchQuery={searchQuery}
              onSearchChange={onSearchChange}
              isOpen={isSearchOpen}
              onClose={() => setIsSearchOpen(false)}
              onSelectFile={(file) => {
                if (onSelectSearchFile) onSelectSearchFile(file);
                setIsSearchOpen(false);
              }}
              onSelectFolder={(folderId, folderName) => {
                if (onSelectSearchFolder) onSelectSearchFolder(folderId, folderName);
                setIsSearchOpen(false);
              }}
            />
          )}
        </div>
      </div>

      {/* Right section: Upload & User Actions */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Theme Mode Toggle */}
        <button
          id="btn-theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle theme"
          className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4 text-amber-400" />
          ) : (
            <Moon className="h-4 w-4 text-slate-600" />
          )}
        </button>

        {/* Upload Action Button */}
        <button
          id="btn-quick-upload"
          onClick={onOpenUpload}
          title="Upload file"
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs sm:text-sm font-medium shadow-xs transition-colors active:scale-[0.98] cursor-pointer"
        >
          <UploadCloud className="h-4 w-4 text-white" />
          <span className="hidden sm:inline">Upload File</span>
          <span className="sm:hidden">Upload</span>
        </button>

        {/* User Profile / Auth State */}
        {user ? (
          <div className="flex items-center gap-2.5 pl-2.5 border-l border-slate-200 dark:border-slate-800">
            <button
              id="btn-header-profile"
              onClick={onNavigateProfile}
              title="View Profile"
              className="flex items-center gap-2.5 hover:opacity-85 transition-opacity text-left cursor-pointer"
            >
              <div className="h-8 w-8 rounded-full bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 flex items-center justify-center text-xs font-semibold shadow-2xs">
                {getInitials()}
              </div>
              <div className="hidden xl:block">
                <p className="text-xs font-medium text-slate-900 dark:text-slate-100 leading-tight">
                  {user.displayName || user.email.split('@')[0]}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight truncate max-w-[120px]">
                  {user.email}
                </p>
              </div>
            </button>
            <button
              id="btn-header-logout"
              onClick={onLogout}
              title="Sign Out"
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 dark:hover:text-red-400 rounded-lg transition-colors ml-1 cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="pl-2.5 border-l border-slate-200 dark:border-slate-800">
            <button
              onClick={onOpenAuth}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium transition-colors shadow-2xs cursor-pointer"
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
