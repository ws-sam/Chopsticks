# Baseline Verification Report

Date: 2026-02-15
Repo: `/home/user9007/chopsticks`

## 1) Repo tree, package scripts, compose files, env requirements

### Commands
```bash
cd /home/user9007/chopsticks
find . -maxdepth 2 -type d \( -path './node_modules' -o -path './.git' \) -prune -o -type d -print | sort
cat package.json
ls -1 docker-compose*.yml .env* 2>/dev/null
awk -F= '/^[A-Z0-9_]+=/ {print $1}' .env.comprehensive.example | sort -u
```

### Observed
- Top-level modules present: `src/agents`, `src/commands`, `src/dashboard`, `src/fun`, `src/music`, `src/moderation`, `src/prefix`, `services/*`, `migrations`, `monitoring`.
- `package.json` scripts include: `bot`, `agents`, `start`, `start:all`, `dashboard`, `funhub`, `deploy:guild`, `deploy:global`, `clear:guild`, `clear:global`, `test`.
- Compose files present:
  - `docker-compose.production.yml`
  - `docker-compose.monitoring.yml`
  - `docker-compose.voice.yml`
  - `docker-compose.stack.yml`
  - `docker-compose.override.yml`
  - `docker-compose.full.yml`
  - `docker-compose.lavalink.yml`
- Env requirements captured from `.env.comprehensive.example` as key names only (no values), including `DISCORD_TOKEN`, `DATABASE_URL`, `REDIS_*`, `AGENT_*`, `FUNHUB_*`, `VOICE_*`, `LAVALINK_*`, `METRICS_PORT`, `HEALTH_PORT`, `DASHBOARD_*`.

## 2) Tests

### Command
```bash
cd /home/user9007/chopsticks
npm test
```

### Observed
- Result: `90 passing`
- Includes passing contract suites:
  - `Contract Tests: Agent Deployment Flow`
  - `Contract Tests: Music Session Lifecycle`
  - `Agent Limit Enforcement` (49 cap checks)

## 3) Docker baseline and health checks

### Commands
```bash
cd /home/user9007/chopsticks
docker compose -f /home/user9007/chopsticks/docker-compose.production.yml build bot
docker compose -f /home/user9007/chopsticks/docker-compose.production.yml --profile dashboard --profile monitoring --profile fun up -d
docker compose -f /home/user9007/chopsticks/docker-compose.production.yml --profile dashboard --profile monitoring --profile fun ps
```

### Observed
- Build passed for `chopsticks-bot`.
- Services `Up`/`Healthy`:
  - `chopsticks-bot` (healthy)
  - `chopsticks-agents` (healthy)
  - `chopsticks-postgres` (healthy)
  - `chopsticks-redis` (healthy)
  - `chopsticks-lavalink` (healthy)
  - `chopsticks-dashboard` (healthy)
  - `chopsticks-funhub` (healthy)
  - `chopsticks-prometheus` (up)
  - `chopsticks-caddy` (up)

### Health endpoint checks
```bash
docker exec chopsticks-bot node -e "fetch('http://127.0.0.1:8080/health').then(async r=>{console.log('health',r.status);console.log(await r.text());})"
docker exec chopsticks-bot node -e "fetch('http://127.0.0.1:8080/healthz').then(async r=>{console.log('healthz',r.status);console.log(await r.text());})"
docker exec chopsticks-bot node -e "fetch('http://127.0.0.1:8080/metrics').then(async r=>{console.log('metrics',r.status);const t=await r.text();console.log(t.split('\n').slice(0,8).join('\n'));})"
docker exec chopsticks-bot node -e "fetch('http://dashboard:8788/health').then(async r=>{console.log('dashboard',r.status);console.log(await r.text());})"
docker exec chopsticks-bot node -e "fetch('http://funhub:8790/health').then(async r=>{console.log('funhub',r.status);console.log(await r.text());})"
docker exec chopsticks-bot node -e "fetch('http://prometheus:9090/-/healthy').then(async r=>{console.log('prometheus',r.status);console.log(await r.text());})"
```

### Observed
- `/health`: `200`
- `/healthz`: `200`
- `/metrics`: `200` (Prometheus exposition visible)
- `dashboard /health`: `200`
- `funhub /health`: `200`
- `prometheus /-/healthy`: `200`

## 4) Core invariant evidence

### A) Pools list works
```bash
docker exec chopsticks-bot node -e "(async()=>{const s=await import('/app/src/utils/storage.js');const pools=await s.listPools();console.log('pool_count',pools.length);for(const p of pools){console.log(JSON.stringify({poolId:p.pool_id,name:p.name,visibility:p.visibility,owner:p.owner_user_id}));}process.exit(0)})().catch(e=>{console.error(e.message);process.exit(1);})"
```

Observed:
- `pool_count 1`
- `pool_WokSpec` present, visibility `public`, expected owner id present.

### B) Agent registration works
```bash
docker compose -f /home/user9007/chopsticks/docker-compose.production.yml logs --no-color --tail 50 bot
docker exec chopsticks-bot node -e "const u=process.env.DEV_API_USERNAME||'admin';const p=process.env.DEV_API_PASSWORD||'';const h='Basic '+Buffer.from(u+':'+p).toString('base64');fetch('http://127.0.0.1:3003/dev-api/status',{headers:{authorization:h}}).then(async r=>{const j=await r.json();console.log('status',r.status);console.log(JSON.stringify({botStatus:j.botStatus,agentIds:(j.agents||[]).map(a=>a.agentId),guildIds:[...new Set((j.agents||[]).flatMap(a=>a.guildIds||[]))]},null,2));})"
```

Observed:
- Bot logs show handshake: `type=hello`, agent `agent1468195142467981395`, protocol `1.0.0`, ready `true`, guild count `1`.
- Dev API status shows bot online and the same live agent/guild identity.

### C) Deploy/undeploy works
Evidence captured through automated contract tests:
- `Contract Tests: Agent Deployment Flow` passed (deploy planning, invite generation, per-guild allocation logic, 49-agent cap).
- `Contract Tests: Music Session Lifecycle` passed (bind/release/cleanup paths that exercise undeploy-equivalent release behavior).

Runtime note:
- Slash-command driven guild invite acceptance and Discord-side undeploy cannot be fully simulated in this shell without interactive guild actions; command contracts and manager runtime behavior both passed.

### D) Voice agents connect (if applicable)
Evidence:
- `chopsticks-lavalink` container is healthy.
- Agent handshake reports `ready: true` from runner to controller.
- Control-plane WS reconnect/recovery confirmed in agents logs (`Connected to control plane at ws://bot:8787`).

## 5) Security note (required)

Sensitive values were observed in local env files during baseline gathering. Treat existing secrets as compromised and rotate:
- Discord bot tokens
- `AGENT_TOKEN_KEY`
- database/redis credentials
- dashboard/dev API credentials
- third-party API keys

Do not commit plaintext secrets; keep `.env*` out of VCS and rotate in provider consoles.
