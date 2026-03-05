// src/commands/threads.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  ChannelType,
} from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";

export const meta = {
  deployGlobal: false,
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
  name: "threads",
  category: "tools",
};

export const data = new SlashCommandBuilder()
  .setName("threads")
  .setDescription("Auto-thread and announcement channel management")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  .addSubcommand(s => s
    .setName("autothread-add")
    .setDescription("Automatically create a thread on every message in a channel")
    .addChannelOption(o => o.setName("channel").setDescription("Channel to auto-thread").setRequired(true))
    .addStringOption(o => o.setName("prefix").setDescription("Thread name prefix (default: message content preview)").setMaxLength(50)))

  .addSubcommand(s => s
    .setName("autothread-remove")
    .setDescription("Remove auto-threading from a channel")
    .addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true)))

  .addSubcommand(s => s
    .setName("autothread-list")
    .setDescription("List auto-threaded channels"))

  .addSubcommand(s => s
    .setName("autopublish-add")
    .setDescription("Auto-publish messages in an Announcement channel")
    .addChannelOption(o => o.setName("channel").setDescription("Announcement channel to auto-publish").setRequired(true)))

  .addSubcommand(s => s
    .setName("autopublish-remove")
    .setDescription("Remove auto-publish from a channel")
    .addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true)))

  .addSubcommand(s => s
    .setName("autopublish-list")
    .setDescription("List auto-publish channels"));

async function ensureThreads(guildId) {
  const gd = await loadGuildData(guildId);
  gd.threads ??= { autoThread: [], autoPublish: [] };
  gd.threads.autoThread ??= [];
  gd.threads.autoPublish ??= [];
  return { gd, threads: gd.threads };
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === "autothread-add") {
    const ch = interaction.options.getChannel("channel", true);
    const prefix = interaction.options.getString("prefix") ?? "";
    const { gd, threads } = await ensureThreads(guildId);
    if (threads.autoThread.some(e => e.channelId === ch.id)) {
      return interaction.reply({ content: "> That channel is already set to auto-thread.", flags: MessageFlags.Ephemeral });
    }
    if (threads.autoThread.length >= 20) return interaction.reply({ content: "> Maximum 20 auto-thread channels.", flags: MessageFlags.Ephemeral });
    threads.autoThread.push({ channelId: ch.id, prefix });
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Auto-threading enabled in <#${ch.id}>.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "autothread-remove") {
    const ch = interaction.options.getChannel("channel", true);
    const { gd, threads } = await ensureThreads(guildId);
    const before = threads.autoThread.length;
    threads.autoThread = threads.autoThread.filter(e => e.channelId !== ch.id);
    if (threads.autoThread.length === before) return interaction.reply({ content: "> Channel not found in auto-thread list.", flags: MessageFlags.Ephemeral });
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Auto-threading removed from <#${ch.id}>.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "autothread-list") {
    const { threads } = await ensureThreads(guildId);
    if (!threads.autoThread.length) return interaction.reply({ content: "> No auto-thread channels configured.", flags: MessageFlags.Ephemeral });
    const lines = threads.autoThread.map(e => `• <#${e.channelId}>${e.prefix ? ` — prefix: \`${e.prefix}\`` : ""}`);
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle("Auto-Thread Channels").setDescription(lines.join("\n")).setColor(0x5865F2)], flags: MessageFlags.Ephemeral });
  }

  if (sub === "autopublish-add") {
    const ch = interaction.options.getChannel("channel", true);
    if (ch.type !== ChannelType.GuildAnnouncement) {
      return interaction.reply({ content: "> That channel is not an Announcement channel.", flags: MessageFlags.Ephemeral });
    }
    const { gd, threads } = await ensureThreads(guildId);
    if (threads.autoPublish.includes(ch.id)) return interaction.reply({ content: "> Already configured.", flags: MessageFlags.Ephemeral });
    threads.autoPublish.push(ch.id);
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Messages in <#${ch.id}> will be auto-published.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "autopublish-remove") {
    const ch = interaction.options.getChannel("channel", true);
    const { gd, threads } = await ensureThreads(guildId);
    const before = threads.autoPublish.length;
    threads.autoPublish = threads.autoPublish.filter(id => id !== ch.id);
    if (threads.autoPublish.length === before) return interaction.reply({ content: "> Channel not found.", flags: MessageFlags.Ephemeral });
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Auto-publish removed from <#${ch.id}>.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "autopublish-list") {
    const { threads } = await ensureThreads(guildId);
    if (!threads.autoPublish.length) return interaction.reply({ content: "> No auto-publish channels configured.", flags: MessageFlags.Ephemeral });
    const lines = threads.autoPublish.map(id => `• <#${id}>`);
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle("Auto-Publish Channels").setDescription(lines.join("\n")).setColor(0x5865F2)], flags: MessageFlags.Ephemeral });
  }
}
