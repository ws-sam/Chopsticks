import { Pool } from "pg";
import crypto, { randomUUID } from "node:crypto"; // Added for encryption
import retry from "async-retry";
import { logger } from "./logger.js";
import { levelFromXp } from "../game/progression.js";
import { getRedis } from "./cache.js";
import { trace, SpanStatusCode } from "@opentelemetry/api";

let pool = null;

// Accessor for the shared Redis singleton (lazy — may be null before cache.js connects)
function redisClient() { return getRedis(); }

export async function closeStoragePg() {
  // Intended for short-lived scripts (migrations/diagnostics), not the long-running bot.
  try {
    if (pool) await pool.end().catch(() => {});
  } finally {
    pool = null;
  }
  // Redis is managed by cache.js — do not close it here
}

export function getPool() {
  logger.debug("--> getPool() called in storage_pg.js");
  if (pool) return pool;
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    const error = new Error("POSTGRES_URL missing");
    logger.error("Error in getPool():", { error: error.message });
    throw error;
  }
  try {
    pool = new Pool({
      connectionString: url,
      max: parseInt(process.env.PG_POOL_MAX || "10", 10),
      min: parseInt(process.env.PG_POOL_MIN || "2", 10),
      idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || "30000", 10),
      connectionTimeoutMillis: parseInt(process.env.PG_CONNECT_TIMEOUT || "5000", 10),
      statement_timeout: parseInt(process.env.PG_STATEMENT_TIMEOUT || "30000", 10)
    });
    pool.on("error", (err) => {
      logger.error("PostgreSQL pool error (from event listener):", { error: err.message });
    });
    // Auto-instrument every pool.query call with an OTel span
    const tracer = trace.getTracer("chopsticks-db");
    const _origQuery = pool.query.bind(pool);
    pool.query = function tracedQuery(textOrConfig, values) {
      const sql = typeof textOrConfig === "string" ? textOrConfig : (textOrConfig?.text ?? "");
      const opName = sql.trimStart().split(/\s+/, 1)[0].toUpperCase() || "QUERY";
      return tracer.startActiveSpan(`db.${opName}`, { attributes: { "db.statement": sql.slice(0, 200) } }, async (span) => {
        try {
          const result = await _origQuery(textOrConfig, values);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (err) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
          span.recordException(err);
          throw err;
        } finally {
          span.end();
        }
      });
    };
    logger.info("PostgreSQL connection pool initialized.");
  } catch (err) {
    logger.error("Error initializing PostgreSQL connection pool:", { error: err.message });
    throw err;
  }
  return pool;
}

// ── Encryption Configuration ──────────────────────────────────────────────
// v1: all tokens encrypted with the shared AGENT_TOKEN_KEY (legacy)
// v2: each token encrypted with a key derived per-pool via HKDF
//   derivePoolKey(poolId, createdAt) → unique 32-byte AES key
//   This means a compromised key for one pool cannot decrypt tokens from another.
const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 16;
const TAG_LENGTH = 16;
const MASTER_KEY_HEX = process.env.AGENT_TOKEN_KEY;

if (!MASTER_KEY_HEX || MASTER_KEY_HEX.length !== 64) {
  logger.warn("AGENT_TOKEN_KEY missing or not 32 bytes — agent tokens will NOT be encrypted at rest.");
}

/**
 * Derive a unique 32-byte AES key for a pool using HKDF-SHA256.
 * @param {string} poolId
 * @param {number} createdAt — pool's created_at timestamp (non-secret salt)
 */
function derivePoolKey(poolId, createdAt) {
  if (!MASTER_KEY_HEX) return null;
  const masterKey = Buffer.from(MASTER_KEY_HEX, 'hex');
  const salt      = Buffer.alloc(8);
  salt.writeBigUInt64BE(BigInt(createdAt || 0));
  const info = Buffer.from(`chopsticks-pool-v2:${poolId}`, 'utf8');
  return crypto.hkdfSync('sha256', masterKey, salt, info, 32);
}

function _encryptWithKey(text, keyBuf) {
  const iv      = crypto.randomBytes(IV_LENGTH);
  const cipher  = crypto.createCipheriv(ALGORITHM, keyBuf, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc    += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + enc + ':' + tag.toString('hex');
}

function _decryptWithKey(text, keyBuf) {
  const parts = text.split(':');
  if (parts.length !== 3) return text; // unencrypted / wrong format
  const iv  = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const dec = crypto.createDecipheriv(ALGORITHM, keyBuf, iv);
  dec.setAuthTag(tag);
  let out = dec.update(parts[1], 'hex', 'utf8');
  out    += dec.final('utf8');
  return out;
}

const seenDecryptFailures = new Set();

/**
 * Encrypt a token.
 * @param {string} text
 * @param {string|null} poolId — when provided uses pool-derived key (v2); else master key (v1)
 * @param {number} [poolCreatedAt]
 * @returns {{ ciphertext: string, encVersion: number }}
 */
function encrypt(text, poolId = null, poolCreatedAt = 0) {
  if (!MASTER_KEY_HEX) return { ciphertext: text, encVersion: 0 };
  try {
    if (poolId) {
      const key = derivePoolKey(poolId, poolCreatedAt);
      return { ciphertext: _encryptWithKey(text, key), encVersion: 2 };
    }
    const masterKey = Buffer.from(MASTER_KEY_HEX, 'hex');
    return { ciphertext: _encryptWithKey(text, masterKey), encVersion: 1 };
  } catch (err) {
    logger.error("Encryption failed:", { error: err });
    return { ciphertext: text, encVersion: 0 };
  }
}

/**
 * Decrypt a token, routing to the correct key based on enc_version.
 * On success upgrades v1 tokens to v2 (lazy re-encryption) when poolId available.
 * @returns {string|null} plaintext token, or null on failure
 */
function decrypt(ciphertext, encVersion = 1, poolId = null, poolCreatedAt = 0) {
  if (!MASTER_KEY_HEX) return ciphertext;
  if (!ciphertext || typeof ciphertext !== 'string') return ciphertext;
  try {
    if (encVersion === 2 && poolId) {
      const key = derivePoolKey(poolId, poolCreatedAt);
      return _decryptWithKey(ciphertext, key);
    }
    // v1 or unknown: use master key
    const masterKey = Buffer.from(MASTER_KEY_HEX, 'hex');
    return _decryptWithKey(ciphertext, masterKey);
  } catch (err) {
    const sig = `${String(ciphertext).slice(0, 8)}`;
    if (!seenDecryptFailures.has(sig)) {
      seenDecryptFailures.add(sig);
      logger.warn("Decryption failed (token may need re-registration).", { error: err?.message, encVersion, poolId });
    }
    return null;
  }
}

/**
 * Mask a token for safe display in embeds and logs.
 * Always use this — never expose a raw token in any UI surface.
 * @param {string} token — plaintext Discord bot token
 * @returns {string} e.g. "MTIzNDU2···kXyZ"
 */
export function maskToken(token) {
  if (!token || token.length < 16) return '····';
  return token.slice(0, 10) + '····' + token.slice(-4);
}
// ── End Encryption Configuration ─────────────────────────────────────────

export async function ensureSchema() {
  logger.info("ensureSchema: start");
  logger.debug("--> Calling getPool() from ensureSchema()"); // New diagnostic log
  const p = getPool();

  try {
    logger.debug("Attempting to create guild_settings table...");
    await p.query(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        rev INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    logger.debug("guild_settings table created or already exists.");
  } catch (err) {
    logger.error("Error creating guild_settings table:", { error: err.message });
    throw err;
  }

  try {
    logger.debug("Attempting to create audit_log table...");
    await p.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    logger.debug("audit_log table created or already exists.");
  } catch (err) {
    logger.error("Error creating audit_log table:", { error: err.message });
    throw err;
  }

  try {
    logger.debug("Attempting to create command_stats table...");
    await p.query(`
      CREATE TABLE IF NOT EXISTS command_stats (
        guild_id TEXT NOT NULL,
        command TEXT NOT NULL,
        ok BIGINT NOT NULL DEFAULT 0,
        err BIGINT NOT NULL DEFAULT 0,
        total_ms BIGINT NOT NULL DEFAULT 0,
        count BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guild_id, command)
      );
    `);
    logger.debug("command_stats table created or already exists.");
  } catch (err) {
    logger.error("Error creating command_stats table:", { error: err.message });
    throw err;
  }

  try {
    logger.debug("Attempting to create command_stats_daily table...");
    await p.query(`
      CREATE TABLE IF NOT EXISTS command_stats_daily (
        day DATE NOT NULL,
        guild_id TEXT NOT NULL,
        command TEXT NOT NULL,
        ok BIGINT NOT NULL DEFAULT 0,
        err BIGINT NOT NULL DEFAULT 0,
        total_ms BIGINT NOT NULL DEFAULT 0,
        count BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (day, guild_id, command)
      );
    `);
    logger.debug("command_stats_daily table created or already exists.");
  } catch (err) {
    logger.error("Error creating command_stats_daily table:", { error: err.message });
    throw err;
  }

  // New agent_bots table (renamed from agent_tokens, timestamps as BIGINT)
  try {
    logger.debug("Attempting to create agent_bots table...");
    const createTableSql = `
      CREATE TABLE IF NOT EXISTS agent_bots (
        id SERIAL PRIMARY KEY,
        agent_id TEXT UNIQUE NOT NULL,
        token TEXT UNIQUE NOT NULL, -- Encrypted at rest
        client_id TEXT UNIQUE NOT NULL,
        tag TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        pool_id TEXT DEFAULT 'pool_goot27'
      );
    `;
    logger.debug("ensureSchema: Executing SQL:", { sql: createTableSql });
    await p.query(createTableSql);
    logger.debug("agent_bots table created or already exists.");
  } catch (err) {
    logger.error("Error creating agent_bots table:", { error: err.message });
    throw err;
  }

  // New agent_pools table - manages pool ownership and visibility
  try {
    logger.debug("Attempting to create agent_pools table...");
    const createPoolsTableSql = `
      CREATE TABLE IF NOT EXISTS agent_pools (
        pool_id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        meta JSONB
      );
    `;
    logger.debug("ensureSchema: Executing SQL:", { sql: createPoolsTableSql });
    await p.query(createPoolsTableSql);
    logger.debug("agent_pools table created or already exists.");
  } catch (err) {
    logger.error("Error creating agent_pools table:", { error: err.message });
    throw err;
  }

  // Create default pool for goot27 if it doesn't exist
  try {
    logger.debug("Ensuring default pool_goot27 exists...");
    const ensureDefaultPoolSql = `
      INSERT INTO agent_pools (pool_id, owner_user_id, name, visibility, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (pool_id) DO NOTHING;
    `;
    const now = Date.now();
    await p.query(ensureDefaultPoolSql, [
      'pool_goot27',
      process.env.BOT_OWNER_ID || '', // Bot owner Discord ID (set BOT_OWNER_ID in .env)
      'Official Chopsticks Pool',
      'public',
      now,
      now
    ]);
    logger.debug("Default pool_goot27 ensured.");

  // Migration: rename default pool to "goot27's pool" (one-time, guarded by old name)
  try {
    await p.query(
      "UPDATE agent_pools SET name = $1, visibility = 'public' WHERE pool_id = 'pool_goot27' AND name = 'Official Chopsticks Pool'",
      ["goot27's pool"]
    );
    logger.debug("Default pool rename migration applied (if needed).");
  } catch (err) {
    logger.error("Error applying default pool rename migration:", { error: err.message });
  }
  } catch (err) {
    logger.error("Error ensuring default pool:", { error: err.message });
    // Don't throw - pool might already exist
  }

  // Create indices for performance
  try {
    logger.debug("Creating indices for agent_pools...");
    await p.query('CREATE INDEX IF NOT EXISTS idx_agent_bots_pool_id ON agent_bots(pool_id);');
    await p.query('CREATE INDEX IF NOT EXISTS idx_agent_pools_owner ON agent_pools(owner_user_id);');
    await p.query('CREATE INDEX IF NOT EXISTS idx_agent_pools_visibility ON agent_pools(visibility);');
    logger.debug("Indices created.");
  } catch (err) {
    logger.error("Error creating indices:", { error: err.message });
    // Don't throw - indices might already exist
  }

  // New agent_runners table
  try {
    logger.debug("Attempting to create agent_runners table...");
    const createRunnerTableSql = `
      CREATE TABLE IF NOT EXISTS agent_runners (
        runner_id TEXT PRIMARY KEY,
        last_seen BIGINT NOT NULL,
        meta JSONB
      );
    `;
    logger.debug("ensureSchema: Executing SQL:", { sql: createRunnerTableSql });
    await p.query(createRunnerTableSql);
    logger.debug("agent_runners table created or already exists.");
  } catch (err) {
    logger.error("Error creating agent_runners table:", { error: err.message });
    throw err;
  }
  
  try {
    logger.debug("Attempting to alter agent_bots table to add profile column...");
    const alterTableSql = `
      ALTER TABLE agent_bots
      ADD COLUMN IF NOT EXISTS profile JSONB;
    `;
    logger.debug("ensureSchema: Executing SQL:", { sql: alterTableSql });
    await p.query(alterTableSql);
    logger.debug("agent_bots table altered or already up-to-date.");
  } catch (err) {
    logger.error("Error altering agent_bots table:", { error: err.message });
    throw err;
  }

  // New user_pets table
  try {
    logger.debug("Attempting to create user_pets table...");
    const createPetsTableSql = `
      CREATE TABLE IF NOT EXISTS user_pets (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        pet_type TEXT NOT NULL,
        name TEXT,
        stats JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    await p.query(createPetsTableSql);
    await p.query('CREATE INDEX IF NOT EXISTS idx_user_pets_user_id ON user_pets(user_id);');
    logger.debug("user_pets table created or already exists.");
  } catch (err) {
    logger.error("Error creating user_pets table:", { error: err.message });
    throw err;
  }

  // Migration: Add pool_id to existing agent_bots if not present
  try {
    logger.debug("Attempting to add pool_id column to agent_bots if not exists...");
    const addPoolIdSql = `
      ALTER TABLE agent_bots
      ADD COLUMN IF NOT EXISTS pool_id TEXT DEFAULT 'pool_goot27';
    `;
    await p.query(addPoolIdSql);
    logger.debug("pool_id column ensured in agent_bots.");
  } catch (err) {
    logger.error("Error adding pool_id to agent_bots:", { error: err.message });
    // Don't throw - column might already exist
  }

  // Migration: Add selected_pool_id to guild_settings
  try {
    logger.debug("Attempting to add selected_pool_id column to guild_settings...");
    // First, check if the data column exists and is JSONB
    const checkColumnSql = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'guild_settings';
    `;
    const columnResult = await p.query(checkColumnSql);
    const hasDataColumn = columnResult.rows.some(r => r.column_name === 'data');
    
    if (hasDataColumn) {
      // Guild settings uses JSONB data column, we'll store selected_pool_id there
      logger.debug("Guild settings uses JSONB data column. Pool selection will be stored in data.selectedPoolId");
    }
  } catch (err) {
    logger.error("Error checking guild_settings structure:", { error: err.message });
  }

  // Pool contributions table
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS pool_contributions (
        contribution_id TEXT PRIMARY KEY,
        pool_id         TEXT NOT NULL,
        agent_id        TEXT NOT NULL,
        contributed_by  TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        submitted_at    BIGINT NOT NULL,
        reviewed_at     BIGINT,
        reviewed_by     TEXT,
        notes           TEXT
      );
    `);
    await p.query('CREATE INDEX IF NOT EXISTS idx_pool_contributions_pool ON pool_contributions(pool_id, status);');
    logger.debug("pool_contributions table ensured.");
  } catch (err) {
    logger.error("Error creating pool_contributions table:", { error: err.message });
  }

  // Migration: add max_contributions_per_user to agent_pools
  try {
    await p.query("ALTER TABLE agent_pools ADD COLUMN IF NOT EXISTS max_contributions_per_user INTEGER DEFAULT 3");
    logger.debug("max_contributions_per_user column ensured.");
  } catch (err) {
    logger.error("Error adding max_contributions_per_user:", { error: err.message });
  }

  logger.info("ensureSchema: complete");
}

export async function insertAuditLog(entry) {
  const p = getPool();
  const insertAuditSql = "INSERT INTO audit_log (guild_id, user_id, action, details) VALUES ($1, $2, $3, $4)";
  logger.info("insertAuditLog: Executing SQL", { sql: insertAuditSql });
  await p.query(
    insertAuditSql,
    [entry.guildId, entry.userId, entry.action, entry.details ?? null]
  );
}

export async function fetchAuditLog(guildId, limit = 50, beforeId = null, action = null, userId = null) {
  const p = getPool();
  const lim = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  const params = [guildId];
  let idx = params.length + 1;
  let where = "guild_id = $1";

  if (beforeId) {
    where += ` AND id < $${idx}`;
    params.push(Number(beforeId));
    idx += 1;
  }

  if (action) {
    where += ` AND action ILIKE $${idx}`;
    params.push(`%${action}%`);
    idx += 1;
  }

  if (userId) {
    where += ` AND user_id = $${idx}`;
    params.push(String(userId));
    idx += 1;
  }

  params.push(lim);
  const fetchAuditSql = `SELECT id, guild_id, user_id, action, details, created_at FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT $${idx}`;
  logger.info("fetchAuditLog: Executing SQL", { sql: fetchAuditSql });
  const res = await p.query(
    fetchAuditSql,
    params
  );
  return res.rows;
}

export async function upsertCommandStats(rows) {
  if (!rows?.length) return;
  const p = getPool();
  const values = [];
  const params = [];
  let i = 1;
  for (const r of rows) {
    values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
    const gid = r.guildId ? String(r.guildId) : "__global__";
    params.push(gid, r.command, r.ok || 0, r.err || 0, r.totalMs || 0, r.count || 0);
  }
  const sql = `
    INSERT INTO command_stats (guild_id, command, ok, err, total_ms, count)
    VALUES ${values.join(",")}
    ON CONFLICT (guild_id, command)
    DO UPDATE SET
      ok = command_stats.ok + EXCLUDED.ok,
      err = command_stats.err + EXCLUDED.err,
      total_ms = command_stats.total_ms + EXCLUDED.total_ms,
      count = command_stats.count + EXCLUDED.count,
      updated_at = NOW()
  `;
  logger.info("upsertCommandStats: Executing SQL", { sql });
  await p.query(sql, params);
}

export async function upsertCommandStatsDaily(rows, day) {
  if (!rows?.length) return;
  const p = getPool();
  const d = day || new Date().toISOString().slice(0, 10);
  const values = [];
  const params = [];
  let i = 1;
  for (const r of rows) {
    values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
    const gid = r.guildId ? String(r.guildId) : "__global__";
    params.push(d, gid, r.command, r.ok || 0, r.err || 0, r.totalMs || 0, r.count || 0);
  }
  const sql = `
    INSERT INTO command_stats_daily (day, guild_id, command, ok, err, total_ms, count)
    VALUES ${values.join(",")}
    ON CONFLICT (day, guild_id, command)
    DO UPDATE SET
      ok = command_stats_daily.ok + EXCLUDED.ok,
      err = command_stats_daily.err + EXCLUDED.err,
      total_ms = command_stats_daily.total_ms + EXCLUDED.total_ms,
      count = command_stats_daily.count + EXCLUDED.count,
      updated_at = NOW()
  `;
  logger.info("upsertCommandStatsDaily: Executing SQL", { sql });
  await p.query(sql, params);
}

export async function fetchCommandStats(guildId = null, limit = 50) {
  const p = getPool();
  const lim = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  let sql;
  let params;
  if (guildId) {
    sql = `SELECT command, ok, err, total_ms, count FROM command_stats
       WHERE guild_id = $1
       ORDER BY (ok + err) DESC
       LIMIT $2`;
    params = [String(guildId), lim];
  } else {
    sql = `SELECT command, ok, err, total_ms, count FROM command_stats
     WHERE guild_id = '__global__'
     ORDER BY (ok + err) DESC
     LIMIT $1`;
    params = [lim];
  }
  logger.info("fetchCommandStats: Executing SQL", { sql, params });
  const res = await p.query(
    sql,
    params
  );
  return res.rows.map(r => ({
    command: r.command,
    ok: Number(r.ok || 0),
    err: Number(r.err || 0),
    avgMs: r.count ? Math.round(Number(r.total_ms) / Number(r.count)) : 0
  }));
}

export async function fetchCommandStatsDaily(guildId, days = 7, limit = 50) {
  const p = getPool();
  const lim = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  const d = Math.max(1, Math.min(90, Math.trunc(Number(days) || 7)));
  const gid = guildId ? String(guildId) : "__global__";
  const sql = `SELECT command, SUM(ok) AS ok, SUM(err) AS err, SUM(total_ms) AS total_ms, SUM(count) AS count
     FROM command_stats_daily
     WHERE guild_id = $1 AND day >= (CURRENT_DATE - $2::int)
     GROUP BY command
     ORDER BY (SUM(ok) + SUM(err)) DESC
     LIMIT $3`;
  logger.info("fetchCommandStatsDaily: Executing SQL", { sql, params: [gid, d, lim] });
  const res = await p.query(
    sql,
    [gid, d, lim]
  );
  return res.rows.map(r => ({
    command: r.command,
    ok: Number(r.ok || 0),
    err: Number(r.err || 0),
    avgMs: r.count ? Math.round(Number(r.total_ms) / Number(r.count)) : 0
  }));
}

export async function insertAgentBot(agentId, token, clientId, tag, poolId = 'pool_goot27', contributedBy = '', initialStatus = 'active') {
  const p = getPool();
  const now = Date.now();

  // Fetch pool for its createdAt (used as HKDF salt) and capacity check
  const pool = await fetchPool(poolId);
  if (!pool) throw new Error(`Pool not found: ${poolId}`);

  // Enforce hard agent cap
  const currentCount = await countAgentsByPool(poolId);
  if (currentCount >= (pool.max_agents || 49)) {
    throw new Error(`Pool ${poolId} is at capacity (${currentCount}/${pool.max_agents ?? 49} agents).`);
  }

  const { ciphertext, encVersion } = encrypt(token, poolId, Number(pool.created_at));
  const resolvedContributor = contributedBy || pool.owner_user_id;
  const safeStatus = ['active', 'pending', 'inactive', 'suspended'].includes(initialStatus) ? initialStatus : 'active';

  const upsertSql = `
    INSERT INTO agent_bots
      (agent_id, token, client_id, tag, pool_id, contributed_by, enc_version, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (agent_id) DO UPDATE SET
      token         = EXCLUDED.token,
      client_id     = EXCLUDED.client_id,
      tag           = EXCLUDED.tag,
      pool_id       = EXCLUDED.pool_id,
      contributed_by = EXCLUDED.contributed_by,
      enc_version   = EXCLUDED.enc_version,
      updated_at    = EXCLUDED.updated_at
    RETURNING agent_id, client_id, tag, status, pool_id, contributed_by, enc_version, created_at, updated_at;
  `;
  const res = await p.query(upsertSql, [agentId, ciphertext, clientId, tag, poolId, resolvedContributor, encVersion, safeStatus, now, now]);
  const row = res.rows[0];

  // Ensure contributor has a pool_members row
  await p.query(`
    INSERT INTO pool_members (pool_id, user_id, role, granted_by, granted_at)
    VALUES ($1, $2, 'contributor', $3, $4)
    ON CONFLICT (pool_id, user_id) DO NOTHING;
  `, [poolId, resolvedContributor, resolvedContributor, now]);

  // For public pools: non-owner contributions must be reviewed
  if (pool.visibility === 'public' && resolvedContributor !== pool.owner_user_id) {
    // Force pending status
    if (row.status !== 'pending') {
      await p.query("UPDATE agent_bots SET status = 'pending', updated_at = $1 WHERE agent_id = $2", [now, agentId]);
      row.status = 'pending';
    }
    // Enforce per-user contribution cap
    const capCheck = await p.query(
      "SELECT COUNT(*) AS cnt FROM pool_contributions WHERE pool_id = $1 AND contributed_by = $2 AND status != 'rejected'",
      [poolId, resolvedContributor]
    );
    const userContribCount = Number(capCheck.rows[0]?.cnt || 0);
    const maxPerUser = pool.max_contributions_per_user ?? 3;
    if (userContribCount >= maxPerUser) {
      throw new Error(`Contribution limit reached: this pool allows at most ${maxPerUser} pending/approved contributions per user.`);
    }
    // Insert contribution record
    const contribId = randomUUID();
    await p.query(`
      INSERT INTO pool_contributions (contribution_id, pool_id, agent_id, contributed_by, status, submitted_at)
      VALUES ($1, $2, $3, $4, 'pending', $5)
      ON CONFLICT DO NOTHING
    `, [contribId, poolId, agentId, resolvedContributor, now]);
  }

  // Audit
  await logPoolEvent(poolId, resolvedContributor, 'token_registered', agentId, { tag, clientId, status: row.status });

  return {
    agentId:       row.agent_id,
    clientId:      row.client_id,
    tag:           row.tag,
    status:        row.status,
    poolId:        row.pool_id,
    contributedBy: row.contributed_by,
    created_at:    Number(row.created_at),
    updated_at:    Number(row.updated_at),
    // 'inserted' if created_at == updated_at (new row), otherwise 'updated'
    operation:     Number(row.created_at) === now ? 'inserted' : 'updated',
  };
}

export async function fetchAgentBots() {
  const p = getPool();
  // NOTE: token field intentionally excluded — use fetchAgentToken(agentId) when the raw token is needed.
  const fetchSql = "SELECT agent_id, client_id, tag, status, pool_id, contributed_by, enc_version, created_at, updated_at, profile FROM agent_bots";
  const res = await p.query(fetchSql);
  return res.rows.map(row => ({
    ...row,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at)
  }));
}

/**
 * Fetch and decrypt the raw token for a single agent.
 * Call only when you genuinely need the plaintext (e.g. Discord login).
 * Never pass the result to any embed or log — use maskToken() for display.
 */
export async function fetchAgentToken(agentId) {
  const p = getPool();
  const res = await p.query(
    `SELECT ab.token, ab.enc_version, ab.pool_id, ap.created_at AS pool_created_at
       FROM agent_bots ab
       JOIN agent_pools ap ON ab.pool_id = ap.pool_id
      WHERE ab.agent_id = $1`,
    [agentId]
  );
  if (!res.rows[0]) return null;
  const { token, enc_version, pool_id, pool_created_at } = res.rows[0];
  return decrypt(token, Number(enc_version), pool_id, Number(pool_created_at));
}

export async function updateAgentBotStatus(agentId, status, actorUserId = '') {
  const p = getPool();
  // Terminal state — revoked tokens cannot be reactivated
  if (status !== 'revoked') {
    const check = await p.query("SELECT status, pool_id FROM agent_bots WHERE agent_id = $1", [agentId]);
    const row = check.rows[0];
    if (row?.status === 'revoked') {
      throw new Error(`Agent ${agentId} is revoked and cannot be reactivated.`);
    }
    // Capacity check when activating (active or approved)
    if ((status === 'active' || status === 'approved') && row?.pool_id) {
      const currentCount = await countAgentsByPool(row.pool_id);
      const pool = await fetchPool(row.pool_id);
      const maxAgents = pool?.max_agents || 49;
      // Only enforce if agent is currently NOT already in the active/approved count
      const alreadyActive = row?.status === 'active' || row?.status === 'approved';
      if (!alreadyActive && currentCount >= maxAgents) {
        throw new Error(`Pool ${row.pool_id} is at capacity (${currentCount}/${maxAgents}). Cannot activate more agents.`);
      }
    }
  }
  const res = await p.query(
    "UPDATE agent_bots SET status = $1, updated_at = $2 WHERE agent_id = $3 RETURNING agent_id, pool_id",
    [status, Date.now(), agentId]
  );
  if (res.rowCount > 0 && actorUserId) {
    const poolId = res.rows[0]?.pool_id;
    if (poolId) await logPoolEvent(poolId, actorUserId, `token_${status}`, agentId, {});
  }
  return res.rowCount > 0;
}

/** Bulk-reset agents incorrectly marked corrupt/failed back to active so runner retries them. */
export async function resetCorruptAgents() {
  const p = getPool();
  const res = await p.query(
    "UPDATE agent_bots SET status = 'active', updated_at = $1 WHERE status IN ('corrupt', 'failed') RETURNING agent_id",
    [Date.now()]
  );
  return res.rows.map(r => r.agent_id);
}

export async function updateAgentBotProfile(agentId, profile) {
  const p = getPool();
  const updateSql = "UPDATE agent_bots SET profile = $1, updated_at = $2 WHERE agent_id = $3 RETURNING agent_id";
  logger.info("updateAgentBotProfile: Executing SQL", { sql: updateSql, agentId });
  const res = await p.query(updateSql, [profile, Date.now(), agentId]);
  return res.rowCount > 0;
}

export async function fetchAgentBotProfile(agentId) {
  const p = getPool();
  const fetchSql = "SELECT profile FROM agent_bots WHERE agent_id = $1";
  logger.info("fetchAgentBotProfile: Executing SQL", { sql: fetchSql, agentId });
  const res = await p.query(fetchSql, [agentId]);
  return res.rows[0]?.profile ?? null;
}

export async function deleteAgentBot(agentId) {
  const p = getPool();
  const deleteSql = "DELETE FROM agent_bots WHERE agent_id = $1 RETURNING agent_id";
  logger.info("deleteAgentBot: Executing SQL", { sql: deleteSql, agentId });
  const res = await p.query(deleteSql, [agentId]);
  logger.info("deleteAgentBot: Query result", { rowCount: res.rowCount }); // Add this log
  return res.rowCount > 0; // Return true if an agent was deleted, false otherwise
}

export async function upsertAgentRunner(runnerId, lastSeen, meta) {
  const p = getPool();
  const upsertSql = `INSERT INTO agent_runners (runner_id, last_seen, meta)
     VALUES ($1, $2, $3)
     ON CONFLICT (runner_id) DO UPDATE SET
       last_seen = EXCLUDED.last_seen,
       meta = EXCLUDED.meta`;
  logger.info("upsertAgentRunner: Executing SQL", { sql: upsertSql, runnerId, lastSeen });
  await p.query(
    upsertSql,
    [runnerId, lastSeen, meta]
  );
}

export async function fetchAgentRunners() {
  const p = getPool();
  const fetchSql = "SELECT runner_id, last_seen, meta FROM agent_runners";
  logger.info("fetchAgentRunners: Executing SQL", { sql: fetchSql });
  const res = await p.query(fetchSql);
  return res.rows.map(row => ({
    ...row,
    last_seen: Number(row.last_seen)
  }));
}

export async function deleteAgentRunner(runnerId) {
  const p = getPool();
  const deleteSql = "DELETE FROM agent_runners WHERE runner_id = $1 RETURNING runner_id"; // RETURNING runner_id to check for affected rows
  logger.info("deleteAgentRunner: Executing SQL", { sql: deleteSql, runnerId });
  const res = await p.query(deleteSql, [runnerId]);
  return res.rowCount > 0; // Return true if a runner was deleted, false otherwise
}

export async function loadGuildDataPg(guildId, fallbackFactory) {
  const cacheKey = `guild_data:${guildId}`;
  const rc = redisClient();
  if (rc) {
    try {
      const cached = await rc.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn("Redis cache read failed:", { error: err.message });
    }
  }

  const p = getPool();
  const selectSql = "SELECT data, rev FROM guild_settings WHERE guild_id = $1";
  logger.info("loadGuildDataPg: Executing SQL", { sql: selectSql, guildId });

  const res = await retry(async () => {
    return await p.query(selectSql, [guildId]);
  }, { retries: 3, minTimeout: 100, maxTimeout: 1000 });

  if (!res.rowCount) {
    const base = fallbackFactory();
    const insertSql = "INSERT INTO guild_settings (guild_id, data, rev) VALUES ($1, $2, $3) ON CONFLICT (guild_id) DO NOTHING";
    logger.info("loadGuildDataPg (insert fallback): Executing SQL", { sql: insertSql, guildId });
    await retry(async () => {
      return await p.query(
        insertSql,
        [guildId, base, base.rev ?? 0]
      );
    }, { retries: 3, minTimeout: 100, maxTimeout: 1000 });
    try {
      const rc = redisClient(); if (rc) await rc.setEx(cacheKey, 300, JSON.stringify(base)); // Cache for 5 min
    } catch (err) {
      logger.warn("Redis cache write failed:", { error: err.message });
    }
    return base;
  }
  const row = res.rows[0];
  const data = row.data || fallbackFactory();
  data.rev = Number.isInteger(row.rev) ? row.rev : data.rev ?? 0;

  try {
    const rc = redisClient(); if (rc) await rc.setEx(cacheKey, 300, JSON.stringify(data));
  } catch (err) {
    logger.warn("Redis cache write failed:", { error: err.message });
  }

  return data;
}

export async function saveGuildDataPg(guildId, data, normalizeFn, mergeOnConflict) {
  const p = getPool();
  const normalized = normalizeFn(data);
  const selectSql = "SELECT data, rev FROM guild_settings WHERE guild_id = $1";
  logger.info("saveGuildDataPg (select current): Executing SQL", { sql: selectSql, guildId });

  const currentRes = await retry(async () => {
    return await p.query(selectSql, [guildId]);
  }, { retries: 3, minTimeout: 100, maxTimeout: 1000 });

  if (!currentRes.rowCount) {
    const toWrite = { ...normalized, rev: (normalized.rev ?? 0) + 1 };
    const insertSql = "INSERT INTO guild_settings (guild_id, data, rev) VALUES ($1, $2, $3)";
    logger.info("saveGuildDataPg (insert new): Executing SQL", { sql: insertSql, guildId });
    await retry(async () => {
      return await p.query(
        insertSql,
        [guildId, toWrite, toWrite.rev]
      );
    }, { retries: 3, minTimeout: 100, maxTimeout: 1000 });
    // Invalidate cache
    try {
      const rc = redisClient(); if (rc) await rc.del(`guild_data:${guildId}`);
    } catch (err) {
      logger.warn("Redis cache delete failed:", { error: err.message });
    }
    return toWrite;
  }

  const current = currentRes.rows[0].data || normalized;
  const currentRev = Number.isInteger(currentRes.rows[0].rev) ? currentRes.rows[0].rev : 0;
  const expectedRev = Number.isInteger(normalized.rev) ? normalized.rev : currentRev;

  let next = normalized;
  if (currentRev !== expectedRev) {
    next = mergeOnConflict(current, normalized);
    next.rev = currentRev;
  }

  const toWrite = { ...next, rev: currentRev + 1 };
  const updateSql = "UPDATE guild_settings SET data = $2, rev = $3, updated_at = NOW() WHERE guild_id = $1 AND rev = $4";
  logger.info("saveGuildDataPg (update): Executing SQL", { sql: updateSql, guildId, newRev: toWrite.rev, oldRev: currentRev });
  const update = await retry(async () => {
    return await p.query(
      updateSql,
      [guildId, toWrite, toWrite.rev, currentRev]
    );
  }, { retries: 3, minTimeout: 100, maxTimeout: 1000 });

  if (update.rowCount === 0) {
    // Retry once by reloading and merging
    const retrySelectSql = "SELECT data, rev FROM guild_settings WHERE guild_id = $1";
    logger.info("saveGuildDataPg (retry select): Executing SQL", { sql: retrySelectSql, guildId });
    const retryCurrent = await retry(async () => {
      return await p.query(retrySelectSql, [guildId]);
    }, { retries: 3, minTimeout: 100, maxTimeout: 1000 });
    const cur = retryCurrent.rows[0]?.data || current;
    const curRev = Number.isInteger(retryCurrent.rows[0]?.rev) ? retryCurrent.rows[0].rev : currentRev;
    const merged = mergeOnConflict(cur, toWrite);
    merged.rev = curRev;
    const final = { ...merged, rev: curRev + 1 };
    const finalUpdateSql = "UPDATE guild_settings SET data = $2, rev = $3, updated_at = NOW() WHERE guild_id = $1";
    logger.info("saveGuildDataPg (final update): Executing SQL", { sql: finalUpdateSql, guildId, newRev: final.rev });
    await retry(async () => {
      return await p.query(
        finalUpdateSql,
        [guildId, final, final.rev]
      );
    }, { retries: 3, minTimeout: 100, maxTimeout: 1000 });
    // Invalidate cache
    try {
      const rc = redisClient(); if (rc) await rc.del(`guild_data:${guildId}`);
    } catch (err) {
      logger.warn("Redis cache delete failed:", { error: err.message });
    }
    return final;
  }

  // Invalidate cache
  try {
    const rc = redisClient(); if (rc) await rc.del(`guild_data:${guildId}`);
  } catch (err) {
    logger.warn("Redis cache delete failed:", { error: err.message });
  }

  return toWrite;
}

// ==================== POOL MANAGEMENT ====================

// ── Pool event audit log ─────────────────────────────────────────────────
/**
 * Append an immutable event to agent_pool_events.
 * Fire-and-forget safe — errors are logged but never thrown.
 */
export async function logPoolEvent(poolId, actorUserId, eventType, targetId = null, payload = {}) {
  try {
    const p = getPool();
    await p.query(
      `INSERT INTO agent_pool_events (pool_id, actor_user_id, event_type, target_id, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [poolId, actorUserId, eventType, targetId ?? null, payload, Date.now()]
    );
  } catch (err) {
    logger.warn('logPoolEvent failed (non-fatal):', { err: err.message, poolId, eventType });
  }
}

// ── Pool role / permission helpers ────────────────────────────────────────
const ROLE_RANK = { owner: 4, manager: 3, contributor: 2, viewer: 1 };

/**
 * Returns the caller's role in a pool, or null if they have no membership.
 */
export async function getUserPoolRole(poolId, userId) {
  const p = getPool();
  const res = await p.query(
    "SELECT role FROM pool_members WHERE pool_id = $1 AND user_id = $2",
    [poolId, userId]
  );
  return res.rows[0]?.role ?? null;
}

/**
 * True if the user can manage the pool (owner or manager).
 * This is the single authority check — replaces all isMaster||owner patterns.
 */
export async function canManagePool(poolId, userId) {
  const role = await getUserPoolRole(poolId, userId);
  return role === 'owner' || role === 'manager';
}

export async function createPool(poolId, ownerUserId, name, visibility = 'private') {
  const p = getPool();
  const now = Date.now();
  const res = await p.query(
    `INSERT INTO agent_pools (pool_id, owner_user_id, name, visibility, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING pool_id, owner_user_id, name, visibility, created_at, updated_at, max_agents, recommended_deploy, is_featured;`,
    [poolId, ownerUserId, name, visibility, now, now]
  );
  const pool = res.rows[0];

  // Owner membership row
  await p.query(
    `INSERT INTO pool_members (pool_id, user_id, role, granted_by, granted_at)
     VALUES ($1, $2, 'owner', $3, $4) ON CONFLICT (pool_id, user_id) DO NOTHING`,
    [poolId, ownerUserId, ownerUserId, now]
  );

  // Seed stats row
  await p.query(
    `INSERT INTO pool_stats (pool_id, window_start, updated_at)
     VALUES ($1, $2, $3) ON CONFLICT (pool_id) DO NOTHING`,
    [poolId, now, now]
  );

  await logPoolEvent(poolId, ownerUserId, 'pool_created', poolId, { name, visibility });
  return pool;
}

export async function fetchPool(poolId) {
  const p = getPool();
  const res = await p.query(
    "SELECT pool_id, owner_user_id, name, visibility, created_at, updated_at, meta, max_agents, recommended_deploy, is_featured FROM agent_pools WHERE pool_id = $1",
    [poolId]
  );
  return res.rows[0] || null;
}

export async function fetchPools(visibility = null) {
  const p = getPool();
  let sql = "SELECT pool_id, owner_user_id, name, visibility, created_at, updated_at, max_agents, recommended_deploy, is_featured FROM agent_pools";
  const params = [];
  if (visibility) { sql += " WHERE visibility = $1"; params.push(visibility); }
  sql += " ORDER BY created_at DESC";
  const res = await p.query(sql, params);
  return res.rows;
}

export async function fetchPoolsByOwner(ownerUserId) {
  const p = getPool();
  const res = await p.query(
    "SELECT pool_id, owner_user_id, name, visibility, created_at, updated_at, max_agents, recommended_deploy, is_featured FROM agent_pools WHERE owner_user_id = $1 ORDER BY created_at DESC",
    [ownerUserId]
  );
  return res.rows;
}

export async function updatePool(poolId, updates, actorUserId = '') {
  const p = getPool();
  const now = Date.now();
  const fields = [];
  const values = [];
  let idx = 1;

  if (updates.name              !== undefined) { fields.push(`name = $${idx++}`);               values.push(updates.name); }
  if (updates.visibility        !== undefined) { fields.push(`visibility = $${idx++}`);          values.push(updates.visibility); }
  if (updates.meta              !== undefined) { fields.push(`meta = $${idx++}`);                values.push(updates.meta); }
  if (updates.max_agents        !== undefined) { fields.push(`max_agents = $${idx++}`);          values.push(updates.max_agents); }
  if (updates.recommended_deploy !== undefined) { fields.push(`recommended_deploy = $${idx++}`); values.push(updates.recommended_deploy); }
  if (updates.is_featured       !== undefined) { fields.push(`is_featured = $${idx++}`);         values.push(updates.is_featured); }

  fields.push(`updated_at = $${idx++}`);
  values.push(now);
  values.push(poolId);

  const res = await p.query(
    `UPDATE agent_pools SET ${fields.join(', ')} WHERE pool_id = $${idx} RETURNING pool_id`,
    values
  );
  if (res.rowCount > 0 && actorUserId) {
    const changed = Object.keys(updates).filter(k => updates[k] !== undefined);
    await logPoolEvent(poolId, actorUserId, 'pool_updated', poolId, { changed });
  }
  return res.rowCount > 0;
}

export async function deletePool(poolId, actorUserId = '') {
  const p = getPool();
  // Log before cascade-delete removes references
  if (actorUserId) await logPoolEvent(poolId, actorUserId, 'pool_deleted', poolId, {});
  const res = await p.query("DELETE FROM agent_pools WHERE pool_id = $1 RETURNING pool_id", [poolId]);
  return res.rowCount > 0;
}

/**
 * Hard-delete a pool, reassigning all its agents to targetPoolId first.
 * Runs in a transaction. Protects pool_goot27 from deletion.
 */
export async function deletePoolWithReassignment(poolId, targetPoolId, actorUserId) {
  if (poolId === 'pool_goot27') throw new Error('Cannot delete the default pool (pool_goot27).');
  const p = getPool();
  const now = Date.now();
  await p.query('BEGIN');
  try {
    // Reassign agents
    await p.query(
      "UPDATE agent_bots SET pool_id = $1, updated_at = $2 WHERE pool_id = $3",
      [targetPoolId, now, poolId]
    );
    // Remove members
    await p.query("DELETE FROM pool_members WHERE pool_id = $1", [poolId]);
    // Remove events (archive note: no separate archive table, just delete)
    await p.query("DELETE FROM pool_events WHERE pool_id = $1", [poolId]);
    // Remove contributions if table exists
    await p.query("DELETE FROM pool_contributions WHERE pool_id = $1", [poolId]).catch(() => {});
    // Delete pool
    await p.query("DELETE FROM agent_pools WHERE pool_id = $1", [poolId]);
    await p.query('COMMIT');
    await logPoolEvent(targetPoolId, actorUserId, 'pool_merged_in', poolId, { deletedPool: poolId }).catch(() => {});
    return { ok: true };
  } catch (err) {
    await p.query('ROLLBACK');
    throw err;
  }
}

/**
 * Transfer pool ownership to a new user.
 * Updates agent_pools.owner_user_id and pool_members roles atomically.
 */
export async function transferPool(poolId, newOwnerUserId, actorUserId) {
  const p = getPool();
  const now = Date.now();
  await p.query("UPDATE agent_pools SET owner_user_id = $1, updated_at = $2 WHERE pool_id = $3", [newOwnerUserId, now, poolId]);
  // Demote old owner to manager (preserve access), elevate new owner
  await p.query(
    `UPDATE pool_members SET role = 'manager' WHERE pool_id = $1 AND role = 'owner' AND user_id != $2`,
    [poolId, newOwnerUserId]
  );
  await p.query(
    `INSERT INTO pool_members (pool_id, user_id, role, granted_by, granted_at)
     VALUES ($1, $2, 'owner', $3, $4)
     ON CONFLICT (pool_id, user_id) DO UPDATE SET role = 'owner', granted_by = $3, granted_at = $4`,
    [poolId, newOwnerUserId, actorUserId, now]
  );
  await logPoolEvent(poolId, actorUserId, 'pool_transferred', newOwnerUserId, { newOwner: newOwnerUserId });
}

/**
 * Immediately revoke an agent token.
 * Only the contributor or a pool manager/owner may revoke.
 * Revoked is terminal — the agent cannot be reactivated.
 */
export async function revokeAgentToken(agentId, revokedBy) {
  const p = getPool();
  // Null out ciphertext so revoked tokens cannot be decrypted even if DB is compromised
  const res = await p.query(
    "UPDATE agent_bots SET status = 'revoked', token = NULL, enc_version = NULL, updated_at = $1 WHERE agent_id = $2 AND status != 'revoked' RETURNING agent_id, pool_id",
    [Date.now(), agentId]
  );
  if (res.rowCount > 0) {
    const poolId = res.rows[0].pool_id;
    await logPoolEvent(poolId, revokedBy, 'token_revoked', agentId, {});
  }
  return res.rowCount > 0;
}

export async function fetchAgentsByPool(poolId) {
  const p = getPool();
  // token field intentionally excluded — use fetchAgentToken(agentId) when needed
  const res = await p.query(
    `SELECT agent_id, client_id, tag, status, pool_id, contributed_by, enc_version, created_at, updated_at, profile
       FROM agent_bots WHERE pool_id = $1 ORDER BY created_at DESC`,
    [poolId]
  );
  return res.rows.map(row => ({ ...row, created_at: Number(row.created_at), updated_at: Number(row.updated_at) }));
}

export async function countAgentsByPool(poolId) {
  const p = getPool();
  const res = await p.query(
    "SELECT COUNT(*) as count FROM agent_bots WHERE pool_id = $1 AND status IN ('active','approved')",
    [poolId]
  );
  return Number(res.rows[0]?.count || 0);
}

// ── Pool stats ────────────────────────────────────────────────────────────
export async function fetchPoolStats(poolId) {
  const p = getPool();
  const res = await p.query("SELECT * FROM pool_stats WHERE pool_id = $1", [poolId]);
  return res.rows[0] || null;
}

export async function incrementPoolStat(poolId, field, amount = 1) {
  const p = getPool();
  const allowed = ['songs_played', 'total_deployments'];
  if (!allowed.includes(field)) throw new Error(`Unknown pool stat field: ${field}`);
  await p.query(
    `INSERT INTO pool_stats (pool_id, ${field}, updated_at, window_start)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT (pool_id) DO UPDATE
       SET ${field}   = pool_stats.${field} + $2,
           updated_at = $3`,
    [poolId, amount, Date.now()]
  );
}

/**
 * Fetch leaderboard: top N public pools sorted by composite_score (or field).
 */
export async function fetchPoolLeaderboard(limit = 10, field = 'composite_score') {
  const p = getPool();
  const allowed = ['composite_score', 'songs_played', 'total_deployments', 'active_guild_count'];
  if (!allowed.includes(field)) throw new Error(`Unknown leaderboard field: ${field}`);
  const res = await p.query(
    `SELECT ap.pool_id, ap.name, ap.owner_user_id, ap.visibility, ap.meta,
            ap.max_agents, ap.is_featured,
            ps.songs_played, ps.total_deployments, ps.active_guild_count,
            ps.composite_score,
            COUNT(ab.agent_id) FILTER (WHERE ab.status = 'active') AS active_agents
       FROM agent_pools ap
       LEFT JOIN pool_stats ps ON ap.pool_id = ps.pool_id
       LEFT JOIN agent_bots  ab ON ap.pool_id = ab.pool_id
      WHERE ap.visibility = 'public'
      GROUP BY ap.pool_id, ps.songs_played, ps.total_deployments, ps.active_guild_count, ps.composite_score
      ORDER BY ps.${field} DESC NULLS LAST
      LIMIT $1`,
    [limit]
  );
  return res.rows;
}

// ── Pool members ──────────────────────────────────────────────────────────
export async function fetchPoolMembers(poolId) {
  const p = getPool();
  const res = await p.query(
    "SELECT user_id, role, granted_by, granted_at FROM pool_members WHERE pool_id = $1 ORDER BY granted_at ASC",
    [poolId]
  );
  return res.rows;
}

export async function setPoolMemberRole(poolId, userId, role, grantedBy) {
  const p = getPool();
  await p.query(
    `INSERT INTO pool_members (pool_id, user_id, role, granted_by, granted_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (pool_id, user_id) DO UPDATE SET role = $3, granted_by = $4, granted_at = $5`,
    [poolId, userId, role, grantedBy, Date.now()]
  );
  await logPoolEvent(poolId, grantedBy, 'member_role_set', userId, { role });
}

export async function removePoolMember(poolId, userId, actorUserId) {
  const p = getPool();
  await p.query("DELETE FROM pool_members WHERE pool_id = $1 AND user_id = $2 AND role != 'owner'", [poolId, userId]);
  await logPoolEvent(poolId, actorUserId, 'member_removed', userId, {});
}

// ── Pool audit events ─────────────────────────────────────────────────────
export async function fetchPoolEvents(poolId, limit = 50) {
  const p = getPool();
  const res = await p.query(
    "SELECT id, actor_user_id, event_type, target_id, payload, created_at FROM agent_pool_events WHERE pool_id = $1 ORDER BY created_at DESC LIMIT $2",
    [poolId, limit]
  );
  return res.rows.map(r => ({ ...r, created_at: Number(r.created_at) }));
}

export async function getGuildSelectedPool(guildId) {
  const data = await loadGuildDataPg(guildId, () => ({ selectedPoolId: 'pool_goot27' }));
  return data.selectedPoolId || 'pool_goot27';
}

export async function setGuildSelectedPool(guildId, poolId) {
  const data = await loadGuildDataPg(guildId, () => ({ selectedPoolId: 'pool_goot27' }));
  data.selectedPoolId = poolId;
  return await saveGuildDataPg(
    guildId,
    data,
    d => d,
    (current, incoming) => ({ ...current, selectedPoolId: incoming.selectedPoolId })
  );
}

// Alias functions for pools.js compatibility
export async function listPools() {
  return fetchPools();
}

export async function fetchPoolAgents(poolId) {
  return fetchAgentsByPool(poolId);
}

// ==================== PET SYSTEM ====================

export async function createPet(userId, type, name) {
  const p = getPool();
  const sql = `
    INSERT INTO user_pets (user_id, pet_type, name, stats)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
  const stats = { level: 1, xp: 0, hunger: 100, mood: "happy" };
  const res = await p.query(sql, [userId, type, name, stats]);
  return res.rows[0];
}

export async function getUserPets(userId) {
  const p = getPool();
  const sql = "SELECT * FROM user_pets WHERE user_id = $1 ORDER BY created_at DESC";
  const res = await p.query(sql, [userId]);
  return res.rows;
}

export async function updatePetStats(petId, stats) {
  const p = getPool();
  const sql = "UPDATE user_pets SET stats = $1, updated_at = NOW() WHERE id = $2 RETURNING *";
  const res = await p.query(sql, [stats, petId]);
  return res.rows[0];
}

export async function deletePet(petId, userId) {
  const p = getPool();
  // Ensure user owns the pet
  const sql = "DELETE FROM user_pets WHERE id = $1 AND user_id = $2 RETURNING id";
  const res = await p.query(sql, [petId, userId]);
  return res.rowCount > 0;
}
export async function ensureEconomySchema() {
  const p = getPool();
  const queries = [
    `CREATE TABLE IF NOT EXISTS user_wallets (user_id TEXT PRIMARY KEY, balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0), bank BIGINT NOT NULL DEFAULT 0 CHECK (bank >= 0), bank_capacity BIGINT NOT NULL DEFAULT 10000, total_earned BIGINT NOT NULL DEFAULT 0, total_spent BIGINT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_wallets_balance ON user_wallets(balance DESC)`,
    `CREATE TABLE IF NOT EXISTS user_game_profiles (user_id TEXT PRIMARY KEY, xp BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0), level INT NOT NULL DEFAULT 1 CHECK (level >= 1), created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_game_profiles_level ON user_game_profiles(level DESC, xp DESC)`,
    `CREATE TABLE IF NOT EXISTS user_level_rewards (
      user_id TEXT NOT NULL,
      level INT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, level)
    )`,
    `CREATE TABLE IF NOT EXISTS user_daily_quests (
      user_id TEXT NOT NULL,
      day TEXT NOT NULL,
      quests JSONB NOT NULL,
      progress JSONB NOT NULL,
      claimed JSONB NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, day)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_daily_quests_day ON user_daily_quests(day)`,
    `CREATE TABLE IF NOT EXISTS user_inventory (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, item_id TEXT NOT NULL, quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0), metadata JSONB DEFAULT '{}', acquired_at BIGINT NOT NULL, UNIQUE(user_id, item_id))`,
    `CREATE INDEX IF NOT EXISTS idx_inventory_user ON user_inventory(user_id)`,
    `CREATE TABLE IF NOT EXISTS user_collections (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      item_id TEXT NOT NULL,
      rarity TEXT NOT NULL DEFAULT 'common',
      count INT NOT NULL DEFAULT 1 CHECK (count >= 1),
      first_caught BIGINT NOT NULL,
      last_caught BIGINT NOT NULL,
      best_size DECIMAL(10,2),
      UNIQUE(user_id, category, item_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_collections_user ON user_collections(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_collections_user_rarity ON user_collections(user_id, rarity)`,
    `CREATE TABLE IF NOT EXISTS user_streaks (user_id TEXT PRIMARY KEY, daily_streak INT NOT NULL DEFAULT 0, weekly_streak INT NOT NULL DEFAULT 0, last_daily BIGINT, last_weekly BIGINT, longest_daily INT NOT NULL DEFAULT 0, longest_weekly INT NOT NULL DEFAULT 0, streak_multiplier DECIMAL(3,2) NOT NULL DEFAULT 1.00 CHECK (streak_multiplier >= 1.00 AND streak_multiplier <= 5.00))`,
    `CREATE TABLE IF NOT EXISTS transaction_log (id SERIAL PRIMARY KEY, from_user TEXT, to_user TEXT, amount BIGINT NOT NULL, reason TEXT NOT NULL, metadata JSONB DEFAULT '{}', timestamp BIGINT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_time ON transaction_log(timestamp DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_guild ON transaction_log(from_user, to_user)`,
    `CREATE TABLE IF NOT EXISTS user_profile_privacy (
      user_id TEXT PRIMARY KEY,
      show_progress BOOLEAN NOT NULL DEFAULT TRUE,
      show_economy BOOLEAN NOT NULL DEFAULT TRUE,
      show_inventory BOOLEAN NOT NULL DEFAULT TRUE,
      show_usage BOOLEAN NOT NULL DEFAULT TRUE,
      show_activity BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_command_stats (
      user_id TEXT NOT NULL,
      command TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'slash',
      ok BIGINT NOT NULL DEFAULT 0,
      err BIGINT NOT NULL DEFAULT 0,
      total_ms BIGINT NOT NULL DEFAULT 0,
      count BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, command, source)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_command_stats_user ON user_command_stats(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_user_command_stats_runs ON user_command_stats(user_id, count DESC)`,

    // ── Per-guild stats & leveling ─────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS user_guild_stats (
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      vc_minutes BIGINT NOT NULL DEFAULT 0,
      vc_sessions BIGINT NOT NULL DEFAULT 0,
      messages_sent BIGINT NOT NULL DEFAULT 0,
      credits_earned BIGINT NOT NULL DEFAULT 0,
      credits_spent BIGINT NOT NULL DEFAULT 0,
      trades_completed BIGINT NOT NULL DEFAULT 0,
      items_sold BIGINT NOT NULL DEFAULT 0,
      work_runs BIGINT NOT NULL DEFAULT 0,
      gather_runs BIGINT NOT NULL DEFAULT 0,
      fight_wins BIGINT NOT NULL DEFAULT 0,
      trivia_wins BIGINT NOT NULL DEFAULT 0,
      trivia_runs BIGINT NOT NULL DEFAULT 0,
      heist_runs BIGINT NOT NULL DEFAULT 0,
      casino_wins BIGINT NOT NULL DEFAULT 0,
      agent_actions_used BIGINT NOT NULL DEFAULT 0,
      commands_used BIGINT NOT NULL DEFAULT 0,
      last_active BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, guild_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_guild_stats_guild ON user_guild_stats(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_guild_stats_vc ON user_guild_stats(guild_id, vc_minutes DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_guild_stats_msgs ON user_guild_stats(guild_id, messages_sent DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_guild_stats_user_guild ON user_guild_stats(user_id, guild_id)`,

    `CREATE TABLE IF NOT EXISTS user_guild_xp (
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      xp BIGINT NOT NULL DEFAULT 0,
      level INT NOT NULL DEFAULT 1,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, guild_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_guild_xp_board ON user_guild_xp(guild_id, xp DESC)`,

    `CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🏆',
      category TEXT NOT NULL DEFAULT 'general',
      xp_reward INT NOT NULL DEFAULT 0,
      credit_reward INT NOT NULL DEFAULT 0,
      rarity TEXT NOT NULL DEFAULT 'common'
    )`,

    `CREATE TABLE IF NOT EXISTS user_achievements (
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      unlocked_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, guild_id, achievement_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_achievements_guild ON user_achievements(guild_id, unlocked_at DESC)`,

    `CREATE TABLE IF NOT EXISTS guild_xp_config (
      guild_id TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT true,
      xp_per_message INT NOT NULL DEFAULT 5,
      xp_per_vc_minute INT NOT NULL DEFAULT 2,
      xp_per_work INT NOT NULL DEFAULT 40,
      xp_per_gather INT NOT NULL DEFAULT 30,
      xp_per_fight_win INT NOT NULL DEFAULT 50,
      xp_per_trivia_win INT NOT NULL DEFAULT 60,
      xp_per_daily INT NOT NULL DEFAULT 80,
      xp_per_command INT NOT NULL DEFAULT 1,
      xp_per_agent_action INT NOT NULL DEFAULT 20,
      message_xp_cooldown_s INT NOT NULL DEFAULT 60,
      xp_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
      levelup_channel_id TEXT,
      levelup_message TEXT NOT NULL DEFAULT 'GG {user}, you hit **level {level}**! 🎉',
      sync_global_xp BOOLEAN NOT NULL DEFAULT true,
      updated_at BIGINT NOT NULL DEFAULT 0
    )`,

    // ── Guild agent actions (economy) ──────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS guild_agent_actions (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      cost INT NOT NULL DEFAULT 100,
      cooldown_s INT NOT NULL DEFAULT 300,
      enabled BOOLEAN NOT NULL DEFAULT true,
      target_type TEXT NOT NULL DEFAULT 'any',
      config JSONB NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_actions_guild ON guild_agent_actions(guild_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_actions_unique ON guild_agent_actions(guild_id, action_type)`,

    `CREATE TABLE IF NOT EXISTS agent_action_uses (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      target_channel_id TEXT,
      cost_paid INT NOT NULL,
      used_at BIGINT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_action_uses_guild ON agent_action_uses(guild_id, used_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_action_uses_cooldown ON agent_action_uses(guild_id, user_id, action_type, used_at DESC)`
  ];
  
  for (const query of queries) {
    await p.query(query);
  }
  logger.info('Economy schema ensured');
}

// ── Per-guild stats functions ─────────────────────────────────────────────

export async function addGuildStat(userId, guildId, field, amount = 1) {
  if (!userId || !guildId || !field) return;
  const VALID_FIELDS = new Set([
    'vc_minutes','vc_sessions','messages_sent','credits_earned','credits_spent',
    'trades_completed','items_sold','work_runs','gather_runs','fight_wins',
    'trivia_wins','trivia_runs','heist_runs','casino_wins','agent_actions_used','commands_used'
  ]);
  if (!VALID_FIELDS.has(field)) return;
  const safeAmt = Math.max(0, Math.trunc(Number(amount) || 0));
  if (safeAmt === 0) return;
  const p = getPool();
  const now = Date.now();
  await p.query(
    `INSERT INTO user_guild_stats (user_id, guild_id, ${field}, last_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4, $4)
     ON CONFLICT (user_id, guild_id) DO UPDATE
       SET ${field} = user_guild_stats.${field} + $3,
           last_active = $4,
           updated_at = $4`,
    [userId, guildId, safeAmt, now]
  );
}

export async function getGuildStats(userId, guildId) {
  const p = getPool();
  const res = await p.query(
    `SELECT * FROM user_guild_stats WHERE user_id = $1 AND guild_id = $2`,
    [userId, guildId]
  );
  return res.rows[0] || null;
}

export async function getGuildLeaderboard(guildId, field, limit = 10, offset = 0) {
  const VALID_FIELDS = new Set([
    'vc_minutes','messages_sent','credits_earned','work_runs','gather_runs',
    'fight_wins','trivia_wins','commands_used','agent_actions_used'
  ]);
  if (!VALID_FIELDS.has(field)) return [];
  const p = getPool();
  const res = await p.query(
    `SELECT user_id, ${field} as value FROM user_guild_stats
     WHERE guild_id = $1 AND ${field} > 0
     ORDER BY ${field} DESC
     LIMIT $2 OFFSET $3`,
    [guildId, Math.min(limit, 50), offset]
  );
  return res.rows;
}

export async function getGuildXpLeaderboard(guildId, limit = 10, offset = 0) {
  const p = getPool();
  const res = await p.query(
    `SELECT user_id, xp, level FROM user_guild_xp
     WHERE guild_id = $1 AND xp > 0
     ORDER BY xp DESC
     LIMIT $2 OFFSET $3`,
    [guildId, Math.min(limit, 50), offset]
  );
  return res.rows;
}

export async function getGuildXpConfig(guildId) {
  const p = getPool();
  const res = await p.query(
    `SELECT * FROM guild_xp_config WHERE guild_id = $1`,
    [guildId]
  );
  return res.rows[0] || null;
}

export async function upsertGuildXpConfig(guildId, fields) {
  const ALLOWED = new Set([
    'enabled','xp_per_message','xp_per_vc_minute','xp_per_work','xp_per_gather',
    'xp_per_fight_win','xp_per_trivia_win','xp_per_daily','xp_per_command',
    'xp_per_agent_action','message_xp_cooldown_s','xp_multiplier',
    'levelup_channel_id','levelup_message','sync_global_xp'
  ]);
  const safe = {};
  for (const [k, v] of Object.entries(fields)) {
    if (ALLOWED.has(k)) safe[k] = v;
  }
  if (!Object.keys(safe).length) return;
  const now = Date.now();
  const keys = Object.keys(safe);
  const vals = Object.values(safe);
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const p = getPool();
  await p.query(
    `INSERT INTO guild_xp_config (guild_id, updated_at, ${keys.join(', ')})
     VALUES ($1, ${now}, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (guild_id) DO UPDATE SET updated_at = ${now}, ${setClauses}`,
    [guildId, ...vals]
  );
}

export async function addGuildXpRow(userId, guildId, amount) {
  if (!amount || amount <= 0) return { leveledUp: false, fromLevel: 1, toLevel: 1, xp: 0 };
  const p = getPool();
  const now = Date.now();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `INSERT INTO user_guild_xp (user_id, guild_id, xp, level, updated_at)
       VALUES ($1, $2, 0, 1, $3)
       ON CONFLICT (user_id, guild_id) DO UPDATE SET updated_at = $3
       RETURNING xp, level`,
      [userId, guildId, now]
    );
    const { xp: oldXp, level: oldLevel } = cur.rows[0];
    const newXp = Number(oldXp) + amount;
    const newLevel = levelFromXp(newXp);
    await client.query(
      `UPDATE user_guild_xp SET xp = $1, level = $2, updated_at = $3
       WHERE user_id = $4 AND guild_id = $5`,
      [newXp, newLevel, now, userId, guildId]
    );
    await client.query('COMMIT');
    return { leveledUp: newLevel > Number(oldLevel), fromLevel: Number(oldLevel), toLevel: newLevel, xp: newXp };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function getUserAchievements(userId, guildId) {
  const p = getPool();
  const res = await p.query(
    `SELECT ua.achievement_id, ua.unlocked_at, a.name, a.emoji, a.description, a.rarity, a.xp_reward, a.credit_reward, a.category
     FROM user_achievements ua
     JOIN achievements a ON ua.achievement_id = a.id
     WHERE ua.user_id = $1 AND ua.guild_id = $2
     ORDER BY ua.unlocked_at DESC`,
    [userId, guildId]
  );
  return res.rows;
}

export async function grantAchievement(userId, guildId, achievementId) {
  const p = getPool();
  const now = Date.now();
  const res = await p.query(
    `INSERT INTO user_achievements (user_id, guild_id, achievement_id, unlocked_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, guild_id, achievement_id) DO NOTHING
     RETURNING achievement_id`,
    [userId, guildId, achievementId, now]
  );
  return res.rows.length > 0; // true if newly granted
}

export async function seedAchievements(defs) {
  if (!defs.length) return;
  const p = getPool();
  for (const d of defs) {
    await p.query(
      `INSERT INTO achievements (id, name, description, emoji, category, xp_reward, credit_reward, rarity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = $2, description = $3, emoji = $4, category = $5,
         xp_reward = $6, credit_reward = $7, rarity = $8`,
      [d.id, d.name, d.description, d.emoji || '🏆', d.category || 'general',
       d.xp_reward || 0, d.credit_reward || 0, d.rarity || 'common']
    );
  }
}

// ── Specializations ───────────────────────────────────────────────────────
export const SPECIALTIES = ['music', 'voice_assistant', 'utility', 'relay', 'custom'];

export async function setAgentSpecialty(agentId, specialty) {
  if (!SPECIALTIES.includes(specialty)) throw new Error(`Invalid specialty: ${specialty}`);
  const p = getPool();
  await p.query("UPDATE agent_bots SET specialty = $1 WHERE agent_id = $2", [specialty, agentId]);
}

export async function setPoolSpecialty(poolId, specialty, actorUserId = '') {
  if (!SPECIALTIES.includes(specialty)) throw new Error(`Invalid specialty: ${specialty}`);
  const p = getPool();
  await p.query(
    "UPDATE agent_pools SET specialty = $1 WHERE pool_id = $2",
    [specialty, poolId]
  );
  // Also persist into meta for display consistency
  await p.query(
    "UPDATE agent_pools SET meta = jsonb_set(COALESCE(meta,'{}'), '{specialty}', $1::jsonb) WHERE pool_id = $2",
    [JSON.stringify(specialty), poolId]
  );
  await logPoolEvent(poolId, actorUserId, 'specialty_set', poolId, { specialty });
}

// ── Guild multi-pool config ───────────────────────────────────────────────
export async function getGuildPoolConfig(guildId) {
  const p = getPool();
  const res = await p.query("SELECT * FROM guild_pool_config WHERE guild_id = $1", [guildId]);
  return res.rows[0] || null;
}

export async function setGuildPoolConfig(guildId, { primaryPoolId, secondaryPoolIds = [], preferredSpecialty = 'music' }) {
  const p = getPool();
  const ids = Array.isArray(secondaryPoolIds) ? secondaryPoolIds.slice(0, 2) : [];
  await p.query(
    `INSERT INTO guild_pool_config (guild_id, primary_pool_id, secondary_pool_ids, preferred_specialty, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (guild_id) DO UPDATE SET
       primary_pool_id     = EXCLUDED.primary_pool_id,
       secondary_pool_ids  = EXCLUDED.secondary_pool_ids,
       preferred_specialty = EXCLUDED.preferred_specialty,
       updated_at          = EXCLUDED.updated_at`,
    [guildId, primaryPoolId || null, JSON.stringify(ids), preferredSpecialty, Date.now()]
  );
}

export async function addGuildSecondaryPool(guildId, poolId) {
  const config = await getGuildPoolConfig(guildId);
  const current = Array.isArray(config?.secondary_pool_ids) ? config.secondary_pool_ids : [];
  if (current.includes(poolId)) return; // already added
  if (current.length >= 2) throw new Error('Maximum 2 secondary pools allowed per guild.');
  const updated = [...current, poolId];
  // Auto-seed primary from legacy selected pool if not yet set
  let primaryId = config?.primary_pool_id;
  if (!primaryId) {
    primaryId = await getGuildSelectedPool(guildId).catch(() => null);
  }
  await setGuildPoolConfig(guildId, {
    primaryPoolId: primaryId,
    secondaryPoolIds: updated,
    preferredSpecialty: config?.preferred_specialty || 'music',
  });
}

export async function removeGuildSecondaryPool(guildId, poolId) {
  const config = await getGuildPoolConfig(guildId);
  const current = Array.isArray(config?.secondary_pool_ids) ? config.secondary_pool_ids : [];
  await setGuildPoolConfig(guildId, {
    primaryPoolId: config?.primary_pool_id,
    secondaryPoolIds: current.filter(id => id !== poolId),
    preferredSpecialty: config?.preferred_specialty || 'music',
  });
}

// ── Pool alliances ────────────────────────────────────────────────────────
export async function proposeAlliance(poolAId, poolBId, initiatedBy) {
  const p = getPool();
  // Canonical ordering: smaller pool_id first
  const [a, b] = [poolAId, poolBId].sort();
  const now = Date.now();
  await p.query(
    `INSERT INTO pool_alliances (pool_a_id, pool_b_id, initiated_by, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', $4, $4)
     ON CONFLICT (pool_a_id, pool_b_id) DO UPDATE SET
       initiated_by = EXCLUDED.initiated_by,
       status       = 'pending',
       updated_at   = EXCLUDED.updated_at`,
    [a, b, initiatedBy, now]
  );
  await logPoolEvent(poolAId, initiatedBy, 'alliance_proposed', poolBId, {});
}

export async function acceptAlliance(poolAId, poolBId, actorUserId) {
  const p = getPool();
  const [a, b] = [poolAId, poolBId].sort();
  const now = Date.now();
  await p.query(
    "UPDATE pool_alliances SET status = 'active', updated_at = $1 WHERE pool_a_id = $2 AND pool_b_id = $3",
    [now, a, b]
  );
  await logPoolEvent(poolBId, actorUserId, 'alliance_accepted', poolAId, {});
}

export async function dissolveAlliance(poolAId, poolBId, actorUserId) {
  const p = getPool();
  const [a, b] = [poolAId, poolBId].sort();
  const now = Date.now();
  await p.query(
    "UPDATE pool_alliances SET status = 'dissolved', updated_at = $1 WHERE pool_a_id = $2 AND pool_b_id = $3",
    [now, a, b]
  );
  await logPoolEvent(poolAId, actorUserId, 'alliance_dissolved', poolBId, {});
}

export async function fetchPoolAlliances(poolId, status = 'active') {
  const p = getPool();
  const res = await p.query(
    `SELECT pa.*, 
            CASE WHEN pa.pool_a_id = $1 THEN pa.pool_b_id ELSE pa.pool_a_id END AS partner_pool_id
     FROM pool_alliances pa
     WHERE (pa.pool_a_id = $1 OR pa.pool_b_id = $1)
       AND ($2 IS NULL OR pa.status = $2)
     ORDER BY pa.updated_at DESC`,
    [poolId, status || null]
  );
  return res.rows;
}

// ── Badge system ──────────────────────────────────────────────────────────
export const BADGE_DEFS = [
  { id: 'founding_pool',    emoji: '🏛️',  label: 'Founding Pool',     desc: 'Among the first pools created' },
  { id: 'first_10',        emoji: '🤝',  label: 'Growing Team',       desc: 'Reached 10 active agents' },
  { id: 'songs_100',       emoji: '🎵',  label: 'Tune Smith',         desc: '100 songs played' },
  { id: 'songs_1000',      emoji: '🎶',  label: 'Stage Veteran',      desc: '1,000 songs played' },
  { id: 'songs_10000',     emoji: '🎸',  label: 'Concert Hall',       desc: '10,000 songs played' },
  { id: 'deploys_5',       emoji: '🚀',  label: 'Launcher',           desc: '5 successful deployments' },
  { id: 'deploys_50',      emoji: '🛸',  label: 'Fleet Commander',    desc: '50 deployments' },
  { id: 'guilds_3',        emoji: '🌍',  label: 'Multi-Server',       desc: 'Active in 3+ guilds' },
  { id: 'rising_pool',     emoji: '📈',  label: 'Rising Pool',        desc: 'Top 10 on leaderboard' },
  { id: 'allied',          emoji: '🤜🤛', label: 'Allied',             desc: 'Has an active pool alliance' },
  { id: 'full_capacity',   emoji: '💪',  label: 'Full Roster',        desc: 'Reached pool capacity of 49' },
];

/**
 * Evaluate and award any newly earned badges to a pool.
 * Safe to call after any stat update — no-ops if no new badges.
 */
export async function evaluatePoolBadges(poolId) {
  const p = getPool();
  try {
    const [statsRes, agentRes, allianceRes, poolRes] = await Promise.all([
      p.query("SELECT * FROM pool_stats WHERE pool_id = $1", [poolId]),
      p.query("SELECT COUNT(*) AS cnt FROM agent_bots WHERE pool_id = $1 AND status = 'active'", [poolId]),
      p.query("SELECT COUNT(*) AS cnt FROM pool_alliances WHERE (pool_a_id = $1 OR pool_b_id = $1) AND status = 'active'", [poolId]),
      p.query("SELECT created_at, max_agents FROM agent_pools WHERE pool_id = $1", [poolId]),
    ]);
    const stats   = statsRes.rows[0] || {};
    const activeAgents = Number(agentRes.rows[0]?.cnt || 0);
    const hasAlliance  = Number(allianceRes.rows[0]?.cnt || 0) > 0;
    const maxAgents    = Number(poolRes.rows[0]?.max_agents || 49);
    const songs        = Number(stats.songs_played || 0);
    const deploys      = Number(stats.total_deployments || 0);
    const guilds       = Number(stats.active_guild_count || 0);
    const score        = Number(stats.composite_score || 0);

    // Recalculate composite_score
    const newScore = Math.floor(songs * 1 + deploys * 10 + guilds * 50 + activeAgents * 5);
    if (newScore !== Number(stats.composite_score || 0)) {
      await p.query(
        "UPDATE pool_stats SET composite_score = $1, updated_at = $2 WHERE pool_id = $3",
        [newScore, Date.now(), poolId]
      ).catch(() => {});
    }

    const currentBadges = Array.isArray(stats.badges_json) ? stats.badges_json : [];
    const earned = new Set(currentBadges);
    const checks = [
      ['first_10',      activeAgents >= 10],
      ['songs_100',     songs >= 100],
      ['songs_1000',    songs >= 1000],
      ['songs_10000',   songs >= 10000],
      ['deploys_5',     deploys >= 5],
      ['deploys_50',    deploys >= 50],
      ['guilds_3',      guilds >= 3],
      ['allied',        hasAlliance],
      ['full_capacity', activeAgents >= maxAgents],
    ];
    let changed = false;
    for (const [id, condition] of checks) {
      if (condition && !earned.has(id)) { earned.add(id); changed = true; }
    }
    if (changed) {
      await p.query(
        `INSERT INTO pool_stats (pool_id, badges_json, updated_at, window_start)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (pool_id) DO UPDATE SET badges_json = $2, updated_at = $3`,
        [poolId, JSON.stringify([...earned]), Date.now()]
      );
    }
  } catch (err) {
    logger.warn('[evaluatePoolBadges] error', { poolId, err: err.message });
  }
}

// ── Cross-pool deployment helpers ─────────────────────────────────────────
/**
 * Fetch all pool IDs configured for a guild (primary + secondaries).
 */
export async function getGuildAllPoolIds(guildId) {
  const config = await getGuildPoolConfig(guildId);
  if (!config) {
    // Fall back to legacy selected pool
    const legacy = await getGuildSelectedPool(guildId);
    return legacy ? [legacy] : [];
  }
  const ids = [];
  if (config.primary_pool_id) ids.push(config.primary_pool_id);
  const sec = Array.isArray(config.secondary_pool_ids) ? config.secondary_pool_ids : [];
  for (const id of sec) { if (id && !ids.includes(id)) ids.push(id); }
  return ids;
}

/**
 * Get pools sorted by specialty match score for a given preferred specialty.
 * Returns pools with an added `match_score` field.
 */
export async function rankPoolsBySpecialty(poolIds, preferredSpecialty) {
  if (!poolIds.length) return [];
  const p = getPool();
  const res = await p.query(
    `SELECT p.*, ps.composite_score, ps.songs_played, ps.total_deployments
     FROM agent_pools p
     LEFT JOIN pool_stats ps ON p.pool_id = ps.pool_id
     WHERE p.pool_id = ANY($1)`,
    [poolIds]
  );
  return res.rows.map(pool => ({
    ...pool,
    match_score: pool.specialty === preferredSpecialty ? 100 : 50,
  })).sort((a, b) => b.match_score - a.match_score || (b.composite_score || 0) - (a.composite_score || 0));
}

// ── Pool Contribution Review ──────────────────────────────────────────────

export async function fetchPoolContributions(poolId, status = null) {
  const p = getPool();
  let sql = "SELECT * FROM pool_contributions WHERE pool_id = $1";
  const params = [poolId];
  if (status) { sql += ` AND status = $${params.length + 1}`; params.push(status); }
  sql += " ORDER BY submitted_at DESC";
  const res = await p.query(sql, params);
  return res.rows;
}

export async function approveContribution(contributionId, reviewerUserId) {
  const p = getPool();
  const now = Date.now();
  const res = await p.query(
    "UPDATE pool_contributions SET status = 'approved', reviewed_at = $1, reviewed_by = $2 WHERE contribution_id = $3 RETURNING *",
    [now, reviewerUserId, contributionId]
  );
  if (!res.rows[0]) throw new Error('Contribution not found');
  const contrib = res.rows[0];
  await p.query("UPDATE agent_bots SET status = 'active', updated_at = $1 WHERE agent_id = $2", [now, contrib.agent_id]);
  await logPoolEvent(contrib.pool_id, reviewerUserId, 'contribution_approved', contrib.agent_id, { contributionId }).catch(() => {});
  return contrib;
}

export async function rejectContribution(contributionId, reviewerUserId, notes = '') {
  const p = getPool();
  const now = Date.now();
  const res = await p.query(
    "UPDATE pool_contributions SET status = 'rejected', reviewed_at = $1, reviewed_by = $2, notes = $3 WHERE contribution_id = $4 RETURNING *",
    [now, reviewerUserId, notes, contributionId]
  );
  if (!res.rows[0]) throw new Error('Contribution not found');
  const contrib = res.rows[0];
  await p.query("UPDATE agent_bots SET status = 'inactive', updated_at = $1 WHERE agent_id = $2", [now, contrib.agent_id]);
  await logPoolEvent(contrib.pool_id, reviewerUserId, 'contribution_rejected', contrib.agent_id, { contributionId, notes }).catch(() => {});
  return contrib;
}

export async function approveAllContributions(poolId, reviewerUserId) {
  const p = getPool();
  const pending = await fetchPoolContributions(poolId, 'pending');
  const results = [];
  for (const c of pending) {
    try { results.push(await approveContribution(c.contribution_id, reviewerUserId)); } catch {}
  }
  return results;
}
