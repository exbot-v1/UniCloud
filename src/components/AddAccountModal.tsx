/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Add Google Drive Account Modal (Phase 2 Implementation)
 * 
 * Connects real Google Drive accounts using Google OAuth 2.0.
 * Refreshes pool capacity and persists metadata in PostgreSQL.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  ShieldCheck,
  UserCheck,
  LogIn,
} from 'lucide-react';
import { UserPublicProfile } from '../types/auth';
import { StorageAccount } from '../types/account';

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserPublicProfile | null;
  onOpenAuth: () => void;
  onAccountConnected: (account: StorageAccount) => void;
}

interface OAuthConfig {
  isConfigured: boolean;
  clientIdAvailable: boolean;
  redirectUri: string;
  requiredScopes: string[];
}

export const AddAccountModal: React.FC<AddAccountModalProps> = ({
  isOpen,
  onClose,
  user,
  onOpenAuth,
  onAccountConnected,
}) => {
  const [config, setConfig] = useState<OAuthConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectedAccount, setConnectedAccount] = useState<StorageAccount | null>(null);

  // Fetch Google OAuth readiness on open
  const fetchConfig = useCallback(async () => {
    setLoadingConfig(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/accounts/google/config');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setConfig(json.data);
          return;
        }
      }
      setConfig({
        isConfigured: false,
        clientIdAvailable: false,
        redirectUri: `${window.location.origin}/api/accounts/google/callback`,
        requiredScopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/drive.metadata.readonly',
          'https://www.googleapis.com/auth/drive.file',
        ],
      });
    } catch {
      setConfig({
        isConfigured: false,
        clientIdAvailable: false,
        redirectUri: `${window.location.origin}/api/accounts/google/callback`,
        requiredScopes: [],
      });
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setConnectedAccount(null);
      setErrorMessage(null);
      setConnecting(false);
      fetchConfig();
    }
  }, [isOpen, fetchConfig]);

  // Handle postMessage communication from OAuth callback popup
  useEffect(() => {
    if (!isOpen) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_ACCOUNT_CONNECTED' && event.data.account) {
        const newAccount = event.data.account as StorageAccount;
        setConnectedAccount(newAccount);
        setConnecting(false);
        setErrorMessage(null);
        onAccountConnected(newAccount);
        setTimeout(() => {
          onClose();
        }, 1800);
      } else if (event.data?.type === 'GOOGLE_ACCOUNT_ERROR') {
        setErrorMessage(event.data.message || 'Google authorization sequence was cancelled or failed.');
        setConnecting(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isOpen, onAccountConnected, onClose]);

  const handleStartOAuth = () => {
    if (!user) {
      onOpenAuth();
      return;
    }

    setConnecting(true);
    setErrorMessage(null);

    const connectUrl = '/api/accounts/google/connect';

    const width = 600;
    const height = 700;
    const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);

    const popup = window.open(
      connectUrl,
      'unicloud_google_oauth',
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,status=yes`
    );

    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      // Popup blocked by browser: fallback to full-page navigation
      window.location.href = connectUrl;
      return;
    }

    // Monitor for user manually closing popup window
    const pollTimer = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollTimer);
        setConnecting((prev) => {
          if (prev) {
            // Re-fetch config to check if session linked
            fetchConfig();
          }
          return false;
        });
      }
    }, 1000);
  };

  const handleCopyUri = () => {
    if (!config?.redirectUri) return;
    navigator.clipboard.writeText(config.redirectUri);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 dark:bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-5 animate-in fade-in zoom-in-95 duration-150 text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Connect Google Drive Account</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Add storage capacity to your UniCloud unified pool</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Authentication Requirement Check */}
        {!user && (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-900 dark:text-amber-300">UniCloud Account Required</p>
                <p className="text-xs text-amber-800 dark:text-amber-400 mt-0.5 leading-relaxed">
                  Sign in or register your UniCloud user account first so connected Google Drive accounts are safely bound to your account.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                onClose();
                onOpenAuth();
              }}
              className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Sign In / Create Account</span>
            </button>
          </div>
        )}

        {/* Success Banner */}
        {connectedAccount && (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-start gap-3 animate-in fade-in">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-300">Account Connected Successfully!</p>
              <p className="text-xs text-emerald-800 dark:text-emerald-400 mt-0.5">
                <strong>{connectedAccount.email}</strong> is now pooling capacity into your storage. Closing...
              </p>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div className="p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-rose-900 dark:text-rose-300">Connection Failed</p>
              <p className="text-xs text-rose-800 dark:text-rose-400 mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Configuration Status & Instructions */}
        {loadingConfig ? (
          <div className="py-8 text-center text-slate-500 dark:text-slate-400 text-xs flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
            <span>Checking Google OAuth configuration...</span>
          </div>
        ) : config && !config.isConfigured ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span>Google OAuth Credentials Needed</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                To connect real Google Drive accounts, provide your Google Cloud OAuth 2.0 Web Client credentials in your environment:
              </p>
              <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-slate-700 dark:text-slate-300 space-y-1">
                <div>GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com</div>
                <div>GOOGLE_CLIENT_SECRET=GOCSPX-your_client_secret</div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Authorized Redirect URI:</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={config.redirectUri}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 font-mono select-all focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={handleCopyUri}
                  className="px-3 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 transition-colors shrink-0 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  {copiedUri ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedUri ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Add this exact URI to your Google Cloud Console &gt; Credentials &gt; Authorized redirect URIs.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/60 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-blue-900 dark:text-blue-300">
                <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>Multi-Account Storage</span>
              </div>
              <p className="leading-relaxed text-slate-600 dark:text-slate-300">
                UniCloud requests minimal scopes required to inspect quotas and manage files. Tokens are encrypted server-side and never exposed to the client browser.
              </p>
            </div>

            {/* Connect Button */}
            <div className="pt-2">
              <button
                type="button"
                id="btn-google-oauth-launch"
                disabled={connecting || Boolean(connectedAccount) || !user}
                onClick={handleStartOAuth}
                className="w-full py-2.5 px-4 bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 rounded-xl text-sm font-medium shadow-xs transition-all flex items-center justify-center gap-3 cursor-pointer"
              >
                {connecting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-slate-700 dark:text-slate-300" />
                    <span>Authorizing with Google...</span>
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>Connect Google Drive</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-1">
              <span>Unlimited accounts per user</span>
              <span>Google Drive v3 API</span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
