// src/tools/voice/state.js
import { loadGuildData, saveGuildData } from "../../utils/storage.js";

/* ---------- LOCKS (PROCESS-LOCAL) ---------- */

const creationLocks = new Map();

function lockKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

export function acquireCreationLock(guildId, userId) {
  const key = lockKey(guildId, userId);
  if (creationLocks.has(key)) return false;
  creationLocks.set(key, true);
  return true;
}

export function releaseCreationLock(guildId, userId) {
  creationLocks.delete(lockKey(guildId, userId));
}

/* ---------- TEMP CHANNEL HELPERS ---------- */

export function registerTempChannel(guildId, channelId, ownerId, lobbyId) {
  const data = loadGuildData(guildId);
  data.voice.tempChannels[channelId] = {
    ownerId,
    lobbyId
  };
  saveGuildData(guildId, data);
}

export function removeTempChannel(guildId, channelId) {
  const data = loadGuildData(guildId);
  delete data.voice.tempChannels[channelId];
  saveGuildData(guildId, data);
}

export function findUserTempChannel(guildId, userId, lobbyId) {
  const data = loadGuildData(guildId);

  for (const [channelId, temp] of Object.entries(data.voice.tempChannels)) {
    if (
      temp.ownerId === userId &&
      temp.lobbyId === lobbyId
    ) {
      return channelId;
    }
  }

  return null;
}
