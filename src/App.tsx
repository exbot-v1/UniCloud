/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Primary Application Shell (Phase 1)
 * Unified Virtual Cloud Storage Layer across multiple Google Drive accounts.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Sidebar, ActiveNavTab } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { FilesView } from './components/FilesView';
import { AccountsView } from './components/AccountsView';
import { SettingsView } from './components/SettingsView';
import { SpecView } from './components/SpecView';
import { UploadModal } from './components/UploadModal';
import { AddAccountModal } from './components/AddAccountModal';
import { AuthModal } from './components/AuthModal';
import {
  DEMO_STORAGE_ACCOUNTS,
  DEMO_VIRTUAL_FILES,
  DEMO_VIRTUAL_FOLDERS,
} from './data/mockData';
import { calculateStoragePoolMetrics } from './lib/storageMetrics';
import { authFetch, clearSessionToken, setSessionToken } from './lib/api';
import { StorageAccount, StoragePoolSummary } from './types/account';
import { UserPublicProfile } from './types/auth';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveNavTab>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Authenticated user state
  const [user, setUser] = useState<UserPublicProfile | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // Real backend storage pool state
  const [realAccounts, setRealAccounts] = useState<StorageAccount[] | null>(null);
  const [realPoolSummary, setRealPoolSummary] = useState<StoragePoolSummary | null>(null);

  // Check current session from /api/auth/me on mount
  const checkSession = useCallback(async () => {
    setLoadingAuth(true);
    try {
      const res = await authFetch('/api/auth/me');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setUser(json.data);
          loadUserData();
          return;
        }
      }
      setUser(null);
    } catch {
      setUser(null);
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  const loadUserData = useCallback(async () => {
    try {
      const [accRes, poolRes] = await Promise.all([
        authFetch('/api/accounts'),
        authFetch('/api/storage/pool'),
      ]);

      if (accRes.ok) {
        const accJson = await accRes.json();
        if (accJson.success) {
          setRealAccounts(accJson.data);
        }
      }

      if (poolRes.ok) {
        const poolJson = await poolRes.json();
        if (poolJson.success) {
          setRealPoolSummary(poolJson.data);
        }
      }
    } catch (err) {
      console.warn('Could not load user accounts from database', err);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Listen for OAuth postMessage and URL params
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_ACCOUNT_CONNECTED') {
        loadUserData();
      }
    };
    window.addEventListener('message', handleMessage);

    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth_success')) {
      loadUserData();
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return () => window.removeEventListener('message', handleMessage);
  }, [loadUserData]);

  const handleLogout = async () => {
    try {
      await authFetch('/api/auth/logout', {
        method: 'POST',
      });
    } catch (err) {
      console.warn('Logout error', err);
    } finally {
      clearSessionToken();
      setUser(null);
      setRealAccounts(null);
      setRealPoolSummary(null);
    }
  };

  const handleAuthSuccess = (authenticatedUser: UserPublicProfile, token?: string) => {
    if (token) {
      setSessionToken(token);
    }
    setUser(authenticatedUser);
    loadUserData();
  };

  // Determine if using demo accounts (fallback when 0 real accounts connected)
  const isUsingDemoData = useMemo(() => {
    return !realAccounts || realAccounts.length === 0;
  }, [realAccounts]);

  const accounts = useMemo(() => {
    if (realAccounts && realAccounts.length > 0) {
      return realAccounts;
    }
    return DEMO_STORAGE_ACCOUNTS;
  }, [realAccounts]);

  // Calculate storage pool summary dynamically or use backend response
  const poolSummary = useMemo(() => {
    if (realPoolSummary && realAccounts && realAccounts.length > 0) {
      return realPoolSummary;
    }
    return calculateStoragePoolMetrics(accounts);
  }, [realPoolSummary, realAccounts, accounts]);

  // Filter virtual files for specific views
  const recentFiles = useMemo(() => {
    return [...DEMO_VIRTUAL_FILES].sort(
      (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    );
  }, []);

  const starredFiles = useMemo(() => {
    return DEMO_VIRTUAL_FILES.filter((f) => f.isStarred);
  }, []);

  const trashedFiles = useMemo(() => {
    return DEMO_VIRTUAL_FILES.filter((f) => f.isTrashed);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0e1117] text-slate-100 font-sans antialiased relative selection:bg-cyan-500/25 selection:text-cyan-200">
      {/* Navigation Sidebar (Desktop) */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          setIsMobileSidebarOpen(false);
        }}
        poolSummary={poolSummary}
        onOpenAddAccount={() => setIsAddAccountModalOpen(true)}
        className="hidden md:flex z-10"
        isDemoData={isUsingDemoData}
      />

      {/* Navigation Drawer (Mobile) */}
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          <Sidebar
            activeTab={activeTab}
            onSelectTab={(tab) => {
              setActiveTab(tab);
              setIsMobileSidebarOpen(false);
            }}
            poolSummary={poolSummary}
            onOpenAddAccount={() => {
              setIsAddAccountModalOpen(true);
              setIsMobileSidebarOpen(false);
            }}
            className="relative z-10 w-72 bg-[#12161f] border-r border-[#262c36]"
            isDemoData={isUsingDemoData}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden z-10">
        {/* Top Header */}
        <Header
          onToggleSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onOpenUpload={() => setIsUploadModalOpen(true)}
          poolSummary={poolSummary}
          user={user}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onLogout={handleLogout}
        />

        {/* Scrollable Main View */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
          {activeTab === 'dashboard' && (
            <DashboardView
              poolSummary={poolSummary}
              recentFiles={recentFiles}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              onOpenAddAccount={() => setIsAddAccountModalOpen(true)}
              onNavigateFiles={() => setActiveTab('files')}
              onNavigateAccounts={() => setActiveTab('accounts')}
              isDemoData={isUsingDemoData}
            />
          )}

          {activeTab === 'files' && (
            <FilesView
              folders={DEMO_VIRTUAL_FOLDERS}
              files={DEMO_VIRTUAL_FILES}
              accounts={accounts}
              searchQuery={searchQuery}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              tabTitle="My Files"
            />
          )}

          {activeTab === 'recent' && (
            <FilesView
              folders={[]}
              files={recentFiles}
              accounts={accounts}
              searchQuery={searchQuery}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              tabTitle="Recent Files"
            />
          )}

          {activeTab === 'starred' && (
            <FilesView
              folders={DEMO_VIRTUAL_FOLDERS.filter((f) => f.isStarred)}
              files={starredFiles}
              accounts={accounts}
              searchQuery={searchQuery}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              tabTitle="Starred Items"
            />
          )}

          {activeTab === 'trash' && (
            <FilesView
              folders={[]}
              files={trashedFiles}
              accounts={accounts}
              searchQuery={searchQuery}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              tabTitle="Virtual Trash"
            />
          )}

          {activeTab === 'accounts' && (
            <AccountsView
              poolSummary={poolSummary}
              onOpenAddAccount={() => setIsAddAccountModalOpen(true)}
              onRefreshAccounts={loadUserData}
              isDemoData={isUsingDemoData}
            />
          )}

          {activeTab === 'spec' && <SpecView />}

          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* User Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />

      {/* Upload Routing Simulator Modal */}
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        poolSummary={poolSummary}
      />

      {/* Connect Account Architectural Modal */}
      <AddAccountModal
        isOpen={isAddAccountModalOpen}
        onClose={() => setIsAddAccountModalOpen(false)}
        user={user}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onAccountConnected={() => loadUserData()}
      />
    </div>
  );
}
