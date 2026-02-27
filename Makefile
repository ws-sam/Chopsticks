# Chopsticks Platform Makefile
# Enforces maturity model progression

.PHONY: help start stop restart logs logs-agents logs-lavalink logs-all health status clean rebuild rebuild-all test-level-0 test-level-1 test-protocol verify-clean-boot

# Default target
help:
	@echo "🥢 Chopsticks Platform - Laptop Hardened Stack"
	@echo ""
	@echo "Common Commands:"
	@echo "  make start              - Start all services (one-command bring-up)"
	@echo "  make stop               - Stop all services"
	@echo "  make restart            - Restart all services"
	@echo "  make logs               - Follow bot logs"
	@echo "  make logs-agents        - Follow agent-runner logs"
	@echo "  make logs-lavalink      - Follow lavalink logs"
	@echo "  make logs-all           - Follow all service logs"
	@echo "  make health             - Check system health"
	@echo "  make status             - Show container status"
	@echo ""
	@echo "Building:"
	@echo "  make rebuild            - Rebuild bot + agents images and restart"
	@echo "  make rebuild-all        - Rebuild all images and restart"
	@echo "  make deploy-commands    - Deploy slash commands"
	@echo ""
	@echo "Testing & Verification:"
	@echo "  make test-level-0       - Run Level 0 maturity checks"
	@echo "  make test-level-1       - Run Level 1 contract tests"
	@echo "  make test-protocol      - Run protocol versioning tests"
	@echo "  make verify-clean-boot  - Verify clean boot from scratch"
	@echo "  make clean              - Clean all containers and volumes"
	@echo ""
	@echo "Compose file: docker-compose.laptop.yml (override with COMPOSE_FILE=...)"

# Start the platform
start:
	@./scripts/ops/chopsticksctl.sh up

# Stop the platform
stop:
	@./scripts/ops/chopsticksctl.sh down

# Restart the platform
restart: stop start

# Follow logs
logs:
	@./scripts/ops/chopsticksctl.sh logs bot

logs-agents:
	@./scripts/ops/chopsticksctl.sh logs agents

logs-lavalink:
	@./scripts/ops/chopsticksctl.sh logs lavalink

logs-all:
	@./scripts/ops/chopsticksctl.sh logs

# Check health
health:
	@curl -s http://localhost:8080/healthz | jq . || curl -s http://localhost:8080/health | jq . || echo "Health endpoint not responding"

# Show status
status:
	@./scripts/ops/chopsticksctl.sh status

# Clean everything
clean:
	@echo "⚠️  This will remove all containers and volumes"
	@read -p "Continue? [y/N] " -n 1 -r; \
	echo ""; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		docker compose -f docker-compose.laptop.yml down -v; \
		echo "✅ Cleaned"; \
	fi

# Level 0 maturity check
test-level-0:
	@echo "Running Level 0 maturity checks..."
	@./scripts/ci/level-0-check.sh

# Level 1 contract tests
test-level-1:
	@echo "Running Level 1 contract tests..."
	@npm run test:level-1

# Protocol versioning tests
test-protocol:
	@npx mocha test/unit/protocol-version.test.js

# Verify clean boot
verify-clean-boot:
	@./scripts/verify-clean-boot.sh

# Rebuild bot + agents images and restart
rebuild:
	@docker compose -f $${COMPOSE_FILE:-docker-compose.laptop.yml} build bot agents
	@docker compose -f $${COMPOSE_FILE:-docker-compose.laptop.yml} up -d bot agents
	@echo "✅ Bot and agents rebuilt and restarted"

# Rebuild all images and restart
rebuild-all:
	@docker compose -f $${COMPOSE_FILE:-docker-compose.laptop.yml} build
	@docker compose -f $${COMPOSE_FILE:-docker-compose.laptop.yml} up -d
	@echo "✅ All images rebuilt and restarted"

# Deploy slash commands (global + guild)
deploy-commands:
	@DEPLOY_MODE=global node scripts/deployCommands.js
	@echo "✅ Commands deployed globally"

# Deploy slash commands to dev guild only (instant, for testing)
deploy-commands-guild:
	@DEPLOY_MODE=guild node scripts/deployCommands.js
	@echo "✅ Commands deployed to dev guild"

# Check current maturity level
maturity:
	@echo "Current Maturity Level: 1"
	@echo "See docs/status/MATURITY.md for details"
	@grep "^- \\[" docs/status/MATURITY.md | head -20
