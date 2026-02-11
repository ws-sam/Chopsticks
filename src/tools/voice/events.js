// Voice channel join-to-create event handler
import { Events } from "discord.js";
import * as VoiceDomain from "./domain.js";
import * as VoiceState from "./state.js";

export const name = Events.VoiceStateUpdate;

export async function execute(oldState, newState) {
  const guild = newState.guild;
  if (!guild) return;

  const oldChannel = oldState.channel;
  const newChannel = newState.channel;
  const member = newState.member;

  // User joined a channel
  if (!oldChannel && newChannel) {
    await handleJoin(guild, member, newChannel);
  }

  // User left a channel
  if (oldChannel && !newChannel) {
    await handleLeave(guild, oldChannel);
  }

  // User moved channels
  if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
    await handleJoin(guild, member, newChannel);
    await handleLeave(guild, oldChannel);
  }
}

async function handleJoin(guild, member, channel) {
  const lobbies = await VoiceDomain.getStatus(guild.id);
  const lobby = lobbies.lobbies?.[channel.id];

  if (!lobby || !lobby.enabled) return;

  // User joined a lobby - create temp channel
  try {
    const category = await guild.channels.fetch(lobby.categoryId);
    if (!category) return;

    const channelName = (lobby.nameTemplate || "{user}'s room").replace('{user}', member.displayName);

    const tempChannel = await guild.channels.create({
      name: channelName,
      type: 2, // Voice channel
      parent: lobby.categoryId,
      userLimit: lobby.userLimit || 0,
      bitrate: lobby.bitrateKbps ? lobby.bitrateKbps * 1000 : undefined
    });

    // Move user to temp channel
    await member.voice.setChannel(tempChannel);

    // Track temp channel
    VoiceState.trackTempChannel(guild.id, tempChannel.id, member.id);

    console.log(`[Voice] Created temp channel ${tempChannel.id} for ${member.displayName}`);
  } catch (err) {
    console.error(`[Voice] Failed to create temp channel:`, err);
  }
}

async function handleLeave(guild, channel) {
  // Check if empty temp channel
  const tempChannels = VoiceState.getTempChannels(guild.id);
  if (!tempChannels.includes(channel.id)) return;

  if (channel.members.size === 0) {
    try {
      await channel.delete();
      VoiceState.removeTempChannel(guild.id, channel.id);
      console.log(`[Voice] Deleted empty temp channel ${channel.id}`);
    } catch (err) {
      console.error(`[Voice] Failed to delete temp channel:`, err);
    }
  }
}
