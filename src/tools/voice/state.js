// Voice state management - process memory + database sync

import { saveVoiceState } from "./schema.js";

const tempChannelCache = new Map(); // guildId -> Map<channelId, {ownerId, lobbyId, createdAt}>
const creationLocks = new Map(); // guildId -> Set<lockId>
const creationCooldowns = new Map(); // guildId -> Map<userId, timestamp>

function ensureCache(guildId, voice) {
  if (tempChannelCache.has(guildId)) return tempChannelCache.get(guildId);
  const cache = new Map();
  if (voice?.tempChannels && typeof voice.tempChannels === "object") {
    for (const [channelId, data] of Object.entries(voice.tempChannels)) {
      if (data?.ownerId && data?.lobbyId) cache.set(channelId, data);
    }
  }
  tempChannelCache.set(guildId, cache);
  return cache;
}

export function registerTempChannel(guildId, channelId, ownerId, lobbyId, voice) {
  const cache = ensureCache(guildId, voice);
  const data = { ownerId, lobbyId, createdAt: Date.now() };
  cache.set(channelId, data);

  voice.tempChannels[channelId] = data;
  return saveVoiceState(guildId, voice);
}

export function removeTempChannel(guildId, channelId, voice) {
  const cache = ensureCache(guildId, voice);
  cache.delete(channelId);
  delete voice.tempChannels[channelId];
  return saveVoiceState(guildId, voice);
}

export async function findUserTempChannel(guildId, userId, lobbyId, voice) {
  const channels = ensureCache(guildId, voice);

  for (const [channelId, data] of channels) {
    if (data.ownerId === userId && data.lobbyId === lobbyId) {
      return channelId;
    }
  }
  return null;
}

export function acquireCreationLock(guildId, lockId) {
  if (!creationLocks.has(guildId)) {
    creationLocks.set(guildId, new Set());
  }
  const locks = creationLocks.get(guildId);
  if (locks.has(lockId)) return false;
  locks.add(lockId);
  return true;
}

export function releaseCreationLock(guildId, lockId) {
  creationLocks.get(guildId)?.delete(lockId);
}

export function canCreateTempChannel(guildId, userId, cooldownMs) {
  if (cooldownMs <= 0) return true;
  
  if (!creationCooldowns.has(guildId)) {
    creationCooldowns.set(guildId, new Map());
  }
  const cooldowns = creationCooldowns.get(guildId);
  const lastCreated = cooldowns.get(userId);
  const now = Date.now();
  
  if (lastCreated && (now - lastCreated) < cooldownMs) {
    return false;
  }
  return true;
}

export function markTempChannelCreated(guildId, userId) {
  if (!creationCooldowns.has(guildId)) {
    creationCooldowns.set(guildId, new Map());
  }
  creationCooldowns.get(guildId).set(userId, Date.now());
}
