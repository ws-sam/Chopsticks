// src/tools/voice/domain.js
// AUTHORITATIVE VOICE DOMAIN — persistence-backed
// NO Discord.js calls

import {
  getVoiceState,
  saveVoiceState
} from "./schema.js";

export async function addLobby(guildId, channelId, categoryId, template, opts = {}) {
  const voice = await getVoiceState(guildId);

  voice.lobbies ??= {};
  voice.tempChannels ??= {};

  if (voice.lobbies[channelId]) {
    return { ok: true, action: "exists", channelId };
  }

  voice.lobbies[channelId] = {
    channelId,
    categoryId,
    nameTemplate: template,
    enabled: true,
    userLimit: Number.isFinite(opts.userLimit) ? Math.max(0, Math.trunc(opts.userLimit)) : 0,
    bitrateKbps: Number.isFinite(opts.bitrateKbps)
      ? Math.max(8, Math.min(512, Math.trunc(opts.bitrateKbps)))
      : null
  };

  await saveVoiceState(guildId, voice);
  return { ok: true, action: "add", channelId };
}

export async function removeLobby(guildId, channelId) {
  const voice = await getVoiceState(guildId);
  delete voice.lobbies?.[channelId];
  await saveVoiceState(guildId, voice);
  return { ok: true, action: "remove", channelId };
}

export async function setLobbyEnabled(guildId, channelId, enabled) {
  const voice = await getVoiceState(guildId);
  if (!voice.lobbies?.[channelId]) {
    return { ok: false, error: "lobby-not-found" };
  }

  voice.lobbies[channelId].enabled = enabled;
  await saveVoiceState(guildId, voice);
  return { ok: true, action: enabled ? "enable" : "disable", channelId };
}

export async function updateLobby(guildId, channelId, patch = {}) {
  const voice = await getVoiceState(guildId);
  const lobby = voice.lobbies?.[channelId];
  if (!lobby) return { ok: false, error: "lobby-not-found" };

  if (typeof patch.template === "string") lobby.nameTemplate = patch.template;
  if (Number.isFinite(patch.userLimit)) {
    lobby.userLimit = Math.max(0, Math.trunc(patch.userLimit));
  }
  if (patch.bitrateKbps === null) {
    lobby.bitrateKbps = null;
  } else if (Number.isFinite(patch.bitrateKbps)) {
    lobby.bitrateKbps = Math.max(8, Math.min(512, Math.trunc(patch.bitrateKbps)));
  }

  await saveVoiceState(guildId, voice);
  return { ok: true, action: "update", channelId };
}

export async function getStatus(guildId) {
  const voice = await getVoiceState(guildId);
  return {
    lobbies: voice.lobbies ?? {},
    tempChannels: voice.tempChannels ?? {}
  };
}

export async function resetVoice(guildId) {
  await saveVoiceState(guildId, {
    lobbies: {},
    tempChannels: {}
  });
  return { ok: true, action: "reset" };
}
