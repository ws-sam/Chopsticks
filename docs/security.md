# Chopsticks — Security

## Overview

Security in Chopsticks centres on three concerns:
1. **Agent token safety** — community-contributed Discord bot tokens must never leak
2. **Permission enforcement** — moderation and admin commands must be gated correctly
3. **Rate limiting** — prevent command abuse that could trigger Discord API bans

---

## Agent Token Security

This is the highest-risk surface in Chopsticks. A leaked agent token lets anyone control a community member's Discord bot account.

### Encryption

Tokens are encrypted with **AES-256-GCM** before storage.

The master key (`AGENT_TOKEN_KEY`) is a 32-byte hex value stored only in the server's environment. A per-pool derived key is generated using **HKDF-SHA256(master_key, pool_id)** — this means that compromising one pool's key does not expose keys for other pools.

```
Encryption:
  key = HKDF-SHA256(AGENT_TOKEN_KEY, poolId, "agent-token")
  iv  = crypto.randomBytes(12)
  {ciphertext, authTag} = aes-256-gcm encrypt(token, key, iv)
  stored = base64(iv + authTag + ciphertext)
```

### What Is Never Logged or Sent

- The raw token never appears in logs, Discord embeds, error messages, or API responses
- Only the masked form `BOT_***...***_xyz` (prefix + last 4 characters) is ever shown
- The AgentManager never echoes token values in WebSocket messages

### Revocation

Revocation is implemented as `UPDATE agent_tokens SET token = NULL WHERE id = ?`. The presence of a `status = 'revoked'` flag alone is never trusted — the runner checks for `token IS NOT NULL` before creating a client. This prevents partial-state attacks where a hacker writes to the status column without touching the encrypted token.

---

## Discord Permission Checks

### Hierarchy Safety

All moderation commands that target a user (ban, kick, mute, warn, timeout) check:
```
invoker.roles.highest.position > target.roles.highest.position
or
target.id === guild.ownerId → blocked
```

A moderator cannot take action against a user of equal or higher role. Action against the guild owner is always blocked.

### Command Guards

| Guard | Commands |
|---|---|
| `Manage Server` or `Administrator` | `/setup`, `/giveaway`, `/tickets`, `/automations`, `/custom`, `/config`, `/autorole`, `/reactionroles`, `/events` |
| `Manage Messages` or mod role | `/mod *`, `/purge`, `/lockdown`, `/slowmode`, `/modlogs` |
| Pool owner check | `/agents add_token`, `/pools create`, alliance management |
| Bot owner only | `/eval` (disabled in prod), internal diagnostics |

### Rate Limiting

Write-heavy operations are throttled per Discord user ID using Redis TTLs:
- `/daily` — 24-hour cooldown
- `/work` — 1-hour cooldown
- `/agents add_token` — 5 submissions per hour per user
- `/pools create` — 2 pools per day per user
- `/heist` — 2-hour cooldown

---

## Discord Bot Token (Main Bot)

The main `DISCORD_TOKEN` is stored only in the environment (`.env` / Docker secrets). It is never logged. The bot's gateway connection uses `discord.js` intents configured to the minimum required set.

---

## Dashboard OAuth2

The web dashboard uses Discord OAuth2 with the `identify guilds` scope. The session cookie is `httpOnly`, `secure`, `sameSite=strict`. Session IDs are random UUIDs stored server-side (not in the cookie itself).

---

## Known Surface Areas

| Surface | Risk | Mitigation |
|---|---|---|
| Agent token storage | Leaked DB → token exposure | AES-256-GCM encryption, revocation as NULL |
| Dashboard endpoint | XSS / CSRF | CSP headers, SameSite=strict cookies |
| Redis session cache | Poisoned cache | Redis is internal-only, no public exposure |
| LLM prompt injection (ai chat) | Prompt manipulation | System prompt sandboxing, output filtering |

---

## Reporting Vulnerabilities

Do not open a public GitHub issue for security bugs. Email security@wokspec.org or follow the process in [SECURITY.md](../../Chopsticks/SECURITY.md).
