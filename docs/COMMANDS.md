# Chopsticks — Command Reference

> **Hosted by WokSpec.** Chopsticks is not self-hosted — invite the bot and all commands work immediately with no setup required.

---

## Slash Commands (`/`)

### 🎉 Fun & Games

| Command | Description |
|---------|-------------|
| `/8ball <question>` | 🎱 Ask the magic 8-ball a yes/no question (20 weighted answers, colour-coded) |
| `/battle @opponent [wager]` | ⚔️ PvP battle with optional credit wager; XP for both, level-based win odds |
| `/compliment [@target] [style]` | 💐 AI-powered compliment — genuine, dramatic, nerdy, or rap style |
| `/fight [difficulty]` | 🥊 Solo encounter against an AI enemy for XP, credits, and item drops |
| `/imagine <prompt> [style]` | 🎨 Generate an AI image via HuggingFace (FLUX.1-schnell, 6 visual styles) |
| `/meme [subreddit]` | 😂 Random meme from Reddit via live API (NSFW filtered, 5 subreddits) |
| `/quote [type]` | 💬 Inspirational, funny, or programming quote (live API + local fallback) |
| `/riddle [reveal]` | 🧩 Random riddle with spoiler-text answer (80-riddle bank) |
| `/roast [@target] [vibe]` | 🔥 AI-powered roast — playful, hard, nerdy, or rap style (50-entry fallback) |
| `/ship @user1 [@user2]` | 💘 Compatibility score — deterministic hash, same pair = same result |
| `/truthordare [type] [intensity]` | 🎭 Truth or dare prompt — mild or spicy, truth/dare/random |
| `/wouldyourather` | 🤔 Random would-you-rather question (50 pairs, auto-reacts 🅰️🅱️) |

### 🎮 Economy & RPG

| Command | Description |
|---------|-------------|
| `/auction bid/create/list/cancel` | 🏷️ Auction house — list items, bid on others |
| `/balance [@user]` | 💰 View wallet balance and bank account |
| `/bank deposit/withdraw/interest` | 🏦 Bank account management |
| `/casino slots/blackjack/coinflip/roulette` | 🎰 Casino games with credit wagers |
| `/collection view/list` | 📦 View your collectible item collection |
| `/craft <recipe>` | ⚒️ Craft items from collected materials |
| `/daily` | 📅 Claim your daily credit reward (streak bonuses) |
| `/game profile/leaderboard` | 🎮 View game profile, XP, level, achievements |
| `/gather [area]` | ⛏️ Gather materials from different zones |
| `/giveaway start/end/reroll` | 🎁 Server giveaway management |
| `/heist start/join` | 🏦 Cooperative server heist for credits |
| `/inventory` | 🎒 View your item inventory |
| `/leaderboard [type]` | 🏆 Server leaderboard (credits, XP, level) |
| `/marry propose/view/divorce` | 💍 Propose, manage, or view your in-bot marriage |
| `/pet view/adopt/feed/rename/release` | 🐾 Adopt and care for a companion with passive buffs |
| `/pay @user <amount>` | 💸 Transfer credits to another user |
| `/profile [@user]` | 👤 View full game profile with stats and achievements |
| `/profilecard [@user]` | 🖼️ Canvas-rendered profile image card |
| `/quests` | 📋 View and track active quests |
| `/reputation give/check` | ⭐ Give or check reputation points for users |
| `/shop browse/buy` | 🛒 Browse and buy items from the shop |
| `/trade @user` | 🤝 Trade items or credits with another user |
| `/use <item>` | 🧪 Use a consumable item from inventory |
| `/vault deposit/withdraw` | 🔒 Secure credit vault |
| `/work` | 💼 Work for credits (cooldown-based) |
| `/xp [@user]` | ⭐ View XP and level progress |

### 🤖 AI & Agents

| Command | Description |
|---------|-------------|
| `/actions <task>` | 🤖 Spend credits to have agents perform server actions |
| `/agent <name> [message]` | 💬 Chat directly with a deployed agent identity |
| `/agents deploy/list/recall/rename/status` | 🤖 Deploy and manage Chopsticks agents |
| `/ai chat/settings/token` | 🧠 Chat with AI and manage provider (OpenAI, Anthropic, Ollama) |
| `/assistant join/leave/status` | 🎙️ Voice assistant — join/leave your voice channel |
| `/audiobook read/stop/pause` | 📖 AI text-to-speech audiobook reader in voice channels |
| `/pools create/list/delete/join` | 🏊 Manage agent pools for grouped deployments |
| `/social roast/compliment` | 🎭 Fun AI-powered social interactions — roast or compliment someone |

### 🎵 Music

| Command | Description |
|---------|-------------|
| `/music play/pause/stop/skip/queue/volume/loop/shuffle/seek/nowplaying/autoplay` | 🎵 Full music player powered by Lavalink + Last.fm enrichment |

### 🔍 Search & Info

| Command | Description |
|---------|-------------|
| `/anime <query>` | 🎌 Search anime via AniList (free, no key needed) |
| `/apod [date]` | 🔭 NASA Astronomy Picture of the Day |
| `/book <title/author>` | 📚 Search books via Open Library |
| `/color <hex/rgb/name>` | 🎨 Color info — preview, hex, RGB, HSL |
| `/convert unit/currency <value>` | 🔄 Convert units of measurement or currencies |
| `/dadjoke` | 👴 Random dad joke |
| `/fact` | 🧪 Random interesting fact |
| `/github <user/repo>` | 🐙 GitHub user or repository info |
| `/joke` | 😄 Random joke (setup + punchline) |
| `/riddle` | 🧩 Random riddle (see Fun section) |
| `/snipe deleted/edited` | 👀 Show the last deleted or edited message in a channel |
| `/steam <username>` | 🎮 Steam profile lookup |
| `/trivia [difficulty] [category] [mode]` | 🧠 Multi-mode trivia (solo/PvP/duel/fleet) with OTDB live questions |
| `/urban <term>` | 📖 Urban Dictionary definition |
| `/weather <city>` | 🌤️ Current weather conditions |
| `/wiki <query>` | 📖 Wikipedia article summary |

### 🛡️ Moderation

| Command | Description |
|---------|-------------|
| `/antinuke enable/disable/status` | 🛡️ Anti-nuke / anti-raid protection system |
| `/antispam enable/disable/config` | 🛡️ Automatic spam detection and punishment |
| `/automod setup/config` | 🔍 Configure AutoMod content filtering |
| `/cases list/view/edit` | 📂 View and manage moderation cases |
| `/lockdown start/end/lock/unlock` | 🔒 Server or channel lockdown |
| `/mod ban/unban/softban/massban/kick/timeout/warn/warnings/clearwarns` | ⚖️ Core moderation commands |
| `/modlogs setup/clear` | 📋 Configure moderation action logs |
| `/note add/list/remove` | 📝 Manage moderator notes for users |
| `/purge <count> [options]` | 🗑️ Bulk delete messages with filters |
| `/reactionroles` | 🎭 Self-assignable reaction roles |
| `/starboard setup/remove` | ⭐ Starboard configuration |
| `/warns [@user]` | ⚠️ View warning history |

### ⚙️ Server Config

| Command | Description |
|---------|-------------|
| `/afk [reason]` | 💤 Set or clear AFK status |
| `/alias list/add/remove` | 🔗 Prefix command aliases |
| `/analytics overview/activity` | 📊 View server activity and engagement analytics |
| `/automations add/list/remove/run` | ⚡ Event-triggered script automations |
| `/autorole set/clear` | 🤖 Auto-assign roles on join |
| `/autoresponder add/list/remove` | 🤖 Create auto-responders that react to message triggers |
| `/avatar [@user]` | 🖼️ Show user or server avatar |
| `/backup create/list/restore/delete` | 🧰 Snapshot and restore server roles, channels, and permissions |
| `/birthday set/clear/list` | 🎂 Birthday reminders |
| `/boosterperks color/setup` | 🚀 Customize boost role or configure boost perks |
| `/colorrole` | 🎨 Self-assignable colour roles |
| `/commands list/enable/disable` | 📋 Enable or disable commands per-server |
| `/confessions setup/post` | 🤫 Anonymous confession system |
| `/custom set/delete/list` | ✏️ Create and manage custom slash commands |
| `/customcmd create/delete/list` | ✏️ Create prefix-triggered custom text commands |
| `/embed create` | 📝 Create and send a custom embed to a channel |
| `/emoji add/delete/rename/list` | 🙂 Manage server emojis |
| `/events create/list/delete` | 📅 Server event scheduling |
| `/help [command]` | ❓ Help and command reference |
| `/highlight add/remove/list` | 🔔 Get notified when a keyword is mentioned |
| `/invite` | 📨 Get the bot's invite link |
| `/levels rewards/config` | 📈 Level rewards and progression configuration |
| `/macro set/delete/list` | 📌 Create macro shortcuts for common actions |
| `/mod-log set/clear` | 📋 Set moderation log channel |
| `/notify channel/twitch/youtube` | 📡 Configure Twitch and YouTube stream/upload notifications |
| `/ping` | 🏓 Bot latency check |
| `/poll create` | 📊 Create a server poll |
| `/reminders add/list/remove` | ⏰ Personal reminders |
| `/reputation give/check` | ⭐ Give or check server reputation (see Economy section) |
| `/schedule message` | 🕐 Schedule a message to be sent in a channel |
| `/serverinfo` | ℹ️ Server, bot, and role info |
| `/setup wizard` | 🔧 Guided server setup |
| `/setuppanel` | 🧭 Discord-native server setup dashboard with button-driven module controls |
| `/suggest <text>` | 💡 Submit a suggestion to the server's suggestions channel |
| `/tags create/edit/delete/list/use` | 🏷️ Custom tag/response shortcuts |
| `/theme color/reset` | 🎨 Customize how the bot looks in this server |
| `/threads autothread-add/remove` | 🧵 Auto-thread and announcement channel management |
| `/tickets config/close/create` | 🎫 Support ticket system |
| `/tutorials list/view` | 📚 Interactive tutorials |
| `/userinfo [@user]` | 👤 Detailed user information |
| `/verify setup/config` | ✅ Set up and manage the member verification system |
| `/welcome set/clear/test` | 👋 Welcome message configuration |

---

## Prefix Commands (`!`)

> The default prefix is `!`. Servers can change it with `/prefix set <prefix>`.

### 🛠️ Utility

| Command | Aliases | Description |
|---------|---------|-------------|
| `!ping` | — | Bot latency |
| `!uptime` | — | Bot uptime |
| `!help [command]` | — | Command help |
| `!echo <text>` | — | Echo text back |
| `!choose <a\|b\|c>` | — | Random choice |
| `!invite` | — | Invite link |

### ℹ️ Info

| Command | Aliases | Description |
|---------|---------|-------------|
| `!serverinfo` | `!si` | Server info |
| `!userinfo [@user]` | `!ui` | User info |
| `!avatar [@user]` | `!av` | Show avatar |
| `!roleinfo <role>` | `!ri` | Role details |
| `!botinfo` | `!bi` | Bot info |

### 🎉 Fun

| Command | Aliases | Description |
|---------|---------|-------------|
| `!roll [NdN]` | `!dice` | Dice roller (e.g. `!roll 2d6`) |
| `!coinflip` | `!cf`, `!flip` | Flip a coin |
| `!8ball <question>` | — | Magic 8-ball |
| `!compliment [@user]` | — | Compliment someone |
| `!roast [@user]` | — | Roast someone |
| `!trivia [category]` | — | Quick trivia question |
| `!riddle` | — | Random riddle |

### 📡 Media & Search

| Command | Aliases | Description |
|---------|---------|-------------|
| `!fact` | — | Random fact |
| `!dadjoke` | `!dad` | Dad joke |
| `!joke` | — | Random joke |
| `!wiki <query>` | — | Wikipedia lookup |
| `!github <user>` | `!gh` | GitHub user info |
| `!anime <title>` | — | Anime search |
| `!book <query>` | — | Book search |
| `!urban <term>` | `!ud` | Urban Dictionary |
| `!apod` | — | NASA APOD |
| `!steam <username>` | — | Steam profile |
| `!color <hex>` | `!colour` | Color info |
| `!weather <city>` | — | Weather lookup |
| `!imagine <prompt>` | — | AI image generation |

### 💰 Economy

| Command | Aliases | Description |
|---------|---------|-------------|
| `!balance` | `!bal`, `!credits` | Wallet balance |
| `!daily` | — | Claim daily reward |
| `!work` | — | Earn credits |
| `!shop` | — | Browse shop |
| `!inventory` | `!inv` | View inventory |
| `!leaderboard` | `!lb`, `!top` | Credit leaderboard |
| `!profile` | `!p` | Game profile |
| `!xp` | — | XP progress |
| `!quests` | — | Active quests |
| `!craft` | — | Craft items |

### ⚖️ Moderation *(requires manage permissions)*

| Command | Aliases | Description |
|---------|---------|-------------|
| `!purge <n>` | `!clear`, `!prune` | Bulk delete messages |
| `!slowmode [seconds]` | `!sm` | Set slowmode |
| `!kick @user [reason]` | — | Kick user |
| `!ban @user [reason]` | — | Ban user |
| `!unban <id>` | — | Unban user |
| `!timeout @user <duration>` | `!mute` | Timeout user |
| `!warn @user [reason]` | — | Issue warning |
| `!warnings @user` | `!warns` | View warnings |
| `!clearwarns @user` | — | Clear all warnings |
| `!lock [channel]` | — | Lock channel |
| `!unlock [channel]` | — | Unlock channel |
| `!nick @user <name>` | — | Change nickname |
| `!softban @user [reason]` | — | Softban (ban+unban) |
| `!role @user <role>` | — | Toggle role |

### 🗓️ Server

| Command | Aliases | Description |
|---------|---------|-------------|
| `!poll <question\|opt1\|opt2>` | — | Quick poll |
| `!giveaway <duration> <prize>` | `!gw` | Start giveaway |
| `!remind <time> <message>` | — | Set reminder |
| `!welcome set/test` | — | Configure welcome |
| `!autorole set/clear` | — | Auto-role config |
| `!prefix set/reset` | — | Change bot prefix |

---

## Rate Limits

All commands include rate limiting to ensure fair usage at scale:

| Type | Limit |
|------|-------|
| Per-user prefix cooldown | Varies per command (5–60s) |
| Global prefix limit | 5 commands per 10 seconds per user |
| `/roast` | 1 per 60 seconds per user |
| `/compliment` | 1 per 30 seconds per user |
| `/imagine` | 1 per 30 seconds per user + 5 per hour per guild |
| `/meme` | 3 per 30 seconds per channel |
| `/battle` | 1 per 5 minutes per user |

---

## Operator-Only Commands

The following slash commands are only deployed to specific guilds (not global) and require the `BOT_OWNER_IDS` environment variable:

- `/dashboard` — Guild dashboard (renamed from `/console`)
- `/agentkeys` — Link your own API keys to your guild's agents (BYOK: OpenAI, Groq, Anthropic, ElevenLabs)
- `/logs` — Bot log viewer  
- `/model` — AI model configuration
- `/scripts` — Automation script runner
- `/statschannel` — Auto-updating stat channels

---

*Last updated: v2.1.0 (hardening/ha-6 — full command reference audit)*
