# CLAUDE.md — Chopsticks Agent Guide

> This file is the authoritative reference for AI coding agents (Claude, Copilot, etc.) working in
> the Chopsticks repository. Read it before writing any code.

---

## What Is Chopsticks?

Chopsticks is a **full-featured, open-source (MIT) Discord bot** built on **discord.js v14** and
**Node.js 22**. It serves hundreds of Discord servers (guilds) simultaneously and exposes over
**70 slash commands** across music, moderation, economy, AI, social, games, and utility categories.

Chopsticks is part of the **WokSpec** product family. Its AI commands are backed by
[Eral](../Eral/README.md) — WokSpec's AI layer. Other WokSpec integrations include WokPost and
WokGen.

The bot is self-hostable. Users clone the repo, fill in `.env`, and run via Docker or Node
directly. The public hosted instance lives at `chopsticks.wokspec.org`.

---

## Hard Constraints — DO NOT Violate

| Rule | Why |
|------|-----|
| **Never break existing slash command interfaces** | Hundreds of guilds depend on exact command names, subcommand names, option names, and option types. Changing them silently breaks every server using that command. |
| **Never commit secrets or tokens** | Discord tokens, database credentials, and API keys grant full bot/DB access. Gitleaks is configured (`.gitleaks.toml`) and enforced in CI. See the [Secret Hygiene](#secret-hygiene--gitleaks) section. |
| **Never remove a database column without a migration** | Prisma migrations are checked in CI via `npm run ci:migrations`. Removing a column or table without a migration file causes boot failures in production. |
| **Always call `interaction.reply()` or `interaction.deferReply()`** | Discord's 3-second interaction timeout causes "This interaction failed" errors in servers if you forget. Use `withTimeout()` from `src/utils/interactionTimeout.js` for long operations. |
| **Never log Discord tokens** | Even partial tokens (first N characters) can be used to identify bots. The agent token key (`AGENT_TOKEN_KEY`) encrypts tokens at rest — never decrypt them into log lines. |
| **Do not edit `prisma/schema.prisma` without creating a migration** | Run `npx prisma migrate dev --name <description>` locally to generate the migration SQL file. |

---

## High-Fidelity UI Standards (Anti-Vibe-Coded)

Chopsticks must follow the WokSpec High-Fidelity UI Standards defined in [../UI_STANDARDS.md](../UI_STANDARDS.md).

- **8pt Spacing:** Use strict 4/8pt increments for all layout gaps and paddings.
- **Loading States:** Every async action (e.g. music loading, economy processing) must show a loading indicator or skeleton screen.
- **Consistency:** Maintain uniform border-radii and typography across all UI elements.
- **Anti-Vibe:** Avoid random purple gradients and sparkle emoji overkill.

---

## Repository Structure

```
Chopsticks/
├── src/
│   ├── agents/          # Agent Pool System — control plane + runner
│   │   ├── agentManager.js   # WebSocket control-plane server (AgentManager class)
│   │   ├── agentProtocol.js  # Protocol constants, helpers, version negotiation
│   │   ├── agentRunner.js    # Per-process Discord client runner (community agents)
│   │   ├── env.js            # Agent-specific env parsing
│   │   └── spawn.js          # Spawn helpers
│   ├── assistant/       # AI assistant integration (Eral-backed)
│   │   ├── config.js
│   │   └── service.js
│   ├── audiobook/       # Audiobook player (TTS + parsing)
│   │   ├── parser.js
│   │   ├── player.js
│   │   ├── session.js
│   │   └── tts.js
│   ├── commands/        # 114 slash command files (one file = one command)
│   ├── config/          # Bot-wide configuration helpers
│   ├── dashboard/       # Web dashboard (Express, guild management UI)
│   ├── deploy-commands.js  # Command registration entry-point (imported by scripts)
│   ├── dev-dashboard/   # Developer-facing admin dashboard
│   ├── events/          # discord.js event handlers
│   ├── fun/             # FunHub server (games, mini-apps)
│   ├── lavalink/        # Lavalink client wrappers
│   ├── moderation/      # Moderation guards, output helpers
│   ├── music/           # Music queue, session management, config
│   ├── tools/           # Shared tool modules (mod cases, etc.)
│   ├── utils/           # Shared utilities (logger, redis, storage, metrics, …)
│   ├── bootstrap.js     # Bot startup sequence
│   └── index.js         # Main entry point
├── prisma/              # Prisma schema + migration files
│   ├── schema.prisma
│   └── migrations/
├── scripts/             # Utility scripts (deploy, migrate, CI helpers)
│   └── ci/              # CI-specific scripts
├── test/
│   └── unit/            # Mocha unit tests
├── docs/                # Extended documentation
├── lavalink/            # Lavalink config
├── Dockerfile.bot       # Main bot container
├── Dockerfile.agentrunner  # Agent runner container
├── docker-compose.*.yml # Various compose profiles
├── Makefile             # Convenience targets
├── Caddyfile            # Reverse proxy config
└── .env.example         # Environment variable reference
```

---

## discord.js v14 Patterns

### Slash Command File Structure

Every command lives in `src/commands/<name>.js`. The file **must** export:

- `data` — a `SlashCommandBuilder` instance (defines the slash command schema)
- `execute(interaction)` — the handler function
- `meta` — an object with `{ deployGlobal, guildOnly, userPerms, category }`

Example minimal command:

```js
import { SlashCommandBuilder } from "discord.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  deployGlobal: true,
  guildOnly: true,
  userPerms: [],
  category: "utility",
};

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check bot latency");

export async function execute(interaction) {
  await withTimeout(interaction, async () => {
    const ms = Date.now() - interaction.createdTimestamp;
    await interaction.reply({ content: `Pong! \`${ms}ms\`` });
  });
}
```

### Interaction Patterns

```js
// Always reply within 3 seconds, or defer first for long ops
await interaction.deferReply();
// ... do async work ...
await interaction.editReply({ embeds: [embed] });

// Ephemeral (only visible to user)
await interaction.reply({ content: "...", flags: MessageFlags.Ephemeral });

// Error reply helper
import { replyError } from "../utils/discordOutput.js";
await replyError(interaction, "Something went wrong");
```

### Event Handlers

Event handlers live in `src/events/`. Each file exports:

```js
export const name = "messageCreate";   // discord.js event name
export const once = false;             // true for 'ready'
export async function execute(message, client) { ... }
```

### Embed Design System

Use `makeEmbed(options)` from `src/utils/discordOutput.js` for consistent embed styling. Follow
the conventions in `docs/EMBED_DESIGN_SYSTEM.md`.

---

## Adding a New Slash Command

1. **Create the file** at `src/commands/<commandname>.js`.
2. Export `data` (SlashCommandBuilder), `execute(interaction)`, and `meta`.
3. **Register it** — commands are auto-loaded by the command loader; no manual import needed.
4. **Deploy** during development: `npm run deploy:guild` (deploys to dev guild only, instant).
   For production: `npm run deploy:global` (takes up to 1 hour to propagate globally).
5. **Write a unit test** if the command has non-trivial logic (e.g., economy mutations).
6. **Add to `docs/COMMANDS.md`** with a description.

> ⚠️ Never rename or remove options from a deployed slash command without coordinating a
> migration period — Discord caches command schemas and servers will see outdated option lists
> until the global update propagates.

---

## Adding a New Economy Feature

Economy state is stored in PostgreSQL via Prisma. Guild economy settings live in the guild record;
user balances and inventory live in user records.

1. **Check the schema** in `prisma/schema.prisma` for existing `User` and `Guild` models.
2. **Add fields** if needed — create a migration with `npx prisma migrate dev --name <desc>`.
3. Use `loadGuildData` / `saveGuildData` from `src/utils/storage.js` for guild-scoped data.
4. Use Redis via `src/utils/redis.js` to cache frequently read balances (TTL: 60s typical).
5. Emit an audit log via `src/utils/audit.js` for any balance-changing action.
6. If adding a new economy command, wire it under `src/commands/` following the pattern above.

---

## Database Patterns (Prisma + PostgreSQL)

### Schema Conventions

- All tables have `guild_id` and/or `user_id` columns indexed.
- Use compound unique constraints: `@@unique([guildId, userId])` for user-per-guild records.
- Prefer `BigInt` for Discord snowflake IDs (guild IDs, user IDs, channel IDs).
- All timestamp columns are `DateTime @default(now())`.

### Prisma Client Usage

```js
import { getPrisma } from "../utils/storage.js";

const prisma = getPrisma();

// Guild settings
const guild = await prisma.guild.upsert({
  where: { id: guildId },
  update: { prefix: newPrefix },
  create: { id: guildId, prefix: newPrefix },
});

// User economy
const user = await prisma.user.findUnique({ where: { id: userId } });
```

### Migration Workflow

```bash
# Generate a migration (creates SQL in prisma/migrations/)
npx prisma migrate dev --name add_quest_table

# Apply in production
npx prisma migrate deploy

# CI migration gate
npm run ci:migrations   # Checks that all migrations are applied
```

---

## Redis Caching Patterns

Redis is available via `src/utils/redis.js`:

```js
import { getCache, setCache, delCache } from "../utils/redis.js";

// Read-through cache
const cached = await getCache(`guild:${guildId}:economy`);
if (cached) return JSON.parse(cached);

const data = await prisma.guildEconomy.findUnique({ where: { guildId } });
await setCache(`guild:${guildId}:economy`, JSON.stringify(data), 60); // TTL 60s
return data;
```

**Key prefixes:**

| Prefix | Purpose |
|--------|---------|
| `guild:<id>:*` | Guild settings and config |
| `user:<id>:*` | User state |
| `session:<key>` | Music / agent sessions |
| `rl:<type>:<id>` | Rate limiting buckets |
| `cache:<hash>` | Generic cached results |

Always set a TTL. Never cache Discord tokens or decrypted secrets.

---

## Lavalink Integration (Music)

Music playback is delegated entirely to Lavalink audio nodes. The bot sends Lavalink REST/WS
commands; audio is streamed directly from Lavalink to Discord voice.

### Key Files

| File | Purpose |
|------|---------|
| `src/lavalink/agentLavalink.js` | Lavalink client factory for agent runners |
| `src/music/service.js` | Session lifecycle: `ensureSessionAgent()`, `releaseSession()` |
| `src/music/config.js` | Per-guild music settings |
| `src/music/primarySession.js` | Primary session tracking |
| `src/commands/music.js` | The `/music` slash command (all subcommands) |

### Patterns

```js
import { ensureSessionAgent, sendAgentCommand, releaseSession } from "../music/service.js";

// Get or create a music session for a voice channel
const { agentId, session } = await ensureSessionAgent(guildId, voiceChannelId, userId);

// Send a command to the agent (play, skip, pause, etc.)
await sendAgentCommand(agentId, { type: "play", query: "never gonna give you up" });

// Release when done
await releaseSession(guildId, voiceChannelId);
```

### Lavalink Environment Variables

```
LAVALINK_HOST=lavalink       # Hostname of Lavalink node
LAVALINK_PORT=2333           # Port
LAVALINK_PASSWORD=youshallnotpass
```

---

## Agent Pool System Architecture

The Agent Pool System allows community members to contribute their own Discord bot tokens to
augment Chopsticks' voice capacity. Multiple bots can be dispatched into voice channels
simultaneously across different guilds.

### How It Works

```
┌─────────────────────────────────────────────────────────┐
│  Main Bot (Chopsticks)                                   │
│  - Handles all slash commands                            │
│  - Manages economy, moderation, etc.                     │
│  - AgentManager (WebSocket server on :8787)              │
└───────────────────┬─────────────────────────────────────┘
                    │ WebSocket (agent protocol)
         ┌──────────┴──────────┐
         │  agentRunner.js     │  (one process per agent token)
         │  - Spawns discord.js │
         │  - Joins voice channels
         │  - Runs Lavalink client
         │  - Reports to AgentManager
         └─────────────────────┘
```

### Key Concepts

- **AgentManager** (`src/agents/agentManager.js`): WebSocket server. Tracks all connected agents,
  leases agents per `(guildId, voiceChannelId)` session, handles reconnection and circuit breaking.
- **agentRunner.js** (`src/agents/agentRunner.js`): Runs as a separate process (or container).
  Connects to AgentManager, announces available guilds, accepts voice join/leave commands.
- **Agent Protocol** (`src/agents/agentProtocol.js`): Defines message types, protocol version,
  session keys, encryption helpers.
- **Tokens encrypted at rest** using `AGENT_TOKEN_KEY` (AES-256). Never store or log plaintext tokens.
- **Per-guild pooling**: Multiple agent runners can serve the same guild (round-robin selection).
- **Circuit breaker** (opossum): Prevents cascade failures when an agent is unhealthy.

### Adding an Agent to the Pool

1. Community member submits their bot token via the `/agentkeys` command.
2. Token is encrypted with `AGENT_TOKEN_KEY` and stored in PostgreSQL.
3. `agentRunner.js` polls the DB, decrypts, and spawns a `discord.js` Client.
4. Runner connects to `AGENT_CONTROL_URL` WebSocket and announces itself.
5. AgentManager adds it to the pool for lease requests.

### Security Rules for Agent Code

- **Never log agent tokens** — not even the first few characters.
- **Never expose agent token in API responses** — the `/pools` command shows metadata only.
- Use `timingSafeEqual` for secret comparison (already used in `agentRunner.js`).
- `AGENT_RUNNER_SECRET` must be set in production to authenticate runner ↔ manager connections.

---

## Docker Deployment

Chopsticks ships multiple Docker Compose files for different deployment scenarios:

| File | Purpose |
|------|---------|
| `docker-compose.production.yml` | Production stack (bot + postgres + redis + lavalink) |
| `docker-compose.full.yml` | Full stack with all optional services |
| `docker-compose.free.yml` | Minimal free-tier deployment |
| `docker-compose.monitoring.yml` | Prometheus + Grafana metrics |
| `docker-compose.voice.yml` | Voice-only agent runners |
| `docker-compose.laptop.yml` | Local development |

### Dockerfiles

| File | Purpose |
|------|---------|
| `Dockerfile.bot` | Main bot image |
| `Dockerfile.agentrunner` | Agent runner image (community token runner) |

### Common Docker Commands

```bash
# Start production stack
docker compose -f docker-compose.production.yml up -d

# Start with monitoring
docker compose -f docker-compose.production.yml -f docker-compose.monitoring.yml --profile monitoring up -d

# View logs
docker compose -f docker-compose.production.yml logs -f bot

# Run Prisma migrations in container
docker compose -f docker-compose.production.yml exec bot npx prisma migrate deploy

# Rebuild after code change
docker compose -f docker-compose.production.yml build bot && docker compose -f docker-compose.production.yml up -d bot
```

---

## Environment Variables

All variables are documented in `.env.example`. Key variables:

### Required

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal |
| `CLIENT_ID` | Bot application ID |
| `DATABASE_URL` | PostgreSQL connection string |
| `POSTGRES_URL` | Same as DATABASE_URL (both used by different subsystems) |
| `REDIS_URL` | Redis connection string (e.g. `redis://redis:6379`) |
| `AGENT_TOKEN_KEY` | 64-char hex key for encrypting community agent tokens at rest |
| `STORAGE_DRIVER` | Must be `postgres` for production |

### Music (Lavalink)

| Variable | Description |
|----------|-------------|
| `LAVALINK_HOST` | Lavalink hostname |
| `LAVALINK_PORT` | Lavalink port (default: 2333) |
| `LAVALINK_PASSWORD` | Lavalink auth password |

### Agent Pool

| Variable | Description |
|----------|-------------|
| `AGENT_CONTROL_HOST` | AgentManager bind host (default: 127.0.0.1) |
| `AGENT_CONTROL_PORT` | AgentManager WebSocket port (default: 8787) |
| `AGENT_CONTROL_URL` | URL agents use to connect to AgentManager |
| `AGENT_RUNNER_SECRET` | Shared secret for runner ↔ manager auth |

### Dashboard

| Variable | Description |
|----------|-------------|
| `DASHBOARD_SESSION_SECRET` | Session signing secret (generate: `openssl rand -hex 32`) |
| `DASHBOARD_ADMIN_TOKEN` | Admin access token |
| `DASHBOARD_COOKIE_SECURE` | `true` in production behind HTTPS |
| `DASHBOARD_TRUST_PROXY` | `1` when behind a reverse proxy |

### Optional

| Variable | Description |
|----------|-------------|
| `BOT_OWNER_IDS` | Comma-separated Discord user IDs with full bot owner access |
| `DEV_GUILD_ID` | Development guild for guild-scoped command deployment |
| `HEALTH_PORT` | HTTP health check port (default: 8080) |
| `SVG_CARDS` | `true` to enable SVG card rendering for embed outputs |
| `SENTRY_DSN` | Sentry error tracking DSN |
| `DEV_API_USERNAME` / `DEV_API_PASSWORD` | Dev API credentials |

---

## Testing Approach

### Syntax Gate

```bash
npm run ci:syntax
# Runs: node --check on every .js file in src/, scripts/, test/, migrations/
# Fast — catches parse errors before anything runs
```

### Unit Tests (Mocha)

```bash
npm test
# Runs: mocha 'test/unit/**/*.test.js'
```

Unit tests live in `test/unit/`. Current test suites cover:

- `protocol-version.test.js` — AgentProtocol version negotiation
- `agent-limits.test.js` — Max agents per guild enforcement
- `agent-deployment.test.js` — Agent deployment flows
- `session-lifecycle.test.js` — Session lease/release

When adding a new unit test, create `test/unit/<feature>.test.js` using Mocha's `describe`/`it`
pattern. No test framework setup needed — Mocha is configured in `package.json`.

### Migration Gate

```bash
npm run ci:migrations
# Verifies no unapplied migrations exist
```

### Discord Smoke Test (manual/dispatch only)

```bash
npm run smoke:discord
# Requires: DISCORD_TOKEN, CLIENT_ID, STAGING_GUILD_ID
# Only runs on workflow_dispatch in CI (not on every push)
```

---

## Secret Hygiene & Gitleaks

> ⚠️ **CRITICAL**: Discord tokens, database passwords, and API keys **must never be committed**
> to source control. A leaked Discord token gives full bot access — it can be used to read all
> messages, ban users, and destroy servers.

A `.gitleaks.toml` config exists at the repo root and is enforced in CI via
`.github/workflows/gitleaks.yml`. Gitleaks scans every push and PR for:

- Discord bot tokens (pattern: `[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27,}`)
- Generic API keys and secrets
- PostgreSQL connection strings with credentials
- Any high-entropy strings matching known token patterns

**If gitleaks blocks your PR:**
1. The commit containing the secret must be amended or rebased — do NOT just delete the file.
2. Rotate the leaked token immediately (invalidate it in Discord Developer Portal / provider).
3. Never add a gitleaks `.allowlist` entry to bypass a real token — only for test fixtures
   (and even then, use placeholder values like `REPLACE_ME`).

**Developer checklist before committing:**
- [ ] Run `git diff --staged` and visually scan for secrets
- [ ] Use `.env` (gitignored) for all real credentials
- [ ] Use `.env.example` with `__REPLACE_ME__` placeholders for documentation

---

## Commit Conventions

This repo uses **Conventional Commits**:

```
<type>(<scope>): <short description>

[optional body]

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

**Types:**

| Type | When to use |
|------|-------------|
| `feat` | New feature or slash command |
| `fix` | Bug fix |
| `chore` | Maintenance, dependency updates, config |
| `refactor` | Code restructuring without behavior change |
| `docs` | Documentation only |
| `perf` | Performance improvements |
| `style` | Formatting, no logic change |
| `test` | Adding or fixing tests |

**Scope examples:** `music`, `economy`, `agents`, `moderation`, `ci`, `docker`, `prisma`

---

## Agent Guidance

### Before Making Changes

1. Read the affected command file in `src/commands/` fully before editing.
2. Check `src/utils/` for shared helpers — avoid duplicating logic.
3. Check `prisma/schema.prisma` before adding new DB queries.
4. Run `npm run ci:syntax` locally to catch parse errors quickly.

### When Adding Features

- New slash command → file in `src/commands/`, follow the export pattern.
- New DB field → create Prisma migration, never edit schema without migration.
- New Redis key → add to the key prefix table in this doc.
- New env variable → add to `.env.example` with a `__REPLACE_ME__` placeholder.

### When Editing Agent Pool Code

- Never add `console.log` calls that could print token values.
- Maintain protocol version compatibility — check `agentProtocol.js` `SUPPORTED_VERSIONS`.
- Agent runners are stateless except for their active voice sessions — don't add in-memory state
  that doesn't survive reconnect.

### Prohibited Actions

- Do not rename existing slash command option names (breaks live guilds).
- Do not remove the `withTimeout` wrapper from interaction handlers.
- Do not bypass the `requireAuth` / permission guard patterns in commands.
- Do not add `node_modules/` or `.env` to git.
- Do not hard-code guild IDs or user IDs except in `DEV_GUILD_ID` lookups.

---

## CI Overview

GitHub Actions workflows live in `.github/workflows/`:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push/PR | Syntax gate → migration gate → security audit → unit tests → docker smoke |
| `deploy.yml` | push to main (manual) | Deploys to production |
| `codeql.yml` | push/PR/schedule | CodeQL security analysis (JS/TS) |
| `gitleaks.yml` | push/PR | Secret scanning |

---

## Makefile Targets

```bash
make help        # List all targets
make up          # docker compose up (production profile)
make down        # docker compose down
make logs        # Follow bot logs
make migrate     # Run prisma migrate deploy in container
make deploy      # Deploy slash commands (global)
make test        # Run unit tests
```

---

## Key Source Files Quick Reference

| File | Purpose |
|------|---------|
| `src/index.js` | Bot entry point, client initialization |
| `src/bootstrap.js` | Startup sequence (DB connect, Redis, Lavalink, command load) |
| `src/utils/storage.js` | DB access helpers (loadGuildData, saveGuildData, prisma) |
| `src/utils/redis.js` | Redis get/set/del helpers |
| `src/utils/logger.js` | Pino logger instance |
| `src/utils/errorHandler.js` | Centralized error handling with categories |
| `src/utils/interactionTimeout.js` | `withTimeout()` wrapper for interaction handlers |
| `src/utils/discordOutput.js` | `replyError()`, `makeEmbed()`, color constants |
| `src/utils/metrics.js` | Prometheus metrics (prom-client) |
| `src/utils/audit.js` | Audit log dispatcher |
| `src/moderation/guards.js` | `canModerateTarget()`, permission checks |
| `src/music/service.js` | Music session lifecycle |
| `src/agents/agentManager.js` | Agent Pool WebSocket control plane |
| `src/agents/agentRunner.js` | Per-agent Discord client runner |
| `src/agents/agentProtocol.js` | Agent protocol constants and helpers |

---

## Common Gotchas

1. **Interaction already replied**: If you call `interaction.reply()` twice, Discord throws. Use
   `interaction.deferred` and `interaction.replied` guards, or use the `withTimeout` wrapper
   which handles this.

2. **Guild-only commands**: If `meta.guildOnly = true`, the command is not deployed to DMs. Access
   to `interaction.guild` and `interaction.member` is safe. If `guildOnly = false`, always null-
   check `interaction.guild`.

3. **BigInt snowflakes**: Discord IDs are BigInts in Prisma. Pass them as strings when using
   Prisma: `BigInt(userId)` or use the string form depending on schema.

4. **Agent not available**: `ensureSessionAgent()` can throw if no agents are available for the
   guild. Always handle this error in music commands and surface a friendly message to the user.

5. **Lavalink reconnect**: If Lavalink disconnects, in-progress music sessions are interrupted.
   The music service handles reconnect but queued songs may be lost — this is expected behavior.

6. **Rate limiting**: Discord imposes rate limits per bot token per route. The bot uses
   `rate-limiter-flexible` + Redis to stay within limits. Don't remove rate limit checks.

7. **Node.js ES Modules**: `src/` uses ES module syntax (`import`/`export`). `package.json` has
   `"type": "module"`. Don't add `require()` calls.

---

## Links

- [CONTRIBUTING.md](CONTRIBUTING.md) — How to contribute
- [SECURITY.md](SECURITY.md) — Security policy and disclosure
- [docs/AGENT_PROTOCOL.md](docs/AGENT_PROTOCOL.md) — Full agent protocol spec
- [docs/agents/](docs/agents/) — Agent Pool architecture docs
- [docs/schema/DATABASE_SCHEMA.md](docs/schema/DATABASE_SCHEMA.md) — DB schema reference
- [docs/COMMANDS.md](docs/COMMANDS.md) — Command catalog
- [SELF_HOSTING.md](SELF_HOSTING.md) — Self-hosting guide
- [QUICKSTART.md](QUICKSTART.md) — Quick start guide
