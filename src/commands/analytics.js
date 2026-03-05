// src/commands/analytics.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { loadGuildData } from "../utils/storage.js";

export const meta = {
  deployGlobal: false,
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
  name: "analytics",
  category: "info",
};

export const data = new SlashCommandBuilder()
  .setName("analytics")
  .setDescription("View server activity and engagement analytics")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  .addSubcommand(s => s
    .setName("overview")
    .setDescription("Overall 7-day server summary"))

  .addSubcommand(s => s
    .setName("activity")
    .setDescription("Message activity over the past 7 days"))

  .addSubcommand(s => s
    .setName("members")
    .setDescription("Member join/leave trends over the past 30 days"))

  .addSubcommand(s => s
    .setName("commands")
    .setDescription("Top 10 most-used bot commands"));

function getDateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function buildBar(value, max, len = 12) {
  if (max === 0) return "░".repeat(len);
  const fill = Math.round((value / max) * len);
  return "█".repeat(fill) + "░".repeat(len - fill);
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const gd = await loadGuildData(interaction.guildId);
  const stats = gd.analytics ?? {};

  if (sub === "overview") {
    const msgData = stats.messages ?? {};
    const keys = Object.keys(msgData).sort().slice(-7);
    const totalMsgs = keys.reduce((s, k) => s + (msgData[k]?.total ?? 0), 0);
    const joins = stats.memberJoins ?? {};
    const leaves = stats.memberLeaves ?? {};
    const jKeys = Object.keys(joins).sort().slice(-30);
    const totalJoins = jKeys.reduce((s, k) => s + (joins[k] ?? 0), 0);
    const totalLeaves = jKeys.reduce((s, k) => s + (leaves[k] ?? 0), 0);
    const cmdData = stats.commandUses ?? {};
    const totalCmds = Object.values(cmdData).reduce((s, n) => s + n, 0);

    const embed = new EmbedBuilder()
      .setTitle(`Analytics Overview — ${interaction.guild.name}`)
      .setColor(0x5865F2)
      .addFields(
        { name: "Messages (7d)", value: String(totalMsgs), inline: true },
        { name: "Joins (30d)", value: String(totalJoins), inline: true },
        { name: "Leaves (30d)", value: String(totalLeaves), inline: true },
        { name: "Net Growth (30d)", value: String(totalJoins - totalLeaves), inline: true },
        { name: "Commands Used (all)", value: String(totalCmds), inline: true },
        { name: "Members", value: String(interaction.guild.memberCount), inline: true },
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === "activity") {
    const msgData = stats.messages ?? {};
    const keys = Object.keys(msgData).sort().slice(-7);
    if (!keys.length) return interaction.reply({ content: "> No message activity data yet.", flags: MessageFlags.Ephemeral });
    const counts = keys.map(k => msgData[k]?.total ?? 0);
    const max = Math.max(...counts, 1);
    const lines = keys.map((k, i) => `\`${k}\` ${buildBar(counts[i], max)} ${counts[i]}`);
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle("Message Activity (7 days)").setDescription(lines.join("\n")).setColor(0x57F287)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === "members") {
    const joins = stats.memberJoins ?? {};
    const leaves = stats.memberLeaves ?? {};
    const keys = [...new Set([...Object.keys(joins), ...Object.keys(leaves)])].sort().slice(-14);
    if (!keys.length) return interaction.reply({ content: "> No member event data yet.", flags: MessageFlags.Ephemeral });
    const lines = keys.map(k => {
      const j = joins[k] ?? 0;
      const l = leaves[k] ?? 0;
      return `\`${k}\` +${j}/-${l}`;
    });
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle("Member Joins / Leaves (14 days)").setDescription(lines.join("\n")).setColor(0xFEE75C)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === "commands") {
    const cmdData = stats.commandUses ?? {};
    const sorted = Object.entries(cmdData).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!sorted.length) return interaction.reply({ content: "> No command usage data yet.", flags: MessageFlags.Ephemeral });
    const max = sorted[0][1];
    const lines = sorted.map(([name, count]) => `\`/${name}\` ${buildBar(count, max)} ${count}`);
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle("Top Commands").setDescription(lines.join("\n")).setColor(0xEB459E)],
      flags: MessageFlags.Ephemeral,
    });
  }
}
