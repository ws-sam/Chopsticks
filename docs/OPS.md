# Chopsticks Ops Runbook

## Scope
- Controller bot (`chopsticks-bot`)
- Agent runner (`chopsticks-agents`)
- Dashboard (`chopsticks-dashboard`)
- FunHub (`chopsticks-funhub`)
- Infra: Postgres, Redis, Lavalink, Prometheus

## 24/7 hosting (boot + auto-recovery)
The Docker services already use `restart: unless-stopped`. For true 24/7 uptime after host reboots, install the systemd units:

```bash
cd /home/user9007/chopsticks
bash scripts/ops/install-systemd.sh
```

What this installs:
- `chopsticks.service`: boots the production compose stack on machine startup
- `chopsticks-watchdog.timer`: runs every 2 minutes
- `chopsticks-watchdog.service`: runs `scripts/ops/chopsticks-watchdog.sh` and restarts failed app services

Operational commands:
```bash
systemctl status chopsticks.service --no-pager
systemctl status chopsticks-watchdog.timer --no-pager
systemctl list-timers --all | grep chopsticks-watchdog
journalctl -u chopsticks.service -n 100 --no-pager
journalctl -u chopsticks-watchdog.service -n 100 --no-pager
```

Rollback:
```bash
cd /home/user9007/chopsticks
bash scripts/ops/uninstall-systemd.sh
```

## Scheduled auto-updates (optional)
You can enable a timer that pulls latest `private/main`, runs safety gates, rebuilds app containers, then runs watchdog checks.

Install:
```bash
cd /home/user9007/chopsticks
bash scripts/ops/install-update-timer.sh
```

Manual run:
```bash
cd /home/user9007/chopsticks
bash scripts/ops/chopsticks-auto-update.sh
```

Dry run (no changes):
```bash
cd /home/user9007/chopsticks
AUTO_UPDATE_DRY_RUN=true bash scripts/ops/chopsticks-auto-update.sh
```

Service status/logs:
```bash
systemctl status chopsticks-auto-update.timer --no-pager
journalctl -u chopsticks-auto-update.service -n 100 --no-pager
```

Uninstall:
```bash
cd /home/user9007/chopsticks
bash scripts/ops/uninstall-update-timer.sh
```

## Core health checks
```bash
docker compose -f docker-compose.production.yml --profile dashboard --profile monitoring --profile fun ps
docker exec chopsticks-bot node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>console.log(r.status))"
docker exec chopsticks-bot node -e "fetch('http://dashboard:8788/health').then(r=>console.log(r.status))"
docker exec chopsticks-bot node -e "fetch('http://funhub:8790/health').then(r=>console.log(r.status))"
docker exec chopsticks-bot node -e "fetch('http://prometheus:9090/-/healthy').then(r=>console.log(r.status))"
```

Expected: all return `200`.

## Metrics endpoints
- Bot metrics: `http://<bot-host>:8080/metrics`
- Bot app metrics: `http://<bot-host>:8080/metrics-app`
- Dashboard metrics: `http://<dashboard-host>:8788/metrics`
- Grafana provisioned dashboard file:
  - `monitoring/grafana/provisioning/dashboards/chopsticks-overview.json`

Important metrics to track:
- Agent lifecycle:
  - `chopsticks_agent_connected`
  - `chopsticks_agent_ready`
  - `chopsticks_agent_busy{kind=...}`
  - `chopsticks_agent_uptime_seconds{stat=min|max|avg}`
- Pool utilization:
  - `chopsticks_pool_utilization_ratio{kind=overall|music|assistant}`
- Deploy outcomes:
  - `chopsticks_agent_deployments_total{success=true|false}`
- Orchestration latency:
  - `chopsticks_session_allocation_duration_seconds`
  - `chopsticks_command_duration_seconds`
- Abuse controls:
  - `chopsticks_rate_limit_hits_total{type=...}`

## Alert runbooks
- `ChopsticksBotMetricsDown`:
  - Check `docker compose ... ps` for `chopsticks-bot`.
  - Confirm bot `/healthz` and `/metrics-app`.
  - Inspect logs for fatal startup/config errors.
- `ChopsticksDashboardMetricsDown`:
  - Confirm `chopsticks-dashboard` is up and `/metrics` returns `200`.
  - Verify Redis and session middleware startup.
- `ChopsticksNoReadyAgents`:
  - Check `/dev-api/status` for connected/ready agents.
  - Verify agent runner polling and WS handshakes.
  - Ensure pool has active agents in DB.
- `ChopsticksPoolUtilizationHigh`:
  - Review `chopsticks_pool_utilization_ratio`.
  - Deploy more agents or reduce idle hold time.
  - Check for stuck sessions not releasing.
- `ChopsticksDeployFailuresSpike`:
  - Inspect `/agents deploy` errors and pool visibility/access.
  - Verify bot identities are inviteable and active in pool.
  - Review Discord permission failures in logs.

Alert rules source:
- `monitoring/alerts/chopsticks-alerts.yml`

## CI gates
Mandatory CI gates before merge:
- `npm run ci:syntax`
- `npm run ci:migrations`
- `npm test`
- Docker smoke: `scripts/ci/docker-smoke.sh`

Optional staging Discord smoke (manual dispatch with secrets):
- `node scripts/deployCommands.js` in guild mode
- `npm run smoke:discord`
- Public guild preflight: `PUBLIC_TEST_GUILD_ID=<guild_id> npm run smoke:public`
- Persona gate: `PUBLIC_TEST_GUILD_ID=<guild_id> ADMIN_USER_ID=<id> PUBLIC_USER_ID=<id> npm run smoke:persona`

## Control-plane invariants
- Max deploy target per guild is hard-capped at `49`.
- Pools and registrations are persisted in PostgreSQL (`agent_pools`, `agent_bots`, `agent_runners`).
- Live allocation state remains in controller memory (`liveAgents`, `sessions`, `assistantSessions`).

## Failure handling
- Global process guards log:
  - `unhandledRejection`
  - `uncaughtException`
  - `process warning`
- Interaction hardening:
  - per-user slash command throttling
  - idempotency guard for mutation-style commands

## Troubleshooting flow
1. Check `docker compose ... ps`.
2. Check service health endpoints.
3. Check bot logs for agent handshake and protocol mismatches.
4. Check pool/agent DB state:
```bash
docker exec chopsticks-bot node -e "(async()=>{const s=await import('/app/src/utils/storage.js');console.log(await s.listPools());console.log((await s.fetchAgentBots()).map(a=>({id:a.agent_id,status:a.status,pool:a.pool_id})));process.exit(0)})()"
```
5. If agent sessions stall, verify:
  - live agents present in target guild
  - `chopsticks_pool_utilization_ratio{kind=\"overall\"}` not pegged at `1`
  - Lavalink is healthy

## Security reminders
- Treat any exposed tokens/keys as compromised and rotate immediately.
- Never commit `.env` values.
- Keep dashboard/dev API credentials rotated and scoped.
