/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Virtual File Browser (Phase 0)
 * Visualizes the virtual filesystem layer mapping to physical Google Drive accounts.
 */

import React, { useState } from 'react';
import {
  Folder,
  FileText,
  FileSpreadsheet,
  FileImage,
  FileCode,
  FileArchive,
  LayoutGrid,
  List,
  HardDrive,
  ExternalLink,
  Star,
  MoreVertical,
  Plus,
  Upload,
  ArrowUpDown,
  Filter,
  Info,
  X,
  ShieldAlert,
} from 'lucide-react';
import { VirtualFile, VirtualFolder, ViewMode, FileSortField } from '../types/filesystem';
import { StorageAccount } from '../types/account';
import { cn, formatBytes, formatDate } from '../lib/formatters';

interface FilesViewProps {
  folders: VirtualFolder[];
  files: VirtualFile[];
  accounts: StorageAccount[];
  searchQuery: string;
  onOpenUpload: () => void;
  tabTitle?: string;
}

export const FilesView: React.FC<FilesViewProps> = ({
  folders,
  files,
  accounts,
  searchQuery,
  onOpenUpload,
  tabTitle = 'My Files',
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<VirtualFile | null>(null);
  const [sortField, setSortField] = useState<FileSortField>('modifiedAt');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [noticeModal, setNoticeModal] = useState<string | null>(null);

  // Filter files based on search, current folder, and category
  const filteredFiles = files.filter((f) => {
    // Search query
    if (searchQuery && !f.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    // Category filter
    if (categoryFilter === 'documents') {
      if (!f.mimeType.includes('pdf') && !f.mimeType.includes('officedocument') && !f.mimeType.includes('text')) {
        return false;
      }
    } else if (categoryFilter === 'images') {
      if (!f.mimeType.startsWith('image/')) return false;
    } else if (categoryFilter === 'archives') {
      if (!f.mimeType.includes('zip') && !f.mimeType.includes('gzip') && !f.mimeType.includes('tar')) return false;
    }
    // Folder hierarchy
    if (currentFolderId !== null && f.parentId !== currentFolderId) {
      return false;
    }
    return true;
  });

  const filteredFolders = folders.filter((f) => {
    if (searchQuery && !f.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (currentFolderId !== null && f.parentId !== currentFolderId) {
      return false;
    }
    return true;
  });

  const currentFolder = folders.find((f) => f.id === currentFolderId);

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      return <FileSpreadsheet className="h-5 w-5 text-emerald-600" />;
    }
    if (mimeType.startsWith('image/')) {
      return <FileImage className="h-5 w-5 text-indigo-600" />;
    }
    if (mimeType.includes('zip') || mimeType.includes('gzip')) {
      return <FileArchive className="h-5 w-5 text-amber-600" />;
    }
    if (mimeType.includes('code') || mimeType.includes('javascript') || mimeType.includes('json')) {
      return <FileCode className="h-5 w-5 text-purple-600" />;
    }
    return <FileText className="h-5 w-5 text-sky-600" />;
  };

  return (
    <div id="files-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-sm text-slate-300 overflow-x-auto">
          <button
            onClick={() => setCurrentFolderId(null)}
            className={cn(
              'font-semibold hover:text-white transition-colors',
              currentFolderId === null ? 'text-white' : 'text-slate-400'
            )}
          >
            {tabTitle}
          </button>
          {currentFolder && (
            <>
              <span className="text-slate-500">/</span>
              <span className="font-semibold text-white truncate max-w-[200px]">{currentFolder.name}</span>
            </>
          )}
        </div>

        {/* Controls: Filter, View Toggle, Upload */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Category Filter */}
          <div className="flex items-center bg-white/[0.04] border border-white/10 p-1 rounded-xl text-xs font-medium text-slate-400">
            {['all', 'documents', 'images', 'archives'].map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  'px-2.5 py-1 rounded-lg capitalize transition-all',
                  categoryFilter === cat ? 'bg-white/15 text-white font-semibold shadow-xs' : 'hover:text-slate-200'
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center bg-white/[0.04] border border-white/10 p-1 rounded-xl">
            <button
              onClick={() => setViewMode('list')}
              aria-label="List View"
              className={cn(
                'p-1.5 rounded-lg text-slate-400 transition-all',
                viewMode === 'list' ? 'bg-white/15 text-white shadow-xs' : 'hover:text-slate-200'
              )}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              aria-label="Grid View"
              className={cn(
                'p-1.5 rounded-lg text-slate-400 transition-all',
                viewMode === 'grid' ? 'bg-white/15 text-white shadow-xs' : 'hover:text-slate-200'
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>

          {/* Actions */}
          <button
            onClick={() => setNoticeModal('Folder creation will be connected to the PostgreSQL virtual_folders table in Phase 3.')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/15 text-slate-200 border border-white/15 rounded-xl transition-all shadow-xs backdrop-blur-md"
          >
            <Plus className="h-3.5 w-3.5 text-purple-400" />
            <span>New Folder</span>
          </button>

          <button
            onClick={onOpenUpload}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white rounded-xl shadow-lg shadow-purple-500/25 border border-purple-400/30 transition-all"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Upload</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left 3 cols (or full if no selected file): File & Folder List */}
        <div className={cn(selectedFile ? 'lg:col-span-3' : 'lg:col-span-4', 'space-y-6')}>
          {/* Folders Section */}
          {filteredFolders.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Virtual Folders</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {filteredFolders.map((folder) => (
                  <div
                    key={folder.id}
                    onClick={() => setCurrentFolderId(currentFolderId === folder.id ? null : folder.id)}
                    className={cn(
                      'p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between backdrop-blur-md',
                      currentFolderId === folder.id
                        ? 'border-purple-500 bg-purple-500/15 shadow-md ring-1 ring-purple-500/50'
                        : 'border-white/10 bg-white/[0.04] hover:border-purple-400/40 hover:bg-white/[0.06]'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-300 shrink-0 border border-purple-500/30">
                        <Folder className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{folder.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {folder.itemCount} items • {folder.totalSizeBytes ? formatBytes(folder.totalSizeBytes) : '0 B'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Files Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Files ({filteredFiles.length})
              </h3>
              <span className="text-[11px] text-slate-400">
                Click any file to inspect virtual-to-physical mapping
              </span>
            </div>

            {filteredFiles.length === 0 ? (
              <div className="p-12 text-center rounded-3xl border border-dashed border-white/15 bg-white/[0.02]">
                <FileText className="h-8 w-8 text-slate-500 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-300">No files found</p>
                <p className="text-xs text-slate-500 mt-1">Try changing your search or filter criteria.</p>
              </div>
            ) : viewMode === 'list' ? (
              /* LIST VIEW */
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl overflow-hidden shadow-xl">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.02] text-slate-400 font-semibold">
                      <th className="py-3 pl-4">Name</th>
                      <th className="py-3">Physical Storage Host</th>
                      <th className="py-3">Size</th>
                      <th className="py-3">Last Modified</th>
                      <th className="py-3 pr-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredFiles.map((file) => {
                      const account = accounts.find((a) => a.id === file.storageAccountId);
                      const isSelected = selectedFile?.id === file.id;
                      return (
                        <tr
                          key={file.id}
                          onClick={() => setSelectedFile(isSelected ? null : file)}
                          className={cn(
                            'cursor-pointer transition-colors select-none',
                            isSelected ? 'bg-purple-500/20 text-white' : 'hover:bg-white/[0.04]'
                          )}
                        >
                          <td className="py-3 pl-4 flex items-center gap-3">
                            {getFileIcon(file.mimeType)}
                            <span className="font-semibold text-white truncate max-w-xs">{file.name}</span>
                          </td>
                          <td className="py-3">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 text-slate-300 text-[11px] font-medium border border-white/10">
                              <HardDrive className="h-3 w-3 text-purple-400" />
                              {account?.email || file.storageAccountId}
                            </span>
                          </td>
                          <td className="py-3 text-slate-300">{formatBytes(file.sizeBytes)}</td>
                          <td className="py-3 text-slate-400">{formatDate(file.modifiedAt)}</td>
                          <td className="py-3 pr-4 text-right">
                            <div className="inline-flex items-center gap-2">
                              {file.webUrl && (
                                <a
                                  href={file.webUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-slate-400 hover:text-purple-300 p-1 transition-colors"
                                  title="View on Google Drive"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setNoticeModal(`File operations (rename, move, trash) will be live in Phase 3.`);
                                }}
                                className="text-slate-400 hover:text-slate-200 p-1 transition-colors"
                              >
                                <MoreVertical className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* GRID VIEW */
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {filteredFiles.map((file) => {
                  const account = accounts.find((a) => a.id === file.storageAccountId);
                  const isSelected = selectedFile?.id === file.id;
                  return (
                    <div
                      key={file.id}
                      onClick={() => setSelectedFile(isSelected ? null : file)}
                      className={cn(
                        'p-4 rounded-2xl border bg-white/[0.04] backdrop-blur-md cursor-pointer transition-all space-y-3',
                        isSelected
                          ? 'border-purple-500 ring-2 ring-purple-500/30 bg-purple-500/15 shadow-md'
                          : 'border-white/10 hover:border-purple-400/40 hover:bg-white/[0.06]'
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">{getFileIcon(file.mimeType)}</div>
                        <span className="text-[11px] font-semibold text-slate-400">{formatBytes(file.sizeBytes)}</span>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white truncate">{file.name}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{formatDate(file.modifiedAt)}</p>
                      </div>
                      <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px]">
                        <span className="truncate max-w-[150px] text-slate-400 flex items-center gap-1">
                          <HardDrive className="h-3 w-3 text-purple-400 shrink-0" />
                          {account?.email.split('@')[0]}
                        </span>
                        {file.webUrl && (
                          <a
                            href={file.webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-purple-300 hover:text-purple-200 transition-colors"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right 1 col: File Inspection & Mapping Drawer */}
        {selectedFile && (
          <div className="rounded-3xl border border-white/10 bg-white/[0.05] backdrop-blur-2xl p-5 shadow-2xl space-y-5 h-fit lg:sticky lg:top-24 text-slate-200">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-purple-400" />
                <h4 className="text-sm font-bold text-white">Virtual Mapping Detail</h4>
              </div>
              <button
                onClick={() => setSelectedFile(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3.5 bg-white/[0.04] rounded-2xl border border-white/10 space-y-1">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Virtual File Name</p>
              <p className="text-xs font-bold text-white break-words">{selectedFile.name}</p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <p className="text-slate-400 font-medium">UniCloud Virtual ID</p>
                <code className="text-[11px] font-mono bg-white/10 text-purple-300 px-2 py-0.5 rounded border border-white/10">
                  {selectedFile.id}
                </code>
              </div>

              <div>
                <p className="text-slate-400 font-medium">Physical Google Drive Account</p>
                <div className="flex items-center gap-1.5 mt-0.5 font-medium text-white">
                  <HardDrive className="h-3.5 w-3.5 text-purple-400" />
                  <span>{accounts.find((a) => a.id === selectedFile.storageAccountId)?.email}</span>
                </div>
              </div>

              <div>
                <p className="text-slate-400 font-medium">Google Drive Provider File ID</p>
                <code className="text-[11px] font-mono bg-white/10 text-purple-300 px-2 py-0.5 rounded border border-white/10 break-all">
                  {selectedFile.providerFileId}
                </code>
              </div>

              <div>
                <p className="text-slate-400 font-medium">File Size</p>
                <p className="font-semibold text-white">{formatBytes(selectedFile.sizeBytes)}</p>
              </div>

              <div>
                <p className="text-slate-400 font-medium">MIME Type</p>
                <p className="font-mono text-[11px] text-slate-300">{selectedFile.mimeType}</p>
              </div>

              <div>
                <p className="text-slate-400 font-medium">Last Provider Sync</p>
                <p className="text-slate-300">{formatDate(selectedFile.syncedAt)}</p>
              </div>
            </div>

            {selectedFile.webUrl && (
              <a
                href={selectedFile.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-3 bg-gradient-to-r from-purple-500/20 to-blue-500/20 hover:from-purple-500/30 hover:to-blue-500/30 text-purple-300 hover:text-white border border-purple-500/30 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-xs"
              >
                <span>Open in Google Drive</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        )}
      </div>

      {/* Notice Dialog for Unimplemented Phase Operations */}
      {noticeModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#090910]/95 backdrop-blur-2xl rounded-3xl p-6 shadow-2xl border border-white/15 space-y-4 text-slate-100">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Phase 0 Architectural Boundary</h3>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">{noticeModal}</p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setNoticeModal(null)}
                className="px-4 py-2 bg-white/15 hover:bg-white/20 text-white rounded-xl text-xs font-semibold border border-white/20 transition-all"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
