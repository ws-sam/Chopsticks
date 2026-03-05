// src/tools/voice/domain.js
// AUTHORITATIVE VOICE DOMAIN — persistence-backed
// NO Discord.js calls

import {
  getVoiceState,
  saveVoiceState
} from "./schema.js";
import {
  applyOwnerPermissionPatch,
  coerceOwnerPermissions
} from "./ownerPerms.js";
import {
  ensurePanelConfig,
  PANEL_MODES
} from "./panel.js";

function normalizeTemplate(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "{user}'s room";
  return raw.slice(0, 90);
}

export async function addLobby(guildId, channelId, categoryId, template, opts = {}) {
  if (!guildId || !channelId || !categoryId) {
    return { ok: false, error: "invalid-ids" };
  }
  const voice = await getVoiceState(guildId);

  voice.lobbies ??= {};
  voice.tempChannels ??= {};

  if (voice.lobbies[channelId]) {
    return { ok: true, action: "exists", channelId };
  }

  voice.lobbies[channelId] = {
    channelId,
    categoryId,
    nameTemplate: normalizeTemplate(template),
    enabled: true,
    userLimit: Number.isFinite(opts.userLimit) ? Math.max(0, Math.trunc(opts.userLimit)) : 0,
    bitrateKbps: Number.isFinite(opts.bitrateKbps)
      ? Math.max(8, Math.min(512, Math.trunc(opts.bitrateKbps)))
      : null,
    maxChannels: Number.isInteger(opts.maxChannels) && opts.maxChannels > 0
      ? Math.trunc(opts.maxChannels)
      : null,
    ownerPermissions: coerceOwnerPermissions(opts.ownerPermissions)
  };

  await saveVoiceState(guildId, voice);
  return { ok: true, action: "add", channelId };
}

export async function removeLobby(guildId, channelId) {
  const voice = await getVoiceState(guildId);
  if (!voice.lobbies?.[channelId]) {
    return { ok: false, error: "lobby-not-found" };
  }
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

  if (typeof patch.template === "string") lobby.nameTemplate = normalizeTemplate(patch.template);
  if (Number.isFinite(patch.userLimit)) {
    lobby.userLimit = Math.max(0, Math.trunc(patch.userLimit));
  }
  if (patch.bitrateKbps === null) {
    lobby.bitrateKbps = null;
  } else if (Number.isFinite(patch.bitrateKbps)) {
    lobby.bitrateKbps = Math.max(8, Math.min(512, Math.trunc(patch.bitrateKbps)));
  }
  if (patch.maxChannels === null) {
    lobby.maxChannels = null;
  } else if (Number.isInteger(patch.maxChannels)) {
    if (patch.maxChannels < 1) {
      return { ok: false, error: "invalid-max-channels" };
    }
    lobby.maxChannels = Math.trunc(patch.maxChannels);
  }
  if (patch.ownerPermissions && typeof patch.ownerPermissions === "object") {
    lobby.ownerPermissions = applyOwnerPermissionPatch(lobby.ownerPermissions, patch.ownerPermissions);
  }

  await saveVoiceState(guildId, voice);
  return { ok: true, action: "update", channelId };
}

export async function transferTempOwnership(guildId, tempChannelId, ownerId) {
  if (!guildId || !tempChannelId || !ownerId) {
    return { ok: false, error: "invalid-ids" };
  }

  const voice = await getVoiceState(guildId);
  voice.tempChannels ??= {};
  const temp = voice.tempChannels[tempChannelId];
  if (!temp) return { ok: false, error: "temp-not-found" };
  if (temp.ownerId === ownerId) {
    return { ok: true, changed: false, ownerId };
  }

  temp.ownerId = ownerId;
  temp.updatedAt = Date.now();
  await saveVoiceState(guildId, voice);
  return { ok: true, changed: true, ownerId };
}

export async function setPanelGuildDefault(guildId, patch = {}) {
  const voice = await getVoiceState(guildId);
  ensurePanelConfig(voice);

  const next = { ...voice.panel.guildDefault };

  if (patch.mode !== undefined) {
    const mode = String(patch.mode || "").trim().toLowerCase();
    if (!PANEL_MODES.has(mode)) return { ok: false, error: "invalid-mode" };
    next.mode = mode;
  }
  if (patch.channelId !== undefined) {
    const channelId = String(patch.channelId || "").trim();
    next.channelId = channelId || null;
  }
  if (patch.autoSendOnCreate !== undefined) {
    if (typeof patch.autoSendOnCreate !== "boolean") return { ok: false, error: "invalid-auto-send" };
    next.autoSendOnCreate = patch.autoSendOnCreate;
  }

  voice.panel.guildDefault = next;
  await saveVoiceState(guildId, voice);
  return { ok: true, panel: voice.panel };
}

export async function setPanelUserDefault(guildId, userId, patch = {}) {
  if (!userId) return { ok: false, error: "invalid-user" };

  const voice = await getVoiceState(guildId);
  ensurePanelConfig(voice);

  const current = voice.panel.userDefaults[userId] || {};
  const next = { ...current };

  if (patch.mode !== undefined) {
    const mode = String(patch.mode || "").trim().toLowerCase();
    if (!PANEL_MODES.has(mode)) return { ok: false, error: "invalid-mode" };
    next.mode = mode;
  }
  if (patch.channelId !== undefined) {
    const channelId = String(patch.channelId || "").trim();
    next.channelId = channelId || null;
  }
  if (patch.autoSendOnCreate !== undefined) {
    if (typeof patch.autoSendOnCreate !== "boolean") return { ok: false, error: "invalid-auto-send" };
    next.autoSendOnCreate = patch.autoSendOnCreate;
  }

  voice.panel.userDefaults[userId] = next;
  await saveVoiceState(guildId, voice);
  return { ok: true, panel: voice.panel, userDefault: next };
}

export async function getStatus(guildId) {
  const voice = await getVoiceState(guildId);
  ensurePanelConfig(voice);
  return {
    lobbies: voice.lobbies ?? {},
    tempChannels: voice.tempChannels ?? {},
    panel: voice.panel
  };
}

export async function resetVoice(guildId) {
  await saveVoiceState(guildId, {
    lobbies: {},
    tempChannels: {}
  });
  return { ok: true, action: "reset" };
}

/**
 * Marks a temp or custom room as claimable (no owner required to take it).
 * When claimable, any member in the channel can use `/voice room_claim` without admin.
 */
export async function setRoomClaimable(guildId, channelId, claimable) {
  if (!guildId || !channelId) return { ok: false, error: "invalid-ids" };
  const voice = await getVoiceState(guildId);
  voice.tempChannels ??= {};

  const temp = voice.tempChannels[channelId];
  if (temp) {
    temp.claimable = claimable;
    if (claimable) temp.ownerId = null;
    temp.updatedAt = Date.now();
    await saveVoiceState(guildId, voice);
    return { ok: true, kind: "temp" };
  }

  voice.customRooms ??= {};
  const customRoom = Object.values(voice.customRooms).find(r => r.channelId === channelId);
  if (customRoom) {
    customRoom.claimable = claimable;
    if (claimable) customRoom.ownerId = null;
    customRoom.updatedAt = Date.now();
    await saveVoiceState(guildId, voice);
    return { ok: true, kind: "custom" };
  }

  return { ok: false, error: "room-not-found" };
}
