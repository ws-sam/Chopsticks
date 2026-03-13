# Database Schema Documentation

**Version:** 1.0.0  
**Last Updated:** 2026-02-14  
**Level 1 Requirement:** Schema Freeze

## Overview

This document defines the canonical schema for the Chopsticks platform. All changes to this schema **must** follow the backward-compatible migration policy defined in `migrations/README.md`.

## Schema Hash

**Current Hash:** (generated on startup)

The schema hash is calculated from the structure of all tables and is verified on startup to detect unauthorized schema drift.

---

## Core Tables

### 1. guild_settings

**Purpose:** Per-guild configuration and feature flags

```sql
CREATE TABLE guild_settings (
  guild_id   TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  rev        INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
```

**Columns:**
- `guild_id` - Discord guild ID (snowflake)
- `data` - JSONB document containing guild settings
  - `prefix` - Command prefix (if applicable)
  - `selectedPoolId` - Default agent pool for this guild
  - `musicMode` - Music playback mode settings
  - `autorole` - Auto-role configuration
  - Other feature flags
- `rev` - Revision counter for optimistic locking
- `updated_at` - Last modification timestamp

**Indexes:**
- PRIMARY KEY on `guild_id`

**Access Pattern:** Read-heavy, updated on configuration changes

---

### 2. agent_bots

**Purpose:** Registry of agent bot identities and tokens

```sql
CREATE TABLE agent_bots (
  id         SERIAL PRIMARY KEY,
  agent_id   TEXT UNIQUE NOT NULL,
  token      TEXT UNIQUE NOT NULL,
  client_id  TEXT UNIQUE NOT NULL,
  tag        TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  pool_id    TEXT DEFAULT 'pool_WokSpec',
  profile    JSONB
);
```

**Columns:**
- `id` - Auto-incrementing internal ID
- `agent_id` - Unique agent identifier (format: `agent<snowflake>`)
- `token` - Discord bot token (encrypted at rest) **SENSITIVE**
- `client_id` - Discord application client ID
- `tag` - Bot username and discriminator (e.g., "Agent 0001#3092")
- `status` - Agent status: `active`, `inactive`, `revoked`
- `created_at` - Unix timestamp (milliseconds)
- `updated_at` - Unix timestamp (milliseconds)
- `pool_id` - Foreign key to `agent_pools.pool_id`
- `profile` - Optional agent profile metadata

**Indexes:**
- PRIMARY KEY on `id`
- UNIQUE on `agent_id`, `token`, `client_id`
- INDEX on `pool_id`

**Constraints:**
- Level 1: MAX 49 agents per guild (enforced in application code)

**Security:** Token column must be encrypted at rest

---

### 3. agent_pools

**Purpose:** Agent pool definitions for multi-tenancy

```sql
CREATE TABLE agent_pools (
  pool_id       TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  visibility    TEXT NOT NULL DEFAULT 'private',
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  meta          JSONB
);
```

**Columns:**
- `pool_id` - Unique pool identifier (format: `pool_<username>`)
- `owner_user_id` - Discord user ID of pool owner
- `name` - Human-readable pool name
- `visibility` - `public` or `private`
- `created_at` - Unix timestamp (milliseconds)
- `updated_at` - Unix timestamp (milliseconds)
- `meta` - Additional pool metadata

**Indexes:**
- PRIMARY KEY on `pool_id`
- INDEX on `owner_user_id`
- INDEX on `visibility`

**Access Pattern:** Read frequently for agent allocation, write rarely

---

### 4. agent_runners

**Purpose:** Heartbeat tracking for agent runner processes

```sql
CREATE TABLE agent_runners (
  runner_id TEXT PRIMARY KEY,
  last_seen BIGINT NOT NULL,
  meta      JSONB
);
```

**Columns:**
- `runner_id` - Unique runner process ID
- `last_seen` - Unix timestamp (milliseconds) of last heartbeat
- `meta` - Runner metadata (host, version, etc.)

**Indexes:**
- PRIMARY KEY on `runner_id`

**Access Pattern:** Write-heavy (heartbeat updates every 10s)

---

### 5. schema_migrations

**Purpose:** Track applied database migrations

```sql
CREATE TABLE schema_migrations (
  version           TEXT PRIMARY KEY,
  description       TEXT NOT NULL,
  applied_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  checksum          TEXT NOT NULL,
  execution_time_ms INTEGER
);
```

**Columns:**
- `version` - Migration version (format: `YYYYMMDD_HHMMSS`)
- `description` - Human-readable migration description
- `applied_at` - When migration was applied
- `checksum` - SHA256 checksum of migration file content
- `execution_time_ms` - Migration execution duration

**Indexes:**
- PRIMARY KEY on `version`

**Immutable:** Records are never updated or deleted

**Critical:** Checksum verification prevents unauthorized schema changes

---

## Audit & Monitoring Tables

### 6. audit_log

**Purpose:** Audit trail for administrative actions

```sql
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  action     TEXT NOT NULL,
  details    JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
```

**Retention:** Configured per guild (default: 90 days)

---

### 7. command_stats

**Purpose:** Real-time command usage statistics per guild

```sql
CREATE TABLE command_stats (
  guild_id   TEXT NOT NULL,
  command    TEXT NOT NULL,
  ok         BIGINT NOT NULL DEFAULT 0,
  err        BIGINT NOT NULL DEFAULT 0,
  total_ms   BIGINT NOT NULL DEFAULT 0,
  count      BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, command)
);
```

**Access Pattern:** High write frequency, read for metrics

---

### 8. command_stats_daily

**Purpose:** Historical daily command statistics

```sql
CREATE TABLE command_stats_daily (
  day        DATE NOT NULL,
  guild_id   TEXT NOT NULL,
  command    TEXT NOT NULL,
  ok         BIGINT NOT NULL DEFAULT 0,
  err        BIGINT NOT NULL DEFAULT 0,
  total_ms   BIGINT NOT NULL DEFAULT 0,
  count      BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (day, guild_id, command)
);
```

**Retention:** Configured (default: 365 days)

---

## Economy Tables

### 9. user_wallets

**Purpose:** User balance and bank storage

```sql
CREATE TABLE user_wallets (
  user_id       TEXT PRIMARY KEY,
  balance       BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  bank          BIGINT NOT NULL DEFAULT 0 CHECK (bank >= 0),
  bank_capacity BIGINT NOT NULL DEFAULT 10000,
  total_earned  BIGINT NOT NULL DEFAULT 0,
  total_spent   BIGINT NOT NULL DEFAULT 0,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);

CREATE INDEX idx_wallets_balance ON user_wallets(balance DESC);
```

---

### 10. transaction_log

**Purpose:** Immutable transaction history

```sql
CREATE TABLE transaction_log (
  id        SERIAL PRIMARY KEY,
  from_user TEXT,
  to_user   TEXT,
  amount    BIGINT NOT NULL,
  reason    TEXT NOT NULL,
  metadata  JSONB DEFAULT '{}'::jsonb,
  timestamp BIGINT NOT NULL
);

CREATE INDEX idx_transactions_time ON transaction_log(timestamp DESC);
```

**Immutable:** Transactions are never updated or deleted

---

### 11. user_inventory

**Purpose:** User item storage

```sql
CREATE TABLE user_inventory (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  metadata    JSONB DEFAULT '{}'::jsonb,
  acquired_at BIGINT NOT NULL,
  UNIQUE(user_id, item_id)
);

CREATE INDEX idx_inventory_user ON user_inventory(user_id);
```

---

### 12. user_streaks

**Purpose:** User daily/weekly streak tracking

```sql
CREATE TABLE user_streaks (
  user_id           TEXT PRIMARY KEY,
  daily_streak      INTEGER NOT NULL DEFAULT 0,
  weekly_streak     INTEGER NOT NULL DEFAULT 0,
  last_daily        BIGINT,
  last_weekly       BIGINT,
  longest_daily     INTEGER NOT NULL DEFAULT 0,
  longest_weekly    INTEGER NOT NULL DEFAULT 0,
  streak_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.00 
    CHECK (streak_multiplier >= 1.00 AND streak_multiplier <= 5.00)
);
```

---

### 13. user_pets

**Purpose:** User pet ownership and stats

```sql
CREATE TABLE user_pets (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  pet_type   TEXT NOT NULL,
  name       TEXT,
  stats      JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_pets_user_id ON user_pets(user_id);
```

---

## Schema Evolution Policy

### Allowed Changes (Backward Compatible)

✅ **ADD** new tables  
✅ **ADD** new columns with default values  
✅ **ADD** new indexes  
✅ **ADD** new constraints (if not enforced on existing data)  
✅ **MODIFY** column defaults (for future inserts only)  
✅ **CREATE** new types/enums with migration path

### Prohibited Changes (Breaking)

❌ **REMOVE** tables  
❌ **REMOVE** columns  
❌ **RENAME** tables or columns (without migration)  
❌ **CHANGE** column types (without migration)  
❌ **REMOVE** indexes (without analysis)  
❌ **TIGHTEN** constraints on existing data

### Migration Process

1. Create migration file in `migrations/` with format `YYYYMMDD_HHMMSS_description.js`
2. Implement `up(client)` function with DDL changes
3. Implement `down(client)` function for rollback (optional)
4. Test migration on dev database
5. Checksum is automatically calculated and verified on startup
6. Apply migration via bot startup (automatic)

---

## Verification

### Schema Hash Calculation

On bot startup, a hash of the schema is calculated using:
- Table names
- Column names and types
- Primary keys
- Unique constraints
- Indexes

This hash is compared against the expected hash to detect drift.

### Manual Verification

```bash
# Export current schema
docker exec chopsticks-postgres pg_dump -U chopsticks -d chopsticks --schema-only > schema.sql

# Compare with canonical schema
diff schema.sql docs/schema/canonical.sql
```

---

## Critical Tables for Agent Platform

**Must be available for agent operations:**

1. `agent_bots` - Agent registry
2. `agent_pools` - Pool definitions
3. `agent_runners` - Runner heartbeats
4. `guild_settings` - Pool selection per guild

**Session state (in-memory only):**
- Agent connections: `agentManager.liveAgents` (Map)
- Music sessions: `agentManager.sessions` (Map)
- Assistant sessions: `agentManager.assistantSessions` (Map)

---

## Backup & Recovery

**Backup Schedule:** Daily (automated)  
**Retention:** 30 days  
**Hot Backup:** WAL archiving enabled  
**Point-in-Time Recovery:** Supported

**Critical Data:**
- `agent_bots.token` - **Must be re-encrypted** after restore
- `transaction_log` - Immutable audit trail
- `schema_migrations` - Required for integrity

---

## Schema Version

**Current:** `1.0.0`  
**Frozen:** 2026-02-14 (Level 1 completion)  
**Next Review:** Level 3 (Deterministic State)

**Changes require:**
- Migration file
- Documentation update
- Checksum update
- Backward compatibility verification
