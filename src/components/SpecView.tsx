/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Master Architecture & Spec In-App Viewer
 * Renders the architectural principles, PostgreSQL schema, and Phase 0 status.
 */

import React, { useState } from 'react';
import {
  BookOpen,
  Layers,
  Shield,
  Database,
  GitBranch,
  Terminal,
  CheckCircle2,
  Lock,
  ArrowRight,
} from 'lucide-react';

export const SpecView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'schema' | 'provider' | 'roadmap'>('overview');

  return (
    <div id="spec-view" className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="border-b border-white/10 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">UNICLOUD — Master Architecture Spec</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase tracking-wider">
              Phase 0 Complete
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Single source of architectural truth for virtual cloud storage across multiple Google Drive accounts.
          </p>
        </div>

        {/* Spec Tabs */}
        <div className="flex items-center bg-white/[0.04] border border-white/10 p-1 rounded-xl text-xs font-medium text-slate-400">
          {[
            { id: 'overview' as const, label: 'Vision & Architecture' },
            { id: 'schema' as const, label: 'PostgreSQL Schema' },
            { id: 'provider' as const, label: 'Storage Provider' },
            { id: 'roadmap' as const, label: 'Roadmap & Safety' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeTab === tab.id
                  ? 'bg-white/15 text-white font-bold shadow-xs'
                  : 'hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Layers className="h-5 w-5 text-purple-400" />
              1. Core Architectural Principle
            </h2>
            <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/25 text-xs text-slate-300 leading-relaxed space-y-2">
              <p className="font-bold text-purple-300">
                UniCloud is a virtual storage abstraction layer, not a physical replacement or merger for Google Drive.
              </p>
              <p>
                Google Drive quotas are never physically combined. UniCloud creates a virtual filesystem layer that maintains
                the metadata and mappings necessary to present files across separate accounts as one unified virtual storage pool.
              </p>
            </div>

            <div className="font-mono text-xs bg-[#07070d]/90 text-slate-200 p-4 rounded-xl border border-white/10 overflow-x-auto">
              <pre>{`UniCloud User
      |
      v
UniCloud Virtual Filesystem & Metadata Layer
      |
      +-------------------+-------------------+
      |                   |                   |
      v                   v                   v
Google Drive #01     Google Drive #02     Google Drive #03
(15 GB Quota)        (15 GB Quota)        (15 GB Quota)
      |                   |                   |
      v                   v                   v
   Files               Files               Files`}</pre>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-xl space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-400" />
                Zero-Token Client Exposure
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Google OAuth client secrets and refresh tokens are strictly restricted to the server.
                The browser never sees or stores refresh tokens. At rest, credentials are encrypted via AES-256-GCM.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-xl space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-purple-400" />
                Dynamic Upload Routing
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Incoming uploads are evaluated by the Upload Router and directed to the account with the highest available
                free space or best capacity balance, complete with resumable chunking for files &gt;5MB.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: PostgreSQL Schema */}
      {activeTab === 'schema' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Database className="h-5 w-5 text-purple-400" />
                PostgreSQL Relational Entities (src/db/schema.sql)
              </h2>
              <span className="text-xs font-mono text-slate-400">PostgreSQL 14+ / Supabase</span>
            </div>

            <div className="space-y-4 text-xs">
              {[
                {
                  table: 'users',
                  desc: 'Root user account holding identity and virtual drive pool ownership.',
                  keys: 'id (UUID PK), email (UNIQUE), display_name, created_at, updated_at',
                },
                {
                  table: 'storage_accounts',
                  desc: 'Connected Google Drive accounts with encrypted OAuth credentials and quota trackers.',
                  keys: 'id (UUID PK), user_id (FK), provider, provider_account_id, email, encrypted_refresh_token, token_iv, token_auth_tag, total_bytes, used_bytes, free_bytes, status',
                },
                {
                  table: 'virtual_folders',
                  desc: 'Logical directories in the virtual filesystem hierarchy.',
                  keys: 'id (UUID PK), user_id (FK), parent_id (FK self), storage_account_id (FK), name, is_starred, is_trashed',
                },
                {
                  table: 'virtual_files',
                  desc: 'Core metadata mapping virtual files to physical Google Drive file IDs.',
                  keys: 'id (UUID PK), user_id (FK), storage_account_id (FK), parent_id (FK), provider_file_id, name, mime_type, size_bytes, md5_checksum, web_url, synced_at',
                },
                {
                  table: 'upload_jobs',
                  desc: 'Tracks upload routing decisions, chunk progress, and resumable session URLs.',
                  keys: 'id (UUID PK), user_id (FK), storage_account_id (FK), target_folder_id (FK), status, routing_strategy, bytes_uploaded, total_size_bytes',
                },
              ].map((item) => (
                <div key={item.table} className="p-4 rounded-xl bg-white/[0.03] border border-white/10 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-purple-400">{item.table}</span>
                    <span className="text-[10px] uppercase font-bold text-slate-400">Table</span>
                  </div>
                  <p className="text-slate-300">{item.desc}</p>
                  <p className="font-mono text-[11px] text-slate-400 pt-1">Columns: {item.keys}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Storage Provider */}
      {activeTab === 'provider' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Terminal className="h-5 w-5 text-purple-400" />
              StorageProvider Interface Contract
            </h2>
            <p className="text-xs text-slate-400">
              Defined in <code className="font-mono bg-white/10 px-1 py-0.5 rounded text-purple-300 border border-white/10">src/types/provider.ts</code>.
              Decouples the virtual filesystem from Google Drive API v3 specifics.
            </p>

            <div className="font-mono text-xs bg-[#07070d]/90 text-purple-200/90 p-4 rounded-xl border border-white/10 overflow-x-auto">
              <pre>{`export interface StorageProvider {
  readonly providerType: ProviderType;
  refreshAuthentication(refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number }>;
  getStorageQuota(accessToken: string): Promise<StorageQuota>;
  listFiles(accessToken: string, options?: ProviderFileListOptions): Promise<ProviderFileListResult>;
  getFileMetadata(accessToken: string, providerFileId: string): Promise<ProviderFileMetadata>;
  createFolder(accessToken: string, name: string, parentFolderId?: string): Promise<ProviderFileMetadata>;
  initiateResumableUpload(accessToken: string, metadata: ResumableInit): Promise<ResumableUploadSession>;
  deleteFile(accessToken: string, providerFileId: string, permanent?: boolean): Promise<void>;
  renameFile(accessToken: string, providerFileId: string, newName: string): Promise<ProviderFileMetadata>;
  moveFile(accessToken: string, providerFileId: string, targetFolderId: string): Promise<ProviderFileMetadata>;
  getDownloadUrl(accessToken: string, providerFileId: string): Promise<string>;
  checkHealth(accessToken: string): Promise<ProviderHealthCheckResult>;
}`}</pre>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Roadmap & Safety */}
      {activeTab === 'roadmap' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              Multi-Phase Implementation Plan
            </h2>

            <div className="space-y-3 text-xs">
              {[
                { phase: 'Phase 0 (Current)', title: 'Master Architecture & Foundation', done: true, notes: 'Schema DDL, StorageProvider abstraction, AES encryption, UI shell, Express/Vite server.' },
                { phase: 'Phase 1', title: 'Database Setup & User Authentication', done: false, notes: 'Connect PostgreSQL/Supabase, create user sessions, implement user profile boundaries.' },
                { phase: 'Phase 2', title: 'Google OAuth 2.0 & Drive Connection', done: false, notes: 'Multi-account server-side OAuth flow, token encryption at rest, live quota retrieval.' },
                { phase: 'Phase 3', title: 'Virtual Filesystem Delta Synchronization', done: false, notes: 'Sync Google Drive changes to virtual_files and virtual_folders; implement file rename/trash.' },
                { phase: 'Phase 4', title: 'Resumable Upload Engine & Routing', done: false, notes: 'Direct chunked uploads to Google Drive with automated quota balancer.' },
                { phase: 'Phase 5', title: 'Unified Search & Quota Optimization', done: false, notes: 'Cross-account search, trash recovery, and intelligent file relocation.' },
              ].map((p) => (
                <div
                  key={p.phase}
                  className={`p-4 rounded-xl border flex items-start justify-between gap-4 backdrop-blur-md ${
                    p.done ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/[0.03] border-white/10'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${p.done ? 'text-emerald-300' : 'text-white'}`}>{p.phase}:</span>
                      <span className={`font-semibold ${p.done ? 'text-emerald-200' : 'text-slate-200'}`}>{p.title}</span>
                    </div>
                    <p className="text-slate-400 text-[11px]">{p.notes}</p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                      p.done ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-white/5 text-slate-400 border border-white/10'
                    }`}
                  >
                    {p.done ? 'Completed' : 'Upcoming'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
