import { SlashCommandBuilder, MessageFlags } from "discord.js";

export const meta = {
  category: "util",
  guildOnly: true,
  deployGlobal: false,
};

export const data = new SlashCommandBuilder()
  .setName("uptime")
  .setDescription("Show bot uptime");

function formatUptime(sec) {
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor((sec / 3600) % 24);
  const d = Math.floor(sec / 86400);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

export async function execute(interaction) {
  const sec = process.uptime();
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `Uptime: ${formatUptime(sec)}`
  });
}
