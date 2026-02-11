// src/music/config.js
import { loadGuildData, saveGuildData } from "../utils/storage.js";

function normalizeProviders(value) {
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean);
  }
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  return raw.split(",").map(v => v.trim()).filter(Boolean);
}

function normalizeControlMode(value) {
  const v = String(value ?? "").toLowerCase();
  return v === "voice" ? "voice" : "owner";
}

export async function getMusicConfig(guildId) {
  const data = await loadGuildData(guildId);
  const envMode = String(process.env.MUSIC_DEFAULT_MODE ?? "").toLowerCase();
  const mode =
    envMode === "dj" || envMode === "open"
      ? envMode
      : (String(data?.music?.defaultMode ?? "open").toLowerCase() === "dj" ? "dj" : "open");
  const envVol = Number(process.env.MUSIC_DEFAULT_VOLUME);
  const v = Number.isFinite(envVol) ? envVol : Number(data?.music?.defaultVolume ?? 100);
  const defaultVolume = Number.isFinite(v) ? Math.min(150, Math.max(0, Math.trunc(v))) : 100;
  const limits = data?.music?.limits ?? {};
  const maxQueue = Number(process.env.MUSIC_MAX_QUEUE ?? limits.maxQueue ?? 100);
  const maxTrackMinutes = Number(process.env.MUSIC_MAX_TRACK_MINUTES ?? limits.maxTrackMinutes ?? 20);
  const maxQueueMinutes = Number(process.env.MUSIC_MAX_QUEUE_MINUTES ?? limits.maxQueueMinutes ?? 120);
  const controlRaw =
    process.env.MUSIC_CONTROL_MODE ??
    data?.music?.controlMode ??
    (String(process.env.MUSIC_CONTROL_LOCKED ?? "true") === "true" ? "owner" : "voice");
  const searchProviders = normalizeProviders(data?.music?.searchProviders ?? process.env.MUSIC_SEARCH_PROVIDERS);
  const fallbackProviders = normalizeProviders(
    data?.music?.fallbackProviders ?? process.env.MUSIC_FALLBACK_PROVIDERS ?? "scsearch"
  );
  return {
    defaultMode: mode,
    defaultVolume,
    controlMode: normalizeControlMode(controlRaw),
    searchProviders,
    fallbackProviders,
    limits: {
      maxQueue: Number.isFinite(maxQueue) ? Math.max(1, Math.trunc(maxQueue)) : 100,
      maxTrackMinutes: Number.isFinite(maxTrackMinutes) ? Math.max(1, Math.trunc(maxTrackMinutes)) : 20,
      maxQueueMinutes: Number.isFinite(maxQueueMinutes) ? Math.max(1, Math.trunc(maxQueueMinutes)) : 120
    }
  };
}

export async function setDefaultMusicMode(guildId, mode) {
  const m = String(mode ?? "").toLowerCase() === "dj" ? "dj" : "open";
  const data = await loadGuildData(guildId);
  data.music ??= {};
  data.music.defaultMode = m;
  await saveGuildData(guildId, data);
  return { ok: true, defaultMode: m };
}

export async function setDefaultMusicVolume(guildId, volume) {
  const v = Number(volume);
  if (!Number.isFinite(v)) return { ok: false, error: "bad-volume" };
  const clamped = Math.min(150, Math.max(0, Math.trunc(v)));
  const data = await loadGuildData(guildId);
  data.music ??= {};
  data.music.defaultVolume = clamped;
  await saveGuildData(guildId, data);
  return { ok: true, defaultVolume: clamped };
}

export async function updateMusicSettings(guildId, patch = {}) {
  const data = await loadGuildData(guildId);
  data.music ??= {};
  data.music.limits ??= {};

  if (patch.defaultMode) {
    data.music.defaultMode = String(patch.defaultMode).toLowerCase() === "dj" ? "dj" : "open";
  }
  if (Number.isFinite(patch.defaultVolume)) {
    data.music.defaultVolume = Math.min(150, Math.max(0, Math.trunc(patch.defaultVolume)));
  }
  if (patch.controlMode) {
    data.music.controlMode = normalizeControlMode(patch.controlMode);
  }
  if (patch.searchProviders) {
    data.music.searchProviders = normalizeProviders(patch.searchProviders);
  }
  if (patch.fallbackProviders) {
    data.music.fallbackProviders = normalizeProviders(patch.fallbackProviders);
  }
  if (patch.limits) {
    if (Number.isFinite(patch.limits.maxQueue)) data.music.limits.maxQueue = Math.max(1, Math.trunc(patch.limits.maxQueue));
    if (Number.isFinite(patch.limits.maxTrackMinutes)) data.music.limits.maxTrackMinutes = Math.max(1, Math.trunc(patch.limits.maxTrackMinutes));
    if (Number.isFinite(patch.limits.maxQueueMinutes)) data.music.limits.maxQueueMinutes = Math.max(1, Math.trunc(patch.limits.maxQueueMinutes));
  }

  await saveGuildData(guildId, data);
  return getMusicConfig(guildId);
}
