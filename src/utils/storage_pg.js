import { Pool } from "pg";
import crypto from "node:crypto"; // Added for encryption
import retry from "async-retry";
import { createClient } from "redis";
import { logger } from "./logger.js";

let pool = null;
let redisClient = null;

const REDIS_URL = process.env.REDIS_URL || "";
if (REDIS_URL) {
  redisClient = createClient({ url: REDIS_URL });
  redisClient.on("error", () => {});
  redisClient.connect().catch(() => {});
}

export async function closeStoragePg() {
  // Intended for short-lived scripts (migrations/diagnostics), not the long-running bot.
  try {
    if (pool) await pool.end().catch(() => {});
  } finally {
    pool = null;
  }

  try {
    if (redisClient) {
      // Prefer quit() to flush pending commands; fall back to disconnect if needed.
      await redisClient.quit().catch(() => redisClient.disconnect?.());
    }
  } finally {
    redisClient = null;
  }
}

export function getPool() {
  logger.info("--> getPool() called in storage_pg.js");
  if (pool) return pool;
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    const error = new Error("POSTGRES_URL missing");
    logger.error("Error in getPool():", { error: error.message });
    throw error;
  }
  try {
    pool = new Pool({ connectionString: url });
    pool.on("error", (err) => {
      logger.error("PostgreSQL pool error (from event listener):", { error: err.message });
    });
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
  logger.info("--> ensureSchema() called in storage_pg.js");
  logger.info("--> Calling getPool() from ensureSchema()"); // New diagnostic log
  const p = getPool();

  try {
    logger.info("Attempting to create guild_settings table...");
    await p.query(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        rev INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    logger.info("guild_settings table created or already exists.");
  } catch (err) {
    logger.error("Error creating guild_settings table:", { error: err.message });
    throw err;
  }

  try {
    logger.info("Attempting to create audit_log table...");
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
    logger.info("audit_log table created or already exists.");
  } catch (err) {
    logger.error("Error creating audit_log table:", { error: err.message });
    throw err;
  }

  try {
    logger.info("Attempting to create command_stats table...");
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
    logger.info("command_stats table created or already exists.");
  } catch (err) {
    logger.error("Error creating command_stats table:", { error: err.message });
    throw err;
  }

  try {
    logger.info("Attempting to create command_stats_daily table...");
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
    logger.info("command_stats_daily table created or already exists.");
  } catch (err) {
    logger.error("Error creating command_stats_daily table:", { error: err.message });
    throw err;
  }

  // New agent_bots table (renamed from agent_tokens, timestamps as BIGINT)
  try {
    logger.info("Attempting to create agent_bots table...");
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
    logger.info("ensureSchema: Executing SQL:", { sql: createTableSql });
    await p.query(createTableSql);
    logger.info("agent_bots table created or already exists.");
  } catch (err) {
    logger.error("Error creating agent_bots table:", { error: err.message });
    throw err;
  }

  // New agent_pools table - manages pool ownership and visibility
  try {
    logger.info("Attempting to create agent_pools table...");
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
    logger.info("ensureSchema: Executing SQL:", { sql: createPoolsTableSql });
    await p.query(createPoolsTableSql);
    logger.info("agent_pools table created or already exists.");
  } catch (err) {
    logger.error("Error creating agent_pools table:", { error: err.message });
    throw err;
  }

  // Create default pool for goot27 if it doesn't exist
  try {
    logger.info("Ensuring default pool_goot27 exists...");
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
    logger.info("Default pool_goot27 ensured.");
  } catch (err) {
    logger.error("Error ensuring default pool:", { error: err.message });
    // Don't throw - pool might already exist
  }

  // Create indices for performance
  try {
    logger.info("Creating indices for agent_pools...");
    await p.query('CREATE INDEX IF NOT EXISTS idx_agent_bots_pool_id ON agent_bots(pool_id);');
    await p.query('CREATE INDEX IF NOT EXISTS idx_agent_pools_owner ON agent_pools(owner_user_id);');
    await p.query('CREATE INDEX IF NOT EXISTS idx_agent_pools_visibility ON agent_pools(visibility);');
    logger.info("Indices created.");
  } catch (err) {
    logger.error("Error creating indices:", { error: err.message });
    // Don't throw - indices might already exist
  }

  // New agent_runners table
  try {
    logger.info("Attempting to create agent_runners table...");
    const createRunnerTableSql = `
      CREATE TABLE IF NOT EXISTS agent_runners (
        runner_id TEXT PRIMARY KEY,
        last_seen BIGINT NOT NULL,
        meta JSONB
      );
    `;
    logger.info("ensureSchema: Executing SQL:", { sql: createRunnerTableSql });
    await p.query(createRunnerTableSql);
    logger.info("agent_runners table created or already exists.");
  } catch (err) {
    logger.error("Error creating agent_runners table:", { error: err.message });
    throw err;
  }
  
  try {
    logger.info("Attempting to alter agent_bots table to add profile column...");
    const alterTableSql = `
      ALTER TABLE agent_bots
      ADD COLUMN IF NOT EXISTS profile JSONB;
    `;
    logger.info("ensureSchema: Executing SQL:", { sql: alterTableSql });
    await p.query(alterTableSql);
    logger.info("agent_bots table altered or already up-to-date.");
  } catch (err) {
    logger.error("Error altering agent_bots table:", { error: err.message });
    throw err;
  }

  // New user_pets table
  try {
    logger.info("Attempting to create user_pets table...");
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
    logger.info("user_pets table created or already exists.");
  } catch (err) {
    logger.error("Error creating user_pets table:", { error: err.message });
    throw err;
  }

  // Migration: Add pool_id to existing agent_bots if not present
  try {
    logger.info("Attempting to add pool_id column to agent_bots if not exists...");
    const addPoolIdSql = `
      ALTER TABLE agent_bots
      ADD COLUMN IF NOT EXISTS pool_id TEXT DEFAULT 'pool_goot27';
    `;
    await p.query(addPoolIdSql);
    logger.info("pool_id column ensured in agent_bots.");
  } catch (err) {
    logger.error("Error adding pool_id to agent_bots:", { error: err.message });
    // Don't throw - column might already exist
  }

  // Migration: Add selected_pool_id to guild_settings
  try {
    logger.info("Attempting to add selected_pool_id column to guild_settings...");
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
      logger.info("Guild settings uses JSONB data column. Pool selection will be stored in data.selectedPoolId");
    }
  } catch (err) {
    logger.error("Error checking guild_settings structure:", { error: err.message });
  }
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

export async function insertAgentBot(agentId, token, clientId, tag, poolId = 'pool_goot27', contributedBy = '') {
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

  const upsertSql = `
    INSERT INTO agent_bots
      (agent_id, token, client_id, tag, pool_id, contributed_by, enc_version, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
  const res = await p.query(upsertSql, [agentId, ciphertext, clientId, tag, poolId, resolvedContributor, encVersion, now, now]);
  const row = res.rows[0];

  // Ensure contributor has a pool_members row
  await p.query(`
    INSERT INTO pool_members (pool_id, user_id, role, granted_by, granted_at)
    VALUES ($1, $2, 'contributor', $3, $4)
    ON CONFLICT (pool_id, user_id) DO NOTHING;
  `, [poolId, resolvedContributor, resolvedContributor, now]);

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
    const check = await p.query("SELECT status FROM agent_bots WHERE agent_id = $1", [agentId]);
    if (check.rows[0]?.status === 'revoked') {
      throw new Error(`Agent ${agentId} is revoked and cannot be reactivated.`);
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
  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
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
    if (redisClient) {
      try {
        await redisClient.setEx(cacheKey, 300, JSON.stringify(base)); // Cache for 5 min
      } catch (err) {
        logger.warn("Redis cache write failed:", { error: err.message });
      }
    }
    return base;
  }
  const row = res.rows[0];
  const data = row.data || fallbackFactory();
  data.rev = Number.isInteger(row.rev) ? row.rev : data.rev ?? 0;

  if (redisClient) {
    try {
      await redisClient.setEx(cacheKey, 300, JSON.stringify(data));
    } catch (err) {
      logger.warn("Redis cache write failed:", { error: err.message });
    }
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
    if (redisClient) {
      try {
        await redisClient.del(`guild_data:${guildId}`);
      } catch (err) {
        logger.warn("Redis cache delete failed:", { error: err.message });
      }
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
    if (redisClient) {
      try {
        await redisClient.del(`guild_data:${guildId}`);
      } catch (err) {
        logger.warn("Redis cache delete failed:", { error: err.message });
      }
    }
    return final;
  }

  // Invalidate cache
  if (redisClient) {
    try {
      await redisClient.del(`guild_data:${guildId}`);
    } catch (err) {
      logger.warn("Redis cache delete failed:", { error: err.message });
    }
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
  const res = await p.query(
    "UPDATE agent_bots SET status = 'revoked', updated_at = $1 WHERE agent_id = $2 AND status != 'revoked' RETURNING agent_id, pool_id",
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
    `CREATE INDEX IF NOT EXISTS idx_user_command_stats_runs ON user_command_stats(user_id, count DESC)`
  ];
  
  for (const query of queries) {
    await p.query(query);
  }
  logger.info('Economy schema ensured');
}
