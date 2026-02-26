import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType
} from "discord.js";
import { Colors } from "../utils/discordOutput.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { normalizeStarboardConfig, starboardEmojiKey } from "../utils/starboard.js";
import { listReactionRoleBindings } from "../utils/reactionRoles.js";
import { listLevelRoleRewards } from "../game/levelRewards.js";
import { listGuildScripts, upsertGuildScript } from "../scripting/store.js";
import { validateScriptDefinition } from "../scripting/validator.js";
import { normalizeModLogConfig } from "../utils/modLogs.js";
import { normalizeTicketsConfig } from "../utils/tickets.js";
import { withTimeout } from "../utils/interactionTimeout.js";

const UI_PREFIX = "setupui";

const WELCOME_TEMPLATE = "Welcome {{user.mention}} to **{{guild.name}}**. Read the rules and enjoy your stay.";
const FAREWELL_TEMPLATE = "**{{user.name}}** has left {{guild.name}}.";

function parseId(customId) {
  const parts = String(customId || "").split(":");
  if (parts[0] !== UI_PREFIX || parts.length < 4) return null;
  return {
    kind: parts[1],
    action: parts[2],
    userId: parts[3],
    channelId: parts[4] || null
  };
}

function uiId(kind, action, userId, channelId) {
  return `${UI_PREFIX}:${kind}:${action}:${userId}:${channelId || "_"}`;
}

function pickChannelId(interaction, preferredChannelId = null) {
  const preferred = String(preferredChannelId || "").trim();
  if (/^\d{16,21}$/.test(preferred)) return preferred;
  if (interaction?.channelId) return interaction.channelId;
  return null;
}

async function ensureAutomationTemplate({ guildId, actorUserId, name, eventKey, channelId, message }) {
  const definition = validateScriptDefinition({
    trigger: { type: "event", value: channelId ? `${eventKey}@${channelId}` : eventKey },
    permissions: { mode: "everyone", roleIds: [] },
    variables: {},
    message: { content: message, embeds: [], buttons: [] }
  });
  return await upsertGuildScript({
    guildId,
    name,
    triggerType: "event",
    triggerValue: definition.trigger.value,
    definition,
    isActive: true,
    actorUserId,
    changeNote: "setup-wizard"
  });
}

function welcomeStatus(data) {
  const w = data?.welcome || {};
  return {
    enabled: Boolean(w.enabled),
    channelId: typeof w.channelId === "string" ? w.channelId : null
  };
}

function autoroleStatus(data) {
  const a = data?.autorole || {};
  return {
    enabled: Boolean(a.enabled),
    roleId: typeof a.roleId === "string" ? a.roleId : null
  };
}

async function buildStatusEmbed(guild, data, channelId, note = "") {
  const sbData = normalizeStarboardConfig(data);
  const sb = sbData.starboard;
  const reactionBindings = listReactionRoleBindings(data);
  const levelRewards = listLevelRoleRewards(data);
  const scripts = await listGuildScripts(guild.id, { activeOnly: false, limit: 100 }).catch(() => []);
  const eventAutomations = scripts.filter(s => String(s.trigger_type || "") === "event");
  const activeAutomations = eventAutomations.filter(s => s.is_active);

  const w = welcomeStatus(data);
  const ar = autoroleStatus(data);
  const modLogs = normalizeModLogConfig(data?.modLogs);
  const tickets = normalizeTicketsConfig({ tickets: data?.tickets }).tickets;

  const embed = new EmbedBuilder()
    .setTitle("Setup Wizard")
    .setColor(Colors.INFO)
    .setDescription(
      "Use controls below to quickly configure onboarding and engagement modules.\n" +
      (note ? `\nLast action: **${note}**` : "")
    )
    .addFields(
      {
        name: "Welcome",
        value: `Status: **${w.enabled ? "enabled" : "disabled"}**\nChannel: ${w.channelId ? `<#${w.channelId}>` : "not set"}`,
        inline: true
      },
      {
        name: "Autorole",
        value: `Status: **${ar.enabled ? "enabled" : "disabled"}**\nRole: ${ar.roleId ? `<@&${ar.roleId}>` : "not set"}`,
        inline: true
      },
      {
        name: "Starboard",
        value: `Status: **${sb.enabled ? "enabled" : "disabled"}**\nChannel: ${sb.channelId ? `<#${sb.channelId}>` : "not set"}\nThreshold: **${sb.threshold}**`,
        inline: true
      },
      {
        name: "Mod Logs",
        value: `Status: **${modLogs.enabled ? "enabled" : "disabled"}**\nChannel: ${modLogs.channelId ? `<#${modLogs.channelId}>` : "not set"}\nFailures: **${modLogs.includeFailures ? "on" : "off"}**`,
        inline: true
      },
      {
        name: "Tickets",
        value: `Status: **${tickets.enabled ? "enabled" : "disabled"}**\nCategory: ${tickets.categoryId ? `<#${tickets.categoryId}>` : "not set"}\nPanel: ${tickets.panelChannelId ? `<#${tickets.panelChannelId}>` : "not set"}`,
        inline: true
      },
      {
        name: "Automations",
        value: `Event automations: **${eventAutomations.length}**\nActive: **${activeAutomations.length}**`,
        inline: true
      },
      {
        name: "Reaction Roles",
        value: `Bindings: **${reactionBindings.length}**`,
        inline: true
      },
      {
        name: "Level Rewards",
        value: `Mappings: **${levelRewards.length}**`,
        inline: true
      },
      {
        name: "Wizard Target Channel",
        value: channelId ? `<#${channelId}>` : "none",
        inline: false
      }
    );

  // Leveling status (non-blocking)
  try {
    const { getGuildXpConfig } = await import('../utils/storage.js');
    const xpCfg = await getGuildXpConfig(guild.id).catch(() => null);
    embed.addFields({
      name: "⚡ Leveling",
      value: xpCfg ? `Status: **${xpCfg.enabled !== false ? 'enabled' : 'disabled'}**\nMultiplier: **${Number(xpCfg.xp_multiplier || 1).toFixed(1)}x**` : "Not configured",
      inline: true
    });
  } catch {}

  embed
    .setFooter({
      text: `Starboard emoji key: ${starboardEmojiKey(sb.emoji)}`
    })
    .setTimestamp();

  return embed;
}

function buildComponents(userId, channelId) {
  const actions = new StringSelectMenuBuilder()
    .setCustomId(uiId("menu", "action", userId, channelId))
    .setPlaceholder("Pick a setup action")
    .addOptions(
      { label: "Enable Welcome", value: "welcome_on", description: "Enable welcome in target channel" },
      { label: "Disable Welcome", value: "welcome_off", description: "Disable welcome messages" },
      { label: "Enable Starboard", value: "starboard_on", description: "Enable starboard in target channel" },
      { label: "Disable Starboard", value: "starboard_off", description: "Disable starboard" },
      { label: "Enable Mod Logs", value: "modlogs_on", description: "Route moderation logs to target channel" },
      { label: "Disable Mod Logs", value: "modlogs_off", description: "Disable moderation logs" },
      { label: "Create Welcome Automation", value: "auto_welcome", description: "Create/update join automation" },
      { label: "Create Farewell Automation", value: "auto_farewell", description: "Create/update leave automation" },
      { label: "⚡ Enable Leveling (Balanced)", value: "leveling_balanced", description: "Turn on guild XP with balanced rates" },
      { label: "⚡ Leveling: Relaxed Preset", value: "leveling_relaxed", description: "Slow, casual XP progression" },
      { label: "⚡ Leveling: Grind Preset", value: "leveling_grind", description: "Fast, competitive XP progression" },
      { label: "⚡ Disable Leveling", value: "leveling_off", description: "Turn off guild XP/leveling system" },
      { label: "🎭 Enable Agent Actions", value: "actions_defaults", description: "Enable all default agent economy actions" },
      { label: "🎮 Enable Fun Commands", value: "fun_on", description: "Allow /social, /card, /trivia, /casino in this server" },
    );

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(uiId("role", "autorole", userId, channelId))
    .setPlaceholder("Select autorole (or skip)")
    .setMinValues(0)
    .setMaxValues(1);

  const quickstart = new ButtonBuilder()
    .setCustomId(uiId("btn", "quickstart", userId, channelId))
    .setLabel("Quickstart")
    .setStyle(ButtonStyle.Primary);

  const disableAutorole = new ButtonBuilder()
    .setCustomId(uiId("btn", "autorole_off", userId, channelId))
    .setLabel("Disable Autorole")
    .setStyle(ButtonStyle.Secondary);

  const refresh = new ButtonBuilder()
    .setCustomId(uiId("btn", "refresh", userId, channelId))
    .setLabel("Refresh")
    .setStyle(ButtonStyle.Secondary);

  return [
    new ActionRowBuilder().addComponents(actions),
    new ActionRowBuilder().addComponents(roleSelect),
    new ActionRowBuilder().addComponents(quickstart, disableAutorole, refresh)
  ];
}

async function updateWizard(interaction, { userId, channelId, note = "" }) {
  const data = await loadGuildData(interaction.guildId);
  const embed = await buildStatusEmbed(interaction.guild, data, channelId, note);
  const components = buildComponents(userId, channelId);
  await interaction.update({ embeds: [embed], components });
}

export const meta = {
  deployGlobal: true,
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
  category: "admin"
};

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Guided setup wizard for key server modules")
  .addSubcommand(sub =>
    sub
      .setName("wizard")
      .setDescription("Open guided setup controls")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Target channel for welcome/starboard/templates")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub.setName("status").setDescription("Show current setup status summary")
  )
  .addSubcommand(sub =>
    sub
      .setName("leveling")
      .setDescription("Quick-configure per-guild XP leveling")
      .addStringOption(o => o.setName("preset").setDescription("Leveling preset").setRequired(false)
        .addChoices(
          { name: "🌿 Relaxed — slow, chill progression", value: "relaxed" },
          { name: "⚖️ Balanced — default rates", value: "balanced" },
          { name: "🔥 Grind — fast, high engagement", value: "grind" },
          { name: "🔴 Off — disable guild leveling", value: "off" },
        ))
      .addChannelOption(o => o.setName("levelup_channel").setDescription("Channel for level-up announcements").setRequired(false))
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);
  const targetChannel = interaction.options.getChannel("channel", false);
  const channelId = pickChannelId(interaction, targetChannel?.id);
  const guildData = await loadGuildData(interaction.guildId);

  if (sub === "status") {
    const embed = await buildStatusEmbed(interaction.guild, guildData, channelId);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === "leveling") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await withTimeout(interaction, async () => {
      const { upsertGuildXpConfig } = await import('../utils/storage.js');
      const preset = interaction.options.getString("preset") || "balanced";
      const lvlupCh = interaction.options.getChannel("levelup_channel");

      const PRESETS = {
        relaxed:  { enabled: true,  xp_per_message: 3,  xp_per_vc_minute: 1, xp_per_work: 20, xp_per_gather: 15, xp_per_fight_win: 25, xp_per_trivia_win: 30, xp_per_daily: 50, xp_multiplier: 1.0, message_xp_cooldown_s: 120 },
        balanced: { enabled: true,  xp_per_message: 5,  xp_per_vc_minute: 2, xp_per_work: 40, xp_per_gather: 30, xp_per_fight_win: 50, xp_per_trivia_win: 60, xp_per_daily: 80, xp_multiplier: 1.0, message_xp_cooldown_s: 60 },
        grind:    { enabled: true,  xp_per_message: 10, xp_per_vc_minute: 5, xp_per_work: 80, xp_per_gather: 60, xp_per_fight_win: 100, xp_per_trivia_win: 120, xp_per_daily: 160, xp_multiplier: 1.5, message_xp_cooldown_s: 30 },
        off:      { enabled: false },
      };

      const vals = { ...(PRESETS[preset] || PRESETS.balanced) };
      if (lvlupCh?.id) vals.levelup_channel_id = lvlupCh.id;
      await upsertGuildXpConfig(interaction.guildId, vals);

      const lines = [`✅ **Per-guild leveling configured** — preset: **${preset}**`];
      if (lvlupCh) lines.push(`📢 Level-up announcements → ${lvlupCh}`);
      lines.push('');
      lines.push('Fine-tune with `/xp config set`, `/xp config multiplier`, etc.');
      await interaction.editReply({ content: lines.join('\n') });
    }, { label: "setup" });
    return;
  }

  const embed = await buildStatusEmbed(interaction.guild, guildData, channelId);
  const components = buildComponents(interaction.user.id, channelId);
  await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

export async function handleSelect(interaction) {
  if (!interaction.isStringSelectMenu?.() && !interaction.isRoleSelectMenu?.()) return false;
  const parsed = parseId(interaction.customId);
  if (!parsed) return false;

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Panel Locked")
          .setDescription("This setup panel belongs to another user.")
          .setColor(Colors.ERROR)
      ],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const guildId = interaction.guildId;
  const targetChannelId = pickChannelId(interaction, parsed.channelId);
  const data = await loadGuildData(guildId);
  let note = "No changes.";

  if (interaction.isRoleSelectMenu?.() && parsed.kind === "role" && parsed.action === "autorole") {
    const roleId = interaction.values?.[0] || null;
    data.autorole ??= { enabled: false, roleId: null };
    if (!roleId) {
      data.autorole.enabled = false;
      data.autorole.roleId = null;
      note = "Autorole disabled.";
    } else {
      data.autorole.enabled = true;
      data.autorole.roleId = roleId;
      note = "Autorole updated.";
    }
    await saveGuildData(guildId, data);
    await updateWizard(interaction, { userId: parsed.userId, channelId: targetChannelId, note });
    return true;
  }

  if (!interaction.isStringSelectMenu?.()) return true;
  const action = interaction.values?.[0] || "";

  if (action === "welcome_on") {
    data.welcome ??= { enabled: false, channelId: null, message: "Welcome {user}!" };
    data.welcome.enabled = true;
    data.welcome.channelId = targetChannelId;
    note = "Welcome enabled.";
  } else if (action === "welcome_off") {
    data.welcome ??= { enabled: false, channelId: null, message: "Welcome {user}!" };
    data.welcome.enabled = false;
    note = "Welcome disabled.";
  } else if (action === "starboard_on") {
    data.starboard ??= {};
    data.starboard.enabled = true;
    data.starboard.channelId = targetChannelId;
    if (!data.starboard.emoji) data.starboard.emoji = "⭐";
    if (!data.starboard.threshold) data.starboard.threshold = 3;
    note = "Starboard enabled.";
  } else if (action === "starboard_off") {
    data.starboard ??= {};
    data.starboard.enabled = false;
    note = "Starboard disabled.";
  } else if (action === "modlogs_on") {
    data.modLogs = normalizeModLogConfig(data.modLogs);
    data.modLogs.enabled = true;
    data.modLogs.channelId = targetChannelId;
    note = "Moderation logs enabled.";
  } else if (action === "modlogs_off") {
    data.modLogs = normalizeModLogConfig(data.modLogs);
    data.modLogs.enabled = false;
    note = "Moderation logs disabled.";
  } else if (action === "auto_welcome") {
    await ensureAutomationTemplate({
      guildId,
      actorUserId: interaction.user.id,
      name: "setup_welcome_join",
      eventKey: "member_join",
      channelId: targetChannelId,
      message: WELCOME_TEMPLATE
    });
    note = "Welcome automation template created.";
  } else if (action === "auto_farewell") {
    await ensureAutomationTemplate({
      guildId,
      actorUserId: interaction.user.id,
      name: "setup_farewell_leave",
      eventKey: "member_leave",
      channelId: targetChannelId,
      message: FAREWELL_TEMPLATE
    });
    note = "Farewell automation template created.";
  } else if (action === "leveling_balanced" || action === "leveling_relaxed" || action === "leveling_grind") {
    const presetName = action.split("_")[1];
    const PRESETS = {
      relaxed:  { enabled: true, xp_per_message:3, xp_per_vc_minute:1, xp_per_work:20, xp_per_gather:15, xp_per_fight_win:25, xp_per_trivia_win:30, xp_per_daily:50, xp_multiplier:1.0, message_xp_cooldown_s:120 },
      balanced: { enabled: true, xp_per_message:5, xp_per_vc_minute:2, xp_per_work:40, xp_per_gather:30, xp_per_fight_win:50, xp_per_trivia_win:60, xp_per_daily:80, xp_multiplier:1.0, message_xp_cooldown_s:60 },
      grind:    { enabled: true, xp_per_message:10, xp_per_vc_minute:5, xp_per_work:80, xp_per_gather:60, xp_per_fight_win:100, xp_per_trivia_win:120, xp_per_daily:160, xp_multiplier:1.5, message_xp_cooldown_s:30 },
    };
    try {
      const { upsertGuildXpConfig } = await import('../utils/storage.js');
      const vals = { ...(PRESETS[presetName] || PRESETS.balanced) };
      if (targetChannelId) vals.levelup_channel_id = targetChannelId;
      await upsertGuildXpConfig(guildId, vals);
      note = `Leveling enabled with **${presetName}** preset.`;
    } catch (e) { note = `Leveling config error: ${e.message}`; }
  } else if (action === "leveling_off") {
    try {
      const { upsertGuildXpConfig } = await import('../utils/storage.js');
      await upsertGuildXpConfig(guildId, { enabled: false });
      note = "Leveling system disabled.";
    } catch (e) { note = `Leveling config error: ${e.message}`; }
  } else if (action === "actions_defaults") {
    try {
      const { getPool } = await import('../utils/storage_pg.js');
      const pg = getPool();
      const ACTION_DEFAULTS = [
        { action_type: 'air_horn', name: 'Air Horn', description: 'Agent plays an air horn', cost: 50, cooldown_s: 60 },
        { action_type: 'rickroll', name: 'Rickroll', description: 'Agent plays Never Gonna Give You Up', cost: 75, cooldown_s: 120 },
        { action_type: 'say_message', name: 'Say Message', description: 'Agent speaks a message via TTS', cost: 100, cooldown_s: 120 },
        { action_type: 'play_sound', name: 'Play Sound', description: 'Agent plays a sound clip', cost: 150, cooldown_s: 300 },
        { action_type: 'summon_dj', name: 'Summon DJ', description: 'Agent joins as DJ for 5 minutes', cost: 200, cooldown_s: 600 },
      ];
      for (const a of ACTION_DEFAULTS) {
        await pg.query(
          `INSERT INTO guild_agent_actions (guild_id, action_type, name, description, cost, cooldown_s, enabled, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,true,$7)
           ON CONFLICT (guild_id, action_type) DO NOTHING`,
          [guildId, a.action_type, a.name, a.description, a.cost, a.cooldown_s, Date.now()]
        ).catch(() => {});
      }
      note = "Default agent actions enabled (5 actions). Configure costs in `/actions admin` or the dashboard.";
    } catch (e) { note = `Actions setup error: ${e.message}`; }
  } else if (action === "fun_on") {
    const funCmds = ['social', 'card', 'trivia', 'casino', 'gather', 'fight'];
    try {
      const { setCommandEnabled } = await import('../utils/permissions.js');
      for (const cmd of funCmds) await setCommandEnabled(guildId, cmd, true).catch(() => {});
      note = `Fun commands enabled: ${funCmds.join(', ')}.`;
    } catch (e) { note = `Fun commands error: ${e.message}`; }
  }

  await saveGuildData(guildId, data);
  await updateWizard(interaction, { userId: parsed.userId, channelId: targetChannelId, note });
  return true;
}

export async function handleButton(interaction) {
  if (!interaction.isButton?.()) return false;
  const parsed = parseId(interaction.customId);
  if (!parsed) return false;

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Panel Locked")
          .setDescription("This setup panel belongs to another user.")
          .setColor(Colors.ERROR)
      ],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const guildId = interaction.guildId;
  const targetChannelId = pickChannelId(interaction, parsed.channelId);
  const data = await loadGuildData(guildId);
  let note = "";

  if (parsed.action === "autorole_off") {
    data.autorole ??= { enabled: false, roleId: null };
    data.autorole.enabled = false;
    note = "Autorole disabled.";
    await saveGuildData(guildId, data);
    await updateWizard(interaction, { userId: parsed.userId, channelId: targetChannelId, note });
    return true;
  }

  if (parsed.action === "quickstart") {
    data.welcome ??= { enabled: false, channelId: null, message: "Welcome {user}!" };
    data.welcome.enabled = true;
    data.welcome.channelId = targetChannelId;
    data.starboard ??= {};
    data.starboard.enabled = true;
    data.starboard.channelId = targetChannelId;
    data.starboard.emoji = data.starboard.emoji || "⭐";
    data.starboard.threshold = data.starboard.threshold || 3;
    data.modLogs = normalizeModLogConfig(data.modLogs);
    data.modLogs.enabled = true;
    data.modLogs.channelId = targetChannelId;
    await saveGuildData(guildId, data);

    await ensureAutomationTemplate({
      guildId,
      actorUserId: interaction.user.id,
      name: "setup_welcome_join",
      eventKey: "member_join",
      channelId: targetChannelId,
      message: WELCOME_TEMPLATE
    });
    await ensureAutomationTemplate({
      guildId,
      actorUserId: interaction.user.id,
      name: "setup_farewell_leave",
      eventKey: "member_leave",
      channelId: targetChannelId,
      message: FAREWELL_TEMPLATE
    });
    note = "Quickstart applied (welcome, starboard, mod logs, join/leave automations).";
    await updateWizard(interaction, { userId: parsed.userId, channelId: targetChannelId, note });
    return true;
  }

  if (parsed.action === "refresh") {
    await updateWizard(interaction, { userId: parsed.userId, channelId: targetChannelId, note: "Refreshed." });
    return true;
  }

  return false;
}

export default { data, execute, meta };
