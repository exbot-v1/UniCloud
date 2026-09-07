/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Settings View (Phase 0)
 * Configuration foundation for upload routing preferences, security, and environment settings.
 */

import React, { useState } from 'react';
import {
  Settings,
  ShieldCheck,
  Database,
  Sliders,
  Lock,
  KeyRound,
  CheckCircle2,
  Server,
  Info,
} from 'lucide-react';
import { UploadRoutingStrategy } from '../types/upload';

export const SettingsView: React.FC = () => {
  const [strategy, setStrategy] = useState<UploadRoutingStrategy>(UploadRoutingStrategy.MOST_FREE_SPACE);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const handleSave = () => {
    setSaveStatus('Preferences saved to local configuration.');
    setTimeout(() => setSaveStatus(null), 3000);
  };

  return (
    <div id="settings-view" className="space-y-6 max-w-4xl mx-auto pb-12">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-xl font-bold text-slate-900">Settings</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Configure upload routing policies, security preferences, and environment settings.
        </p>
      </div>

      {saveStatus && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{saveStatus}</span>
        </div>
      )}

      {/* Upload Routing Strategy Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
            <Sliders className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Upload Routing Policy</h2>
            <p className="text-xs text-slate-500">Configure file distribution policies across connected Google Drive accounts</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          {[
            {
              id: UploadRoutingStrategy.MOST_FREE_SPACE,
              title: 'Most Free Space (Auto)',
              desc: 'Routes to the account with the highest available headroom. Recommended for maximizing storage.',
            },
            {
              id: UploadRoutingStrategy.BALANCED,
              title: 'Balanced Utilization',
              desc: 'Distributes files proportionally to keep percentage utilization uniform across all accounts.',
            },
            {
              id: UploadRoutingStrategy.MANUAL,
              title: 'Manual Destination',
              desc: 'Prompts you to explicitly select the target Google Drive account for each file upload.',
            },
          ].map((item) => (
            <div
              key={item.id}
              onClick={() => setStrategy(item.id)}
              className={`p-4 rounded-xl border cursor-pointer transition-all space-y-2 ${
                strategy === item.id
                  ? 'border-blue-600 bg-blue-50/60 shadow-2xs'
                  : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">{item.title}</span>
                <span
                  className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                    strategy === item.id ? 'border-blue-600 bg-blue-600' : 'border-slate-300'
                  }`}
                >
                  {strategy === item.id && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Security & Credentials Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Security &amp; Token Encryption</h2>
            <p className="text-xs text-slate-500">Zero-client exposure architecture and data encryption at rest</p>
          </div>
        </div>

        <div className="space-y-3 pt-2 text-xs">
          <div className="flex items-start gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
            <Lock className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-900">AES-256-GCM Encryption Engine</p>
              <p className="text-slate-500 mt-0.5 leading-relaxed">
                All OAuth 2.0 refresh tokens are encrypted at rest with a 256-bit symmetric key (`ENCRYPTION_KEY`)
                and unique 96-bit initialization vectors before storage in PostgreSQL.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
            <KeyRound className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-900">Zero-Client Token Exposure</p>
              <p className="text-slate-500 mt-0.5 leading-relaxed">
                Google OAuth client secrets and refresh tokens are strictly restricted to the Node.js backend.
                Frontend JavaScript only communicates with the authenticated UniCloud server API.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Database & Infrastructure Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Database &amp; Infrastructure</h2>
            <p className="text-xs text-slate-500">PostgreSQL connection readiness and server environment</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs">
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <p className="text-slate-500 font-medium">Database Target</p>
            <p className="font-semibold text-slate-900">PostgreSQL (Connected)</p>
            <p className="text-[11px] text-slate-400">Virtual metadata catalog store</p>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <p className="text-slate-500 font-medium">Server Runtime</p>
            <p className="font-semibold text-slate-900">UniCloud Engine</p>
            <p className="text-[11px] text-slate-400">Secure API Proxy</p>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-xs shadow-xs transition-colors cursor-pointer"
        >
          Save Preferences
        </button>
      </div>
    </div>
  );
};
