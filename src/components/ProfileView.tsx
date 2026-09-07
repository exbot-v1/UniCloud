/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud User Profile View
 * Displays authenticated user identity, aggregate storage capacity metrics,
 * contributing Google Drive accounts, and session management.
 */

import React, { useState } from 'react';
import {
  User as UserIcon,
  Mail,
  Calendar,
  HardDrive,
  CheckCircle2,
  Clock,
  AlertTriangle,
  LogOut,
  Plus,
  Layers,
  ShieldCheck,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { UserPublicProfile } from '../types/auth';
import { StorageAccount, StoragePoolSummary, AccountStatus } from '../types/account';
import { formatBytes, formatDate } from '../lib/formatters';

interface ProfileViewProps {
  user: UserPublicProfile | null;
  accounts: StorageAccount[];
  poolSummary: StoragePoolSummary;
  onOpenAddAccount: () => void;
  onLogout: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  user,
  accounts,
  poolSummary,
  onOpenAddAccount,
  onLogout,
}) => {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const getInitials = () => {
    if (!user) return '??';
    if (user.displayName) {
      return user.displayName.slice(0, 2).toUpperCase();
    }
    return user.email.slice(0, 2).toUpperCase();
  };

  const handleConfirmLogout = () => {
    setIsLoggingOut(true);
    onLogout();
  };

  return (
    <div id="profile-view" className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Page Title & Sign Out */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Profile &amp; Account Overview
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage your personal profile, authenticated session, and unified storage pool.
          </p>
        </div>
        <button
          onClick={() => setShowLogoutConfirm(true)}
          id="btn-profile-logout"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 bg-white dark:bg-slate-900 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-800 hover:border-rose-200 dark:hover:border-rose-900/60 shadow-2xs transition-all self-start sm:self-auto cursor-pointer"
        >
          <LogOut className="h-4 w-4 text-rose-500" />
          <span>Sign Out</span>
        </button>
      </div>

      {/* User Information Card */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="h-14 w-14 rounded-full bg-blue-50 dark:bg-blue-950/70 border border-blue-100 dark:border-blue-900 flex items-center justify-center text-blue-700 dark:text-blue-300 text-lg font-bold shadow-2xs shrink-0">
            {getInitials()}
          </div>
          <div className="space-y-1.5 flex-1 min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              {user?.displayName || user?.email.split('@')[0] || 'User Profile'}
            </h2>
            <div className="flex flex-wrap items-center gap-y-1.5 gap-x-4 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                <Mail className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                {user?.email || 'No email associated'}
              </span>
              {user?.createdAt && (
                <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                  <Calendar className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                  Member since {formatDate(user.createdAt)}
                </span>
              )}
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <ShieldCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                Authenticated Session
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Aggregate Storage Pool Summary */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/70 border border-blue-100 dark:border-blue-900 text-blue-600 dark:text-blue-400">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Unified Storage Capacity
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Combined capacity aggregated across {accounts.length} connected Google Drive {accounts.length === 1 ? 'account' : 'accounts'}
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
            {poolSummary.usagePercentage}% utilized
          </span>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2 pt-1">
          <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-blue-600 dark:bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, poolSummary.usagePercentage)}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span>{formatBytes(poolSummary.totalUsedBytes)} consumed</span>
            <span>{formatBytes(poolSummary.totalCapacityBytes)} total capacity</span>
          </div>
        </div>

        {/* Metric Breakdown */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="p-4 rounded-lg bg-slate-50/70 dark:bg-slate-850/70 border border-slate-200 dark:border-slate-800">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Connected Accounts</p>
            <p className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">{accounts.length}</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Google Drive pools</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50/70 dark:bg-slate-850/70 border border-slate-200 dark:border-slate-800">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Consumed Space</p>
            <p className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">{formatBytes(poolSummary.totalUsedBytes)}</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{poolSummary.usagePercentage}% of pool</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50/70 dark:bg-slate-850/70 border border-slate-200 dark:border-slate-800">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Available Headroom</p>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{formatBytes(poolSummary.totalFreeBytes)}</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Ready for file uploads</p>
          </div>
        </div>
      </div>

      {/* Connected Google Drive Accounts Summary */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/70 border border-blue-100 dark:border-blue-900 text-blue-600 dark:text-blue-400">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Contributing Accounts
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Individual Google Drive storage quotas
              </p>
            </div>
          </div>
          <button
            onClick={onOpenAddAccount}
            id="btn-profile-add-account"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg text-xs shadow-xs transition-colors cursor-pointer self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            <span>Connect Google Drive</span>
          </button>
        </div>

        {accounts.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850/60 space-y-3">
            <HardDrive className="h-8 w-8 text-slate-400 dark:text-slate-500 mx-auto" />
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                No Accounts Connected
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                Connect your Google Drive accounts to expand your available pool capacity.
              </p>
            </div>
            <button
              onClick={onOpenAddAccount}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg text-xs shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Connect First Account</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((account) => {
              const isFull = account.quota.usagePercentage > 90;
              const isEnabled = account.isEnabled !== false;

              return (
                <div
                  key={account.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      {account.avatarUrl ? (
                        <img
                          src={account.avatarUrl}
                          alt={account.email}
                          referrerPolicy="no-referrer"
                          className="h-9 w-9 rounded-full border border-slate-200 dark:border-slate-700 object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-blue-50 dark:bg-blue-950/70 border border-blue-100 dark:border-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xs font-bold shrink-0">
                          <HardDrive className="h-4 w-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {account.displayName || account.email}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {account.email}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      {!isEnabled ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700">
                          Paused
                        </span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                            account.status === AccountStatus.ACTIVE
                              ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                              : account.status === AccountStatus.TOKEN_EXPIRED
                              ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                              : 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                          }`}
                        >
                          {account.status === AccountStatus.ACTIVE && <CheckCircle2 className="h-3 w-3" />}
                          {account.status === AccountStatus.TOKEN_EXPIRED && <Clock className="h-3 w-3" />}
                          {account.status === AccountStatus.ERROR && <AlertTriangle className="h-3 w-3" />}
                          {account.status === AccountStatus.ACTIVE ? 'Connected' : account.status}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quota Progress */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>
                        Usage: <strong className="text-slate-800 dark:text-slate-200">{formatBytes(account.quota.usedBytes)}</strong> / {formatBytes(account.quota.totalBytes)}
                      </span>
                      <span className={isFull ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-slate-600 dark:text-slate-400'}>
                        {account.quota.usagePercentage}% utilized
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isFull ? 'bg-amber-500' : 'bg-blue-600 dark:bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(100, account.quota.usagePercentage)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500">
                      <span>Free: {formatBytes(account.quota.freeBytes)}</span>
                      {account.lastSyncedAt && (
                        <span>Last synchronized: {formatDate(account.lastSyncedAt)}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Logout Confirmation Dialog */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 text-slate-900 dark:text-slate-100">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/50">
                <LogOut className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Sign Out?
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Are you sure you want to end your session?
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Your connected Google Drive accounts and virtual files will remain safely configured in your account.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isLoggingOut}
                onClick={() => setShowLogoutConfirm(false)}
                className="px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isLoggingOut}
                onClick={handleConfirmLogout}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isLoggingOut && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
