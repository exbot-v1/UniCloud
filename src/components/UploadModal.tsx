/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Resumable Upload & Capacity Routing Modal (Phase 4)
 * Supports real Google Drive resumable streaming uploads, chunked transfer,
 * live progress tracking, retry/abort capabilities, and capacity routing simulation.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  X,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Zap,
  Sliders,
  Shield,
  Layers,
  FileText,
  Pause,
  Play,
  RotateCw,
  Ban,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { StoragePoolSummary, StorageAccount } from '../types/account';
import { UploadRoutingStrategy, UploadRoutingDecision, UploadJob, UploadStatus } from '../types/upload';
import { formatBytes } from '../lib/formatters';
import { authFetch } from '../lib/api';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  poolSummary: StoragePoolSummary;
  onUploadSuccess?: () => void;
}

type ModalTab = 'upload' | 'simulate';

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  poolSummary,
  onUploadSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('upload');

  // Real Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [strategy, setStrategy] = useState<UploadRoutingStrategy>(UploadRoutingStrategy.MOST_FREE_SPACE);
  const [preferredAccountId, setPreferredAccountId] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [bytesUploaded, setBytesUploaded] = useState(0);
  const [currentJob, setCurrentJob] = useState<UploadJob | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [assignedAccount, setAssignedAccount] = useState<StorageAccount | null>(null);

  // Simulation State
  const [simFileName, setSimFileName] = useState('Production_Dataset_2026.zip');
  const [simSizeMb, setSimSizeMb] = useState<number>(450);
  const [simStrategy, setSimStrategy] = useState<UploadRoutingStrategy>(UploadRoutingStrategy.MOST_FREE_SPACE);
  const [simPreferredAccountId, setSimPreferredAccountId] = useState<string>('');
  const [simRoutingResult, setSimRoutingResult] = useState<UploadRoutingDecision | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Reset state on modal open
  useEffect(() => {
    if (isOpen) {
      setUploadError(null);
      if (!isUploading && !isCompleted) {
        setUploadProgress(0);
        setBytesUploaded(0);
      }
    }
  }, [isOpen, isUploading, isCompleted]);

  if (!isOpen) return null;

  // ---------------------------------------------------------------------------
  // REAL RESUMABLE UPLOAD FLOW (Phase 4)
  // ---------------------------------------------------------------------------

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setUploadError(null);
      setIsCompleted(false);
      setUploadProgress(0);
      setBytesUploaded(0);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
      setUploadError(null);
      setIsCompleted(false);
      setUploadProgress(0);
      setBytesUploaded(0);
    }
  };

  const handleStartUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadError(null);
    setIsCompleted(false);
    setUploadProgress(0);
    setBytesUploaded(0);

    abortControllerRef.current = new AbortController();

    try {
      // 1. Initiate Resumable Session with Multi-Account Routing
      const initRes = await authFetch('/api/upload/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: selectedFile.name,
          mimeType: selectedFile.type || 'application/octet-stream',
          sizeBytes: selectedFile.size,
          strategy,
          preferredAccountId: strategy === UploadRoutingStrategy.MANUAL ? preferredAccountId : undefined,
        }),
        signal: abortControllerRef.current.signal,
      });

      const initData = await initRes.json();
      if (!initData.success || !initData.data) {
        throw new Error(initData.error?.message || 'Failed to initiate upload session.');
      }

      const job: UploadJob = initData.data;
      setCurrentJob(job);

      const matchedAccount = poolSummary.accounts.find((a) => a.id === job.assignedAccountId);
      if (matchedAccount) {
        setAssignedAccount(matchedAccount);
      }

      // 2. Stream File in 2MB Chunks with Google Drive Content-Range
      const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunk buffer
      let offset = 0;
      const total = selectedFile.size;

      while (offset < total) {
        if (abortControllerRef.current?.signal.aborted) {
          throw new Error('Upload was cancelled.');
        }

        const chunkEnd = Math.min(offset + CHUNK_SIZE, total);
        const chunkBlob = selectedFile.slice(offset, chunkEnd);
        const chunkBuffer = await chunkBlob.arrayBuffer();
        const start = offset;
        const end = chunkEnd - 1;

        const chunkRes = await authFetch(`/api/upload/${job.id}/chunk`, {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Type': 'application/octet-stream',
          },
          body: chunkBuffer,
          signal: abortControllerRef.current.signal,
        });

        const chunkData = await chunkRes.json();
        if (!chunkData.success) {
          throw new Error(chunkData.error?.message || `Chunk upload failed at byte offset ${offset}`);
        }

        offset = chunkEnd;
        setBytesUploaded(offset);
        const percent = Math.min(100, Math.round((offset / total) * 100));
        setUploadProgress(percent);

        if (chunkData.data?.completed) {
          break;
        }
      }

      // Success
      setIsCompleted(true);
      setIsUploading(false);
      setUploadProgress(100);
      setBytesUploaded(total);
      if (onUploadSuccess) {
        onUploadSuccess();
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'Upload was cancelled.') {
        setUploadError('Upload cancelled by user.');
      } else {
        setUploadError(err.message || 'An unexpected error occurred during upload.');
      }
      setIsUploading(false);
    }
  };

  const handleAbort = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (currentJob) {
      try {
        await authFetch(`/api/upload/${currentJob.id}/abort`, { method: 'POST' });
      } catch (err) {
        console.warn('Abort notification error', err);
      }
    }
    setIsUploading(false);
    setUploadError('Upload aborted.');
  };

  const handleRetry = async () => {
    if (!currentJob || !selectedFile) {
      handleStartUpload();
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    abortControllerRef.current = new AbortController();

    try {
      // Query retry endpoint to verify last acknowledged bytes
      const retryRes = await authFetch(`/api/upload/${currentJob.id}/retry`, {
        method: 'POST',
      });
      const retryData = await retryRes.json();
      if (!retryData.success) {
        throw new Error(retryData.error?.message || 'Failed to resume upload session.');
      }

      const resumedJob: UploadJob = retryData.data;
      setCurrentJob(resumedJob);

      let offset = resumedJob.bytesUploaded || 0;
      const total = selectedFile.size;
      const CHUNK_SIZE = 2 * 1024 * 1024;

      while (offset < total) {
        if (abortControllerRef.current?.signal.aborted) {
          throw new Error('Upload was cancelled.');
        }

        const chunkEnd = Math.min(offset + CHUNK_SIZE, total);
        const chunkBlob = selectedFile.slice(offset, chunkEnd);
        const chunkBuffer = await chunkBlob.arrayBuffer();
        const start = offset;
        const end = chunkEnd - 1;

        const chunkRes = await authFetch(`/api/upload/${resumedJob.id}/chunk`, {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Type': 'application/octet-stream',
          },
          body: chunkBuffer,
          signal: abortControllerRef.current.signal,
        });

        const chunkData = await chunkRes.json();
        if (!chunkData.success) {
          throw new Error(chunkData.error?.message || 'Chunk upload failed during resume.');
        }

        offset = chunkEnd;
        setBytesUploaded(offset);
        setUploadProgress(Math.min(100, Math.round((offset / total) * 100)));

        if (chunkData.data?.completed) {
          break;
        }
      }

      setIsCompleted(true);
      setIsUploading(false);
      setUploadProgress(100);
      if (onUploadSuccess) {
        onUploadSuccess();
      }
    } catch (err: any) {
      setUploadError(err.message || 'Retry failed.');
      setIsUploading(false);
    }
  };

  const handleResetForNewUpload = () => {
    setSelectedFile(null);
    setCurrentJob(null);
    setIsCompleted(false);
    setUploadError(null);
    setUploadProgress(0);
    setBytesUploaded(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // ---------------------------------------------------------------------------
  // SIMULATION FLOW (Phase 0 / Spec Tool)
  // ---------------------------------------------------------------------------

  const simSizeBytes = simSizeMb * 1024 * 1024;

  const handleSimulateRouting = async () => {
    setIsSimulating(true);
    try {
      const res = await fetch('/api/upload/route-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sizeBytes: simSizeBytes,
          strategy: simStrategy,
          preferredAccountId: simPreferredAccountId || undefined,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setSimRoutingResult(data.data);
      } else {
        const capable = poolSummary.accounts
          .filter((a) => a.quota.freeBytes >= simSizeBytes)
          .sort((a, b) => b.quota.freeBytes - a.quota.freeBytes);

        if (capable.length > 0) {
          const chosen = capable[0];
          setSimRoutingResult({
            selectedAccountId: chosen.id,
            strategyUsed: simStrategy,
            reason: `Account '${chosen.displayName || chosen.email}' selected with highest available capacity (${formatBytes(chosen.quota.freeBytes)} free).`,
            availableCapacityBeforeBytes: chosen.quota.freeBytes,
            projectedCapacityAfterBytes: chosen.quota.freeBytes - simSizeBytes,
          });
        }
      }
    } catch {
      const capable = poolSummary.accounts
        .filter((a) => a.quota.freeBytes >= simSizeBytes)
        .sort((a, b) => b.quota.freeBytes - a.quota.freeBytes);

      if (capable.length > 0) {
        const chosen = capable[0];
        setSimRoutingResult({
          selectedAccountId: chosen.id,
          strategyUsed: simStrategy,
          reason: `Account '${chosen.displayName || chosen.email}' selected with highest available capacity (${formatBytes(chosen.quota.freeBytes)} free).`,
          availableCapacityBeforeBytes: chosen.quota.freeBytes,
          projectedCapacityAfterBytes: chosen.quota.freeBytes - simSizeBytes,
        });
      }
    } finally {
      setIsSimulating(false);
    }
  };

  const simSelectedAccount = simRoutingResult
    ? poolSummary.accounts.find((a) => a.id === simRoutingResult.selectedAccountId)
    : null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-white rounded-2xl p-6 shadow-xl border border-slate-200 space-y-5 max-h-[92vh] overflow-y-auto text-slate-900">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3.5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Upload Files</h3>
              <p className="text-xs text-slate-500">
                Resumable streaming upload across connected Google Drive accounts
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isUploading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'upload'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UploadCloud className="h-3.5 w-3.5" />
            <span>Upload File</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('simulate')}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'simulate'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Zap className="h-3.5 w-3.5" />
            <span>Capacity Router</span>
          </button>
        </div>

        {/* ===================================================================== */}
        {/* TAB 1: REAL RESUMABLE FILE UPLOAD                                    */}
        {/* ===================================================================== */}
        {activeTab === 'upload' && (
          <div className="space-y-4">
            {!isCompleted ? (
              <>
                {/* File Dropzone / Selector */}
                {!selectedFile ? (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-200 hover:border-blue-400 bg-slate-50/50 hover:bg-blue-50/20 rounded-xl p-6 text-center cursor-pointer transition-all group"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-2.5 group-hover:scale-105 transition-transform border border-blue-100">
                      <UploadCloud className="h-5 w-5" />
                    </div>
                    <p className="text-xs font-semibold text-slate-900 mb-1">
                      Click to choose a file or drag &amp; drop here
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Supports large files via server-side resumable Google Drive streaming
                    </p>
                  </div>
                ) : (
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {selectedFile.name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {formatBytes(selectedFile.size)} • {selectedFile.type || 'Unknown MIME'}
                        </p>
                      </div>
                    </div>
                    {!isUploading && (
                      <button
                        type="button"
                        onClick={handleResetForNewUpload}
                        className="text-xs text-slate-500 hover:text-rose-600 p-1.5 rounded-lg transition-colors cursor-pointer font-medium"
                      >
                        Change
                      </button>
                    )}
                  </div>
                )}

                {/* Routing Strategy Config */}
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="font-medium text-slate-700 block text-xs mb-1.5">
                      Routing Mode
                    </label>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {[
                        { id: UploadRoutingStrategy.MOST_FREE_SPACE, label: 'Most Free Space' },
                        { id: UploadRoutingStrategy.BALANCED, label: 'Balanced' },
                        { id: UploadRoutingStrategy.MANUAL, label: 'Manual' },
                      ].map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          disabled={isUploading}
                          onClick={() => setStrategy(s.id)}
                          className={`py-2 px-2.5 rounded-lg border text-center font-medium transition-all cursor-pointer ${
                            strategy === s.id
                              ? 'border-blue-600 bg-blue-50/80 text-blue-700 font-semibold shadow-2xs'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {strategy === UploadRoutingStrategy.MANUAL && (
                    <div className="animate-in fade-in duration-100">
                      <label className="font-medium text-slate-700 block text-xs mb-1">
                        Target Storage Account
                      </label>
                      <select
                        disabled={isUploading}
                        value={preferredAccountId}
                        onChange={(e) => setPreferredAccountId(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 text-slate-900 rounded-lg focus:border-blue-600 focus:outline-hidden text-xs cursor-pointer"
                      >
                        <option value="">Select an account...</option>
                        {poolSummary.accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.displayName || acc.email} ({formatBytes(acc.quota.freeBytes)} free)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Live Progress Bar */}
                {isUploading && (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-900 flex items-center gap-1.5">
                        <RotateCw className="h-3.5 w-3.5 text-blue-600 animate-spin" />
                        Uploading to Google Drive...
                      </span>
                      <span className="font-mono text-blue-600 font-semibold">
                        {uploadProgress}%
                      </span>
                    </div>

                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all duration-200 ease-out rounded-full"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>
                        {formatBytes(bytesUploaded)} of {formatBytes(selectedFile?.size || 0)}
                      </span>
                      {assignedAccount && (
                        <span className="text-slate-700 font-medium">
                          Account: {assignedAccount.displayName || assignedAccount.email}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Error Banner */}
                {uploadError && (
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
                    <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold">Upload Failed</p>
                      <p className="text-[11px] text-rose-600/90">{uploadError}</p>
                    </div>
                  </div>
                )}

                {/* Modal Actions */}
                <div className="flex items-center gap-2 pt-2">
                  {!isUploading ? (
                    <>
                      {uploadError ? (
                        <button
                          type="button"
                          onClick={handleRetry}
                          className="flex-1 py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                        >
                          <RotateCw className="h-4 w-4" />
                          <span>Retry Upload</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!selectedFile || (strategy === UploadRoutingStrategy.MANUAL && !preferredAccountId)}
                          onClick={handleStartUpload}
                          className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-lg text-xs font-medium shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <UploadCloud className="h-4 w-4" />
                          <span>Start Upload</span>
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={handleAbort}
                      className="w-full py-2.5 px-4 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Ban className="h-4 w-4 text-rose-600" />
                      <span>Abort Upload</span>
                    </button>
                  )}
                </div>
              </>
            ) : (
              /* Success State */
              <div className="p-5 bg-white rounded-xl border border-emerald-200 text-center space-y-4 animate-in zoom-in-95 duration-200">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-base font-semibold text-slate-900">Upload Complete</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    File was successfully streamed and mapped to your virtual cloud filesystem.
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-left text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-500">File:</span>
                    <span className="font-medium text-slate-900">{selectedFile?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Size:</span>
                    <span className="font-mono text-slate-800">{formatBytes(selectedFile?.size || 0)}</span>
                  </div>
                  {assignedAccount && (
                    <div className="flex justify-between border-t border-slate-200 pt-1.5">
                      <span className="text-slate-500">Stored On:</span>
                      <span className="font-medium text-emerald-700">
                        {assignedAccount.displayName || assignedAccount.email}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleResetForNewUpload}
                    className="flex-1 py-2 px-3 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium border border-slate-200 transition-colors cursor-pointer"
                  >
                    Upload Another
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer shadow-xs"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================== */}
        {/* TAB 2: CAPACITY ROUTING SIMULATOR                                     */}
        {/* ===================================================================== */}
        {activeTab === 'simulate' && (
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-900 text-xs flex items-start gap-2.5">
              <Zap className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Capacity Routing Engine:</span> Test how UniCloud distributes files across your accounts before uploading.
              </div>
            </div>

            <div>
              <label className="font-medium text-slate-700 block mb-1">Simulated File Name</label>
              <input
                type="text"
                value={simFileName}
                onChange={(e) => setSimFileName(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 text-slate-900 rounded-lg focus:border-blue-600 focus:outline-hidden"
              />
            </div>

            <div>
              <div className="flex justify-between font-medium text-slate-700 mb-1">
                <span>File Size Simulation</span>
                <span className="text-blue-600 font-semibold">{simSizeMb} MB ({formatBytes(simSizeBytes)})</span>
              </div>
              <input
                type="range"
                min={10}
                max={5000}
                step={10}
                value={simSizeMb}
                onChange={(e) => {
                  setSimSizeMb(Number(e.target.value));
                  setSimRoutingResult(null);
                }}
                className="w-full accent-blue-600 h-2 bg-slate-100 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>10 MB</span>
                <span>1 GB</span>
                <span>2.5 GB</span>
                <span>5 GB</span>
              </div>
            </div>

            <div>
              <label className="font-medium text-slate-700 block mb-1">Routing Strategy</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: UploadRoutingStrategy.MOST_FREE_SPACE, label: 'Most Free Space' },
                  { id: UploadRoutingStrategy.BALANCED, label: 'Balanced' },
                  { id: UploadRoutingStrategy.MANUAL, label: 'Manual' },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSimStrategy(s.id);
                      setSimRoutingResult(null);
                    }}
                    className={`py-2 px-3 rounded-lg border text-center font-medium transition-all cursor-pointer ${
                      simStrategy === s.id
                        ? 'border-blue-600 bg-blue-50/80 text-blue-700 font-semibold shadow-2xs'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {simStrategy === UploadRoutingStrategy.MANUAL && (
              <div>
                <label className="font-medium text-slate-700 block mb-1">Target Account</label>
                <select
                  value={simPreferredAccountId}
                  onChange={(e) => setSimPreferredAccountId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 text-slate-900 rounded-lg focus:border-blue-600 focus:outline-hidden"
                >
                  <option value="">Select an account</option>
                  {poolSummary.accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.displayName || acc.email} ({formatBytes(acc.quota.freeBytes)} free)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={handleSimulateRouting}
              disabled={isSimulating}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Zap className="h-4 w-4" />
              <span>{isSimulating ? 'Evaluating Capacity...' : 'Simulate Routing Decision'}</span>
            </button>

            {simRoutingResult && simSelectedAccount && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Routing Decision Resolved
                  </span>
                  <span className="font-mono text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">
                    {simRoutingResult.strategyUsed}
                  </span>
                </div>

                <p className="text-slate-600 text-[11px]">{simRoutingResult.reason}</p>

                <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-2">
                  <div className="flex items-center gap-2 font-medium text-slate-900">
                    <HardDrive className="h-4 w-4 text-blue-600" />
                    <span>Selected Destination: {simSelectedAccount.displayName || simSelectedAccount.email}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 pt-1.5 border-t border-slate-100">
                    <div>
                      <span className="text-slate-500 block">Available Headroom:</span>
                      <span className="font-semibold text-slate-900">{formatBytes(simRoutingResult.availableCapacityBeforeBytes)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Projected After Upload:</span>
                      <span className="font-semibold text-emerald-700">{formatBytes(simRoutingResult.projectedCapacityAfterBytes)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

