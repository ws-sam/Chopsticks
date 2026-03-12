# Chopsticks — Architecture

## Overview

Chopsticks is a Node.js application built on discord.js v14. It is architecturally split into four independent processes that communicate through shared PostgreSQL and Redis state, and through an internal WebSocket control plane for the agent pool.

---

## Process Map

```
┌─────────────────────────────────────────────┐
│  chopsticks-bot  (src/index.js)             │
│  Primary Discord client — slash commands,   │
│  event handling, economy, moderation        │
└────────────────────┬────────────────────────┘
                     │ PostgreSQL (pg)
                     │ Redis (ioredis)
┌────────────────────▼────────────────────────┐
│  chopsticks-agents                          │
│  ├── AgentManager  ws://:8787               │
│  │   WebSocket control plane — routes work  │
│  │   orders to live agent clients           │
│  └── AgentRunner                            │
│      Polls DB every 10s, spawns discord.js  │
│      Client instances for active tokens     │
└────────────────────┬────────────────────────┘
                     │ PostgreSQL (pg)
┌────────────────────▼────────────────────────┐
│  chopsticks-dashboard  (src/dashboard/)     │
│  Express + OAuth2 web panel                 │
│  Socket.io real-time updates                │
│  Prometheus metrics endpoint                │
└─────────────────────────────────────────────┘
```

---

## Agent Pool System — Deep Dive

### Token Lifecycle
1. Pool owner runs `/agents add_token` — token submitted to DB
2. Pool owner approves (status: `active`)
3. AgentRunner picks up the active token on next poll (10s interval)
4. AgentRunner creates a `discord.js` Client, logs in, establishes WebSocket to AgentManager
5. AgentManager adds the client to its registry with a `sessionId`
6. Guild dispatches work via `/agents deploy` → calls into AgentManager → routes to a client by specialty + availability
7. Agent executes the work (joins voice, plays audio, sends message, etc.)
8. Revocation: pool owner sets `token = NULL` in DB → AgentRunner detects NULL on next poll → destroys the Client

### Security Model
| Mechanism | Implementation |
|---|---|
| Token encryption at rest | AES-256-GCM with per-pool HKDF-SHA256 derived key; master key in `AGENT_TOKEN_KEY` |
| Token in logs | Only masked form `BOT_***...***_xyz` ever written |
| Revocation | `token = NULL` in DB; flag fields alone are never trusted |
| Pool ownership checks | All management operations check `pool.owner_id === ctx.userId` in every code path |
| Runner authentication | Optional `AGENT_RUNNER_SECRET` for hello handshake between runner and manager |
| Rate limiting | Write ops (add_token, deploy) throttled per user via Redis |

---

## Database Schema (Key Tables)

### `agent_pools`
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL | PK |
| `name` | TEXT | Pool display name |
| `owner_id` | TEXT | Discord user ID |
| `specialty` | TEXT | music \| voice_assistant \| utility \| relay \| custom |
| `tier` | TEXT | free \| pro \| enterprise |
| `alliance_id` | INTEGER | FK → agent_pools (alliance partner) |

### `agent_tokens`
| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL | PK |
| `pool_id` | INTEGER | FK → agent_pools |
| `token` | TEXT | AES-256-GCM encrypted (NULL after revocation) |
| `token_masked` | TEXT | Publicly safe display form |
| `status` | TEXT | pending \| active \| suspended \| revoked |
| `contributor_id` | TEXT | Discord user who submitted the token |

### `guild_configs`
| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | PK |
| `primary_pool_id` | INTEGER | FK → agent_pools |
| `secondary_pool_ids` | INTEGER[] | Up to 2 fallback pools |
| `xp_rate` | NUMERIC | XP per message multiplier |
| `economy_enabled` | BOOLEAN | |
| `welcome_channel_id` | TEXT | |
| `mod_log_channel_id` | TEXT | |

### `economy`
| Column | Type | Notes |
|---|---|---|
| `user_id` | TEXT | Discord user ID |
| `guild_id` | TEXT | |
| `balance` | BIGINT | Current credits |
| `bank_balance` | BIGINT | Banked credits |
| `xp` | BIGINT | |
| `level` | INTEGER | |

---

## Command System

Commands are organised by group in `src/commands/<group>.js`. Each file exports an array of command definitions and an `executeCommand` dispatcher. The bot's `interactionCreate` handler routes incoming interactions by `commandName.split(' ')[0]` to the appropriate module.

New commands are registered via `scripts/deployCommands.js` which calls the Discord REST API. In dev, deploy to a single test guild; in prod, deploy globally (`DEPLOY_MODE=global`).

---

## Observability Stack

| Component | Role |
|---|---|
| Pino | Structured JSON logging — no `console.*` in production |
| prom-client | Exposes Prometheus metrics at `:9090/metrics` |
| Prometheus | Scrapes the metrics endpoint |
| Grafana | Dashboards for guild count, command latency, agent pool health, economy events |

Key metrics exported:
- `chopsticks_commands_total{command, status}` — command execution count and success rate
- `chopsticks_agent_sessions_active` — live agent count
- `chopsticks_economy_transactions_total{type}` — economy throughput
- `chopsticks_music_tracks_total` — tracks played

---

## Key Design Decisions

**Why PostgreSQL over SQLite?**  
Multi-process write concurrency from bot, agent runner, and dashboard. SQLite WAL mode would work for reads but concurrent writers on the same file from separate Docker containers create locking issues.

**Why a WebSocket control plane instead of database polling for agents?**  
Command dispatch to voice agents requires sub-second latency. DB polling (10s interval) is fine for the runner's lifecycle management, but work orders need to reach agents immediately. WebSocket delivers this with a single persistent connection per agent.

**Why discord.js v14?**  
Mature, TypeScript-friendly (type declarations built-in), application commands (slash commands) are first-class, voice support via `@discordjs/voice` in the same ecosystem.
