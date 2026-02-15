#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCK_FILE="${LOCK_FILE:-/tmp/chopsticks-auto-update.lock}"
REMOTE="${AUTO_UPDATE_REMOTE:-private}"
BRANCH="${AUTO_UPDATE_BRANCH:-main}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.production.yml}"
PROFILES="${COMPOSE_PROFILES:-dashboard,monitoring,fun}"
SERVICES="${AUTO_UPDATE_SERVICES:-bot agents dashboard funhub}"
RUN_GATES="${AUTO_UPDATE_RUN_GATES:-true}"
DRY_RUN="${AUTO_UPDATE_DRY_RUN:-false}"

log() {
  printf '%s [auto-update] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "another update job is already running; skipping"
  exit 0
fi

cd "$ROOT_DIR"

if [ "$DRY_RUN" = "true" ]; then
  log "dry-run enabled; no changes will be applied"
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "not a git repository: $ROOT_DIR"
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  log "remote '$REMOTE' not configured"
  exit 1
fi

IFS=',' read -ra PROFILE_LIST <<< "$PROFILES"
COMPOSE_ARGS=(-f "$COMPOSE_FILE")
for profile in "${PROFILE_LIST[@]}"; do
  trimmed="${profile//[[:space:]]/}"
  [ -n "$trimmed" ] && COMPOSE_ARGS+=(--profile "$trimmed")
done

LOCAL_SHA="$(git rev-parse HEAD)"

if [ "$DRY_RUN" = "true" ]; then
  log "would run: git fetch $REMOTE $BRANCH"
else
  git fetch "$REMOTE" "$BRANCH"
fi

REMOTE_SHA="$(git rev-parse "$REMOTE/$BRANCH")"

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  log "already up to date ($LOCAL_SHA)"
  exit 0
fi

if ! git merge-base --is-ancestor "$LOCAL_SHA" "$REMOTE_SHA"; then
  log "local branch has diverged; refusing non-fast-forward update"
  exit 1
fi

log "update available: $LOCAL_SHA -> $REMOTE_SHA"

if [ "$DRY_RUN" = "true" ]; then
  log "would run: git pull --ff-only $REMOTE $BRANCH"
else
  git pull --ff-only "$REMOTE" "$BRANCH"
fi

if [ "$RUN_GATES" = "true" ]; then
  if [ "$DRY_RUN" = "true" ]; then
    log "would run: npm run ci:syntax"
    log "would run: npm run ci:migrations"
  else
    npm run ci:syntax
    npm run ci:migrations
  fi
fi

if [ "$DRY_RUN" = "true" ]; then
  log "would run: docker compose ${COMPOSE_ARGS[*]} up -d --build $SERVICES"
  log "would run: bash scripts/ops/chopsticks-watchdog.sh"
  exit 0
fi

docker compose "${COMPOSE_ARGS[@]}" up -d --build $SERVICES
bash scripts/ops/chopsticks-watchdog.sh

log "update applied successfully"
