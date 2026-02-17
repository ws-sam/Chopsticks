import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits
} from "discord.js";

export const PANEL_MODES = new Set(["temp", "dm", "channel", "here", "both", "off"]);
const ROOM_PANEL_PREFIX = "voiceroom";

export function ensurePanelConfig(voice) {
  if (!voice || typeof voice !== "object") return;
  voice.panel ??= {};
  voice.panel.guildDefault ??= {
    mode: "temp",
    channelId: null,
    autoSendOnCreate: true
  };
  voice.panel.userDefaults ??= {};
}

function normalizeMode(mode, fallback = "temp") {
  const value = String(mode || "").trim().toLowerCase();
  if (PANEL_MODES.has(value)) return value;
  return fallback;
}

export function resolvePanelDelivery(voice, userId) {
  ensurePanelConfig(voice);
  const guildDefault = voice.panel.guildDefault || {};
  const userDefault = voice.panel.userDefaults?.[userId] || {};

  return {
    mode: normalizeMode(userDefault.mode ?? guildDefault.mode, "temp"),
    channelId: String(userDefault.channelId || guildDefault.channelId || "").trim() || null,
    autoSendOnCreate:
      typeof userDefault.autoSendOnCreate === "boolean"
        ? userDefault.autoSendOnCreate
        : (typeof guildDefault.autoSendOnCreate === "boolean" ? guildDefault.autoSendOnCreate : true)
  };
}

function canSendInChannel(channel, me) {
  if (!channel?.isTextBased?.()) return false;
  if (channel.isDMBased?.()) return true;
  const perms = channel.permissionsFor(me);
  return Boolean(perms?.has(PermissionFlagsBits.SendMessages));
}

async function findConfiguredChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(channelId)
    ?? (await guild.channels.fetch(channelId).catch(() => null));
}

function firstWritableTextChannel(guild, me) {
  return guild.channels.cache.find(ch => canSendInChannel(ch, me)) || null;
}

async function resolveTextTarget({ guild, me, roomChannel, configuredChannelId, interactionChannel, mode }) {
  if (mode === "here") {
    if (canSendInChannel(interactionChannel, me)) return interactionChannel;
  }

  if (mode === "channel") {
    const configured = await findConfiguredChannel(guild, configuredChannelId);
    if (canSendInChannel(configured, me)) return configured;
    if (canSendInChannel(interactionChannel, me)) return interactionChannel;
  }

  if (mode === "temp" || mode === "both") {
    if (canSendInChannel(roomChannel, me)) return roomChannel;
    const configured = await findConfiguredChannel(guild, configuredChannelId);
    if (canSendInChannel(configured, me)) return configured;
  }

  if (mode === "here") {
    if (canSendInChannel(roomChannel, me)) return roomChannel;
  }

  if (canSendInChannel(guild.systemChannel, me)) return guild.systemChannel;
  return firstWritableTextChannel(guild, me);
}

export function buildVoiceRoomDashboardEmbed({ roomChannel, tempRecord, lobby, ownerUserId, reason = "manual" }) {
  const limit = Number.isFinite(roomChannel?.userLimit) ? roomChannel.userLimit : 0;
  const memberCount = roomChannel?.members?.filter?.(m => !m.user?.bot)?.size ?? 0;
  const lobbyLabel = tempRecord?.lobbyId ? `<#${tempRecord.lobbyId}>` : "n/a";
  const template = lobby?.nameTemplate || "{user}'s room";

  const reasonLabel =
    reason === "created"
      ? "Room created"
      : reason === "ownership-transfer"
        ? "Ownership updated"
        : "Requested";

  return new EmbedBuilder()
    .setTitle("Voice Room Dashboard")
    .setDescription(`${reasonLabel} for <#${roomChannel?.id}>`)
    .addFields(
      { name: "Owner", value: `<@${ownerUserId}>`, inline: true },
      { name: "Members", value: String(memberCount), inline: true },
      { name: "User Limit", value: String(limit), inline: true },
      { name: "Lobby", value: lobbyLabel, inline: true },
      { name: "Template", value: template, inline: true },
      {
        name: "Quick Controls",
        value: "Use the buttons below for instant room controls."
      }
    );
}

function makeRoomPanelCustomId(kind, roomChannelId) {
  return `${ROOM_PANEL_PREFIX}:${kind}:${roomChannelId}`;
}

function makeRoomPanelCustomIdWithGuild(kind, guildId, roomChannelId) {
  const gid = String(guildId || "").trim();
  if (!gid) return makeRoomPanelCustomId(kind, roomChannelId);
  return `${ROOM_PANEL_PREFIX}:${kind}:${gid}:${roomChannelId}`;
}

export function buildVoiceRoomDashboardComponents(
  roomChannelId,
  { disabled = false, controlsDisabled = false, includeDmButton = true, guildId = null } = {}
) {
  const makeId = guildId
    ? (kind => makeRoomPanelCustomIdWithGuild(kind, guildId, roomChannelId))
    : (kind => makeRoomPanelCustomId(kind, roomChannelId));

  const row1Buttons = [
    new ButtonBuilder()
      .setCustomId(makeId("refresh"))
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  ];

  if (includeDmButton) {
    row1Buttons.push(
      new ButtonBuilder()
        .setCustomId(makeId("dm"))
        .setLabel("DM Dashboard")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }

  row1Buttons.push(
    new ButtonBuilder()
      .setCustomId(makeId("release"))
      .setLabel("Release")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled || controlsDisabled)
  );

  return [
    new ActionRowBuilder().addComponents(
      ...row1Buttons
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(makeId("lock"))
        .setLabel("Lock")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || controlsDisabled),
      new ButtonBuilder()
        .setCustomId(makeId("unlock"))
        .setLabel("Unlock")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || controlsDisabled)
    )
  ];
}

export async function deliverVoiceRoomDashboard({
  guild,
  member,
  roomChannel,
  tempRecord,
  lobby,
  voice,
  modeOverride = null,
  interactionChannel = null,
  reason = "manual"
}) {
  ensurePanelConfig(voice);
  const me = guild?.members?.me ?? (await guild?.members?.fetchMe?.().catch(() => null));
  const resolved = resolvePanelDelivery(voice, member.id);

  let mode = normalizeMode(modeOverride || resolved.mode, "temp");

  if (reason === "created" && !resolved.autoSendOnCreate && !modeOverride) {
    return { ok: false, reason: "disabled" };
  }
  if (reason === "created" && mode === "here" && !modeOverride) {
    mode = "temp";
  }

  if (mode === "off") {
    return { ok: false, reason: "off" };
  }

  const embed = buildVoiceRoomDashboardEmbed({
    roomChannel,
    tempRecord,
    lobby,
    ownerUserId: tempRecord?.ownerId || member.id,
    reason
  });

  let dmSent = false;
  let channelSent = false;
  const errors = [];

  const isOwner = String(tempRecord?.ownerId || "") && String(tempRecord.ownerId) === String(member.id);
  const memberPerms = member?.permissions;
  const isAdmin = Boolean(
    memberPerms?.has?.(PermissionFlagsBits.ManageGuild) ||
    memberPerms?.has?.(PermissionFlagsBits.Administrator)
  );
  const controlsDisabled = !isOwner && !isAdmin;

  if (mode === "dm" || mode === "both") {
    try {
      const dmPayload = { embeds: [embed] };
      if (roomChannel?.id) {
        dmPayload.components = buildVoiceRoomDashboardComponents(roomChannel.id, {
          guildId: guild?.id,
          includeDmButton: false,
          controlsDisabled
        });
      }
      await member.send(dmPayload);
      dmSent = true;
    } catch (err) {
      errors.push(`dm:${err?.code ?? err?.message ?? "send-failed"}`);
    }
  }

  if (mode !== "dm") {
    const targetMode = mode === "both" ? "temp" : mode;
    const textTarget = await resolveTextTarget({
      guild,
      me,
      roomChannel,
      configuredChannelId: resolved.channelId,
      interactionChannel,
      mode: targetMode
    });

    if (textTarget && canSendInChannel(textTarget, me)) {
      try {
        const textPayload = { embeds: [embed] };
        if (!textTarget.isDMBased?.() && roomChannel?.id) {
          textPayload.components = buildVoiceRoomDashboardComponents(roomChannel.id);
        }
        await textTarget.send(textPayload);
        channelSent = true;
      } catch (err) {
        errors.push(`channel:${err?.code ?? err?.message ?? "send-failed"}`);
      }
    } else {
      errors.push("channel:missing-target");
    }
  }

  const ok = dmSent || channelSent;
  let deliveryReason = null;
  if (!ok) {
    if (errors.some(e => e.endsWith("missing-target"))) deliveryReason = "missing-target";
    else if (errors.length) deliveryReason = "send-failed";
    else deliveryReason = "unknown";
  }

  return {
    ok,
    dmSent,
    channelSent,
    mode,
    reason: deliveryReason,
    errors
  };
}
