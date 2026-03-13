# Agent Pool Architecture Map

Date: 2026-02-15
Scope: current production contracts in Chopsticks (no behavior changes)

## 1) Controller <-> Agent handshake and protocol

Protocol version:
- Controller: `PROTOCOL_VERSION = "1.0.0"`, `SUPPORTED_VERSIONS = ["1.0.0"]`
- Agent runner: `PROTOCOL_VERSION = "1.0.0"`

Message directions:
- Agent -> Controller: `hello`, `guilds`, `event`, `resp`
- Controller -> Agent: `req`

Handshake sequence:
1. Agent runner opens WS to `AGENT_CONTROL_URL` (default `ws://127.0.0.1:8787`).
2. Agent sends `hello` with `protocolVersion`, `agentId`, `botUserId`, `tag`, `ready`, `guildIds`, `poolId`.
3. Controller validates protocol:
   - missing version: reject + close `1008`
   - unsupported version: reject + close `1008`
4. On success, controller upserts runtime entry into `liveAgents` and tracks `lastSeen`.
5. Runner heartbeats every ~30s with `guilds` and repeated `hello`.

RPC flow:
1. Controller sends `req` `{ id, op, data, agentId }`.
2. Agent executes operation and returns `resp` `{ id, ok, data|error }`.
3. Controller resolves/rejects pending promise by `id`.

Session lifecycle events:
- Agent emits `event: add` when join/setup succeeds or fails.
- Agent emits `event: released` on leave/disconnect.
- Controller binds/releases entries in `sessions` (music) and `assistantSessions`.

## 2) Pool storage model and ownership/visibility

Primary persisted tables:
- `agent_pools`
  - `pool_id` (PK)
  - `owner_user_id`
  - `name`
  - `visibility` (`public`/`private`)
  - `meta` (JSONB)
  - created/updated timestamps
- `agent_bots`
  - `agent_id` (unique)
  - encrypted `token`
  - `client_id`, `tag`, `status`
  - `pool_id` (foreign-key-like logical relation)
  - optional `profile` (JSONB)
  - created/updated timestamps
- `agent_runners`
  - `runner_id`
  - `last_seen`
  - `meta` (JSONB)

Guild default pool selection:
- Stored in `guild_settings.data.selectedPoolId` (JSONB model), exposed by:
  - `getGuildSelectedPool(guildId)`
  - `setGuildSelectedPool(guildId, poolId)`

Visibility and ownership behavior:
- Public pools are visible/selectable for contribution/deploy commands.
- Private pools are owner-restricted.
- Ownership ties to `owner_user_id`.
- Default seed pool `pool_WokSpec` is auto-ensured as `public`.

## 3) Deployment tracking, limits, and allocation model

Hard limit:
- `MAX_AGENTS_PER_GUILD = 49` enforced in deploy planning and command schema.

Deploy planning:
- `buildDeployPlan(guildId, desiredCount, poolId?)`:
  - rejects desired > 49
  - computes `presentCount` from live guild membership in `liveAgents`
  - computes invitable list from active registered bots filtered by pool
  - returns invite URLs for missing count

Runtime deployment/session tracking:
- Guild membership source of truth at runtime: `liveAgents[*].guildIds` (from `hello`/`guilds` heartbeats).
- Active voice workloads:
  - music map: `sessions` keyed `guildId:voiceChannelId`
  - assistant map: `assistantSessions` keyed `a:guildId:voiceChannelId`
- Allocation strategy:
  - existing session -> preferred agent -> guild-local idle round-robin -> fail with `no-agents-in-guild` or `no-free-agents`

## 4) Failure modes and recovery behavior

Protocol/connection failures:
- Missing/incompatible protocol version -> immediate reject.
- Invalid JSON messages ignored safely.
- WS close triggers agent cleanup and session release for disconnected agent.

Staleness and pruning:
- Agents older than `AGENT_STALE_MS` without heartbeat are terminated and cleaned.

Reconciliation:
- Periodic reconciliation compares DB registered agents vs live connected agents.
- Warns for:
  - live but absent/inactive in DB
  - active in DB but not connected

RPC failures:
- Request timeout -> `agent-timeout`.
- Offline send failure -> `agent-offline`.
- Circuit breaker around request path prevents cascading failures under repeated errors.

Idle resource recovery:
- Configurable idle release (`default + guild override`).
- If voice channel has no humans and idle exceeds policy:
  - controller sends remote stop/leave op
  - releases local session maps
  - notifies owner/deployer and text channel when possible.

Restart/reconnect behavior:
- Agent runner reconnect loop restores WS and resumes heartbeat.
- Bot recreation temporarily disconnects agents; runner reconnects automatically.

## 5) Controller/data-plane dependency graph

```text
                 +-----------------------------+
                 | Discord API / Guild State  |
                 +-------------+---------------+
                               |
                               v
 +---------------------+   WS control   +----------------------+
 | Controller Bot      |<-------------->| Agent Runner(s)      |
 | (AgentManager)      |                | (deployable agents)  |
 | - pools/deploy plan |--- RPC req --->| - music/assistant ops|
 | - session leasing   |<-- RPC resp ---| - emits add/released |
 +----------+----------+                +----------+-----------+
            |                                      |
            | SQL/JSON                             | voice/media
            v                                      v
 +---------------------+                +----------------------+
 | PostgreSQL          |                | Lavalink / Voice     |
 | - agent_pools       |                | infrastructure       |
 | - agent_bots        |                +----------------------+
 | - agent_runners     |
 | - guild_settings    |
 +----------+----------+
            |
            v
 +---------------------+
 | Redis (cache/rate)  |
 +---------------------+
```

## 6) Control plane vs data plane contract

Control plane (must stay stable):
- pool CRUD, ownership/visibility, guild default pool selection
- deploy planning, invite generation, limits/invariants
- session allocation, idle policies, reconciliation, metrics/health

Data plane (replaceable workers/services):
- deployable agent processes handling voice/music/assistant ops
- optional stateless side services (FunHub-style)

This boundary is already implemented and should be preserved for all future pillars.
