/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud User Authentication Modal (Phase 1)
 * 
 * Provides secure Login and Registration interfaces connected directly
 * to the backend Express authentication API with HTTP-only cookies.
 */

import React, { useState } from 'react';
import { X, Lock, Mail, User, ArrowRight, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { UserPublicProfile } from '../types/auth';
import { setSessionToken } from '../lib/api';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: UserPublicProfile, token?: string) => void;
  initialMode?: 'login' | 'register';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  initialMode = 'login',
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const payload = mode === 'register' 
      ? { email, password, displayName: displayName || email.split('@')[0] }
      : { email, password };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Sends & receives HTTP-only cookies
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'Authentication failed. Please check your credentials.');
      }

      if (data.data?.sessionToken) {
        setSessionToken(data.data.sessionToken);
      }

      onAuthSuccess(data.data.user, data.data.sessionToken);
      onClose();
    } catch (err: any) {
      setError(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoLogin = async () => {
    setError(null);
    setLoading(true);

    const testEmail = 'socialdoodle7@gmail.com';
    const testPassword = 'Password123!';

    try {
      // Attempt login
      let res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      });

      let data = await res.json();

      // If user doesn't exist yet, register them automatically
      if (!res.ok) {
        res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email: testEmail,
            password: testPassword,
            displayName: 'socialdoodle7',
          }),
        });
        data = await res.json();
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'Demo authentication failed.');
      }

      if (data.data?.sessionToken) {
        setSessionToken(data.data.sessionToken);
      }

      onAuthSuccess(data.data.user, data.data.sessionToken);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/80 backdrop-blur-xs transition-opacity" 
        onClick={onClose} 
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-md rounded-2xl border border-[#262c36] bg-[#12161f] p-6 shadow-2xl z-10 text-slate-100">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-2 text-slate-400 hover:text-slate-200 hover:bg-[#1a202c] rounded-xl transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-cyan-950/70 border border-cyan-800/60 flex items-center justify-center text-cyan-400">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">
              {mode === 'login' ? 'Sign In to UniCloud' : 'Create UniCloud Account'}
            </h2>
            <p className="text-xs text-slate-400">
              Secure backend identity &amp; tenant isolation
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/40 border border-red-800/50 flex items-start gap-2.5 text-xs text-red-300">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="flex-1 leading-relaxed">{error}</p>
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Display Name</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Alex Miller"
                  className="w-full pl-10 pr-3 py-2 text-sm bg-[#0e1117] text-white border border-[#262c36] focus:border-cyan-500 rounded-xl focus:outline-hidden"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full pl-10 pr-3 py-2 text-sm bg-[#0e1117] text-white border border-[#262c36] focus:border-cyan-500 rounded-xl focus:outline-hidden"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full pl-10 pr-3 py-2 text-sm bg-[#0e1117] text-white border border-[#262c36] focus:border-cyan-500 rounded-xl focus:outline-hidden"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-sm rounded-xl shadow-md shadow-cyan-950/50 flex items-center justify-center gap-2 transition-all"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate-950" />
            ) : (
              <>
                <span>{mode === 'login' ? 'Sign In' : 'Create Account'}</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        {/* Quick Demo Login Option */}
        <div className="mt-5 pt-5 border-t border-[#262c36] space-y-3">
          <button
            type="button"
            onClick={handleQuickDemoLogin}
            disabled={loading}
            className="w-full py-2 px-3 bg-[#161b24] hover:bg-[#1a202c] border border-[#262c36] text-xs font-semibold text-slate-300 rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
            <span>Sign in as Test User (socialdoodle7)</span>
          </button>

          {/* Toggle Login/Register */}
          <div className="text-center text-xs text-slate-400">
            {mode === 'login' ? (
              <p>
                Don&apos;t have an account?{' '}
                <button
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                  className="text-cyan-400 hover:underline font-semibold"
                >
                  Register here
                </button>
              </p>
            ) : (
              <p>
                Already have an account?{' '}
                <button
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                  className="text-cyan-400 hover:underline font-semibold"
                >
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
