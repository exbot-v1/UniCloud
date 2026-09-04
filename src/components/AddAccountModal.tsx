/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Add Google Drive Account Modal (Phase 0)
 * Details the upcoming Phase 2 OAuth connection architecture without simulating fake auth.
 */

import React from 'react';
import {
  X,
  Lock,
  ArrowRight,
  ShieldCheck,
  HardDrive,
  Info,
  CheckCircle2,
} from 'lucide-react';

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AddAccountModal: React.FC<AddAccountModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#090910]/95 backdrop-blur-2xl rounded-3xl p-6 shadow-2xl border border-white/15 space-y-5 animate-in fade-in zoom-in-95 duration-150 text-slate-100">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-purple-600 to-blue-600 text-white shadow-md shadow-purple-500/20 border border-white/10">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Connect Google Drive Account</h3>
              <p className="text-xs text-slate-400">Multi-Account Google OAuth 2.0 Architecture</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Phase Notice */}
        <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-purple-200 text-xs flex items-start gap-2.5">
          <Info className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Scheduled for Phase 2:</span> Real Google OAuth 2.0 credential exchange and Drive API v3
            permission granting will be implemented in Phase 2. As per architectural guidelines, no simulated or fake OAuth logins are generated.
          </div>
        </div>

        {/* Architecture Sequence Flow */}
        <div className="space-y-2 text-xs">
          <p className="font-bold text-white">Server-Side Multi-Account OAuth Flow (Phase 2):</p>
          <div className="p-3.5 bg-white/[0.04] rounded-2xl border border-white/10 space-y-2 font-mono text-[11px] text-slate-300">
            <div className="flex items-center gap-2">
              <span className="font-bold text-purple-400">1.</span>
              <span>Client clicks &quot;Connect Account&quot;</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-purple-400">2.</span>
              <span>Redirect to Google OAuth consent screen</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-purple-400">3.</span>
              <span>Server-side code exchange via /api/auth/google/callback</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-purple-400">4.</span>
              <span>AES-256-GCM encryption of refresh token</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-purple-400">5.</span>
              <span>Storage in PostgreSQL `storage_accounts` table</span>
            </div>
          </div>
        </div>

        {/* Security Checklist */}
        <div className="space-y-2 text-xs">
          <p className="font-bold text-white">Security Safeguards:</p>
          <div className="space-y-1.5 text-slate-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>Zero-token exposure: Refresh tokens never touch the browser</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>Unlimited accounts per user without hardcoded ceilings</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>Real-time quota monitoring via Google Drive v3 `about.get`</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white rounded-xl text-xs font-semibold shadow-lg shadow-purple-500/25 border border-purple-400/30 transition-all"
          >
            Acknowledge & Close
          </button>
        </div>
      </div>
    </div>
  );
};
