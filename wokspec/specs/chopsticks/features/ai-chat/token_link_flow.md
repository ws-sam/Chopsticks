# /ai token link — Complete Flow Spec

> **Phase 6 — /ai Family Design**  
> End-to-end specification for linking (and rotating/unlinking) personal AI provider keys via ephemeral modal.

---

## Full Flow: Link a Key

### Step 1 — User runs the command

```
/ai token link provider:anthropic
```

The interaction is received by the bot. The subcommand is `token link`, provider is `anthropic`.

### Step 2 — Bot opens an ephemeral modal

The bot responds with a `Modal` (never a deferred reply first — modals must be the first response).

```js
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

const modal = new ModalBuilder()
  .setCustomId(`ai_token_link:anthropic:${interaction.user.id}`)
  .setTitle('Link Anthropic API Key');

const keyInput = new TextInputBuilder()
  .setCustomId('api_key')
  .setLabel('Paste your Anthropic API key')
  .setStyle(TextInputStyle.Short)
  .setPlaceholder('sk-ant-…')
  .setRequired(true)
  .setMinLength(20)
  .setMaxLength(200);

modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
await interaction.showModal(modal);
```

**The modal interaction is ephemeral by nature** — it only appears for the user who triggered it, is never logged in Discord's interaction history, and cannot be seen by other users or bots.

### Step 3 — User submits the modal

The bot receives a `ModalSubmitInteraction` with `customId` matching `ai_token_link:anthropic:{userId}`.

```js
const rawKey = interaction.fields.getTextInputValue('api_key').trim();
```

**Immediately defer ephemerally** to buy time for the validation call:

```js
await interaction.deferReply({ ephemeral: true });
```

### Step 4 — Bot validates the key

Perform a cheap, low-cost API call to verify the key is valid before storing it.

| Provider | Validation endpoint | Method | Expected success |
|----------|---------------------|--------|------------------|
| `anthropic` | `https://api.anthropic.com/v1/models` | GET | HTTP 200 |
| `openai` | `https://api.openai.com/v1/models` | GET | HTTP 200 |
| `stability` | `https://api.stability.ai/v1/user/account` | GET | HTTP 200 |

```js
async function validateProviderKey(provider, key) {
  const endpoints = {
    anthropic:  { url: 'https://api.anthropic.com/v1/models',          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } },
    openai:     { url: 'https://api.openai.com/v1/models',             headers: { 'Authorization': `Bearer ${key}` } },
    stability:  { url: 'https://api.stability.ai/v1/user/account',     headers: { 'Authorization': `Bearer ${key}` } },
  };
  const { url, headers } = endpoints[provider];
  const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(8000) });
  return res.ok;  // true if HTTP 2xx
}
```

**Key is not stored anywhere yet at this point.** The raw key only exists in the local variable `rawKey` for the duration of validation.

### Step 5a — Validation succeeds → encrypt and store

```js
const encrypted = encryptToken(rawKey);
// rawKey is no longer referenced after this line

// Update guild_settings.data.ai_tokens[userId][provider]
await upsertAiToken(interaction.guildId, interaction.user.id, provider, encrypted);

await interaction.editReply({
  content: '✅ Key linked. Your Anthropic key is now active for `/ai chat` and `/ai image`.',
  ephemeral: true,
});
```

The reply is ephemeral and contains **no part of the key**.

### Step 5b — Validation fails → reject, nothing stored

```js
// rawKey goes out of scope; encrypted is never created

await interaction.editReply({
  content: '❌ Key invalid or couldn\'t reach Anthropic. Try again.\n\nMake sure you copied the full key and that it has not been revoked.',
  ephemeral: true,
});
```

Nothing is written to the database. No error details that could expose the key are included in the reply.

### Step 6 — Key is stored

Storage pattern mirrors `voiceConfig.js`:

```js
async function upsertAiToken(guildId, userId, provider, encryptedKey) {
  const pool = getPool();
  await retry(() => pool.query(`
    INSERT INTO guild_settings (guild_id, data)
      VALUES ($1, jsonb_build_object('ai_tokens', jsonb_build_object($2, jsonb_build_object($3, $4))))
    ON CONFLICT (guild_id) DO UPDATE
      SET data = jsonb_set(
        jsonb_set(
          COALESCE(guild_settings.data, '{}'::jsonb),
          ARRAY['ai_tokens', $2],
          COALESCE(guild_settings.data->'ai_tokens'->$2, '{}'::jsonb),
          true
        ),
        ARRAY['ai_tokens', $2, $3],
        to_jsonb($4::text),
        true
      )
  `, [guildId, userId, provider, encryptedKey]), { retries: 2, minTimeout: 100 });
}
```

---

## Key Redaction Rules

The following rules are **absolute** — no exceptions:

1. **Interaction history:** The key is entered in a Modal TextInput which is not stored in Discord's interaction history (unlike slash command option values).
2. **Logs:** No logger call (e.g. `logger.info`, `logger.debug`) may include `rawKey` or any portion of it. If logging is needed, log only `{ provider, userId, action: 'token_link' }`.
3. **Embeds:** The confirmation reply contains the text `"✅ Key linked."` only. The key is never echoed back.
4. **Error messages:** Error replies contain provider name and a generic failure message. The key is never included, even partially, in error responses.
5. **Redaction in display contexts:** If any part of the system ever needs to display that a key is linked (e.g. in `/ai help`), show only a masked representation: `sk-ant-…****` (first 7 chars + mask). For openai: `sk-…****`. For stability: `sk-…****`.

**Implementation check:** Search for `rawKey` in any log/embed/reply call and treat that as a bug.

---

## Key Rotation

Users can overwrite an existing key by running `/ai token link [provider]` again. The flow is identical; `upsertAiToken` overwrites the existing encrypted value. The previous key is not recoverable after overwrite.

---

## Unlinking

```
/ai token unlink provider:anthropic
```

Flow:
1. Bot replies ephemerally immediately (no modal needed).
2. Deletes `guild_settings.data.ai_tokens[userId][provider]` from the database.
3. Reply: `"✅ Your Anthropic key has been removed. Run /ai token link to add a new one."`

```js
async function removeAiToken(guildId, userId, provider) {
  const pool = getPool();
  await retry(() => pool.query(`
    UPDATE guild_settings
      SET data = data #- ARRAY['ai_tokens', $2::text, $3::text]
    WHERE guild_id = $1
  `, [guildId, userId, provider]), { retries: 2, minTimeout: 100 });
}
```

---

## Security Summary

| Concern | Mitigation |
|---------|------------|
| Key visible in slash command history | Key entered via Modal, not as a slash option value |
| Key in Discord server logs / audit log | Ephemeral interaction; modal values not in audit log |
| Key in bot application logs | Never passed to any logger |
| Key in database plaintext | AES-256-GCM encrypted before INSERT |
| Key in error messages | Error replies use generic text only |
| Key in embed fields | Confirmation embed contains no key data |
| Key brute-forced via API | Validation fails fast; no timing oracle |
| AGENT_TOKEN_KEY missing | Warning logged; key stored unencrypted (fallback matching voiceConfig.js) — operators should treat this as a misconfiguration |
