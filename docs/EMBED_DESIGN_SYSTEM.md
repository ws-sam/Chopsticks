# Embed Design System — Chopsticks MAP Cycle 2

> **Status:** Active. All new embeds must use components from this system.
> **Pod owner:** UX & Embed Systems Pod

---

## Principles

1. **Componentized** — No raw `.addFields()` for common patterns. Use the library.
2. **Consistent hierarchy** — Title → visual bar/grid → fields → footer. Never reversed.
3. **Compact by default** — Discord embeds are narrow. Dense text > big paragraphs.
4. **Icon-first fields** — Field names get an emoji prefix (👛 Wallet, 🏦 Bank, 🤖 Agents).
5. **No floating numbers** — Always locale-format: `n.toLocaleString()`. Never raw integers.

---

## Component Library (`src/utils/embedComponents.js`)

### `progressBar(value, max, width?)`

Unicode block progress bar. Default width: 10.

```js
import { progressBar } from "../utils/embedComponents.js";

progressBar(50, 100)      // → "█████░░░░░ 50%"
progressBar(750, 1000, 8) // → "██████░░ 75%"
progressBar(0, 100)       // → "░░░░░░░░░░ 0%"
```

**Use for:** XP bars, cooldown timers, pool capacity, any scalar progress.

---

### `inventoryGrid(items, cols?)`

Formats an item array into a readable grid. Default: 2 columns.

```js
import { inventoryGrid } from "../utils/embedComponents.js";

inventoryGrid([
  { name: "Sword", qty: 3, emoji: "⚔️" },
  { name: "Shield", qty: 1, emoji: "🛡️" },
], 2)
// → "⚔️ Sword ×3  │  🛡️ Shield ×1"
```

**Use for:** Inventory displays, shop listings, equipment panels.

---

### `agentStatusPanel(agents, capacity?)`

Returns a full `EmbedBuilder` for agent pool health. Capacity defaults to 49.

```js
import { agentStatusPanel } from "../utils/embedComponents.js";

const embed = agentStatusPanel([
  { id: "agent-001-xxxx", status: "active", podTag: "general" },
  { id: "agent-002-yyyy", status: "busy",   podTag: "music" },
]);
await interaction.reply({ embeds: [embed] });
```

**Use for:** `/agents`, `/pools status`, dashboard agent panel.

---

### `economyCard({ wallet, bank, xp?, level?, username? })`

Returns a full `EmbedBuilder` for economy summary with wallet progress bar.

```js
import { economyCard } from "../utils/embedComponents.js";

const embed = economyCard({
  wallet: 1500,
  bank: 8500,
  xp: 750,
  level: 12,
  username: "WokSpec",
});
await interaction.reply({ embeds: [embed] });
```

**Use for:** `/profile` economy section, `/game` summary, standalone `/bank`.

---

### `musicNowPlaying({ title, artist?, url?, thumbnail?, duration?, position?, requestedBy? })`

Returns a full `EmbedBuilder` for a music now-playing display with live-update scaffold.

```js
import { musicNowPlaying } from "../utils/embedComponents.js";

const embed = musicNowPlaying({
  title: "Never Gonna Give You Up",
  artist: "Rick Astley",
  url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
  duration: 213000,
  position: 45000,
  requestedBy: "WokSpec",
});
await interaction.reply({ embeds: [embed] });
```

**Use for:** `/music` now-playing, `!play` response, queue displays.

---

## Migration Targets

| Command | Component used | Status |
|---------|---------------|--------|
| `profile.js` | `progressBar`, `inventoryGrid` | ✅ Cycle 2 |
| `stats.js` | `progressBar` | ✅ Cycle 2 |
| `agents.js` | `agentStatusPanel` | 🔜 Cycle 3 |
| `game.js` | `economyCard` | 🔜 Cycle 3 |
| `music.js` | `musicNowPlaying` | 🔜 Cycle 4 |

---

## Compliance Rules

**All commands MUST:**
- Use `replySuccess`, `replyError`, or `replyEmbed` (from `discordOutput.js`) for standard replies
- Use embed components for any of: economy data, inventory, agent pool, XP/progress, music

**Commands MUST NOT:**
- Use raw `new EmbedBuilder()` with inline `.addFields()` for data types covered by components
- Use bare integers without `.toLocaleString()` in field values
- Set raw hex colors — use `Colors.*` from `discordOutput.js`

---

## Color Palette (`src/utils/discordOutput.js`)

| Key | Usage |
|-----|-------|
| `Colors.Success` | ✅ Confirmation messages |
| `Colors.Error` | ❌ Errors, failures |
| `Colors.Warning` | ⚠️ Soft warnings |
| `Colors.Info` | ℹ️ Info panels, economy |
| `Colors.Neutral` | Idle states, no data |
| `Colors.Premium` | Premium features |
| `Colors.Music` | Music/voice embeds |

---

## Field Name Conventions

| Data type | Field name prefix |
|-----------|------------------|
| Credits/wallet | 👛 |
| Bank | 🏦 |
| Net worth | 📊 |
| XP/level | ⭐ / ⚡ |
| Agents | 🤖 |
| Achievements | 🏆 |
| Commands | ⌨️ |
| Voice/VC | 🎙️ |
| Music | 🎵 |
| Safety/mod | 🛡️ |
