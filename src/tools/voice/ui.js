import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder
} from "discord.js";

import * as VoiceDomain from "./domain.js";
import { getVoiceState } from "./schema.js";
import { execute as musicExecute } from "../../commands/music.js";
import { execute as gameExecute } from "../../commands/game.js";
import {
  buildVoiceRoomDashboardComponents,
  buildVoiceRoomDashboardEmbed,
  deliverVoiceRoomDashboard,
  resolvePanelDelivery
} from "./panel.js";
import { ownerPermissionOverwrite } from "./ownerPerms.js";
import { auditLog } from "../../utils/audit.js";
import { removeTempChannel } from "./state.js";
import { getCustomRoom } from "./customVcsState.js";
import { botLogger } from "../../utils/modernLogger.js";

const UI_PREFIX = "voiceui";
const ROOM_PANEL_PREFIX = "voiceroom";
const ROOM_MODAL_PREFIX = "voiceroommodal";
const ROOM_PANEL_TTL_MS = 6 * 60 * 60 * 1000;

const MODE_LABELS = {
  temp: "Room voice chat",
  dm: "Direct message",
  channel: "Configured text channel",
  here: "Where command was run",
  both: "DM + room/channel",
  off: "Off"
};

const roomPanelRegistry = new Map();

function hasAdmin(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  );
}

function buildEmbed(title, description) {
  return new EmbedBuilder().setTitle(title).setDescription(description ?? "");
}

function buildErrorEmbed(message) {
  return buildEmbed("Voice error", message);
}

function trimText(value, max = 1024) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function getLockedState(channel, everyoneRoleId) {
  const overwrite = everyoneRoleId ? channel.permissionOverwrites.cache.get(everyoneRoleId) : null;
  return Boolean(overwrite?.deny?.has(PermissionFlagsBits.Connect));
}

function buildModeOptions(currentMode, { includeHere }) {
  const modes = includeHere
    ? ["temp", "dm", "channel", "here", "both", "off"]
    : ["temp", "dm", "channel", "both", "off"];
  return modes.map(mode => ({
    label: MODE_LABELS[mode] ?? mode,
    value: mode,
    description: `Deliver panel via ${mode}`,
    default: currentMode === mode
  }));
}

function makeCustomId(kind, userId, channelId) {
  return `${UI_PREFIX}:${kind}:${userId}:${channelId}`;
}

function parseCustomId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length < 4 || parts[0] !== UI_PREFIX) return null;
  return {
    kind: parts[1],
    userId: parts[2],
    channelId: parts[3]
  };
}

function makeRoomPanelCustomId(kind, roomChannelId) {
  return `${ROOM_PANEL_PREFIX}:${kind}:${roomChannelId}`;
}

function makeRoomModalCustomId(kind, guildId, roomChannelId) {
  return `${ROOM_MODAL_PREFIX}:${kind}:${guildId}:${roomChannelId}`;
}

function parseRoomModalCustomId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== ROOM_MODAL_PREFIX) return null;
  return { kind: parts[1], guildId: parts[2], roomChannelId: parts[3] };
}

function parseRoomPanelCustomId(customId) {
  const parts = String(customId || "").split(":");
  if (parts[0] !== ROOM_PANEL_PREFIX) return null;
  if (parts.length === 3) {
    return {
      kind: parts[1],
      guildId: null,
      roomChannelId: parts[2],
      userId: null
    };
  }
  if (parts.length === 4) {
    return {
      kind: parts[1],
      guildId: parts[2],
      roomChannelId: parts[3],
      userId: null
    };
  }
  if (parts.length === 5) {
    return {
      kind: parts[1],
      guildId: parts[2],
      roomChannelId: parts[3],
      userId: parts[4]
    };
  }
  return null;
}

function clampInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

function safeRoomName(value, fallback = "room") {
  const s = String(value ?? "").trim().replace(/\s+/g, " ");
  return (s || fallback).slice(0, 90);
}

function roomPanelKey(guildId, roomChannelId) {
  return `${guildId}:${roomChannelId}`;
}

function roomPanelRefKey(channelId, messageId) {
  return `${channelId}:${messageId}`;
}

function pruneRoomPanelRegistry() {
  const now = Date.now();
  for (const [key, refs] of roomPanelRegistry.entries()) {
    for (const [refKey, ref] of refs.entries()) {
      if ((now - (ref.updatedAt || 0)) > ROOM_PANEL_TTL_MS) {
        refs.delete(refKey);
      }
    }
    if (!refs.size) roomPanelRegistry.delete(key);
  }
}

setInterval(() => {
  pruneRoomPanelRegistry();
}, 10 * 60 * 1000).unref?.();

export function registerRoomPanelRef({ guildId, roomChannelId, textChannelId, messageId }) {
  const key = roomPanelKey(guildId, roomChannelId);
  const refKey = roomPanelRefKey(textChannelId, messageId);
  if (!roomPanelRegistry.has(key)) roomPanelRegistry.set(key, new Map());
  roomPanelRegistry.get(key).set(refKey, {
    guildId,
    roomChannelId,
    textChannelId,
    messageId,
    updatedAt: Date.now()
  });
}

function touchRoomPanelRef(guildId, roomChannelId, textChannelId, messageId) {
  const key = roomPanelKey(guildId, roomChannelId);
  const refKey = roomPanelRefKey(textChannelId, messageId);
  const ref = roomPanelRegistry.get(key)?.get(refKey);
  if (ref) ref.updatedAt = Date.now();
}

function unregisterRoomPanelRef(guildId, roomChannelId, textChannelId, messageId) {
  const key = roomPanelKey(guildId, roomChannelId);
  const refs = roomPanelRegistry.get(key);
  if (!refs) return;
  refs.delete(roomPanelRefKey(textChannelId, messageId));
  if (!refs.size) roomPanelRegistry.delete(key);
}

function inferPanelChannelIdFromInteraction(interaction, mode) {
  const needsChannel = mode === "channel" || mode === "both";
  if (!needsChannel) return undefined;
  if (interaction.channel?.isTextBased?.() && !interaction.channel?.isDMBased?.()) {
    return interaction.channelId;
  }
  return undefined;
}

async function resolveContext(interaction, channelId, { requireMembership = true, requireControl = false } = {}) {
  if (!interaction.inGuild?.()) return { ok: false, error: "guild-only" };

  const guild = interaction.guild;
  const voice = await getVoiceState(interaction.guildId);
  if (!voice) return { ok: false, error: "no-voice-state" };

  voice.tempChannels ??= {};
  voice.lobbies ??= {};
  voice.customRooms ??= {};

  const temp = voice.tempChannels[channelId] ?? null;
  const customRoom = !temp ? (getCustomRoom(voice, channelId) ?? null) : null;
  if (!temp && !customRoom) return { ok: false, error: "not-temp" };

  const roomChannel = guild.channels.cache.get(channelId)
    ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!roomChannel) return { ok: false, error: "room-missing" };

  const inRoom = roomChannel.members.has(interaction.user.id);
  const isAdmin = hasAdmin(interaction);
  const ownerId = temp ? temp.ownerId : customRoom.ownerId;
  const isOwner = ownerId === interaction.user.id;

  if (requireMembership && !inRoom && !isAdmin) {
    return { ok: false, error: "not-in-room" };
  }

  if (requireControl && !isOwner && !isAdmin) {
    return { ok: false, error: "not-owner" };
  }

  const lobby = temp ? (voice.lobbies?.[temp.lobbyId] ?? null) : null;
  return {
    ok: true,
    guild,
    voice,
    temp,
    customRoom,
    roomChannel,
    lobby,
    isOwner,
    isAdmin,
    inRoom
  };
}

function contextErrorMessage(code) {
  if (code === "guild-only") return "This control panel only works in servers.";
  if (code === "no-voice-state") return "Voice state is not initialized yet.";
  if (code === "not-temp") return "This room is no longer managed by VoiceMaster.";
  if (code === "room-missing") return "The room no longer exists.";
  if (code === "not-owner") return "Only the room owner (or admins) can do that.";
  if (code === "not-in-room") return "Join this room to use its control buttons.";
  return "Unable to use VoiceMaster controls right now.";
}

async function buildSpawnDiagnosticsEmbed(interaction) {
  if (!interaction.inGuild?.()) {
    return buildErrorEmbed("Spawn diagnostics are only available in servers.");
  }

  const guild = interaction.guild;
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  const voice = await getVoiceState(interaction.guildId);
  voice.lobbies ??= {};
  const entries = Object.entries(voice.lobbies);

  if (!entries.length) {
    return buildEmbed(
      "Voice Spawn Diagnostics",
      "No lobbies configured. Run `/voice setup` or `/voice add` first."
    );
  }

  const checks = await Promise.all(
    entries.slice(0, 12).map(async ([channelId, lobby]) => {
      const blockers = [];
      const lobbyChannel =
        guild.channels.cache.get(channelId) ??
        (await guild.channels.fetch(channelId).catch(() => null));
      const category =
        guild.channels.cache.get(lobby.categoryId) ??
        (await guild.channels.fetch(lobby.categoryId).catch(() => null));

      if (!lobby.enabled) blockers.push("Lobby disabled");
      if (!lobbyChannel) blockers.push("Lobby channel missing");
      else if (lobbyChannel.type !== ChannelType.GuildVoice) blockers.push("Lobby channel is not voice");

      if (!category) blockers.push("Category missing");
      else if (category.type !== ChannelType.GuildCategory) blockers.push("Category is not a voice category");

      if (me && category?.permissionsFor) {
        const perms = category.permissionsFor(me);
        const missing = [];
        if (!perms?.has(PermissionFlagsBits.ViewChannel)) missing.push("ViewChannel");
        if (!perms?.has(PermissionFlagsBits.Connect)) missing.push("Connect");
        if (!perms?.has(PermissionFlagsBits.ManageChannels)) missing.push("ManageChannels");
        if (!perms?.has(PermissionFlagsBits.MoveMembers)) missing.push("MoveMembers");
        if (missing.length) blockers.push(`Missing perms: ${missing.join(", ")}`);
      } else if (!me) {
        blockers.push("Bot member context unavailable");
      }

      return {
        channelId,
        lobby,
        ready: blockers.length === 0,
        blockers
      };
    })
  );

  const readyCount = checks.filter(x => x.ready).length;
  const blockedCount = checks.length - readyCount;
  const embed = new EmbedBuilder()
    .setTitle("Voice Spawn Diagnostics")
    .setDescription("Validates lobby/category readiness for auto room creation.")
    .setColor(blockedCount === 0 ? 0x57f287 : 0xfaa61a)
    .addFields(
      { name: "Lobbies Checked", value: String(checks.length), inline: true },
      { name: "Ready", value: String(readyCount), inline: true },
      { name: "Blocked", value: String(blockedCount), inline: true }
    )
    .setTimestamp();

  for (const row of checks.slice(0, 8)) {
    embed.addFields({
      name: `<#${row.channelId}>`,
      value: row.ready
        ? "Ready for spawning."
        : trimText(row.blockers.join("\n"), 1024),
      inline: false
    });
  }

  if (checks.length > 8) {
    embed.addFields({ name: "More", value: `Additional lobbies not shown: ${checks.length - 8}`, inline: false });
  }

  return embed;
}

function buildConsoleEmbed(ctx, panelForUser, { notice = null } = {}) {
  const everyoneRoleId = ctx.guild.roles.everyone?.id;
  const locked = getLockedState(ctx.roomChannel, everyoneRoleId);
  const members = ctx.roomChannel.members.filter(m => !m.user?.bot).size;
  const guildDefault = ctx.voice.panel?.guildDefault ?? {};

  const embed = new EmbedBuilder()
    .setTitle("VoiceMaster Console")
    .setDescription(`Room: <#${ctx.roomChannel.id}>`)
    .addFields(
      { name: "Owner", value: `<@${ctx.temp.ownerId}>`, inline: true },
      { name: "Members", value: String(members), inline: true },
      { name: "Locked", value: locked ? "yes" : "no", inline: true },
      {
        name: "Your Panel Default",
        value: `${panelForUser.mode}${panelForUser.channelId ? ` in <#${panelForUser.channelId}>` : ""} (auto-send: ${panelForUser.autoSendOnCreate ? "on" : "off"})`
      },
      {
        name: "Guild Panel Default",
        value: `${String(guildDefault.mode || "temp")}${guildDefault.channelId ? ` in <#${guildDefault.channelId}>` : ""} (auto-send: ${guildDefault.autoSendOnCreate !== false ? "on" : "off"})`
      }
    );

  if (notice) {
    embed.setFooter({ text: notice.slice(0, 240) });
  }

  return embed;
}

function buildConsoleComponents(ctx, targetUserId, panelForUser) {
  const everyoneRoleId = ctx.guild.roles.everyone?.id;
  const locked = getLockedState(ctx.roomChannel, everyoneRoleId);
  const canControl = ctx.isOwner || ctx.isAdmin;
  const canRelease = canControl;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(makeCustomId("refresh", targetUserId, ctx.roomChannel.id))
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(makeCustomId("status", targetUserId, ctx.roomChannel.id))
      .setLabel("Status")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(makeCustomId("panel_here", targetUserId, ctx.roomChannel.id))
      .setLabel("Panel Here")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(makeCustomId("panel_dm", targetUserId, ctx.roomChannel.id))
      .setLabel("Panel DM")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(makeCustomId("release", targetUserId, ctx.roomChannel.id))
      .setLabel("Release")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!canRelease)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(makeCustomId("lock", targetUserId, ctx.roomChannel.id))
      .setLabel(locked ? "Already Locked" : "Lock Room")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(locked || !canControl || !ctx.inRoom),
    new ButtonBuilder()
      .setCustomId(makeCustomId("unlock", targetUserId, ctx.roomChannel.id))
      .setLabel(locked ? "Unlock Room" : "Already Unlocked")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!locked || !canControl || !ctx.inRoom)
  );

  const userModeSelect = new StringSelectMenuBuilder()
    .setCustomId(makeCustomId("user_mode", targetUserId, ctx.roomChannel.id))
    .setPlaceholder("Set your panel delivery default")
    .addOptions(buildModeOptions(panelForUser.mode, { includeHere: true }));

  const rows = [row1, row2, new ActionRowBuilder().addComponents(userModeSelect)];

  if (ctx.isAdmin) {
    const guildMode = String(ctx.voice.panel?.guildDefault?.mode || "temp");
    const guildModeSelect = new StringSelectMenuBuilder()
      .setCustomId(makeCustomId("guild_mode", targetUserId, ctx.roomChannel.id))
      .setPlaceholder("Set guild panel delivery default")
      .addOptions(buildModeOptions(guildMode, { includeHere: false }));
    rows.push(new ActionRowBuilder().addComponents(guildModeSelect));
  }

  return rows;
}

async function updateConsole(interaction, sourceUserId, channelId, notice = null) {
  const ctx = await resolveContext(interaction, channelId, { requireMembership: false, requireControl: false });
  if (!ctx.ok) {
    await interaction.update({
      embeds: [buildErrorEmbed(contextErrorMessage(ctx.error))],
      components: []
    });
    return true;
  }

  const panelForUser = resolvePanelDelivery(ctx.voice, sourceUserId);
  await interaction.update({
    embeds: [buildConsoleEmbed(ctx, panelForUser, { notice })],
    components: buildConsoleComponents(ctx, sourceUserId, panelForUser)
  });
  return true;
}

function panelDeliveryMessage(sent) {
  if (!sent?.ok) {
    if (sent?.reason === "off") return "Delivery is off. Change mode in the dropdown first.";
    if (sent?.reason === "disabled") return "Auto-send is disabled for creation events.";
    if (sent?.reason === "missing-target") return "No writable target channel was found.";
    return "Panel delivery failed.";
  }
  return `Panel delivered (DM: ${sent.dmSent ? "yes" : "no"}, channel: ${sent.channelSent ? "yes" : "no"}).`;
}

async function handleClaim(interaction, ctx) {
  if (ctx.isOwner) return { ok: true, notice: "You already own this room." };

  const ownerPresent = ctx.roomChannel.members.has(ctx.temp.ownerId);
  if (ownerPresent && !ctx.isAdmin) {
    return { ok: false, error: "Current owner is still in the room." };
  }

  const transfer = await VoiceDomain.transferTempOwnership(interaction.guildId, ctx.roomChannel.id, interaction.user.id);
  if (!transfer.ok) return { ok: false, error: "Unable to claim ownership right now." };

  const ownerOverwrite = ownerPermissionOverwrite(ctx.lobby?.ownerPermissions);
  try {
    await ctx.roomChannel.permissionOverwrites.edit(interaction.user.id, ownerOverwrite);
  } catch {
    return { ok: false, error: "Ownership was transferred in state, but Discord permission update failed." };
  }

  if (ctx.roomChannel.permissionOverwrites.cache.has(ctx.temp.ownerId)) {
    await ctx.roomChannel.permissionOverwrites.delete(ctx.temp.ownerId).catch(err => {
      botLogger.warn({ err }, "[voice-ui] failed to clear previous owner overwrite");
    });
  }

  await auditLog({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    action: "voice.room.claim.button",
    details: {
      channelId: ctx.roomChannel.id,
      previousOwnerId: ctx.temp.ownerId,
      ownerId: interaction.user.id
    }
  });

  return { ok: true, notice: "Room ownership claimed." };
}

async function handleRelease(interaction, ctx) {
  const roomId = ctx.roomChannel.id;

  const lobbyChannelId = ctx.temp?.lobbyId ?? null;
  const lobbyChannel =
    lobbyChannelId
      ? (ctx.guild.channels.cache.get(lobbyChannelId) ?? (await ctx.guild.channels.fetch(lobbyChannelId).catch(() => null)))
      : null;
  const canMoveToLobby = Boolean(lobbyChannel && lobbyChannel.type === ChannelType.GuildVoice);

  const humans = Array.from(ctx.roomChannel.members.values()).filter(m => !m.user?.bot);

  // Try to move members out first for a clean shutdown.
  for (const m of humans) {
    if (!m?.voice) continue;
    try {
      if (canMoveToLobby) {
        await m.voice.setChannel(lobbyChannel).catch(() => {});
      } else {
        await m.voice.setChannel(null).catch(() => {});
      }
    } catch {}
  }

  await removeTempChannel(interaction.guildId, roomId, ctx.voice).catch(() => {});
  await ctx.roomChannel.delete().catch(() => {});

  await auditLog({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    action: "voice.room.release",
    details: { channelId: roomId, lobbyId: lobbyChannelId, moved: humans.length }
  }).catch(() => {});

  return { ok: true, notice: "Room released (deleted)." };
}

async function handleLockToggle(interaction, ctx, shouldLock) {
  const everyoneRoleId = interaction.guild.roles.everyone?.id;
  if (!everyoneRoleId) return { ok: false, error: "Unable to resolve @everyone role." };

  try {
    if (shouldLock) {
      await ctx.roomChannel.permissionOverwrites.edit(everyoneRoleId, { Connect: false });
      return { ok: true, notice: "Room locked." };
    }

    if (ctx.roomChannel.permissionOverwrites.cache.has(everyoneRoleId)) {
      await ctx.roomChannel.permissionOverwrites.delete(everyoneRoleId);
    }
    return { ok: true, notice: "Room unlocked." };
  } catch {
    return { ok: false, error: "Failed to update room lock state. Check bot permissions." };
  }
}

async function resolveRoomPanelState(guild, roomChannelId) {
  const voice = await getVoiceState(guild.id);
  voice.tempChannels ??= {};
  voice.lobbies ??= {};
  voice.customRooms ??= {};

  const temp = voice.tempChannels[roomChannelId] ?? null;
  const customRoom = !temp ? (getCustomRoom(voice, roomChannelId) ?? null) : null;
  const roomChannel = guild.channels.cache.get(roomChannelId)
    ?? (await guild.channels.fetch(roomChannelId).catch(() => null));

  // A room is open if it exists in either registry AND the Discord channel is present
  if ((!temp && !customRoom) || !roomChannel) {
    return {
      open: false,
      guild,
      voice,
      temp,
      customRoom,
      roomChannel,
      lobby: null,
      roomChannelId
    };
  }

  const lobby = temp ? (voice.lobbies?.[temp.lobbyId] ?? null) : null;
  return {
    open: true,
    guild,
    voice,
    temp,
    customRoom,
    roomChannel,
    lobby,
    roomChannelId
  };
}

function buildLiveRoomPanelComponents(roomChannelId, { closed = false } = {}) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(makeRoomPanelCustomId("refresh", roomChannelId))
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(closed),
      new ButtonBuilder()
        .setCustomId(makeRoomPanelCustomId("dm", roomChannelId))
        .setLabel("DM Dashboard")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(closed),
      new ButtonBuilder()
        .setCustomId(makeRoomPanelCustomId("release", roomChannelId))
        .setLabel("Release")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(closed)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(makeRoomPanelCustomId("lock", roomChannelId))
        .setLabel("Lock")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(closed),
      new ButtonBuilder()
        .setCustomId(makeRoomPanelCustomId("unlock", roomChannelId))
        .setLabel("Unlock")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(closed)
    )
  ];
  return rows;
}

function buildLiveRoomPanelEmbed(state, { reason = "update", notice = null } = {}) {
  if (!state.open) {
    return new EmbedBuilder()
      .setTitle("Voice Room Panel")
      .setDescription(`Room <#${state.roomChannelId}> is no longer active.`)
      .setFooter({ text: "Panel frozen. Create a new panel for another active room." });
  }

  const everyoneRoleId = state.guild.roles.everyone?.id;
  const locked = getLockedState(state.roomChannel, everyoneRoleId);
  const members = state.roomChannel.members.filter(m => !m.user?.bot).size;
  const limit = Number.isFinite(state.roomChannel.userLimit) ? state.roomChannel.userLimit : 0;
  const lobbyLabel = state.temp?.lobbyId ? `<#${state.temp.lobbyId}>` : "n/a";
  const ownerId = state.temp?.ownerId ?? state.customRoom?.ownerId ?? null;

  const embed = new EmbedBuilder()
    .setTitle("Voice Room Live Panel")
    .setDescription(`Live controls for <#${state.roomChannel.id}>`)
    .addFields(
      { name: "Owner", value: ownerId ? `<@${ownerId}>` : "Unknown", inline: true },
      { name: "Members", value: String(members), inline: true },
      { name: "Locked", value: locked ? "yes" : "no", inline: true },
      { name: "Limit", value: String(limit), inline: true },
      { name: "Lobby", value: lobbyLabel, inline: true },
      { name: "Update", value: reason, inline: true }
    );

  const footerParts = [
    notice ? notice : null,
    `Updated ${new Date().toLocaleTimeString()}`
  ].filter(Boolean);
  embed.setFooter({ text: footerParts.join(" | ").slice(0, 240) });

  return embed;
}

function buildLiveRoomPanelPayload(state, { reason = "update", notice = null } = {}) {
  return {
    embeds: [buildLiveRoomPanelEmbed(state, { reason, notice })],
    components: buildLiveRoomPanelComponents(state.roomChannelId, { closed: !state.open })
  };
}

export async function refreshRegisteredRoomPanelsForRoom(guild, roomChannelId, reason = "update", opts = {}) {
  if (!guild?.id || !roomChannelId) return 0;
  pruneRoomPanelRegistry();

  const key = roomPanelKey(guild.id, roomChannelId);
  const refs = roomPanelRegistry.get(key);
  if (!refs?.size) return 0;

  const state = await resolveRoomPanelState(guild, roomChannelId);
  const payload = buildLiveRoomPanelPayload(state, {
    reason,
    notice: opts.notice ?? null
  });

  let updated = 0;
  for (const ref of refs.values()) {
    if (opts.excludeMessageId && ref.messageId === opts.excludeMessageId) {
      continue;
    }

    const textChannel = guild.channels.cache.get(ref.textChannelId)
      ?? (await guild.channels.fetch(ref.textChannelId).catch(() => null));
    if (!textChannel?.isTextBased?.()) {
      botLogger.warn({ textChannelId: ref.textChannelId }, "[voice-ui] live panel target channel missing or not text");
      unregisterRoomPanelRef(guild.id, roomChannelId, ref.textChannelId, ref.messageId);
      continue;
    }

    const message = await textChannel.messages.fetch(ref.messageId).catch(() => null);
    if (!message) {
      botLogger.warn({ textChannelId: ref.textChannelId, messageId: ref.messageId }, "[voice-ui] live panel message missing");
      unregisterRoomPanelRef(guild.id, roomChannelId, ref.textChannelId, ref.messageId);
      continue;
    }

    const edited = await message.edit(payload).catch(err => {
      botLogger.warn({ err, messageId: ref.messageId }, "[voice-ui] failed to edit live panel");
      return null;
    });
    if (!edited) {
      unregisterRoomPanelRef(guild.id, roomChannelId, ref.textChannelId, ref.messageId);
      continue;
    }
    touchRoomPanelRef(guild.id, roomChannelId, ref.textChannelId, ref.messageId);
    updated++;

    if (!state.open) {
      unregisterRoomPanelRef(guild.id, roomChannelId, ref.textChannelId, ref.messageId);
    }
  }

  return updated;
}

export async function showLiveRoomPanel(interaction) {
  if (!interaction.inGuild()) return;

  const roomChannelId = interaction.member?.voice?.channelId;
  if (!roomChannelId) {
    await interaction.reply({ embeds: [buildErrorEmbed("Join a VoiceMaster room first.")], ephemeral: true });
    return;
  }

  const ctx = await resolveContext(interaction, roomChannelId, {
    requireMembership: true,
    requireControl: false
  });
  if (!ctx.ok) {
    await interaction.reply({ embeds: [buildErrorEmbed(contextErrorMessage(ctx.error))], ephemeral: true });
    return;
  }

  const state = {
    open: true,
    guild: interaction.guild,
    voice: ctx.voice,
    temp: ctx.temp,
    customRoom: ctx.customRoom ?? null,
    roomChannel: ctx.roomChannel,
    lobby: ctx.lobby,
    roomChannelId
  };

  const payload = buildLiveRoomPanelPayload(state, {
    reason: "created",
    notice: `Opened by ${interaction.user.username}`
  });

  const panelMessage = await interaction.channel.send(payload).catch(() => null);
  if (!panelMessage) {
    await interaction.reply({
      embeds: [buildErrorEmbed("Failed to post live panel in this channel.")],
      ephemeral: true
    });
    return;
  }

  registerRoomPanelRef({
    guildId: interaction.guildId,
    roomChannelId,
    textChannelId: panelMessage.channelId,
    messageId: panelMessage.id
  });

  await auditLog({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    action: "voice.room.panel.create",
    details: {
      roomChannelId,
      textChannelId: panelMessage.channelId,
      messageId: panelMessage.id
    }
  });

  await interaction.reply({
    embeds: [buildEmbed("Voice panel posted", `Live panel posted in <#${panelMessage.channelId}> for <#${roomChannelId}>.`)],
    ephemeral: true
  });
}

export async function showVoiceConsole(interaction) {
  const channelId = interaction.member?.voice?.channelId;
  if (!channelId) {
    await interaction.reply({ embeds: [buildErrorEmbed("Join a VoiceMaster room first.")], ephemeral: true });
    return;
  }

  const ctx = await resolveContext(interaction, channelId, { requireMembership: true, requireControl: false });
  if (!ctx.ok) {
    await interaction.reply({ embeds: [buildErrorEmbed(contextErrorMessage(ctx.error))], ephemeral: true });
    return;
  }

  const panelForUser = resolvePanelDelivery(ctx.voice, interaction.user.id);
  await interaction.reply({
    embeds: [buildConsoleEmbed(ctx, panelForUser)],
    components: buildConsoleComponents(ctx, interaction.user.id, panelForUser),
    ephemeral: true
  });
}

async function updateLivePanelInteraction(interaction, roomChannelId, { reason = "update", notice = null } = {}) {
  const state = await resolveRoomPanelState(interaction.guild, roomChannelId);
  await interaction.update(buildLiveRoomPanelPayload(state, { reason, notice }));

  if (!state.open) {
    unregisterRoomPanelRef(interaction.guildId, roomChannelId, interaction.channelId, interaction.message.id);
  } else {
    touchRoomPanelRef(interaction.guildId, roomChannelId, interaction.channelId, interaction.message.id);
  }
}

async function handleLivePanelButton(interaction, parsed) {
  const action = parsed.kind;

  if (parsed.userId && parsed.userId !== interaction.user.id) {
    // Allow admins to override user-scoped panels.
    if (!hasAdmin(interaction)) {
      await interaction.reply({ embeds: [buildErrorEmbed("This dashboard belongs to another user.")], ephemeral: true }).catch(() => {});
      return true;
    }
  }

  if (action === "refresh") {
    await updateLivePanelInteraction(interaction, parsed.roomChannelId, {
      reason: "refresh",
      notice: `Refreshed by ${interaction.user.username}`
    });
    await refreshRegisteredRoomPanelsForRoom(interaction.guild, parsed.roomChannelId, "refresh", {
      excludeMessageId: interaction.message.id
    }).catch(() => {});
    return true;
  }

  if (action === "dm") {
    const ctx = await resolveContext(interaction, parsed.roomChannelId, {
      requireMembership: true,
      requireControl: false
    });
    if (!ctx.ok) {
      await interaction.reply({ embeds: [buildErrorEmbed(contextErrorMessage(ctx.error))], ephemeral: true });
      return true;
    }

    const sent = await deliverVoiceRoomDashboard({
      guild: interaction.guild,
      member: interaction.member,
      roomChannel: ctx.roomChannel,
      tempRecord: ctx.temp,
      lobby: ctx.lobby,
      voice: ctx.voice,
      modeOverride: "dm",
      interactionChannel: interaction.channel,
      reason: "manual"
    });
    if (!sent.ok) {
      // DM failed (most commonly: user has server DMs disabled). Show the dashboard ephemerally as a fallback.
      const embed = buildVoiceRoomDashboardEmbed({
        roomChannel: ctx.roomChannel,
        tempRecord: ctx.temp,
        lobby: ctx.lobby,
        ownerUserId: interaction.user.id,
        reason: "manual"
      });
      embed.setFooter({ text: "DM failed. Enable DMs from server members, or use Panel Here / channel delivery." });
      await interaction.reply({
        embeds: [embed],
        components: buildVoiceRoomDashboardComponents(ctx.roomChannel.id),
        ephemeral: true
      });
      return true;
    }
    await interaction.reply({ embeds: [buildEmbed("Voice panel", panelDeliveryMessage(sent))], ephemeral: true });
    return true;
  }

  if (action === "rename" || action === "limit") {
    const ctx = await resolveContext(interaction, parsed.roomChannelId, {
      requireMembership: false,
      requireControl: true
    });
    if (!ctx.ok) {
      await interaction.reply({ embeds: [buildErrorEmbed(contextErrorMessage(ctx.error))], ephemeral: true });
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(makeRoomModalCustomId(action, interaction.guildId, parsed.roomChannelId))
      .setTitle(action === "rename" ? "Rename Room" : "Set Member Cap");

    if (action === "rename") {
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("name")
            .setLabel("New room name")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(90)
            .setValue(String(ctx.roomChannel?.name || "").slice(0, 90) || "")
        )
      );
    } else {
      const cur = Number.isFinite(ctx.roomChannel?.userLimit) ? String(ctx.roomChannel.userLimit) : "0";
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("limit")
            .setLabel("Member cap (0 = unlimited)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(2)
            .setValue(cur)
        )
      );
    }

    await interaction.showModal(modal).catch(() => {});
    return true;
  }

  if (action === "music") {
    const ctx = await resolveContext(interaction, parsed.roomChannelId, {
      requireMembership: true,
      requireControl: true
    });
    if (!ctx.ok) {
      await interaction.reply({ embeds: [buildErrorEmbed(contextErrorMessage(ctx.error))], ephemeral: true });
      return true;
    }

    // Avoid surprising playback: Quick Play is for the room you're currently in.
    if (interaction.member?.voice?.channelId !== parsed.roomChannelId) {
      await interaction.reply({ embeds: [buildErrorEmbed("Join this room voice channel to use Quick Play from its dashboard.")], ephemeral: true });
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(makeRoomModalCustomId("music", interaction.guildId, parsed.roomChannelId))
      .setTitle("Quick Play");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("query")
          .setLabel("Search or URL")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(200)
          .setPlaceholder("e.g., never gonna give you up")
      )
    );
    await interaction.showModal(modal).catch(() => {});
    return true;
  }

  if (action === "game") {
    const wrapped = Object.create(interaction);
    wrapped.options = {
      getSubcommand: () => "panel",
      getString: (name) => (name === "delivery" ? "ephemeral" : null)
    };
    await gameExecute(wrapped);
    return true;
  }

  if (action === "audiobook") {
    // Show audiobook status / quick controls from VC dashboard
    const { getPlayer, PlayerState } = await import("../../audiobook/player.js");
    const { getSession } = await import("../../audiobook/session.js");
    const { getBook } = await import("../../audiobook/session.js");
    const { buildNowReadingEmbed, buildControlRow } = await import("../audiobook-dashboard.js").catch(() => null) ?? {};

    const player  = getPlayer(interaction.guildId);
    const db      = await (await import("../../utils/storage_pg.js")).getPool();
    const session = await getSession(db, interaction.user.id, interaction.guildId).catch(() => null);
    const book    = session?.book_id ? await getBook(db, session.book_id).catch(() => null) : null;
    const progress = player?.getProgress() ?? null;

    const stateEmoji = { playing: '▶️', paused: '⏸', loading: '⏳', done: '✅', idle: '💤' };
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors } = await import("discord.js");

    const embed = new EmbedBuilder().setColor(Colors.DarkGold);
    if (progress) {
      const se = stateEmoji[progress.state] ?? '❓';
      embed
        .setTitle(`${se} ${progress.bookTitle}`)
        .setDescription(`**${progress.chapterTitle}**\nChapter ${progress.chapterIndex + 1} of ${progress.totalChapters}`)
        .addFields({ name: 'Progress', value: `\`${progress.bar}\``, inline: false });
    } else if (book) {
      embed
        .setTitle(`📚 ${book.title}`)
        .setDescription(`*Not currently playing*\nUse **▶️ Play** or \`/audiobook play\` to start.`);
    } else {
      embed
        .setTitle('📖 Audiobook')
        .setDescription('No book loaded.\nUse `/audiobook start` to open a drop thread and upload a book.');
    }

    const guildId = interaction.guildId;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`audiobook:pause:${guildId}`).setEmoji('⏸').setStyle(ButtonStyle.Secondary).setLabel('Pause').setDisabled(!progress || progress.state !== 'playing'),
      new ButtonBuilder().setCustomId(`audiobook:resume:${guildId}`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setLabel('Resume').setDisabled(!progress || progress.state !== 'paused'),
      new ButtonBuilder().setCustomId(`audiobook:skip:${guildId}`).setEmoji('⏭').setStyle(ButtonStyle.Secondary).setLabel('Skip').setDisabled(!progress),
      new ButtonBuilder().setCustomId(`audiobook:stop:${guildId}`).setEmoji('🏁').setStyle(ButtonStyle.Danger).setLabel('Stop').setDisabled(!progress),
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    return true;
  }

  if (action === "claim") {
    // Hardening: claim via buttons is disabled to avoid ownership takeovers via stale panels.
    await interaction.reply({
      embeds: [buildErrorEmbed("Room claim via buttons is disabled. Use `/voice room_claim` (Manage Server).")],
      ephemeral: true
    }).catch(() => {});
    return true;
  }

  if (action === "release") {
    const ctx = await resolveContext(interaction, parsed.roomChannelId, {
      requireMembership: false,
      requireControl: true
    });
    if (!ctx.ok) {
      await interaction.reply({ embeds: [buildErrorEmbed(contextErrorMessage(ctx.error))], ephemeral: true });
      return true;
    }

    const result = await handleRelease(interaction, ctx);
    if (!result.ok) {
      await interaction.reply({ embeds: [buildErrorEmbed(result.error)], ephemeral: true });
      return true;
    }

    await updateLivePanelInteraction(interaction, parsed.roomChannelId, {
      reason: "release",
      notice: result.notice
    });
    await refreshRegisteredRoomPanelsForRoom(interaction.guild, parsed.roomChannelId, "deleted", {
      excludeMessageId: interaction.message.id,
      notice: result.notice
    }).catch(() => {});
    return true;
  }

  if (action === "lock" || action === "unlock") {
    const ctx = await resolveContext(interaction, parsed.roomChannelId, {
      requireMembership: true,
      requireControl: true
    });
    if (!ctx.ok) {
      await interaction.reply({ embeds: [buildErrorEmbed(contextErrorMessage(ctx.error))], ephemeral: true });
      return true;
    }

    const result = await handleLockToggle(interaction, ctx, action === "lock");
    if (!result.ok) {
      await interaction.reply({ embeds: [buildErrorEmbed(result.error)], ephemeral: true });
      return true;
    }

    await updateLivePanelInteraction(interaction, parsed.roomChannelId, {
      reason: action,
      notice: result.notice
    });
    await refreshRegisteredRoomPanelsForRoom(interaction.guild, parsed.roomChannelId, action, {
      excludeMessageId: interaction.message.id,
      notice: result.notice
    }).catch(() => {});
    return true;
  }

  await interaction.reply({ embeds: [buildErrorEmbed("Unsupported live room panel action.")], ephemeral: true });
  return true;
}

function buildDmRoomErrorPayload(message) {
  return {
    embeds: [buildErrorEmbed(message)],
    components: []
  };
}

function maybeEphemeralFlags(interaction) {
  return interaction.inGuild?.() ? { flags: MessageFlags.Ephemeral } : {};
}

async function resolveRoomContextFromIds(client, guildId, roomChannelId, actingUserId) {
  const gid = String(guildId || "").trim();
  const rid = String(roomChannelId || "").trim();
  const uid = String(actingUserId || "").trim();
  if (!gid || !rid || !uid) return { ok: false, error: "invalid" };

  const guild = await client.guilds.fetch(gid).catch(() => null);
  if (!guild) return { ok: false, error: "guild-missing" };

  const member =
    guild.members.cache.get(uid) ??
    (await guild.members.fetch(uid).catch(() => null));
  if (!member) return { ok: false, error: "member-missing" };

  const voice = await getVoiceState(gid);
  if (!voice) return { ok: false, error: "no-voice-state" };
  voice.tempChannels ??= {};
  voice.lobbies ??= {};

  const temp = voice.tempChannels[rid] ?? null;
  if (!temp) return { ok: false, error: "not-temp", guild, member, voice };

  const roomChannel =
    guild.channels.cache.get(rid) ??
    (await guild.channels.fetch(rid).catch(() => null));
  if (!roomChannel) return { ok: false, error: "room-missing", guild, member, voice, temp };

  const isOwner = String(temp.ownerId || "") === uid;
  const perms = member.permissions;
  const isAdmin = Boolean(
    perms?.has?.(PermissionFlagsBits.ManageGuild) ||
    perms?.has?.(PermissionFlagsBits.Administrator)
  );

  const lobby = voice.lobbies?.[temp.lobbyId] ?? null;
  return { ok: true, guild, member, voice, temp, roomChannel, lobby, isOwner, isAdmin };
}

function buildDmDashboardPayload(ctx, { notice = null, closed = false } = {}) {
  const ownerId = ctx?.temp?.ownerId || ctx?.member?.id || "0";
  const embed = buildVoiceRoomDashboardEmbed({
    roomChannel: ctx?.roomChannel,
    tempRecord: ctx?.temp,
    lobby: ctx?.lobby,
    ownerUserId: ownerId,
    reason: "manual"
  });

  if (notice) {
    embed.setFooter({ text: String(notice).slice(0, 240) });
  }

  const controlsDisabled = closed || (!ctx?.isOwner && !ctx?.isAdmin);
  const components =
    ctx?.roomChannel?.id
      ? buildVoiceRoomDashboardComponents(ctx.roomChannel.id, {
          guildId: ctx.guild?.id,
          includeDmButton: false,
          controlsDisabled,
          disableQuickPlay: true,
          actorUserId: ctx?.temp?.ownerId || ctx?.member?.id
        })
      : [];

  return { embeds: [embed], components };
}

async function handleRoomPanelButtonInDm(interaction, parsed) {
  const gid = String(parsed.guildId || "").trim();
  if (!gid) {
    await interaction.update(buildDmRoomErrorPayload("This dashboard button needs a server context. Re-open the dashboard from inside the server.")).catch(() => {});
    return true;
  }

  if (parsed.userId && parsed.userId !== interaction.user.id) {
    await interaction.reply({
      embeds: [buildErrorEmbed("This dashboard belongs to another user.")],
      ...maybeEphemeralFlags(interaction)
    }).catch(() => {});
    return true;
  }

  if (parsed.kind === "music") {
    await interaction.reply({
      embeds: [buildErrorEmbed("Quick Play is guild-only. Use the dashboard inside the server, or run `/music play <query>` in the server.")],
      ...maybeEphemeralFlags(interaction)
    }).catch(() => {});
    return true;
  }

  if (parsed.kind === "game") {
    const wrapped = Object.create(interaction);
    wrapped.options = {
      getSubcommand: () => "panel",
      getString: (name) => (name === "delivery" ? "dm" : null)
    };
    await gameExecute(wrapped);
    return true;
  }

  const ctx = await resolveRoomContextFromIds(interaction.client, gid, parsed.roomChannelId, interaction.user.id);
  if (!ctx.ok) {
    const msg =
      ctx.error === "guild-missing"
        ? "That server is no longer available."
        : ctx.error === "member-missing"
          ? "You are no longer a member of that server."
          : ctx.error === "room-missing"
            ? "That room no longer exists."
            : ctx.error === "not-temp"
              ? "That room is no longer managed by VoiceMaster."
              : ctx.error === "no-voice-state"
                ? "Voice settings are not initialized yet."
                : "Unable to use this dashboard right now.";
    await interaction.update(buildDmRoomErrorPayload(msg)).catch(() => {});
    return true;
  }

  const action = parsed.kind;
  if (action === "refresh") {
    await interaction.update(buildDmDashboardPayload(ctx, { notice: "Refreshed." })).catch(() => {});
    return true;
  }

  if (action === "dm") {
    await interaction.update(buildDmDashboardPayload(ctx, { notice: "You are already viewing this in DMs." })).catch(() => {});
    return true;
  }

  if (action === "rename" || action === "limit") {
    if (!ctx.isOwner && !ctx.isAdmin) {
      await interaction.update(buildDmDashboardPayload(ctx, { notice: "Only the room owner (or admins) can do that." })).catch(() => {});
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(makeRoomModalCustomId(action, ctx.guild.id, ctx.roomChannel.id))
      .setTitle(action === "rename" ? "Rename Room" : "Set Member Cap");

    if (action === "rename") {
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("name")
            .setLabel("New room name")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(90)
            .setValue(String(ctx.roomChannel?.name || "").slice(0, 90) || "")
        )
      );
    } else {
      const cur = Number.isFinite(ctx.roomChannel?.userLimit) ? String(ctx.roomChannel.userLimit) : "0";
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("limit")
            .setLabel("Member cap (0 = unlimited)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(2)
            .setValue(cur)
        )
      );
    }

    await interaction.showModal(modal).catch(() => {});
    return true;
  }

  if (!ctx.isOwner && !ctx.isAdmin) {
    await interaction.update(buildDmDashboardPayload(ctx, { notice: "Only the room owner (or admins) can do that." })).catch(() => {});
    return true;
  }

  if (action === "lock" || action === "unlock") {
    const everyoneRoleId = ctx.guild.roles.everyone?.id;
    if (!everyoneRoleId) {
      await interaction.update(buildDmDashboardPayload(ctx, { notice: "Unable to resolve @everyone role." })).catch(() => {});
      return true;
    }

    try {
      if (action === "lock") {
        await ctx.roomChannel.permissionOverwrites.edit(everyoneRoleId, { Connect: false });
        await interaction.update(buildDmDashboardPayload(ctx, { notice: "Room locked." })).catch(() => {});
        return true;
      }

      if (ctx.roomChannel.permissionOverwrites.cache.has(everyoneRoleId)) {
        await ctx.roomChannel.permissionOverwrites.delete(everyoneRoleId);
      }
      await interaction.update(buildDmDashboardPayload(ctx, { notice: "Room unlocked." })).catch(() => {});
      return true;
    } catch {
      await interaction.update(buildDmDashboardPayload(ctx, { notice: "Failed to update room lock state. Check bot permissions." })).catch(() => {});
      return true;
    }
  }

  if (action === "release") {
    const roomId = ctx.roomChannel.id;
    const lobbyChannelId = ctx.temp?.lobbyId ?? null;
    const lobbyChannel =
      lobbyChannelId
        ? (ctx.guild.channels.cache.get(lobbyChannelId) ?? (await ctx.guild.channels.fetch(lobbyChannelId).catch(() => null)))
        : null;
    const canMoveToLobby = Boolean(lobbyChannel && lobbyChannel.type === ChannelType.GuildVoice);

    const humans = Array.from(ctx.roomChannel.members.values()).filter(m => !m.user?.bot);
    for (const m of humans) {
      if (!m?.voice) continue;
      try {
        if (canMoveToLobby) {
          await m.voice.setChannel(lobbyChannel).catch(() => {});
        } else {
          await m.voice.setChannel(null).catch(() => {});
        }
      } catch {}
    }

    await removeTempChannel(ctx.guild.id, roomId, ctx.voice).catch(() => {});
    await ctx.roomChannel.delete().catch(() => {});

    await auditLog({
      guildId: ctx.guild.id,
      userId: interaction.user.id,
      action: "voice.room.release.dm",
      details: { channelId: roomId, lobbyId: lobbyChannelId, moved: humans.length }
    }).catch(() => {});

    await interaction.update(buildDmDashboardPayload(ctx, { notice: "Room released (deleted).", closed: true })).catch(() => {});
    return true;
  }

  await interaction.update(buildDmDashboardPayload(ctx, { notice: "Unsupported action." })).catch(() => {});
  return true;
}

export async function handleVoiceUIModal(interaction) {
  if (!interaction.isModalSubmit?.()) return false;
  const parsed = parseRoomModalCustomId(interaction.customId);
  if (!parsed) return false;

  const kind = parsed.kind;
  const gid = String(parsed.guildId || "").trim();
  const rid = String(parsed.roomChannelId || "").trim();

  if (kind === "rename" || kind === "limit") {
    const ctx = interaction.inGuild?.()
      ? await resolveContext(interaction, rid, { requireMembership: false, requireControl: true })
      : await resolveRoomContextFromIds(interaction.client, gid, rid, interaction.user.id);

    if (!ctx?.ok) {
      await interaction.reply({
        embeds: [buildErrorEmbed("This room is no longer available.")],
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    if (!ctx.isOwner && !ctx.isAdmin) {
      await interaction.reply({
        embeds: [buildErrorEmbed("Only the room owner (or admins) can do that.")],
        ...maybeEphemeralFlags(interaction)
      }).catch(() => {});
      return true;
    }

    if (kind === "rename") {
      const nextName = safeRoomName(interaction.fields.getTextInputValue("name"), ctx.roomChannel?.name || "room");
      await ctx.roomChannel.setName(nextName).catch(() => {});
      await refreshRegisteredRoomPanelsForRoom(ctx.guild, rid, "rename", { notice: "Renamed." }).catch(() => {});
      const payload = buildDmDashboardPayload(ctx, { notice: "Room renamed." });
      await interaction.reply({ ...payload, ...maybeEphemeralFlags(interaction) }).catch(() => {});
      return true;
    }

    const raw = interaction.fields.getTextInputValue("limit");
    const limit = clampInt(raw, { min: 0, max: 99, fallback: 0 });
    await ctx.roomChannel.setUserLimit(limit).catch(() => {});
    await refreshRegisteredRoomPanelsForRoom(ctx.guild, rid, "limit", { notice: "Member cap updated." }).catch(() => {});
    const payload = buildDmDashboardPayload(ctx, { notice: `Member cap updated: ${limit === 0 ? "unlimited" : String(limit)}.` });
    await interaction.reply({ ...payload, ...maybeEphemeralFlags(interaction) }).catch(() => {});
    return true;
  }

  if (kind === "music") {
    if (!interaction.inGuild?.() || interaction.guildId !== gid) {
      await interaction.reply({
        embeds: [buildErrorEmbed("Quick Play must be used from inside the server.")],
        ...maybeEphemeralFlags(interaction)
      }).catch(() => {});
      return true;
    }

    if (interaction.member?.voice?.channelId !== rid) {
      await interaction.reply({
        embeds: [buildErrorEmbed("Join this room voice channel to use Quick Play from its dashboard.")],
        ...maybeEphemeralFlags(interaction)
      }).catch(() => {});
      return true;
    }

    // Recommended hardening: only the room owner (or admins) can quick-play from the room dashboard.
    const ctx = await resolveContext(interaction, rid, { requireMembership: false, requireControl: false });
    if (!ctx.ok) {
      await interaction.reply({
        embeds: [buildErrorEmbed(contextErrorMessage(ctx.error))],
        ...maybeEphemeralFlags(interaction)
      }).catch(() => {});
      return true;
    }
    if (!ctx.isOwner && !ctx.isAdmin) {
      await interaction.reply({
        embeds: [buildErrorEmbed("Only the room owner (or admins) can use Quick Play from this dashboard.")],
        ...maybeEphemeralFlags(interaction)
      }).catch(() => {});
      return true;
    }

    const query = String(interaction.fields.getTextInputValue("query") || "").trim();
    if (!query) {
      await interaction.reply({
        embeds: [buildErrorEmbed("Query is empty.")],
        ...maybeEphemeralFlags(interaction)
      }).catch(() => {});
      return true;
    }

    const wrapped = Object.create(interaction);
    // Provide a complete options stub so musicExecute() doesn't throw on any
    // options accessor (getSubcommandGroup is called on line 1 of execute()).
    wrapped.options = {
      getSubcommand:      ()     => "play",
      getSubcommandGroup: ()     => null,
      getString:          (name) => name === "query" ? query : null,
      getBoolean:         ()     => null,
      getInteger:         ()     => null,
      getNumber:          ()     => null,
      getUser:            ()     => null,
      getChannel:         ()     => null,
      getMember:          ()     => null,
      getRole:            ()     => null,
    };
    // Force all replies to be ephemeral — modal submissions must not produce
    // public messages in the channel.
    wrapped.deferReply  = (opts = {}) => interaction.deferReply({ ...opts, flags: MessageFlags.Ephemeral });
    wrapped.reply       = (payload)   => interaction.reply({ ...(payload || {}), ...maybeEphemeralFlags(interaction) });
    wrapped.editReply   = (payload)   => interaction.editReply(payload || {});
    wrapped.followUp    = (payload)   => interaction.followUp({ ...(payload || {}), ...maybeEphemeralFlags(interaction) });
    await musicExecute(wrapped);
    return true;
  }

  return false;
}

export async function handleVoiceUIButton(interaction) {
  if (!interaction.isButton?.()) return false;

  const parsedRoom = parseRoomPanelCustomId(interaction.customId);
  if (parsedRoom) {
    if (!interaction.inGuild?.()) {
      return handleRoomPanelButtonInDm(interaction, parsedRoom);
    }
    return handleLivePanelButton(interaction, parsedRoom);
  }

  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  if (interaction.user.id !== parsed.userId) {
    await interaction.reply({ embeds: [buildErrorEmbed("This panel belongs to another user.")], ephemeral: true });
    return true;
  }

  if (parsed.kind === "spawn_diag") {
    const embed = await buildSpawnDiagnosticsEmbed(interaction);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return true;
  }

  if (parsed.kind === "refresh" || parsed.kind === "status") {
    const label = parsed.kind === "refresh" ? "Refreshed." : "Status refreshed.";
    return updateConsole(interaction, parsed.userId, parsed.channelId, label);
  }

  const requireControl = new Set(["lock", "unlock"]).has(parsed.kind);
  const ctx = await resolveContext(interaction, parsed.channelId, {
    requireMembership: true,
    requireControl
  });
  if (!ctx.ok) {
    await interaction.reply({ embeds: [buildErrorEmbed(contextErrorMessage(ctx.error))], ephemeral: true });
    return true;
  }

    if (parsed.kind === "panel_here" || parsed.kind === "panel_dm") {
      const sent = await deliverVoiceRoomDashboard({
        guild: interaction.guild,
        member: interaction.member,
        roomChannel: ctx.roomChannel,
        tempRecord: ctx.temp,
        lobby: ctx.lobby,
        voice: ctx.voice,
        modeOverride: parsed.kind === "panel_here" ? "here" : "dm",
        interactionChannel: interaction.channel,
        reason: "manual"
      });
    if (parsed.kind === "panel_dm" && !sent.ok) {
      const embed = buildVoiceRoomDashboardEmbed({
        roomChannel: ctx.roomChannel,
        tempRecord: ctx.temp,
        lobby: ctx.lobby,
        ownerUserId: interaction.user.id,
        reason: "manual"
      });
      embed.setFooter({ text: "DM failed. Enable DMs from server members, or use Panel Here / channel delivery." });
      await interaction.followUp({
        embeds: [embed],
        components: buildVoiceRoomDashboardComponents(ctx.roomChannel.id),
        ephemeral: true
      }).catch(() => {});
    }
      return updateConsole(interaction, parsed.userId, parsed.channelId, panelDeliveryMessage(sent));
    }

  if (parsed.kind === "claim") {
    // Hardening: claim via buttons is disabled to avoid ownership takeovers via stale panels.
    return updateConsole(
      interaction,
      parsed.userId,
      parsed.channelId,
      "Room claim via buttons is disabled. Use `/voice room_claim` (Manage Server)."
    );
  }

  if (parsed.kind === "release") {
    const relCtx = await resolveContext(interaction, parsed.channelId, { requireMembership: false, requireControl: true });
    if (!relCtx.ok) {
      await interaction.reply({ embeds: [buildErrorEmbed(contextErrorMessage(relCtx.error))], ephemeral: true });
      return true;
    }
    const result = await handleRelease(interaction, relCtx);
    if (!result.ok) {
      await interaction.reply({ embeds: [buildErrorEmbed(result.error)], ephemeral: true });
      return true;
    }
    return updateConsole(interaction, parsed.userId, parsed.channelId, result.notice);
  }

  if (parsed.kind === "lock" || parsed.kind === "unlock") {
    const result = await handleLockToggle(interaction, ctx, parsed.kind === "lock");
    if (!result.ok) {
      await interaction.reply({ embeds: [buildErrorEmbed(result.error)], ephemeral: true });
      return true;
    }
    return updateConsole(interaction, parsed.userId, parsed.channelId, result.notice);
  }

  await interaction.reply({ embeds: [buildErrorEmbed("Unsupported VoiceMaster UI action.")], ephemeral: true });
  return true;
}

export async function handleVoiceUISelect(interaction) {
  if (!interaction.isStringSelectMenu?.()) return false;

  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  if (interaction.user.id !== parsed.userId) {
    await interaction.reply({ embeds: [buildErrorEmbed("This panel belongs to another user.")], ephemeral: true });
    return true;
  }

  const mode = interaction.values?.[0];
  if (!mode) {
    await interaction.reply({ embeds: [buildErrorEmbed("Select a delivery mode first.")], ephemeral: true });
    return true;
  }

  if (parsed.kind === "user_mode") {
    const channelId = inferPanelChannelIdFromInteraction(interaction, mode);
    if ((mode === "channel" || mode === "both") && !channelId) {
      await interaction.reply({ embeds: [buildErrorEmbed("Choose a text channel context for channel-based delivery.")], ephemeral: true });
      return true;
    }

    const res = await VoiceDomain.setPanelUserDefault(interaction.guildId, interaction.user.id, {
      mode,
      channelId
    });
    if (!res.ok) {
      await interaction.reply({ embeds: [buildErrorEmbed("Failed to update your panel default.")], ephemeral: true });
      return true;
    }

    await auditLog({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      action: "voice.panel.user-default.select",
      details: res.userDefault
    });

    return updateConsole(interaction, parsed.userId, parsed.channelId, `Your default mode is now: ${mode}.`);
  }

  if (parsed.kind === "guild_mode") {
    if (!hasAdmin(interaction)) {
      await interaction.reply({ embeds: [buildErrorEmbed("Manage Server permission required for guild defaults.")], ephemeral: true });
      return true;
    }

    const channelId = inferPanelChannelIdFromInteraction(interaction, mode);
    if ((mode === "channel" || mode === "both") && !channelId) {
      await interaction.reply({ embeds: [buildErrorEmbed("Choose a text channel context for channel-based delivery.")], ephemeral: true });
      return true;
    }

    const res = await VoiceDomain.setPanelGuildDefault(interaction.guildId, {
      mode,
      channelId
    });
    if (!res.ok) {
      await interaction.reply({ embeds: [buildErrorEmbed("Failed to update guild panel default.")], ephemeral: true });
      return true;
    }

    await auditLog({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      action: "voice.panel.guild-default.select",
      details: res.panel?.guildDefault
    });

    return updateConsole(interaction, parsed.userId, parsed.channelId, `Guild default mode is now: ${mode}.`);
  }

  await interaction.reply({ embeds: [buildErrorEmbed("Unsupported VoiceMaster UI selection.")], ephemeral: true });
  return true;
}
