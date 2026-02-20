// test/unit/ai-command.test.js
// Tests for aiConfig helpers and /ai command metadata.
// Uses an injected fake pool — no real DB or Redis required.

import assert from "node:assert/strict";
import { describe, it, before, after } from "mocha";
import {
  _injectPool,
  _encryptToken,
  _decryptToken,
  getGuildAiConfig,
  setGuildAiProvider,
  setUserAiKey,
  getUserAiKey,
  clearUserAiKey,
  resolveAiKey,
} from "../../src/utils/aiConfig.js";
import { meta, data, execute } from "../../src/commands/ai.js";

// ── Fake pool ────────────────────────────────────────────────────────────────
// Simulates the specific SQL patterns used by aiConfig.js in-memory.

function makeMapPool() {
  const store = {}; // guildId → data JSONB object
  return {
    store,
    async query(sql, params) {
      const guildId = params[0];

      if (/SELECT data FROM guild_settings/.test(sql)) {
        const row = store[guildId] ?? null;
        return { rows: row != null ? [{ data: row }] : [] };
      }

      // patchAi — INSERT/ON CONFLICT for 'ai' namespace
      if (sql.includes("jsonb_build_object('ai',")) {
        const patchStr = params[1];
        const patch = typeof patchStr === "string" ? JSON.parse(patchStr) : patchStr;
        if (!store[guildId]) store[guildId] = {};
        store[guildId].ai = { ...(store[guildId].ai ?? {}), ...patch };
        return { rows: [] };
      }

      // setUserAiKey — INSERT with ai_tokens path
      if (sql.includes("ai_tokens") && sql.includes("INSERT INTO guild_settings")) {
        const [, userId, provider, encKey] = params;
        if (!store[guildId]) store[guildId] = {};
        if (!store[guildId].ai_tokens) store[guildId].ai_tokens = {};
        if (!store[guildId].ai_tokens[userId]) store[guildId].ai_tokens[userId] = {};
        store[guildId].ai_tokens[userId][provider] = encKey;
        return { rows: [] };
      }

      // clearUserAiKey — UPDATE with ai_tokens - provider
      if (sql.includes("ai_tokens") && sql.includes("UPDATE guild_settings")) {
        const [, userId, provider] = params;
        if (store[guildId]?.ai_tokens?.[userId]) {
          delete store[guildId].ai_tokens[userId][provider];
        }
        return { rows: [] };
      }

      return { rows: [] };
    },
  };
}

// ── 1. getGuildAiConfig defaults ──────────────────────────────────────────────

describe("aiConfig - getGuildAiConfig defaults", () => {
  before(() => _injectPool(makeMapPool()));
  after(() => _injectPool(null));

  it("returns defaults when guild is not configured", async () => {
    const cfg = await getGuildAiConfig("guild-no-config");
    assert.equal(cfg.provider, "none");
    assert.equal(cfg.ollamaUrl, null);
  });

  it("returns configured provider after set", async () => {
    const pool = makeMapPool();
    _injectPool(pool);
    pool.store["guild-x"] = { ai: { provider: "openai" } };
    const cfg = await getGuildAiConfig("guild-x");
    assert.equal(cfg.provider, "openai");
  });
});

// ── 2. setGuildAiProvider ─────────────────────────────────────────────────────

describe("aiConfig - setGuildAiProvider", () => {
  let pool;
  before(() => { pool = makeMapPool(); _injectPool(pool); });
  after(() => _injectPool(null));

  it("persists provider", async () => {
    await setGuildAiProvider("guild-sp", "anthropic");
    const cfg = await getGuildAiConfig("guild-sp");
    assert.equal(cfg.provider, "anthropic");
  });

  it("rejects invalid provider", async () => {
    await assert.rejects(
      () => setGuildAiProvider("guild-sp", "unknown-llm"),
      /invalid_provider/
    );
  });
});

// ── 3. setUserAiKey / getUserAiKey round-trip ─────────────────────────────────

describe("aiConfig - setUserAiKey / getUserAiKey round-trip", () => {
  before(() => _injectPool(makeMapPool()));
  after(() => _injectPool(null));

  it("stores and retrieves an API key (encrypted round-trip)", async () => {
    await setUserAiKey("guild-rt", "user1", "anthropic", "sk-ant-test-key-12345");
    const key = await getUserAiKey("guild-rt", "user1", "anthropic");
    assert.equal(key, "sk-ant-test-key-12345");
  });

  it("returns null for a provider with no key stored", async () => {
    const key = await getUserAiKey("guild-rt", "user1", "openai");
    assert.equal(key, null);
  });

  it("clearUserAiKey removes the stored key", async () => {
    await setUserAiKey("guild-rt", "user2", "openai", "sk-openai-test");
    await clearUserAiKey("guild-rt", "user2", "openai");
    const key = await getUserAiKey("guild-rt", "user2", "openai");
    assert.equal(key, null);
  });
});

// ── 4. resolveAiKey returns user key when present ────────────────────────────

describe("aiConfig - resolveAiKey user key priority", () => {
  let pool;
  before(() => { pool = makeMapPool(); _injectPool(pool); });
  after(() => _injectPool(null));

  it("returns user key when present", async () => {
    await setUserAiKey("guild-rk", "user1", "openai", "sk-test-openai-key");
    const r = await resolveAiKey("guild-rk", "user1");
    assert.equal(r.provider, "openai");
    assert.equal(r.apiKey, "sk-test-openai-key");
  });
});

// ── 5. resolveAiKey falls back to guild provider ─────────────────────────────

describe("aiConfig - resolveAiKey guild fallback", () => {
  let pool;
  before(() => { pool = makeMapPool(); _injectPool(pool); });
  after(() => _injectPool(null));

  it("falls back to guild provider when user has no key", async () => {
    await setGuildAiProvider("guild-fb", "anthropic");
    const r = await resolveAiKey("guild-fb", "user-no-key");
    assert.equal(r.provider, "anthropic");
    assert.equal(r.apiKey, null);
  });
});

// ── 6. resolveAiKey returns null when both absent ────────────────────────────

describe("aiConfig - resolveAiKey no config", () => {
  before(() => _injectPool(makeMapPool()));
  after(() => _injectPool(null));

  it("returns null provider when neither user key nor guild provider is set", async () => {
    const r = await resolveAiKey("guild-empty-xyz", "user-empty");
    assert.equal(r.provider, null);
    assert.equal(r.apiKey, null);
    assert.equal(r.ollamaUrl, null);
  });
});

// ── 7. /ai command metadata ───────────────────────────────────────────────────

describe("ai command - metadata", () => {
  it("meta.category is 'ai'", () => {
    assert.equal(meta.category, "ai");
  });

  it("data.name is 'ai'", () => {
    assert.equal(data.name, "ai");
  });

  it("has set-provider subcommand", () => {
    const json = data.toJSON();
    assert.ok(
      json.options.some(o => o.name === "set-provider"),
      "set-provider subcommand missing"
    );
  });

  it("has chat subcommand with required message option", () => {
    const json = data.toJSON();
    const chat = json.options.find(o => o.name === "chat");
    assert.ok(chat, "chat subcommand missing");
    const msg = (chat.options || []).find(o => o.name === "message");
    assert.ok(msg, "message option missing from chat");
    assert.equal(msg.required, true);
  });

  it("has token subcommand group with link and unlink", () => {
    const json = data.toJSON();
    const tokenGrp = json.options.find(o => o.name === "token");
    assert.ok(tokenGrp, "token subcommand group missing");
    const link   = (tokenGrp.options || []).find(o => o.name === "link");
    const unlink = (tokenGrp.options || []).find(o => o.name === "unlink");
    assert.ok(link,   "token link subcommand missing");
    assert.ok(unlink, "token unlink subcommand missing");
  });
});

// ── 8. /ai chat with provider=none returns setup message ─────────────────────

describe("ai command - /ai chat provider=none", () => {
  let pool;
  before(() => { pool = makeMapPool(); _injectPool(pool); });
  after(() => _injectPool(null));

  it("replies with setup message when no provider is configured", async () => {
    let repliedContent = null;

    const interaction = {
      inGuild: () => true,
      guildId:   "guild-chat-none",
      channelId: "channel1",
      user: { id: "user-chat-1" },
      memberPermissions: { has: () => false },
      options: {
        getSubcommandGroup: () => null,
        getSubcommand:      () => "chat",
        getString:  (name) => name === "message" ? "hello ai" : null,
        getBoolean: ()     => null,
      },
      reply: async ({ content }) => { repliedContent = content; },
      deferReply: async () => {},
      editReply:  async ({ content }) => { repliedContent = content; },
    };

    await execute(interaction);

    assert.ok(
      repliedContent?.includes("No AI provider configured"),
      `Expected setup message, got: ${repliedContent}`
    );
  });
});
