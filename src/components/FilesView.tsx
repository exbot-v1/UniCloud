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
  AlertTriangle,
  Trash2,
  RotateCcw,
  Edit2,
  ArrowLeft,
  ChevronRight,
  Check,
  Eye,
  Download,
  FolderInput,
  Copy,
} from 'lucide-react';
import { VirtualFile, VirtualFolder, ViewMode } from '../types/filesystem';
import { StorageAccount } from '../types/account';
import { cn, formatBytes, formatDate } from '../lib/formatters';
import { authFetch } from '../lib/api';
import { useToast } from './Toast';
import { FilePreviewModal } from './FilePreviewModal';
import { MoveCopyModal } from './MoveCopyModal';
import { ContextMenu } from './ContextMenu';

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
  targetFolderToOpen?: { id: string; name: string } | null;
  onClearTargetFolder?: () => void;
  onPreviewFile?: (file: VirtualFile) => void;
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
  targetFolderToOpen,
  onClearTargetFolder,
  onPreviewFile,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbNode[]>([
    { id: null, name: tabTitle },
  ]);
  const [selectedFile, setSelectedFile] = useState<VirtualFile | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<VirtualFolder | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Preview & Context & Move/Copy states
  const [previewFile, setPreviewFile] = useState<VirtualFile | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    target: VirtualFile | VirtualFolder | null;
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    target: null,
  });
  const [moveCopyModal, setMoveCopyModal] = useState<{
    isOpen: boolean;
    file: VirtualFile | null;
    mode: 'move' | 'copy';
  }>({
    isOpen: false,
    file: null,
    mode: 'move',
  });

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

  // Global toast notifications
  const { success, error, info } = useToast();

  // Permanent delete confirmation dialog state
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    item: VirtualFile | VirtualFolder;
    isFolder: boolean;
  } | null>(null);
  const [isDeletingPermanent, setIsDeletingPermanent] = useState<boolean>(false);

  // Reset folder navigation when active tab changes
  useEffect(() => {
    setCurrentFolderId(null);
    setBreadcrumbs([{ id: null, name: tabTitle }]);
    setSelectedFile(null);
    setSelectedFolder(null);
    setActionMenuId(null);
  }, [activeView, tabTitle]);

  // Navigate to target folder when requested by external search
  useEffect(() => {
    if (targetFolderToOpen) {
      setCurrentFolderId(targetFolderToOpen.id);
      setBreadcrumbs([
        { id: null, name: tabTitle },
        { id: targetFolderToOpen.id, name: targetFolderToOpen.name },
      ]);
      setSelectedFile(null);
      setSelectedFolder(null);
      onClearTargetFolder?.();
    }
  }, [targetFolderToOpen, tabTitle, onClearTargetFolder]);

  // Keyboard navigation & shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input/textarea
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (previewFile || renamingItem || isCreatingFolder || moveCopyModal.isOpen) return;

      if (e.key === 'Escape') {
        setSelectedFile(null);
        setSelectedFolder(null);
        setContextMenu((prev) => ({ ...prev, isOpen: false }));
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (selectedFile) {
          e.preventDefault();
          if (onPreviewFile) onPreviewFile(selectedFile);
          else setPreviewFile(selectedFile);
        } else if (selectedFolder) {
          e.preventDefault();
          handleNavigateFolder(selectedFolder);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedFile && activeView !== 'trash') {
          e.preventDefault();
          handleMoveFileToTrash(selectedFile);
        }
      } else if (e.key === 'F2') {
        if (selectedFile) {
          e.preventDefault();
          setRenamingItem({ id: selectedFile.id, name: selectedFile.name, isFolder: false });
          setRenameValue(selectedFile.name);
        } else if (selectedFolder) {
          e.preventDefault();
          setRenamingItem({ id: selectedFolder.id, name: selectedFolder.name, isFolder: true });
          setRenameValue(selectedFolder.name);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFile, selectedFolder, previewFile, renamingItem, isCreatingFolder, moveCopyModal.isOpen, activeView, onPreviewFile]);

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
          success(updatedStarred ? `Added "${file.name}" to starred.` : `Removed "${file.name}" from starred.`);
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
        success(`Moved "${file.name}" to trash.`);
      }
    } catch (err) {
      console.error('Failed to move file to trash', err);
      error(`Failed to move "${file.name}" to trash.`);
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
        success(`Restored "${file.name}" from trash.`);
      }
    } catch (err) {
      console.error('Failed to restore file', err);
      error(`Failed to restore "${file.name}".`);
    }
  };

  // Action: Request permanent delete file (opens confirmation)
  const handlePermanentDeleteFile = (file: VirtualFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActionMenuId(null);
    setDeleteConfirmTarget({ item: file, isFolder: false });
  };

  // Action: Direct binary download
  const handleDownloadFile = (file: VirtualFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const downloadUrl = `/api/files/${file.id}/download`;
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  // Action: Trigger preview modal
  const handlePreviewFile = (file: VirtualFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (onPreviewFile) {
      onPreviewFile(file);
    } else {
      setPreviewFile(file);
    }
  };

  // Action: Trash virtual folder
  const handleTrashFolder = async (folder: VirtualFolder, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await authFetch(`/api/folders/${folder.id}`, { method: 'DELETE' });
      if (res.ok) {
        setRealFolders((prev) => prev.filter((f) => f.id !== folder.id));
        if (selectedFolder?.id === folder.id) setSelectedFolder(null);
        onRefreshStoragePool?.();
        success(`Moved folder "${folder.name}" to trash.`);
      }
    } catch (err) {
      console.error('Failed to trash folder', err);
      error(`Failed to move folder "${folder.name}" to trash.`);
    }
  };

  // Action: Restore virtual folder
  const handleRestoreFolder = async (folder: VirtualFolder, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await authFetch(`/api/folders/${folder.id}/restore`, { method: 'POST' });
      if (res.ok) {
        setRealFolders((prev) => prev.filter((f) => f.id !== folder.id));
        if (selectedFolder?.id === folder.id) setSelectedFolder(null);
        onRefreshStoragePool?.();
        success(`Restored folder "${folder.name}" from trash.`);
      }
    } catch (err) {
      console.error('Failed to restore folder', err);
      error(`Failed to restore folder "${folder.name}".`);
    }
  };

  // Action: Request permanent delete virtual folder (opens confirmation)
  const handlePermanentDeleteFolder = (folder: VirtualFolder, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActionMenuId(null);
    setDeleteConfirmTarget({ item: folder, isFolder: true });
  };

  // Execute permanent delete after user confirmation
  const handleConfirmPermanentDelete = async () => {
    if (!deleteConfirmTarget || isDeletingPermanent) return;
    setIsDeletingPermanent(true);

    try {
      const { item, isFolder } = deleteConfirmTarget;
      const endpoint = isFolder
        ? `/api/folders/${item.id}?permanent=true`
        : `/api/files/${item.id}?permanent=true`;

      const res = await authFetch(endpoint, { method: 'DELETE' });
      if (res.ok) {
        if (isFolder) {
          setRealFolders((prev) => prev.filter((f) => f.id !== item.id));
          if (selectedFolder?.id === item.id) setSelectedFolder(null);
        } else {
          setRealFiles((prev) => prev.filter((f) => f.id !== item.id));
          if (selectedFile?.id === item.id) setSelectedFile(null);
        }
        onRefreshStoragePool?.();
        success(`Permanently deleted "${item.name}".`);
        setDeleteConfirmTarget(null);
      } else {
        const json = await res.json().catch(() => ({}));
        error(json.error?.message || `Failed to delete "${item.name}".`);
      }
    } catch (err: any) {
      error(err.message || 'Error executing permanent deletion.');
    } finally {
      setIsDeletingPermanent(false);
    }
  };

  // Open right-click context menu
  const handleContextMenu = (e: React.MouseEvent, target: VirtualFile | VirtualFolder) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      target,
    });
    if ('isFolder' in target && target.isFolder) {
      setSelectedFolder(target as VirtualFolder);
      setSelectedFile(null);
    } else {
      setSelectedFile(target as VirtualFile);
      setSelectedFolder(null);
    }
  };

  // Open context menu from three-dots action button
  const handleOpenActionMenu = (e: React.MouseEvent, target: VirtualFile | VirtualFolder) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({
      isOpen: true,
      position: { x: rect.left, y: rect.bottom + 4 },
      target,
    });
    if ('isFolder' in target && target.isFolder) {
      setSelectedFolder(target as VirtualFolder);
      setSelectedFile(null);
    } else {
      setSelectedFile(target as VirtualFile);
      setSelectedFolder(null);
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
          success(`Renamed to "${renameValue.trim()}".`);
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
          success(`Created folder "${newFolderName.trim()}".`);
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
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center max-w-md mx-auto space-y-4 my-12 shadow-xs">
          <div className="h-12 w-12 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900 flex items-center justify-center mx-auto text-blue-600 dark:text-blue-400">
            <HardDrive className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">No Google Drive Accounts Connected</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
              Connect a Google Drive account to view and manage your files across your unified storage pool.
            </p>
          </div>
          {onOpenAddAccount && (
            <div className="pt-2">
              <button
                onClick={onOpenAddAccount}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 overflow-x-auto min-w-0">
          {breadcrumbs.length > 1 && (
            <button
              onClick={handleNavigateParent}
              title="Navigate to parent folder"
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors shrink-0 cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}

          <div className="flex items-center gap-1.5 min-w-0">
            {breadcrumbs.map((node, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <React.Fragment key={node.id ?? 'root'}>
                  {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-600 shrink-0" />}
                  <button
                    onClick={() => handleNavigateBreadcrumb(index)}
                    className={cn(
                      'transition-colors truncate max-w-[180px] cursor-pointer',
                      isLast ? 'text-slate-900 dark:text-slate-100 font-semibold text-base' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-sm font-medium'
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
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400">
            {['all', 'documents', 'images', 'archives'].map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  'px-2.5 py-1 rounded-md capitalize transition-colors cursor-pointer',
                  categoryFilter === cat
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-medium shadow-2xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg">
            <button
              onClick={() => setViewMode('list')}
              aria-label="List View"
              className={cn(
                'p-1.5 rounded-md transition-colors cursor-pointer',
                viewMode === 'list' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs' : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              )}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              aria-label="Grid View"
              className={cn(
                'p-1.5 rounded-md transition-colors cursor-pointer',
                viewMode === 'grid' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs' : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-200 dark:border-slate-700 rounded-lg transition-colors shadow-2xs cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              <span>New Folder</span>
            </button>
          )}

          {/* Upload Button */}
          <button
            onClick={onOpenUpload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-2xs cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Upload</span>
          </button>
        </div>
      </div>

      {/* Loading Skeleton State */}
      {isLoading && (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-16 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex items-center gap-3"
              >
                <div className="h-9 w-9 bg-slate-200 dark:bg-slate-800 rounded-lg shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-3.5 bg-slate-200 dark:bg-slate-800 rounded-sm w-3/4" />
                  <div className="h-2.5 bg-slate-100 dark:bg-slate-850 rounded-sm w-1/2" />
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-slate-50 dark:bg-slate-850/60 rounded-lg flex items-center px-3 gap-4">
                <div className="h-4 w-4 bg-slate-200 dark:bg-slate-700 rounded-sm shrink-0" />
                <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-sm flex-1 max-w-xs" />
                <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-sm w-20 hidden sm:block" />
                <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-sm w-28 hidden sm:block" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error State */}
      {!isLoading && errorMessage && (
        <div className="p-10 text-center rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 shadow-xs space-y-3">
          <AlertCircle className="h-6 w-6 text-rose-600 dark:text-rose-400 mx-auto" />
          <p className="text-sm font-medium">{errorMessage}</p>
          <button
            onClick={() => fetchFilesystemData(currentFolderId)}
            className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium transition-colors shadow-2xs cursor-pointer"
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
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Folders ({filteredFolders.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {filteredFolders.map((folder) => {
                    const isSelected = selectedFolder?.id === folder.id;
                    const folderAccount = accounts.find((a) => a.id === folder.storageAccountId);
                    return (
                      <div
                        key={folder.id}
                        onClick={() => {
                          setSelectedFolder(isSelected ? null : folder);
                          setSelectedFile(null);
                        }}
                        onDoubleClick={() => handleNavigateFolder(folder)}
                        onContextMenu={(e) => handleContextMenu(e, folder)}
                        className={cn(
                          'p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between group select-none',
                          isSelected
                            ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 shadow-xs ring-1 ring-blue-600'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-xs'
                        )}
                      >
                        <div
                          className="flex items-center gap-3 min-w-0 flex-1"
                          onClick={(e) => {
                            // Single click on text or icon directly navigates if clicked directly
                            e.stopPropagation();
                            handleNavigateFolder(folder);
                          }}
                        >
                          <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 shrink-0 border border-blue-100/70 dark:border-blue-900/70">
                            <Folder className="h-4 w-4 fill-blue-600/20 dark:fill-blue-400/20" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{folder.name}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {folder.itemCount !== undefined ? `${folder.itemCount} items` : 'Folder'}
                              {folderAccount ? ` • ${folderAccount.email.split('@')[0]}` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => handleOpenActionMenu(e, folder)}
                            title="Folder options"
                            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
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
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Files ({filteredFiles.length})
                </h3>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  Select a file to view storage details
                </span>
              </div>

              {filteredFiles.length === 0 && filteredFolders.length === 0 ? (
                <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
                  <FileText className="h-8 w-8 text-slate-400 dark:text-slate-500 mx-auto mb-2" />
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {activeView === 'starred'
                      ? 'No starred items'
                      : activeView === 'trash'
                      ? 'Trash is empty'
                      : activeView === 'recent'
                      ? 'No recent files'
                      : 'This folder is empty'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
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
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-2xs cursor-pointer"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        <span>Upload to this folder</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : viewMode === 'list' ? (
                /* LIST VIEW */
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-medium">
                        <th className="py-2.5 pl-4 font-medium">Name</th>
                        <th className="py-2.5 font-medium">Storage Location</th>
                        <th className="py-2.5 font-medium">Size</th>
                        <th className="py-2.5 font-medium">Modified</th>
                        <th className="py-2.5 pr-4 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {filteredFiles.map((file) => {
                        const account = accounts.find((a) => a.id === file.storageAccountId);
                        const isSelected = selectedFile?.id === file.id;
                        return (
                          <tr
                            key={file.id}
                            onClick={() => {
                              setSelectedFile(isSelected ? null : file);
                              setSelectedFolder(null);
                            }}
                            onDoubleClick={() => handlePreviewFile(file)}
                            onContextMenu={(e) => handleContextMenu(e, file)}
                            className={cn(
                              'cursor-pointer transition-colors select-none group',
                              isSelected ? 'bg-blue-50/70 dark:bg-blue-950/50 text-slate-900 dark:text-slate-100' : 'hover:bg-slate-50/75 dark:hover:bg-slate-800/50'
                            )}
                          >
                            <td className="py-2.5 pl-4 flex items-center gap-2.5">
                              <button
                                onClick={(e) => handleToggleStar(file, e)}
                                title={file.isStarred ? 'Unstar' : 'Star'}
                                className="p-0.5 text-slate-300 dark:text-slate-600 hover:text-amber-500 transition-colors shrink-0 cursor-pointer"
                              >
                                <Star
                                  className={cn(
                                    'h-4 w-4',
                                    file.isStarred ? 'text-amber-400 fill-amber-400' : 'text-slate-300 dark:text-slate-600'
                                  )}
                                />
                              </button>
                              {getFileIcon(file.mimeType)}
                              <span className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-xs">{file.name}</span>
                            </td>
                            <td className="py-2.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px] font-medium border border-slate-200/60 dark:border-slate-700/60">
                                <HardDrive className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                                {account?.email || file.storageAccountId}
                              </span>
                            </td>
                            <td className="py-2.5 text-slate-600 dark:text-slate-300">{formatBytes(file.sizeBytes)}</td>
                            <td className="py-2.5 text-slate-500 dark:text-slate-400">{formatDate(file.modifiedAt)}</td>
                            <td className="py-2.5 pr-4 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePreviewFile(file);
                                  }}
                                  className="p-1 text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                                  title="Quick Preview"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownloadFile(file);
                                  }}
                                  className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
                                  title="Download"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </button>

                                {file.webUrl && (
                                  <a
                                    href={file.webUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 p-1 transition-colors"
                                    title="Open in Google Drive"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                )}

                                <button
                                  onClick={(e) => handleOpenActionMenu(e, file)}
                                  title="More actions"
                                  className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
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
                        onClick={() => {
                          setSelectedFile(isSelected ? null : file);
                          setSelectedFolder(null);
                        }}
                        onDoubleClick={() => handlePreviewFile(file)}
                        onContextMenu={(e) => handleContextMenu(e, file)}
                        className={cn(
                          'p-4 rounded-xl border bg-white dark:bg-slate-900 cursor-pointer transition-all space-y-3 relative group select-none',
                          isSelected
                            ? 'border-blue-600 ring-1 ring-blue-600 bg-blue-50/40 dark:bg-blue-950/40 shadow-xs'
                            : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-xs'
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-750">
                            {getFileIcon(file.mimeType)}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => handleToggleStar(file, e)}
                              title={file.isStarred ? 'Unstar' : 'Star'}
                              className="p-1 text-slate-300 dark:text-slate-600 hover:text-amber-500 transition-colors cursor-pointer"
                            >
                              <Star
                                className={cn(
                                    'h-4 w-4',
                                    file.isStarred ? 'text-amber-400 fill-amber-400' : 'text-slate-300 dark:text-slate-600'
                                )}
                              />
                            </button>
                            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              {formatBytes(file.sizeBytes)}
                            </span>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{file.name}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{formatDate(file.modifiedAt)}</p>
                        </div>

                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
                          <span className="truncate max-w-[130px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            <HardDrive className="h-3 w-3 text-slate-400 dark:text-slate-500 shrink-0" />
                            {account ? account.email.split('@')[0] : file.storageAccountId}
                          </span>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePreviewFile(file);
                              }}
                              className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 p-1 transition-colors cursor-pointer"
                              title="Preview"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadFile(file);
                              }}
                              className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 p-1 transition-colors cursor-pointer"
                              title="Download"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleOpenActionMenu(e, file)}
                              title="More"
                              className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 p-1 transition-colors cursor-pointer"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </button>
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
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4 h-fit lg:sticky lg:top-24 text-slate-700 dark:text-slate-300">
              <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">File Details</h4>
                </div>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/80 rounded-lg border border-slate-200/70 dark:border-slate-750 space-y-0.5">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">File Name</p>
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 break-words">{selectedFile.name}</p>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <p className="text-slate-500 dark:text-slate-400 font-medium">Storage Location</p>
                  <div className="flex items-center gap-1.5 mt-1 font-medium text-slate-800 dark:text-slate-200">
                    <HardDrive className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="break-all">{accounts.find((a) => a.id === selectedFile.storageAccountId)?.email || selectedFile.storageAccountId}</span>
                  </div>
                </div>

                <div>
                  <p className="text-slate-500 dark:text-slate-400 font-medium">File Size</p>
                  <p className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">{formatBytes(selectedFile.sizeBytes)}</p>
                </div>

                <div>
                  <p className="text-slate-500 dark:text-slate-400 font-medium">Type</p>
                  <p className="text-slate-700 dark:text-slate-300 mt-0.5">{selectedFile.mimeType}</p>
                </div>

                <div>
                  <p className="text-slate-500 dark:text-slate-400 font-medium">Last Modified</p>
                  <p className="text-slate-700 dark:text-slate-300 mt-0.5">{formatDate(selectedFile.modifiedAt)}</p>
                </div>
              </div>

              {/* Drawer Actions */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePreviewFile(selectedFile)}
                    className="flex-1 py-1.5 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-950/70 dark:hover:bg-blue-900/80 dark:text-blue-300 dark:border-blue-800 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>Preview</span>
                  </button>
                  <button
                    onClick={() => handleDownloadFile(selectedFile)}
                    className="flex-1 py-1.5 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  >
                    <Download className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                    <span>Download</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMoveCopyModal({ isOpen: true, mode: 'move', item: selectedFile })}
                    className="flex-1 py-1.5 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  >
                    <FolderInput className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                    <span>Move</span>
                  </button>
                  <button
                    onClick={() => setMoveCopyModal({ isOpen: true, mode: 'copy', item: selectedFile })}
                    className="flex-1 py-1.5 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  >
                    <Copy className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                    <span>Copy</span>
                  </button>
                </div>

                {selectedFile.webUrl && (
                  <a
                    href={selectedFile.webUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-1.5 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                  >
                    <span>Open in Google Drive</span>
                    <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                  </a>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleStar(selectedFile)}
                    className="flex-1 py-1.5 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  >
                    <Star
                      className={cn(
                        'h-3.5 w-3.5',
                        selectedFile.isStarred ? 'text-amber-400 fill-amber-400' : 'text-slate-400 dark:text-slate-500'
                      )}
                    />
                    <span>{selectedFile.isStarred ? 'Starred' : 'Star'}</span>
                  </button>

                  <button
                    onClick={() => {
                      setRenamingItem({ id: selectedFile.id, name: selectedFile.name, isFolder: false });
                      setRenameValue(selectedFile.name);
                    }}
                    className="flex-1 py-1.5 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  >
                    <Edit2 className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                    <span>Rename</span>
                  </button>
                </div>

                {activeView === 'trash' ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRestoreFile(selectedFile)}
                      className="flex-1 py-1.5 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 dark:text-emerald-300 dark:border-emerald-800 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Restore</span>
                    </button>
                    <button
                      onClick={() => handlePermanentDeleteFile(selectedFile)}
                      className="flex-1 py-1.5 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 dark:text-rose-300 dark:border-rose-800 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Delete Forever</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleMoveFileToTrash(selectedFile)}
                    className="w-full py-1.5 px-3 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 dark:bg-slate-800 dark:hover:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/50 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4 text-slate-900 dark:text-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Create Folder</h3>
              <button
                onClick={() => setIsCreatingFolder(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateFolderSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Folder Name</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="e.g. Documents"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:bg-white dark:focus:bg-slate-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsCreatingFolder(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingFolderSubmitting || !newFolderName.trim()}
                  className="px-4 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4 text-slate-900 dark:text-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Rename {renamingItem.isFolder ? 'Folder' : 'File'}
              </h3>
              <button
                onClick={() => setRenamingItem(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRenameSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">New Name</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:bg-white dark:focus:bg-slate-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRenamingItem(null)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRenamingSubmitting || !renameValue.trim()}
                  className="px-4 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
                >
                  {isRenamingSubmitting ? 'Renaming...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      <FilePreviewModal
        file={previewFile}
        isOpen={!!previewFile}
        onClose={() => setPreviewFile(null)}
        onDownload={handleDownloadFile}
      />

      {/* Move / Copy Modal */}
      <MoveCopyModal
        isOpen={moveCopyModal.isOpen}
        mode={moveCopyModal.mode}
        item={moveCopyModal.item}
        folders={rawFolders}
        accounts={accounts}
        onClose={() => setMoveCopyModal((prev) => ({ ...prev, isOpen: false }))}
        onSuccess={() => {
          fetchFilesystemData(currentFolderId);
          onRefreshStoragePool?.();
          success(moveCopyModal.mode === 'move' ? 'Item moved successfully.' : 'Item copied successfully.');
        }}
      />

      {/* Permanent Deletion Confirmation Modal */}
      {deleteConfirmTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 text-slate-900 dark:text-slate-100">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/50 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-1.5 flex-1 min-w-0">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Delete Permanently?
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Are you sure you want to permanently delete <strong className="text-slate-900 dark:text-slate-100">{deleteConfirmTarget.item.name}</strong>?
                </p>
                <div className="p-3 bg-rose-50/50 dark:bg-rose-950/30 rounded-lg border border-rose-100 dark:border-rose-900/50 text-[11px] text-rose-700 dark:text-rose-300 space-y-1">
                  <p className="font-semibold">This action cannot be undone.</p>
                  <p>
                    {deleteConfirmTarget.isFolder
                      ? 'The virtual folder and any contained items will be deleted permanently.'
                      : 'The file will be erased forever from its Google Drive storage account.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isDeletingPermanent}
                onClick={() => setDeleteConfirmTarget(null)}
                className="px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingPermanent}
                onClick={handleConfirmPermanentDelete}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isDeletingPermanent && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{isDeletingPermanent ? 'Deleting...' : 'Delete Forever'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        target={contextMenu.target}
        isTrashView={activeView === 'trash'}
        onClose={() => setContextMenu((prev) => ({ ...prev, isOpen: false }))}
        onPreview={(item) => handlePreviewFile(item as VirtualFile)}
        onDownload={(item) => handleDownloadFile(item as VirtualFile)}
        onRename={(item) => {
          const isFolder = 'isFolder' in item && item.isFolder === true;
          setRenamingItem({ id: item.id, name: item.name, isFolder });
          setRenameValue(item.name);
        }}
        onMove={(item) => setMoveCopyModal({ isOpen: true, mode: 'move', item })}
        onCopy={(item) => setMoveCopyModal({ isOpen: true, mode: 'copy', item })}
        onStar={(item) => handleToggleStar(item as VirtualFile)}
        onTrash={(item) => {
          if ('isFolder' in item && item.isFolder) {
            handleTrashFolder(item as VirtualFolder);
          } else {
            handleMoveFileToTrash(item as VirtualFile);
          }
        }}
        onRestore={(item) => {
          if ('isFolder' in item && item.isFolder) {
            handleRestoreFolder(item as VirtualFolder);
          } else {
            handleRestoreFile(item as VirtualFile);
          }
        }}
        onDeletePermanent={(item) => {
          if ('isFolder' in item && item.isFolder) {
            handlePermanentDeleteFolder(item as VirtualFolder);
          } else {
            handlePermanentDeleteFile(item as VirtualFile);
          }
        }}
      />
    </div>
  );
};
