// src/utils/aiConfig.js
// Per-guild and per-user AI config CRUD with AES-256-GCM encryption for API keys.

import crypto from "node:crypto";
import retry from "async-retry";
import { getPool } from "./storage_pg.js";
import { logger } from "./logger.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

export const AI_PROVIDERS = ["none", "ollama", "anthropic", "openai", "groq"];

const KEY = process.env.AGENT_TOKEN_KEY;
const KEY_READY = KEY && KEY.length === 64;
if (!KEY_READY) {
  logger.warn("aiConfig: AGENT_TOKEN_KEY missing or invalid — API keys stored unencrypted");
}

export function _encryptToken(text) {
  if (!KEY_READY) return text;
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(KEY, "hex"), iv);
    let enc = cipher.update(text, "utf8", "hex");
    enc += cipher.final("hex");
    return `${iv.toString("hex")}:${enc}:${cipher.getAuthTag().toString("hex")}`;
  } catch (err) {
    logger.error("aiConfig encrypt failed", { error: err?.message });
    throw new Error("encrypt_failed");
  }
}

export function _decryptToken(text) {
  if (!KEY_READY) return text;
  if (!text || typeof text !== "string") return null;
  const parts = text.split(":");
  if (parts.length !== 3) return text; // unencrypted legacy value
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(KEY, "hex"), Buffer.from(parts[0], "hex"));
    decipher.setAuthTag(Buffer.from(parts[2], "hex"));
    let dec = decipher.update(parts[1], "hex", "utf8");
    dec += decipher.final("utf8");
    return dec;
  } catch {
    logger.warn("aiConfig decrypt failed — token needs re-linking");
    return null;
  }
}

// Dependency injection for testing — never call outside of test code.
let _testPool = null;
export function _injectPool(p) { _testPool = p; }
function activePool() { return _testPool ?? getPool(); }

// ── Read ────────────────────────────────────────────────────────────────────

export async function getGuildAiConfig(guildId) {
  const pool = activePool();
  const res = await retry(() => pool.query(
    "SELECT data FROM guild_settings WHERE guild_id = $1",
    [guildId]
  ), { retries: 2, minTimeout: 100 });

  const ai = res.rows[0]?.data?.ai || {};
  return {
    provider: AI_PROVIDERS.includes(ai.provider) ? ai.provider : "none",
    ollamaUrl: ai.ollama_url || null,
    persona:   ai.persona   || null,
  };
}

// ── Write ───────────────────────────────────────────────────────────────────

async function patchAi(guildId, patch) {
  const pool = activePool();
  const patchJson = JSON.stringify(patch);
  await retry(() => pool.query(`
    INSERT INTO guild_settings (guild_id, data, rev)
    VALUES ($1, jsonb_build_object('ai', $2::jsonb), 1)
    ON CONFLICT (guild_id) DO UPDATE SET
      data = guild_settings.data || jsonb_build_object(
        'ai', COALESCE(guild_settings.data->'ai', '{}'::jsonb) || $2::jsonb
      ),
      rev = guild_settings.rev + 1,
      updated_at = NOW()
  `, [guildId, patchJson]), { retries: 2, minTimeout: 100 });
}

export async function setGuildAiProvider(guildId, provider) {
  if (!AI_PROVIDERS.includes(provider)) throw new Error(`invalid_provider:${provider}`);
  await patchAi(guildId, { provider });
}

export async function setGuildAiPersona(guildId, persona) {
  await patchAi(guildId, { persona });
}

export async function clearGuildAiPersona(guildId) {
  await patchAi(guildId, { persona: null });
}

// ── User tokens ─────────────────────────────────────────────────────────────

export async function setUserAiKey(guildId, userId, provider, rawKey) {
  const encrypted = _encryptToken(rawKey);
  const pool = activePool();
  await retry(() => pool.query(`
    INSERT INTO guild_settings (guild_id, data, rev)
    VALUES ($1, jsonb_build_object('ai_tokens', jsonb_build_object($2::text, jsonb_build_object($3::text, $4::text))), 1)
    ON CONFLICT (guild_id) DO UPDATE SET
      data = jsonb_set(
        guild_settings.data,
        ARRAY['ai_tokens', $2::text],
        COALESCE(guild_settings.data->'ai_tokens'->$2::text, '{}'::jsonb) || jsonb_build_object($3::text, $4::text)
      ),
      rev = guild_settings.rev + 1,
      updated_at = NOW()
  `, [guildId, userId, provider, encrypted]), { retries: 2, minTimeout: 100 });
}

export async function getUserAiKey(guildId, userId, provider) {
  const pool = activePool();
  const res = await retry(() => pool.query(
    "SELECT data FROM guild_settings WHERE guild_id = $1",
    [guildId]
  ), { retries: 2, minTimeout: 100 });

  const enc = res.rows[0]?.data?.ai_tokens?.[userId]?.[provider];
  if (!enc) return null;
  return _decryptToken(enc);
}

export async function clearUserAiKey(guildId, userId, provider) {
  const pool = activePool();
  await retry(() => pool.query(`
    UPDATE guild_settings SET
      data = jsonb_set(
        data,
        ARRAY['ai_tokens', $2::text],
        COALESCE(data->'ai_tokens'->$2::text, '{}'::jsonb) - $3::text
      ),
      rev = rev + 1,
      updated_at = NOW()
    WHERE guild_id = $1
  `, [guildId, userId, provider]), { retries: 2, minTimeout: 100 });
}

export async function resolveAiKey(guildId, userId) {
  const pool = activePool();
  const res = await retry(() => pool.query(
    "SELECT data FROM guild_settings WHERE guild_id = $1",
    [guildId]
  ), { retries: 2, minTimeout: 100 });

  const data = res.rows[0]?.data ?? {};
  const tokens = data.ai_tokens?.[userId] ?? {};

  // User key takes priority — check each provider in preference order
  for (const p of ["anthropic", "openai", "ollama"]) {
    if (tokens[p]) {
      const value = _decryptToken(tokens[p]);
      if (value) {
        if (p === "ollama") return { provider: "ollama", apiKey: null, ollamaUrl: value };
        return { provider: p, apiKey: value, ollamaUrl: null };
      }
    }
  }

  // Fall back to guild default provider
  const ai = data.ai ?? {};
  const guildProvider = AI_PROVIDERS.includes(ai.provider) ? ai.provider : "none";
  if (guildProvider !== "none") {
    return { provider: guildProvider, apiKey: null, ollamaUrl: ai.ollama_url || null };
  }

  return { provider: null, apiKey: null, ollamaUrl: null };
}
