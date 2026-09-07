/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Virtual File Browser
 * Displays the user's actual virtual files and folders mapped to physical Google Drive accounts.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Info,
  X,
  Loader2,
  AlertCircle,
  Trash2,
  RotateCcw,
  Edit2,
  ArrowLeft,
  ChevronRight,
  Check,
} from 'lucide-react';
import { VirtualFile, VirtualFolder, ViewMode } from '../types/filesystem';
import { StorageAccount } from '../types/account';
import { cn, formatBytes, formatDate } from '../lib/formatters';
import { authFetch } from '../lib/api';

export interface FilesViewProps {
  folders?: VirtualFolder[];
  files?: VirtualFile[];
  accounts: StorageAccount[];
  hasConnectedAccounts?: boolean;
  searchQuery?: string;
  onOpenUpload: () => void;
  onOpenAddAccount?: () => void;
  tabTitle?: string;
  activeView?: 'files' | 'recent' | 'starred' | 'trash';
  isDemoData?: boolean;
  onRefreshStoragePool?: () => void;
}

interface BreadcrumbNode {
  id: string | null;
  name: string;
}

export const FilesView: React.FC<FilesViewProps> = ({
  folders: propFolders,
  files: propFiles,
  accounts,
  hasConnectedAccounts = accounts.length > 0,
  searchQuery = '',
  onOpenUpload,
  onOpenAddAccount,
  tabTitle = 'My Files',
  activeView = 'files',
  onRefreshStoragePool,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbNode[]>([
    { id: null, name: tabTitle },
  ]);
  const [selectedFile, setSelectedFile] = useState<VirtualFile | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Live filesystem state
  const [realFiles, setRealFiles] = useState<VirtualFile[]>([]);
  const [realFolders, setRealFolders] = useState<VirtualFolder[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(!propFiles);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Folder creation dialog state
  const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [isCreatingFolderSubmitting, setIsCreatingFolderSubmitting] = useState<boolean>(false);

  // Rename item dialog state
  const [renamingItem, setRenamingItem] = useState<{ id: string; name: string; isFolder: boolean } | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  const [isRenamingSubmitting, setIsRenamingSubmitting] = useState<boolean>(false);

  // File action menu popover state
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // Reset folder navigation when active tab changes
  useEffect(() => {
    setCurrentFolderId(null);
    setBreadcrumbs([{ id: null, name: tabTitle }]);
    setSelectedFile(null);
    setActionMenuId(null);
  }, [activeView, tabTitle]);

  // Load real files and folders from the authenticated /api/files endpoint
  const fetchFilesystemData = useCallback(async (folderId: string | null) => {
    // If props are explicitly supplied (e.g. testing), bypass fetching
    if (propFiles !== undefined && propFolders !== undefined) {
      setRealFiles(propFiles);
      setRealFolders(propFolders);
      setIsLoading(false);
      return;
    }

    if (!hasConnectedAccounts) {
      setRealFiles([]);
      setRealFolders([]);
      setIsLoading(false);
      setErrorMessage(null);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      let url = '/api/files';
      const params = new URLSearchParams();

      if (activeView === 'starred') {
        params.set('starredOnly', 'true');
        if (folderId) {
          params.set('folderId', folderId);
        }
      } else if (activeView === 'trash') {
        params.set('trashedOnly', 'true');
        if (folderId) {
          params.set('folderId', folderId);
        }
      } else if (activeView === 'recent') {
        params.set('folderId', 'all');
      } else {
        // 'files' (My Files)
        if (folderId) {
          params.set('folderId', folderId);
        }
      }

      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }

      const res = await authFetch(url);
      if (!res.ok) {
        if (res.status === 401) {
          setErrorMessage('Please sign in to access your files.');
          return;
        }
        throw new Error(`Failed to load filesystem (status: ${res.status})`);
      }

      const json = await res.json();
      if (json.success && json.data) {
        let loadedFiles: VirtualFile[] = json.data.files || [];
        let loadedFolders: VirtualFolder[] = json.data.folders || [];

        if (activeView === 'recent') {
          loadedFiles = [...loadedFiles].sort(
            (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
          );
        }

        setRealFiles(loadedFiles);
        setRealFolders(loadedFolders);
      } else {
        throw new Error(json.error?.message || 'Invalid server response');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while loading files.');
    } finally {
      setIsLoading(false);
    }
  }, [propFiles, propFolders, hasConnectedAccounts, activeView]);

  // Trigger fetch when dependencies change
  useEffect(() => {
    fetchFilesystemData(currentFolderId);
  }, [fetchFilesystemData, currentFolderId]);

  // Use props if explicitly passed, otherwise use loaded state
  const rawFiles = propFiles !== undefined ? propFiles : realFiles;
  const rawFolders = propFolders !== undefined ? propFolders : realFolders;

  // Filter files based on search, current folder, and category
  const filteredFiles = useMemo(() => {
    return rawFiles.filter((f) => {
      // Search query
      if (searchQuery.trim() && !f.name.toLowerCase().includes(searchQuery.trim().toLowerCase())) {
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
        if (!f.mimeType.includes('zip') && !f.mimeType.includes('gzip') && !f.mimeType.includes('tar')) {
          return false;
        }
      }
      // If props were passed directly without server filtering, filter by parentId
      if (propFiles !== undefined && currentFolderId !== null && f.parentId !== currentFolderId) {
        return false;
      }
      return true;
    });
  }, [rawFiles, searchQuery, categoryFilter, propFiles, currentFolderId]);

  // Filter folders
  const filteredFolders = useMemo(() => {
    // Recent view does not show folders
    if (activeView === 'recent') {
      return [];
    }
    return rawFolders.filter((f) => {
      if (searchQuery.trim() && !f.name.toLowerCase().includes(searchQuery.trim().toLowerCase())) {
        return false;
      }
      // If props were passed directly, filter by parentId
      if (propFolders !== undefined && currentFolderId !== null && f.parentId !== currentFolderId) {
        return false;
      }
      return true;
    });
  }, [rawFolders, searchQuery, activeView, propFolders, currentFolderId]);

  // Navigate down into a folder
  const handleNavigateFolder = (folder: VirtualFolder) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setSelectedFile(null);
    setActionMenuId(null);
  };

  // Navigate to a specific level in breadcrumbs
  const handleNavigateBreadcrumb = (index: number) => {
    const target = breadcrumbs[index];
    setCurrentFolderId(target.id);
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
    setSelectedFile(null);
    setActionMenuId(null);
  };

  // Navigate back to parent folder
  const handleNavigateParent = () => {
    if (breadcrumbs.length <= 1) return;
    const nextBreadcrumbs = breadcrumbs.slice(0, -1);
    const parentNode = nextBreadcrumbs[nextBreadcrumbs.length - 1];
    setCurrentFolderId(parentNode.id);
    setBreadcrumbs(nextBreadcrumbs);
    setSelectedFile(null);
    setActionMenuId(null);
  };

  // Action: Toggle starred status on virtual file
  const handleToggleStar = async (file: VirtualFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await authFetch(`/api/files/${file.id}/star`, { method: 'PATCH' });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          const updatedStarred = json.data.isStarred;
          setRealFiles((prev) =>
            prev.map((f) => (f.id === file.id ? { ...f, isStarred: updatedStarred } : f))
          );
          if (selectedFile?.id === file.id) {
            setSelectedFile((prev) => (prev ? { ...prev, isStarred: updatedStarred } : null));
          }
          if (activeView === 'starred' && !updatedStarred) {
            setRealFiles((prev) => prev.filter((f) => f.id !== file.id));
          }
        }
      }
    } catch (err) {
      console.error('Failed to toggle star', err);
    }
  };

  // Action: Move file to virtual trash
  const handleMoveFileToTrash = async (file: VirtualFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActionMenuId(null);
    try {
      const res = await authFetch(`/api/files/${file.id}`, { method: 'DELETE' });
      if (res.ok) {
        setRealFiles((prev) => prev.filter((f) => f.id !== file.id));
        if (selectedFile?.id === file.id) setSelectedFile(null);
        onRefreshStoragePool?.();
      }
    } catch (err) {
      console.error('Failed to move file to trash', err);
    }
  };

  // Action: Restore file from trash
  const handleRestoreFile = async (file: VirtualFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActionMenuId(null);
    try {
      const res = await authFetch(`/api/files/${file.id}/restore`, { method: 'POST' });
      if (res.ok) {
        setRealFiles((prev) => prev.filter((f) => f.id !== file.id));
        if (selectedFile?.id === file.id) setSelectedFile(null);
        onRefreshStoragePool?.();
      }
    } catch (err) {
      console.error('Failed to restore file', err);
    }
  };

  // Action: Permanently delete file
  const handlePermanentDeleteFile = async (file: VirtualFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActionMenuId(null);
    try {
      const res = await authFetch(`/api/files/${file.id}?permanent=true`, { method: 'DELETE' });
      if (res.ok) {
        setRealFiles((prev) => prev.filter((f) => f.id !== file.id));
        if (selectedFile?.id === file.id) setSelectedFile(null);
        onRefreshStoragePool?.();
      }
    } catch (err) {
      console.error('Failed to permanently delete file', err);
    }
  };

  // Action: Submit rename
  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingItem || !renameValue.trim() || renameValue.trim() === renamingItem.name) {
      setRenamingItem(null);
      return;
    }

    setIsRenamingSubmitting(true);
    try {
      const endpoint = renamingItem.isFolder
        ? `/api/folders/${renamingItem.id}/rename`
        : `/api/files/${renamingItem.id}/rename`;

      const res = await authFetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue.trim() }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          if (renamingItem.isFolder) {
            setRealFolders((prev) =>
              prev.map((f) => (f.id === renamingItem.id ? json.data : f))
            );
          } else {
            setRealFiles((prev) =>
              prev.map((f) => (f.id === renamingItem.id ? json.data : f))
            );
            if (selectedFile?.id === renamingItem.id) {
              setSelectedFile(json.data);
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to rename item', err);
    } finally {
      setIsRenamingSubmitting(false);
      setRenamingItem(null);
    }
  };

  // Action: Create virtual folder
  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    setIsCreatingFolderSubmitting(true);
    try {
      const targetAccountId = accounts[0]?.id;
      const res = await authFetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFolderName.trim(),
          parentId: currentFolderId,
          storageAccountId: targetAccountId,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setRealFolders((prev) => [...prev, json.data]);
          setNewFolderName('');
          setIsCreatingFolder(false);
        }
      }
    } catch (err) {
      console.error('Failed to create folder', err);
    } finally {
      setIsCreatingFolderSubmitting(false);
    }
  };

  // Resolve file icon by MIME type
  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      return <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />;
    }
    if (mimeType.startsWith('image/')) {
      return <FileImage className="h-4 w-4 text-indigo-600 shrink-0" />;
    }
    if (mimeType.includes('zip') || mimeType.includes('gzip') || mimeType.includes('tar')) {
      return <FileArchive className="h-4 w-4 text-amber-600 shrink-0" />;
    }
    if (mimeType.includes('code') || mimeType.includes('javascript') || mimeType.includes('json')) {
      return <FileCode className="h-4 w-4 text-purple-600 shrink-0" />;
    }
    return <FileText className="h-4 w-4 text-blue-600 shrink-0" />;
  };

  // Clean empty state when NO Google Drive accounts are connected
  if (!hasConnectedAccounts) {
    return (
      <div id="files-view-empty-accounts" className="space-y-6 max-w-7xl mx-auto pb-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center max-w-md mx-auto space-y-4 my-12 shadow-xs">
          <div className="h-12 w-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto text-blue-600">
            <HardDrive className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-900">No Google Drive Accounts Connected</h3>
            <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
              Connect a Google Drive account to view and manage your files across your unified storage pool.
            </p>
          </div>
          {onOpenAddAccount && (
            <div className="pt-2">
              <button
                onClick={onOpenAddAccount}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Connect Google Drive</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div id="files-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-sm text-slate-700 overflow-x-auto min-w-0">
          {breadcrumbs.length > 1 && (
            <button
              onClick={handleNavigateParent}
              title="Navigate to parent folder"
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors shrink-0 cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}

          <div className="flex items-center gap-1.5 min-w-0">
            {breadcrumbs.map((node, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <React.Fragment key={node.id ?? 'root'}>
                  {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                  <button
                    onClick={() => handleNavigateBreadcrumb(index)}
                    className={cn(
                      'transition-colors truncate max-w-[180px] cursor-pointer',
                      isLast ? 'text-slate-900 font-semibold text-base' : 'text-slate-500 hover:text-slate-800 text-sm font-medium'
                    )}
                  >
                    {node.name}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Controls: Filter, View Toggle, New Folder, Upload */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Category Filter */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-medium text-slate-600">
            {['all', 'documents', 'images', 'archives'].map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  'px-2.5 py-1 rounded-md capitalize transition-colors cursor-pointer',
                  categoryFilter === cat
                    ? 'bg-white text-slate-900 font-medium shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg">
            <button
              onClick={() => setViewMode('list')}
              aria-label="List View"
              className={cn(
                'p-1.5 rounded-md transition-colors cursor-pointer',
                viewMode === 'list' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-400 hover:text-slate-700'
              )}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              aria-label="Grid View"
              className={cn(
                'p-1.5 rounded-md transition-colors cursor-pointer',
                viewMode === 'grid' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-400 hover:text-slate-700'
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>

          {/* Actions: New Folder (Only in files view) */}
          {activeView === 'files' && (
            <button
              onClick={() => {
                setIsCreatingFolder(true);
                setNewFolderName('');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg transition-colors shadow-2xs cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-slate-500" />
              <span>New Folder</span>
            </button>
          )}

          {/* Upload Button */}
          <button
            onClick={onOpenUpload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-2xs cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Upload</span>
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="p-16 text-center rounded-2xl border border-slate-200 bg-white shadow-xs">
          <Loader2 className="h-6 w-6 text-blue-600 animate-spin mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-700">Loading files...</p>
        </div>
      )}

      {/* Error State */}
      {!isLoading && errorMessage && (
        <div className="p-10 text-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 shadow-xs space-y-3">
          <AlertCircle className="h-6 w-6 text-rose-600 mx-auto" />
          <p className="text-sm font-medium">{errorMessage}</p>
          <button
            onClick={() => fetchFilesystemData(currentFolderId)}
            className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium transition-colors shadow-2xs cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {!isLoading && !errorMessage && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Columns (or full width if no drawer): File & Folder List */}
          <div className={cn(selectedFile ? 'lg:col-span-3' : 'lg:col-span-4', 'space-y-6')}>
            {/* Folders Section */}
            {filteredFolders.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Folders ({filteredFolders.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {filteredFolders.map((folder) => {
                    const isSelected = currentFolderId === folder.id;
                    const folderAccount = accounts.find((a) => a.id === folder.storageAccountId);
                    return (
                      <div
                        key={folder.id}
                        onClick={() => handleNavigateFolder(folder)}
                        className={cn(
                          'p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between group',
                          isSelected
                            ? 'border-blue-600 bg-blue-50/50 shadow-xs ring-1 ring-blue-600'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="p-2 rounded-lg bg-blue-50 text-blue-600 shrink-0 border border-blue-100/70">
                            <Folder className="h-4 w-4 fill-blue-600/20" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-900 truncate">{folder.name}</p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {folder.itemCount !== undefined ? `${folder.itemCount} items` : 'Folder'}
                              {folderAccount ? ` • ${folderAccount.email.split('@')[0]}` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingItem({ id: folder.id, name: folder.name, isFolder: true });
                              setRenameValue(folder.name);
                            }}
                            title="Rename folder"
                            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Files Section */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Files ({filteredFiles.length})
                </h3>
                <span className="text-[11px] text-slate-400">
                  Select a file to view storage details
                </span>
              </div>

              {filteredFiles.length === 0 && filteredFolders.length === 0 ? (
                <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white shadow-2xs">
                  <FileText className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-slate-800">
                    {activeView === 'starred'
                      ? 'No starred items'
                      : activeView === 'trash'
                      ? 'Trash is empty'
                      : activeView === 'recent'
                      ? 'No recent files'
                      : 'This folder is empty'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    {activeView === 'starred'
                      ? 'Star files to quickly find them later.'
                      : activeView === 'trash'
                      ? 'Files deleted from your storage will appear here.'
                      : activeView === 'recent'
                      ? 'Files modified or synchronized across your storage will appear here.'
                      : 'Upload files to start adding to your storage pool.'}
                  </p>
                  {activeView === 'files' && (
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <button
                        onClick={onOpenUpload}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-2xs cursor-pointer"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        <span>Upload to this folder</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : viewMode === 'list' ? (
                /* LIST VIEW */
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-500 font-medium">
                        <th className="py-2.5 pl-4 font-medium">Name</th>
                        <th className="py-2.5 font-medium">Storage Location</th>
                        <th className="py-2.5 font-medium">Size</th>
                        <th className="py-2.5 font-medium">Modified</th>
                        <th className="py-2.5 pr-4 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredFiles.map((file) => {
                        const account = accounts.find((a) => a.id === file.storageAccountId);
                        const isSelected = selectedFile?.id === file.id;
                        return (
                          <tr
                            key={file.id}
                            onClick={() => setSelectedFile(isSelected ? null : file)}
                            className={cn(
                              'cursor-pointer transition-colors select-none group',
                              isSelected ? 'bg-blue-50/70 text-slate-900' : 'hover:bg-slate-50/75'
                            )}
                          >
                            <td className="py-2.5 pl-4 flex items-center gap-2.5">
                              <button
                                onClick={(e) => handleToggleStar(file, e)}
                                title={file.isStarred ? 'Unstar' : 'Star'}
                                className="p-0.5 text-slate-300 hover:text-amber-500 transition-colors shrink-0 cursor-pointer"
                              >
                                <Star
                                  className={cn(
                                    'h-4 w-4',
                                    file.isStarred ? 'text-amber-400 fill-amber-400' : 'text-slate-300'
                                  )}
                                />
                              </button>
                              {getFileIcon(file.mimeType)}
                              <span className="font-medium text-slate-900 truncate max-w-xs">{file.name}</span>
                            </td>
                            <td className="py-2.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium border border-slate-200/60">
                                <HardDrive className="h-3 w-3 text-slate-400" />
                                {account?.email || file.storageAccountId}
                              </span>
                            </td>
                            <td className="py-2.5 text-slate-600">{formatBytes(file.sizeBytes)}</td>
                            <td className="py-2.5 text-slate-500">{formatDate(file.modifiedAt)}</td>
                            <td className="py-2.5 pr-4 text-right">
                              <div className="inline-flex items-center gap-1">
                                {file.webUrl && (
                                  <a
                                    href={file.webUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-slate-400 hover:text-blue-600 p-1 transition-colors"
                                    title="Open in Google Drive"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                )}

                                {activeView === 'trash' ? (
                                  <>
                                    <button
                                      onClick={(e) => handleRestoreFile(file, e)}
                                      title="Restore file"
                                      className="p-1 text-slate-400 hover:text-emerald-600 transition-colors cursor-pointer"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={(e) => handlePermanentDeleteFile(file, e)}
                                      title="Permanently delete"
                                      className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setRenamingItem({ id: file.id, name: file.name, isFolder: false });
                                        setRenameValue(file.name);
                                      }}
                                      title="Rename file"
                                      className="p-1 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                                    >
                                      <Edit2 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={(e) => handleMoveFileToTrash(file, e)}
                                      title="Move to trash"
                                      className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </>
                                )}
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
                          'p-4 rounded-xl border bg-white cursor-pointer transition-all space-y-3 relative group',
                          isSelected
                            ? 'border-blue-600 ring-1 ring-blue-600 bg-blue-50/40 shadow-xs'
                            : 'border-slate-200 hover:border-slate-300 hover:shadow-xs'
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                            {getFileIcon(file.mimeType)}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => handleToggleStar(file, e)}
                              title={file.isStarred ? 'Unstar' : 'Star'}
                              className="p-1 text-slate-300 hover:text-amber-500 transition-colors cursor-pointer"
                            >
                              <Star
                                className={cn(
                                    'h-4 w-4',
                                    file.isStarred ? 'text-amber-400 fill-amber-400' : 'text-slate-300'
                                )}
                              />
                            </button>
                            <span className="text-[11px] font-medium text-slate-500">
                              {formatBytes(file.sizeBytes)}
                            </span>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-medium text-slate-900 truncate">{file.name}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">{formatDate(file.modifiedAt)}</p>
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                          <span className="truncate max-w-[140px] text-slate-500 flex items-center gap-1">
                            <HardDrive className="h-3 w-3 text-slate-400 shrink-0" />
                            {account ? account.email.split('@')[0] : file.storageAccountId}
                          </span>

                          <div className="flex items-center gap-1">
                            {file.webUrl && (
                              <a
                                href={file.webUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-slate-400 hover:text-blue-600 p-0.5 transition-colors"
                                title="Open in Google Drive"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                            {activeView === 'trash' ? (
                              <button
                                onClick={(e) => handleRestoreFile(file, e)}
                                title="Restore"
                                className="text-slate-400 hover:text-emerald-600 p-0.5 transition-colors cursor-pointer"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button
                                onClick={(e) => handleMoveFileToTrash(file, e)}
                                title="Trash"
                                className="text-slate-400 hover:text-rose-600 p-0.5 transition-colors cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: File Details Panel */}
          {selectedFile && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4 h-fit lg:sticky lg:top-24 text-slate-700">
              <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-blue-600" />
                  <h4 className="text-sm font-semibold text-slate-900">File Details</h4>
                </div>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/70 space-y-0.5">
                <p className="text-[11px] font-medium text-slate-500">File Name</p>
                <p className="text-xs font-semibold text-slate-900 break-words">{selectedFile.name}</p>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <p className="text-slate-500 font-medium">Storage Location</p>
                  <div className="flex items-center gap-1.5 mt-1 font-medium text-slate-800">
                    <HardDrive className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                    <span className="break-all">{accounts.find((a) => a.id === selectedFile.storageAccountId)?.email || selectedFile.storageAccountId}</span>
                  </div>
                </div>

                <div>
                  <p className="text-slate-500 font-medium">File Size</p>
                  <p className="font-medium text-slate-800 mt-0.5">{formatBytes(selectedFile.sizeBytes)}</p>
                </div>

                <div>
                  <p className="text-slate-500 font-medium">Type</p>
                  <p className="text-slate-700 mt-0.5">{selectedFile.mimeType}</p>
                </div>

                <div>
                  <p className="text-slate-500 font-medium">Last Modified</p>
                  <p className="text-slate-700 mt-0.5">{formatDate(selectedFile.modifiedAt)}</p>
                </div>
              </div>

              {/* Drawer Actions */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                {selectedFile.webUrl && (
                  <a
                    href={selectedFile.webUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                  >
                    <span>Open in Google Drive</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleStar(selectedFile)}
                    className="flex-1 py-1.5 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  >
                    <Star
                      className={cn(
                        'h-3.5 w-3.5',
                        selectedFile.isStarred ? 'text-amber-400 fill-amber-400' : 'text-slate-400'
                      )}
                    />
                    <span>{selectedFile.isStarred ? 'Starred' : 'Star'}</span>
                  </button>

                  <button
                    onClick={() => {
                      setRenamingItem({ id: selectedFile.id, name: selectedFile.name, isFolder: false });
                      setRenameValue(selectedFile.name);
                    }}
                    className="flex-1 py-1.5 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  >
                    <Edit2 className="h-3.5 w-3.5 text-slate-400" />
                    <span>Rename</span>
                  </button>
                </div>

                {activeView === 'trash' ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRestoreFile(selectedFile)}
                      className="flex-1 py-1.5 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Restore</span>
                    </button>
                    <button
                      onClick={() => handlePermanentDeleteFile(selectedFile)}
                      className="flex-1 py-1.5 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Delete Forever</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleMoveFileToTrash(selectedFile)}
                    className="w-full py-1.5 px-3 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Move to Trash</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* New Folder Modal */}
      {isCreatingFolder && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl border border-slate-200 space-y-4 text-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Create Folder</h3>
              <button
                onClick={() => setIsCreatingFolder(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateFolderSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Folder Name</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="e.g. Documents"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsCreatingFolder(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingFolderSubmitting || !newFolderName.trim()}
                  className="px-4 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
                >
                  {isCreatingFolderSubmitting ? 'Creating...' : 'Create Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Item Modal */}
      {renamingItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl border border-slate-200 space-y-4 text-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Rename {renamingItem.isFolder ? 'Folder' : 'File'}
              </h3>
              <button
                onClick={() => setRenamingItem(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRenameSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">New Name</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRenamingItem(null)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRenamingSubmitting || !renameValue.trim()}
                  className="px-4 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
                >
                  {isRenamingSubmitting ? 'Renaming...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
