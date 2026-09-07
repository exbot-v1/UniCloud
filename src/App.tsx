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
import { FilesView } from './components/FilesView';
import { AccountsView } from './components/AccountsView';
import { SettingsView } from './components/SettingsView';
import { ProfileView } from './components/ProfileView';
import { UploadModal } from './components/UploadModal';
import { AddAccountModal } from './components/AddAccountModal';
import { AuthModal } from './components/AuthModal';
import { calculateStoragePoolMetrics } from './lib/storageMetrics';
import { authFetch, clearSessionToken } from './lib/api';
import { StorageAccount, StoragePoolSummary } from './types/account';
import { UserPublicProfile } from './types/auth';
import { VirtualFile } from './types/filesystem';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveNavTab>('files');
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
  const [realRecentFiles, setRealRecentFiles] = useState<VirtualFile[]>([]);

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
      const [accRes, poolRes, filesRes] = await Promise.all([
        authFetch('/api/accounts'),
        authFetch('/api/storage/pool'),
        authFetch('/api/files?folderId=all'),
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

      if (filesRes.ok) {
        const filesJson = await filesRes.json();
        if (filesJson.success && filesJson.data?.files) {
          const sorted = [...filesJson.data.files].sort(
            (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
          );
          setRealRecentFiles(sorted.slice(0, 10));
        } else {
          setRealRecentFiles([]);
        }
      } else {
        setRealRecentFiles([]);
      }
    } catch (err) {
      console.warn('Could not load user accounts from database', err);
    }
  }, []);

  useEffect(() => {
    clearSessionToken();
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
      setRealRecentFiles([]);
    }
  };

  const handleAuthSuccess = (authenticatedUser: UserPublicProfile) => {
    setUser(authenticatedUser);
    loadUserData();
  };

  const accounts = useMemo(() => {
    return realAccounts || [];
  }, [realAccounts]);

  // Calculate storage pool summary dynamically or use backend response
  const poolSummary = useMemo(() => {
    if (realPoolSummary && realAccounts && realAccounts.length > 0) {
      return realPoolSummary;
    }
    return calculateStoragePoolMetrics(accounts);
  }, [realPoolSummary, realAccounts, accounts]);

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
          onNavigateProfile={() => setActiveTab('profile')}
        />

        {/* Scrollable Main View */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
          {activeTab === 'files' && (
            <FilesView
              accounts={realAccounts || []}
              hasConnectedAccounts={Boolean(realAccounts && realAccounts.length > 0)}
              searchQuery={searchQuery}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              onOpenAddAccount={() => setIsAddAccountModalOpen(true)}
              tabTitle="My Files"
              activeView="files"
              isDemoData={false}
              onRefreshStoragePool={loadUserData}
            />
          )}

          {activeTab === 'recent' && (
            <FilesView
              accounts={realAccounts || []}
              hasConnectedAccounts={Boolean(realAccounts && realAccounts.length > 0)}
              searchQuery={searchQuery}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              onOpenAddAccount={() => setIsAddAccountModalOpen(true)}
              tabTitle="Recent Files"
              activeView="recent"
              isDemoData={false}
              onRefreshStoragePool={loadUserData}
            />
          )}

          {activeTab === 'starred' && (
            <FilesView
              accounts={realAccounts || []}
              hasConnectedAccounts={Boolean(realAccounts && realAccounts.length > 0)}
              searchQuery={searchQuery}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              onOpenAddAccount={() => setIsAddAccountModalOpen(true)}
              tabTitle="Starred Items"
              activeView="starred"
              isDemoData={false}
              onRefreshStoragePool={loadUserData}
            />
          )}

          {activeTab === 'trash' && (
            <FilesView
              accounts={realAccounts || []}
              hasConnectedAccounts={Boolean(realAccounts && realAccounts.length > 0)}
              searchQuery={searchQuery}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              onOpenAddAccount={() => setIsAddAccountModalOpen(true)}
              tabTitle="Virtual Trash"
              activeView="trash"
              isDemoData={false}
              onRefreshStoragePool={loadUserData}
            />
          )}

          {activeTab === 'accounts' && (
            <AccountsView
              poolSummary={poolSummary}
              onOpenAddAccount={() => setIsAddAccountModalOpen(true)}
              onRefreshAccounts={loadUserData}
            />
          )}

          {activeTab === 'settings' && <SettingsView />}

          {activeTab === 'profile' && (
            <ProfileView
              user={user}
              accounts={accounts}
              poolSummary={poolSummary}
              onOpenAddAccount={() => setIsAddAccountModalOpen(true)}
              onLogout={handleLogout}
            />
          )}
        </main>
      </div>

      {/* User Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />

      {/* Resumable Upload & Capacity Router Modal (Phase 4) */}
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        poolSummary={poolSummary}
        onUploadSuccess={() => loadUserData()}
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
