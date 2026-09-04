/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud PostgreSQL Database Entities & Schema Mapping
 */

export interface DbUser {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbStorageAccount {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string;
  token_iv: string;
  token_auth_tag: string;
  token_expires_at: string | null;
  total_bytes: string | number;
  used_bytes: string | number;
  free_bytes: string | number;
  status: string;
  is_enabled: boolean;
  error_message: string | null;
  last_synced_at: string | null;
  last_health_check_at: string | null;
  provider_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbVirtualFolder {
  id: string;
  user_id: string;
  parent_id: string | null;
  storage_account_id: string | null;
  provider: string | null;
  provider_folder_id: string | null;
  name: string;
  is_starred: boolean;
  is_trashed: boolean;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbVirtualFile {
  id: string;
  user_id: string;
  storage_account_id: string;
  parent_id: string | null;
  provider: string;
  provider_file_id: string;
  name: string;
  mime_type: string;
  size_bytes: string | number;
  md5_checksum: string | null;
  web_url: string | null;
  thumbnail_url: string | null;
  is_starred: boolean;
  is_trashed: boolean;
  trashed_at: string | null;
  provider_created_at: string | null;
  provider_modified_at: string | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface DbUploadJob {
  id: string;
  user_id: string;
  storage_account_id: string | null;
  target_folder_id: string | null;
  file_name: string;
  mime_type: string;
  total_size_bytes: string | number;
  bytes_uploaded: string | number;
  status: string;
  routing_strategy: string;
  routing_reason: string | null;
  resumable_session_url: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface DbSyncHistory {
  id: string;
  user_id: string;
  storage_account_id: string;
  status: string;
  files_discovered: number;
  files_added: number;
  files_updated: number;
  files_removed: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export const TableNames = {
  USERS: 'users',
  STORAGE_ACCOUNTS: 'storage_accounts',
  VIRTUAL_FOLDERS: 'virtual_folders',
  VIRTUAL_FILES: 'virtual_files',
  UPLOAD_JOBS: 'upload_jobs',
  SYNC_HISTORY: 'sync_history',
} as const;
