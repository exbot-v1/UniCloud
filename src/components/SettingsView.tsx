/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Settings View
 * Production-quality preferences for theme, upload routing policy,
 * file management defaults, and security overview.
 */

import React, { useState, useEffect } from 'react';
import {
  Settings,
  ShieldCheck,
  Sliders,
  Lock,
  KeyRound,
  CheckCircle2,
  Moon,
  Sun,
  LayoutGrid,
  List,
  Check,
  Eye,
  FileCheck,
  Info,
} from 'lucide-react';
import { useTheme, Theme } from '../lib/theme';
import { UploadRoutingStrategy } from '../types/upload';
import { useToast } from './Toast';

export const SettingsView: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const { success } = useToast();

  // Upload routing strategy preference
  const [strategy, setStrategy] = useState<UploadRoutingStrategy>(() => {
    const saved = localStorage.getItem('unicloud_upload_strategy');
    if (saved && Object.values(UploadRoutingStrategy).includes(saved as any)) {
      return saved as UploadRoutingStrategy;
    }
    return UploadRoutingStrategy.MOST_FREE_SPACE;
  });

  // Default files view mode
  const [defaultViewMode, setDefaultViewMode] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('unicloud_default_view') as 'grid' | 'list') || 'list';
  });

  // Confirm before permanent delete
  const [confirmDelete, setConfirmDelete] = useState<boolean>(() => {
    const val = localStorage.getItem('unicloud_confirm_delete');
    return val !== null ? val === 'true' : true;
  });

  // Items per page
  const [pageSize, setPageSize] = useState<number>(() => {
    const val = localStorage.getItem('unicloud_page_size');
    return val ? parseInt(val, 10) : 50;
  });

  const handleSavePreferences = () => {
    localStorage.setItem('unicloud_upload_strategy', strategy);
    localStorage.setItem('unicloud_default_view', defaultViewMode);
    localStorage.setItem('unicloud_confirm_delete', String(confirmDelete));
    localStorage.setItem('unicloud_page_size', String(pageSize));
    success('Settings updated successfully.');
  };

  return (
    <div id="settings-view" className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Top Header */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Settings</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Configure appearance, upload routing policies, and file management preferences.
        </p>
      </div>

      {/* 1. Appearance & Theme Preference */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900">
            {theme === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Appearance</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Customize interface color scheme and readability
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div
            onClick={() => setTheme('dark')}
            className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
              theme === 'dark'
                ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 shadow-2xs ring-1 ring-blue-600/30'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-slate-900 text-slate-100 flex items-center justify-center border border-slate-800">
                <Moon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Dark Mode <span className="text-[10px] text-blue-600 dark:text-blue-400 font-normal">(Default)</span>
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Low-glare contrast for focused work</p>
              </div>
            </div>
            {theme === 'dark' && <Check className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
          </div>

          <div
            onClick={() => setTheme('light')}
            className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
              theme === 'light'
                ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 shadow-2xs ring-1 ring-blue-600/30'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
                <Sun className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Light Mode</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Crisp high-clarity day aesthetic</p>
              </div>
            </div>
            {theme === 'light' && <Check className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
          </div>
        </div>
      </div>

      {/* 2. Upload Routing Strategy Card */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900">
            <Sliders className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Upload Distribution Policy
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configure how incoming files are balanced across your connected Google Drive accounts
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          {[
            {
              id: UploadRoutingStrategy.MOST_FREE_SPACE,
              title: 'Most Free Space (Auto)',
              desc: 'Automatically targets the account with the highest available capacity. Recommended for maximizing storage.',
            },
            {
              id: UploadRoutingStrategy.BALANCED,
              title: 'Balanced Utilization',
              desc: 'Distributes files proportionally to keep percentage utilization even across all accounts.',
            },
            {
              id: UploadRoutingStrategy.MANUAL,
              title: 'Manual Destination',
              desc: 'Prompts you to select a specific Google Drive account when initiating an upload.',
            },
          ].map((item) => (
            <div
              key={item.id}
              onClick={() => setStrategy(item.id)}
              className={`p-4 rounded-xl border cursor-pointer transition-all space-y-2 ${
                strategy === item.id
                  ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 shadow-2xs ring-1 ring-blue-600/30'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {item.title}
                </span>
                <span
                  className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                    strategy === item.id
                      ? 'border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {strategy === item.id && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 3. File Management Preferences */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900">
            <FileCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              File Management Defaults
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Customize default layouts and safety confirmations
            </p>
          </div>
        </div>

        <div className="space-y-3 pt-1 text-xs">
          {/* Default View Mode */}
          <div className="flex items-center justify-between p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50">
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">Default View Mode</p>
              <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                Initial layout when opening file browser
              </p>
            </div>
            <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setDefaultViewMode('list')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  defaultViewMode === 'list'
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <List className="h-3.5 w-3.5" />
                <span>List</span>
              </button>
              <button
                type="button"
                onClick={() => setDefaultViewMode('grid')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  defaultViewMode === 'grid'
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>Grid</span>
              </button>
            </div>
          </div>

          {/* Confirm Permanent Delete Toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50">
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                Confirm Permanent Deletion
              </p>
              <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                Show a safety confirmation dialog before permanently deleting items from trash
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmDelete(!confirmDelete)}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                confirmDelete ? 'bg-blue-600 justify-end' : 'bg-slate-300 dark:bg-slate-700 justify-start'
              }`}
            >
              <span className="bg-white w-4 h-4 rounded-full shadow-md" />
            </button>
          </div>
        </div>
      </div>

      {/* 4. Security & Privacy Overview */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Security &amp; Token Encryption
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Zero-client exposure architecture and data security guarantees
            </p>
          </div>
        </div>

        <div className="space-y-3 pt-1 text-xs">
          <div className="flex items-start gap-3 p-3.5 rounded-lg bg-slate-50/50 dark:bg-slate-850/50 border border-slate-200 dark:border-slate-800">
            <Lock className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                AES-256-GCM Token Encryption
              </p>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed text-[11px]">
                All OAuth refresh tokens are encrypted at rest using 256-bit symmetric AES-GCM
                with unique initialization vectors before storage.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3.5 rounded-lg bg-slate-50/50 dark:bg-slate-850/50 border border-slate-200 dark:border-slate-800">
            <KeyRound className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                Zero Client Token Exposure
              </p>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed text-[11px]">
                Google Drive access tokens and credentials remain strictly contained on the backend.
                The browser client only communicates with the authenticated UniCloud session API.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleSavePreferences}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg text-xs shadow-xs transition-colors cursor-pointer"
        >
          Save Preferences
        </button>
      </div>
    </div>
  );
};
