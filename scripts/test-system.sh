#!/bin/bash
# Comprehensive system test and validation

echo "=========================================="
echo "CHOPSTICKS COMPREHENSIVE SYSTEM TEST"
echo "=========================================="
echo ""

cd /home/user9007/chopsticks

PASS=0
FAIL=0

test_result() {
  if [ $1 -eq 0 ]; then
    echo "  ✅ PASS: $2"
    PASS=$((PASS+1))
  else
    echo "  ❌ FAIL: $2"
    FAIL=$((FAIL+1))
  fi
}

echo "[1] ENVIRONMENT CONFIGURATION"
echo "─────────────────────────────"
test -f .env && test_result 0 ".env file exists" || test_result 1 ".env file exists"

DISCORD_TOKEN=$(grep "^DISCORD_TOKEN=" .env | cut -d'=' -f2)
[ -n "$DISCORD_TOKEN" ] && test_result 0 "Discord token configured" || test_result 1 "Discord token configured"

DATABASE_URL=$(grep "^DATABASE_URL=" .env | cut -d'=' -f2)
[ -n "$DATABASE_URL" ] && test_result 0 "Database URL configured" || test_result 1 "Database URL configured"

LAVALINK_HOST=$(grep "^LAVALINK_HOST=" .env | cut -d'=' -f2)
[ -n "$LAVALINK_HOST" ] && test_result 0 "Lavalink configured" || test_result 1 "Lavalink configured"

echo ""
echo "[2] DOCKER CONTAINERS"
echo "─────────────────────────────"
docker ps --format "{{.Names}}" | grep -q "chopsticks-main-bot" && test_result 0 "Main bot running" || test_result 1 "Main bot running"
docker ps --format "{{.Names}}" | grep -q "chopsticks-agent-runner" && test_result 0 "Agent runner running" || test_result 1 "Agent runner running"
docker ps --format "{{.Names}}" | grep -q "chopsticks-postgres" && test_result 0 "PostgreSQL running" || test_result 1 "PostgreSQL running"
docker ps --format "{{.Names}}" | grep -q "chopsticks-lavalink" && test_result 0 "Lavalink running" || test_result 1 "Lavalink running"
docker ps --format "{{.Names}}" | grep -q "chopsticks-redis" && test_result 0 "Redis running" || test_result 1 "Redis running"

echo ""
echo "[3] SERVICE HEALTH"
echo "─────────────────────────────"

# Check main bot health
docker exec chopsticks-main-bot curl -sf http://localhost:8080/health > /dev/null 2>&1 && test_result 0 "Main bot health endpoint" || test_result 1 "Main bot health endpoint"

# Check agent control plane
docker exec chopsticks-main-bot netstat -tln 2>/dev/null | grep -q ":8787" && test_result 0 "Agent control plane listening" || test_result 1 "Agent control plane listening"

# Check Lavalink
docker exec chopsticks-lavalink-1 curl -sf http://localhost:2333/version > /dev/null 2>&1 && test_result 0 "Lavalink responding" || test_result 1 "Lavalink responding"

# Check PostgreSQL
docker exec chopsticks-postgres-1 pg_isready -U chopsticks > /dev/null 2>&1 && test_result 0 "PostgreSQL ready" || test_result 1 "PostgreSQL ready"

# Check Redis
docker exec chopsticks-redis-1 redis-cli ping > /dev/null 2>&1 && test_result 0 "Redis responding" || test_result 1 "Redis responding"

echo ""
echo "[4] DATABASE SCHEMA"
echo "─────────────────────────────"

docker exec chopsticks-postgres-1 psql -U chopsticks -d chopsticks -c "\dt" 2>/dev/null | grep -q "guild_settings" && test_result 0 "guild_settings table exists" || test_result 1 "guild_settings table exists"
docker exec chopsticks-postgres-1 psql -U chopsticks -d chopsticks -c "\dt" 2>/dev/null | grep -q "agent_bots" && test_result 0 "agent_bots table exists" || test_result 1 "agent_bots table exists"
docker exec chopsticks-postgres-1 psql -U chopsticks -d chopsticks -c "\dt" 2>/dev/null | grep -q "agent_runners" && test_result 0 "agent_runners table exists" || test_result 1 "agent_runners table exists"
docker exec chopsticks-postgres-1 psql -U chopsticks -d chopsticks -c "\dt" 2>/dev/null | grep -q "audit_log" && test_result 0 "audit_log table exists" || test_result 1 "audit_log table exists"

echo ""
echo "[5] AGENT SYSTEM"
echo "─────────────────────────────"

AGENT_COUNT=$(docker exec chopsticks-postgres-1 psql -U chopsticks -d chopsticks -t -c "SELECT COUNT(*) FROM agent_bots WHERE status='active';" 2>/dev/null | tr -d ' ')
[ "$AGENT_COUNT" -gt 0 ] && test_result 0 "Agents registered in database ($AGENT_COUNT)" || test_result 1 "Agents registered in database"

docker logs chopsticks-main-bot --tail 50 2>&1 | grep -q "Agent control listening" && test_result 0 "Agent control plane started" || test_result 1 "Agent control plane started"

docker logs chopsticks-agent-runner --tail 50 2>&1 | grep -q "Polling for agent changes" && test_result 0 "Agent runner polling" || test_result 1 "Agent runner polling"

echo ""
echo "[6] DISCORD BOT STATUS"
echo "─────────────────────────────"

docker logs chopsticks-main-bot --tail 100 2>&1 | grep -q "Ready as Chopsticks" && test_result 0 "Bot logged into Discord" || test_result 1 "Bot logged into Discord"

GUILD_COUNT=$(docker logs chopsticks-main-bot --tail 50 2>&1 | grep "Serving" | tail -1 | grep -oP '\d+(?= guilds)')
[ -n "$GUILD_COUNT" ] && [ "$GUILD_COUNT" -gt 0 ] && test_result 0 "Bot serving guilds ($GUILD_COUNT)" || test_result 1 "Bot serving guilds"

echo ""
echo "[7] COMMAND SYSTEM"
echo "─────────────────────────────"

CMD_COUNT=$(docker exec chopsticks-main-bot ls -1 /app/src/commands/*.js 2>/dev/null | wc -l)
[ "$CMD_COUNT" -gt 40 ] && test_result 0 "Commands loaded ($CMD_COUNT files)" || test_result 1 "Commands loaded"

docker logs chopsticks-main-bot --tail 200 2>&1 | grep -q "commands loaded" && test_result 0 "Command loader executed" || test_result 1 "Command loader executed"

echo ""
echo "[8] ERROR DETECTION"
echo "─────────────────────────────"

ERROR_COUNT=$(docker logs chopsticks-main-bot --tail 100 2>&1 | grep -i "error\|fail" | grep -v "voiceStateUpdate" | wc -l)
[ "$ERROR_COUNT" -lt 3 ] && test_result 0 "No critical errors in main bot" || test_result 1 "No critical errors in main bot ($ERROR_COUNT found)"

AGENT_ERROR_COUNT=$(docker logs chopsticks-agent-runner --tail 100 2>&1 | grep -i "error\|fail" | wc -l)
[ "$AGENT_ERROR_COUNT" -lt 3 ] && test_result 0 "No critical errors in agent runner" || test_result 1 "No critical errors in agent runner ($AGENT_ERROR_COUNT found)"

echo ""
echo "[9] VOICE SERVICES"
echo "─────────────────────────────"

docker ps --format "{{.Names}}" | grep -q "chopsticks-voice-stt" && test_result 0 "Voice STT service running" || test_result 1 "Voice STT service running"
docker ps --format "{{.Names}}" | grep -q "chopsticks-voice-tts" && test_result 0 "Voice TTS service running" || test_result 1 "Voice TTS service running"
docker ps --format "{{.Names}}" | grep -q "chopsticks-voice-llm" && test_result 0 "Voice LLM service running" || test_result 1 "Voice LLM service running"

echo ""
echo "[10] MONITORING STACK"
echo "─────────────────────────────"

docker ps --format "{{.Names}}" | grep -q "chopsticks-prometheus" && test_result 0 "Prometheus running" || test_result 1 "Prometheus running"
docker ps --format "{{.Names}}" | grep -q "chopsticks-grafana" && test_result 0 "Grafana running" || test_result 1 "Grafana running"

echo ""
echo "=========================================="
echo "TEST SUMMARY"
echo "=========================================="
echo "  ✅ Passed: $PASS"
echo "  ❌ Failed: $FAIL"
echo "  📊 Success Rate: $((PASS * 100 / (PASS + FAIL)))%"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "🎉 ALL TESTS PASSED! System is healthy."
  echo ""
  echo "✨ READY FOR TESTING"
  echo "────────────────────"
  echo "Try these commands in Discord:"
  echo "  /ping"
  echo "  /music play never gonna give you up"
  echo "  /voice add"
  echo "  /agents list"
  echo ""
  echo "Monitor logs:"
  echo "  docker logs -f chopsticks-main-bot"
  exit 0
else
  echo "⚠️  Some tests failed. Review errors above."
  echo ""
  echo "Common fixes:"
  echo "  • Check .env configuration"
  echo "  • Ensure all Docker services are running"
  echo "  • Check Docker logs for specific errors"
  echo "  • Verify database connectivity"
  exit 1
fi
