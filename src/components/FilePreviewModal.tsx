/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud File Preview Modal
 * Provides in-browser authenticated preview for images, PDFs, text, code, audio, video,
 * and graceful fallback with zoom/fit controls, metadata inspection, and direct actions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Download,
  ExternalLink,
  Star,
  Trash2,
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
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  RefreshCw,
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
  onDownload?: (file: VirtualFile | SearchResultItem) => void;
  onDelete?: (file: VirtualFile | SearchResultItem) => void;
  accounts?: StorageAccount[];
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  file,
  isOpen,
  onClose,
  onToggleStar,
  onDownload,
  onDelete,
  accounts = [],
}) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [hasCopiedText, setHasCopiedText] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(100);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const account = file
    ? accounts.find((a) => a.id === file.storageAccountId) || {
        email: (file as SearchResultItem).accountEmail || file.storageAccountId,
      }
    : null;

  // Determine file type category
  const isImage = file?.mimeType?.startsWith('image/');
  const isPdf = file?.mimeType === 'application/pdf' || Boolean(file?.name?.toLowerCase().endsWith('.pdf'));
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

  // Authenticated media / content loader
  const loadContent = useCallback(async () => {
    if (!file) return;

    setIsLoading(true);
    setContentError(null);
    setZoom(100);

    // Clean up previous blob URL
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }
    setTextContent(null);

    try {
      if (isTextOrCode) {
        const res = await authFetch(`/api/files/${file.id}/content`);
        if (!res.ok) {
          throw new Error(`Failed to load content (${res.status})`);
        }
        const text = await res.text();
        setTextContent(text);
      } else if (isImage || isPdf || isAudio || isVideo) {
        // Authenticated binary blob retrieval
        let res = await authFetch(`/api/files/${file.id}/content`);
        if (!res.ok && isImage) {
          // Fallback to thumbnail endpoint if content stream failed
          res = await authFetch(`/api/files/${file.id}/thumbnail`);
        }

        if (!res.ok) {
          throw new Error(`Preview data unavailable (${res.status})`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
      }
    } catch (err: any) {
      setContentError(err.message || 'Preview could not be loaded');
    } finally {
      setIsLoading(false);
    }
  }, [file?.id, isTextOrCode, isImage, isPdf, isAudio, isVideo]);

  useEffect(() => {
    if (isOpen && file) {
      loadContent();
    } else {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        setBlobUrl(null);
      }
      setTextContent(null);
      setContentError(null);
      setIsLoading(false);
      setZoom(100);
    }

    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [isOpen, file?.id]);

  // Handle keyboard shortcuts (Esc to close, +/- for zoom)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setZoom((z) => Math.min(z + 25, 300));
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        setZoom((z) => Math.max(z - 25, 25));
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setZoom(100);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !file) return null;

  const handleDownload = async () => {
    if (onDownload) {
      onDownload(file);
      return;
    }
    try {
      const res = await authFetch(`/api/files/${file.id}/download`);
      if (!res.ok) {
        throw new Error(`Download failed with status ${res.status}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
    } catch {
      const downloadUrl = `/api/files/${file.id}/download`;
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    }
  };

  const handleDelete = async () => {
    if (onDelete) {
      onDelete(file);
      onClose();
      return;
    }
    if (!window.confirm(`Are you sure you want to move "${file.name}" to trash?`)) {
      return;
    }
    try {
      setIsDeleting(true);
      const res = await authFetch(`/api/files/${file.id}`, { method: 'DELETE' });
      if (res.ok) {
        onClose();
      }
    } catch (err) {
      console.error('Delete failed', err);
    } finally {
      setIsDeleting(false);
    }
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
        className="w-full max-w-5xl max-h-[92vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-850/80 shrink-0">
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
                <span>{file.mimeType || 'Document'}</span>
                <span>•</span>
                <span>{formatDate(file.modifiedAt)}</span>
                {account?.email && (
                  <>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
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
            {/* Zoom Controls for Image & PDF */}
            {(isImage || isPdf) && !isLoading && !contentError && (
              <div className="hidden sm:flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 mr-1 text-xs text-slate-600 dark:text-slate-300">
                <button
                  id="btn-preview-zoom-out"
                  onClick={() => setZoom((z) => Math.max(z - 25, 25))}
                  title="Zoom out"
                  className="p-1 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="w-10 text-center font-mono text-[11px] select-none font-medium">{zoom}%</span>
                <button
                  id="btn-preview-zoom-in"
                  onClick={() => setZoom((z) => Math.min(z + 25, 300))}
                  title="Zoom in"
                  className="p-1 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  id="btn-preview-zoom-reset"
                  onClick={() => setZoom(100)}
                  title="Reset zoom (100%)"
                  className="p-1 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer ml-0.5"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              </div>
            )}

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
                title="Open in Provider (Google Drive)"
                className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}

            <button
              id="btn-preview-delete"
              onClick={handleDelete}
              disabled={isDeleting}
              title="Move to trash"
              className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
            </button>

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
        <div className="flex-1 overflow-auto p-4 sm:p-6 flex items-center justify-center min-h-[360px] max-h-[75vh] bg-slate-100/60 dark:bg-slate-950/60">
          {/* Loading Indicator */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              <span className="text-xs font-medium">Retrieving authenticated preview...</span>
            </div>
          )}

          {/* Content Load Error */}
          {!isLoading && contentError && (
            <div className="p-8 text-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 max-w-md w-full shadow-md space-y-4">
              <div className="h-14 w-14 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-500 flex items-center justify-center mx-auto shadow-2xs">
                <AlertCircle className="h-7 w-7" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Preview Failed to Load</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">{contentError}</p>
              </div>
              <div className="pt-2 flex items-center justify-center gap-2">
                <button
                  onClick={loadContent}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-medium transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Retry</span>
                </button>
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors shadow-2xs"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download</span>
                </button>
                {file.webUrl && (
                  <a
                    href={file.webUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600"
                  >
                    <span>Drive</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* IMAGE PREVIEW */}
          {!isLoading && !contentError && isImage && (
            <div className="flex items-center justify-center max-w-full max-h-full overflow-auto p-2">
              <img
                src={blobUrl || `/api/files/${file.id}/content`}
                alt={file.name}
                style={{
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.15s ease-out',
                }}
                className="max-h-[66vh] max-w-full object-contain rounded-lg shadow-md border border-slate-200/60 dark:border-slate-800"
              />
            </div>
          )}

          {/* PDF PREVIEW */}
          {!isLoading && !contentError && isPdf && (
            <div
              className="w-full h-[68vh] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900"
              style={{
                transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
                transformOrigin: 'top center',
                transition: 'transform 0.15s ease-out',
              }}
            >
              <iframe
                src={blobUrl ? `${blobUrl}#toolbar=1` : `/api/files/${file.id}/content#toolbar=1`}
                title={file.name}
                className="w-full h-full border-0"
              />
            </div>
          )}

          {/* AUDIO PREVIEW */}
          {!isLoading && !contentError && isAudio && (
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
                src={blobUrl || `/api/files/${file.id}/content`}
                className="w-full mt-2"
              />
            </div>
          )}

          {/* VIDEO PREVIEW */}
          {!isLoading && !contentError && isVideo && (
            <div className="max-w-full max-h-full flex items-center justify-center">
              <video
                controls
                src={blobUrl || `/api/files/${file.id}/content`}
                className="max-h-[68vh] max-w-full rounded-lg shadow-lg border border-slate-200 dark:border-slate-800"
              />
            </div>
          )}

          {/* TEXT / CODE PREVIEW */}
          {!isLoading && !contentError && isTextOrCode && (
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
                {textContent || '(Empty file)'}
              </div>
            </div>
          )}

          {/* UNSUPPORTED / GOOGLE DOCS / GENERIC FALLBACK */}
          {!isLoading && !contentError && !isImage && !isPdf && !isAudio && !isVideo && !isTextOrCode && (
            <div className="p-8 sm:p-12 text-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 max-w-md w-full shadow-md space-y-4">
              <div className="h-16 w-16 rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/70 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto shadow-2xs">
                {getFileIcon()}
              </div>

              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 break-words">{file.name}</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">{file.mimeType || 'Binary file'}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  No direct browser preview available for this document type. You can download it directly or open it in Google Drive.
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

        {/* Modal Footer / Metadata Bar */}
        <div className="px-5 py-2.5 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-mono text-[11px] truncate max-w-[200px] text-slate-600 dark:text-slate-300">
              ID: {file.id}
            </span>
            <span>Type: {file.mimeType || 'Unknown'}</span>
            <span>Size: {formatBytes(file.sizeBytes)}</span>
          </div>

          <div className="flex items-center gap-3">
            {(isImage || isPdf) && (
              <span className="hidden md:inline text-[11px] text-slate-400">
                Shortcuts: +/- to zoom, 0 to reset, Esc to close
              </span>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1 rounded bg-slate-200 hover:bg-slate-300 dark:bg-slate-750 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
