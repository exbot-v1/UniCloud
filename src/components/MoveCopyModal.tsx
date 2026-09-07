/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Move & Copy Modal
 * Allows transferring or duplicating virtual files across folders and Google Drive storage accounts.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Folder,
  HardDrive,
  Copy,
  FolderInput,
  Loader2,
  AlertCircle,
  Check,
  ChevronRight,
} from 'lucide-react';
import { VirtualFile, VirtualFolder } from '../types/filesystem';
import { StorageAccount } from '../types/account';
import { cn, formatBytes } from '../lib/formatters';
import { authFetch } from '../lib/api';

export interface MoveCopyModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: VirtualFile | null;
  mode: 'move' | 'copy';
  accounts: StorageAccount[];
  onSuccess: () => void;
}

export const MoveCopyModal: React.FC<MoveCopyModalProps> = ({
  isOpen,
  onClose,
  file,
  mode,
  accounts,
  onSuccess,
}) => {
  const [folders, setFolders] = useState<VirtualFolder[]>([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState<boolean>(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [copyName, setCopyName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize form state
  useEffect(() => {
    if (!isOpen || !file) return;

    setSelectedFolderId(file.parentId);
    setSelectedAccountId(file.storageAccountId || accounts[0]?.id || '');
    setCopyName(mode === 'copy' ? `Copy of ${file.name}` : file.name);
    setErrorMessage(null);

    // Fetch all virtual folders
    setIsLoadingFolders(true);
    authFetch('/api/files?folderId=all')
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data?.folders) {
          setFolders(json.data.folders.filter((f: VirtualFolder) => !f.isTrashed));
        }
      })
      .catch((err) => {
        console.warn('Could not load folders for move/copy', err);
      })
      .finally(() => {
        setIsLoadingFolders(false);
      });
  }, [isOpen, file, mode, accounts]);

  if (!isOpen || !file) return null;

  const currentAccount = accounts.find((a) => a.id === file.storageAccountId);
  const targetAccount = accounts.find((a) => a.id === selectedAccountId);
  const isCrossAccount = selectedAccountId && selectedAccountId !== file.storageAccountId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (mode === 'move') {
        const res = await authFetch(`/api/files/${file.id}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetFolderId: selectedFolderId,
            targetAccountId: selectedAccountId || undefined,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error?.message || 'Failed to move file');
        }
      } else {
        // Mode === 'copy'
        const res = await authFetch(`/api/files/${file.id}/copy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newName: copyName.trim() || undefined,
            targetFolderId: selectedFolderId,
            targetAccountId: selectedAccountId || undefined,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error?.message || 'Failed to copy file');
        }
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Operation failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="move-copy-modal-backdrop"
      className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        id="move-copy-modal"
        className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden text-slate-900 dark:text-slate-100 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900">
              {mode === 'move' ? <FolderInput className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {mode === 'move' ? 'Move File' : 'Make a Copy'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">{file.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {errorMessage && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Copy Name Field */}
          {mode === 'copy' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                New File Name
              </label>
              <input
                type="text"
                required
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* Target Storage Account Selector */}
          {accounts.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Destination Storage Account
              </label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.email} ({formatBytes(acc.quota?.freeBytes || 0)} free)
                  </option>
                ))}
              </select>

              {isCrossAccount && targetAccount && (
                <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-1 flex items-center gap-1">
                  <HardDrive className="h-3 w-3" />
                  Cross-account transfer: Content will be securely replicated to {targetAccount.email}.
                </p>
              )}
            </div>
          )}

          {/* Destination Folder Selection */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Select Destination Folder
            </label>

            <div className="border border-slate-200 dark:border-slate-750 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 max-h-48 overflow-y-auto bg-slate-50/50 dark:bg-slate-850/50">
              {/* Virtual Root Option */}
              <button
                type="button"
                onClick={() => setSelectedFolderId(null)}
                className={cn(
                  'w-full px-3.5 py-2.5 flex items-center justify-between text-left transition-colors text-xs cursor-pointer',
                  selectedFolderId === null
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-medium'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                )}
              >
                <div className="flex items-center gap-2">
                  <Folder className="h-4 w-4 text-blue-500" />
                  <span>My Files (Root Directory)</span>
                </div>
                {selectedFolderId === null && <Check className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
              </button>

              {isLoadingFolders ? (
                <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  <span>Loading folders...</span>
                </div>
              ) : (
                folders.map((fol) => {
                  const isSelected = selectedFolderId === fol.id;
                  return (
                    <button
                      key={fol.id}
                      type="button"
                      onClick={() => setSelectedFolderId(fol.id)}
                      className={cn(
                        'w-full px-3.5 py-2.5 flex items-center justify-between text-left transition-colors text-xs cursor-pointer',
                        isSelected
                          ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-medium'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      )}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                        <span className="truncate">{fol.name}</span>
                      </div>
                      {isSelected && <Check className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{mode === 'move' ? 'Moving...' : 'Copying...'}</span>
                </>
              ) : (
                <span>{mode === 'move' ? 'Confirm Move' : 'Confirm Copy'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
