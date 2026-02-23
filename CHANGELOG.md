# Changelog

All notable changes to Chopsticks will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [1.5.1] — feat/harden-and-polish (Cycles 16–18)

### Added
- **Cycle 16 — 50 unit tests** for fun commands (`test/unit/fun-commands-cycle1012.test.js`): roasts.json (50+ entries, no dups), /roast (options, vibes), wyr.json (50+ pairs), /wouldyourather, /compliment (options, styles), /ship deterministic score (4 sub-tests: same=same, commutative, 0–100 range, low collision), /battle (guildOnly, wager min/max), riddles.json (75+ entries, q/a fields), /riddle (reveal boolean), /imagine (prompt maxLength, 6 styles). Total: 935 passing.
- **`/8ball` upgrade (Cycle 17):** Expanded from 10 to 20 canonical answers (10 positive/5 neutral/5 negative), colour-coded embeds (green/yellow/red), proper `sanitizeString`, no longer guild-only.
- **`/truthordare` (Cycle 17):** 50 prompts (15 mild truths, 10 spicy truths, 15 mild dares, 10 spicy dares). Type choice (truth/dare/random) + intensity choice (mild/spicy).
- **`/quote` (Cycle 17):** 4 categories (inspirational/funny/programming/random). Live ZenQuotes API for inspirational with 10-entry local fallback per category.
- **`/meme` (Cycle 17):** Live meme-api.com fetch with NSFW filter, 5 subreddit choices + random, per-channel 30s rate limit, 5-entry fallback bank.
- **`docs/COMMANDS.md` (Cycle 18):** Complete command reference — all slash commands (grouped by category), all 64 prefix commands (grouped by category), rate limit table, operator-only command list.

### Changed
- Global slash commands: ~104 → ~107 (3 below Discord's 110 hard limit)

---

## [1.5.0] — feat/harden-and-polish

### Added — Phase 1: Hardening (Cycles 1–4)
- **`withTimeout` sweep (Cycle 1):** Wrapped all 43 deferred slash commands in `withTimeout()` — prevents "Unknown Interaction" zombie hangs under load. Only music.js, agents.js, pools.js, tickets.js skipped (complex conditional defer flow).
- **Input validation sweep (Cycle 2):** `sanitizeString()` applied to all 18 slash command files taking free-text string options (mod reasons, AI prompts, search queries, poll questions, tag content, reminders). Prefix dispatch sanitizes all args before execute().
- **Prefix registry refactor (Cycle 3):** Broke monolithic 771-line `registry.js` into 6 category modules: `fun.js`, `info.js`, `meta.js`, `mod.js`, `server.js`, `utility.js`. Registry is now a 29-line thin loader. Added `src/prefix/helpers.js` (shared `reply`, `dm`, `parseIntSafe`).
- **Prefix rate limits + error hardening (Cycle 4):** `rateLimit` metadata on all 37 prefix commands. Per-command Redis cooldown check (`pfx:cd:userId:command`) in dispatch loop.

### Added — Phase 2: Testing (Cycles 5–7)
- **49 unit tests** for new/modified slash commands (`test/unit/new-commands-phase2.test.js`): `/mod` subcommands, `/lockdown`, `/roast`, `/imagine`, `/fact`, `/wiki`, `/dadjoke`, `/joke`, `/book`, `/urban`, `/apod`, `/github`, `/color`, `/anime`, `/steam`.
- **38 unit tests** for economy transactions (`test/unit/economy-transactions.test.js`): `formatCooldown`, casino (validateBet, isValidCoinSide, calcSlotsPayout), trade, heist, auction, credit floor guard.
- **47 unit tests** for prefix command system (`test/unit/prefix-commands-phase2.test.js`): module structure, rateLimit presence, mod permissions, parseIntSafe edge cases.

### Added — Phase 3: Prefix Library Expansion (Cycles 8–9)
- **14 new prefix commands** in `src/prefix/commands/media.js`: `!fact`, `!dadjoke`, `!joke`, `!wiki`, `!github`, `!anime`, `!book`, `!urban`, `!apod`, `!steam`, `!color`, `!roast`, `!imagine`, `!weather`.
- **13 new prefix commands** in `src/prefix/commands/economy.js` with aliases: `!balance` (bal, credits), `!daily`, `!work`, `!shop`, `!inventory` (inv), `!leaderboard` (lb, top), `!profile` (p), `!xp`, `!quests`, `!compliment`, `!trivia`, `!riddle`, `!craft`. Total prefix commands: 64.

### Added — Phase 4: Fun Expansion (Cycles 10–12)
- **Roast hardening (Cycle 10):** `src/fun/roasts.json` — 50-entry fallback roast bank. No-repeat window (last 20 picks per user). Same-target anti-spam guard (3 hits on same target in 5 min → suggest different target).
- **Imagine hardening (Cycle 10):** Guild opt-in check (`guildData.imagegen`, default enabled). 5/hr per-guild rate limit via `checkRateLimit`. Progress message shown immediately after defer. Improved error messages: `model_loading`, `api_key_invalid`, `safety_filter`, `http_N`.
- **`/compliment @user` (Cycle 11):** AI-powered compliment (genuine/dramatic/nerdy/rap styles) with 10-entry fallback array and 30s rate limit.
- **`/wouldyourather` (Cycle 11):** Random question from `src/fun/wyr.json` (50 questions). Bot auto-reacts with 🅰️/🅱️ for voting.
- **`/ship @user1 @user2` (Cycle 11):** Deterministic hash-based compatibility score (0–100), 7-tier flavor text, heart bar visualization. Same pair always gets same score.
- **`/battle @user` (Cycle 11):** PvP combat with optional credit wager, XP rewards for both sides, level-based win probability (±30% max), quest event recording, 5min cooldown.
- **OTDB trivia confirmed integrated (Cycle 12):** `src/game/trivia/opentdb.js` — 14 categories (History, Geography, Sports, Mythology, etc.), automatic local-bank fallback.
- **`/riddle` (Cycle 12):** 80-riddle local bank in `src/fun/riddles.json`. Spoiler-text answer reveal. `reveal:true` option to show immediately. Zero API calls.

### Added — Phase 5: Production (Cycles 13–15)
- **`.env.example`:** Added `HUGGINGFACE_API_KEY`, `GITHUB_TOKEN`, `STEAM_API_KEY` with descriptions and setup links.
- **Session cookie maxAge:** 24-hour explicit session lifetime on dashboard cookie (was unbounded browser-session).
- **`closeRedis()` export:** `src/utils/redis.js` now exports `closeRedis()` for clean shutdown.
- **Graceful shutdown (Cycle 14):** Shutdown handler now closes Redis (`closeRedis`) and PostgreSQL pool (`closeStoragePg`) after Discord client.destroy() — steps 6 & 7.

### Changed
- Global slash command count: ~98 → ~104 (well within Discord's 110-command limit)
- Total prefix commands: 37 → 64


- `/pools help` — 3-page inline guide covering workflows, security promises, and full command reference
- `/statschannel set/clear/list` — auto-updating voice channel stats (members, online, bots, channels, roles, boosts); refreshes every 10 min
- `/profilecard` — canvas-rendered profile image card (avatar ring, level bar, XP, economy, rarity breakdown, achievement emoji badges)
- `/profile` achievements section — up to 8 most-recent guild achievements surfaced directly in the text embed
- OpenTelemetry auto-instrumentation — every `pool.query` call now wrapped in an OTel span (`db.SELECT`, `db.INSERT`, etc.) with `db.statement` attribute; zero per-callsite changes required
- Smart-queue music autoplay wired — `queueEnd` event in `agentLavalink.js` calls `buildAutoNextSuggestion` via Last.fm when autoplay is enabled; graceful no-op when key absent
- `npm run loadtest` — autocannon load test script targeting `/health` and `/api/internal/status`; exits non-zero if p99 > 500ms

### Fixed
- Complete `console.*` → `logger.*` sweep: `lavalink/client.js`, `audiobook/player.js`, `events/messageReactionAdd.js`, `events/messageReactionRemove.js`, `events/voiceStateUpdate.js`, `dev-dashboard/server.js` — zero `console.*` calls remain in application code
- `agentLavalink.js` had undefined `logger` reference — added import

### Changed
- License changed from modified MIT to standard MIT (OSI-compliant)

---

## [1.4.0] — 2026-02-23 (feat/harden-and-polish)

### Added — Backend Hardening
- Replaced all `console.*` calls with structured `botLogger`/`logger.*` across 20+ files (errorHandler, healthServer, agentManager, agentRunner, storage_pg, dashboard, redis, loadCommands, discordOutput, moderation, voice, all economy commands)
- Graceful shutdown: ordered 5-step teardown with 5 s force-exit safety timeout; `presenceTimer`, `flushTimer` properly cleared on SIGINT/SIGTERM
- Module-level `setInterval` handles (Redis health check, birthday scheduler) now call `.unref()` — no longer block clean process exit
- Redis consolidated to single `getRedis()` singleton from `cache.js` in `storage_pg.js`; eliminates duplicate connections
- PostgreSQL pool tuning via env vars: `PG_POOL_MAX`, `PG_POOL_MIN`, `PG_IDLE_TIMEOUT`, `PG_CONNECT_TIMEOUT`, `PG_STATEMENT_TIMEOUT`
- New composite DB indexes: `user_guild_stats(user_id, guild_id)`, `transaction_log(from_user, to_user)` — hot-path query speedup
- `sensitiveActionLimiter` promoted to module-level singleton in `modernRateLimiter.js`
- `healthServer.js`: removed duplicate `collectDefaultMetrics`, unified metrics into `appMetricsRegister`, renamed counter to avoid Prometheus label conflict, added `/debug/stats` Socket.io endpoint
- Prefix DoS guard: raw message content > 2000 chars rejected before `parsePrefixArgs`
- npm overrides for `form-data ≥4.0.0` + `tough-cookie ≥4.1.3` — 2 critical vulnerabilities eliminated

### Added — New Commands (all free, no API key required unless noted)
- `/weather <location>` — Real-time weather via Open-Meteo + Nominatim geocoding; Redis 15-min cache; WMO condition codes
- `/fact` — Random interesting fact via uselessfacts.jsph.pl
- `/dadjoke` — Random dad joke via icanhazdadjoke.com
- `/afk [reason]` — AFK status system; bot notifies mentioned-of-AFK users; auto-clears on next message
- `/anime <title>` — AniList GraphQL anime details (score, studio, episodes, genres, synopsis)
- `/apod [date]` — NASA Astronomy Picture of the Day (optional `NASA_API_KEY`)
- `/book <query>` — Open Library book search with cover art
- `/github <user|user/repo>` — GitHub user profile or repository stats
- `/joke [category]` — JokeAPI v2 jokes (programming, pun, misc, dark, etc.)
- `/urban <term>` — Urban Dictionary lookup with vote counts
- `/wiki <query>` — Wikipedia REST API article summary + thumbnail

### Added — UX Polish
- `/ping` — Rich color-coded embed with green/yellow/red latency tiers
- `/botinfo` — Expanded stats: agent count, pool count, memory, discord.js version
- Rotating bot presence (30 s cycle): guilds → agents online → music → /help
- `/music now` — Last.fm artist/album enrichment (optional `LASTFM_API_KEY`)

### Added — Dev Dashboard
- Socket.io real-time live-stats panel in dev dashboard (`dev-dashboard/`)
- `/debug/stats` endpoint on health server for live command delta polling
- `.env.example` updated with all new optional variables

### Added — Tests
- 34 new unit tests in `test/unit/new-commands-cycle1-3.test.js`
- Total: **746 passing** (was 703)

---

## [1.3.0] — 2026-02-22

### Added — Agent Pool System: Phase 6–7 + Hardening
- **Specializations**: `agent_bots.specialty`, `agent_pools.specialty` columns; `/pools specialty` command; `rankPoolsBySpecialty` for specialty-aware deploy planner
- **Alliances**: Formal pool alliance system — propose, accept, dissolve; `/pools ally` with autocomplete for both `pool` and `target`; allied pools cross-promote in discovery and earn the Allied badge
- **Multi-pool guild config**: `guild_pool_config` table; `/pools secondary` to add up to 2 secondary pools per guild; `getGuildAllPoolIds` merges primary + secondaries for deploy planner
- **Badge display**: Pool card (`buildPoolCard`) now renders earned badges from `pool_stats.badges_json` via `BADGE_DEFS`
- **Onboarding wizard**: Shows top-3 recommended pools by `composite_score` when a guild has no pool configured
- **`evaluatePoolBadges`**: Called fire-and-forget after `songs_played` and `total_deployments` increments
- **Rate limiting**: 5-second write cooldown on `create`, `profile`, `specialty`, `ally` per user
- **Input validation**: `validatePoolMeta()` validates hex color, HTTPS URL, emoji, description length
- **`.dockerignore`**: Excludes `node_modules/docs/test` from build context — cuts build context from ~300MB to ~5MB
- **Specialty-aware deploy planner**: `listAccessiblePoolsForUser` sorts pools by guild's `preferred_specialty` from `guild_pool_config`

### Fixed
- `revokeAgentToken`: Token ciphertext now nulled in DB (`token = NULL`) on revocation — not just status-flagged
- `updateAgentBotStatus`: Capacity check against `countAgentsByPool` before activating/approving agents
- Alliance dissolve: Bilateral permission check — either party can dissolve (not both must manage the same pool)
- 14 DB call sites wrapped in try/catch across handlers
- Null-safe fallback in `handleProfile` when `fetchPool` returns null after update
- `addGuildSecondaryPool`: Auto-seeds `primary_pool_id` from legacy `getGuildSelectedPool` on first use
- Docker contexts: Replaced broken Windows symlink with local directory — fixed silent build hang

---

## [1.2.0] — 2026-02-21

### Added — Agent Pool System: Phase 3–5
- **Pool card** (`buildPoolCard`): Rich embed with emoji, custom color, capacity bar, specialty, stats, banner
- **`/pools profile`**: Edit pool aesthetics — name, description, color, emoji, banner URL
- **`/pools leaderboard`**: Top pools by composite score with in-place sort buttons
- **`/pools stats`**: Per-pool stat card with songs played, deployments, composite score
- **`/pools discover`**: Find pools by specialty or featured flag; ranked by composite score
- **`/pools specialty`**: Set pool or agent specialization
- **`/pools ally`**: Propose, accept, and dissolve pool alliances
- **`/pools secondary`**: Configure up to 2 secondary pools per guild
- **`/pools members`**: Manage pool managers and view roster
- **Onboarding wizard**: Shown on `/pools list` when guild has no pool — Browse / Create / Help buttons
- **`pool_stats` table**: `songs_played`, `total_deployments`, `guilds_served`, `composite_score`, `badges_json`
- **Badge system**: `BADGE_DEFS`, `evaluatePoolBadges` — non-throwing, recalculates composite score
- **`incrementPoolStat`**: Hooked into music playback (songs_played) and agent deploy (total_deployments)

---

## [1.1.0] — 2026-02-20

### Added — Agent Pool System: Phase 1–2 (Security)
- **HKDF per-pool encryption**: AES-256-GCM token encryption with `crypto.hkdfSync` — per-pool derived key, `enc_version` column
- **`maskToken()`**: Tokens displayed only in masked form (`BOT_***...***_xyz`)
- **`revokeAgentToken`**: Hard token revocation with audit log
- **`canManagePool`**: Replaces all `isMaster || owner_user_id` checks — proper RBAC
- **`pool_members` table**: Roles (owner/manager/contributor), `setPoolMemberRole`, `removePoolMember`
- **`agent_pool_events` table**: Audit log for all pool mutations
- **Status flow**: `pending` → `approved` → `active` → `suspended` → `revoked`
- **Capacity model**: `max_agents` (49), `recommended_deploy` (10), enforced at insert time
- **`/agents my_agents`**: List all tokens you've contributed with status
- **`/agents revoke`**: Revoke your contributed token with confirmation

---

## [1.0.0] — 2026-02-15

### Added — Initial release
- Music system (Lavalink) — play, queue, skip, loop, volume, nowplaying
- Moderation — ban, kick, mute, warn, timeout, purge (with previews)
- Economy — balance, daily, work, gather, shop, inventory, leaderboard
- Games — trivia (solo, PvP, fleet), fun commands
- Agent deploy system — multi-bot voice pool management
- Dashboard — Express + Discord OAuth2
- Prometheus metrics + Grafana integration
- Docker Compose stack (9 services)
- PostgreSQL + Redis persistence
- Slash command registration system

[Unreleased]: https://github.com/wokspec/Chopsticks/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/wokspec/Chopsticks/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/wokspec/Chopsticks/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/wokspec/Chopsticks/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/wokspec/Chopsticks/releases/tag/v1.0.0

