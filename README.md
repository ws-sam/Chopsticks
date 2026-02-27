<div align="center">

<h1>Chopsticks</h1>

<p><strong>A production-grade, open source Discord bot — music, moderation, economy, AI, and a community-powered agent pool system for voice and assistant workloads at scale.</strong></p>

[![License: MIT + Commercial Attribution](https://img.shields.io/badge/License-MIT%20%2B%20Commercial%20Attribution-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](docker-compose.laptop.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)
[![GitHub Stars](https://img.shields.io/github/stars/wokspec/Chopsticks?style=social)](https://github.com/wokspec/Chopsticks/stargazers)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Command Reference](#command-reference)
- [Agent Pool System](#agent-pool-system)
- [Self-hosting](#self-hosting)
- [Docker](#docker)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Website](#website)
- [Testing](#testing)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

---

## Overview

Chopsticks is a full-featured Discord bot built on [discord.js v14](https://discord.js.org) with PostgreSQL persistence, Redis caching, and a Lavalink audio backend. It ships 70 slash commands across music, moderation, economy, games, AI, and social features — all configurable per-server via `/setup`.

The flagship feature is the **Agent Pool System**: a community model where multiple Discord bot tokens are pooled, encrypted, and dispatched to voice channels on demand. Servers never manage tokens directly; they consume from shared pools maintained by the community.

**Hosted instance:** Invite Chopsticks to your server — no self-hosting required.
> Replace `YOUR_CLIENT_ID` with the bot's application ID: `https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands`

---

## Features

**Music** — Lavalink-backed audio with full queue management. Play from YouTube, Spotify, SoundCloud, or direct URLs. Supports drag-and-drop audio file playlists via the playlist drop channel.

**Moderation** — Ban, kick, mute, warn, timeout, and purge with preview + confirmation dialogs. Filtered purge by user, content type, links, or attachments. Hierarchy safety prevents actions above the invoker's rank. Full mod log integration.

**Economy** — Server credits earned through daily claims, work, gathering, and quests. Shop, inventory, vault, crafting, auctions, heist, and trading. Per-guild XP and leveling system with configurable multipliers, cooldowns, and level-up announcements.

**Stats & Achievements** — Per-user activity tracking across VC time, messages, commands, casino wins, trades, and streaks. Leaderboards, profile cards (canvas-rendered), and an achievement system with unlock tracking.

**AI & Image Generation** — Chat with AI models via `/ai chat`. Generate images with HuggingFace FLUX.1-schnell (free tier) via `/ai image`. Bring AI assistants into voice channels through the agent pool.

**Agent Economy** — Spend server credits to deploy agents: have a bot join a voice channel, play a sound, send a message, run trivia, or greet users. Server admins configure available actions and costs via `/setup`.

**Games & Social** — Trivia (PvP, fleet, agent-duel modes), truth or dare, would you rather, battles, riddles, reputation, ship, dad jokes, urban dictionary lookup, and more.

**Server Management** — Reaction roles, auto-role, welcome messages, starboard, polls, giveaways, ticket system, scheduled messages, automation scripts, birthday tracking, suggestion channel, slow mode, lockdown, and embed builder.

**Dashboard** — Web-based guild configuration panel (OAuth2), real-time dev dashboard with Socket.io push, Prometheus metrics, and Grafana integration.

---

## Command Reference

Commands marked _(admin)_ require `Manage Server` or `Administrator`. Commands marked _(mod)_ require a moderator role or `Manage Messages`.

### Music

| Command | Description |
|---------|-------------|
| `/music play <query>` | Play a track or playlist from YouTube, Spotify, SoundCloud, or URL |
| `/music queue` | View the current queue |
| `/music nowplaying` | Show the currently playing track |
| `/music skip` | Skip the current track |
| `/music stop` | Stop playback and clear the queue |
| `/music loop` | Toggle loop mode (off / track / queue) |
| `/music shuffle` | Shuffle the queue |
| `/music volume <level>` | Set playback volume (0–200) |
| `/music seek <time>` | Seek to a position in the current track |
| `/music remove <index>` | Remove a track from the queue |
| `/music move <from> <to>` | Reorder a track in the queue |
| `/playlist` | Manage personal playlists with drag-and-drop audio file uploads |

### Moderation

| Command | Description |
|---------|-------------|
| `/mod ban <user>` | Ban a user with optional reason and duration _(mod)_ |
| `/mod kick <user>` | Kick a user from the server _(mod)_ |
| `/mod mute <user>` | Mute a user in voice channels _(mod)_ |
| `/mod warn <user>` | Issue a warning to a user _(mod)_ |
| `/mod timeout <user>` | Timeout a user for a specified duration _(mod)_ |
| `/mod unban <user>` | Remove a ban _(mod)_ |
| `/purge <amount>` | Delete messages with filters (user, bots, links, attachments) _(mod)_ |
| `/lockdown` | Lock or unlock a channel or the entire server _(mod)_ |
| `/slowmode <seconds>` | Set channel slowmode _(mod)_ |
| `/modlogs` | Configure where moderation actions are logged _(admin)_ |
| `/role` | Manage roles — create, assign, remove, list _(mod)_ |

### Economy & Progression

| Command | Description |
|---------|-------------|
| `/daily` | Claim your daily credits |
| `/work` | Work for credits (cooldown-based) |
| `/gather` | Run a gather mission for collectible loot |
| `/shop` | Browse and buy items |
| `/inventory` | View your inventory |
| `/vault` | Showcase your rarest caught items |
| `/use <item>` | Use or consume an item |
| `/craft` | Craft items from a recipe catalog |
| `/trade` | Trade credits and items with another user |
| `/pay <user> <amount>` | Transfer credits to another user |
| `/bank` | Deposit, withdraw, or check your bank balance |
| `/auction` | Create and bid on auctions |
| `/heist` | Organize a group heist |
| `/casino` | Slots, coinflip, and other gambling games |
| `/streak` | Track and claim daily activity streak rewards |
| `/quests` | View and claim daily quests |
| `/collection` | View your collection of gathered items |
| `/balance` | Check your current credit balance |
| `/leaderboard` | Server-wide credit and economy leaderboards |

### Stats & Leveling

| Command | Description |
|---------|-------------|
| `/stats leaderboard` | Server activity leaderboard (messages, VC time, commands) |
| `/stats card <user>` | View a user's activity stats card |
| `/stats achievements <user>` | View unlocked achievements |
| `/xp config` | Configure per-guild XP — rates, multipliers, cooldowns, presets _(admin)_ |
| `/levels` | View the server's level roles and XP thresholds |
| `/profile` | View your profile and manage privacy settings |

### AI & Agents

| Command | Description |
|---------|-------------|
| `/ai chat <prompt>` | Chat with an AI model |
| `/ai image <prompt>` | Generate an image with FLUX.1-schnell (free tier) |
| `/ai link` | Link your own AI API key |
| `/actions` | Browse and trigger agent economy actions |
| `/agents add_token` | Contribute a bot token to a pool _(pool owner)_ |
| `/agents deploy` | Deploy an agent to your current voice channel |
| `/agents status` | View status of agents in the current pool |
| `/agents diagnose` | Diagnose agent connectivity and configuration _(admin)_ |
| `/agents get_profile` | View an agent's public profile |
| `/pools list` | Browse all agent pools |
| `/pools discover` | Find pools by specialty |
| `/pools create` | Create a new agent pool _(admin)_ |
| `/pools leaderboard` | Top pools by composite score |
| `/pools help` | Full agent pool workflow guide |

### Games & Fun

| Command | Description |
|---------|-------------|
| `/trivia` | Trivia — solo, PvP versus, fleet, and agent-duel modes |
| `/battle` | PvP battle for XP, credits, and drops |
| `/fight` | Fight an encounter (10-minute cooldown) |
| `/game` | Miscellaneous mini-games |
| `/casino` | Casino games — slots, blackjack, coinflip |
| `/truthordare` | Truth or dare prompt |
| `/wouldyourather` | Would you rather question |
| `/riddle` | Random riddle |
| `/ship <user1> <user2>` | Compatibility score between two users |
| `/social roast <user>` | AI-generated roast |
| `/social compliment <user>` | AI-generated compliment |
| `/fun` | Catalog-driven interactive fun commands |
| `/8ball <question>` | Magic 8-ball answer |
| `/coinflip` | Flip a coin |
| `/roll [sides]` | Roll a die |
| `/choose <options>` | Pick randomly from a list of options |
| `/quote` | Random quote |
| `/meme` | Random meme from Reddit |
| `/dadjoke` | Random dad joke |
| `/joke [category]` | Programming, pun, dark, misc jokes |

### Info & Lookup

| Command | Description |
|---------|-------------|
| `/wiki <query>` | Wikipedia article summary and thumbnail |
| `/github <user or user/repo>` | GitHub user profile or repository stats |
| `/anime <title>` | AniList anime info (score, episodes, genres, studio) |
| `/weather <location>` | Current weather via Open-Meteo (no API key required) |
| `/apod [date]` | NASA Astronomy Picture of the Day |
| `/book <query>` | Open Library book search |
| `/convert <amount> <from> <to>` | Currency conversion via Frankfurter (ECB data) |
| `/color <hex>` | Preview a hex color with RGB/HSL breakdown |
| `/urban <term>` | Urban Dictionary lookup |
| `/steam <profile>` | Steam community profile lookup |
| `/botinfo` | Bot statistics and uptime |
| `/ping` | Latency and API response times |
| `/serverinfo` | Server statistics |
| `/userinfo <user>` | User account information |

### Server Configuration

| Command | Description |
|---------|-------------|
| `/setup` | Interactive setup wizard for all bot features _(admin)_ |
| `/welcome` | Configure welcome messages and channels _(admin)_ |
| `/autorole` | Set roles assigned automatically on join _(admin)_ |
| `/reactionroles` | Create reaction role panels _(admin)_ |
| `/starboard` | Configure the starboard channel and threshold _(admin)_ |
| `/suggest` | Submit a suggestion to the server's suggestion channel |
| `/poll <question>` | Create a timed poll with automatic result reveal |
| `/giveaway` | Create and manage giveaways _(admin)_ |
| `/tickets` | Configure and manage the support ticket system _(admin)_ |
| `/events` | Schedule and manage Discord events _(admin)_ |
| `/birthday` | Set your birthday for server birthday announcements |
| `/reputation` | Give or view reputation points |
| `/afk [reason]` | Set AFK status — bot notifies others who mention you |
| `/remind <time> <message>` | Set a personal reminder |
| `/schedule` | Schedule a message to be sent in a channel _(admin)_ |
| `/embed` | Create and send a custom embed _(admin)_ |
| `/tag` | Create and retrieve server tags |
| `/antispam` | Configure automatic spam detection and action _(admin)_ |
| `/automations` | Configure server automation rules _(admin)_ |
| `/custom` | Manage custom commands for this server _(admin)_ |
| `/colorrole set <hex>` | Set your personal color role |
| `/config` | View or edit per-server bot configuration _(admin)_ |
| `/help` | Browse all commands and bot status |
| `/tutorials` | Onboarding guide for new servers |

---

## Agent Pool System

The Agent Pool System is Chopsticks' flagship feature. Multiple Discord bot tokens are pooled by community contributors, encrypted at rest, and dispatched on demand to serve voice and assistant workloads.

### Architecture

```
Your Server ──► Guild Pool Config ──► Primary Pool (+ up to 2 Secondary Pools)
                                              │
                    ┌─────────────────────────┼──────────────────────────┐
                    ▼                         ▼                          ▼
               Agent Bot #1             Agent Bot #2              Agent Bot #3
               (music)                  (voice_assistant)          (utility)
```

Agents are connected Discord bot clients, each authenticated with a token contributed by a pool member. The runner process polls the database every 10 seconds, starts agents for active tokens, and establishes a WebSocket connection to the AgentManager control plane. Guilds dispatch work through the manager via session routing.

### Security Model

| Mechanism | Detail |
|-----------|--------|
| Token encryption | AES-256-GCM with per-pool HKDF-SHA256 derived keys |
| Token exposure | Only masked form (`BOT_***...***_xyz`) ever appears in logs or embeds |
| Revocation | `token = NULL` in the database; status flags alone are not trusted |
| Access control | Pool management operations are owner-only, gated in all command paths |
| Rate limiting | Write operations throttled per-user to prevent enumeration and abuse |
| Runner authentication | Optional `AGENT_RUNNER_SECRET` validates runner identity on hello handshake |

### Pool Concepts

| Term | Description |
|------|-------------|
| Pool | A named collection of up to 49 bot tokens, owned by one user |
| Agent | A contributed bot token, active after pool-owner approval |
| Specialty | Music, voice assistant, utility, relay, or custom — matched to guild preference |
| Tier | Free / Pro / Enterprise — controls per-pool capacity and priority |
| Alliance | Two pools linked for cross-discovery and the Allied badge |
| Contribution | A token submitted by a non-owner; requires explicit pool-owner approval |

---

## Self-hosting

### Prerequisites

| Requirement | Minimum Version |
|-------------|----------------|
| [Node.js](https://nodejs.org) | 22 |
| [PostgreSQL](https://postgresql.org) | 14 |
| [Redis](https://redis.io) | 7 |
| [Lavalink](https://github.com/lavalink-devs/Lavalink) | 4 |

### Setup

```bash
git clone https://github.com/wokspec/Chopsticks.git
cd Chopsticks
npm install
cp .env.example .env
# Edit .env — minimum required: DISCORD_TOKEN, CLIENT_ID, DATABASE_URL, REDIS_URL
npm run migrate
node scripts/deployCommands.js   # deploy slash commands to your test guild
npm run bot
```

See [QUICKSTART.md](QUICKSTART.md) for a step-by-step walkthrough including Lavalink configuration.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Your bot token |
| `CLIENT_ID` | Yes | Your bot's application ID |
| `BOT_OWNER_IDS` | Yes | Comma-separated Discord user IDs of bot owners |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `AGENT_TOKEN_KEY` | Yes (agents) | 32-byte hex master key for agent token encryption |
| `AGENT_RUNNER_SECRET` | No | Shared secret authenticating the runner to the AgentManager |
| `AGENT_CONTROL_URL` | No | WebSocket URL of the AgentManager (default: `ws://127.0.0.1:8787`) |
| `HUGGINGFACE_API_KEY` | No | Enables `/ai image` generation via HuggingFace |
| `DISABLE_AGENT_RUNNER` | No | Set `true` to manage the agent runner externally (e.g. via PM2) |
| `DEPLOY_MODE` | No | Set `global` to deploy slash commands globally |

Full reference: [`.env.example`](.env.example)

---

## Docker

The Docker Compose stack starts all services for a complete local development environment.

```bash
cp .env.example .env
# Edit .env with your dev credentials

docker compose -f docker-compose.laptop.yml up -d
docker compose -f docker-compose.laptop.yml ps
docker logs chopsticks-bot -f
```

| Service | Port | Purpose |
|---------|------|---------|
| `chopsticks-bot` | — | Discord bot process |
| `chopsticks-agents` | — | Agent runner |
| `chopsticks-dashboard` | 3002 | Web configuration dashboard |
| `chopsticks-postgres` | 5432 | PostgreSQL database |
| `chopsticks-redis` | 6379 | Redis cache |
| `chopsticks-lavalink` | 2333 | Lavalink audio backend |
| `chopsticks-caddy` | 80/443 | Reverse proxy with TLS |
| `chopsticks-prometheus` | 9090 | Metrics collection |
| `chopsticks-grafana` | 3001 | Metrics visualization |

Production compose files are available for single-node, stack, and hardened deployments. See [`docs/deploy/`](docs/deploy/).

---

## Project Structure

```
Chopsticks/
├── src/
│   ├── commands/           Slash command handlers (one file per command group)
│   ├── agents/
│   │   ├── agentManager.js WebSocket control plane — routes work to live agents
│   │   └── agentRunner.js  Spawns Discord.js clients for each active agent token
│   ├── dashboard/
│   │   ├── server.js       Express API + OAuth2 dashboard backend
│   │   └── public/         Frontend JS/HTML for the web dashboard
│   ├── utils/
│   │   ├── storage_pg.js   PostgreSQL data layer — all DB operations
│   │   ├── storage.js      Re-export facade over storage_pg.js
│   │   ├── imageGen.js     HuggingFace image generation (FLUX.1 → SDXL fallback)
│   │   └── logger.js       Structured Pino logger
│   └── index.js            Bot entrypoint
├── migrations/             PostgreSQL schema migrations
├── scripts/
│   └── deployCommands.js   Slash command deploy (guild or global)
├── docs/                   Architecture and deployment guides
├── test/                   Unit and contract tests (872 tests)
├── web/                    Public website (Next.js → chopsticks.wokspec.org)
├── docker-compose.*.yml    Compose files for different environments
├── Dockerfile.bot          Bot container image
├── Dockerfile.agentrunner  Agent runner container image
└── .env.example            Environment variable reference
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Bot framework | discord.js v14 |
| Audio backend | Lavalink 4 + @discordjs/voice |
| Database | PostgreSQL 14 via node-postgres (pg) |
| Cache | Redis 7 via ioredis |
| Encryption | Node.js `crypto` — AES-256-GCM + HKDF-SHA256 |
| Agent control plane | WebSocket (ws) |
| Dashboard | Express + Discord OAuth2 |
| Metrics | Prometheus + prom-client |
| Logging | Pino (structured JSON, no `console.*` in production) |
| Image generation | HuggingFace Inference API (FLUX.1-schnell, free tier) |
| Containerization | Docker + Docker Compose |
| Reverse proxy | Caddy |

---

## Website

The [`web/`](web/) directory contains the [Next.js](https://nextjs.org) site deployed at **[chopsticks.wokspec.org](https://chopsticks.wokspec.org)** via Cloudflare Pages — developed by [WokSpec](https://wokspec.org).

### Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page — features overview, live stats, interactive cursor |
| `/features` | Full feature breakdown with interactive panels |
| `/tutorials` | Step-by-step guides with Discord UI previews |
| `/commands` | Searchable, filterable command reference |
| `/self-host` | Complete self-hosting walkthrough |
| `/changelog` | Release history |
| `/terms` | Terms of service |
| `/privacy` | Privacy policy |

### Local development

```bash
cd web
npm install
npm run dev       # local dev server at http://localhost:3000
npm run build     # static export to web/out/
```

Deploy to Cloudflare Pages via the `wrangler` CLI — see [`SELF_HOSTING.md`](SELF_HOSTING.md) for full deploy instructions.

---

## Testing

```bash
npm test
```

The test suite covers agent protocol contracts, session lifecycle, pool permission models, deployment flow, and unit tests for storage, economy, and utility modules.

```bash
make test-protocol     # Protocol-level contract tests
make test-level-1      # Agent lifecycle invariant tests
```

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request — it covers the development workflow, commit conventions, and how to run the stack locally.

1. Fork the repository
2. Create a branch: `git checkout -b feat/your-feature`
3. Commit using [Conventional Commits](https://www.conventionalcommits.org): `git commit -m 'feat: add your feature'`
4. Push and open a pull request against `main`

Issues labeled [`good first issue`](https://github.com/wokspec/Chopsticks/labels/good%20first%20issue) are a good starting point.

---

## Security

Do not report security vulnerabilities through public GitHub issues.

See [SECURITY.md](SECURITY.md) for the responsible disclosure process and the security model for the agent token system.

---

## License

MIT License with Commercial Attribution Clause — Copyright (c) 2026 goot27 and Wok Specialists

Free to self-host, fork, and white-label. **Commercial use** (paid bots, white-labeled instances, SaaS offerings) requires a visible attribution to "Powered by Chopsticks (WokSpec)" in your product's documentation, bot description, or about section.

See [LICENSE](LICENSE) for the full text.

---

<div align="center">

Built by **[goot27](https://github.com/goot27)** and the **[Wok Specialists](https://github.com/wokspec)** community.

</div>
