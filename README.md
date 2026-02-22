<div align="center">

<br/>

<img src="https://raw.githubusercontent.com/wokspec/Chopsticks/main/docs/assets/banner.png" alt="Chopsticks Banner" width="600"/>

<h1>🥢 Chopsticks</h1>

<p><strong>A self-hostable, feature-rich Discord bot — music, moderation, economy, AI agents, and a flagship agent pool system for community-powered voice bots.</strong></p>

<br/>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.js.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](docker-compose.laptop.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge&logo=github)](CONTRIBUTING.md)

<br/>

[![GitHub Stars](https://img.shields.io/github/stars/wokspec/Chopsticks?style=flat-square&logo=github)](https://github.com/wokspec/Chopsticks/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/wokspec/Chopsticks?style=flat-square&logo=github)](https://github.com/wokspec/Chopsticks/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/wokspec/Chopsticks?style=flat-square&logo=github)](https://github.com/wokspec/Chopsticks/issues)
[![Last Commit](https://img.shields.io/github/last-commit/wokspec/Chopsticks?style=flat-square&logo=github)](https://github.com/wokspec/Chopsticks/commits/main)

<br/>

<a href="https://discord.gg/YOUR_INVITE">
  <img src="https://img.shields.io/badge/Join%20Support%20Server-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord Support Server"/>
</a>
&nbsp;
<a href="https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands">
  <img src="https://img.shields.io/badge/Invite%20Chopsticks-57F287?style=for-the-badge&logo=discord&logoColor=white" alt="Invite Bot"/>
</a>
&nbsp;
<a href="docs/">
  <img src="https://img.shields.io/badge/Documentation-4285F4?style=for-the-badge&logo=gitbook&logoColor=white" alt="Docs"/>
</a>
&nbsp;
<a href="https://github.com/wokspec/Chopsticks/issues/new?template=bug_report.md">
  <img src="https://img.shields.io/badge/Report%20a%20Bug-EA4335?style=for-the-badge&logo=github&logoColor=white" alt="Report Bug"/>
</a>
&nbsp;
<a href="https://github.com/wokspec/Chopsticks/issues/new?template=feature_request.md">
  <img src="https://img.shields.io/badge/Request%20a%20Feature-FBBC05?style=for-the-badge&logo=github&logoColor=white" alt="Request Feature"/>
</a>

<br/><br/>

</div>

---

## 📋 Table of Contents

- [✨ Features](#-features)
- [🤖 Agent Pool System](#-agent-pool-system)
- [🚀 Getting Started](#-getting-started)
- [🐳 Docker Deployment](#-docker-deployment)
- [🛠️ Tech Stack](#-tech-stack)
- [📁 Project Structure](#-project-structure)
- [🧪 Testing](#-testing)
- [🤝 Contributing](#-contributing)
- [🔒 Security](#-security)
- [📜 License](#-license)

---

## ✨ Features

<details open>
<summary><b>🎵 Music</b> — High-quality audio powered by Lavalink</summary>

- Play from YouTube, Spotify, SoundCloud, and direct URLs
- Full queue management — shuffle, loop, skip, seek, volume control
- Playlist support with audio file uploads (drag-and-drop into your channel)
- `/play` `/queue` `/nowplaying` `/skip` `/stop` `/loop` `/volume` `/playlist`

</details>

<details open>
<summary><b>🛡️ Moderation</b> — Professional tooling with safety guardrails</summary>

- `/ban` `/kick` `/mute` `/warn` `/timeout` `/purge`
- Preview + confirmation dialogs before all destructive actions
- Filtered purge by user, content type, links, attachments, or bots
- Hierarchy safety checks prevent bans/kicks above bot or invoker rank

</details>

<details open>
<summary><b>💰 Economy & Progression</b> — Full server economy with persistence</summary>

- Earn and spend Credits via `/daily` `/work` `/gather`
- `/shop` `/buy` `/inventory` `/vault` — items and collectibles
- `/leaderboard` `/profile` — server-wide rankings and per-user progression cards

</details>

<details>
<summary><b>🎮 Games & Fun</b></summary>

- `/trivia` — solo, PvP versus, fleet, and agent-duel modes
- `/gather` `/work` — loot missions with card-image outputs
- `/fun` — interactive catalog-driven fun commands
- `/agent chat` — chat with a deployed agent identity

</details>

<details>
<summary><b>📊 Dashboard & Monitoring</b></summary>

- Web dashboard for server config, pool management, and live stats
- Prometheus metrics + Grafana integration
- Structured JSON logging with Pino

</details>

---

## 🤖 Agent Pool System

> The flagship feature of Chopsticks. A community-powered system where multiple Discord bot tokens are pooled together to serve voice and music workloads across servers — at scale, securely.

```
Your Server ──► Guild Pool Config ──► Primary Pool + up to 2 Secondary Pools
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
               Agent Bot #1           Agent Bot #2           Agent Bot #3
               (music)                (voice_assistant)       (utility)
```

### How it works

| Concept | Description |
|---------|-------------|
| **Pool** | A named collection of up to 49 bot tokens, owned by a user |
| **Agent** | A contributed Discord bot token, encrypted at rest with AES-256-GCM |
| **Specialty** | Music, voice assistant, utility, relay, or custom — matched to guild preference |
| **Alliance** | Two pools can ally to cross-promote in discovery and share the Allied badge |
| **Leaderboard** | Public composite score from songs played, deployments, and guilds served |

### Security model

- 🔐 **Per-pool HKDF key derivation** — each pool's tokens use a unique AES-256-GCM key derived from the master key
- 🚫 **Tokens never logged** — only a masked form (`BOT_***...***_xyz`) is ever shown in any embed
- 💀 **Revocation zeroes ciphertext** — `token = NULL` in the DB when revoked, not just status-flagged
- 🛡️ **Owner-only controls** — admins of other servers cannot manage your pool
- ⏱️ **Rate limiting** — write operations throttled per-user to prevent abuse

### Quick commands

```
/pools help          — Inline guide (workflows, security, reference)
/pools list          — Browse all pools
/pools discover      — Find pools by specialty or featured status
/pools create        — Create your own pool
/pools leaderboard   — Top pools by composite score
/agents add_token    — Contribute a bot token to a pool
/agents deploy       — Deploy an agent to your voice channel
```

---

## 🚀 Getting Started

### Prerequisites

| Requirement | Version |
|-------------|---------|
| [Node.js](https://nodejs.org) | 20+ |
| [PostgreSQL](https://postgresql.org) | 14+ |
| [Redis](https://redis.io) | 7+ |
| [Lavalink](https://github.com/lavalink-devs/Lavalink) | 4+ |

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/wokspec/Chopsticks.git
cd Chopsticks

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Open .env and set: DISCORD_TOKEN, CLIENT_ID, BOT_OWNER_IDS, DATABASE_URL, REDIS_URL
```

### First run

```bash
# Run database migrations
npm run migrate

# Deploy slash commands to your Discord guild
node scripts/deployCommands.js

# Start the bot
npm run bot
```

> 📖 See [QUICKSTART.md](QUICKSTART.md) for a detailed walkthrough, or [docs/deploy/](docs/deploy/) for production deployment guides.

---

## 🐳 Docker Deployment

The recommended way to run Chopsticks in production. All services (bot, Lavalink, PostgreSQL, Redis, Grafana, Prometheus, Caddy) start with a single command.

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your tokens and credentials

# Start all services
docker compose -f docker-compose.laptop.yml up -d

# Check status
docker compose -f docker-compose.laptop.yml ps

# View bot logs
docker logs chopsticks-bot -f
```

**Services included:**

| Service | Port | Description |
|---------|------|-------------|
| `chopsticks-bot` | — | Discord bot |
| `chopsticks-agents` | — | Agent runner process |
| `chopsticks-dashboard` | 3002 | Web dashboard |
| `chopsticks-postgres` | 5432 | Database |
| `chopsticks-redis` | 6379 | Cache |
| `chopsticks-lavalink` | 2333 | Audio backend |
| `chopsticks-caddy` | 80/443 | Reverse proxy |
| `chopsticks-prometheus` | 9090 | Metrics |
| `chopsticks-grafana` | 3001 | Dashboards |

> See [docs/deploy/FREE_HOSTING.md](docs/deploy/FREE_HOSTING.md) for free self-hosted cloud options.

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Bot framework | [discord.js v14](https://discord.js.org) |
| Audio backend | [Lavalink 4](https://github.com/lavalink-devs/Lavalink) |
| Database | PostgreSQL 14 + [node-postgres](https://github.com/brianc/node-postgres) |
| Cache | Redis 7 + [ioredis](https://github.com/redis/ioredis) |
| Encryption | Node.js `crypto` — AES-256-GCM + HKDF-SHA256 |
| Dashboard | Express + Discord OAuth2 |
| Metrics | Prometheus + prom-client |
| Logging | [Pino](https://getpino.io) (structured JSON) |
| Containerization | Docker + Docker Compose |
| Reverse proxy | [Caddy](https://caddyserver.com) |

---

## 📁 Project Structure

```
Chopsticks/
├── src/
│   ├── commands/          # Slash command handlers
│   │   ├── music.js       # /play, /queue, /skip, /volume …
│   │   ├── pools.js       # /pools — agent pool system
│   │   ├── agents.js      # /agents — deploy, token management
│   │   ├── moderation.js  # /ban, /kick, /warn …
│   │   └── economy.js     # /balance, /shop, /work …
│   ├── agents/            # Agent manager & runner
│   ├── utils/             # Storage, encryption, helpers
│   │   ├── storage_pg.js  # PostgreSQL data layer
│   │   └── storage.js     # Re-export facade
│   └── index.js           # Bot entrypoint
├── migrations/            # PostgreSQL schema migrations
├── scripts/               # Deployment & ops scripts
├── docs/                  # Architecture & protocol docs
│   └── deploy/            # Deployment guides
├── test/                  # Unit & contract tests
├── docker-compose.laptop.yml  # Single-node Docker stack
├── Dockerfile.bot         # Bot image
└── .env.example           # Environment template
```

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Protocol-level contract tests
make test-protocol

# Agent lifecycle tests
make test-level-1
```

Tests cover agent protocol contracts, session lifecycle, deployment flow, and pool permission models.

---

## 🤝 Contributing

Contributions are what make open source great. Any contribution you make is **greatly appreciated**.

1. **Fork** the project
2. **Create** your feature branch: `git checkout -b feat/amazing-feature`
3. **Commit** your changes: `git commit -m 'feat: add amazing feature'`
4. **Push** to the branch: `git push origin feat/amazing-feature`
5. **Open** a Pull Request

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code standards, commit conventions, and development workflow.

[![Open Issues](https://img.shields.io/github/issues/wokspec/Chopsticks?style=flat-square)](https://github.com/wokspec/Chopsticks/issues)
[![Open PRs](https://img.shields.io/github/issues-pr/wokspec/Chopsticks?style=flat-square)](https://github.com/wokspec/Chopsticks/pulls)

---

## 🔒 Security

Security vulnerabilities should **not** be reported via public issues.

Please review [SECURITY.md](SECURITY.md) for the responsible disclosure process.

---

## 📜 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for full terms.

This means you are free to use, modify, distribute, and build commercial products with Chopsticks — with no restrictions beyond preserving the copyright notice.

---

<div align="center">

Built with ❤️ by **[goot27](https://github.com/goot27)** and the **[Wok Specialists](https://github.com/wokspec)** community

<br/>

<a href="#-chopsticks">⬆ Back to top</a>

</div>

