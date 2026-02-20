# /ai Command Family — Design Spec

> **Phase 6 — /ai Family Design**  
> Full design document for the `/ai` slash command group.

---

## 1. Command Surface

### `/ai chat [message]`
- **Description:** Send a message to the configured AI provider and receive a response.
- **Options:**
  - `message` (string, required) — The prompt to send. Max 2000 chars.
  - `public` (boolean, optional, default `false`) — If `true`, the response is posted publicly in channel. Default is ephemeral.
- **Behaviour:**
  - Resolves provider using priority chain (§4).
  - If provider is `none`, replies with the setup message (§3).
  - Maintains a 10-message rolling context per user per channel (§2).
  - Applies safety hooks before sending to LLM (§5).

### `/ai image [prompt]`
- **Description:** Generate an image from a text prompt.
- **Options:**
  - `prompt` (string, required) — Description of the image to generate. Max 1000 chars.
- **Behaviour:**
  - Requires the user to have a linked image-generation key (DALL-E or Stable Diffusion).
  - No free default; bot never calls image APIs without a user-supplied key.
  - If no key is linked, replies with setup message pointing to `/ai token link`.
  - Returns image as an embed attachment with the prompt as the description (accessibility).

### `/ai set-provider [provider]`
- **Description:** *(Admin only)* Set the guild-wide default AI provider.
- **Options:**
  - `provider` (string, required, choices: `none` | `ollama` | `anthropic` | `openai`) — The provider to set as default.
- **Permissions:** Requires `ManageGuild`.
- **Behaviour:**
  - Stores provider in `guild_settings.data.ai.provider`.
  - Does not touch per-user tokens.
  - Replies ephemerally with confirmation and a reminder that users can still override with their own keys.

### `/ai token link [provider]`
- **Description:** Link a personal API key for an AI provider.
- **Options:**
  - `provider` (string, required, choices: `anthropic` | `openai` | `stability`) — The provider to link a key for.
- **Behaviour:**
  - Opens an ephemeral modal (single TextInput) for the user to paste their key.
  - Validates key via a cheap test call (e.g. list-models endpoint).
  - Encrypts with AES-256-GCM (`AGENT_TOKEN_KEY`) and stores in `guild_settings.data.ai_tokens[user_id][provider]`.
  - Key is **never** logged, embedded, or returned to the user after submission.
  - Full flow documented in `token_link_flow.md`.

### `/ai token unlink [provider]`
- **Description:** Remove a previously linked API key.
- **Options:**
  - `provider` (string, required, choices: `anthropic` | `openai` | `stability`) — The provider to unlink.
- **Behaviour:**
  - Deletes the encrypted value from `guild_settings.data.ai_tokens[user_id][provider]`.
  - Replies ephemerally: `"✅ Your {provider} key has been removed."`

### `/ai help`
- **Description:** Show available AI features, current provider, and quick setup guide.
- **Behaviour:**
  - Reads guild provider setting and whether the calling user has any keys linked.
  - Returns an info embed (ephemeral) summarising current state and next steps.

---

## 2. Session Context

`/ai chat` maintains a **rolling 10-message context window** per (user, channel) pair.

- **Storage:** Redis, key pattern `ai:ctx:{guildId}:{channelId}:{userId}`.
- **TTL:** 30 minutes, refreshed on every message.
- **Structure:** JSON array of `{ role: "user"|"assistant", content: string }` objects, capped at 10 entries (oldest evicted when limit is exceeded).
- **Isolation:** Context is per-channel. The same user in two different channels has independent contexts.
- **DM context:** Only stored if the user has explicitly opted in (no DM context by default, per §5).
- **Clearing:** Users can reset context with `/ai chat message:!clear` or a future `/ai reset` command.

```js
// Pseudocode for context management
const CTX_KEY = `ai:ctx:${guildId}:${channelId}:${userId}`;
const CTX_TTL = 30 * 60; // 30 min in seconds
const MAX_MESSAGES = 10;

async function appendContext(redis, key, role, content) {
  const raw = await redis.get(key);
  const ctx = raw ? JSON.parse(raw) : [];
  ctx.push({ role, content });
  if (ctx.length > MAX_MESSAGES) ctx.splice(0, ctx.length - MAX_MESSAGES);
  await redis.setEx(key, CTX_TTL, JSON.stringify(ctx));
  return ctx;
}
```

---

## 3. Free Default (provider = none)

When no provider is configured and the user has no linked key, respond with:

```
No AI provider is configured for this server.

An admin can enable one with:
  /ai set-provider provider:anthropic   (or openai, ollama)

Or you can link your own personal key with:
  /ai token link provider:anthropic

Run /ai help for more information.
```

This message is always ephemeral.

---

## 4. Provider Priority

When resolving which provider (and key) to use for a request:

```
1. User's own linked key (guild_settings.data.ai_tokens[userId][provider])
   → Use the user's preferred provider and their own key.

2. Guild default provider (guild_settings.data.ai.provider)
   → Use the guild admin-configured provider and its key (if set).

3. none
   → Return the setup message (§3). Do not call any LLM API.
```

For `/ai image`, only the user's own key is ever used (never guild-wide image keys).

---

## 5. Safety Hooks

### Content moderation filter
- Applied to every user prompt **before** sending to LLM.
- **Tier 1 (always on):** Basic keyword blocklist covering CSAM, doxxing patterns, and self-harm instructions. Match → reject with `ERR_CONTENT_FILTERED` (ephemeral, no detail given to avoid filter bypass).
- **Tier 2 (optional):** If guild has `openai` configured and admin has enabled moderation API, route prompt through [OpenAI Moderation API](https://platform.openai.com/docs/api-reference/moderations) first. Flag on `hate`, `harassment`, `self-harm`, `sexual/minors`, `violence/graphic`.
- Flagged prompts are logged to the guild's mod log channel (action: `ai_content_filtered`) with user ID and a truncated/hashed prompt — **never the full prompt text in logs**.

### Rate limits
- **Per user:** 3 requests per 30 seconds.
- **Per guild:** 50 requests per day.
- Rate limit responses use the `ERR_RATE_LIMITED` embed template with `retry_after` value.
- Counters stored in Redis with appropriate TTLs.

### DM context opt-in
- `/ai chat` in DMs requires the user to have previously run `/ai help` and confirmed opt-in (one-time per user).
- No context is stored for DM sessions unless opted in.

### LLM response post-processing
- Strip any text that looks like an API key (regex: `/sk-[a-zA-Z0-9-]{20,}/g` → `[REDACTED]`).
- Truncate responses longer than 1800 chars to fit in a single embed field; append `"… [truncated]"`.

---

## 6. Slash Definitions (Copy-Pasteable)

```js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ai')
  .setDescription('AI-powered features')

  // /ai chat
  .addSubcommand(sub => sub
    .setName('chat')
    .setDescription('Send a message to the AI and get a response')
    .addStringOption(opt => opt
      .setName('message')
      .setDescription('Your message or question')
      .setRequired(true)
      .setMaxLength(2000)
    )
    .addBooleanOption(opt => opt
      .setName('public')
      .setDescription('Post the response publicly in the channel (default: only you see it)')
      .setRequired(false)
    )
  )

  // /ai image
  .addSubcommand(sub => sub
    .setName('image')
    .setDescription('Generate an image from a text prompt (requires your own API key)')
    .addStringOption(opt => opt
      .setName('prompt')
      .setDescription('Describe the image you want to generate')
      .setRequired(true)
      .setMaxLength(1000)
    )
  )

  // /ai set-provider
  .addSubcommand(sub => sub
    .setName('set-provider')
    .setDescription('(Admin) Set the guild-wide default AI provider')
    .addStringOption(opt => opt
      .setName('provider')
      .setDescription('AI provider to use by default for this server')
      .setRequired(true)
      .addChoices(
        { name: 'None (disable AI)', value: 'none' },
        { name: 'Ollama (self-hosted)', value: 'ollama' },
        { name: 'Anthropic (Claude)', value: 'anthropic' },
        { name: 'OpenAI (GPT)', value: 'openai' },
      )
    )
  )

  // /ai token link
  .addSubcommandGroup(group => group
    .setName('token')
    .setDescription('Manage your personal AI API keys')
    .addSubcommand(sub => sub
      .setName('link')
      .setDescription('Link a personal API key for an AI provider')
      .addStringOption(opt => opt
        .setName('provider')
        .setDescription('Which provider to link a key for')
        .setRequired(true)
        .addChoices(
          { name: 'Anthropic (Claude)', value: 'anthropic' },
          { name: 'OpenAI (GPT / DALL-E)', value: 'openai' },
          { name: 'Stability AI (image generation)', value: 'stability' },
        )
      )
    )
    .addSubcommand(sub => sub
      .setName('unlink')
      .setDescription('Remove a previously linked API key')
      .addStringOption(opt => opt
        .setName('provider')
        .setDescription('Which provider to remove')
        .setRequired(true)
        .addChoices(
          { name: 'Anthropic (Claude)', value: 'anthropic' },
          { name: 'OpenAI (GPT / DALL-E)', value: 'openai' },
          { name: 'Stability AI (image generation)', value: 'stability' },
        )
      )
    )
  )

  // /ai help
  .addSubcommand(sub => sub
    .setName('help')
    .setDescription('Show AI features, current provider, and how to set up')
  );
```

---

## 7. Implementation Notes

### Token encryption
- Same cipher as `src/utils/voiceConfig.js`: **AES-256-GCM**, IV length 16 bytes.
- Environment variable: `AGENT_TOKEN_KEY` (64-char hex string = 256-bit key).
- Encrypted format: `{iv_hex}:{ciphertext_hex}:{auth_tag_hex}` (3 colon-separated parts).
- If `AGENT_TOKEN_KEY` is missing or wrong length, log a warning and store unencrypted (graceful degradation matching existing voiceConfig behaviour).

### Storage location
- Per-user keys: `guild_settings.data.ai_tokens[userId][provider]` → encrypted string.
- Guild default provider: `guild_settings.data.ai.provider` → string enum.
- Schema is additive; no migration needed if `data` column is already `jsonb`.

### Reuse existing utilities
- `encryptToken` / `decryptToken` — extract from `voiceConfig.js` into a shared `src/utils/encryption.js` module so both voice and AI modules use the same functions.
- `getPool()` / retry pattern — reuse from `voiceConfig.js`.
- `checkRateLimit` — reuse from `src/utils/ratelimit.js`.
- `textLlm.js` — reuse for chat completions (already abstracts over providers); extend to accept `context` array for multi-turn conversations.
- `getRedisClient` / `setCache` / `getCache` — reuse from `src/utils/redis.js` for session context.
