#!/bin/bash
# Pre-deployment validation script

set -e

echo "===================================="
echo "Chopsticks Pre-Deploy Validation"
echo "===================================="
echo

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

# Check 1: Node.js syntax
echo "🔍 Checking JavaScript syntax..."
node --check src/index.js 2>&1 || { echo -e "${RED}✗ index.js has syntax errors${NC}"; ERRORS=$((ERRORS+1)); }
node --check src/agents/agentManager.js 2>&1 || { echo -e "${RED}✗ agentManager.js has syntax errors${NC}"; ERRORS=$((ERRORS+1)); }
node --check src/agents/agentRunner.js 2>&1 || { echo -e "${RED}✗ agentRunner.js has syntax errors${NC}"; ERRORS=$((ERRORS+1)); }
node --check src/utils/resourceMonitor.js 2>&1 || { echo -e "${RED}✗ resourceMonitor.js has syntax errors${NC}"; ERRORS=$((ERRORS+1)); }

if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✓ All syntax checks passed${NC}"
fi

# Check 2: .env file
echo
echo "🔍 Checking .env configuration..."
if [ ! -f .env ]; then
  echo -e "${RED}✗ .env file not found${NC}"
  ERRORS=$((ERRORS+1))
else
  # Check required variables
  source .env 2>/dev/null || true
  
  if [ -z "$DISCORD_TOKEN" ]; then
    echo -e "${RED}✗ DISCORD_TOKEN not set${NC}"
    ERRORS=$((ERRORS+1))
  fi
  
  if [ -z "$AGENT_TOKEN_KEY" ]; then
    echo -e "${RED}✗ AGENT_TOKEN_KEY not set${NC}"
    ERRORS=$((ERRORS+1))
  elif [ ${#AGENT_TOKEN_KEY} -ne 64 ]; then
    echo -e "${RED}✗ AGENT_TOKEN_KEY must be 64 characters (32 bytes hex)${NC}"
    ERRORS=$((ERRORS+1))
  fi
  
  if [ -z "$DATABASE_URL" ] && [ -z "$POSTGRES_USER" ]; then
    echo -e "${YELLOW}⚠ No database configuration found${NC}"
    WARNINGS=$((WARNINGS+1))
  fi
  
  if [ -z "$LAVALINK_HOST" ]; then
    echo -e "${YELLOW}⚠ LAVALINK_HOST not set (music won't work)${NC}"
    WARNINGS=$((WARNINGS+1))
  fi
  
  if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ .env configuration looks good${NC}"
  elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}✓ .env has warnings but can proceed${NC}"
  fi
fi

# Check 3: Docker
echo
echo "🔍 Checking Docker..."
if ! command -v docker &> /dev/null; then
  echo -e "${RED}✗ Docker not installed${NC}"
  ERRORS=$((ERRORS+1))
else
  echo -e "${GREEN}✓ Docker installed: $(docker --version | cut -d' ' -f3 | tr -d ',')${NC}"
  
  if ! docker compose version &> /dev/null; then
    echo -e "${RED}✗ Docker Compose not available${NC}"
    ERRORS=$((ERRORS+1))
  else
    echo -e "${GREEN}✓ Docker Compose available${NC}"
  fi
fi

# Check 4: Port availability
echo
echo "🔍 Checking port availability..."
if command -v nc &> /dev/null; then
  for PORT in 8787 2333 5432 6379; do
    if nc -z localhost $PORT 2>/dev/null; then
      echo -e "${YELLOW}⚠ Port $PORT already in use${NC}"
      WARNINGS=$((WARNINGS+1))
    fi
  done
  if [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All required ports available${NC}"
  fi
else
  echo -e "${YELLOW}⚠ nc not installed, skipping port check${NC}"
  WARNINGS=$((WARNINGS+1))
fi

# Check 5: File permissions
echo
echo "🔍 Checking file permissions..."
if [ ! -r package.json ]; then
  echo -e "${RED}✗ Cannot read package.json${NC}"
  ERRORS=$((ERRORS+1))
fi

if [ ! -x scripts/deploy-hetzner.sh ]; then
  echo -e "${YELLOW}⚠ deploy-hetzner.sh not executable${NC}"
  chmod +x scripts/deploy-hetzner.sh 2>/dev/null || WARNINGS=$((WARNINGS+1))
fi

if [ ! -x scripts/monitor-resources.sh ]; then
  echo -e "${YELLOW}⚠ monitor-resources.sh not executable${NC}"
  chmod +x scripts/monitor-resources.sh 2>/dev/null || WARNINGS=$((WARNINGS+1))
fi

# Check 6: Dependencies
echo
echo "🔍 Checking dependencies..."
if [ ! -d node_modules ]; then
  echo -e "${YELLOW}⚠ node_modules not found - run 'npm install'${NC}"
  WARNINGS=$((WARNINGS+1))
else
  echo -e "${GREEN}✓ node_modules exists${NC}"
fi

# Check 7: Database agent tokens
echo
echo "🔍 Checking agent configuration..."
if [ -f .env ]; then
  source .env 2>/dev/null || true
  if [ "$STORAGE_DRIVER" = "postgres" ] && [ -n "$DATABASE_URL" ]; then
    if command -v docker &> /dev/null && docker compose ps postgres 2>/dev/null | grep -q "Up"; then
      AGENT_COUNT=$(docker exec chopsticks-postgres psql -U ${POSTGRES_USER:-chopsticks} -t -c "SELECT COUNT(*) FROM agent_bots WHERE status='active';" 2>/dev/null | tr -d ' ' || echo "0")
      if [ "$AGENT_COUNT" = "0" ]; then
        echo -e "${YELLOW}⚠ No active agents in database${NC}"
        WARNINGS=$((WARNINGS+1))
      else
        echo -e "${GREEN}✓ Found $AGENT_COUNT active agent(s) in database${NC}"
      fi
    else
      echo -e "${YELLOW}⚠ PostgreSQL not running, skipping agent check${NC}"
      WARNINGS=$((WARNINGS+1))
    fi
  fi
fi

# Summary
echo
echo "===================================="
echo "Validation Summary"
echo "===================================="
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed! Ready to deploy.${NC}"
  exit 0
elif [ $ERRORS -eq 0 ]; then
  echo -e "${YELLOW}⚠ $WARNINGS warning(s) found but can proceed${NC}"
  exit 0
else
  echo -e "${RED}✗ $ERRORS error(s) found. Fix before deploying.${NC}"
  if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS warning(s) also found${NC}"
  fi
  exit 1
fi
