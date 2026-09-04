# UniCloud Database Architecture & Migrations

This directory contains the PostgreSQL schema definitions and migration scripts for UniCloud.

## Database Philosophy
UniCloud operates as a **virtual metadata layer**. Files are physically located inside individual Google Drive accounts, while UniCloud persists:
1. Virtual folder hierarchies
2. File metadata (names, sizes, MIME types, checksums)
3. Cryptographically encrypted credentials for connected Google Drive accounts
4. Quota snapshots and upload job state

## Compatibility
- PostgreSQL 14+
- Supabase PostgreSQL
- Standard Cloud SQL / AWS RDS PostgreSQL

## Executing the Schema
Run `schema.sql` against your target PostgreSQL database:

```bash
psql -U postgres -d unicloud_db -f src/db/schema.sql
```

Or using a connection string:

```bash
psql "$DATABASE_URL" -f src/db/schema.sql
```

## Security Best Practices
- OAuth refresh tokens are encrypted at rest using AES-256-GCM.
- Plaintext credentials and secrets are **NEVER** stored directly in the database.
- Database access is strictly confined to server-side API routes and domain services.
