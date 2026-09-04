/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Primary Application Shell (Phase 0)
 * Unified Virtual Cloud Storage Layer across multiple Google Drive accounts.
 */

import React, { useState, useMemo } from 'react';
import { Sidebar, ActiveNavTab } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { FilesView } from './components/FilesView';
import { AccountsView } from './components/AccountsView';
import { SettingsView } from './components/SettingsView';
import { SpecView } from './components/SpecView';
import { UploadModal } from './components/UploadModal';
import { AddAccountModal } from './components/AddAccountModal';
import {
  DEMO_STORAGE_ACCOUNTS,
  DEMO_VIRTUAL_FILES,
  DEMO_VIRTUAL_FOLDERS,
} from './data/mockData';
import { storageService } from './server/services/StorageService';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveNavTab>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);

  // Calculate storage pool summary dynamically
  const poolSummary = useMemo(() => {
    return storageService.calculatePoolMetrics(DEMO_STORAGE_ACCOUNTS);
  }, []);

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
    <div className="flex h-screen w-screen overflow-hidden bg-[#050508] text-slate-100 font-sans antialiased relative selection:bg-purple-500/30 selection:text-purple-200">
      {/* Frosted Glass Ambient Glowing Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-600/25 rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] bg-blue-600/20 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute top-[25%] right-[15%] w-[350px] h-[350px] bg-indigo-500/15 rounded-full blur-[110px] pointer-events-none" />

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
            className="fixed inset-0 bg-black/60 backdrop-blur-md"
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
            className="relative z-10 w-72 bg-[#080810]/95 backdrop-blur-2xl border-r border-white/10"
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
            />
          )}

          {activeTab === 'files' && (
            <FilesView
              folders={DEMO_VIRTUAL_FOLDERS}
              files={DEMO_VIRTUAL_FILES}
              accounts={DEMO_STORAGE_ACCOUNTS}
              searchQuery={searchQuery}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              tabTitle="My Files"
            />
          )}

          {activeTab === 'recent' && (
            <FilesView
              folders={[]}
              files={recentFiles}
              accounts={DEMO_STORAGE_ACCOUNTS}
              searchQuery={searchQuery}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              tabTitle="Recent Files"
            />
          )}

          {activeTab === 'starred' && (
            <FilesView
              folders={DEMO_VIRTUAL_FOLDERS.filter((f) => f.isStarred)}
              files={starredFiles}
              accounts={DEMO_STORAGE_ACCOUNTS}
              searchQuery={searchQuery}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              tabTitle="Starred Items"
            />
          )}

          {activeTab === 'trash' && (
            <FilesView
              folders={[]}
              files={trashedFiles}
              accounts={DEMO_STORAGE_ACCOUNTS}
              searchQuery={searchQuery}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              tabTitle="Virtual Trash"
            />
          )}

          {activeTab === 'accounts' && (
            <AccountsView
              poolSummary={poolSummary}
              onOpenAddAccount={() => setIsAddAccountModalOpen(true)}
            />
          )}

          {activeTab === 'spec' && <SpecView />}

          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>

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
      />
    </div>
  );
}
