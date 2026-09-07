/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Context Menu
 * Provides right-click and action-menu triggers with state-aware actions
 * (Preview, Download, Rename, Move, Copy, Trash, Restore, Delete Forever, Open in Drive).
 */

import React, { useEffect, useRef } from 'react';
import {
  Eye,
  Download,
  FolderOpen,
  Star,
  Edit2,
  FolderInput,
  Copy,
  Trash2,
  RotateCcw,
  ExternalLink,
  Trash,
} from 'lucide-react';
import { VirtualFile, VirtualFolder } from '../types/filesystem';
import { cn } from '../lib/formatters';

export interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  target: VirtualFile | VirtualFolder | null;
  onClose: () => void;
  onPreview?: (file: VirtualFile) => void;
  onOpenFolder?: (folder: VirtualFolder) => void;
  onDownload?: (file: VirtualFile) => void;
  onToggleStar?: (item: VirtualFile | VirtualFolder) => void;
  onRename?: (item: VirtualFile | VirtualFolder) => void;
  onMove?: (item: VirtualFile | VirtualFolder) => void;
  onCopy?: (file: VirtualFile) => void;
  onTrash?: (item: VirtualFile | VirtualFolder) => void;
  onRestore?: (item: VirtualFile | VirtualFolder) => void;
  onDeletePermanent?: (item: VirtualFile | VirtualFolder) => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  isOpen,
  position,
  target,
  onClose,
  onPreview,
  onOpenFolder,
  onDownload,
  onToggleStar,
  onRename,
  onMove,
  onCopy,
  onTrash,
  onRestore,
  onDeletePermanent,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  const isFolder = Boolean(target && 'isFolder' in target && target.isFolder);
  const isTrashed = Boolean(target && target.isTrashed);
  const fileTarget = !isFolder && target ? (target as VirtualFile) : null;
  const folderTarget = isFolder && target ? (target as VirtualFolder) : null;

  // Handle outside click and escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Use mousedown and contextmenu to close if another click occurs
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Adjust menu position so it doesn't clip screen boundaries
  if (!isOpen || !target) return null;

  const menuWidth = 210;
  const menuHeight = 290;
  const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

  const adjustedX = Math.min(position.x, screenWidth - menuWidth - 12);
  const adjustedY = Math.min(position.y, screenHeight - menuHeight - 12);

  return (
    <div
      ref={menuRef}
      id="custom-context-menu"
      style={{ top: `${adjustedY}px`, left: `${adjustedX}px` }}
      className="fixed z-50 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl py-1.5 text-xs text-slate-800 dark:text-slate-200 animate-in fade-in-50 zoom-in-95 duration-100 divide-y divide-slate-100 dark:divide-slate-800/60"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Group 1: Primary actions */}
      <div className="py-1">
        {isFolder ? (
          <button
            onClick={() => {
              if (folderTarget && onOpenFolder) onOpenFolder(folderTarget);
              onClose();
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <FolderOpen className="h-4 w-4 text-amber-500" />
            <span>Open Folder</span>
          </button>
        ) : (
          <>
            <button
              onClick={() => {
                if (fileTarget && onPreview) onPreview(fileTarget);
                onClose();
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Eye className="h-4 w-4 text-blue-500" />
              <span>Preview</span>
            </button>

            {!isTrashed && (
              <button
                onClick={() => {
                  if (fileTarget && onDownload) onDownload(fileTarget);
                  onClose();
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Download className="h-4 w-4 text-emerald-500" />
                <span>Download</span>
              </button>
            )}
          </>
        )}

        {!isTrashed && onToggleStar && (
          <button
            onClick={() => {
              onToggleStar(target);
              onClose();
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Star
              className={cn(
                'h-4 w-4',
                target.isStarred ? 'text-amber-400 fill-amber-400' : 'text-slate-400'
              )}
            />
            <span>{target.isStarred ? 'Remove from Starred' : 'Add to Starred'}</span>
          </button>
        )}
      </div>

      {/* Group 2: Modifying / Organizing actions */}
      {!isTrashed && (
        <div className="py-1">
          {onRename && (
            <button
              onClick={() => {
                onRename(target);
                onClose();
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Edit2 className="h-4 w-4 text-slate-500" />
              <span>Rename</span>
            </button>
          )}

          {onMove && (
            <button
              onClick={() => {
                onMove(target);
                onClose();
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <FolderInput className="h-4 w-4 text-indigo-500" />
              <span>Move to...</span>
            </button>
          )}

          {!isFolder && onCopy && fileTarget && (
            <button
              onClick={() => {
                onCopy(fileTarget);
                onClose();
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Copy className="h-4 w-4 text-slate-500" />
              <span>Make a Copy</span>
            </button>
          )}

          {fileTarget?.webUrl && (
            <a
              href={fileTarget.webUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer text-slate-700 dark:text-slate-300"
            >
              <ExternalLink className="h-4 w-4 text-blue-500" />
              <span>Open in Google Drive</span>
            </a>
          )}
        </div>
      )}

      {/* Group 3: Destructive / Recovery actions */}
      <div className="py-1">
        {!isTrashed && onTrash && (
          <button
            onClick={() => {
              onTrash(target);
              onClose();
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer"
          >
            <Trash2 className="h-4 w-4" />
            <span>Move to Trash</span>
          </button>
        )}

        {isTrashed && (
          <>
            {onRestore && (
              <button
                onClick={() => {
                  onRestore(target);
                  onClose();
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 transition-colors cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Restore File</span>
              </button>
            )}

            {onDeletePermanent && (
              <button
                onClick={() => {
                  onDeletePermanent(target);
                  onClose();
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer"
              >
                <Trash className="h-4 w-4" />
                <span>Delete Permanently</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
