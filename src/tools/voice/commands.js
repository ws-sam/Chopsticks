// src/tools/voice/commands.js
// UI-ONLY COMMAND DEFINITION

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder
} from "discord.js";

import * as VoiceDomain from "./domain.js";
import { getVoiceState } from "./schema.js";
import { auditLog } from "../../utils/audit.js";
import {
  buildVoiceRoomDashboardComponents,
  buildVoiceRoomDashboardEmbed,
  deliverVoiceRoomDashboard
} from "./panel.js";
import {
  refreshRegisteredRoomPanelsForRoom,
  showLiveRoomPanel,
  handleVoiceUIButton,
  handleVoiceUISelect,
  showVoiceConsole
} from "./ui.js";
import {
  buildCustomVcPanelMessage,
  handleCustomVcButton,
  handleCustomVcSelect,
  handleCustomVcModal,
  loadAndSaveCustomVcsConfig
} from "./customVcsUi.js";
import { ensureCustomVcsState, getCustomVcConfig } from "./customVcsState.js";
import {
  OWNER_PERMISSION_FIELDS,
  describeOwnerPermissions,
  ownerPermissionOverwrite
} from "./ownerPerms.js";
import { removeTempChannel } from "./state.js";

const adminSubs = new Set([
  "add",
  "setup",
  "remove",
  "enable",
  "disable",
  "update",
  "status",
  "reset",
  "panel_guild_default",
  "customs_setup",
  "customs_panel",
  "customs_status"
]);

const roomSubs = new Set([
  "room_status",
  "room_rename",
  "room_limit",
  "room_lock",
  "room_unlock",
  "room_panel",
  "room_claim",
  "room_release",
  "room_transfer",
  "panel"
]);

function hasAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function buildEmbed(title, description) {
  return new EmbedBuilder().setTitle(title).setDescription(description ?? "");
}

function buildErrorEmbed(message) {
  return buildEmbed("Voice error", message);
}

function buildSpawnDiagnosticsButton(userId, guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`voiceui:spawn_diag:${userId}:${guildId}`)
      .setLabel("Spawn Diagnostics")
      .setStyle(ButtonStyle.Secondary)
  );
}

function lobbyErrorMessage(code) {
  if (code === "lobby-not-found") return "That lobby is not registered.";
  if (code === "invalid-max-channels") return "Max rooms must be 1 or higher (or 0 for unlimited).";
  if (code === "invalid-ids") return "Invalid lobby or category selection.";
  return "Unable to update VoiceMaster configuration.";
}

function lobbySummary(lobby, tempCount) {
  const enabled = lobby.enabled ? "✅ Enabled" : "❌ Disabled";
  const limit = Number.isFinite(lobby.userLimit) && lobby.userLimit > 0 ? lobby.userLimit : "Unlimited";
  const bitrate = Number.isFinite(lobby.bitrateKbps) ? `${lobby.bitrateKbps}kbps` : "Auto";
  const maxChannels = Number.isFinite(lobby.maxChannels) && lobby.maxChannels > 0 ? lobby.maxChannels : "Unlimited";
  const categoryLabel = lobby.categoryId ? `<#${lobby.categoryId}>` : "n/a";
  const ownerPerms = describeOwnerPermissions(lobby.ownerPermissions);
  return [
    `**State:** ${enabled}`,
    `**Active Rooms:** ${tempCount}`,
    `**User Limit:** ${limit}`,
    `**Bitrate:** ${bitrate}`,
    `**Max Rooms:** ${maxChannels}`,
    `**Category:** ${categoryLabel}`,
    `**Owner Powers:** ${ownerPerms}`
  ].join("\n");
}

async function getRoomContext(interaction, { requireControl = true } = {}) {
  const member = interaction.member;
  const channel = member?.voice?.channel ?? null;
  if (!channel) return { ok: false, error: "not-in-voice" };

  const voice = await getVoiceState(interaction.guildId);
  if (!voice) return { ok: false, error: "no-voice-state" };
  voice.tempChannels ??= {};

  const temp = voice.tempChannels[channel.id];
  if (!temp) return { ok: false, error: "not-temp" };

  const isOwner = temp.ownerId === interaction.user.id;
  const isAdmin = hasAdmin(interaction);
  if (requireControl && !isOwner && !isAdmin) return { ok: false, error: "not-owner" };

  return { ok: true, channel, temp, isOwner, isAdmin, voice };
}

function roomErrorMessage(code) {
  if (code === "not-in-voice") return "Join a voice channel first.";
  if (code === "no-voice-state") return "Voice settings are not initialized yet.";
  if (code === "not-temp") return "This channel is not managed by VoiceMaster.";
  if (code === "not-owner") return "Only the room owner (or admins) can change this room.";
  return "Unable to complete that action.";
}

function panelDefaultErrorMessage(code, scope = "user") {
  if (code === "invalid-mode") return "Invalid delivery mode.";
  if (code === "invalid-auto-send") return "Auto-send value must be true or false.";
  if (code === "invalid-user") return "Unable to resolve the member for this setting.";
  return scope === "guild"
    ? "Unable to save guild panel defaults."
    : "Unable to save your panel preference.";
}

function inferPanelChannelId(interaction, mode, channel) {
  if (channel?.id) return channel.id;
  const needsChannel = mode === "channel" || mode === "both";
  if (!needsChannel) return undefined;
  if (interaction.channel?.isTextBased?.() && !interaction.channel?.isDMBased?.()) {
    return interaction.channelId;
  }
  return undefined;
}

function addOwnerPermissionOptions(sub) {
  let next = sub;
  for (const field of OWNER_PERMISSION_FIELDS) {
    next = next.addBooleanOption(o =>
      o
        .setName(field.option)
        .setDescription(`Owner can ${field.label.toLowerCase()}`)
    );
  }
  return next;
}

function readOwnerPermissionPatch(interaction) {
  const patch = {};
  let changed = false;
  for (const field of OWNER_PERMISSION_FIELDS) {
    const value = interaction.options.getBoolean(field.option);
    if (typeof value === "boolean") {
      patch[field.key] = value;
      changed = true;
    }
  }
  return changed ? patch : undefined;
}

const PANEL_MODE_CHOICES = [
  { name: "Room voice chat", value: "temp" },
  { name: "Direct message", value: "dm" },
  { name: "Configured text channel", value: "channel" },
  { name: "Where command was run", value: "here" },
  { name: "DM + room/channel", value: "both" },
  { name: "Off", value: "off" }
];

export const data = new SlashCommandBuilder()
  .setName("voice")
  .setDescription("VoiceMaster setup and room controls")

  .addSubcommand(sub =>
    addOwnerPermissionOptions(sub
      .setName("add")
      .setDescription("Register a lobby channel")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Voice channel users join")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
      .addChannelOption(o =>
        o
          .setName("category")
          .setDescription("Category for temp channels")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
      .addStringOption(o =>
        o
          .setName("template")
          .setDescription("Channel name template (use {user})")
      )
      .addIntegerOption(o =>
        o
          .setName("user_limit")
          .setDescription("User limit for temp channels (0 = unlimited)")
          .setMinValue(0)
          .setMaxValue(99)
      )
      .addIntegerOption(o =>
        o
          .setName("bitrate_kbps")
          .setDescription("Bitrate for temp channels (kbps)")
          .setMinValue(8)
          .setMaxValue(512)
      )
      .addIntegerOption(o =>
        o
          .setName("max_channels")
          .setDescription("Max temp channels per lobby")
          .setMinValue(0)
          .setMaxValue(99)
      )
    )
  )

  .addSubcommand(sub =>
    addOwnerPermissionOptions(sub
      .setName("setup")
      .setDescription("Create a lobby + category and register VoiceMaster")
      .addStringOption(o =>
        o
          .setName("lobby_name")
          .setDescription("Lobby voice channel name")
      )
      .addStringOption(o =>
        o
          .setName("category_name")
          .setDescription("Category for temp channels")
      )
      .addStringOption(o =>
        o
          .setName("template")
          .setDescription("Channel name template (use {user})")
      )
      .addIntegerOption(o =>
        o
          .setName("user_limit")
          .setDescription("User limit for temp channels (0 = unlimited)")
          .setMinValue(0)
          .setMaxValue(99)
      )
      .addIntegerOption(o =>
        o
          .setName("bitrate_kbps")
          .setDescription("Bitrate for temp channels (kbps)")
          .setMinValue(8)
          .setMaxValue(512)
      )
      .addIntegerOption(o =>
        o
          .setName("max_channels")
          .setDescription("Max temp channels per lobby")
          .setMinValue(0)
          .setMaxValue(99)
      )
    )
  )

  .addSubcommand(sub =>
    sub
      .setName("remove")
      .setDescription("Remove a lobby channel")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Lobby channel to remove")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("enable")
      .setDescription("Enable a lobby channel")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Lobby channel to enable")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("disable")
      .setDescription("Disable a lobby channel")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Lobby channel to disable")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
  )

  .addSubcommand(sub =>
    addOwnerPermissionOptions(sub
      .setName("update")
      .setDescription("Update lobby settings")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Lobby channel to update")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true)
      )
      .addStringOption(o =>
        o
          .setName("template")
          .setDescription("Channel name template (use {user})")
      )
      .addIntegerOption(o =>
        o
          .setName("user_limit")
          .setDescription("User limit for temp channels (0 = unlimited)")
          .setMinValue(0)
          .setMaxValue(99)
      )
      .addIntegerOption(o =>
        o
          .setName("bitrate_kbps")
          .setDescription("Bitrate for temp channels (kbps)")
          .setMinValue(8)
          .setMaxValue(512)
      )
      .addIntegerOption(o =>
        o
          .setName("max_channels")
          .setDescription("Max temp channels per lobby")
          .setMinValue(0)
          .setMaxValue(99)
      )
    )
  )

  .addSubcommand(sub =>
    sub
      .setName("status")
      .setDescription("Show current voice configuration")
  )

  .addSubcommand(sub =>
    sub
      .setName("reset")
      .setDescription("Reset all voice configuration")
  )

  .addSubcommand(sub =>
    sub
      .setName("room_status")
      .setDescription("Show your current room settings")
  )

  .addSubcommand(sub =>
    sub
      .setName("room_rename")
      .setDescription("Rename your current room")
      .addStringOption(o =>
        o
          .setName("name")
          .setDescription("New channel name")
          .setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("room_limit")
      .setDescription("Set user limit for your room")
      .addIntegerOption(o =>
        o
          .setName("limit")
          .setDescription("User limit (0 = unlimited)")
          .setMinValue(0)
          .setMaxValue(99)
          .setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("room_lock")
      .setDescription("Lock your room (deny Connect for @everyone)")
  )

  .addSubcommand(sub =>
    sub
      .setName("room_unlock")
      .setDescription("Unlock your room")
  )

  .addSubcommand(sub =>
    sub
      .setName("room_panel")
      .setDescription("Post a live room panel with dynamic buttons in this text channel")
  )

  .addSubcommand(sub =>
    sub
      .setName("room_claim")
      .setDescription("Claim room ownership when current owner is absent")
  )

  .addSubcommand(sub =>
    sub
      .setName("room_release")
      .setDescription("Release your room (delete it and move members out)")
  )

  .addSubcommand(sub =>
    sub
      .setName("room_transfer")
      .setDescription("Transfer room ownership to someone in the room")
      .addUserOption(o =>
        o
          .setName("user")
          .setDescription("New room owner (must be in the same voice channel)")
          .setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("panel")
      .setDescription("Send a room dashboard to your chosen destination")
      .addStringOption(o =>
        o
          .setName("delivery")
          .setDescription("Where to deliver the dashboard")
          .addChoices(...PANEL_MODE_CHOICES)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("console")
      .setDescription("Interactive VoiceMaster control panel")
  )

  .addSubcommand(sub =>
    sub
      .setName("panel_user_default")
      .setDescription("Set your default room dashboard delivery")
      .addStringOption(o =>
        o
          .setName("mode")
          .setDescription("Default delivery mode")
          .addChoices(...PANEL_MODE_CHOICES)
          .setRequired(true)
      )
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Preferred text channel for channel/both mode")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addBooleanOption(o =>
        o
          .setName("auto_send_on_create")
          .setDescription("Auto-send dashboard when your room is created")
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("panel_guild_default")
      .setDescription("Set guild-wide default room dashboard delivery")
      .addStringOption(o =>
        o
          .setName("mode")
          .setDescription("Default mode for members without user override")
          .addChoices(...PANEL_MODE_CHOICES.filter(choice => choice.value !== "here"))
          .setRequired(true)
      )
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Default text channel for channel/both mode")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addBooleanOption(o =>
        o
          .setName("auto_send_on_create")
          .setDescription("Auto-send dashboard on room creation by default")
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("customs_setup")
      .setDescription("Configure Custom VCs (Manage Server)")
      .addBooleanOption(o =>
        o
          .setName("enabled")
          .setDescription("Enable or disable Custom VCs")
      )
      .addChannelOption(o =>
        o
          .setName("category")
          .setDescription("Category where custom voice channels are created")
          .addChannelTypes(ChannelType.GuildCategory)
      )
      .addRoleOption(o =>
        o
          .setName("mod_role")
          .setDescription("Role that can always join any custom VC (Voice Mods)")
      )
      .addBooleanOption(o =>
        o
          .setName("clear_mod_roles")
          .setDescription("Clear all Voice Mod roles from this feature")
      )
      .addIntegerOption(o =>
        o
          .setName("max_rooms_per_user")
          .setDescription("Max custom rooms per user")
          .setMinValue(1)
          .setMaxValue(5)
      )
      .addIntegerOption(o =>
        o
          .setName("default_user_limit")
          .setDescription("Default VC size (0 = unlimited)")
          .setMinValue(0)
          .setMaxValue(99)
      )
      .addIntegerOption(o =>
        o
          .setName("default_bitrate_kbps")
          .setDescription("Default bitrate for custom VCs (kbps)")
          .setMinValue(8)
          .setMaxValue(512)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("customs_panel")
      .setDescription("Post a Custom VCs request panel (Manage Server)")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Text channel where the panel should be posted")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("customs_status")
      .setDescription("Show Custom VCs configuration (Manage Server)")
  );

export async function execute(interaction) {
  if (!interaction.inGuild()) return;

  const guildId = interaction.guildId;
  const sub = interaction.options.getSubcommand();

  if (adminSubs.has(sub) && !hasAdmin(interaction)) {
    await interaction.reply({
      embeds: [buildErrorEmbed("Manage Server permission required for this command.")],
      ephemeral: true
    });
    return;
  }

  if (sub === "add") {
    const category = interaction.options.getChannel("category");
    const me = interaction.guild?.members?.me ?? (await interaction.guild?.members?.fetchMe().catch(() => null));
    if (me) {
      const perms = category.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.ManageChannels) || !perms?.has(PermissionFlagsBits.MoveMembers)) {
        await interaction.reply({
          embeds: [buildErrorEmbed("Missing permissions in that category (Manage Channels + Move Members required).")],
          ephemeral: true
        });
        return;
      }
    }
    const lobbyChannel = interaction.options.getChannel("channel");
    const res = await VoiceDomain.addLobby(
      guildId,
      lobbyChannel.id,
      category.id,
      interaction.options.getString("template") ?? "{user}'s room",
      {
        userLimit: interaction.options.getInteger("user_limit"),
        bitrateKbps: interaction.options.getInteger("bitrate_kbps"),
        maxChannels: interaction.options.getInteger("max_channels"),
        ownerPermissions: readOwnerPermissionPatch(interaction)
      }
    );
    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: "voice.lobby.add",
      details: res
    });
    if (!res.ok) {
      await interaction.reply({
        embeds: [buildErrorEmbed(lobbyErrorMessage(res.error))],
        ephemeral: true
      });
      return;
    }
    const status = res.action === "exists" ? "Lobby already registered." : "Lobby added.";
    const embed = buildEmbed(
      "Voice lobby",
      `${status}\nLobby: <#${lobbyChannel.id}>\nCategory: <#${category.id}>`
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "customs_setup") {
    const patch = {};
    const enabled = interaction.options.getBoolean("enabled");
    const category = interaction.options.getChannel("category");
    const modRole = interaction.options.getRole("mod_role");
    const clearModRoles = interaction.options.getBoolean("clear_mod_roles");
    const maxRoomsPerUser = interaction.options.getInteger("max_rooms_per_user");
    const defaultUserLimit = interaction.options.getInteger("default_user_limit");
    const defaultBitrateKbps = interaction.options.getInteger("default_bitrate_kbps");

    if (typeof enabled === "boolean") patch.enabled = enabled;
    if (category) patch.categoryId = category.id;
    if (modRole) patch.modRoleId = modRole.id;
    if (typeof clearModRoles === "boolean" && clearModRoles) patch.clearModRoles = true;
    if (typeof maxRoomsPerUser === "number") patch.maxRoomsPerUser = maxRoomsPerUser;
    if (typeof defaultUserLimit === "number") patch.defaultUserLimit = defaultUserLimit;
    if (typeof defaultBitrateKbps === "number") patch.defaultBitrateKbps = defaultBitrateKbps;

    const res = await loadAndSaveCustomVcsConfig(guildId, patch);
    const cfg = res.cfg;

    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: "voice.customvc.setup",
      details: patch
    }).catch(() => {});

    const modRoles = Array.isArray(cfg.modRoleIds) && cfg.modRoleIds.length
      ? cfg.modRoleIds.map(id => `<@&${id}>`).join(", ")
      : "none";
    const text = [
      `Enabled: ${cfg.enabled ? "yes" : "no"}`,
      `Category: ${cfg.categoryId ? `<#${cfg.categoryId}>` : "not set"}`,
      `Voice Mod roles: ${modRoles}`,
      `Max rooms per user: ${cfg.maxRoomsPerUser || 1}`,
      `Default VC size: ${cfg.defaultUserLimit ? String(cfg.defaultUserLimit) : "unlimited"}`,
      `Default bitrate: ${cfg.defaultBitrateKbps ? `${cfg.defaultBitrateKbps}kbps` : "server default"}`
    ].join("\n");

    await interaction.reply({
      embeds: [buildEmbed("Custom VCs configured", text)],
      ephemeral: true
    });
    return;
  }

  if (sub === "customs_panel") {
    const voice = await getVoiceState(guildId);
    ensureCustomVcsState(voice);
    const cfg = getCustomVcConfig(voice);

    const target = interaction.options.getChannel("channel")
      ?? (interaction.channel?.isTextBased?.() && !interaction.channel?.isDMBased?.() ? interaction.channel : null);

    if (!target?.isTextBased?.() || target.isDMBased?.()) {
      await interaction.reply({
        embeds: [buildErrorEmbed("Run this in a text channel or provide a target channel.")],
        ephemeral: true
      });
      return;
    }

    let message = null;
    if (cfg.panelChannelId && cfg.panelMessageId && cfg.panelChannelId === target.id) {
      message = await target.messages.fetch(cfg.panelMessageId).catch(() => null);
      if (message) {
        await message.edit(buildCustomVcPanelMessage(cfg)).catch(() => {});
      }
    }
    if (!message) {
      message = await target.send(buildCustomVcPanelMessage(cfg)).catch(() => null);
    }
    if (!message) {
      await interaction.reply({
        embeds: [buildErrorEmbed("Failed to post the Custom VCs panel in that channel.")],
        ephemeral: true
      });
      return;
    }

    await loadAndSaveCustomVcsConfig(guildId, { panelChannelId: message.channelId, panelMessageId: message.id });
    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: "voice.customvc.panel",
      details: { channelId: message.channelId, messageId: message.id }
    }).catch(() => {});

    await interaction.reply({
      embeds: [buildEmbed("Custom VCs panel posted", `Panel posted in <#${message.channelId}>.`)],
      ephemeral: true
    });
    return;
  }

  if (sub === "customs_status") {
    const voice = await getVoiceState(guildId);
    ensureCustomVcsState(voice);
    const cfg = getCustomVcConfig(voice);
    const roomCount = Object.keys(voice.customRooms || {}).length;
    const modRoles = Array.isArray(cfg.modRoleIds) && cfg.modRoleIds.length
      ? cfg.modRoleIds.map(id => `<@&${id}>`).join(", ")
      : "none";

    const text = [
      `Enabled: ${cfg.enabled ? "yes" : "no"}`,
      `Category: ${cfg.categoryId ? `<#${cfg.categoryId}>` : "not set"}`,
      `Panel: ${cfg.panelMessageId ? `set (<#${cfg.panelChannelId}>)` : "not set"}`,
      `Voice Mod roles: ${modRoles}`,
      `Max rooms per user: ${cfg.maxRoomsPerUser || 1}`,
      `Default VC size: ${cfg.defaultUserLimit ? String(cfg.defaultUserLimit) : "unlimited"}`,
      `Default bitrate: ${cfg.defaultBitrateKbps ? `${cfg.defaultBitrateKbps}kbps` : "server default"}`,
      `Active custom rooms tracked: ${roomCount}`
    ].join("\n");

    await interaction.reply({
      embeds: [buildEmbed("Custom VCs status", text)],
      ephemeral: true
    });
    return;
  }

  if (sub === "setup") {
    const guild = interaction.guild;
    const me = guild?.members?.me ?? (await guild?.members?.fetchMe().catch(() => null));
    if (me) {
      const perms = me.permissions;
      if (!perms?.has(PermissionFlagsBits.ManageChannels) || !perms?.has(PermissionFlagsBits.MoveMembers)) {
        await interaction.reply({
          embeds: [buildErrorEmbed("Missing permissions (Manage Channels + Move Members required).")],
          ephemeral: true
        });
        return;
      }
    }

    const lobbyName = interaction.options.getString("lobby_name") ?? "Join to Create";
    const categoryName = interaction.options.getString("category_name") ?? "Voice Rooms";
    const template = interaction.options.getString("template") ?? "{user}'s room";

    let category = guild.channels.cache.find(
      ch => ch.type === ChannelType.GuildCategory && ch.name === categoryName
    ) ?? null;

    if (!category) {
      category = await guild.channels.create({
        name: categoryName,
        type: ChannelType.GuildCategory
      });
    }

    let lobby = guild.channels.cache.find(
      ch => ch.type === ChannelType.GuildVoice && ch.name === lobbyName && ch.parentId === category.id
    ) ?? null;

    if (!lobby) {
      lobby = await guild.channels.create({
        name: lobbyName,
        type: ChannelType.GuildVoice,
        parent: category.id
      });
    }

    const res = await VoiceDomain.addLobby(
      guildId,
      lobby.id,
      category.id,
      template,
      {
        userLimit: interaction.options.getInteger("user_limit"),
        bitrateKbps: interaction.options.getInteger("bitrate_kbps"),
        maxChannels: interaction.options.getInteger("max_channels"),
        ownerPermissions: readOwnerPermissionPatch(interaction)
      }
    );

    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: "voice.lobby.setup",
      details: res
    });
    if (!res.ok) {
      await interaction.reply({
        embeds: [buildErrorEmbed(lobbyErrorMessage(res.error))],
        ephemeral: true
      });
      return;
    }

    const embed = buildEmbed(
      "Voice setup",
      `Lobby: <#${lobby.id}>\nCategory: <#${category.id}>\nTemplate: ${template}`
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "remove") {
    const lobbyChannel = interaction.options.getChannel("channel");
    const res = await VoiceDomain.removeLobby(guildId, lobbyChannel.id);
    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: "voice.lobby.remove",
      details: res
    });
    if (!res.ok) {
      await interaction.reply({
        embeds: [buildErrorEmbed(lobbyErrorMessage(res.error))],
        ephemeral: true
      });
      return;
    }
    const embed = buildEmbed("Voice lobby removed", `Lobby: <#${lobbyChannel.id}>`);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "enable" || sub === "disable") {
    const lobbyChannel = interaction.options.getChannel("channel");
    const res = await VoiceDomain.setLobbyEnabled(
      guildId,
      lobbyChannel.id,
      sub === "enable"
    );
    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: `voice.lobby.${sub}`,
      details: res
    });
    if (!res.ok) {
      await interaction.reply({
        embeds: [buildErrorEmbed(lobbyErrorMessage(res.error))],
        ephemeral: true
      });
      return;
    }
    const embed = buildEmbed(
      "Voice lobby updated",
      `Lobby: <#${lobbyChannel.id}>\nState: ${sub === "enable" ? "enabled" : "disabled"}`
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "update") {
    const lobbyChannel = interaction.options.getChannel("channel");
    const maxChannelsRaw = interaction.options.getInteger("max_channels");
    const maxChannels =
      maxChannelsRaw === null ? undefined : (maxChannelsRaw === 0 ? null : maxChannelsRaw);
    const res = await VoiceDomain.updateLobby(
      guildId,
      lobbyChannel.id,
      {
        template: interaction.options.getString("template") ?? undefined,
        userLimit: interaction.options.getInteger("user_limit"),
        bitrateKbps: interaction.options.getInteger("bitrate_kbps"),
        maxChannels,
        ownerPermissions: readOwnerPermissionPatch(interaction)
      }
    );
    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: "voice.lobby.update",
      details: res
    });
    if (!res.ok) {
      await interaction.reply({
        embeds: [buildErrorEmbed(lobbyErrorMessage(res.error))],
        ephemeral: true
      });
      return;
    }
    const embed = buildEmbed("Voice lobby updated", `Lobby: <#${lobbyChannel.id}>`);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "status") {
    const res = await VoiceDomain.getStatus(guildId);
    const entries = Object.entries(res.lobbies ?? {});
    if (!entries.length) {
      const embed = buildEmbed(
        "Voice status",
        "No lobbies configured. Use /voice add or /voice setup to register a lobby."
      );
      await interaction.reply({
        embeds: [embed],
        components: [buildSpawnDiagnosticsButton(interaction.user.id, guildId)],
        ephemeral: true
      });
      return;
    }
    const tempChannels = Object.values(res.tempChannels ?? {});
    const activeLobbyIds = new Set(tempChannels.map(t => t?.lobbyId).filter(Boolean));
    const panelDefault = res.panel?.guildDefault ?? { mode: "temp", autoSendOnCreate: true, channelId: null };
    const embed = buildEmbed(
      "Voice status",
      `Lobbies: ${entries.length}\nActive rooms: ${tempChannels.length}\nLive lobbies in use: ${activeLobbyIds.size}\nPanel default: ${panelDefault.mode} (auto-send: ${panelDefault.autoSendOnCreate ? "on" : "off"})${panelDefault.channelId ? ` in <#${panelDefault.channelId}>` : ""}`
    );
    const maxFields = 20;
    entries.slice(0, maxFields).forEach(([channelId, lobby]) => {
      const tempCount = tempChannels.filter(temp => temp.lobbyId === channelId).length;
      embed.addFields({
        name: `<#${channelId}>`,
        value: lobbySummary(lobby, tempCount)
      });
    });
    if (entries.length > maxFields) {
      embed.addFields({
        name: "More",
        value: `Additional lobbies: ${entries.length - maxFields}`
      });
    }
    await interaction.reply({
      embeds: [embed],
      components: [buildSpawnDiagnosticsButton(interaction.user.id, guildId)],
      ephemeral: true
    });
    return;
  }

  if (sub === "reset") {
    const res = await VoiceDomain.resetVoice(guildId);
    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: "voice.lobby.reset",
      details: res
    });
    const embed = buildEmbed("Voice reset", "All lobbies and temp channel records cleared.");
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "console") {
    await showVoiceConsole(interaction);
    return;
  }

  if (sub === "room_panel") {
    await showLiveRoomPanel(interaction);
    return;
  }

  if (sub === "panel_user_default") {
    const mode = interaction.options.getString("mode", true);
    const channel = interaction.options.getChannel("channel");
    const autoSendOnCreate = interaction.options.getBoolean("auto_send_on_create");
    const channelId = inferPanelChannelId(interaction, mode, channel);

    if (mode === "channel" && !channelId) {
      await interaction.reply({
        embeds: [buildErrorEmbed("Choose a text channel or run this command in one.")],
        ephemeral: true
      });
      return;
    }

    const result = await VoiceDomain.setPanelUserDefault(guildId, interaction.user.id, {
      mode,
      channelId,
      autoSendOnCreate
    });
    if (!result.ok) {
      await interaction.reply({
        embeds: [buildErrorEmbed(panelDefaultErrorMessage(result.error, "user"))],
        ephemeral: true
      });
      return;
    }
    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: "voice.panel.user-default",
      details: result.userDefault ?? { mode, channelId, autoSendOnCreate }
    });
    await interaction.reply({
      embeds: [buildEmbed("Voice panel default saved", `Mode: ${mode}\nChannel: ${channelId ? `<#${channelId}>` : "auto"}\nAuto-send on create: ${typeof autoSendOnCreate === "boolean" ? (autoSendOnCreate ? "on" : "off") : "unchanged"}`)],
      ephemeral: true
    });
    return;
  }

  if (sub === "panel_guild_default") {
    const mode = interaction.options.getString("mode", true);
    const channel = interaction.options.getChannel("channel");
    const autoSendOnCreate = interaction.options.getBoolean("auto_send_on_create");
    const channelId = inferPanelChannelId(interaction, mode, channel);

    if (mode === "channel" && !channelId) {
      await interaction.reply({
        embeds: [buildErrorEmbed("Choose a text channel or run this command in one.")],
        ephemeral: true
      });
      return;
    }

    const result = await VoiceDomain.setPanelGuildDefault(guildId, {
      mode,
      channelId,
      autoSendOnCreate
    });
    if (!result.ok) {
      await interaction.reply({
        embeds: [buildErrorEmbed(panelDefaultErrorMessage(result.error, "guild"))],
        ephemeral: true
      });
      return;
    }
    await auditLog({
      guildId,
      userId: interaction.user.id,
      action: "voice.panel.guild-default",
      details: result.panel?.guildDefault ?? { mode, channelId, autoSendOnCreate }
    });
    await interaction.reply({
      embeds: [buildEmbed("Voice panel guild default saved", `Mode: ${mode}\nChannel: ${channelId ? `<#${channelId}>` : "auto"}\nAuto-send on create: ${typeof autoSendOnCreate === "boolean" ? (autoSendOnCreate ? "on" : "off") : "unchanged"}`)],
      ephemeral: true
    });
    return;
  }

  if (roomSubs.has(sub)) {
    const requireControl = !new Set(["room_status", "room_claim", "panel"]).has(sub);
    const ctx = await getRoomContext(interaction, { requireControl });
    if (!ctx.ok) {
      await interaction.reply({ embeds: [buildErrorEmbed(roomErrorMessage(ctx.error))], ephemeral: true });
      return;
    }
    const { channel, voice } = ctx;
    const everyoneId = interaction.guild?.roles?.everyone?.id;

    const lobby = voice?.lobbies?.[ctx.temp.lobbyId];
    const ownerOverwrite = ownerPermissionOverwrite(lobby?.ownerPermissions);

    try {

      if (sub === "room_status") {
      const lobbyId = ctx.temp.lobbyId ? `<#${ctx.temp.lobbyId}>` : "n/a";
      const limit = Number.isFinite(channel.userLimit) ? channel.userLimit : 0;
      const overwrite = everyoneId ? channel.permissionOverwrites.cache.get(everyoneId) : null;
      const locked = Boolean(overwrite?.deny?.has(PermissionFlagsBits.Connect));
      const embed = buildEmbed(
        "Room status",
        `Lobby: ${lobbyId}\nOwner: <@${ctx.temp.ownerId}>\nLimit: ${limit}\nLocked: ${locked ? "yes" : "no"}`
      );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === "room_claim") {
      if (ctx.isOwner) {
        await interaction.reply({
          embeds: [buildErrorEmbed("You already own this room.")],
          ephemeral: true
        });
        return;
      }

      const ownerPresent = channel.members.has(ctx.temp.ownerId);
      if (ownerPresent && !ctx.isAdmin) {
        await interaction.reply({
          embeds: [buildErrorEmbed("Current owner is still in the room. Ask them to transfer ownership.")],
          ephemeral: true
        });
        return;
      }

      const res = await VoiceDomain.transferTempOwnership(guildId, channel.id, interaction.user.id);
      if (!res.ok) {
        await interaction.reply({
          embeds: [buildErrorEmbed("Unable to claim this room right now.")],
          ephemeral: true
        });
        return;
      }

      await channel.permissionOverwrites
        .edit(interaction.user.id, ownerOverwrite)
        .catch(() => {});

      if (channel.permissionOverwrites.cache.has(ctx.temp.ownerId)) {
        await channel.permissionOverwrites.delete(ctx.temp.ownerId).catch(() => {});
      }

      if (lobby?.nameTemplate?.includes?.("{user}")) {
        const nextName = lobby.nameTemplate.replace("{user}", interaction.member?.displayName ?? interaction.user.username).slice(0, 90);
        if (nextName && nextName !== channel.name) {
          await channel.setName(nextName).catch(() => {});
        }
      }

      await auditLog({
        guildId,
        userId: interaction.user.id,
        action: "voice.room.claim",
        details: { channelId: channel.id, previousOwnerId: ctx.temp.ownerId, ownerId: interaction.user.id }
      });

      await interaction.reply({
        embeds: [buildEmbed("Room claimed", `You now own <#${channel.id}>.`)],
        ephemeral: true
      });
      await deliverVoiceRoomDashboard({
        guild: interaction.guild,
        member: interaction.member,
        roomChannel: channel,
        tempRecord: { ...ctx.temp, ownerId: interaction.user.id },
        lobby,
        voice,
        modeOverride: null,
        interactionChannel: interaction.channel,
        reason: "ownership-transfer"
      }).catch(() => {});
      await refreshRegisteredRoomPanelsForRoom(interaction.guild, channel.id, "claim").catch(() => {});
      return;
    }

    if (sub === "room_release") {
      const lobbyChannelId = ctx.temp?.lobbyId ?? null;
      const lobbyChannel = lobbyChannelId
        ? (interaction.guild.channels.cache.get(lobbyChannelId)
          ?? (await interaction.guild.channels.fetch(lobbyChannelId).catch(() => null)))
        : null;
      const canMoveToLobby = Boolean(lobbyChannel && lobbyChannel.type === ChannelType.GuildVoice);

      const humans = Array.from(channel.members.values()).filter(m => !m.user?.bot);
      for (const m of humans) {
        try {
          if (canMoveToLobby) await m.voice?.setChannel?.(lobbyChannel).catch(() => {});
          else await m.voice?.setChannel?.(null).catch(() => {});
        } catch {}
      }

      await removeTempChannel(guildId, channel.id, voice).catch(() => {});
      await channel.delete().catch(() => {});

      await auditLog({
        guildId,
        userId: interaction.user.id,
        action: "voice.room.release",
        details: { channelId: channel.id, lobbyId: lobbyChannelId, moved: humans.length }
      });

      await interaction.reply({
        embeds: [buildEmbed("Room released", "Room deleted.")],
        ephemeral: true
      });
      await refreshRegisteredRoomPanelsForRoom(interaction.guild, channel.id, "deleted").catch(() => {});
      return;
    }

    if (sub === "room_rename") {
      const name = interaction.options.getString("name", true).slice(0, 90);
      await channel.setName(name);
      const embed = buildEmbed("Room updated", `Name set to: ${name}`);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === "room_limit") {
      const limit = interaction.options.getInteger("limit", true);
      await channel.setUserLimit(limit);
      const embed = buildEmbed("Room updated", `User limit set to ${limit}.`);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === "room_lock") {
      if (!everyoneId) {
        await interaction.reply({ embeds: [buildErrorEmbed("Unable to resolve @everyone role.")], ephemeral: true });
        return;
      }
      await channel.permissionOverwrites.edit(everyoneId, { Connect: false });
      const embed = buildEmbed("Room locked", "Connect is denied for @everyone.");
      await interaction.reply({ embeds: [embed], ephemeral: true });
      await refreshRegisteredRoomPanelsForRoom(interaction.guild, channel.id, "lock").catch(() => {});
      return;
    }

    if (sub === "room_unlock") {
      if (!everyoneId) {
        await interaction.reply({ embeds: [buildErrorEmbed("Unable to resolve @everyone role.")], ephemeral: true });
        return;
      }
      if (channel.permissionOverwrites.cache.has(everyoneId)) {
        await channel.permissionOverwrites.delete(everyoneId);
      }
      const embed = buildEmbed("Room unlocked", "Connect permissions restored to category defaults.");
      await interaction.reply({ embeds: [embed], ephemeral: true });
      await refreshRegisteredRoomPanelsForRoom(interaction.guild, channel.id, "unlock").catch(() => {});
      return;
    }

    if (sub === "room_transfer") {
      const target = interaction.options.getUser("user", true);
      if (target.bot) {
        await interaction.reply({
          embeds: [buildErrorEmbed("Cannot transfer ownership to a bot.")],
          ephemeral: true
        });
        return;
      }
      if (!channel.members.has(target.id)) {
        await interaction.reply({
          embeds: [buildErrorEmbed("Target user must be in your voice room.")],
          ephemeral: true
        });
        return;
      }

      const res = await VoiceDomain.transferTempOwnership(guildId, channel.id, target.id);
      if (!res.ok) {
        await interaction.reply({
          embeds: [buildErrorEmbed("Unable to transfer ownership right now.")],
          ephemeral: true
        });
        return;
      }

      await channel.permissionOverwrites
        .edit(target.id, ownerOverwrite)
        .catch(() => {});

      if (ctx.temp.ownerId && channel.permissionOverwrites.cache.has(ctx.temp.ownerId)) {
        await channel.permissionOverwrites.delete(ctx.temp.ownerId).catch(() => {});
      }

      const targetMember = channel.members.get(target.id) ?? null;
      if (lobby?.nameTemplate?.includes?.("{user}") && targetMember) {
        const nextName = lobby.nameTemplate.replace("{user}", targetMember.displayName).slice(0, 90);
        if (nextName && nextName !== channel.name) {
          await channel.setName(nextName).catch(() => {});
        }
      }

      await auditLog({
        guildId,
        userId: interaction.user.id,
        action: "voice.room.transfer",
        details: { channelId: channel.id, previousOwnerId: ctx.temp.ownerId, ownerId: target.id }
      });

      await interaction.reply({
        embeds: [buildEmbed("Room transferred", `Ownership transferred to <@${target.id}>.`)],
        ephemeral: true
      });
      if (targetMember) {
        await deliverVoiceRoomDashboard({
          guild: interaction.guild,
          member: targetMember,
          roomChannel: channel,
          tempRecord: { ...ctx.temp, ownerId: target.id },
          lobby,
          voice,
          modeOverride: null,
          interactionChannel: interaction.channel,
          reason: "ownership-transfer"
        }).catch(() => {});
      }
      await refreshRegisteredRoomPanelsForRoom(interaction.guild, channel.id, "transfer").catch(() => {});
      return;
    }

    if (sub === "panel") {
      const delivery = interaction.options.getString("delivery");
      const sent = await deliverVoiceRoomDashboard({
        guild: interaction.guild,
        member: interaction.member,
        roomChannel: channel,
        tempRecord: ctx.temp,
        lobby,
        voice,
        modeOverride: delivery || null,
        interactionChannel: interaction.channel,
        reason: "manual"
      });

      if (!sent.ok && (sent.mode === "dm" || delivery === "dm")) {
        const embed = buildVoiceRoomDashboardEmbed({
          roomChannel: channel,
          tempRecord: ctx.temp,
          lobby,
          ownerUserId: interaction.user.id,
          reason: "manual"
        });
        embed.setFooter({ text: "DM failed. Enable DMs from server members, or choose a different delivery mode." });
        await interaction.reply({
          embeds: [embed],
          components: buildVoiceRoomDashboardComponents(channel.id),
          ephemeral: true
        });
        return;
      }

      const status = sent.ok
        ? `Delivered (DM: ${sent.dmSent ? "yes" : "no"}, channel: ${sent.channelSent ? "yes" : "no"}).`
        : sent.reason === "missing-target"
          ? "No writable destination found. Set `/voice panel_user_default` with a channel or run in a text channel."
          : sent.reason === "off"
            ? "Panel delivery is currently off. Change your default mode first."
            : "Panel delivery failed. Check bot permissions for DM/text channels.";
      await interaction.reply({
        embeds: [buildEmbed("Voice panel", status)],
        ephemeral: true
      });
      return;
    }
    } catch {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          embeds: [buildErrorEmbed("Voice room action failed. Please try again.")],
          ephemeral: true
        }).catch(() => {});
      } else {
        await interaction.reply({
          embeds: [buildErrorEmbed("Voice room action failed. Please try again.")],
          ephemeral: true
        });
      }
      return;
    }
  }
}

export async function handleButton(interaction) {
  if (await handleCustomVcButton(interaction)) return true;
  return handleVoiceUIButton(interaction);
}

export async function handleSelect(interaction) {
  if (await handleCustomVcSelect(interaction)) return true;
  return handleVoiceUISelect(interaction);
}

export async function handleModal(interaction) {
  if (await handleCustomVcModal(interaction)) return true;
  return false;
}
