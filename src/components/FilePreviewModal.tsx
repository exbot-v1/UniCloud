/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud File Preview Modal
 * Provides in-browser preview for images, PDFs, text, code, audio, video,
 * and graceful fallback for proprietary documents with download and Google Drive actions.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  ExternalLink,
  Star,
  HardDrive,
  FileText,
  FileSpreadsheet,
  FileImage,
  FileCode,
  FileArchive,
  Music,
  Video,
  Loader2,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import { VirtualFile, SearchResultItem } from '../types/filesystem';
import { StorageAccount } from '../types/account';
import { cn, formatBytes, formatDate } from '../lib/formatters';
import { authFetch } from '../lib/api';

export interface FilePreviewModalProps {
  file: VirtualFile | SearchResultItem | null;
  isOpen: boolean;
  onClose: () => void;
  onToggleStar?: (file: VirtualFile | SearchResultItem) => void;
  accounts?: StorageAccount[];
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  file,
  isOpen,
  onClose,
  onToggleStar,
  accounts = [],
}) => {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState<boolean>(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [hasCopiedText, setHasCopiedText] = useState<boolean>(false);

  const account = file
    ? accounts.find((a) => a.id === file.storageAccountId) || {
        email: (file as SearchResultItem).accountEmail || file.storageAccountId,
      }
    : null;

  // Determine file type category
  const isImage = file?.mimeType?.startsWith('image/');
  const isPdf = file?.mimeType === 'application/pdf' || file?.name?.toLowerCase().endsWith('.pdf');
  const isAudio = file?.mimeType?.startsWith('audio/');
  const isVideo = file?.mimeType?.startsWith('video/');
  const isTextOrCode =
    file?.mimeType?.startsWith('text/') ||
    file?.mimeType?.includes('json') ||
    file?.mimeType?.includes('javascript') ||
    file?.mimeType?.includes('typescript') ||
    file?.mimeType?.includes('xml') ||
    Boolean(
      file?.name?.match(/\.(txt|md|json|js|ts|tsx|jsx|html|css|py|sh|sql|csv|yaml|yml|xml|env)$/i)
    );

  // Fetch text content if previewing a text or code file
  useEffect(() => {
    if (!isOpen || !file || !isTextOrCode) {
      setTextContent(null);
      setContentError(null);
      setIsLoadingContent(false);
      return;
    }

    let isMounted = true;
    setIsLoadingContent(true);
    setContentError(null);

    authFetch(`/api/files/${file.id}/content`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load content (${res.status})`);
        }
        return res.text();
      })
      .then((text) => {
        if (isMounted) {
          setTextContent(text);
          setIsLoadingContent(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setContentError(err.message || 'Could not load text preview');
          setIsLoadingContent(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, file?.id, isTextOrCode]);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !file) return null;

  const handleDownload = () => {
    // Trigger download via /api/files/:id/download
    const downloadUrl = `/api/files/${file.id}/download`;
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const handleCopyText = () => {
    if (!textContent) return;
    navigator.clipboard.writeText(textContent);
    setHasCopiedText(true);
    setTimeout(() => setHasCopiedText(false), 2000);
  };

  const getFileIcon = () => {
    if (file.mimeType?.includes('spreadsheet') || file.mimeType?.includes('excel')) {
      return <FileSpreadsheet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />;
    }
    if (isImage) {
      return <FileImage className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />;
    }
    if (file.mimeType?.includes('zip') || file.mimeType?.includes('archive')) {
      return <FileArchive className="h-5 w-5 text-amber-600 dark:text-amber-400" />;
    }
    if (isAudio) {
      return <Music className="h-5 w-5 text-pink-600 dark:text-pink-400" />;
    }
    if (isVideo) {
      return <Video className="h-5 w-5 text-purple-600 dark:text-purple-400" />;
    }
    if (isTextOrCode) {
      return <FileCode className="h-5 w-5 text-sky-600 dark:text-sky-400" />;
    }
    return <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />;
  };

  return (
    <div
      id="file-preview-modal-backdrop"
      className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        id="file-preview-modal"
        className="w-full max-w-4xl max-h-[92vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/70 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
            <div className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0 shadow-2xs">
              {getFileIcon()}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate" title={file.name}>
                {file.name}
              </h3>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                <span>{formatBytes(file.sizeBytes)}</span>
                <span>•</span>
                <span>{formatDate(file.modifiedAt)}</span>
                {account?.email && (
                  <>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
                      <HardDrive className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                      {account.email}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {onToggleStar && (
              <button
                id="btn-preview-star"
                onClick={() => onToggleStar(file)}
                title={file.isStarred ? 'Unstar file' : 'Star file'}
                className="p-2 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Star
                  className={cn(
                    'h-4 w-4',
                    file.isStarred ? 'text-amber-400 fill-amber-400' : 'text-slate-400 dark:text-slate-500'
                  )}
                />
              </button>
            )}

            <button
              id="btn-preview-download"
              onClick={handleDownload}
              title="Download file"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors shadow-2xs cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Download</span>
            </button>

            {file.webUrl && (
              <a
                id="btn-preview-drive-link"
                href={file.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in Google Drive"
                className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}

            <button
              id="btn-preview-close"
              onClick={onClose}
              title="Close preview (Esc)"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ml-1 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Content Body */}
        <div className="flex-1 overflow-auto p-4 sm:p-6 flex items-center justify-center min-h-[320px] max-h-[75vh] bg-slate-100/50 dark:bg-slate-950/40">
          {/* IMAGE PREVIEW */}
          {isImage && (
            <div className="flex flex-col items-center justify-center max-w-full max-h-full">
              <img
                src={`/api/files/${file.id}/content`}
                alt={file.name}
                className="max-h-[68vh] max-w-full object-contain rounded-lg shadow-md border border-slate-200/60 dark:border-slate-800"
                onError={(e) => {
                  if (file.thumbnailUrl) {
                    (e.target as HTMLImageElement).src = file.thumbnailUrl;
                  } else if (file.webUrl) {
                    // Fallback to error view
                    setContentError('Image could not be rendered directly.');
                  }
                }}
              />
            </div>
          )}

          {/* PDF PREVIEW */}
          {isPdf && !contentError && (
            <div className="w-full h-[68vh] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900">
              <iframe
                src={`/api/files/${file.id}/content#toolbar=1`}
                title={file.name}
                className="w-full h-full border-0"
              />
            </div>
          )}

          {/* AUDIO PREVIEW */}
          {isAudio && (
            <div className="p-8 rounded-2xl bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 shadow-md text-center max-w-md w-full space-y-4">
              <div className="h-16 w-16 rounded-2xl bg-pink-50 dark:bg-pink-950/60 text-pink-600 dark:text-pink-400 flex items-center justify-center mx-auto shadow-2xs">
                <Music className="h-8 w-8" />
              </div>
              <div>
                <h4 className="text-sm font-semibold truncate">{file.name}</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{formatBytes(file.sizeBytes)}</p>
              </div>
              <audio
                controls
                src={`/api/files/${file.id}/content`}
                className="w-full mt-2"
              />
            </div>
          )}

          {/* VIDEO PREVIEW */}
          {isVideo && (
            <div className="max-w-full max-h-full flex items-center justify-center">
              <video
                controls
                src={`/api/files/${file.id}/content`}
                className="max-h-[68vh] max-w-full rounded-lg shadow-lg border border-slate-200 dark:border-slate-800"
              />
            </div>
          )}

          {/* TEXT / CODE PREVIEW */}
          {isTextOrCode && (
            <div className="w-full h-[68vh] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-col shadow-xs overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono">{file.name}</span>
                {textContent && (
                  <button
                    onClick={handleCopyText}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    {hasCopiedText ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre">
                {isLoadingContent ? (
                  <div className="flex items-center justify-center h-full gap-2 text-slate-400">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                    <span>Loading file content...</span>
                  </div>
                ) : contentError ? (
                  <div className="flex items-center justify-center h-full flex-col gap-2 text-rose-500 text-center">
                    <AlertCircle className="h-6 w-6" />
                    <p>{contentError}</p>
                    <button
                      onClick={handleDownload}
                      className="mt-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-sans"
                    >
                      Download to View
                    </button>
                  </div>
                ) : (
                  textContent || '(Empty file)'
                )}
              </div>
            </div>
          )}

          {/* UNSUPPORTED / GOOGLE DOCS / GENERIC FALLBACK */}
          {!isImage && !isPdf && !isAudio && !isVideo && !isTextOrCode && (
            <div className="p-8 sm:p-12 text-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 max-w-md w-full shadow-md space-y-4">
              <div className="h-16 w-16 rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/70 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto shadow-2xs">
                {getFileIcon()}
              </div>

              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 break-words">{file.name}</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">{file.mimeType || 'Binary file'}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  No direct browser preview available for this document type. You can open it in Google Drive or download it directly to your device.
                </p>
              </div>

              <div className="pt-2 flex items-center justify-center gap-3">
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors shadow-2xs cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>Download File</span>
                </button>

                {file.webUrl && (
                  <a
                    href={file.webUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 dark:text-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium transition-colors shadow-2xs cursor-pointer"
                  >
                    <span>Google Drive</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
