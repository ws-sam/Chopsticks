# Chopsticks — Deployment Runbook

## Environments

| Environment | Compose file | Notes |
|---|---|---|
| Local dev | `docker-compose.laptop.yml` | All services including Grafana, full stack |
| Production (single node) | `docker-compose.production.yml` | Hardened, no dev tools |
| Production (Swarm) | `docker-compose.stack.yml` | Multi-node Docker Swarm |
| Hardened | `docker-compose.hardened.yml` | Read-only FS, no-new-privileges |

---

## Services (Docker)

| Service | Port | Image |
|---|---|---|
| `chopsticks-bot` | — | `Dockerfile.bot` |
| `chopsticks-agents` | — | `Dockerfile.agentrunner` |
| `chopsticks-dashboard` | 3002 | Dockerfile.bot (dashboard entry) |
| `chopsticks-postgres` | 5432 | `postgres:16-alpine` |
| `chopsticks-redis` | 6379 | `redis:7-alpine` |
| `chopsticks-lavalink` | 2333 | `ghcr.io/lavalink-devs/lavalink:4` |
| `chopsticks-caddy` | 80, 443 | `caddy:latest` |
| `chopsticks-prometheus` | 9090 | `prom/prometheus` |
| `chopsticks-grafana` | 3001 | `grafana/grafana` |

---

## First-Time Setup

### 1. Prerequisites
- Docker Engine 24+ and Docker Compose V2
- A Discord application with bot token and application ID
- A domain pointing to your server (for Caddy TLS)

### 2. Clone and Configure
```bash
git clone https://github.com/wokspec/Chopsticks.git
cd Chopsticks
cp .env.example .env
```

Edit `.env` — minimum required:
```bash
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_app_id
BOT_OWNER_IDS=your_discord_user_id
DATABASE_URL=postgresql://chopsticks:secret@chopsticks-postgres:5432/chopsticks
REDIS_URL=redis://chopsticks-redis:6379
AGENT_TOKEN_KEY=generate_32_byte_hex  # openssl rand -hex 32
```

### 3. Run Migrations
```bash
docker compose -f docker-compose.laptop.yml up chopsticks-postgres -d
npm run migrate   # or: npx node-pg-migrate up
```

### 4. Deploy Slash Commands
```bash
node scripts/deployCommands.js   # deploys to BOT_GUILD_ID (set in .env for dev)
# For production: DEPLOY_MODE=global node scripts/deployCommands.js
```

### 5. Start All Services
```bash
docker compose -f docker-compose.laptop.yml up -d
docker compose -f docker-compose.laptop.yml logs chopsticks-bot -f
```

---

## Production Deploy

```bash
# On the production server
git pull origin main
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d --remove-orphans
```

Zero-downtime restarts: use `docker compose up -d --no-deps chopsticks-bot` to restart only the bot without taking down PostgreSQL and Redis.

---

## Database Migrations

Migrations live in `migrations/` as numbered SQL files managed by `node-pg-migrate`.

```bash
npm run migrate        # apply all pending migrations
npm run migrate:undo   # roll back last migration
```

In Docker:
```bash
docker compose -f docker-compose.production.yml exec chopsticks-bot npm run migrate
```

---

## TLS / Caddy

The `Caddyfile` configures Caddy as the reverse proxy:
- HTTPS for the dashboard (`dashboard.chopsticks.wokspec.org`)
- Automatic Let's Encrypt certificate provisioning
- WebSocket proxying for Socket.io

Edit `Caddyfile` to set your domain before first run.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | Yes | Bot token |
| `CLIENT_ID` | Yes | Bot application ID |
| `BOT_OWNER_IDS` | Yes | Comma-separated owner Discord IDs |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `AGENT_TOKEN_KEY` | Yes (agents) | 32-byte hex master encryption key |
| `AGENT_RUNNER_SECRET` | No | Shared secret for runner ↔ manager auth |
| `AGENT_CONTROL_URL` | No | WebSocket URL of AgentManager (default: `ws://127.0.0.1:8787`) |
| `HUGGINGFACE_API_KEY` | No | Enables `/ai image` |
| `DISABLE_AGENT_RUNNER` | No | `true` to manage runner externally (PM2) |
| `DEPLOY_MODE` | No | `global` for global slash command deploy |
| `LAVALINK_HOST` | No | Lavalink server host |
| `LAVALINK_PORT` | No | Lavalink server port (default: 2333) |
| `LAVALINK_PASSWORD` | No | Lavalink auth password |

---

## Monitoring

- **Grafana:** `http://your-server:3001` — default login admin/admin (change immediately)
- **Prometheus:** `http://your-server:9090`
- **PM2 (alternative to Docker):** `npm run ecosystem` runs `ecosystem.config.cjs`

Key dashboards pre-built in `monitoring/grafana/`:
- Bot overview (guild count, command rates, uptime)
- Agent pool health (active agents, dispatch latency)
- Economy (credit flow, auction volume, XP events)

---

## Rollback

```bash
# Roll back to previous image
docker compose -f docker-compose.production.yml pull chopsticks-bot=<previous-sha>
docker compose -f docker-compose.production.yml up -d --no-deps chopsticks-bot
```

Database rollbacks:
```bash
npm run migrate:undo   # roll back last migration (must have `down` SQL written)
```
