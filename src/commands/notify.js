// src/commands/notify.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";

export const meta = {
  deployGlobal: false,
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
  name: "notify",
  category: "utility",
};

export const data = new SlashCommandBuilder()
  .setName("notify")
  .setDescription("Configure Twitch and YouTube stream/upload notifications")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  // Channel configuration
  .addSubcommand(s => s
    .setName("channel")
    .setDescription("Set the channel where notifications are posted")
    .addChannelOption(o => o.setName("channel").setDescription("Notification channel").setRequired(true)))

  // Twitch
  .addSubcommand(s => s
    .setName("twitch-add")
    .setDescription("Add a Twitch streamer to notify when they go live")
    .addStringOption(o => o.setName("login").setDescription("Twitch username (e.g. xqc)").setRequired(true).setMaxLength(50))
    .addRoleOption(o => o.setName("ping_role").setDescription("Role to ping on notification"))
    .addStringOption(o => o.setName("message").setDescription("Custom message (use {streamer}, {title}, {game}, {url})").setMaxLength(200)))

  .addSubcommand(s => s
    .setName("twitch-remove")
    .setDescription("Remove a Twitch streamer notification")
    .addStringOption(o => o.setName("login").setDescription("Twitch username").setRequired(true)))

  .addSubcommand(s => s
    .setName("twitch-list")
    .setDescription("List configured Twitch notifications"))

  // YouTube
  .addSubcommand(s => s
    .setName("youtube-add")
    .setDescription("Add a YouTube channel to notify on new uploads")
    .addStringOption(o => o.setName("channel_id").setDescription("YouTube Channel ID (starts with UC...)").setRequired(true).setMaxLength(50))
    .addStringOption(o => o.setName("name").setDescription("Display name for this channel").setMaxLength(80))
    .addRoleOption(o => o.setName("ping_role").setDescription("Role to ping on notification"))
    .addStringOption(o => o.setName("message").setDescription("Custom message (use {author}, {title}, {url})").setMaxLength(200)))

  .addSubcommand(s => s
    .setName("youtube-remove")
    .setDescription("Remove a YouTube channel notification")
    .addStringOption(o => o.setName("channel_id").setDescription("YouTube Channel ID").setRequired(true)))

  .addSubcommand(s => s
    .setName("youtube-list")
    .setDescription("List configured YouTube notifications"))

  .addSubcommand(s => s
    .setName("test")
    .setDescription("Send a test notification to the configured channel"));

async function ensureNotify(guildId) {
  const gd = await loadGuildData(guildId);
  gd.notify ??= { channelId: null, twitch: [], youtube: [] };
  gd.notify.twitch ??= [];
  gd.notify.youtube ??= [];
  return { gd, notify: gd.notify };
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === "channel") {
    const ch = interaction.options.getChannel("channel", true);
    const { gd, notify } = await ensureNotify(guildId);
    notify.channelId = ch.id;
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Notifications will be posted in <#${ch.id}>.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "twitch-add") {
    const login = interaction.options.getString("login", true).toLowerCase();
    const pingRole = interaction.options.getRole("ping_role");
    const message = interaction.options.getString("message");
    const { gd, notify } = await ensureNotify(guildId);
    if (notify.twitch.some(s => s.login === login)) {
      return interaction.reply({ content: "> That streamer is already configured.", flags: MessageFlags.Ephemeral });
    }
    if (notify.twitch.length >= 20) {
      return interaction.reply({ content: "> Maximum 20 Twitch streamers per server.", flags: MessageFlags.Ephemeral });
    }
    notify.twitch.push({ login, pingRoleId: pingRole?.id ?? null, message: message ?? null });
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Twitch streamer **${login}** added. Bot will notify when they go live.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "twitch-remove") {
    const login = interaction.options.getString("login", true).toLowerCase();
    const { gd, notify } = await ensureNotify(guildId);
    const before = notify.twitch.length;
    notify.twitch = notify.twitch.filter(s => s.login !== login);
    if (notify.twitch.length === before) return interaction.reply({ content: "> Streamer not found.", flags: MessageFlags.Ephemeral });
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Removed Twitch notification for **${login}**.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "twitch-list") {
    const { notify } = await ensureNotify(guildId);
    if (!notify.twitch.length) return interaction.reply({ content: "> No Twitch notifications configured.", flags: MessageFlags.Ephemeral });
    const lines = notify.twitch.map(s => `• **${s.login}**${s.pingRoleId ? ` → <@&${s.pingRoleId}>` : ""}`);
    const embed = new EmbedBuilder().setTitle("Twitch Notifications").setDescription(lines.join("\n")).setColor(0x9146FF);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === "youtube-add") {
    const channelId = interaction.options.getString("channel_id", true);
    const name = interaction.options.getString("name") ?? channelId;
    const pingRole = interaction.options.getRole("ping_role");
    const message = interaction.options.getString("message");
    const { gd, notify } = await ensureNotify(guildId);
    if (notify.youtube.some(c => c.channelId === channelId)) {
      return interaction.reply({ content: "> That channel is already configured.", flags: MessageFlags.Ephemeral });
    }
    if (notify.youtube.length >= 10) return interaction.reply({ content: "> Maximum 10 YouTube channels per server.", flags: MessageFlags.Ephemeral });
    notify.youtube.push({ channelId, name, pingRoleId: pingRole?.id ?? null, message: message ?? null });
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> YouTube channel **${name}** added.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "youtube-remove") {
    const channelId = interaction.options.getString("channel_id", true);
    const { gd, notify } = await ensureNotify(guildId);
    const before = notify.youtube.length;
    notify.youtube = notify.youtube.filter(c => c.channelId !== channelId);
    if (notify.youtube.length === before) return interaction.reply({ content: "> Channel not found.", flags: MessageFlags.Ephemeral });
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: "> Removed YouTube notification.", flags: MessageFlags.Ephemeral });
  }

  if (sub === "youtube-list") {
    const { notify } = await ensureNotify(guildId);
    if (!notify.youtube.length) return interaction.reply({ content: "> No YouTube notifications configured.", flags: MessageFlags.Ephemeral });
    const lines = notify.youtube.map(c => `• **${c.name}** (\`${c.channelId}\`)${c.pingRoleId ? ` → <@&${c.pingRoleId}>` : ""}`);
    const embed = new EmbedBuilder().setTitle("YouTube Notifications").setDescription(lines.join("\n")).setColor(0xFF0000);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === "test") {
    const { notify } = await ensureNotify(guildId);
    if (!notify.channelId) return interaction.reply({ content: "> No notification channel set. Use `/notify channel` first.", flags: MessageFlags.Ephemeral });
    const ch = interaction.guild.channels.cache.get(notify.channelId);
    if (!ch?.isTextBased()) return interaction.reply({ content: "> Notification channel not found.", flags: MessageFlags.Ephemeral });
    await ch.send({ content: "✅ Test notification from Chopsticks! Notifications are working." });
    return interaction.reply({ content: `> Test notification sent to <#${notify.channelId}>.`, flags: MessageFlags.Ephemeral });
  }
}
