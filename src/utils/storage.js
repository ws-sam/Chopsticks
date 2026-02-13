// src/utils/storage.js
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const SCHEMA_VERSION = 1;
const MAX_SAVE_RETRIES = 5;
const STORAGE_DRIVER = String(process.env.STORAGE_DRIVER || "file").toLowerCase();
const GUILD_CACHE_TTL_SEC = Math.max(
  0,
  Math.trunc(Number(process.env.GUILD_CACHE_TTL_SEC ?? 30))
);

let pgModule = null;
let cacheModule = null;

async function getPg() {
  if (!pgModule) {
    pgModule = await import("./storage_pg.js");
  }
  return pgModule;
}

async function getCache() {
  if (!cacheModule) cacheModule = await import("./cache.js");
  return cacheModule;
}

export async function ensureSchema() {
  if (STORAGE_DRIVER === "postgres") {
    const pg = await getPg();
    await pg.ensureSchema();
  }
  // No-op for file storage as files are created on demand
}



function guildFile(guildId) {
  return path.join(DATA_DIR, `${guildId}.json`);
}

function baseData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    rev: 0,
    voice: { lobbies: {}, tempChannels: {} },
    music: { defaultMode: "open", defaultVolume: 100, limits: {} }, // "open" | "dj"
    assistant: {
      enabled: false,
      maxListenSec: 10,
      silenceMs: 1200,
      cooldownSec: 8,
      allowRoleIds: [],
      allowChannelIds: [],
      maxSessions: 2,
      voice: null,
      voicePresets: [],
      channelVoices: {},
      profiles: {},
      channelProfiles: {},
      voicePersonalities: {},
      rotation: { enabled: false, intervalSec: 60, channelVoices: {} },
      wake: { required: true, word: "chopsticks" }
    },
    dashboard: { allowUserIds: [], allowRoleIds: [] },
    prefix: { value: "!", aliases: {} },
    commandPerms: {}, // commandName -> { roleIds: [] }
    commandSettings: { disabled: {}, categoriesDisabled: [] }, // disabled commands/categories
    moderation: { warnings: {} }, // userId -> [{ by, reason, at }]
    customCommands: {}, // name -> { response }
    macros: {}, // name -> [{ name, args }]
    commandLogs: [], // recent executions
    welcome: { enabled: false, channelId: null, message: "Welcome {user}!" },
    autorole: { enabled: false, roleId: null }
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function normalizeMusic(raw) {
  const m = isPlainObject(raw?.music) ? { ...raw.music } : {};
  const defaultMode = String(m.defaultMode ?? "open").toLowerCase();
  m.defaultMode = defaultMode === "dj" ? "dj" : "open";
  const v = Number(m.defaultVolume);
  if (Number.isFinite(v)) {
    m.defaultVolume = Math.min(150, Math.max(0, Math.trunc(v)));
  } else {
    m.defaultVolume = 100;
  }
  if (!isPlainObject(m.limits)) m.limits = {};
  return m;
}

function normalizeData(input) {
  const raw = isPlainObject(input) ? input : {};
  const out = { ...raw };

  const legacyLobbies = isPlainObject(raw.lobbies) ? raw.lobbies : null;
  const legacyTemp = isPlainObject(raw.tempChannels) ? raw.tempChannels : null;

  const voice = isPlainObject(raw.voice) ? { ...raw.voice } : {};
  if (!isPlainObject(voice.lobbies) && legacyLobbies) voice.lobbies = legacyLobbies;
  if (!isPlainObject(voice.tempChannels) && legacyTemp) voice.tempChannels = legacyTemp;

  if (!isPlainObject(voice.lobbies)) voice.lobbies = {};
  if (!isPlainObject(voice.tempChannels)) voice.tempChannels = {};

  out.voice = voice;
  out.music = normalizeMusic(raw);
  if (!isPlainObject(out.dashboard)) out.dashboard = {};
  if (!Array.isArray(out.dashboard.allowUserIds)) out.dashboard.allowUserIds = [];
  if (!Array.isArray(out.dashboard.allowRoleIds)) out.dashboard.allowRoleIds = [];
  if (!isPlainObject(out.prefix)) out.prefix = {};
  if (typeof out.prefix.value !== "string" || !out.prefix.value.trim()) out.prefix.value = "!";
  if (!isPlainObject(out.prefix.aliases)) out.prefix.aliases = {};
  if (!isPlainObject(out.commandSettings)) out.commandSettings = {};
  if (!isPlainObject(out.commandSettings.disabled)) out.commandSettings.disabled = {};
  if (!Array.isArray(out.commandSettings.categoriesDisabled)) out.commandSettings.categoriesDisabled = [];
  if (!isPlainObject(out.customCommands)) out.customCommands = {};
  if (!isPlainObject(out.macros)) out.macros = {};
  if (!Array.isArray(out.commandLogs)) out.commandLogs = [];
  if (!isPlainObject(out.commandPerms)) out.commandPerms = {};
  if (!isPlainObject(out.moderation)) out.moderation = {};
  if (!isPlainObject(out.moderation.warnings)) out.moderation.warnings = {};
  if (!isPlainObject(out.welcome)) out.welcome = {};
  if (typeof out.welcome.enabled !== "boolean") out.welcome.enabled = false;
  if (typeof out.welcome.channelId !== "string") out.welcome.channelId = null;
  if (typeof out.welcome.message !== "string") out.welcome.message = "Welcome {user}!";
  if (!isPlainObject(out.autorole)) out.autorole = {};
  if (typeof out.autorole.enabled !== "boolean") out.autorole.enabled = false;
  if (typeof out.autorole.roleId !== "string") out.autorole.roleId = null;

  if (!isPlainObject(out.assistant)) out.assistant = {};
  if (typeof out.assistant.enabled !== "boolean") out.assistant.enabled = false;
  const maxListenSec = Number(out.assistant.maxListenSec);
  out.assistant.maxListenSec = Number.isFinite(maxListenSec)
    ? Math.min(30, Math.max(2, Math.trunc(maxListenSec)))
    : 10;
  const silenceMs = Number(out.assistant.silenceMs);
  out.assistant.silenceMs = Number.isFinite(silenceMs)
    ? Math.min(5000, Math.max(500, Math.trunc(silenceMs)))
    : 1200;
  const cooldownSec = Number(out.assistant.cooldownSec);
  out.assistant.cooldownSec = Number.isFinite(cooldownSec)
    ? Math.min(120, Math.max(0, Math.trunc(cooldownSec)))
    : 8;
  if (!Array.isArray(out.assistant.allowRoleIds)) out.assistant.allowRoleIds = [];
  if (!Array.isArray(out.assistant.allowChannelIds)) out.assistant.allowChannelIds = [];
  const maxSessions = Number(out.assistant.maxSessions);
  out.assistant.maxSessions = Number.isFinite(maxSessions)
    ? Math.min(10, Math.max(1, Math.trunc(maxSessions)))
    : 2;
  if (typeof out.assistant.voice !== "string") out.assistant.voice = null;
  if (!Array.isArray(out.assistant.voicePresets)) out.assistant.voicePresets = [];
  if (!isPlainObject(out.assistant.channelVoices)) out.assistant.channelVoices = {};
  if (!isPlainObject(out.assistant.profiles)) out.assistant.profiles = {};
  if (!isPlainObject(out.assistant.channelProfiles)) out.assistant.channelProfiles = {};
  if (!isPlainObject(out.assistant.voicePersonalities)) out.assistant.voicePersonalities = {};
  if (!isPlainObject(out.assistant.rotation)) out.assistant.rotation = {};
  if (typeof out.assistant.rotation.enabled !== "boolean") out.assistant.rotation.enabled = false;
  const rInt = Number(out.assistant.rotation.intervalSec);
  out.assistant.rotation.intervalSec = Number.isFinite(rInt)
    ? Math.min(3600, Math.max(5, Math.trunc(rInt)))
    : 60;
  if (!isPlainObject(out.assistant.rotation.channelVoices)) out.assistant.rotation.channelVoices = {};
  if (!isPlainObject(out.assistant.wake)) out.assistant.wake = {};
  if (typeof out.assistant.wake.required !== "boolean") out.assistant.wake.required = true;
  if (typeof out.assistant.wake.word !== "string") out.assistant.wake.word = "chopsticks";

  out.schemaVersion = Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : SCHEMA_VERSION;
  out.rev = Number.isInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 0;

  if ("lobbies" in out) delete out.lobbies;
  if ("tempChannels" in out) delete out.tempChannels;

  return out;
}

export function normalizeGuildData(input) {
  return normalizeData(input);
}

export function mergeGuildData(latest, incoming) {
  return mergeOnConflict(latest, incoming);
}

function detectNeedsMigration(raw, normalized) {
  if (!isPlainObject(raw)) return true;
  if (!Number.isInteger(raw.schemaVersion)) return true;
  if (!Number.isInteger(raw.rev)) return true;

  if (!isPlainObject(raw.voice)) return true;
  if (!isPlainObject(raw.voice.lobbies)) return true;
  if (!isPlainObject(raw.voice.tempChannels)) return true;

  // music is now part of schema
  if (!isPlainObject(raw.music)) return true;

  if ("lobbies" in raw || "tempChannels" in raw) return true;

  if (normalized.schemaVersion !== raw.schemaVersion) return true;
  if (normalized.rev !== raw.rev) return true;

  // normalize could have corrected music fields
  if (normalized.music?.defaultMode !== raw.music?.defaultMode) return true;

  return false;
}

function readFileIfValid(file) {
  if (!fs.existsSync(file)) return { data: null, needsWrite: true };

  try {
    const rawText = fs.readFileSync(file, "utf8");
    const raw = JSON.parse(rawText);
    const normalized = normalizeData(raw);
    const needsWrite = detectNeedsMigration(raw, normalized);
    return { data: normalized, needsWrite };
  } catch {
    return { data: null, needsWrite: true };
  }
}

function readGuildDataWithFallback(file) {
  const primary = readFileIfValid(file);
  if (primary.data) return primary;

  const bak = `${file}.bak`;
  const fallback = readFileIfValid(bak);
  if (fallback.data) return { data: fallback.data, needsWrite: true };

  return { data: baseData(), needsWrite: true };
}

function uniqueTmpPath(file) {
  const rand = crypto.randomBytes(8).toString("hex");
  return `${file}.tmp.${process.pid}.${rand}`;
}

function writeAtomicJson(file, data) {
  const tmp = uniqueTmpPath(file);
  const bak = `${file}.bak`;
  const json = JSON.stringify(data, null, 2);

  fs.writeFileSync(tmp, json, "utf8");
  try {
    const fd = fs.openSync(tmp, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {}

  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, bak);
    } catch {}
  }

  fs.renameSync(tmp, file);
}

function mergeOnConflict(latest, incoming) {
  const a = normalizeData(latest);
  const b = normalizeData(incoming);

  const mergedVoice = {
    ...a.voice,
    ...b.voice,
    lobbies: { ...a.voice.lobbies, ...b.voice.lobbies },
    tempChannels: { ...a.voice.tempChannels, ...b.voice.tempChannels }
  };

  const mergedMusic = {
    ...a.music,
    ...b.music
  };

  return {
    ...a,
    ...b,
    voice: mergedVoice,
    music: mergedMusic,
    schemaVersion: SCHEMA_VERSION
  };
}

export async function loadGuildData(guildId) {
  if (STORAGE_DRIVER === "postgres") {
    const fallback = () => baseData();
    try {
      if (GUILD_CACHE_TTL_SEC > 0) {
        const cache = await getCache();
        const cached = await cache.cacheGet(`guild:${guildId}`);
        if (cached) return normalizeData(cached);
      }
      const pg = await getPg();
      const data = await pg.loadGuildDataPg(guildId, fallback);
      const normalized = normalizeData(data);
      if (GUILD_CACHE_TTL_SEC > 0) {
        const cache = await getCache();
        await cache.cacheSet(`guild:${guildId}`, normalized, GUILD_CACHE_TTL_SEC);
      }
      return normalized;
    } catch {
      return baseData();
    }
  }
  ensureDir();
  const file = guildFile(guildId);
  const { data } = readGuildDataWithFallback(file);
  return data ?? baseData();
}

export async function ensureGuildData(guildId) {
  if (STORAGE_DRIVER === "postgres") {
    const fallback = () => baseData();
    try {
      if (GUILD_CACHE_TTL_SEC > 0) {
        const cache = await getCache();
        const cached = await cache.cacheGet(`guild:${guildId}`);
        if (cached) return normalizeData(cached);
      }
      const pg = await getPg();
      const data = await pg.loadGuildDataPg(guildId, fallback);
      const normalized = normalizeData(data);
      if (GUILD_CACHE_TTL_SEC > 0) {
        const cache = await getCache();
        await cache.cacheSet(`guild:${guildId}`, normalized, GUILD_CACHE_TTL_SEC);
      }
      return normalized;
    } catch {
      return baseData();
    }
  }
  ensureDir();
  const file = guildFile(guildId);
  const { data, needsWrite } = readGuildDataWithFallback(file);
  if (needsWrite) {
    try {
      await saveGuildData(guildId, data);
    } catch {}
  }
  return data;
}

export async function saveGuildData(guildId, data) {
  if (STORAGE_DRIVER === "postgres") {
    try {
      const pg = await getPg();
      const saved = await pg.saveGuildDataPg(guildId, data, normalizeData, mergeOnConflict);
      if (GUILD_CACHE_TTL_SEC > 0) {
        const cache = await getCache();
        await cache.cacheSet(`guild:${guildId}`, normalizeData(saved), GUILD_CACHE_TTL_SEC);
      }
      return saved;
    } catch {
      throw new Error("save-failed");
    }
  }
  ensureDir();
  const file = guildFile(guildId);

  let next = normalizeData(data);

  for (let attempt = 0; attempt < MAX_SAVE_RETRIES; attempt += 1) {
    const current = readGuildDataWithFallback(file).data ?? baseData();
    const expectedRev = Number.isInteger(next.rev) ? next.rev : current.rev;

    if (current.rev !== expectedRev) {
      next = mergeOnConflict(current, next);
      next.rev = current.rev;
      continue;
    }

    const toWrite = {
      ...next,
      schemaVersion: SCHEMA_VERSION,
      rev: current.rev + 1
    };

    writeAtomicJson(file, toWrite);
    return toWrite;
  }

  throw new Error("save-conflict");
}

export async function insertAgentBot(agentId, token, clientId, tag, poolId) {
  const pg = await getPg();
  return pg.insertAgentBot(agentId, token, clientId, tag, poolId);
}

export async function fetchAgentBots() {
  const pg = await getPg();
  return pg.fetchAgentBots();
}

export async function updateAgentBotStatus(agentId, status) {
  const pg = await getPg();
  return pg.updateAgentBotStatus(agentId, status);
}

export async function deleteAgentBot(agentId) {
  const pg = await getPg();
  return pg.deleteAgentBot(agentId);
}

export async function updateAgentBotProfile(agentId, profile) {
  const pg = await getPg();
  return pg.updateAgentBotProfile(agentId, profile);
}

export async function fetchAgentBotProfile(agentId) {
  const pg = await getPg();
  return pg.fetchAgentBotProfile(agentId);
}

export async function upsertAgentRunner(runnerId, lastSeen, meta) {
  const pg = await getPg();
  return pg.upsertAgentRunner(runnerId, lastSeen, meta);
}

export async function fetchAgentRunners() {
  const pg = await getPg();
  return pg.fetchAgentRunners();
}

export async function deleteAgentRunner(runnerId) {
  const pg = await getPg();
  return pg.deleteAgentRunner(runnerId);
}

// Pool management exports
export async function createPool(poolId, ownerUserId, name, visibility) {
  const pg = await getPg();
  return pg.createPool(poolId, ownerUserId, name, visibility);
}

export async function fetchPool(poolId) {
  const pg = await getPg();
  return pg.fetchPool(poolId);
}

export async function listPools() {
  const pg = await getPg();
  return pg.listPools();
}

export async function fetchPoolsByOwner(ownerUserId) {
  const pg = await getPg();
  return pg.fetchPoolsByOwner(ownerUserId);
}

export async function updatePool(poolId, updates) {
  const pg = await getPg();
  return pg.updatePool(poolId, updates);
}

export async function deletePool(poolId) {
  const pg = await getPg();
  return pg.deletePool(poolId);
}

export async function fetchPoolAgents(poolId) {
  const pg = await getPg();
  return pg.fetchPoolAgents(poolId);
}

export async function getGuildSelectedPool(guildId) {
  const pg = await getPg();
  return pg.getGuildSelectedPool(guildId);
}

export async function setGuildSelectedPool(guildId, poolId) {
  const pg = await getPg();
  return pg.setGuildSelectedPool(guildId, poolId);
}

