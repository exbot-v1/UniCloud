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
      <div className="border-b border-white/10 pb-4">
        <h1 className="text-xl font-bold text-white">UniCloud Settings</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Configure upload routing policies, security posture, and infrastructure parameters.
        </p>
      </div>

      {saveStatus && (
        <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{saveStatus}</span>
        </div>
      )}

      {/* Upload Routing Strategy Card */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
            <Sliders className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Autonomous Upload Routing Policy</h2>
            <p className="text-xs text-slate-400">Determines which Google Drive account receives newly uploaded files</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          {[
            {
              id: UploadRoutingStrategy.MOST_FREE_SPACE,
              title: 'Most Free Space (Auto)',
              desc: 'Selects the account with the highest volume of available free bytes. Recommended for maximizing storage headroom.',
            },
            {
              id: UploadRoutingStrategy.BALANCED,
              title: 'Balanced Utilization',
              desc: 'Distributes files proportionally to keep percentage utilization uniform across all connected drives.',
            },
            {
              id: UploadRoutingStrategy.MANUAL,
              title: 'Manual Destination Prompt',
              desc: 'Prompts the user to explicitly select the target Google Drive account for each upload job.',
            },
          ].map((item) => (
            <div
              key={item.id}
              onClick={() => setStrategy(item.id)}
              className={`p-4 rounded-xl border cursor-pointer transition-all space-y-2 backdrop-blur-md ${
                strategy === item.id
                  ? 'border-purple-500 bg-purple-500/15 ring-1 ring-purple-500/50 shadow-md'
                  : 'border-white/10 bg-white/[0.03] hover:border-purple-400/40 hover:bg-white/[0.05]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">{item.title}</span>
                <span
                  className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                    strategy === item.id ? 'border-purple-400 bg-purple-500' : 'border-white/20'
                  }`}
                >
                  {strategy === item.id && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Security & Credentials Card */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Security & Credential Vault</h2>
            <p className="text-xs text-slate-400">Zero-client exposure architecture and data encryption at rest</p>
          </div>
        </div>

        <div className="space-y-3 pt-2 text-xs">
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.04] border border-white/10">
            <Lock className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-200">AES-256-GCM Encryption Engine</p>
              <p className="text-slate-400 mt-0.5 leading-relaxed">
                All OAuth 2.0 refresh tokens are encrypted at rest with a 256-bit symmetric key (`ENCRYPTION_KEY`)
                and unique 96-bit initialization vectors before storage in PostgreSQL.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.04] border border-white/10">
            <KeyRound className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-200">Zero-Client Token Exposure</p>
              <p className="text-slate-400 mt-0.5 leading-relaxed">
                Google OAuth client secrets and refresh tokens are strictly restricted to the Node.js backend.
                Frontend JavaScript only communicates with the UniCloud server API.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Database & Infrastructure Card */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Database & Infrastructure State</h2>
            <p className="text-xs text-slate-400">PostgreSQL connection readiness and server environment</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs">
          <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-1">
            <p className="text-slate-400 font-medium">Database Target</p>
            <p className="font-bold text-white">PostgreSQL / Supabase (Phase 1 Ready)</p>
            <p className="text-[11px] text-slate-400">Schema defined in `src/db/schema.sql`</p>
          </div>

          <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-1">
            <p className="text-slate-400 font-medium">Server Runtime</p>
            <p className="font-bold text-white">Node.js Express + Vite Middleware</p>
            <p className="text-[11px] text-slate-400">Port 3000 • Ingress Reverse Proxy</p>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          className="px-5 py-2.5 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl text-xs shadow-lg shadow-purple-500/25 border border-purple-400/30 transition-all"
        >
          Save Preferences
        </button>
      </div>
    </div>
  );
};
