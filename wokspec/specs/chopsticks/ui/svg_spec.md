# SVG Generation Spec — Chopsticks Bot

> **Phase 5 — UI/UX Revamp**  
> Covers rank cards, profile images, and economy cards generated as SVG/PNG buffers via the `canvas` npm package.

---

## 1. Template Variables

The following variables are substituted at render time. All values must be HTML/SVG-escaped before insertion.

| Variable | Type | Description |
|----------|------|-------------|
| `{{username}}` | string | Discord display name (not tag). Max 32 chars; truncate with `…` if longer. |
| `{{discriminator}}` | string | Legacy `#0000` tag; omit if user has migrated to the new username system. |
| `{{level}}` | number | Current XP level (integer ≥ 0). |
| `{{xp}}` | number | XP accumulated toward the next level. |
| `{{xp_required}}` | number | Total XP needed to reach the next level. |
| `{{rank}}` | number | Leaderboard position in the current guild (integer ≥ 1). |
| `{{avatar_url}}` | string | Full URL to the user's avatar (HTTPS). Fall back to default Discord avatar URL if null. |
| `{{guild_name}}` | string | Server name. Used in economy/profile cards. Max 50 chars; truncate with `…`. |
| `{{balance}}` | number | Economy balance. Formatted with locale-aware comma separators. |
| `{{accent_color}}` | hex string | User's Discord profile accent color if available; falls back to `color-info` token. |

---

## 2. Font Guidelines

Use only **system fonts** or **web-safe / permissively licensed fonts bundled with the project** to avoid licensing issues at runtime.

### Recommended font stack (in priority order)

1. `"GG Sans"` — Discord's own font; available on systems with Discord installed. Only use if available at runtime; never bundle it (not licensed for redistribution).
2. `"Helvetica Neue"`, `"Arial"`, `"Liberation Sans"` — widely available, no license concerns.
3. `"DejaVu Sans"` — available on most Linux servers (installed with `fontconfig`). **Use as the production default** in Docker/server environments.
4. `"Noto Sans"` — excellent Unicode coverage; install via `apt install fonts-noto` or bundle the subset. Good fallback for non-Latin usernames.
5. **Monospace numbers:** `"Courier New"`, `"DejaVu Sans Mono"` for XP/balance figures.

### What to avoid
- Proprietary fonts (e.g. `"Circular"`, `"Whitney"`, `"Futura"`) — cannot be bundled.
- Google Fonts fetched at runtime — adds network latency and failure mode; download and bundle a subset instead.
- Fonts without OFL or Apache 2.0 license — check before adding anything new.

### Font sizes (reference scale)

| Element | Size | Weight |
|---------|------|--------|
| Rank `#1` badge | 28 px | Bold |
| Username | 22 px | SemiBold |
| Level label | 18 px | Regular |
| XP / balance | 16 px | Regular (monospace) |
| Footer / guild name | 13 px | Light |

---

## 3. Generating SVGs via the `canvas` npm Package

The `canvas` package is already installed. Use it to render to a `Buffer` for Discord attachment upload.

### Basic pattern

```js
// src/utils/canvas.js
import { createCanvas, loadImage } from 'canvas';
import { COLOR_TOKENS } from './colorTokens.js';  // import from color_palette.json

export async function renderRankCard({ username, level, xp, xp_required, rank, avatar_url, accent_color }) {
  const W = 934, H = 282;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#23272A';
  ctx.roundRect(0, 0, W, H, 20);
  ctx.fill();

  // Avatar (circle-clipped)
  const avatar = await loadImage(avatar_url).catch(() => loadImage(DEFAULT_AVATAR_URL));
  ctx.save();
  ctx.beginPath();
  ctx.arc(120, H / 2, 90, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(avatar, 30, H / 2 - 90, 180, 180);
  ctx.restore();

  // XP bar background
  const barX = 240, barY = 190, barW = 630, barH = 30;
  ctx.fillStyle = '#2C2F33';
  ctx.roundRect(barX, barY, barW, barH, barH / 2);
  ctx.fill();

  // XP bar fill
  const progress = Math.min(xp / xp_required, 1);
  const fillColor = accent_color || COLOR_TOKENS['color-info'];
  ctx.fillStyle = fillColor;
  ctx.roundRect(barX, barY, barW * progress, barH, barH / 2);
  ctx.fill();

  // Username
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 22px "DejaVu Sans", Arial, sans-serif';
  ctx.fillText(username.slice(0, 32), barX, 160);

  // Level / XP text
  ctx.fillStyle = COLOR_TOKENS['color-neutral'];
  ctx.font = '16px "DejaVu Sans Mono", monospace';
  ctx.fillText(`Level ${level}  •  ${xp.toLocaleString()} / ${xp_required.toLocaleString()} XP`, barX, barY - 12);

  // Rank badge
  ctx.fillStyle = COLOR_TOKENS['color-info'];
  ctx.font = 'bold 28px "DejaVu Sans", Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`#${rank}`, W - 30, 80);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}
```

### Attaching to a Discord reply

```js
import { AttachmentBuilder } from 'discord.js';
import { renderRankCard } from '../utils/canvas.js';

const buffer = await renderRankCard({ username, level, xp, xp_required, rank, avatar_url });
const attachment = new AttachmentBuilder(buffer, { name: 'rank.png' });
await interaction.reply({ files: [attachment], ephemeral: false });
```

### Economy card variant

Same pattern but with `balance` replacing XP bar; use `color-premium` as accent if user has premium status.

### Profile image variant

Full-width card (600×400) with guild name footer and expanded fields (join date, roles). Use `color-neutral` for secondary fields.

---

## 4. Color Token Usage in SVGs

Import token values directly from the palette JSON to keep SVG colors in sync with embed colors.

```js
// src/utils/colorTokens.js
import palette from '../../wokspec/specs/chopsticks/ui/color_palette.json' assert { type: 'json' };
export const COLOR_TOKENS = palette.tokens;
export const EMBED_COLORS = palette.embed_color_map;
```

**Usage rules in canvas code:**
- Background fill: always `#23272A` (Discord dark, not a semantic token — it's a layout constant).
- Accent / highlight bars: use `color-info` by default; override with `color-premium` for premium users.
- Success indicators (level-up badge): `color-success`.
- Error/warning overlays: `color-error` or `color-warning` respectively.
- Text on dark backgrounds: `#FFFFFF` (primary) and `color-neutral` (#99AAB5) for secondary.
- Never use `color-danger` (#FF0000) for decorative purposes; only for destructive-state overlays.

---

## 5. Implementation Prompt

> **PR title:** `feat(canvas): migrate rank/profile/economy card rendering to color tokens`  
> **Branch:** `feat/canvas-color-tokens`
>
> **Preconditions:**
> - `canvas` npm package is installed and working (`src/utils/canvas.js` or similar exists).
> - `color_palette.json` is committed at `wokspec/specs/chopsticks/ui/color_palette.json`.
>
> **Files to create / modify:**
> - Create `src/utils/colorTokens.js` — exports `COLOR_TOKENS` and `EMBED_COLORS` from the palette JSON.
> - Modify `src/utils/canvas.js` (or create it if absent) — replace all hard-coded hex strings with `COLOR_TOKENS['color-*']` references. Add `renderRankCard`, `renderProfileCard`, `renderEconomyCard` exports.
> - Modify any command file that currently builds embeds with hard-coded color ints — replace with `EMBED_COLORS['success']` etc.
>
> **Acceptance checklist:**
> - [ ] No hex color literals remain in `canvas.js` outside of layout constants (`#23272A`, `#2C2F33`).
> - [ ] `renderRankCard({ username, level, xp, xp_required, rank, avatar_url })` returns a `Buffer`.
> - [ ] Card renders with correct font fallback when `GG Sans` is absent (CI uses Linux fonts only).
> - [ ] Attachment uploads successfully in a test guild without errors.
> - [ ] `color_palette.json` import works under Node ESM (`assert { type: 'json' }`).
