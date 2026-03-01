// src/tools/voice/limits.js
import { loadGuildData, saveGuildData } from "../../utils/storage.js";

function ensureVoiceState(data) {
  data.voice ??= {};
  data.voice.lobbies ??= {};
  data.voice.tempChannels ??= {};
}

/* ---------- GET ---------- */

export async function getLobbyLimits(guildId, channelId) {
  const data = await loadGuildData(guildId);
  ensureVoiceState(data);

  const lobby = data.voice.lobbies[channelId];
  if (!lobby) return { ok: false };

  return {
    ok: true,
    limits: {
      maxChannels: lobby.maxChannels ?? null,
      cleanupMode: lobby.cleanupMode ?? "wait-until-empty",
      validateCategory: lobby.validateCategory ?? true
    }
  };
}

/* ---------- SET ---------- */

export async function setLobbyLimits(guildId, channelId, options) {
  const data = await loadGuildData(guildId);
  ensureVoiceState(data);

  const lobby = data.voice.lobbies[channelId];
  if (!lobby) return { ok: false, reason: "missing" };

  let changed = false;

  if ("maxChannels" in options) {
    if (
      options.maxChannels !== null &&
      (!Number.isInteger(options.maxChannels) || options.maxChannels < 1)
    ) {
      return { ok: false, reason: "invalid-max-channels" };
    }
    lobby.maxChannels = options.maxChannels;
    changed = true;
  }

  if ("cleanupMode" in options) {
    if (!["immediate", "wait-until-empty"].includes(options.cleanupMode)) {
      return { ok: false, reason: "invalid-cleanup-mode" };
    }
    lobby.cleanupMode = options.cleanupMode;
    changed = true;
  }

  if ("validateCategory" in options) {
    if (typeof options.validateCategory !== "boolean") {
      return { ok: false, reason: "invalid-validate-category" };
    }
    lobby.validateCategory = options.validateCategory;
    changed = true;
  }

  if (!changed) return { ok: true, noop: true };

  await saveGuildData(guildId, data);
  return { ok: true };
}
