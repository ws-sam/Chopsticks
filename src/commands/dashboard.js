/**
 * /dashboard — Discord-native server setup dashboard
 * Full button UI for configuring all major bot modules inline.
 * All interactions are ephemeral and user-scoped.
 */

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  MessageFlags,
} from "discord.js";
import { Colors } from "../utils/discordOutput.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { normalizeModLogConfig } from "../utils/modLogs.js";
import { normalizeTicketsConfig } from "../utils/tickets.js";
import { normalizeStarboardConfig, starboardEmojiKey } from "../utils/starboard.js";
import { listLevelRoleRewards } from "../game/levelRewards.js";
import { listReactionRoleBindings } from "../utils/reactionRoles.js";
import { upsertGuildXpConfig, getGuildXpConfig } from "../utils/storage_pg.js";
import { defaultAutomodConfig } from "../tools/automod/rules.js";

// ─── ID helpers ─────────────────────────────────────────────────────────────

const P = "dash";

/** Build a button/select customId.  max 100 chars, userId last so truncation is safe. */
function id(...parts) {
  return [P, ...parts].join(":").slice(0, 100);
}

function parseId(customId) {
  if (!String(customId).startsWith(P + ":")) return null;
  const [, section, action, userId, extra] = customId.split(":");
  return { section, action, userId, extra };
}

function ownedBy(parsed, interaction) {
  return parsed?.userId === interaction.user.id;
}

// ─── Status helpers ──────────────────────────────────────────────────────────

const ON  = "✅";
const OFF = "❌";
const CFG = "⚠️";

function pill(enabled, configured = true) {
  if (!configured) return CFG;
  return enabled ? ON : OFF;
}

function chanRef(id) { return id ? `<#${id}>` : "not set"; }
function roleRef(id) { return id ? `<@&${id}>` : "not set"; }

// ─── Home embed + nav ────────────────────────────────────────────────────────

async function buildHomeEmbed(guild, data) {
  const ml  = normalizeModLogConfig(data?.modLogs);
  const tk  = normalizeTicketsConfig({ tickets: data?.tickets }).tickets;
  const sb  = normalizeStarboardConfig({ starboard: data?.starboard }).starboard;
  const xp  = await getGuildXpConfig(guild.id).catch(() => null);
  const w   = data?.welcome ?? {};
  const ar  = data?.autorole ?? {};
  const am  = data?.automod ?? {};
  const ai  = data?.ai ?? {};
  const mus = data?.music ?? {};
  const rxr = listReactionRoleBindings(data).length;
  const lrr = listLevelRoleRewards(data).length;

  const agentMgr = global.agentManager;
  const agents = agentMgr
    ? Array.from(agentMgr.liveAgents?.values?.() ?? []).filter(a => a.guildIds?.has?.(guild.id))
    : [];

  return new EmbedBuilder()
    .setTitle(`⚙️ ${guild.name} — Dashboard`)
    .setThumbnail(guild.iconURL({ size: 64 }) ?? null)
    .setColor(Colors.Info)
    .setDescription("Click a module button below to view and configure settings.")
    .addFields(
      {
        name: "📣 Welcome / Farewell",
        value: `${pill(w.enabled)} Welcome ${chanRef(w.channelId)}\n${pill(w.farewell?.enabled)} Farewell ${chanRef(w.farewell?.channelId ?? w.channelId)}`,
        inline: true,
      },
      {
        name: "🛡️ Automod",
        value: `${pill(am.enabled)} Spam / links / caps\nLog: ${chanRef(am.logChannelId)}`,
        inline: true,
      },
      {
        name: "🔨 Mod Logs",
        value: `${pill(ml.enabled)} ${chanRef(ml.channelId)}`,
        inline: true,
      },
      {
        name: "🎫 Tickets",
        value: `${pill(tk.enabled)} Category: ${chanRef(tk.categoryId)}\nPanel: ${chanRef(tk.panelChannelId)}`,
        inline: true,
      },
      {
        name: "🌟 Starboard",
        value: `${pill(sb.enabled)} ${chanRef(sb.channelId)}\n${sb.emoji ?? "⭐"} threshold: **${sb.threshold ?? 3}**`,
        inline: true,
      },
      {
        name: "⭐ Leveling",
        value: `${pill(xp?.enabled ?? false)} XP system\nRole rewards: **${lrr}**`,
        inline: true,
      },
      {
        name: "🎭 Roles",
        value: `Autorole: ${roleRef(ar.roleId)}\nReaction roles: **${rxr}**`,
        inline: true,
      },
      {
        name: "🤖 AI & Agents",
        value: `${pill(ai.enabled)} AI assistant\nAgents: **${agents.length}** live`,
        inline: true,
      },
      {
        name: "🎵 Music",
        value: `Default vol: **${mus.defaultVolume ?? 100}%**\nDJ role: ${roleRef(mus.djRoleId)}`,
        inline: true,
      },
    )
    .setFooter({ text: "All changes save instantly • Chopsticks /dashboard" });
}

function homeNavRows(userId) {
  return [
    new ActionRowBuilder().addComponents(
      btn("📣 Welcome",  id("welcome", "home", userId), ButtonStyle.Secondary),
      btn("🛡️ Automod",  id("automod", "home", userId), ButtonStyle.Secondary),
      btn("🔨 Mod Logs", id("modlogs", "home", userId), ButtonStyle.Secondary),
      btn("🎫 Tickets",  id("tickets", "home", userId), ButtonStyle.Secondary),
      btn("🌟 Starboard",id("starboard","home", userId),ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      btn("⭐ Leveling",  id("levels", "home", userId),  ButtonStyle.Secondary),
      btn("🎭 Roles",     id("roles",  "home", userId),  ButtonStyle.Secondary),
      btn("🤖 AI & Agents",id("agents","home", userId),  ButtonStyle.Secondary),
      btn("🎵 Music",     id("music",  "home", userId),  ButtonStyle.Secondary),
      btn("⚙️ General",  id("general","home", userId),  ButtonStyle.Secondary),
    ),
  ];
}

// ─── Section: Welcome ────────────────────────────────────────────────────────

function buildWelcomeEmbed(data, userId) {
  const w = data?.welcome ?? {};
  const fw = w.farewell ?? {};
  return new EmbedBuilder()
    .setTitle("📣 Welcome / Farewell Settings")
    .setColor(Colors.Info)
    .addFields(
      { name: "Welcome", value: `Status: ${pill(w.enabled)}\nChannel: ${chanRef(w.channelId)}\nMessage: \`${(w.message ?? "default").slice(0, 60)}\``, inline: false },
      { name: "Farewell", value: `Status: ${pill(fw.enabled)}\nChannel: ${chanRef(fw.channelId ?? w.channelId)}\nMessage: \`${(fw.message ?? "default").slice(0, 60)}\``, inline: false },
    )
    .setFooter({ text: `Use buttons to configure • /dashboard` });
}

function welcomeRows(userId, data) {
  const w   = data?.welcome ?? {};
  const fw  = (data?.welcome?.farewell) ?? {};
  const wOn = w.enabled;
  const fOn = fw.enabled;
  return [
    new ActionRowBuilder().addComponents(
      btn(wOn ? "Disable Welcome" : "Enable Welcome",  id("welcome", wOn ? "off" : "on", userId), wOn ? ButtonStyle.Danger : ButtonStyle.Success),
      btn(fOn ? "Disable Farewell" : "Enable Farewell",id("farewell",fOn ? "off" : "on", userId), fOn ? ButtonStyle.Danger : ButtonStyle.Success),
      btn("✏️ Set Welcome Msg", id("welcome", "setmsg", userId), ButtonStyle.Primary),
      btn("✏️ Set Farewell Msg", id("farewell", "setmsg", userId), ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(id("welcome", "setchan", userId))
        .setPlaceholder("Set welcome/farewell channel")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    ),
    backRow(userId),
  ];
}

// ─── Section: Automod ────────────────────────────────────────────────────────

function buildAutomodEmbed(data) {
  const am = data?.automod ?? {};
  const r  = am.rules ?? {};
  return new EmbedBuilder()
    .setTitle("🛡️ Automod Settings")
    .setColor(Colors.Info)
    .addFields(
      { name: "Status",       value: pill(am.enabled),              inline: true },
      { name: "Log Channel",  value: chanRef(am.logChannelId),       inline: true },
      { name: "Spam Filter",  value: pill(r.spam?.enabled ?? false), inline: true },
      { name: "Link Filter",  value: pill(r.links?.enabled ?? false),inline: true },
      { name: "Caps Filter",  value: pill(r.caps?.enabled ?? false), inline: true },
      { name: "Bad Words",    value: pill(r.words?.enabled ?? false),inline: true },
    )
    .setFooter({ text: "Use /automod for advanced rule configuration" });
}

function automodRows(userId, data) {
  const am  = data?.automod ?? {};
  const on  = am.enabled;
  const r   = am.rules ?? {};
  return [
    new ActionRowBuilder().addComponents(
      btn(on ? "Disable Automod" : "Enable Automod", id("automod", on ? "off" : "on", userId), on ? ButtonStyle.Danger : ButtonStyle.Success),
      btn(r.spam?.enabled  ? "🔴 Spam Off"  : "🟢 Spam On",  id("automod","spam_toggle", userId), ButtonStyle.Secondary),
      btn(r.links?.enabled ? "🔴 Links Off" : "🟢 Links On", id("automod","links_toggle",userId), ButtonStyle.Secondary),
      btn(r.caps?.enabled  ? "🔴 Caps Off"  : "🟢 Caps On",  id("automod","caps_toggle", userId), ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(id("automod","logchan",userId))
        .setPlaceholder("Set automod log channel")
        .addChannelTypes(ChannelType.GuildText)
    ),
    backRow(userId),
  ];
}

// ─── Section: Mod Logs ───────────────────────────────────────────────────────

function buildModlogsEmbed(data) {
  const ml = normalizeModLogConfig(data?.modLogs);
  return new EmbedBuilder()
    .setTitle("🔨 Mod Logs Settings")
    .setColor(Colors.Info)
    .addFields(
      { name: "Status",      value: pill(ml.enabled),       inline: true },
      { name: "Log Channel", value: chanRef(ml.channelId),  inline: true },
    )
    .setFooter({ text: "Use /mod logs for per-event control" });
}

function modlogsRows(userId, data) {
  const ml = normalizeModLogConfig(data?.modLogs);
  const on = ml.enabled;
  return [
    new ActionRowBuilder().addComponents(
      btn(on ? "Disable Mod Logs" : "Enable Mod Logs", id("modlogs", on ? "off" : "on", userId), on ? ButtonStyle.Danger : ButtonStyle.Success),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(id("modlogs","setchan",userId))
        .setPlaceholder("Set mod log channel")
        .addChannelTypes(ChannelType.GuildText)
    ),
    backRow(userId),
  ];
}

// ─── Section: Tickets ────────────────────────────────────────────────────────

function buildTicketsEmbed(data) {
  const tk = normalizeTicketsConfig({ tickets: data?.tickets }).tickets;
  return new EmbedBuilder()
    .setTitle("🎫 Tickets Settings")
    .setColor(Colors.Info)
    .addFields(
      { name: "Status",          value: pill(tk.enabled),            inline: true },
      { name: "Support Category",value: chanRef(tk.categoryId),      inline: true },
      { name: "Panel Channel",   value: chanRef(tk.panelChannelId),  inline: true },
    )
    .setFooter({ text: "Click 'Create Panel' to post the ticket button in a channel" });
}

function ticketsRows(userId, data) {
  const tk = normalizeTicketsConfig({ tickets: data?.tickets }).tickets;
  const on = tk.enabled;
  return [
    new ActionRowBuilder().addComponents(
      btn(on ? "Disable Tickets" : "Enable Tickets", id("tickets", on ? "off" : "on", userId), on ? ButtonStyle.Danger : ButtonStyle.Success),
      btn("🎫 Create Panel Here", id("tickets","panel",userId), ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(id("tickets","setpanel",userId))
        .setPlaceholder("Set panel channel")
        .addChannelTypes(ChannelType.GuildText)
    ),
    backRow(userId),
  ];
}

// ─── Section: Starboard ──────────────────────────────────────────────────────

function buildStarboardEmbed(data) {
  const sb = normalizeStarboardConfig({ starboard: data?.starboard }).starboard;
  return new EmbedBuilder()
    .setTitle("🌟 Starboard Settings")
    .setColor(Colors.Info)
    .addFields(
      { name: "Status",    value: pill(sb.enabled),              inline: true },
      { name: "Channel",   value: chanRef(sb.channelId),         inline: true },
      { name: "Emoji",     value: sb.emoji ?? "⭐",              inline: true },
      { name: "Threshold", value: `**${sb.threshold ?? 3}** ⭐`, inline: true },
    );
}

function starboardRows(userId, data) {
  const sb = normalizeStarboardConfig({ starboard: data?.starboard }).starboard;
  const on = sb.enabled;
  return [
    new ActionRowBuilder().addComponents(
      btn(on ? "Disable Starboard" : "Enable Starboard", id("starboard", on ? "off" : "on", userId), on ? ButtonStyle.Danger : ButtonStyle.Success),
      btn("➕ +1 Threshold", id("starboard","thresh_up",userId), ButtonStyle.Secondary),
      btn("➖ -1 Threshold", id("starboard","thresh_dn",userId), ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(id("starboard","setchan",userId))
        .setPlaceholder("Set starboard channel")
        .addChannelTypes(ChannelType.GuildText)
    ),
    backRow(userId),
  ];
}

// ─── Section: Leveling ───────────────────────────────────────────────────────

async function buildLevelsEmbed(guildId, data) {
  const xp  = await getGuildXpConfig(guildId).catch(() => null);
  const lrr = listLevelRoleRewards(data);
  return new EmbedBuilder()
    .setTitle("⭐ Leveling Settings")
    .setColor(Colors.Info)
    .addFields(
      { name: "Status",         value: pill(xp?.enabled ?? false),               inline: true },
      { name: "XP per message", value: `**${xp?.xp_per_message ?? 15}**`,         inline: true },
      { name: "Multiplier",     value: `**${xp?.xp_multiplier ?? 1}x**`,          inline: true },
      { name: "Level-up channel",value: chanRef(xp?.levelup_channel_id),          inline: true },
      { name: "Role rewards",   value: lrr.length > 0 ? lrr.slice(0,5).map(r=>`Level ${r.level}: <@&${r.roleId}>`).join("\n") : "None", inline: false },
    )
    .setFooter({ text: "Use /levels rewards to manage level role rewards" });
}

function levelsRows(userId, enabled) {
  return [
    new ActionRowBuilder().addComponents(
      btn(enabled ? "Disable Leveling" : "Enable Leveling", id("levels", enabled ? "off" : "on", userId), enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      btn("⚡ Balanced",id("levels","preset_balanced",userId), ButtonStyle.Primary),
      btn("🐢 Relaxed", id("levels","preset_relaxed",userId),  ButtonStyle.Secondary),
      btn("🔥 Grind",   id("levels","preset_grind",userId),    ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(id("levels","levelupchan",userId))
        .setPlaceholder("Set level-up announcement channel")
        .addChannelTypes(ChannelType.GuildText)
    ),
    backRow(userId),
  ];
}

// ─── Section: Roles ──────────────────────────────────────────────────────────

function buildRolesEmbed(data) {
  const ar  = data?.autorole ?? {};
  const rxr = listReactionRoleBindings(data);
  const lrr = listLevelRoleRewards(data);
  return new EmbedBuilder()
    .setTitle("🎭 Roles Settings")
    .setColor(Colors.Info)
    .addFields(
      { name: "Autorole",       value: ar.enabled ? roleRef(ar.roleId) : `${OFF} Disabled`,    inline: true },
      { name: "Reaction Roles", value: `**${rxr.length}** binding${rxr.length !== 1 ? "s" : ""}`, inline: true },
      { name: "Level Rewards",  value: `**${lrr.length}** role${lrr.length !== 1 ? "s" : ""}`,    inline: true },
    )
    .setFooter({ text: "Use /reactionroles to manage reaction role bindings" });
}

function rolesRows(userId, data) {
  const ar = data?.autorole ?? {};
  const arOn = ar.enabled && ar.roleId;
  return [
    new ActionRowBuilder().addComponents(
      arOn
        ? btn("🔴 Clear Autorole", id("roles","autorole_off",userId), ButtonStyle.Danger)
        : btn("Set Autorole →", id("roles","autorole_pick",userId), ButtonStyle.Success),
    ),
    arOn ? null : new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(id("roles","autorole_set",userId))
        .setPlaceholder("Pick a role to auto-assign on join")
    ),
    backRow(userId),
  ].filter(Boolean);
}

// ─── Section: AI & Agents ────────────────────────────────────────────────────

function buildAgentsEmbed(data, guild) {
  const ai  = data?.ai ?? {};
  const agentMgr = global.agentManager;
  const agents   = agentMgr
    ? Array.from(agentMgr.liveAgents?.values?.() ?? []).filter(a => a.guildIds?.has?.(guild.id))
    : [];
  const active = agents.filter(a => a.ready && !a.busyKey).length;
  const busy   = agents.filter(a => a.busyKey).length;

  return new EmbedBuilder()
    .setTitle("🤖 AI & Agents Settings")
    .setColor(Colors.Info)
    .addFields(
      { name: "AI Assistant",  value: pill(ai.enabled),                             inline: true },
      { name: "AI Provider",   value: ai.provider ?? "default (Ollama)",             inline: true },
      { name: "Agent Pool",    value: `${agents.length} total | ${active} ready | ${busy} busy`, inline: false },
      { name: "Music Agents",  value: agents.filter(a => a.type === "music").length ? `${agents.filter(a=>a.type==="music").length} music agents` : "Using primary Lavalink", inline: true },
      { name: "AI Agents",     value: agents.filter(a => a.type === "assistant").length ? `${agents.filter(a=>a.type==="assistant").length} assistant agents` : "None deployed", inline: true },
    )
    .setFooter({ text: "Deploy agents with /agents deploy • Configure keys with /ai" });
}

function agentsRows(userId, data) {
  const ai = data?.ai ?? {};
  const on = ai.enabled;
  return [
    new ActionRowBuilder().addComponents(
      btn(on ? "Disable AI Assistant" : "Enable AI Assistant", id("agents", on ? "ai_off" : "ai_on", userId), on ? ButtonStyle.Danger : ButtonStyle.Success),
      btn("🤖 Deploy Agent", id("agents","deploy",userId), ButtonStyle.Primary),
      btn("✏️ Set Persona",  id("agents","setpersona",userId), ButtonStyle.Secondary),
    ),
    backRow(userId),
  ];
}

// ─── Section: Music ──────────────────────────────────────────────────────────

function buildMusicEmbed(data) {
  const m = data?.music ?? {};
  return new EmbedBuilder()
    .setTitle("🎵 Music Settings")
    .setColor(Colors.Info)
    .addFields(
      { name: "Default Volume",     value: `**${m.defaultVolume ?? 100}%**`,     inline: true },
      { name: "DJ Role",            value: roleRef(m.djRoleId),                   inline: true },
      { name: "Music Channel",      value: chanRef(m.channelId),                  inline: true },
      { name: "Restrict to Channel",value: pill(m.channelRestrict ?? false),      inline: true },
    )
    .setFooter({ text: "Use /music settings for advanced audio config" });
}

function musicRows(userId, data) {
  const m  = data?.music ?? {};
  const cr = m.channelRestrict ?? false;
  return [
    new ActionRowBuilder().addComponents(
      btn("🔉 Vol -10", id("music","vol_down",userId),  ButtonStyle.Secondary),
      btn("🔊 Vol +10", id("music","vol_up",userId),    ButtonStyle.Secondary),
      btn(cr ? "🔓 Unrestrict Channel" : "🔒 Restrict to Channel", id("music","chan_toggle",userId), ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(id("music","setchan",userId))
        .setPlaceholder("Set music channel (optional)")
        .addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(id("music","djrole",userId))
        .setPlaceholder("Set DJ role (optional)")
    ),
    backRow(userId),
  ];
}

// ─── Section: General ────────────────────────────────────────────────────────

function buildGeneralEmbed(data, guild) {
  const pr = data?.prefix ?? {};
  const tz = data?.timezone ?? "UTC";
  return new EmbedBuilder()
    .setTitle("⚙️ General Settings")
    .setColor(Colors.Info)
    .addFields(
      { name: "Prefix",   value: `\`${pr.value ?? "!"}\``,          inline: true },
      { name: "Timezone", value: tz,                                 inline: true },
      { name: "Members",  value: `${guild.memberCount ?? "?"}`,     inline: true },
    );
}

function generalRows(userId) {
  return [
    new ActionRowBuilder().addComponents(
      btn("✏️ Change Prefix",   id("general","setprefix",userId),  ButtonStyle.Primary),
      btn("🌍 Set Timezone",    id("general","settz",userId),      ButtonStyle.Secondary),
    ),
    backRow(userId),
  ];
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function btn(label, customId, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
}

function backRow(userId) {
  return new ActionRowBuilder().addComponents(
    btn("◀ Back to Dashboard", id("home","back",userId), ButtonStyle.Secondary),
  );
}

async function showHome(interaction, userId) {
  const data  = await loadGuildData(interaction.guildId);
  const embed = await buildHomeEmbed(interaction.guild, data);
  const rows  = homeNavRows(userId);
  await interaction.editReply({ embeds: [embed], components: rows });
}

// ─── Slash command definition ────────────────────────────────────────────────

export const meta = {
  category: "admin",
  deployGlobal: true,
};

export const data = new SlashCommandBuilder()
  .setName("dashboard")
  .setDescription("Open the server setup dashboard — configure all modules with buttons")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;
  const data   = await loadGuildData(interaction.guildId);
  const embed  = await buildHomeEmbed(interaction.guild, data);
  const rows   = homeNavRows(userId);

  await interaction.editReply({ embeds: [embed], components: rows });
}

// ─── Button handler ──────────────────────────────────────────────────────────

export async function handleButton(interaction) {
  if (!interaction.customId?.startsWith(P + ":")) return false;
  const parsed = parseId(interaction.customId);
  if (!parsed) return false;
  if (!ownedBy(parsed, interaction)) {
    await interaction.reply({ content: "❌ This dashboard belongs to someone else.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferUpdate();
  const { section, action, userId } = parsed;
  const guildId = interaction.guildId;

  // ── Navigate back to home ──
  if (section === "home") {
    await showHome(interaction, userId);
    return true;
  }

  // ── Navigate to a section ──
  if (action === "home") {
    const data = await loadGuildData(guildId);
    await renderSection(interaction, section, userId, data);
    return true;
  }

  // ── Section-specific actions ──
  const data = await loadGuildData(guildId);

  // ── Welcome ──
  if (section === "welcome") {
    data.welcome ??= { enabled: false };
    if (action === "on")  { data.welcome.enabled = true;  }
    if (action === "off") { data.welcome.enabled = false; }
    if (action === "setmsg") {
      const modal = new ModalBuilder().setCustomId(`dash_modal:welcome_msg:${userId}`).setTitle("Set Welcome Message");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("msg").setLabel("Welcome message (use {user}, {guild})")
          .setStyle(TextInputStyle.Paragraph).setRequired(true)
          .setValue(data.welcome.message ?? "Welcome {user} to {guild}! 🎉").setMaxLength(500)
      ));
      await interaction.followUp({ flags: MessageFlags.Ephemeral }).catch(() => {});
      return await interaction.editReply({ content: "Use the modal to set your message." }).catch(() => true);
    }
    await saveGuildData(guildId, data);
    await renderSection(interaction, "welcome", userId, data);
    return true;
  }

  if (section === "farewell") {
    data.welcome ??= { enabled: false };
    data.welcome.farewell ??= { enabled: false };
    if (action === "on")  data.welcome.farewell.enabled = true;
    if (action === "off") data.welcome.farewell.enabled = false;
    if (action === "setmsg") {
      // open modal
      const modal = new ModalBuilder().setCustomId(`dash_modal:farewell_msg:${userId}`).setTitle("Set Farewell Message");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("msg").setLabel("Farewell message (use {user}, {guild})")
          .setStyle(TextInputStyle.Paragraph).setRequired(true)
          .setValue(data.welcome.farewell.message ?? "Goodbye {user} from {guild}. 👋").setMaxLength(500)
      ));
      await interaction.followUp({ content: "Opening modal…", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }
    await saveGuildData(guildId, data);
    await renderSection(interaction, "welcome", userId, data);
    return true;
  }

  // ── Automod ──
  if (section === "automod") {
    data.automod ??= defaultAutomodConfig();
    data.automod.rules ??= {};
    if (action === "on")  data.automod.enabled = true;
    if (action === "off") data.automod.enabled = false;
    if (action === "spam_toggle") {
      data.automod.rules.spam ??= {};
      data.automod.rules.spam.enabled = !data.automod.rules.spam.enabled;
    }
    if (action === "links_toggle") {
      data.automod.rules.links ??= {};
      data.automod.rules.links.enabled = !data.automod.rules.links.enabled;
    }
    if (action === "caps_toggle") {
      data.automod.rules.caps ??= {};
      data.automod.rules.caps.enabled = !data.automod.rules.caps.enabled;
    }
    await saveGuildData(guildId, data);
    await renderSection(interaction, "automod", userId, data);
    return true;
  }

  // ── Mod Logs ──
  if (section === "modlogs") {
    data.modLogs ??= {};
    if (action === "on")  data.modLogs.enabled = true;
    if (action === "off") data.modLogs.enabled = false;
    await saveGuildData(guildId, data);
    await renderSection(interaction, "modlogs", userId, data);
    return true;
  }

  // ── Tickets ──
  if (section === "tickets") {
    data.tickets ??= {};
    if (action === "on")  data.tickets.enabled = true;
    if (action === "off") data.tickets.enabled = false;
    if (action === "panel") {
      // Create the ticket open button panel in current channel
      try {
        const { createTicketPanel } = await import("../utils/tickets.js");
        await createTicketPanel(interaction.channel, guildId, data);
        data.tickets.panelChannelId = interaction.channelId;
      } catch {
        // tickets.js may not export createTicketPanel — just set the channel
        data.tickets.panelChannelId = interaction.channelId;
      }
    }
    await saveGuildData(guildId, data);
    await renderSection(interaction, "tickets", userId, data);
    return true;
  }

  // ── Starboard ──
  if (section === "starboard") {
    data.starboard ??= {};
    if (action === "on")  data.starboard.enabled = true;
    if (action === "off") data.starboard.enabled = false;
    if (action === "thresh_up") data.starboard.threshold = Math.min(20, (data.starboard.threshold ?? 3) + 1);
    if (action === "thresh_dn") data.starboard.threshold = Math.max(1,  (data.starboard.threshold ?? 3) - 1);
    await saveGuildData(guildId, data);
    await renderSection(interaction, "starboard", userId, data);
    return true;
  }

  // ── Leveling ──
  if (section === "levels") {
    const PRESETS = {
      preset_balanced: { enabled: true, xp_per_message: 15, xp_per_vc_minute: 5, xp_multiplier: 1 },
      preset_relaxed:  { enabled: true, xp_per_message: 8,  xp_per_vc_minute: 2, xp_multiplier: 0.7 },
      preset_grind:    { enabled: true, xp_per_message: 25, xp_per_vc_minute: 10, xp_multiplier: 1.5 },
    };
    if (action === "on")  await upsertGuildXpConfig(guildId, { enabled: true }).catch(() => {});
    if (action === "off") await upsertGuildXpConfig(guildId, { enabled: false }).catch(() => {});
    if (PRESETS[action])  await upsertGuildXpConfig(guildId, PRESETS[action]).catch(() => {});
    const refreshed = await loadGuildData(guildId);
    await renderSection(interaction, "levels", userId, refreshed);
    return true;
  }

  // ── Roles ──
  if (section === "roles") {
    data.autorole ??= {};
    if (action === "autorole_off") {
      data.autorole.enabled = false;
      data.autorole.roleId  = null;
      await saveGuildData(guildId, data);
    }
    await renderSection(interaction, "roles", userId, data);
    return true;
  }

  // ── AI & Agents ──
  if (section === "agents") {
    data.ai ??= {};
    if (action === "ai_on")  data.ai.enabled = true;
    if (action === "ai_off") data.ai.enabled = false;
    if (action === "deploy") {
      // Trigger agent deploy inline
      try {
        const { deployAgent } = await import("./agents.js");
        await deployAgent(interaction.guild, guildId);
      } catch {}
      await interaction.editReply({ content: "🤖 Agent deployment initiated. Check `/agents status`." }).catch(() => {});
      return true;
    }
    if (action === "setpersona") {
      const modal = new ModalBuilder().setCustomId(`dash_modal:ai_persona:${userId}`).setTitle("Set AI Persona");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("persona").setLabel("Persona / system prompt for AI assistant")
          .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)
          .setValue(data.ai.persona ?? "You are Chopsticks, a helpful Discord bot assistant.")
      ));
      await interaction.followUp({ content: "Use the modal below.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }
    await saveGuildData(guildId, data);
    await renderSection(interaction, "agents", userId, data);
    return true;
  }

  // ── Music ──
  if (section === "music") {
    data.music ??= {};
    if (action === "vol_up")      data.music.defaultVolume = Math.min(150, (data.music.defaultVolume ?? 100) + 10);
    if (action === "vol_down")    data.music.defaultVolume = Math.max(10,  (data.music.defaultVolume ?? 100) - 10);
    if (action === "chan_toggle")  data.music.channelRestrict = !(data.music.channelRestrict ?? false);
    await saveGuildData(guildId, data);
    await renderSection(interaction, "music", userId, data);
    return true;
  }

  // ── General ──
  if (section === "general") {
    if (action === "setprefix") {
      const modal = new ModalBuilder().setCustomId(`dash_modal:prefix:${userId}`).setTitle("Set Bot Prefix");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("prefix").setLabel("New prefix (e.g. !, ?, -)")
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5)
          .setValue(data.prefix?.value ?? "!")
      ));
      await interaction.followUp({ content: "Use the modal below.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }
    if (action === "settz") {
      const modal = new ModalBuilder().setCustomId(`dash_modal:timezone:${userId}`).setTitle("Set Server Timezone");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("tz").setLabel("Timezone (e.g. America/New_York, Europe/London)")
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)
          .setValue(data.timezone ?? "UTC")
      ));
      await interaction.followUp({ content: "Use the modal below.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }
    await renderSection(interaction, "general", userId, data);
    return true;
  }

  return true;
}

// ─── Select handler ──────────────────────────────────────────────────────────

export async function handleSelect(interaction) {
  if (!interaction.customId?.startsWith(P + ":")) return false;
  const parsed = parseId(interaction.customId);
  if (!parsed) return false;
  if (!ownedBy(parsed, interaction)) {
    await interaction.reply({ content: "❌ This dashboard belongs to someone else.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferUpdate();
  const { section, action, userId } = parsed;
  const guildId = interaction.guildId;
  const data = await loadGuildData(guildId);

  // ── Channel selects ──
  if (interaction.isChannelSelectMenu?.()) {
    const chanId = interaction.values[0];

    if (section === "welcome" && action === "setchan") {
      data.welcome ??= {};
      data.welcome.channelId = chanId;
      data.welcome.farewell ??= {};
      data.welcome.farewell.channelId = chanId;
    }
    if (section === "automod" && action === "logchan") {
      data.automod ??= {};
      data.automod.logChannelId = chanId;
    }
    if (section === "modlogs" && action === "setchan") {
      data.modLogs ??= {};
      data.modLogs.channelId = chanId;
    }
    if (section === "tickets" && action === "setpanel") {
      data.tickets ??= {};
      data.tickets.panelChannelId = chanId;
    }
    if (section === "starboard" && action === "setchan") {
      data.starboard ??= {};
      data.starboard.channelId = chanId;
    }
    if (section === "levels" && action === "levelupchan") {
      await upsertGuildXpConfig(guildId, { levelup_channel_id: chanId }).catch(() => {});
    }
    if (section === "music" && action === "setchan") {
      data.music ??= {};
      data.music.channelId = chanId;
    }
    await saveGuildData(guildId, data);
    await renderSection(interaction, section, userId, data);
    return true;
  }

  // ── Role selects ──
  if (interaction.isRoleSelectMenu?.()) {
    const roleId = interaction.values[0];

    if (section === "roles" && action === "autorole_set") {
      data.autorole ??= {};
      data.autorole.roleId  = roleId;
      data.autorole.enabled = true;
    }
    if (section === "music" && action === "djrole") {
      data.music ??= {};
      data.music.djRoleId = roleId;
    }
    await saveGuildData(guildId, data);
    await renderSection(interaction, section, userId, data);
    return true;
  }

  return false;
}

// ─── Modal handler ───────────────────────────────────────────────────────────

export async function handleModal(interaction) {
  if (!interaction.customId?.startsWith("dash_modal:")) return false;
  const [, kind, userId] = interaction.customId.split(":");
  if (userId !== interaction.user.id) {
    await interaction.reply({ content: "❌ Not your dashboard.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferUpdate().catch(() => interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {}));
  const guildId = interaction.guildId;
  const data    = await loadGuildData(guildId);

  if (kind === "welcome_msg") {
    data.welcome ??= {};
    data.welcome.message = interaction.fields.getTextInputValue("msg");
    await saveGuildData(guildId, data);
    await renderSectionOnModal(interaction, "welcome", userId, data);
    return true;
  }
  if (kind === "farewell_msg") {
    data.welcome ??= {};
    data.welcome.farewell ??= {};
    data.welcome.farewell.message = interaction.fields.getTextInputValue("msg");
    await saveGuildData(guildId, data);
    await renderSectionOnModal(interaction, "welcome", userId, data);
    return true;
  }
  if (kind === "prefix") {
    const raw = interaction.fields.getTextInputValue("prefix").trim().slice(0, 5);
    if (raw) {
      data.prefix ??= {};
      data.prefix.value = raw;
      await saveGuildData(guildId, data);
    }
    await renderSectionOnModal(interaction, "general", userId, data);
    return true;
  }
  if (kind === "timezone") {
    const tz = interaction.fields.getTextInputValue("tz").trim();
    if (tz) { data.timezone = tz; await saveGuildData(guildId, data); }
    await renderSectionOnModal(interaction, "general", userId, data);
    return true;
  }
  if (kind === "ai_persona") {
    data.ai ??= {};
    data.ai.persona = interaction.fields.getTextInputValue("persona").trim();
    await saveGuildData(guildId, data);
    await renderSectionOnModal(interaction, "agents", userId, data);
    return true;
  }
  return false;
}

// ─── Render helpers ──────────────────────────────────────────────────────────

async function renderSection(interaction, section, userId, data) {
  const guild = interaction.guild;
  let embed, rows;

  switch (section) {
    case "welcome":
      embed = buildWelcomeEmbed(data, userId);
      rows  = welcomeRows(userId, data);
      break;
    case "automod":
      embed = buildAutomodEmbed(data);
      rows  = automodRows(userId, data);
      break;
    case "modlogs":
      embed = buildModlogsEmbed(data);
      rows  = modlogsRows(userId, data);
      break;
    case "tickets":
      embed = buildTicketsEmbed(data);
      rows  = ticketsRows(userId, data);
      break;
    case "starboard":
      embed = buildStarboardEmbed(data);
      rows  = starboardRows(userId, data);
      break;
    case "levels":
      embed = await buildLevelsEmbed(guild.id, data);
      rows  = levelsRows(userId, (await getGuildXpConfig(guild.id).catch(() => null))?.enabled ?? false);
      break;
    case "roles":
      embed = buildRolesEmbed(data);
      rows  = rolesRows(userId, data);
      break;
    case "agents":
      embed = buildAgentsEmbed(data, guild);
      rows  = agentsRows(userId, data);
      break;
    case "music":
      embed = buildMusicEmbed(data);
      rows  = musicRows(userId, data);
      break;
    case "general":
      embed = buildGeneralEmbed(data, guild);
      rows  = generalRows(userId);
      break;
    default:
      await showHome(interaction, userId);
      return;
  }

  await interaction.editReply({ embeds: [embed], components: rows });
}

async function renderSectionOnModal(interaction, section, userId, data) {
  // Modal submits use editReply differently — try followUp if editReply fails
  try {
    await renderSection(interaction, section, userId, data);
  } catch {
    await interaction.followUp({
      content: "✅ Settings saved! Re-open `/dashboard` to see changes.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

export default { data, execute, meta };
