-- =============================================================================
-- UNICLOUD: MASTER POSTGRESQL DATABASE SCHEMA (PHASE 0 FOUNDATION)
-- Compatible with PostgreSQL 14+ / Supabase
-- =============================================================================

-- Enable UUID extension for cryptographically secure, non-sequential IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. USERS TABLE
-- Represents the primary UniCloud account owner
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    display_name VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- =============================================================================
-- 1B. USER_SESSIONS TABLE
-- Tracks active authenticated user sessions via cryptographically secure hashes
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

-- =============================================================================
-- 2. STORAGE_ACCOUNTS TABLE
-- Represents individual connected Google Drive accounts belonging to a user
-- Never store plaintext tokens; credentials stored as AES-256-GCM encrypted bundles
-- =============================================================================
CREATE TABLE IF NOT EXISTS storage_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'google_drive',
    provider_account_id VARCHAR(255) NOT NULL, -- Google sub / unique ID
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    avatar_url TEXT,

    -- Security: Encrypted OAuth token storage
    encrypted_access_token TEXT,
    encrypted_refresh_token TEXT NOT NULL,
    token_iv VARCHAR(64) NOT NULL,
    token_auth_tag VARCHAR(64) NOT NULL,
    token_expires_at TIMESTAMPTZ,

    -- Quota metadata (in bytes)
    total_bytes BIGINT NOT NULL DEFAULT 0,
    used_bytes BIGINT NOT NULL DEFAULT 0,
    free_bytes BIGINT NOT NULL DEFAULT 0,

    -- Account Health & State
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, token_expired, revoked, quota_full, error
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    error_message TEXT,
    last_synced_at TIMESTAMPTZ,
    last_health_check_at TIMESTAMPTZ,

    -- Provider specific metadata (JSONB for flexibility)
    drive_change_token TEXT, -- Persisted Google Drive change token for delta sync (Phase 3)
    provider_metadata JSONB DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Ensure a user doesn't link the exact same Google account twice
    CONSTRAINT uq_user_provider_account UNIQUE(user_id, provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_storage_accounts_user ON storage_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_storage_accounts_status ON storage_accounts(status);
CREATE INDEX IF NOT EXISTS idx_storage_accounts_free_bytes ON storage_accounts(free_bytes DESC);

-- =============================================================================
-- 3. VIRTUAL_FOLDERS TABLE
-- Represents logical directories in the virtual filesystem
-- A folder can be purely virtual or mapped to a physical Google Drive folder
-- =============================================================================
CREATE TABLE IF NOT EXISTS virtual_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES virtual_folders(id) ON DELETE CASCADE,
    
    -- Optional mapping to physical Google Drive folder
    storage_account_id UUID REFERENCES storage_accounts(id) ON DELETE SET NULL,
    provider VARCHAR(50),
    provider_folder_id VARCHAR(255),

    name VARCHAR(255) NOT NULL,
    is_starred BOOLEAN NOT NULL DEFAULT FALSE,
    is_trashed BOOLEAN NOT NULL DEFAULT FALSE,
    trashed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate provider folders per storage account
    CONSTRAINT uq_virtual_folders_account_provider UNIQUE (storage_account_id, provider_folder_id)
);

CREATE INDEX IF NOT EXISTS idx_virtual_folders_user_parent ON virtual_folders(user_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_virtual_folders_trashed ON virtual_folders(user_id, is_trashed);
CREATE INDEX IF NOT EXISTS idx_virtual_folders_starred ON virtual_folders(user_id, is_starred);

-- =============================================================================
-- 4. VIRTUAL_FILES TABLE
-- Core metadata table mapping virtual files to physical Google Drive files
-- =============================================================================
CREATE TABLE IF NOT EXISTS virtual_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_account_id UUID NOT NULL REFERENCES storage_accounts(id) ON DELETE RESTRICT,
    parent_id UUID REFERENCES virtual_folders(id) ON DELETE CASCADE,
    
    -- Provider reference
    provider VARCHAR(50) NOT NULL DEFAULT 'google_drive',
    provider_file_id VARCHAR(255) NOT NULL, -- Physical Google Drive File ID
    
    -- File Properties
    name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(150) NOT NULL DEFAULT 'application/octet-stream',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    md5_checksum VARCHAR(64),
    
    -- URLs and previews
    web_url TEXT,
    thumbnail_url TEXT,
    
    -- Flags
    is_starred BOOLEAN NOT NULL DEFAULT FALSE,
    is_trashed BOOLEAN NOT NULL DEFAULT FALSE,
    trashed_at TIMESTAMPTZ,
    
    -- Timestamps
    provider_created_at TIMESTAMPTZ,
    provider_modified_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Uniqueness: Each physical provider file belongs to at most one virtual entry per account
    CONSTRAINT uq_account_provider_file UNIQUE(storage_account_id, provider_file_id)
);

CREATE INDEX IF NOT EXISTS idx_virtual_files_user_parent ON virtual_files(user_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_virtual_files_storage_account ON virtual_files(storage_account_id);
CREATE INDEX IF NOT EXISTS idx_virtual_files_name_search ON virtual_files USING gin (to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_virtual_files_trashed ON virtual_files(user_id, is_trashed);
CREATE INDEX IF NOT EXISTS idx_virtual_files_starred ON virtual_files(user_id, is_starred);
CREATE INDEX IF NOT EXISTS idx_virtual_files_modified ON virtual_files(user_id, updated_at DESC);

-- =============================================================================
-- 5. UPLOAD_JOBS TABLE
-- Tracks ongoing, chunked, or resumable uploads
-- =============================================================================
CREATE TABLE IF NOT EXISTS upload_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_account_id UUID REFERENCES storage_accounts(id) ON DELETE SET NULL,
    target_folder_id UUID REFERENCES virtual_folders(id) ON DELETE SET NULL,

    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(150) NOT NULL,
    total_size_bytes BIGINT NOT NULL,
    bytes_uploaded BIGINT NOT NULL DEFAULT 0,

    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, routed, initializing, uploading, completed, failed, aborted
    routing_strategy VARCHAR(50) NOT NULL DEFAULT 'most_free_space',
    routing_reason TEXT,

    -- Provider session link for resumable upload
    resumable_session_url TEXT,
    error_message TEXT,

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_jobs_user_status ON upload_jobs(user_id, status);

-- =============================================================================
-- 6. SYNC_HISTORY TABLE
-- Logs synchronization runs for auditing and debugging
-- =============================================================================
CREATE TABLE IF NOT EXISTS sync_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_account_id UUID NOT NULL REFERENCES storage_accounts(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'running', -- running, completed, failed
    files_discovered INTEGER NOT NULL DEFAULT 0,
    files_added INTEGER NOT NULL DEFAULT 0,
    files_updated INTEGER NOT NULL DEFAULT 0,
    files_removed INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_history_account ON sync_history(storage_account_id, started_at DESC);

-- =============================================================================
-- 7. OAUTH_STATES TABLE
-- Stores cryptographically unpredictable OAuth CSRF state tokens
-- =============================================================================
CREATE TABLE IF NOT EXISTS oauth_states (
    state_id VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'google_drive',
    redirect_uri TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
