/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Global Search Dropdown
 * Connects the header search to /api/search across all connected Google Drive accounts,
 * with category filters, sorting, account attribution, location path, and keyboard navigation.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  X,
  HardDrive,
  Folder,
  FileText,
  FileSpreadsheet,
  FileImage,
  FileCode,
  FileArchive,
  Music,
  Video,
  Loader2,
  SlidersHorizontal,
  ChevronRight,
  CornerDownLeft,
  ArrowUpDown,
} from 'lucide-react';
import { SearchResult, SearchResultItem, VirtualFile } from '../types/filesystem';
import { cn, formatBytes, formatDate } from '../lib/formatters';
import { authFetch } from '../lib/api';

export interface GlobalSearchProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isOpen: boolean;
  onClose: () => void;
  onSelectFile: (file: SearchResultItem) => void;
  onSelectFolder: (folderId: string, folderName: string) => void;
}

type FilterCategory = 'all' | 'documents' | 'images' | 'folders' | 'archives';
type SortOption = 'modifiedAt' | 'name' | 'size';

export const GlobalSearch: React.FC<GlobalSearchProps> = ({
  searchQuery,
  onSearchChange,
  isOpen,
  onClose,
  onSelectFile,
  onSelectFolder,
}) => {
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<FilterCategory>('all');
  const [sortBy, setSortBy] = useState<SortOption>('modifiedAt');
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Debounced search query
  useEffect(() => {
    if (!isOpen || !searchQuery.trim()) {
      setResults([]);
      setTotalCount(0);
      setIsLoading(false);
      setError(null);
      setSelectedIndex(-1);
      return;
    }

    const timer = setTimeout(() => {
      executeSearch();
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery, category, sortBy, isOpen]);

  const executeSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsLoading(true);
    setError(null);

    let mimeParam = '';
    if (category === 'documents') mimeParam = '&mimeType=document';
    else if (category === 'images') mimeParam = '&mimeType=image';
    else if (category === 'folders') mimeParam = '&mimeType=folder';
    else if (category === 'archives') mimeParam = '&mimeType=zip';

    try {
      const url = `/api/search?query=${encodeURIComponent(searchQuery.trim())}${mimeParam}&sortBy=${sortBy}&limit=25`;
      const res = await authFetch(url);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || 'Search failed');
      }

      const searchData: SearchResult = json.data;
      setResults(searchData.items || []);
      setTotalCount(searchData.totalCount ?? searchData.total ?? searchData.items?.length ?? 0);
      setSelectedIndex(-1);
    } catch (err: any) {
      console.error('Search error:', err);
      setError(err.message || 'Unable to load search results');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle keyboard navigation: ArrowUp, ArrowDown, Enter, Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
      } else if (e.key === 'Enter' && selectedIndex >= 0 && results[selectedIndex]) {
        e.preventDefault();
        handleSelectItem(results[selectedIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex]);

  // Handle outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen, onClose]);

  const handleSelectItem = (item: SearchResultItem) => {
    if (item.isFolder) {
      onSelectFolder(item.id, item.name);
    } else {
      onSelectFile(item);
    }
    onClose();
  };

  const getFileIcon = (item: SearchResultItem) => {
    if (item.isFolder) {
      return <Folder className="h-4 w-4 text-amber-500 fill-amber-500/20" />;
    }
    if (item.mimeType?.includes('spreadsheet') || item.mimeType?.includes('excel')) {
      return <FileSpreadsheet className="h-4 w-4 text-emerald-500" />;
    }
    if (item.mimeType?.startsWith('image/')) {
      return <FileImage className="h-4 w-4 text-indigo-500" />;
    }
    if (item.mimeType?.includes('zip') || item.mimeType?.includes('archive')) {
      return <FileArchive className="h-4 w-4 text-amber-600" />;
    }
    if (item.mimeType?.startsWith('audio/')) {
      return <Music className="h-4 w-4 text-pink-500" />;
    }
    if (item.mimeType?.startsWith('video/')) {
      return <Video className="h-4 w-4 text-purple-500" />;
    }
    if (item.mimeType?.startsWith('text/') || item.mimeType?.includes('json') || item.mimeType?.includes('javascript')) {
      return <FileCode className="h-4 w-4 text-sky-500" />;
    }
    return <FileText className="h-4 w-4 text-blue-500" />;
  };

  if (!isOpen) return null;

  return (
    <div
      ref={dropdownRef}
      id="global-search-dropdown"
      className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-50 text-slate-900 dark:text-slate-100 animate-in fade-in-50 slide-in-from-top-1 duration-150"
    >
      {/* Search Header Filters Bar */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/70 flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          <button
            type="button"
            onClick={() => setCategory('all')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap cursor-pointer',
              category === 'all'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-white dark:bg-slate-850 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-750'
            )}
          >
            All Items
          </button>
          <button
            type="button"
            onClick={() => setCategory('documents')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap cursor-pointer',
              category === 'documents'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-white dark:bg-slate-850 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-750'
            )}
          >
            Documents
          </button>
          <button
            type="button"
            onClick={() => setCategory('images')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap cursor-pointer',
              category === 'images'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-white dark:bg-slate-850 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-750'
            )}
          >
            Images
          </button>
          <button
            type="button"
            onClick={() => setCategory('folders')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap cursor-pointer',
              category === 'folders'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-white dark:bg-slate-850 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-750'
            )}
          >
            Folders
          </button>
        </div>

        {/* Sort Selector */}
        <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400 shrink-0">
          <ArrowUpDown className="h-3 w-3" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="bg-transparent border-0 text-xs text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer pr-1"
          >
            <option value="modifiedAt" className="dark:bg-slate-900">Recently Modified</option>
            <option value="name" className="dark:bg-slate-900">Name (A-Z)</option>
            <option value="size" className="dark:bg-slate-900">File Size</option>
          </select>
        </div>
      </div>

      {/* Results Content Area */}
      <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            <span>Searching unified storage across all Google accounts...</span>
          </div>
        ) : error ? (
          <div className="p-6 text-center text-xs text-rose-500 space-y-2">
            <p>{error}</p>
            <button
              onClick={executeSearch}
              className="px-3 py-1 bg-blue-600 text-white rounded-md text-xs font-medium"
            >
              Retry Search
            </button>
          </div>
        ) : !searchQuery.trim() ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Type keywords to search files and folders across all Google Drive accounts.
          </div>
        ) : results.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <p className="font-medium text-slate-700 dark:text-slate-200">No results found</p>
            <p className="text-slate-400">No files or folders matching "{searchQuery}"</p>
          </div>
        ) : (
          <div>
            <div className="px-4 py-2 text-[11px] font-medium text-slate-400 dark:text-slate-500 bg-slate-50/40 dark:bg-slate-850/40 flex items-center justify-between">
              <span>{totalCount} {totalCount === 1 ? 'item' : 'items'} found</span>
              <span className="text-[10px]">Use ↑ ↓ to navigate, Enter to open</span>
            </div>

            {results.map((item, idx) => {
              const isSelected = selectedIndex === idx;
              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectItem(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    'px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors text-xs',
                    isSelected
                      ? 'bg-blue-50/80 dark:bg-blue-950/50 text-blue-950 dark:text-blue-100'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-850/60'
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
                      {getFileIcon(item)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {item.name}
                        </span>
                        {item.isFolder && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-medium">
                            Folder
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {item.location && (
                          <span className="flex items-center gap-0.5 truncate text-slate-600 dark:text-slate-400">
                            <Folder className="h-3 w-3 text-slate-400 shrink-0" />
                            <span className="truncate">{item.location}</span>
                          </span>
                        )}
                        <span>•</span>
                        <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400 shrink-0">
                          <HardDrive className="h-3 w-3 text-blue-500 shrink-0" />
                          <span className="truncate max-w-[140px]">{item.accountEmail}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0 text-[11px] text-slate-400 dark:text-slate-500 flex flex-col items-end">
                    {!item.isFolder && <span>{formatBytes(item.sizeBytes)}</span>}
                    <span>{formatDate(item.modifiedAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer shortcut bar */}
      <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex items-center justify-between text-[11px] text-slate-400">
        <span>Press <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-750 text-slate-700 dark:text-slate-300 font-mono text-[10px]">Esc</kbd> to close</span>
        <div className="flex items-center gap-1">
          <span>Open</span>
          <CornerDownLeft className="h-3 w-3" />
        </div>
      </div>
    </div>
  );
};
