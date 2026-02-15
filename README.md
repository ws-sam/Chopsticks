# Chopsticks

Chopsticks is a Docker-first, self-hosted Discord bot platform with:
- a main control bot
- pooled agent bots for voice/music workloads
- PostgreSQL + Redis state
- Lavalink for audio
- optional dashboard + monitoring stack

## Platform Snapshot (2026-02-14)

- Maturity baseline: Levels 0-2 hardening in progress/completed artifacts are in-repo
- Agent protocol version: `1.0.0`
- Max agents per guild: `49` (enforced)
- Contract/unit tests: `62 passing`
- Primary runtime target: Docker Compose production stack

See `SYSTEM_STATUS.md`, `MATURITY.md`, `LEVEL_1_COMPLETION_REPORT.md`, and `LEVEL_2_COMPLETION_REPORT.md` for detailed status.

## Architecture

Core services in `docker-compose.production.yml`:
- `bot` (`chopsticks-bot`): main Discord bot, command/control, health + metrics
- `agents` (`chopsticks-agents`): agent runner for pooled music/voice bots
- `postgres` (`chopsticks-postgres`): persistent relational state
- `redis` (`chopsticks-redis`): cache/session acceleration
- `lavalink` (`chopsticks-lavalink`): audio backend
- `dashboard` (`chopsticks-dashboard`): web dashboard (profile: `dashboard`)
- `caddy` (`chopsticks-caddy`): reverse proxy/TLS (profile: `dashboard`)
- `prometheus` (`chopsticks-prometheus`): metrics scrape/storage (profile: `monitoring`)

## Quick Start (Docker)

1. Configure environment:
```bash
cp .env.example .env
# edit .env and set at minimum: DISCORD_TOKEN, BOT_OWNER_IDS, POSTGRES_URL, REDIS_URL
```

2. Start platform:
```bash
./scripts/start.sh
```

By default, production bring-up enables profiles:
- `dashboard`
- `monitoring`
- `fun` (FunHub API on `:8790`)

To override:
```bash
COMPOSE_PROFILES=dashboard ./scripts/start.sh
```

3. Verify runtime:
```bash
make status
make health
make logs
```

4. Stop platform:
```bash
make stop
```

## Music + Agent Pooling

Typical setup flow in Discord:
1. Register agent tokens into a pool (`/agents add_token`)
2. Mark tokens active (`/agents update_token_status`)
3. Deploy identities into guild (`/agents deploy <count>`)
4. Start playback (`/music play <query>`)

Operational notes:
- Agent runner requires `AGENT_CONTROL_URL` and Lavalink env (`LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD`)
- Agent readiness is required for music allocation
- If all agents are busy, deploy more or retry after session release
- Idle auto-release controls:
  - `AGENT_SESSION_IDLE_RELEASE_MS` (default `1800000` = 30 minutes)
  - `AGENT_SESSION_IDLE_SWEEP_MS` (default `60000` = 1 minute)
  - Server admins can override per-guild with `/agents idle_policy`
  - On idle timeout with no humans in VC, session is released and deployer/session owner is notified

## VoiceMaster (Custom VC)

Voice lobby system supports:
- auto-create temp rooms from lobby channels
- owner handoff/claim/transfer lifecycle
- per-lobby owner permission templates (`Manage Channels`, `Move Members`, `Mute/Deafen`, `Priority Speaker`)
- interactive VC control console (`/voice console`) with buttons + dropdowns
- live dynamic room panel (`/voice room_panel`) that refreshes with room events
- room controls (`/voice room_status`, `/voice room_rename`, `/voice room_limit`, `/voice room_lock`, `/voice room_unlock`, `/voice room_claim`, `/voice room_transfer`)
- room dashboard delivery controls:
  - manual `/voice panel`
  - user default `/voice panel_user_default`
  - guild default `/voice panel_guild_default`
  - delivery modes: `temp`, `dm`, `channel`, `here`, `both`, `off`

## Bot-wide UI

- `/commands ui` opens an interactive command center with category and command dropdowns.
- `/fun play`, `/fun random`, and `/fun catalog` provide a 220-variant fun system (also available as prefix `!fun`).

## FunHub API

`funhub` is the external API layer for the same fun engine used by `/fun` and `!fun`.

- Base URL: `http://localhost:8790`
- Health: `GET /health`
- Authenticated endpoints:
  - `GET /api/fun/catalog?q=<query>&limit=<1-25>`
  - `GET /api/fun/random?actor=<name>&target=<name>&intensity=<1-5>`
  - `GET /api/fun/render?variant=<id>&actor=<name>&target=<name>&intensity=<1-5>`
  - `GET /api/fun/pack?count=<1-10>&actor=<name>&target=<name>&intensity=<1-5>`

Security controls:
- API key auth enabled by default (`FUNHUB_REQUIRE_API_KEY=true`)
- Bot uses `FUN_PROVIDER=auto` and attempts FunHub first, with local fallback
- Rate limit defaults: `120 requests / 60s` per API key
- Optional CORS allowlist via `FUNHUB_CORS_ORIGINS`

Recommended env:
```bash
FUN_PROVIDER=auto
FUNHUB_URL=http://funhub:8790
FUNHUB_INTERNAL_API_KEY=<long-secret-key>
FUNHUB_API_KEYS=<comma-separated-extra-keys>
FUNHUB_CORS_ORIGINS=https://your-dashboard.example
FUNHUB_RATE_LIMIT_MAX=120
FUNHUB_RATE_LIMIT_WINDOW_MS=60000
```

## Testing

Run full unit/contract tests:
```bash
npm test
```

Maturity-focused checks:
```bash
make test-level-0
make test-level-1
make test-protocol
```

## Monitoring + Health

- Bot health: `http://localhost:8080/health` (and `/healthz` where configured)
- Bot metrics: `http://localhost:8080/metrics`
- Debug dashboard: `http://localhost:8080/debug/dashboard`
- Dashboard service: `http://localhost:8788`
- Prometheus: `http://localhost:9090`

## Repo Layout

- `src/` application code (bot, agents, dashboard, utils)
- `test/` unit/contract tests
- `migrations/` schema change framework
- `docs/` protocol, schema, operations, architecture
- `scripts/` startup, verification, deployment helpers

## Key Docs

- `SYSTEM_STATUS.md`
- `MATURITY.md`
- `TESTING_GUIDE.md`
- `docs/AGENT_PROTOCOL.md`
- `docs/schema/DATABASE_SCHEMA.md`
- `docs/runbooks.md`

## License

Proprietary/private deployment by repository owner.
