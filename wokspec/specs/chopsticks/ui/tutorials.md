# Chopsticks Bot — Quickstart Tutorials

> **Phase 5 — UI/UX Revamp**  
> Three step-by-step tutorials for admins, moderators, and music users.  
> Each step shows: the exact slash command, what happens, and the embed the user sees.

---

## Tutorial 1 — Admin Quickstart (3 Steps)

> **Goal:** Get the bot fully configured in a brand-new server.

---

### Step 1 — Open the Setup Dashboard

**Command:**
```
/config
```

**What happens:**  
The bot replies ephemerally with the configuration dashboard embed. It lists all configurable modules with their current status (enabled/disabled). A select-menu lets the admin jump to any section. No settings are changed yet.

**Embed:**
```
🎛 Server Configuration — {guildName}
──────────────────────────────────────
Configure modules below. Changes take effect immediately.

  Logs channel        not set
  Welcome channel     not set
  Auto-role           not set
  Moderation          enabled (defaults)
  Music               enabled (defaults)
  Tickets             disabled
  AI chat             disabled (no provider)

[⚙ Edit Logs]  [⚙ Edit Welcome]  [⚙ Edit Auto-role]
[⚙ Edit Moderation]  [⚙ Edit Music]  [More →]

Chopsticks • Only visible to you
```

---

### Step 2 — Set Mod Logs & Welcome Channel

**Commands (run each separately):**
```
/config logs channel:#mod-logs
/config welcome channel:#welcome message:Welcome {user} to {server}! You are member #{count}.
```

**What happens:**  
Each command updates `guild_settings` with the chosen channel and replies ephemerally with a success confirmation. The bot immediately posts a test welcome message in `#welcome` and a test log entry in `#mod-logs` so the admin can confirm it's working.

**Embed (after `/config logs`):**
```
✅ Mod Logs Configured
──────────────────────
Moderation events will now be logged in #mod-logs.
Log types: ban, kick, warn, timeout, mute, role changes, message deletes.

To log more event types, run /config logs types.

Chopsticks • Server Configuration
```

**Embed (after `/config welcome`):**
```
✅ Welcome Messages Configured
────────────────────────────────
New members will see your welcome message in #welcome.
A test message has been posted there now so you can preview it.

Tip: Use {user}, {server}, {count} as placeholders.

Chopsticks • Server Configuration
```

---

### Step 3 — Assign an Auto-role

**Command:**
```
/autorole add role:@Member
```

**What happens:**  
The bot stores `@Member` as the auto-assigned role for new joins. It validates that the bot's own role is positioned above `@Member` in the hierarchy (if not, it warns the admin). Replies ephemerally.

**Embed:**
```
✅ Auto-role Enabled
──────────────────────
New members will automatically receive @Member when they join.

Role position: ✅ OK (bot role is above @Member)
Current member count: {memberCount}

To add more auto-roles: /autorole add role:@AnotherRole
To view all: /autorole list

Chopsticks • Server Configuration
```

---

## Tutorial 2 — Moderation Quickstart (3 Steps)

> **Goal:** Warn a user, apply a timeout, and review the mod log.

---

### Step 1 — Warn a User

**Command:**
```
/warn user:@TargetUser reason:Spamming in #general
```

**What happens:**  
The bot records the warning in the database, increments the user's warn count, posts a moderation log entry in the configured logs channel, and DMs the user (if DMs are open). The response is ephemeral.

**Embed (ephemeral reply to moderator):**
```
✅ Warning Issued
──────────────────
User          @TargetUser
Reason        Spamming in #general
Case #         42
Warn count    2 (this guild)

The user has been notified by DM.
To clear this warning: /clearwarns user:@TargetUser case:42

Chopsticks • Moderation
```

---

### Step 2 — Apply a Timeout

**Command:**
```
/timeout user:@TargetUser duration:10m reason:Continued spamming after warning
```

**What happens:**  
The bot applies a Discord timeout (communication disabled) for 10 minutes, logs the action, and DMs the user. If the bot lacks `ModerateMembers` permission, it replies with `ERR_NO_PERMS` and explains which permission is needed.

**Embed (ephemeral reply to moderator):**
```
✅ Timeout Applied
──────────────────
User          @TargetUser
Duration      10 minutes (expires 14:42 UTC)
Reason        Continued spamming after warning
Case #         43

User is timed out and cannot send messages or join voice.
To remove early: /timeout remove user:@TargetUser

Chopsticks • Moderation
```

---

### Step 3 — View Mod Logs

**Command:**
```
/modlogs user:@TargetUser
```

**What happens:**  
The bot queries the moderation history for `@TargetUser` in the current guild and returns a paginated embed listing all cases (newest first). Each entry shows action type, moderator, reason, and date.

**Embed:**
```
📋 Moderation History — @TargetUser
─────────────────────────────────────
Case #43   TIMEOUT    10m    by @Moderator   2 min ago
           Continued spamming after warning

Case #42   WARN              by @Moderator   5 min ago
           Spamming in #general

[← Prev]  Page 1 / 1  [Next →]

Total cases: 2  •  Chopsticks Moderation
```

---

## Tutorial 3 — Music Quickstart (3 Steps)

> **Goal:** Join a voice channel, play a song, and manage the queue.

---

### Step 1 — Join a Voice Channel & Play

**Command:**
```
/music play query:lofi hip hop chill beats
```

**What happens:**  
The bot checks that the user is in a voice channel, joins it, resolves the query via Lavalink, and begins playback. If Lavalink is unavailable, it replies with `ERR_LAVALINK_DOWN`. The now-playing embed is posted in the command channel with playback controls.

**Embed:**
```
🎵 Now Playing
────────────────────────────────────────────────
lofi hip hop radio - beats to relax/study to
ChilledCow · 2:43:21

Requested by   @YourUsername
Duration       ▶ 0:00 / 2:43:21
Queue          0 tracks remaining

[⏸ Pause]  [⏭ Skip]  [⏹ Stop]  [📋 Queue]

Volume: 80%  •  Chopsticks Music
```

---

### Step 2 — Add Songs to the Queue

**Command:**
```
/music play query:synthwave mix 2025
```

**What happens:**  
Since a session is already active, the track is added to the queue rather than playing immediately. The bot replies with a "Added to queue" confirmation and shows the position in queue.

**Embed:**
```
📋 Added to Queue
──────────────────
synthwave mix 2025 — RetroWave Radio
Position in queue: #1
Estimated time until play: ~2:43:21

[📋 View Queue]

Chopsticks Music
```

---

### Step 3 — Skip & View Queue

**Command:**
```
/music skip
```

**What happens:**  
The bot skips the current track and immediately starts the next one in queue. The now-playing embed updates in the original channel. If the queue is empty after the skip, the bot replies "Queue is empty" and optionally disconnects after an idle timeout.

**Embed (after skip):**
```
⏭ Skipped
──────────────────────────────────
Skipped: lofi hip hop radio - beats to relax/study to
Now playing: synthwave mix 2025 — RetroWave Radio

[⏸ Pause]  [⏭ Skip]  [⏹ Stop]  [📋 Queue]

Chopsticks Music
```

**To view the full queue:**
```
/music queue
```

**Embed:**
```
📋 Music Queue — {guildName}
─────────────────────────────
Now Playing
  synthwave mix 2025 — RetroWave Radio   requested by @YourUsername

Up Next
  (queue is empty)

Total runtime: unknown  •  Chopsticks Music
[⏭ Skip]  [⏹ Stop]
```
