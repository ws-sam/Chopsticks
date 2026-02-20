# Chopsticks UI/UX Guide

> **Phase 5 — UI/UX Revamp**  
> This document is the authoritative UX reference for all Discord interactions produced by Chopsticks.

---

## 1. Design Principles

| Principle | Description |
|-----------|-------------|
| **Clear action labels** | Every button and select-menu option uses plain English verbs. Never abbreviate moderation actions ("Ban User", not "BN"). Never use jargon or Discord API terms visible to end-users. |
| **No jargon** | Error messages must describe the problem in user terms. "Lavalink" is never shown to users; say "Music service" instead. "PostgreSQL" → "Database". |
| **Non-blocking feedback** | Defer replies within 2 s to avoid interaction expiry. Show a lightweight acknowledgement ("⏳ Processing…") before any slow operation. |
| **Ephemeral for sensitive ops** | Any interaction that touches keys, tokens, personal data, moderation actions visible only to staff, or financial figures must use `ephemeral: true`. Non-ephemeral only when the result is intended for the full channel. |
| **Consistent hierarchy** | Title → short summary → detail fields → action buttons. Never bury the primary action below the fold. |
| **Fail gracefully** | Every command has a defined error path (see §6). Never surface a raw stack trace or unhandled rejection to users. |

---

## 2. Color System

All colors are defined as tokens in `color_palette.json` and must be referenced by semantic name, not hard-coded hex.

| Token | Hex | Decimal (embed) | Use |
|-------|-----|-----------------|-----|
| `color-success` | `#57F287` | `5763719` | Confirmations, completed actions, joins |
| `color-error` | `#ED4245` | `15548997` | Failures, bans, errors |
| `color-warning` | `#FEE75C` | `16705372` | Warnings, soft alerts, rate-limit notices |
| `color-info` | `#5865F2` | `5793266` | Informational embeds, help, blurple brand |
| `color-neutral` | `#99AAB5` | `10070709` | General, uncategorised, grey states |
| `color-premium` | `#FF73FA` | `16741370` | Premium features, boosted-server exclusives |
| `color-music` | `#1DB954` | `1947988` | Music player embeds (Spotify green) |
| `color-danger` | `#FF0000` | `16711680` | Destructive irreversible actions (delete guild data, nuke channel) |

### Usage rules
- Import colors from `color_palette.json`; do not hard-code hex values in command files.
- Always pair a semantic color with text so color alone is not the only indicator (§7 Accessibility).
- Embeds in DM context use the same color tokens; Discord renders them correctly.

---

## 3. Button States

All buttons are `ActionRowBuilder` + `ButtonBuilder` from `discord.js`.

| Button | Label | Style constant | Disabled condition |
|--------|-------|----------------|--------------------|
| **Play/Pause** | `▶ Play` / `⏸ Pause` | `PRIMARY` | No voice session active |
| **Skip** | `⏭ Skip` | `SECONDARY` | Queue has fewer than 2 tracks |
| **Stop** | `⏹ Stop` | `DANGER` | No voice session active |
| **Queue** | `📋 Queue` | `SECONDARY` | Never disabled; shows "empty" state instead |
| **Vote Skip** | `🗳 Vote Skip` | `PRIMARY` | User already voted; vote count met (auto-fires) |
| **Confirm** | `✅ Confirm` | `SUCCESS` | Disabled after first click (idempotency) |
| **Cancel** | `✖ Cancel` | `SECONDARY` | Never disabled |
| **Delete** | `🗑 Delete` | `DANGER` | User lacks `ManageMessages`; item already deleted |
| **Report** | `🚩 Report` | `DANGER` | User has already reported this item (per-user cooldown) |

**Disabled state copy:** buttons disabled by permission show tooltip-style text in the embed footer:  
`"You don't have permission to use this button."`

---

## 4. Modal Flows

### 4a. Ban Reason Modal

- **Trigger:** `/ban` command, optional reason field omitted — or staff clicks "📝 Add Reason" on a case.
- **Title:** `Ban Reason`
- **Fields:**
  - `reason` — `TextInput` (paragraph), label `"Reason for ban"`, placeholder `"Rule violation, harassment, etc."`, `required: true`, maxLength `500`
- **On submit:** reason is stored in mod log, DM'd to user if `notify_user: true`.

### 4b. Ticket Open Modal

- **Trigger:** User clicks "📩 Open Ticket" button in the configured ticket channel.
- **Title:** `Open a Support Ticket`
- **Fields:**
  - `subject` — `TextInput` (short), label `"Subject"`, placeholder `"Brief description of your issue"`, `required: true`, maxLength `100`
  - `details` — `TextInput` (paragraph), label `"Details"`, placeholder `"Describe the issue in detail…"`, `required: false`, maxLength `1000`
- **On submit:** Creates private thread, posts embed with user info + subject.

### 4c. Link API Key (Ephemeral)

- **Trigger:** `/ai token link [provider]` or `/voice config` for LLM key.
- **Flags:** `ephemeral: true` — interaction and response never visible in channel history.
- **Title:** `Link {Provider} API Key` (e.g. `Link Anthropic API Key`)
- **Fields:**
  - `api_key` — `TextInput` (short), label `"Paste your API key"`, placeholder `"sk-ant-…"`, `required: true`, maxLength `200`
- **On submit:** Bot validates key (cheap test call), encrypts with AES-256-GCM, stores in `guild_settings`. Key is redacted immediately after validation.

### 4d. Create Poll Modal

- **Trigger:** `/poll create` command with `--modal` flag, or "📊 Create Poll" button.
- **Title:** `Create a Poll`
- **Fields:**
  - `question` — `TextInput` (short), label `"Question"`, placeholder `"What should we name the new channel?"`, `required: true`, maxLength `200`
  - `options` — `TextInput` (paragraph), label `"Options (one per line, 2–10)"`, placeholder `"Option A\nOption B\nOption C"`, `required: true`, maxLength `400`
  - `duration` — `TextInput` (short), label `"Duration"`, placeholder `"e.g. 1h, 30m, 1d"`, `required: false`, maxLength `10`
- **On submit:** Bot parses options, creates reaction/button poll embed.

---

## 5. Embed Templates

All embeds are produced via the `makeEmbed()` helper in `src/utils/discordOutput.js`.

### 5a. Success Embed

```
color: color-success (#57F287)
author: ✅ {short action title}
description: {one-sentence result}
footer: Chopsticks • {timestamp}
```

Example — `/warn` applied:
> ✅ **Warning Issued**  
> @TargetUser has been warned. Reason: Spamming in #general.  
> *(footer: Chopsticks • 12 Jan 2025, 14:32 UTC)*

### 5b. Error Embed

```
color: color-error (#ED4245)
author: ❌ {error title}
description: {user-readable explanation}
fields:
  - name: "What to do"
    value: {recovery suggestion}
footer: Error code: {ERR_CODE} • Chopsticks
```

### 5c. Music — Now Playing

```
color: color-music (#1DB954)
author: 🎵 Now Playing
title: {track title} — {artist}
thumbnail: {track artwork url}
fields:
  - name: Requested by    value: @{username}   inline: true
  - name: Duration        value: {elapsed}/{total}  inline: true
  - name: Queue           value: {n} track(s) remaining  inline: true
footer: Volume: {volume}% • Chopsticks Music
```

### 5d. Moderation Action Embed

```
color: color-error or color-warning (depending on action severity)
author: 🔨 {Action} — {target username}
description: {reason}
fields:
  - name: Moderator    value: @{mod}       inline: true
  - name: Duration     value: {duration}   inline: true  (omit if permanent)
  - name: Case #       value: {case_id}    inline: true
footer: {guildName} Moderation Log • Chopsticks
```

### 5e. Welcome Embed

```
color: color-info (#5865F2)
author: 👋 Welcome to {guildName}!
description: {guild welcome message or default}
thumbnail: {guild icon url}
fields:
  - name: Member #      value: #{memberCount}     inline: true
  - name: Get started   value: "Check out #rules and #roles"  inline: false
footer: Chopsticks • {timestamp}
```

---

## 6. Failure State Copy

Exact text to use for each error case. All failure embeds use the **Error Embed** template (§5b).

| Code | Title | Description | What to do |
|------|-------|-------------|------------|
| `ERR_NO_PERMS` | Missing Permission | You don't have permission to use this command. | Ask a server admin to grant you the required role or permission. |
| `ERR_GUILD_ONLY` | Server Only | This command can only be used inside a server, not in DMs. | Run this command in a server channel. |
| `ERR_RATE_LIMITED` | Slow Down | You're sending commands too fast. Please wait a moment. | Wait {retry_after}s before trying again. |
| `ERR_LLM_UNAVAILABLE` | AI Unavailable | The AI service is not responding right now. | Try again in a few minutes. If the issue persists, an admin can check `/ai help`. |
| `ERR_LAVALINK_DOWN` | Music Service Unavailable | The music service is currently offline. | Try again shortly. If music is broken for everyone, ask an admin to check the bot status. |
| `ERR_STORAGE_FULL` | Storage Limit Reached | This server has reached its data storage limit. | An admin can free up space by clearing old logs or upgrading the plan. |
| `ERR_INVALID_INPUT` | Invalid Input | {specific field} — {specific problem}. | {field-specific correction hint}. |
| `ERR_UNEXPECTED` | Something Went Wrong | An unexpected error occurred. This has been logged. | Try again. If it keeps happening, report it with `/report`. |

---

## 7. Accessibility

- **No color-only indicators.** Every status communicated by embed color is also communicated by a text label, icon, or title. Example: an error embed has both a red left-bar _and_ "❌ Error" in the author field.
- **Button labels always include text.** Emoji alone is never used as the sole label. ✅ `"✅ Confirm"` — ❌ `"✅"`.
- **Screen-reader-friendly descriptions.** Embed descriptions are complete sentences. Abbreviations are spelled out on first use. Field names are nouns or short noun phrases, not symbols.
- **Do not rely on inline code or bold alone** to convey meaning — use it for emphasis only.
- **Avoid walls of text.** Embeds longer than ~300 chars of body text should use fields to break up content.
- **Alt text for images.** When posting image-type responses (SVG rank cards, `/ai image`), include a plain-text description in the embed description field.

---

## 8. Three-Step Onboarding Tutorial

Shown in a DM to the server admin (or first user with `Administrator`) on the bot's first run in a new guild.

**Step 1 of 3 — Welcome**

> 👋 **Hey there, I'm Chopsticks!**
>
> Thanks for adding me to **{guildName}**. I'll walk you through three quick steps to get me set up.
>
> **What I can do:**
> 🔨 Moderation · 🎵 Music · 🤖 AI chat · 🎮 Economy · 🎟 Tickets · 📊 Polls · and more
>
> Run `/config` in your server to open the setup dashboard, or keep reading this guide.
>
> *(Step 1 of 3 — reply with `next` or run `/onboarding step 2` to continue)*

**Step 2 of 3 — Core Setup**

> ⚙️ **Let's configure the basics.**
>
> Here are the three commands that matter most for a new server:
>
> 1. `/config logs channel:#mod-logs` — Point me at a channel for moderation logs.
> 2. `/config welcome channel:#welcome` — Set a welcome channel for new members.
> 3. `/autorole add role:@Member` — Automatically assign a role when someone joins.
>
> You can also run `/config` with no arguments to see the full settings dashboard.
>
> *(Step 2 of 3)*

**Step 3 of 3 — You're Ready**

> ✅ **Setup complete — you're good to go!**
>
> A few things to explore next:
>
> • `/help` — Browse all commands, organised by category.
> • `/modlogs` — View moderation history for your server.
> • `/music play [song]` — Play music in a voice channel.
> • `/ai help` — Set up AI chat features.
>
> Need help? Join the support server: **{SUPPORT_SERVER_URL}** or run `/report`.
>
> *(Step 3 of 3 — onboarding complete)*

---

## 9. First-Time User Experience

The goal: a new member reaches their first useful action in **three commands or fewer** starting from `/help`.

**Discovery path:**

1. **`/help`** — Returns a paginated category list. Categories shown: Moderation, Music, Economy, AI, Fun, Utility, Config. Each category has a one-line description. A "Quick Start" field at the top says: _"Not sure where to start? Try `/music play`, `/balance`, or `/ai chat`."_

2. **User picks a category** — e.g. selects "🎵 Music" from the select-menu. Bot replies with a condensed command list for that category plus the most common command highlighted: _"Most used: `/music play [song]`"_.

3. **User runs the suggested command** — e.g. `/music play lo-fi chill`. Bot joins VC and starts playback. First-time users see a small tip footer: _"Tip: use `/music queue` to see upcoming tracks or `/music skip` to skip."_

**Rules:**
- `/help` must always be usable without any permissions.
- The select-menu in `/help` must show categories relevant to the user's role (hide `Config`/`Mod` categories from users without relevant permissions).
- No command should require more than one sub-command layer to reach its primary function (e.g. `/music play`, not `/music actions play`).
