// src/tools/voice/controller.js
import { loadGuildData, saveGuildData } from "../../utils/storage.js";

export const addLobby = async (guildId, lobbyChannelId, categoryId) => {
  const data = loadGuildData(guildId);

  if (data.lobbies[lobbyChannelId]) {
    return false; // already exists
  }

  data.lobbies[lobbyChannelId] = { categoryId };
  saveGuildData(guildId, data);
  return true;
};

export const removeLobby = async (guildId, lobbyChannelId) => {
  const data = loadGuildData(guildId);

  if (!data.lobbies[lobbyChannelId]) {
    return false;
  }

  delete data.lobbies[lobbyChannelId];
  saveGuildData(guildId, data);
  return true;
};

export const resetVoice = async (guildId) => {
  saveGuildData(guildId, {
    lobbies: {},
    tempChannels: {}
  });
};

export const getStatus = async (guildId) => {
  return loadGuildData(guildId);
};
