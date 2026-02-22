export default {
  description: "Agent pool system revamp: contributed_by, enc_version, status expansion, pool_members, agent_pool_events, pool_stats, capacity columns",
  async up(client) {

    // ── 1. Extend agent_bots ──────────────────────────────────────────────
    await client.query(`
      ALTER TABLE agent_bots
        ADD COLUMN IF NOT EXISTS contributed_by TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS enc_version    INT  NOT NULL DEFAULT 1;
    `);

    // Backfill contributed_by from the owning pool's owner for existing rows
    await client.query(`
      UPDATE agent_bots ab
         SET contributed_by = ap.owner_user_id
        FROM agent_pools ap
       WHERE ab.pool_id       = ap.pool_id
         AND ab.contributed_by = '';
    `);

    // Expand status constraint to include all lifecycle states.
    // 'inactive' kept for backward compat; UI maps it to 'pending'.
    await client.query(`ALTER TABLE agent_bots DROP CONSTRAINT IF EXISTS agent_bots_status_check;`);
    await client.query(`
      ALTER TABLE agent_bots
        ADD CONSTRAINT agent_bots_status_check
        CHECK (status IN ('inactive','pending','approved','active','suspended','revoked'));
    `);

    // ── 2. Extend agent_pools ─────────────────────────────────────────────
    await client.query(`
      ALTER TABLE agent_pools
        ADD COLUMN IF NOT EXISTS max_agents         INT     NOT NULL DEFAULT 49,
        ADD COLUMN IF NOT EXISTS recommended_deploy INT     NOT NULL DEFAULT 10,
        ADD COLUMN IF NOT EXISTS is_featured        BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    // ── 3. pool_members — role tiers ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS pool_members (
        pool_id    TEXT NOT NULL REFERENCES agent_pools(pool_id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL,
        role       TEXT NOT NULL CHECK (role IN ('owner','manager','contributor','viewer')),
        granted_by TEXT NOT NULL DEFAULT '',
        granted_at BIGINT NOT NULL,
        PRIMARY KEY (pool_id, user_id)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pool_members_user ON pool_members(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pool_members_pool ON pool_members(pool_id, role);`);

    // Backfill: existing pool owners → 'owner' membership row
    await client.query(`
      INSERT INTO pool_members (pool_id, user_id, role, granted_by, granted_at)
        SELECT pool_id, owner_user_id, 'owner', owner_user_id, created_at
          FROM agent_pools
        ON CONFLICT (pool_id, user_id) DO NOTHING;
    `);

    // Backfill: existing contributors → 'contributor' membership row
    await client.query(`
      INSERT INTO pool_members (pool_id, user_id, role, granted_by, granted_at)
        SELECT DISTINCT pool_id, contributed_by, 'contributor', contributed_by, created_at
          FROM agent_bots
         WHERE contributed_by != ''
           AND status != 'revoked'
        ON CONFLICT (pool_id, user_id) DO NOTHING;
    `);

    // ── 4. agent_pool_events — immutable audit log ────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_pool_events (
        id            BIGSERIAL PRIMARY KEY,
        pool_id       TEXT   NOT NULL,
        actor_user_id TEXT   NOT NULL,
        event_type    TEXT   NOT NULL,
        target_id     TEXT,
        payload       JSONB,
        created_at    BIGINT NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ape_pool   ON agent_pool_events(pool_id,       created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ape_actor  ON agent_pool_events(actor_user_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ape_target ON agent_pool_events(target_id,     created_at DESC);`);

    // ── 5. pool_stats — 30-day rolling metrics ───────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS pool_stats (
        pool_id             TEXT           PRIMARY KEY REFERENCES agent_pools(pool_id) ON DELETE CASCADE,
        songs_played        BIGINT         NOT NULL DEFAULT 0,
        total_deployments   BIGINT         NOT NULL DEFAULT 0,
        active_guild_count  INT            NOT NULL DEFAULT 0,
        agent_uptime_score  NUMERIC(5,2)   NOT NULL DEFAULT 0,
        contribution_score  NUMERIC(5,2)   NOT NULL DEFAULT 0,
        composite_score     NUMERIC(8,2)   NOT NULL DEFAULT 0,
        window_start        BIGINT         NOT NULL DEFAULT 0,
        updated_at          BIGINT         NOT NULL DEFAULT 0
      );
    `);

    // Seed a stats row for every existing pool
    await client.query(`
      INSERT INTO pool_stats (pool_id, window_start, updated_at)
        SELECT pool_id, created_at, created_at FROM agent_pools
        ON CONFLICT (pool_id) DO NOTHING;
    `);
  }
};
