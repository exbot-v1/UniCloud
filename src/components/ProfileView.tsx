/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud User Profile View
 * Displays authenticated user information, aggregate storage pool summary,
 * connected Google Drive accounts, per-account storage usage, and account actions.
 */

import React from 'react';
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
  const getInitials = () => {
    if (!user) return '??';
    if (user.displayName) {
      return user.displayName.slice(0, 2).toUpperCase();
    }
    return user.email.slice(0, 2).toUpperCase();
  };

  return (
    <div id="profile-view" className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Page Title */}
      <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">User Profile &amp; Account</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage your personal profile, connected Google Drive accounts, and storage capacity.
          </p>
        </div>
        <button
          onClick={onLogout}
          id="btn-profile-logout"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium text-rose-600 hover:text-rose-700 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 shadow-2xs transition-all self-start sm:self-auto cursor-pointer"
        >
          <LogOut className="h-4 w-4 text-rose-500" />
          <span>Sign Out</span>
        </button>
      </div>

      {/* User Information Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="h-14 w-14 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-700 text-lg font-bold shadow-2xs shrink-0">
            {getInitials()}
          </div>
          <div className="space-y-1.5 flex-1 min-w-0">
            <h2 className="text-base font-semibold text-slate-900 truncate">
              {user?.displayName || user?.email.split('@')[0] || 'User Profile'}
            </h2>
            <div className="flex flex-wrap items-center gap-y-1.5 gap-x-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5 text-slate-700">
                <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                {user?.email || 'No email associated'}
              </span>
              {user?.createdAt && (
                <span className="inline-flex items-center gap-1.5 text-slate-500">
                  <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  Member since {formatDate(user.createdAt)}
                </span>
              )}
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                <ShieldCheck className="h-3 w-3 text-emerald-600" />
                Authenticated Session
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Aggregate Storage Pool Summary */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-50 border border-blue-100 text-blue-600">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Unified Storage Pool</h3>
              <p className="text-xs text-slate-500">Combined capacity across all connected storage accounts</p>
            </div>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
            {poolSummary.usagePercentage}% utilized
          </span>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2 pt-1">
          <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, poolSummary.usagePercentage)}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-xs text-slate-500 font-medium">
            <span>{formatBytes(poolSummary.totalUsedBytes)} consumed</span>
            <span>{formatBytes(poolSummary.totalCapacityBytes)} total capacity</span>
          </div>
        </div>

        {/* Breakdown Metric Tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-xs font-medium text-slate-500">Connected Accounts</p>
            <p className="text-xl font-bold text-slate-900 mt-1">{accounts.length}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Google Drive accounts</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-xs font-medium text-slate-500">Used Storage</p>
            <p className="text-xl font-bold text-slate-900 mt-1">{formatBytes(poolSummary.totalUsedBytes)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{poolSummary.usagePercentage}% of pool</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-xs font-medium text-slate-500">Available Headroom</p>
            <p className="text-xl font-bold text-emerald-700 mt-1">{formatBytes(poolSummary.totalFreeBytes)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Ready for file storage</p>
          </div>
        </div>
      </div>

      {/* Connected Google Drive Accounts */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-50 border border-blue-100 text-blue-600">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Connected Accounts</h3>
              <p className="text-xs text-slate-500">
                {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'} contributing physical storage
              </p>
            </div>
          </div>
          <button
            onClick={onOpenAddAccount}
            id="btn-profile-add-account"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-xs shadow-xs transition-colors cursor-pointer self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            <span>Connect Google Drive</span>
          </button>
        </div>

        {accounts.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50 space-y-3">
            <HardDrive className="h-8 w-8 text-slate-400 mx-auto" />
            <div>
              <p className="text-sm font-semibold text-slate-800">No Storage Accounts Connected</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Connect your Google Drive accounts to start pooling storage capacity.
              </p>
            </div>
            <button
              onClick={onOpenAddAccount}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-xs shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Connect First Account</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((account) => {
              const isFull = account.quota.usagePercentage > 90;
              return (
                <div
                  key={account.id}
                  className="p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50/70 transition-all space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      {account.avatarUrl ? (
                        <img
                          src={account.avatarUrl}
                          alt={account.email}
                          referrerPolicy="no-referrer"
                          className="h-9 w-9 rounded-full border border-slate-200 object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 text-xs font-bold shrink-0">
                          <HardDrive className="h-4 w-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {account.displayName || account.email}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">{account.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                          account.status === AccountStatus.ACTIVE
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : account.status === AccountStatus.TOKEN_EXPIRED
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                      >
                        {account.status === AccountStatus.ACTIVE && <CheckCircle2 className="h-3 w-3" />}
                        {account.status === AccountStatus.TOKEN_EXPIRED && <Clock className="h-3 w-3" />}
                        {account.status === AccountStatus.ERROR && <AlertTriangle className="h-3 w-3" />}
                        {account.status === AccountStatus.ACTIVE ? 'Connected' : account.status}
                      </span>
                    </div>
                  </div>

                  {/* Quota Progress for account */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>
                        Usage: <strong className="text-slate-800">{formatBytes(account.quota.usedBytes)}</strong> / {formatBytes(account.quota.totalBytes)}
                      </span>
                      <span className={isFull ? 'text-amber-600 font-semibold' : 'text-slate-600'}>
                        {account.quota.usagePercentage}% utilized
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isFull ? 'bg-amber-500' : 'bg-blue-600'
                        }`}
                        style={{ width: `${Math.min(100, account.quota.usagePercentage)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400">
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
    </div>
  );
};
