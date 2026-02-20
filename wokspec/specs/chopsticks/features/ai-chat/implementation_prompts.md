# /ai — Sequential Implementation Prompts for Code Agent

> **Phase 6 — /ai Family Design**  
> Four sequential prompts to be executed in order. Each prompt is self-contained and can be handed directly to the Code Agent.

---

## Prompt 1 — Create `src/commands/ai.js` with stub execute

**PR title:** `feat(ai): add /ai command family with stub handlers`  
**Branch:** `feat/ai-command-stubs`

### Preconditions
- `discord.js` is installed (already true).
- `src/commands/` directory exists with other command files as reference.
- No existing `src/commands/ai.js`.

### Files to create
- **`src/commands/ai.js`** — full slash command definition (`data`) and stub `execute` function.

### Files to modify
- None at this stage. Do not touch any existing files.

### What to implement

Create `src/commands/ai.js` with:

1. `export const meta` following the existing pattern (see `ban.js`, `music.js`):
   ```js
   export const meta = { guildOnly: true, userPerms: [], category: 'ai' };
   ```

2. `export const data` — complete `SlashCommandBuilder` definition with all subcommands and subcommand groups exactly as specified in `wokspec/specs/chopsticks/features/ai-chat/design.md` §6 (copy-paste the definition from that file).

3. `export async function execute(interaction)` — a dispatcher that reads `interaction.options.getSubcommandGroup()` and `interaction.options.getSubcommand()` and routes to stub handlers. Each stub replies ephemerally with: `"⚙️ {subcommand} — not yet implemented."`.

   ```js
   export async function execute(interaction) {
     const group = interaction.options.getSubcommandGroup(false);
     const sub   = interaction.options.getSubcommand();
     const key   = group ? `${group}/${sub}` : sub;
     await interaction.reply({ content: `⚙️ /ai ${key} — not yet implemented.`, ephemeral: true });
   }
   ```

### Test vectors (from `test_vectors.json`)
- Vectors 1, 2, 3, 4, 7, 8 — command reaches execute without throwing; stub reply is returned.

### Acceptance checklist
- [ ] `src/commands/ai.js` exists and exports `meta`, `data`, `execute`.
- [ ] `data.name === 'ai'`.
- [ ] All 7 subcommands/subcommand-group leaves are present in `data` (chat, image, set-provider, token/link, token/unlink, help).
- [ ] `execute` runs without error for each subcommand permutation.
- [ ] No other files modified.
- [ ] Bot registers the command without error (`node src/deploy-commands.js` or equivalent).

---

## Prompt 2 — Implement `/ai token link/unlink` with modal + AES-256-GCM storage

**PR title:** `feat(ai): implement /ai token link and unlink with encrypted key storage`  
**Branch:** `feat/ai-token-link`

### Preconditions
- Prompt 1 merged: `src/commands/ai.js` exists with stubs.
- `src/utils/voiceConfig.js` exists with `encryptToken`/`decryptToken` functions.
- `AGENT_TOKEN_KEY` env var documented in `.env.example`.

### Files to create
- **`src/utils/aiConfig.js`** — AI-specific config module. Mirrors `voiceConfig.js` pattern. Exports:
  - `encryptToken(text)` / `decryptToken(text)` — extracted to a shared `src/utils/encryption.js` (see below), re-exported here for backward compat.
  - `getGuildAiProvider(guildId)` → `{ provider: string }`.
  - `upsertAiToken(guildId, userId, provider, encryptedKey)` — stores encrypted key.
  - `resolveUserAiKey(guildId, userId, provider)` → decrypted key string or `null`.
  - `removeAiToken(guildId, userId, provider)` — deletes the token.

- **`src/utils/encryption.js`** — shared AES-256-GCM helpers (`encryptToken`, `decryptToken`) extracted from `voiceConfig.js`. Re-export from `voiceConfig.js` to avoid breaking existing callers.

### Files to modify
- **`src/commands/ai.js`** — replace `token/link` and `token/unlink` stub handlers with real implementations following the spec in `wokspec/specs/chopsticks/features/ai-chat/token_link_flow.md`.
  - `token/link`: `showModal` → handle submit → validate → `upsertAiToken` or error reply.
  - `token/unlink`: ephemeral reply → `removeAiToken`.
- **`src/utils/voiceConfig.js`** — import `encryptToken`/`decryptToken` from the new `encryption.js` instead of defining them locally (no functional change, just DRY).

### Implementation details
- Modal custom ID pattern: `ai_token_link:{provider}:{userId}` — handle in `interactionCreate` event or the command file's modal submit handler, whichever pattern is already used in the codebase.
- Validation endpoint calls as specified in `token_link_flow.md` §Step 4.
- Key redaction rules from `token_link_flow.md` §Key Redaction Rules must all be satisfied.

### Test vectors (from `test_vectors.json`)
- **Vector 9:** valid key → stored encrypted, reply contains "✅ Key linked.", raw key not in reply.
- **Vector 10:** invalid key → `key_stored: false`, reply contains "Key invalid".

### Acceptance checklist
- [ ] `src/utils/encryption.js` created; `voiceConfig.js` imports from it without regression.
- [ ] `src/utils/aiConfig.js` created with all five exported functions.
- [ ] `/ai token link anthropic` opens a modal (verified manually or via interaction test).
- [ ] On valid key: `guild_settings.data.ai_tokens[userId].anthropic` contains a 3-part colon-separated encrypted string.
- [ ] On invalid key: database row unchanged; reply does not contain the key.
- [ ] `rawKey` does not appear in any logger call, embed, or reply string.
- [ ] `/ai token unlink anthropic` removes the stored value.
- [ ] Existing voice config tests (if any) still pass.

---

## Prompt 3 — Implement `/ai chat` with Redis session context + `textLlm.js` integration

**PR title:** `feat(ai): implement /ai chat with multi-turn context and provider routing`  
**Branch:** `feat/ai-chat`

### Preconditions
- Prompt 2 merged: `aiConfig.js` exists, token link/unlink works.
- `src/utils/redis.js` exists with `getRedisClient`, `setCache`, `getCache`.
- `src/utils/textLlm.js` exists with `generateText`.
- `src/utils/ratelimit.js` exists with `checkRateLimit`.

### Files to create
- **`src/utils/aiContext.js`** — manages Redis-backed rolling context. Exports:
  - `appendAndGetContext(redis, guildId, channelId, userId, role, content)` → `Array<{role, content}>` (capped at 10, TTL 30 min).
  - `clearContext(redis, guildId, channelId, userId)` → void.
  - `CTX_KEY(guildId, channelId, userId)` → Redis key string.

### Files to modify
- **`src/commands/ai.js`** — replace `chat` stub with real handler:
  1. Check `!clear` shortcut: if message is `!clear`, call `clearContext` and reply "🗑 Context cleared.".
  2. Resolve provider priority: user key → guild default → none (using `aiConfig.js`).
  3. If provider is `none`, return setup message (§3 of design.md).
  4. Check per-user rate limit (3/30s) via `checkRateLimit`; return `ERR_RATE_LIMITED` if exceeded.
  5. Apply content moderation filter (Tier 1 keyword check).
  6. Load existing context from Redis via `aiContext.js`.
  7. Call `textLlm.js` `generateText` (extend its signature to accept `context` array for multi-turn if not already supported; check existing implementation first).
  8. Append user message + assistant response to context.
  9. Reply ephemerally (default) or publicly (if `public: true`).

- **`src/utils/textLlm.js`** — if needed, add `context` parameter support for multi-turn conversations. Only modify if the current implementation does not already accept a message history array. Keep changes minimal.

### Test vectors (from `test_vectors.json`)
- **Vector 1:** provider=none → setup message, `llm_called: false`.
- **Vector 2:** valid key → LLM called, response returned, context stored.
- **Vector 3:** invalid/expired key → `ERR_LLM_UNAVAILABLE`, key not exposed.
- **Vector 4:** rate limit hit → `ERR_RATE_LIMITED`.
- **Vector 5:** 3-message sequence → correct context passed to LLM on each call.

### Acceptance checklist
- [ ] `src/utils/aiContext.js` created; exports `appendAndGetContext` and `clearContext`.
- [ ] `/ai chat message:"Hello"` with provider=none returns setup message.
- [ ] `/ai chat message:"Hello"` with valid linked key returns LLM response.
- [ ] After 3 messages, Redis key `ai:ctx:{guildId}:{channelId}:{userId}` contains 6 entries (3 user + 3 assistant).
- [ ] Context TTL is 1800 seconds (30 min).
- [ ] Fourth request within 30 s returns rate-limit reply; LLM is not called.
- [ ] `public: true` sends a non-ephemeral reply.
- [ ] `message: "!clear"` clears context and returns confirmation.

---

## Prompt 4 — Add safety hooks (content filter, rate limits, moderation logging)

**PR title:** `feat(ai): add content safety filter, guild rate limits, and mod logging for /ai chat`  
**Branch:** `feat/ai-safety-hooks`

### Preconditions
- Prompt 3 merged: `/ai chat` works end-to-end.
- `src/utils/modLogs.js` exists with `dispatchModerationLog` (or equivalent log dispatch function).
- `src/utils/ratelimit.js` or `src/utils/modernRateLimiter.js` handles per-user rate limiting; verify the function signature before use.

### Files to create
- **`src/utils/aiModeration.js`** — safety filtering module. Exports:
  - `checkContentFilter(prompt)` → `{ blocked: boolean, reason: string | null }`.  
    Tier 1: simple keyword blocklist (maintain list in this file as a const array). Returns `blocked: true` with `reason: 'keyword_match'` on hit. List initially covers CSAM indicators, doxxing patterns, self-harm instructions — seed list is defined in this file; keep it minimal and maintainable.
  - `logFilteredRequest(guildId, userId, reason)` → void. Logs to mod log channel via `dispatchModerationLog` with action `'ai_content_filtered'`, no prompt text, no raw error.
  - `applyResponseSanitization(text)` → string. Strips anything matching `/sk-[a-zA-Z0-9\-]{20,}/g` → `[REDACTED]`; truncates at 1800 chars with `"… [truncated]"`.

### Files to modify
- **`src/commands/ai.js`** — integrate the safety pipeline in the `chat` handler:
  1. Run `checkContentFilter(prompt)` before the provider check; if blocked, call `logFilteredRequest` and return `ERR_CONTENT_FILTERED` reply.
  2. Apply per-guild daily rate limit (50/day) in addition to the per-user 3/30s limit (already added in Prompt 3). Use Redis key `ai:guild_daily:{guildId}:{date}` with 24h TTL.
  3. Wrap LLM response with `applyResponseSanitization` before sending.
  4. Add `/ai set-provider` and `/ai help` handler implementations now that the full context module is in place.

### Test vectors (from `test_vectors.json`)
- **Vector 6:** blocked prompt → `llm_called: false`, mod log created, full prompt not in log, `ERR_CONTENT_FILTERED` reply.
- **Vector 4:** (re-verify) per-user rate limit still works after guild rate limit is added.

### Acceptance checklist
- [ ] `src/utils/aiModeration.js` created with `checkContentFilter`, `logFilteredRequest`, `applyResponseSanitization`.
- [ ] Blocked prompts never reach the LLM; `llm_called: false` in test vector 6.
- [ ] Mod log entry created on blocked prompt; entry contains `userId` but not the prompt text.
- [ ] LLM responses are sanitized: any `sk-…` patterns replaced with `[REDACTED]`.
- [ ] Responses longer than 1800 chars are truncated with `"… [truncated]"`.
- [ ] Per-guild daily limit (50/day) enforced; 51st request returns `ERR_RATE_LIMITED`.
- [ ] `/ai set-provider` requires `ManageGuild`; others without it receive `ERR_NO_PERMS`.
- [ ] `/ai help` returns current provider state and linked-key status (masked) for the calling user.
- [ ] All 10 test vectors from `test_vectors.json` pass (either automated or manually verified).
