// src/prefix/commands/voiceroom.js
// Prefix commands for managing your temporary voice channel (VoiceMaster)
// All commands require the caller to own a temp VC in the current guild.

import { PermissionsBitField } from "discord.js";
import { getVoiceState, saveVoiceState } from "../../tools/voice/schema.js";
import { getTempChannelRecord, transferTempChannelOwner } from "../../tools/voice/state.js";
import { ownerPermissionOverwrite } from "../../tools/voice/ownerPerms.js";
import { reply } from "../helpers.js";

// ── helpers ───────────────────────────────────────────────────────────────────

async function resolveOwnerRoom(message) {
  const guild = message.guild;
  if (!guild) return { error: "This command only works in a server." };

  const voice = await getVoiceState(guild.id);
  if (!voice?.tempChannels) return { error: "No voice rooms are active in this server." };

  // Find a temp channel owned by this user
  const entry = Object.entries(voice.tempChannels).find(
    ([, r]) => r.ownerId === message.author.id
  );
  if (!entry) {
    return { error: "You don't own a voice room. Join a lobby to create one." };
  }

  const [channelId, record] = entry;
  const channel = guild.channels.cache.get(channelId)
    ?? await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return { error: "Your voice room no longer exists." };

  return { voice, channel, record, channelId };
}

function mentionedUser(message, args) {
  // Accept @mention or plain user ID
  const mention = message.mentions.users.first();
  if (mention) return mention;
  const id = args[0]?.replace(/\D/g, "");
  if (id) return message.guild.members.cache.get(id)?.user ?? null;
  return null;
}

function err(message, text) {
  return reply(message, `> ${text}`);
}

function ok(message, text) {
  return reply(message, `> ${text}`);
}

// ── commands ──────────────────────────────────────────────────────────────────

export default [
  {
    name: "rename",
    aliases: ["rn", "name", "vcname"],
    category: "voice",
    description: "Rename your voice room — !rename <new name>",
    usage: "!rename <name>",
    rateLimit: 3000,
    async execute(message, args) {
      const name = args.join(" ").trim().slice(0, 90);
      if (!name) return err(message, "Usage: `!rename <new name>`");

      const res = await resolveOwnerRoom(message);
      if (res.error) return err(message, res.error);

      await res.channel.setName(name).catch(() => null);
      return ok(message, `Room renamed to **${name}**.`);
    }
  },

  {
    name: "lock",
    aliases: ["vc-lock", "closeroom", "close"],
    category: "voice",
    description: "Lock your voice room so no one else can join",
    rateLimit: 2000,
    async execute(message) {
      const res = await resolveOwnerRoom(message);
      if (res.error) return err(message, res.error);

      await res.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        { Connect: false }
      ).catch(() => null);
      return ok(message, "Voice room **locked**. No new members can join.");
    }
  },

  {
    name: "unlock",
    aliases: ["vc-unlock", "openroom", "open"],
    category: "voice",
    description: "Unlock your voice room so anyone can join",
    rateLimit: 2000,
    async execute(message) {
      const res = await resolveOwnerRoom(message);
      if (res.error) return err(message, res.error);

      await res.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        { Connect: null }
      ).catch(() => null);
      return ok(message, "Voice room **unlocked**. Anyone can join.");
    }
  },

  {
    name: "limit",
    aliases: ["ulimit", "maxusers", "setlimit", "cap"],
    category: "voice",
    description: "Set the user limit for your voice room — !limit <0-99> (0 = unlimited)",
    usage: "!limit <number>",
    rateLimit: 2000,
    async execute(message, args) {
      const n = parseInt(args[0], 10);
      if (isNaN(n) || n < 0 || n > 99) return err(message, "Usage: `!limit <0–99>` (0 = unlimited)");

      const res = await resolveOwnerRoom(message);
      if (res.error) return err(message, res.error);

      await res.channel.setUserLimit(n).catch(() => null);
      return ok(message, n === 0 ? "User limit **removed** (unlimited)." : `User limit set to **${n}**.`);
    }
  },

  {
    name: "permit",
    aliases: ["allow", "invite-vc", "adduser", "letjoin"],
    category: "voice",
    description: "Allow a specific user to join your locked room — !permit @user",
    usage: "!permit <@user>",
    rateLimit: 2000,
    async execute(message, args) {
      const user = mentionedUser(message, args);
      if (!user) return err(message, "Usage: `!permit @user`");

      const res = await resolveOwnerRoom(message);
      if (res.error) return err(message, res.error);

      await res.channel.permissionOverwrites.edit(user, { Connect: true }).catch(() => null);
      return ok(message, `**${user.displayName ?? user.username}** can now join your room.`);
    }
  },

  {
    name: "reject",
    aliases: ["deny", "ban-vc", "removeuser", "noentry"],
    category: "voice",
    description: "Block a specific user from joining your room — !reject @user",
    usage: "!reject <@user>",
    rateLimit: 2000,
    async execute(message, args) {
      const user = mentionedUser(message, args);
      if (!user) return err(message, "Usage: `!reject @user`");
      if (user.id === message.author.id) return err(message, "You cannot reject yourself.");

      const res = await resolveOwnerRoom(message);
      if (res.error) return err(message, res.error);

      await res.channel.permissionOverwrites.edit(user, { Connect: false }).catch(() => null);
      // If they're in the channel, move them out
      const member = message.guild.members.cache.get(user.id);
      if (member?.voice?.channelId === res.channelId) {
        await member.voice.disconnect().catch(() => null);
      }
      return ok(message, `**${user.displayName ?? user.username}** has been rejected from your room.`);
    }
  },

  {
    name: "kick-vc",
    aliases: ["vckick", "boot", "remove-vc"],
    category: "voice",
    description: "Disconnect a user from your voice room — !kick-vc @user",
    usage: "!kick-vc <@user>",
    rateLimit: 2000,
    async execute(message, args) {
      const user = mentionedUser(message, args);
      if (!user) return err(message, "Usage: `!kick-vc @user`");
      if (user.id === message.author.id) return err(message, "You cannot kick yourself.");

      const res = await resolveOwnerRoom(message);
      if (res.error) return err(message, res.error);

      const member = message.guild.members.cache.get(user.id);
      if (!member?.voice?.channelId || member.voice.channelId !== res.channelId) {
        return err(message, `**${user.displayName ?? user.username}** is not in your room.`);
      }
      await member.voice.disconnect().catch(() => null);
      return ok(message, `**${user.displayName ?? user.username}** has been removed from your room.`);
    }
  },

  {
    name: "hide",
    aliases: ["ghost", "invisible", "private"],
    category: "voice",
    description: "Hide your voice room from the channel list",
    rateLimit: 2000,
    async execute(message) {
      const res = await resolveOwnerRoom(message);
      if (res.error) return err(message, res.error);

      await res.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        { ViewChannel: false }
      ).catch(() => null);
      return ok(message, "Voice room **hidden** from the channel list.");
    }
  },

  {
    name: "unhide",
    aliases: ["show", "visible", "public"],
    category: "voice",
    description: "Make your voice room visible in the channel list",
    rateLimit: 2000,
    async execute(message) {
      const res = await resolveOwnerRoom(message);
      if (res.error) return err(message, res.error);

      await res.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        { ViewChannel: null }
      ).catch(() => null);
      return ok(message, "Voice room is now **visible** in the channel list.");
    }
  },

  {
    name: "bitrate",
    aliases: ["quality", "kbps", "vcquality"],
    category: "voice",
    description: "Set your room's audio bitrate in kbps — !bitrate <8-384>",
    usage: "!bitrate <kbps>",
    rateLimit: 3000,
    async execute(message, args) {
      const kbps = parseInt(args[0], 10);
      if (isNaN(kbps) || kbps < 8 || kbps > 384) {
        return err(message, "Usage: `!bitrate <8–384>` (kbps). Higher = better quality.");
      }

      const res = await resolveOwnerRoom(message);
      if (res.error) return err(message, res.error);

      const maxBitrate = message.guild.maximumBitrate ?? 96000;
      const bps = Math.min(kbps * 1000, maxBitrate);
      await res.channel.setBitrate(bps).catch(() => null);
      return ok(message, `Bitrate set to **${Math.floor(bps / 1000)} kbps**.`);
    }
  },

  {
    name: "transfer",
    aliases: ["handoff", "giveroom", "vcowner"],
    category: "voice",
    description: "Transfer ownership of your room to another member — !transfer @user",
    usage: "!transfer <@user>",
    rateLimit: 3000,
    async execute(message, args) {
      const user = mentionedUser(message, args);
      if (!user) return err(message, "Usage: `!transfer @user`");
      if (user.id === message.author.id) return err(message, "You already own this room.");
      if (user.bot) return err(message, "You cannot transfer ownership to a bot.");

      const res = await resolveOwnerRoom(message);
      if (res.error) return err(message, res.error);

      const { voice, channel, channelId } = res;
      const moved = await transferTempChannelOwner(
        message.guild.id, channelId, user.id, voice
      );
      if (!moved.ok) return err(message, "Transfer failed. Make sure the user is in your room.");

      // Grant owner perms to new owner, remove from old
      const lobby = voice.lobbies?.[res.record?.lobbyId];
      const overwrite = ownerPermissionOverwrite(lobby?.ownerPermissions);
      await channel.permissionOverwrites.edit(user, overwrite).catch(() => null);
      await channel.permissionOverwrites.delete(message.author.id).catch(() => null);

      return ok(message, `Ownership transferred to **${user.displayName ?? user.username}**.`);
    }
  },

  {
    name: "claim",
    aliases: ["takeover", "ownroom"],
    category: "voice",
    description: "Claim an ownerless room you are currently in",
    rateLimit: 3000,
    async execute(message) {
      const guild = message.guild;
      if (!guild) return err(message, "Server only.");

      const member = guild.members.cache.get(message.author.id);
      const vcId = member?.voice?.channelId;
      if (!vcId) return err(message, "You are not in a voice channel.");

      const voice = await getVoiceState(guild.id);
      if (!voice?.tempChannels?.[vcId]) {
        return err(message, "That is not a managed temp room.");
      }
      const record = getTempChannelRecord(guild.id, vcId, voice);
      if (!record) return err(message, "Room record not found.");

      // Only claimable if owner is NOT in the channel
      const channel = guild.channels.cache.get(vcId);
      if (!channel) return err(message, "Channel not found.");
      const ownerInChannel = channel.members.has(record.ownerId);
      if (ownerInChannel) return err(message, "The owner is still in the room. You can only claim after they leave.");
      if (record.ownerId === message.author.id) return err(message, "You already own this room.");

      const moved = await transferTempChannelOwner(guild.id, vcId, message.author.id, voice);
      if (!moved.ok) return err(message, "Claim failed.");

      const lobby = voice.lobbies?.[record.lobbyId];
      const overwrite = ownerPermissionOverwrite(lobby?.ownerPermissions);
      await channel.permissionOverwrites.edit(message.author.id, overwrite).catch(() => null);

      return ok(message, "You are now the owner of this room.");
    }
  },

  {
    name: "roominfo",
    aliases: ["vcinfo", "myroom", "roomstatus", "vcstatus"],
    category: "voice",
    description: "Show details about your current voice room",
    rateLimit: 3000,
    async execute(message) {
      const guild = message.guild;
      if (!guild) return err(message, "Server only.");

      const member = guild.members.cache.get(message.author.id);
      const vcId = member?.voice?.channelId
        ?? Object.entries((await getVoiceState(guild.id))?.tempChannels ?? {})
             .find(([, r]) => r.ownerId === message.author.id)?.[0];

      const voice = await getVoiceState(guild.id);
      if (!voice?.tempChannels?.[vcId]) {
        return err(message, "You don't have an active voice room.");
      }

      const record = getTempChannelRecord(guild.id, vcId, voice);
      const channel = guild.channels.cache.get(vcId)
        ?? await guild.channels.fetch(vcId).catch(() => null);
      if (!channel) return err(message, "Room not found.");

      const members = channel.members.filter(m => !m.user.bot);
      const ownerMember = guild.members.cache.get(record.ownerId);
      const locked = channel.permissionOverwrites.cache
        .get(guild.roles.everyone.id)?.deny?.has?.(PermissionsBitField.Flags.Connect) ?? false;
      const hidden = channel.permissionOverwrites.cache
        .get(guild.roles.everyone.id)?.deny?.has?.(PermissionsBitField.Flags.ViewChannel) ?? false;

      const lines = [
        `**Room:** ${channel.name}`,
        `**Owner:** ${ownerMember?.displayName ?? record.ownerId}`,
        `**Members:** ${members.size}${channel.userLimit ? `/${channel.userLimit}` : ""}`,
        `**Locked:** ${locked ? "Yes" : "No"}`,
        `**Hidden:** ${hidden ? "Yes" : "No"}`,
        `**Bitrate:** ${Math.floor(channel.bitrate / 1000)} kbps`,
      ];

      return reply(message, lines.join("\n"));
    }
  },

  {
    name: "vcreset",
    aliases: ["resetroom", "defaultroom"],
    category: "voice",
    description: "Reset your room to default settings (unlock, unhide, remove limit)",
    rateLimit: 5000,
    async execute(message) {
      const res = await resolveOwnerRoom(message);
      if (res.error) return err(message, res.error);

      const everyoneId = message.guild.roles.everyone.id;
      await res.channel.permissionOverwrites.edit(everyoneId, {
        Connect: null,
        ViewChannel: null,
      }).catch(() => null);
      await res.channel.setUserLimit(0).catch(() => null);

      return ok(message, "Room reset to defaults — unlocked, visible, no user limit.");
    }
  },
];
