# UNICLOUD — MASTER ARCHITECTURE & SPECIFICATION DOCUMENT

> **Version:** 1.2.1-phase2.1  
> **Status:** Phase 2 & Phase 2.1 Complete — Google OAuth 2.0, Secure Drive Integration & Hardened Architecture Operational  
> **Target Release:** Unified Virtual Cloud Storage  
> **Author:** Lead Software Architect & Full-Stack Engineer  

---

## 1. EXECUTIVE SUMMARY & PRODUCT VISION

**UniCloud** is a unified cloud storage abstraction platform that aggregates multiple personal Google Drive accounts into a single virtual storage filesystem.

### Problem Statement
Users frequently maintain multiple personal and work Google Drive accounts (e.g., each providing 15 GB of complimentary storage). Managing files across these disparate drives requires juggling multiple browser tabs, switching accounts, and guessing which drive contains available capacity.

### The UniCloud Solution
UniCloud introduces a **virtual storage abstraction layer** over a user's collection of Google Drive accounts. Instead of managing separate drives, the user interacts with one unified storage pool (e.g., 4 x 15 GB = 60 GB total virtual capacity) through a single, elegant cloud storage interface.

```
+-------------------------------------------------------------------------+
|                              UniCloud User                              |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                  UniCloud Virtual Filesystem & Metadata                 |
|  - Virtual Folder Hierarchy       - Dynamic Upload Router               |
|  - Unified Search Engine          - Capacity & Quota Aggregator         |
+-------------------------------------------------------------------------+
               |                             |
               v                             v
+-----------------------------+   +-----------------------------+
|    Google Drive Account #1  |   |    Google Drive Account #2  |
|       (e.g., 15 GB)         |   |       (e.g., 15 GB)         |
+-----------------------------+   +-----------------------------+
```

---

## 2. CORE ARCHITECTURAL PRINCIPLES

### 1. Virtual Storage Abstraction (Not Physical Merging)
Google Drive quotas cannot be physically or upstream-merged. UniCloud does **not** alter the underlying physical Google accounts. Instead, UniCloud creates a virtual filesystem table that records which physical account holds each file.

- A virtual file `Projects/Financials/2026_Report.pdf` physically resides on **Google Drive Account #2** with Google File ID `1aB2cD3eF4g...`.
- The user navigates, opens, renames, and organizes files through UniCloud without needing to track physical account mappings.

### 2. Provider Agnosticism
While Google Drive is the primary and initial provider, the architecture enforces a strict `StorageProvider` interface contract. Adding future providers (such as OneDrive, Dropbox, or S3) requires only a new provider class implementing the interface, without refactoring the virtual filesystem, upload routing, or UI layers.

### 3. Absolute Zero-Token Client Exposure
Under no circumstances are Google OAuth client secrets, refresh tokens, or raw credentials transmitted to or stored inside the client browser. All token exchanges, storage, and API interactions occur server-side. Refresh tokens are encrypted at rest using AES-256-GCM.

---

## 3. TECHNOLOGY STACK

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **Frontend Framework** | React 19 + TypeScript + Vite | Blazing-fast compilation, modern functional component architecture, type safety |
| **Styling & UI** | Tailwind CSS + Lucide React | High-performance utility styling, consistent iconography, clean visual hierarchy |
| **Animation Engine** | Motion (`motion/react`) | Fluid, performant transitions and layout animations |
| **Backend Runtime** | Node.js + Express + TypeScript | Lightweight server-side route handlers, robust streaming capabilities, middleware mode |
| **Database Engine** | PostgreSQL 14+ / Supabase | Relational integrity, JSONB support for provider metadata, full-text GIN search |
| **Encryption** | Node.js `crypto` (AES-256-GCM) | Cryptographic security for OAuth tokens stored at rest |
| **Target Deployment** | Containerized / Serverless / Cloud Run / Vercel | Scalable, stateless server architecture with external database persistence |

---

## 4. VIRTUAL FILESYSTEM ARCHITECTURE

The UniCloud Virtual Filesystem decouples logical organization from physical placement:

### Data Model Separation
- **`virtual_folders`**: Defines logical directories created by the user. A virtual folder can span files stored across multiple distinct Google Drive accounts.
- **`virtual_files`**: Stores metadata (name, size, MIME type, MD5 checksum, timestamps) and explicitly references:
  1. `user_id`: The UniCloud owner.
  2. `storage_account_id`: Foreign key referencing the physical `storage_accounts` record.
  3. `provider_file_id`: The upstream Google Drive file ID.
  4. `parent_id`: Virtual folder foreign key (or `NULL` for virtual root).

### Unified Node Contract
Both virtual files and folders conform to a unified node representation, allowing seamless sorting, filtering, and recursive tree traversal.

---

## 5. STORAGE PROVIDER ABSTRACTION

All storage backends adhere to the `StorageProvider` interface defined in `src/types/provider.ts`:

```typescript
export interface StorageProvider {
  readonly providerType: ProviderType;
  refreshAuthentication(refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number }>;
  getStorageQuota(accessToken: string): Promise<StorageQuota>;
  listFiles(accessToken: string, options?: ProviderFileListOptions): Promise<ProviderFileListResult>;
  getFileMetadata(accessToken: string, providerFileId: string): Promise<ProviderFileMetadata>;
  createFolder(accessToken: string, name: string, parentFolderId?: string): Promise<ProviderFileMetadata>;
  initiateResumableUpload(accessToken: string, metadata: ResumableUploadInit): Promise<ResumableUploadSession>;
  deleteFile(accessToken: string, providerFileId: string, permanent?: boolean): Promise<void>;
  renameFile(accessToken: string, providerFileId: string, newName: string): Promise<ProviderFileMetadata>;
  moveFile(accessToken: string, providerFileId: string, targetParentFolderId: string): Promise<ProviderFileMetadata>;
  getDownloadUrl(accessToken: string, providerFileId: string): Promise<string>;
  checkHealth(accessToken: string): Promise<ProviderHealthCheckResult>;
}
```

### Google Drive Implementation Roadmap
- **Phase 0 (Current):** Interface contract established, `GoogleDriveProvider` scaffolded with strict `AppError(ErrorCode.NOT_IMPLEMENTED)` boundaries to guarantee no fake or simulated behavior.
- **Phase 2:** Live integration with Google Drive API v3 (`about.get`, `files.list`, `files.create`, `files.delete`, etc.).

---

## 6. MULTI-ACCOUNT & QUOTA AGGREGATION MODEL

A single UniCloud user may connect an arbitrary number of Google Drive accounts ($N \ge 1$).

### Storage Account Attributes
- Unique UniCloud UUID (`id`)
- Foreign key to `users(id)`
- Upstream Google Account identifier (`provider_account_id`)
- Account email and display name
- AES-256-GCM encrypted refresh token bundle (`encrypted_refresh_token`, `token_iv`, `token_auth_tag`)
- Quota tracking: `total_bytes`, `used_bytes`, `free_bytes`
- Account status (`active`, `token_expired`, `revoked`, `quota_full`, `error`)

### Storage Pool Aggregation Formula
$$\text{Total Virtual Capacity} = \sum_{i=1}^{N} \text{total\_bytes}_i$$
$$\text{Total Used Storage} = \sum_{i=1}^{N} \text{used\_bytes}_i$$
$$\text{Available Pool Storage} = \text{Total Virtual Capacity} - \text{Total Used Storage}$$

---

## 7. UPLOAD & ROUTING ARCHITECTURE

When a user uploads a file, UniCloud dynamically routes the file to the optimal Google Drive account:

### Routing Strategies
1. **`most_free_space` (Default):** Selects the active account with the largest raw volume of available bytes ($\max \text{free\_bytes}$).
2. **`balanced`:** Distributes files to maintain uniform percentage utilization across accounts.
3. **`manual`:** Allows the user to select a designated target account for specific files or folders.
4. **`health_weighted`:** Deprioritizes accounts approaching rate limits or with transient errors.

### Large File Streaming & Resumable Uploads
To comply with serverless memory limits (e.g. 50MB payload caps):
- Serverless / Node endpoints do **not** buffer large files in memory.
- For files $> 5\text{ MB}$, the client requests a **Resumable Upload Session** from the backend.
- The backend communicates with Google Drive API to initiate a resumable session and issues a cryptographically signed upload endpoint or streams chunks directly.

---

## 8. DATABASE SCHEMA & PERSISTENCE (POSTGRESQL)

The complete SQL DDL is maintained in `src/db/schema.sql`.

### Core Tables
1. **`users`**: Platform user accounts.
2. **`storage_accounts`**: Connected Google Drive accounts with encrypted credentials and quota counters.
3. **`virtual_folders`**: Recursive folder hierarchy (`parent_id REFERENCES virtual_folders(id)`).
4. **`virtual_files`**: File metadata and upstream provider file mappings.
5. **`upload_jobs`**: Stateful tracking for chunked and resumable uploads.
6. **`sync_history`**: Audit logs of background synchronization jobs.

---

## 9. SECURITY & CREDENTIAL SAFEGUARDS

1. **At-Rest Encryption:**
   ```
   Plaintext Refresh Token 
       ---> AES-256-GCM (256-bit Key + 96-bit IV) 
       ---> Ciphertext + IV + Auth Tag
   ```
2. **Access Token Lifecycle:**
   - Ephemeral in-memory caching with TTL matching Google's expiry (3600 seconds).
   - Proactive refresh 5 minutes before expiration.
3. **Log Sanitization:**
   - The custom logger (`src/server/utils/logger.ts`) automatically strips access tokens, refresh tokens, auth headers, and client secrets from all output.

---

## 10. API ARCHITECTURE & ERROR CONVENTIONS

All API endpoints return a standardized payload envelope:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-09-04T10:15:00.000Z",
    "version": "1.0.0-phase0"
  }
}
```

On failure, a structured error object is returned with HTTP status matching the domain error:

```json
{
  "success": false,
  "error": {
    "code": "ACCOUNT_NOT_CONNECTED",
    "message": "No active storage accounts available. Please connect at least one Google Drive account."
  },
  "meta": {
    "timestamp": "2026-09-04T10:15:00.000Z",
    "version": "1.0.0-phase0"
  }
}
```

---

## 11. CURRENT IMPLEMENTATION STATUS (PHASE 0)

| Component | Status | Location | Notes |
| :--- | :--- | :--- | :--- |
| **Master Specification** | Complete | `/UNICLOUD_MASTER_SPEC.md` | Single source of architectural truth |
| **PostgreSQL Schema DDL** | Complete | `/src/db/schema.sql` | Fully indexed, relational constraints |
| **Database Entities (TS)** | Complete | `/src/db/schema.ts` | Strong TypeScript definitions |
| **Domain Types** | Complete | `/src/types/*.ts` | Account, Filesystem, Provider, Upload, API |
| **StorageProvider Interface**| Complete | `/src/types/provider.ts` | Strict provider contract |
| **GoogleDriveProvider** | Scaffolded | `/src/server/providers/` | Complete method signatures, Phase 2 TODOs |
| **Provider Registry** | Complete | `/src/server/providers/` | Factory for dynamic provider lookup |
| **Domain Services** | Scaffolded | `/src/server/services/` | Account, Storage, File, Folder, Upload, Sync, Search |
| **Upload Routing Engine** | Complete | `/src/server/services/` | Evaluates capacity & routing decisions |
| **Error Handling & Logger**| Complete | `/src/server/utils/` | Redacting logger, typed AppError |
| **Token Encryption** | Complete | `/src/server/utils/` | AES-256-GCM encryption at rest |
| **Express + Vite Server** | Complete | `/server.ts` | Dual API & SPA server on port 3000 |
| **UI Application Shell** | Complete | `/src/components/`, `/src/App.tsx` | Modern cloud storage interface |
| **Dashboard View** | Complete | `/src/components/DashboardView.tsx` | Unified pool gauge & account breakdown |
| **My Files View** | Complete | `/src/components/FilesView.tsx` | Grid/List toggle, breadcrumbs, search, origin badges |
| **Storage Accounts View** | Complete | `/src/components/AccountsView.tsx` | Quota status, health checks, connect modal |
| **Settings View** | Complete | `/src/components/SettingsView.tsx` | Upload routing & security controls |
| **Spec Viewer** | Complete | `/src/components/SpecView.tsx` | In-app interactive architecture roadmap |

---

## 12. PHASING ROADMAP & FUTURE SCOPE

```
Phase 0: Master Architecture & Foundation [COMPLETED]
   |
   v
Phase 1: Database Setup & User Authentication
   - PostgreSQL/Supabase connection integration
   - User session management & login boundaries
   |
   v
Phase 2: Google OAuth 2.0 & Drive API Connection
   - Server-side multi-account OAuth flow
   - Encrypted token storage & refresh lifecycle
   - Live quota retrieval (`about.get`)
   |
   v
Phase 3: Virtual Filesystem Synchronization
   - Delta sync worker mapping Google Drive files to `virtual_files`
   - Folder creation, rename, trash, and star operations
   |
   v
Phase 4: Resumable Upload Engine & Routing
   - Chunked streaming direct to selected Google Drive account
   - Dynamic routing by available quota
   |
   v
Phase 5: Unified Search, Filtering & Trash Recovery
   - Full-text search across all accounts
   - Cross-account file moves & duplicate detection
```

---

## 13. IMPORTANT NON-GOALS FOR PHASE 0

As mandated by Phase 0 discipline:
- No real Google OAuth 2.0 token exchanges or client secrets required.
- No live Google Drive v3 HTTP requests (cleanly deferred to Phase 2).
- No file upload streaming (deferred to Phase 4).
- No simulated or mock data masquerading as real connected accounts; all preview data in the UI is explicitly labelled as **"Phase 0 Design Preview / Architecture Demo"**.

---

## 14. ARCHITECTURAL RISKS & MITIGATIONS

1. **Google Drive API Rate Limits (Queries Per User):**
   - *Risk:* Fetching files across many accounts sequentially may trigger Google 429 errors.
   - *Mitigation:* Implement caching of file metadata in PostgreSQL; sync incrementally using Google Drive Change Tokens (`changes.list`).
2. **File Size Inconsistencies (Google Docs / Sheets):**
   - *Risk:* Native Google Docs do not have byte sizes in Google Drive.
   - *Mitigation:* Virtual file schema marks native docs with designated MIME types and sets `size_bytes = 0` until exported.
3. **Cross-Account Folder Operations:**
   - *Risk:* Google Drive cannot physically nest a folder from Account B inside Account A.
   - *Mitigation:* Purely virtual folder hierarchy maintained in `virtual_folders`. Folders exist as database records that group files regardless of physical host account.

---

## 15. PHASE 0.5 ARCHITECTURE AUDIT & IMPLEMENTATION GAP ANALYSIS

A comprehensive audit was executed across the entire codebase.

### 15.1 Component Classification Summary

- **REAL (Fully Implemented & Operational):**
  - Cryptographic token encryption engine with AES-256-GCM (`src/server/utils/encryption.ts`).
  - Structured error hierarchy (`AppError`, error codes, HTTP status mapping in `src/server/utils/errors.ts`).
  - Security-auditing logging subsystem with regex-based credential and secret redaction (`src/server/utils/logger.ts`).
  - Single-server unified runtime binding Express API routing and Vite SPA middleware on port 3000 (`server.ts`).
  - Standardized REST response envelopes and error serialization middleware (`src/server/api/routes.ts`).
  - Active capacity calculation and quota balancing logic (`src/server/services/StorageService.ts`).
  - Upload routing decision engine supporting `most_free_space`, `balanced`, and `manual` modes (`src/server/services/UploadService.ts`).
  - Dynamic route check API endpoint `/api/upload/route-check` actively called by client (`src/components/UploadModal.tsx`).
  - Complete, strongly typed domain model (`src/types/`).
  - Complete PostgreSQL relational schema DDL with indexing and triggers (`src/db/schema.sql`).
  - Relational TypeScript entity definitions matching PostgreSQL tables (`src/db/schema.ts`).
  - Modern, responsive Nordic Graphite & Cyan UI shell (`src/App.tsx`, `src/components/`).

- **SCAFFOLD (Architecturally Structured, Strongly Typed, Stubbed for Next Phases):**
  - `StorageProvider` abstraction and `GoogleDriveProvider` implementation (`src/server/providers/GoogleDriveProvider.ts` throwing `NOT_IMPLEMENTED`).
  - `ProviderRegistry` factory for dynamic multi-provider resolution (`src/server/providers/ProviderRegistry.ts`).
  - Domain service classes: `AccountService`, `FileService`, `FolderService`, `SyncService`, `SearchService`.
  - API route stubs (`/api/accounts*`, `/api/files*`, `/api/folders*`, `/api/sync*`, `/api/search*`).

- **DEMO (In-Memory Client Preview Data):**
  - Storage accounts, virtual files, and virtual folders rendered in client UI views (`src/data/mockData.ts`).
  - Upload simulation sliders and account connection sequence modals (`src/components/UploadModal.tsx`, `src/components/AddAccountModal.tsx`).

- **TODO (Planned in Spec, Awaiting Scheduled Phases):**
  - PostgreSQL client connection driver (e.g. `pg` / `postgres` / Supabase client).
  - User session authentication and identity boundaries (Phase 1).
  - Google OAuth 2.0 multi-account consent exchange and token refresh worker (Phase 2).
  - Google Drive API v3 live client and delta sync worker (Phase 3).
  - Chunked resumable file upload direct streaming pipeline (Phase 4).

### 15.2 Key Architectural Decisions

1. **Retain Express + Vite Architecture:**
   - The unified Express + Vite setup is structurally sound, conforms to platform single-port requirements (port 3000), cleanly separates client and backend APIs, and eliminates any need to rewrite or migrate to Next.js.
2. **Stateless Backend Design for Serverless / Container Scalability:**
   - Keep long-running state out of Node process memory. Store all virtual filesystem metadata, encrypted credentials, and upload job states in PostgreSQL.
3. **Database Driver Selection for Phase 1:**
   - Use standard connection pooling (`pg` / `postgres` or `@supabase/supabase-js`) with `DATABASE_URL`. The schema DDL in `src/db/schema.sql` is ready for immediate deployment.
4. **Resumable Upload Direct Streaming Architecture:**
   - Avoid buffering files in Express server memory to remain serverless-compatible and respect memory limits. UniCloud server acts as the control plane (initiating Google Drive resumable sessions and verifying quotas), while file streams flow directly or via backpressured streams.

### 15.3 Phase 1 Target Scope

- Wire real PostgreSQL database persistence via connection pool.
- Implement user identity and session management (Phase 1 authentication).
- Replace in-memory mock account/file reads in API routes with database queries.
- Transition UI state from `src/data/mockData.ts` to authenticated API endpoints.

---

## 16. PHASE 1 IMPLEMENTATION SUMMARY & PRODUCTION READINESS

Phase 1 has established the production-grade persistence and identity foundation for UniCloud:

1. **PostgreSQL Connectivity & Pooling:**
   - Real PostgreSQL client via `pg.Pool` (`src/db/client.ts`) with SSL handling, connection pooling, and automatic migration runner.
   - Built-in development fallback engine to ensure smooth operation when `DATABASE_URL` is unconfigured.
   - `checkDatabaseHealth()` verifies connectivity, latency, and operational mode.

2. **User Identity & Server-Side Session Management:**
   - `UserService` (`src/server/services/UserService.ts`) provides user registration and authentication with `bcryptjs` (12 salt rounds).
   - High-entropy cryptographic sessions (32-byte tokens generated with `crypto.randomBytes`).
   - Session tokens are stored as SHA-256 hashes in `user_sessions` table with sliding TTL expirations.
   - Sessions are delivered to clients via secure HTTP-only cookies (`unicloud_session`) with `SameSite=Lax`, completely isolated from browser JavaScript.

3. **Authentication & Authorization Middleware:**
   - `requireAuth` and `optionalAuth` middlewares (`src/server/api/middleware/auth.ts`) extract session tokens, validate against PostgreSQL, and attach the authenticated `req.user`.

4. **Tenant Isolation Across Services:**
   - `AccountService`, `FileService`, and `StorageService` strictly enforce `userId` scoping across all parameterized queries.
   - Accounts and files are strictly isolated per user tenant at the service and database boundary.

5. **Frontend Authentication & State Integration:**
   - `AuthModal` provides interactive registration, login, and quick demo sign-in for `socialdoodle7@gmail.com`.
   - `Header` displays authenticated user profile and logout actions.
   - Clear visual isolation between real user state and simulated preview fixtures (`Demo Drive 01, 02, 03`).

---

## 17. PHASE 2 IMPLEMENTATION SUMMARY: GOOGLE OAUTH 2.0 & REAL DRIVE ACCOUNTS

Phase 2 established direct Google Drive integration, multi-account management, and live storage pool aggregation:

1. **Google OAuth 2.0 Authorization Flow:**
   - Server-side OAuth code exchange with Google Identity services requesting `https://www.googleapis.com/auth/drive` and profile scopes.
   - Strict offline access configuration (`access_type: 'offline'`, `prompt: 'consent'`) ensuring persistent refresh tokens.
   - Client popup UX with secure cross-window `postMessage` synchronization and automatic storage pool updates.

2. **Secure Multi-Account Storage & Encryption:**
   - Multiple Google Drive accounts can be linked to a single UniCloud user account.
   - Refresh tokens are encrypted with AES-256-GCM before storage in the `storage_accounts` PostgreSQL table.
   - Real-time quota metrics retrieved via Google Drive v3 `about.get` (`totalBytes`, `usedBytes`, `freeBytes`, and percentage).

3. **Storage Account Management API:**
   - `GET /api/accounts`: List all connected accounts with decrypted quotas and operational statuses.
   - `POST /api/accounts/google/auth-url`: Initiate OAuth consent sequence with signed state tokens.
   - `GET /api/accounts/google/callback`: Verify state, exchange authorization code, retrieve profile, and register account.
   - `POST /api/accounts/:id/sync`: Trigger metadata synchronization and quota refresh.
   - `POST /api/accounts/:id/reconnect`: Re-authenticate an expired or invalid token.
   - `DELETE /api/accounts/:id`: Gracefully disconnect account and clean up virtual filesystem records.

---

## 18. PHASE 2.1 CORRECTIVE HARDENING SPECIFICATION & VERIFICATION

Phase 2.1 addressed edge cases and security vulnerabilities identified during the architecture audit:

### 18.1 Key Hardening Fixes

1. **OAuth State Validation & Replay Prevention (Fix #1):**
   - Implemented atomic state consumption (`DELETE ... RETURNING`) preventing race conditions and replay attacks.
   - Implemented constant-time HMAC-SHA256 signature comparison that safely validates length before calling `crypto.timingSafeEqual`, eliminating potential uncaught `RangeError` exceptions on malformed state tokens.
   - Added user ID tenancy and provider binding (`google_drive`) to prevent cross-account or cross-provider state substitution.

2. **Production Secret Enforcement (Fix #2):**
   - Created centralized security configuration validator (`src/server/utils/config.ts`).
   - Hardened `src/server/utils/encryption.ts` to require 256-bit (64-character hexadecimal) encryption keys.
   - Enforced fail-fast startup behavior: the server immediately crashes if `NODE_ENV === 'production'` and `ENCRYPTION_KEY` or `SESSION_SECRET` are missing or invalid.
   - Explicitly logs configuration safety status at server startup.

3. **Complete Google Drive Pagination (Fix #3):**
   - Refactored `GoogleDriveProvider.listFiles` to support full pagination loops using `nextPageToken`.
   - Added `fetchAllPages` (defaulting to true for complete syncs) and `maxPages` safeguards to `ProviderFileListOptions`.

4. **Two-Pass Folder Hierarchy Resolution (Fix #4):**
   - Replaced flat folder imports with a two-pass resolution algorithm in `SyncService.ts`:
     - **Pass 1:** Upsert all folders to establish virtual UUIDs mapped to upstream Google folder IDs.
     - **Pass 1.5:** Resolve folder-to-folder relationships and link child folder `parent_id` to the parent virtual folder UUID.
     - **Pass 2:** Upsert files, mapping their `parent_id` to the corresponding virtual folder UUID (or `NULL` for root files).

5. **Database Idempotency & Unique Constraints (Fix #5):**
   - Added unique constraint `uq_virtual_folders_account_provider` on `virtual_folders (storage_account_id, provider_folder_id)`.
   - Updated both PostgreSQL DDL (`schema.sql`) and development in-memory engine (`client.ts`) to handle `ON CONFLICT` updates cleanly, ensuring re-synchronization never creates duplicate records.

6. **Stale / Deleted Upstream File Cleanup (Fix #6):**
   - Recorded `syncStartTime` at the beginning of each synchronization session.
   - Identified any files belonging to the account where `synced_at < syncStartTime` and marked them as `is_trashed = TRUE, trashed_at = NOW()`.
   - Logged sync execution metrics to the `sync_history` audit table.

### 18.2 Verification & Automated Test Suite

A dedicated automated test suite (`src/test/phase2_1_hardening.test.ts`) verifies all Phase 2.1 hardening objectives:
- **OAuth State Hardening:** Validates state generation, successful consumption, single-use replay rejection, tampered signature rejection (both mismatched and identical lengths), and user/provider tenancy checks.
- **Production Secret Enforcement:** Validates 256-bit AES-GCM encryption/decryption, fail-fast behavior in production, and key formatting validation.
- **Pagination & Hierarchy:** Validates pagination options, two-pass folder linking, idempotent sync upsert behavior, and stale upstream file cleanup.

All 12 automated test cases pass cleanly (`npm test`).



