#!/bin/bash
# Unified startup script for Chopsticks platform
# One-command bring-up from clean machine

set -e

echo "🥢 Starting Chopsticks Platform..."

# Detect environment
if [ -f "docker-compose.production.yml" ]; then
  COMPOSE_FILE="docker-compose.production.yml"
elif [ -f "docker-compose.yml" ]; then
  COMPOSE_FILE="docker-compose.yml"
else
  echo "❌ No docker-compose file found"
  exit 1
fi

echo "Using compose file: $COMPOSE_FILE"

COMPOSE_ARGS=(-f "$COMPOSE_FILE")
if [ "$COMPOSE_FILE" = "docker-compose.production.yml" ]; then
  PROFILES="${COMPOSE_PROFILES:-dashboard,monitoring,fun}"
  IFS=',' read -ra PROFILE_LIST <<< "$PROFILES"
  for profile in "${PROFILE_LIST[@]}"; do
    profile="${profile//[[:space:]]/}"
    [ -n "$profile" ] && COMPOSE_ARGS+=(--profile "$profile")
  done
  echo "Active profiles: ${PROFILES}"
fi

# Check prerequisites
if ! command -v docker &> /dev/null; then
  echo "❌ Docker not installed"
  exit 1
fi

if ! docker compose version &> /dev/null; then
  echo "❌ Docker Compose not installed"
  exit 1
fi

# Check .env file
if [ ! -f ".env" ]; then
  echo "⚠️  No .env file found"
  if [ -f ".env.example" ]; then
    echo "Copying .env.example to .env..."
    cp .env.example .env
    echo "⚠️  Please configure .env and run again"
    exit 1
  else
    echo "❌ No .env.example found"
    exit 1
  fi
fi

# Start services
echo "Starting services..."
docker compose "${COMPOSE_ARGS[@]}" up -d --remove-orphans

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check service readiness from Docker health/state (works even without published health ports)
SERVICES="$(docker compose "${COMPOSE_ARGS[@]}" config --services 2>/dev/null || true)"
PRIMARY_SERVICE="bot"
if echo "$SERVICES" | grep -qx "bot"; then
  PRIMARY_SERVICE="bot"
elif echo "$SERVICES" | grep -qx "main-bot"; then
  PRIMARY_SERVICE="main-bot"
elif [ -n "$SERVICES" ]; then
  PRIMARY_SERVICE="$(echo "$SERVICES" | head -n 1)"
fi

MAX_WAIT=90

for i in $(seq 1 $MAX_WAIT); do
  CONTAINER_ID="$(docker compose "${COMPOSE_ARGS[@]}" ps -q "$PRIMARY_SERVICE" 2>/dev/null || true)"
  STATUS="unknown"

  if [ -n "$CONTAINER_ID" ]; then
    STATUS="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_ID" 2>/dev/null || echo unknown)"
  fi

  if [ "$STATUS" = "healthy" ] || [ "$STATUS" = "running" ]; then
    echo "✅ Platform is ready!"
    echo ""
    echo "Services:"
    docker compose "${COMPOSE_ARGS[@]}" ps
    echo ""
    echo "Primary service: $PRIMARY_SERVICE ($STATUS)"
    echo "View logs: docker compose ${COMPOSE_ARGS[*]} logs -f $PRIMARY_SERVICE"
    exit 0
  fi

  if [ $i -eq $MAX_WAIT ]; then
    echo "❌ Platform did not become ready in time"
    echo "Last status for '$PRIMARY_SERVICE': $STATUS"
    echo "Check logs: docker compose ${COMPOSE_ARGS[*]} logs $PRIMARY_SERVICE"
    exit 1
  fi

  sleep 1
done
