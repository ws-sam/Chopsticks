# Ops Runbook — Rate Limit Management
**Service:** Chopsticks Discord Bot  
**Phase:** 3 — Rate Limit & Quota  
**Audience:** On-call engineers, DevOps  
**Last updated:** see git log

---

## 1. Tuning Limits via Environment Variables

All rate limit values in `rate_limit_config.json` can be overridden at runtime via environment variables **without redeploying** — the config loader checks `process.env` first and falls back to the JSON defaults.

### Variable naming convention

```
RL_{CATEGORY|COMMAND}_LIMIT    — max invocations
RL_{CATEGORY|COMMAND}_WINDOW   — window in seconds
```

Underscores replace spaces; command names are uppercased. Examples:

| Env Var                 | Overrides                            | Default |
|-------------------------|--------------------------------------|---------|
| `RL_MOD_LIMIT`          | `category_defaults.mod.max`          | 5       |
| `RL_MOD_WINDOW`         | `category_defaults.mod.window_sec`   | 30      |
| `RL_AI_LIMIT`           | `category_defaults.ai.max`           | 3       |
| `RL_AI_WINDOW`          | `category_defaults.ai.window_sec`    | 60      |
| `RL_ADMIN_LIMIT`        | `category_defaults.admin.max`        | 3       |
| `RL_MUSIC_LIMIT`        | `category_defaults.music.max`        | 10      |
| `RL_BAN_LIMIT`          | `command_overrides.ban.max`          | 2       |
| `RL_KICK_LIMIT`         | `command_overrides.kick.max`         | 2       |
| `RL_PURGE_LIMIT`        | `command_overrides.purge.max`        | 2       |
| `RL_PURGE_WINDOW`       | `command_overrides.purge.window_sec` | 20      |
| `RL_AI_CHAT_LIMIT`      | `command_overrides["ai chat"].max`   | 5       |
| `RL_AI_IMAGE_LIMIT`     | `command_overrides["ai image"].max`  | 2       |
| `RL_AI_IMAGE_WINDOW`    | `command_overrides["ai image"].window_sec` | 300 |

### Applying changes

```bash
# docker-compose (dev / staging)
RL_AI_LIMIT=10 RL_AI_WINDOW=60 docker-compose up -d bot

# Kubernetes (production)
kubectl set env deployment/chopsticks-bot RL_AI_LIMIT=10 RL_AI_WINDOW=60

# Verify the running process picked up the new values
kubectl exec -it deploy/chopsticks-bot -- printenv | grep RL_
```

> **Note:** Changes take effect on the next Redis key expiry cycle (≤ current window_sec). No restart required.

---

## 2. Monitoring Rate Limit Spike Alerts

Chopsticks exposes a Prometheus counter:

```
chopsticks_ratelimit_hit_total{command, guild_id, tier}
```

### Key PromQL queries

#### 2.1 Global 429 rate (last 5 min)
```promql
sum(rate(chopsticks_ratelimit_hit_total[5m]))
```

#### 2.2 Per-command 429 rate — identify hot commands
```promql
topk(5, sum by (command) (rate(chopsticks_ratelimit_hit_total[5m])))
```

#### 2.3 Per-guild spike — single guild hammering the bot
```promql
topk(10, sum by (guild_id) (rate(chopsticks_ratelimit_hit_total[5m])))
```

#### 2.4 AI-category exhaustion alert (> 10 hits/min for 2 consecutive minutes)
```promql
sum(rate(chopsticks_ratelimit_hit_total{command=~"ai.*"}[1m])) > 10
```

### Grafana alert rule (copy into `alerts/rate_limit.yaml`)

```yaml
groups:
  - name: chopsticks_rate_limits
    rules:
      - alert: RateLimitSpike
        expr: sum(rate(chopsticks_ratelimit_hit_total[2m])) > 50
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Rate limit spike detected"
          description: "More than 50 rate-limit hits/min for 2 consecutive minutes."

      - alert: AIQuotaExhaustion
        expr: sum(rate(chopsticks_ratelimit_hit_total{command=~"ai.*"}[5m])) > 20
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "AI quota exhausted"
          description: "AI commands hitting rate limits at >20/min — check upstream LLM cost."

      - alert: DLQOverflow
        expr: increase(chopsticks_dlq_overflow_total[5m]) > 0
        labels:
          severity: critical
        annotations:
          summary: "DLQ overflow — retries exceeded"
          description: "Async operations exhausted max retries. Manual intervention required."
```

---

## 3. Temporarily Lifting Limits for a Specific Guild

Use the **admin override** endpoint / bot command. This writes a time-bounded exemption to Redis.

### Via bot admin command (preferred — requires `BOT_ADMIN` role)

```
/admin ratelimit-override guild:<guild_id> duration:<minutes> [multiplier:<1-100>]
```

Examples:
```
/admin ratelimit-override guild:123456789 duration:60
    → 1× limits (effectively reset hit counters) for 60 minutes

/admin ratelimit-override guild:123456789 duration:30 multiplier:10
    → 10× limits for 30 minutes (event/stream use case)
```

### Via Redis CLI (break-glass — production only)

```bash
# Connect to Redis
redis-cli -u $REDIS_URL

# Inspect current rate limit keys for a guild
SCAN 0 MATCH "chopsticks:rl:*:guild_123456789:*" COUNT 100

# Delete all rate limit keys for the guild (immediate reset)
redis-cli -u $REDIS_URL --scan --pattern "chopsticks:rl:*:guild_123456789:*" | xargs redis-cli -u $REDIS_URL DEL

# Set a 1-hour override multiplier (bot reads this key before applying limits)
redis-cli -u $REDIS_URL SET chopsticks:rl_override:guild_123456789 '{"multiplier":10,"expires_at":EPOCH}' EX 3600
```

> Replace `EPOCH` with `$(date -d '+1 hour' +%s)` on Linux.

### Audit trail
All overrides are logged to the `chopsticks_admin_audit` table with `action=RL_OVERRIDE`, `actor`, `guild_id`, `duration_min`, `multiplier`.

---

## 4. Quota Exhaustion Test Script

Simulate rate limit exhaustion for a given command using `curl`. Requires a valid Discord bot token and a test guild/channel.

```bash
#!/usr/bin/env bash
# quota_exhaustion_test.sh
# Usage: ./quota_exhaustion_test.sh <command> <limit> <window_sec>
#
# Prerequisites:
#   export TEST_GUILD_ID=<guild_id>
#   export TEST_CHANNEL_ID=<channel_id>
#   export BOT_TOKEN=<bot_token>
#   export BOT_APP_ID=<application_id>
#   The bot must expose a local HTTP test-harness endpoint (see src/testHarness.ts)

COMMAND="${1:-ban}"
LIMIT="${2:-2}"
WINDOW="${3:-30}"
ENDPOINT="http://localhost:3001/test/invoke"   # local test-harness port

echo "=== Rate Limit Exhaustion Test ==="
echo "Command: $COMMAND | Limit: $LIMIT | Window: ${WINDOW}s"
echo ""

for i in $(seq 1 $((LIMIT + 2))); do
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "{
      \"command\": \"$COMMAND\",
      \"user_id\": \"test_user_42\",
      \"guild_id\": \"$TEST_GUILD_ID\"
    }")

  if [ "$RESPONSE" -eq 429 ]; then
    RETRY_AFTER=$(curl -s -D - -X POST "$ENDPOINT" \
      -H "Content-Type: application/json" \
      -d "{\"command\":\"$COMMAND\",\"user_id\":\"test_user_42\",\"guild_id\":\"$TEST_GUILD_ID\"}" \
      2>/dev/null | grep -i "retry-after" | awk '{print $2}' | tr -d '\r')
    echo "  [$i] → 429 Too Many Requests | Retry-After: ${RETRY_AFTER}s  ✅ EXPECTED AT THIS POINT"
  else
    echo "  [$i] → HTTP $RESPONSE"
  fi
done

echo ""
echo "Waiting ${WINDOW}s for window to reset..."
sleep "$WINDOW"

# Verify recovery
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{\"command\":\"$COMMAND\",\"user_id\":\"test_user_42\",\"guild_id\":\"$TEST_GUILD_ID\"}")
echo "Post-window invocation → HTTP $RESPONSE (expected 200)"
```

Run:
```bash
chmod +x quota_exhaustion_test.sh
./quota_exhaustion_test.sh ban 2 30
./quota_exhaustion_test.sh "ai chat" 5 60
./quota_exhaustion_test.sh "ai image" 2 300
```

---

## 5. Recovery When Redis Is Unavailable

### Fallback behaviour

When the bot cannot reach Redis (connection timeout > 500ms or connection refused), `rateLimiter.ts` automatically falls back to an **in-process memory store** (a `Map<string, TokenBucket>`).

| Aspect                  | Redis (normal)                       | Memory fallback                          |
|-------------------------|--------------------------------------|------------------------------------------|
| Scope                   | Cluster-wide, per-guild/user         | Per-pod instance only                    |
| Persistence             | Survives pod restarts                | Lost on pod restart                      |
| Accuracy                | Exact sliding window                 | Approximate (no cross-pod coordination)  |
| 429 enforcement         | Full                                 | Best-effort (may under-enforce)          |
| DLQ                     | Fully functional                     | DLQ writes buffered in memory; flushed on Redis reconnect |

### Detection

```bash
# Check Redis connectivity
redis-cli -u $REDIS_URL ping

# Check bot logs for fallback activation
kubectl logs deploy/chopsticks-bot | grep "Redis unavailable — falling back to memory rate limiter"

# Prometheus alert (add to alerts/rate_limit.yaml)
# - alert: RedisRateLimitFallback
#   expr: chopsticks_ratelimit_fallback_active == 1
#   labels:
#     severity: warning
```

### Recovery steps

1. **Identify root cause:** check Redis pod status / Elasticache health dashboard.
   ```bash
   kubectl get pods -l app=redis
   kubectl logs pod/redis-0 --tail=50
   ```

2. **If Redis is restarting** (OOM, crash loop): wait for pod to become `Running`; bot will auto-reconnect within 10s (ioredis built-in retry).

3. **If Redis is unreachable** (network partition): verify `REDIS_URL` env var and network policies.
   ```bash
   kubectl exec -it deploy/chopsticks-bot -- nc -zv $REDIS_HOST $REDIS_PORT
   ```

4. **Manual flush of in-memory DLQ buffer** (if bot was restarted before Redis came back): the in-memory DLQ is lost. Re-run any critical async operations manually or inform affected users.

5. **After Redis reconnects:** the bot flushes the in-memory DLQ buffer automatically (up to 1000 entries). Verify with:
   ```bash
   redis-cli -u $REDIS_URL XLEN chopsticks:dlq:ratelimited
   ```

6. **Clear stale memory-fallback state:** if the bot ran in memory-fallback mode for > 1 window period, some counters may be stale. Safe to do a rolling restart once Redis is healthy:
   ```bash
   kubectl rollout restart deployment/chopsticks-bot
   kubectl rollout status deployment/chopsticks-bot
   ```

### Escalation path

| Severity    | Action                                       |
|-------------|----------------------------------------------|
| Redis down < 5 min  | Self-healing; monitor; no action needed |
| Redis down 5–30 min | Page Redis owner; notify #incidents     |
| Redis down > 30 min | Escalate to infra lead; consider disabling AI commands temporarily |
