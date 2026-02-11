#!/bin/bash
# Resource monitoring script for Chopsticks

set -e

echo "===================================="
echo "Chopsticks Resource Monitor"
echo "===================================="
echo

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Get container stats
echo -e "${BLUE}Container Resource Usage:${NC}"
echo "----------------------------------------"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}"

echo
echo -e "${BLUE}System Resources:${NC}"
echo "----------------------------------------"

# CPU Usage
CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
echo -e "CPU Usage: ${CPU_USAGE}%"

# Memory Usage
MEM_INFO=$(free -m | awk 'NR==2{printf "Memory: %sMB/%sMB (%.2f%%)", $3,$2,$3*100/$2 }')
echo -e "$MEM_INFO"

# Disk Usage
DISK_INFO=$(df -h / | awk 'NR==2{printf "Disk: %s/%s (%s used)", $3,$2,$5}')
echo -e "$DISK_INFO"

# Swap Usage
SWAP_INFO=$(free -m | awk 'NR==3{printf "Swap: %sMB/%sMB", $3,$2}')
echo -e "$SWAP_INFO"

echo
echo -e "${BLUE}Database Size:${NC}"
echo "----------------------------------------"
docker exec chopsticks-postgres psql -U chopsticks -c "SELECT pg_size_pretty(pg_database_size('chopsticks')) as size;" 2>/dev/null || echo "Could not get DB size"

echo
echo -e "${BLUE}Active Agents:${NC}"
echo "----------------------------------------"
AGENT_COUNT=$(docker exec chopsticks-postgres psql -U chopsticks -t -c "SELECT COUNT(*) FROM agent_bots WHERE status='active';" 2>/dev/null | tr -d ' ')
echo "Registered agents: ${AGENT_COUNT:-0}"

echo
echo -e "${BLUE}Guild Count:${NC}"
echo "----------------------------------------"
GUILD_COUNT=$(docker exec chopsticks-postgres psql -U chopsticks -t -c "SELECT COUNT(*) FROM guild_settings;" 2>/dev/null | tr -d ' ')
echo "Guilds: ${GUILD_COUNT:-0}"

echo
echo -e "${BLUE}Recent Logs (Last 20 lines):${NC}"
echo "----------------------------------------"
docker compose logs --tail=20 bot 2>/dev/null || echo "Could not fetch logs"

echo
echo "===================================="
echo "Monitoring complete"
echo "===================================="
