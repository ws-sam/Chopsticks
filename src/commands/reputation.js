import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { cacheIncr } from "../utils/cache.js";
import { Colors } from "../utils/discordOutput.js";

export const meta = {
  guildOnly: true,
  userPerms: [],
  category: "economy"
};

export const data = new SlashCommandBuilder()
  .setName("reputation")
  .setDescription("Reputation system")
  .addSubcommand(sub =>
    sub
      .setName("give")
      .setDescription("Give +1 reputation to another user")
      .addUserOption(o => o.setName("user").setDescription("User to give rep to").setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName("check")
      .setDescription("Check reputation of a user")
      .addUserOption(o => o.setName("user").setDescription("User to check (defaults to you)").setRequired(false))
  )
  .addSubcommand(sub =>
    sub
      .setName("leaderboard")
      .setDescription("Show top 10 reputation holders in this server")
  );

const REP_COOLDOWN_TTL = 86400; // 24 hours in seconds

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildData = await loadGuildData(interaction.guildId);
  if (typeof guildData.reputation !== "object" || guildData.reputation === null || Array.isArray(guildData.reputation)) {
    guildData.reputation = {};
  }

  if (sub === "give") {
    const target = interaction.options.getUser("user", true);

    if (target.id === interaction.user.id) {
      await interaction.reply({ content: "❌ You cannot give reputation to yourself.", flags: 64 });
      return;
    }
    if (target.bot) {
      await interaction.reply({ content: "❌ You cannot give reputation to bots.", flags: 64 });
      return;
    }

    const rlKey = `rep:${interaction.guildId}:${interaction.user.id}`;
    const count = await cacheIncr(rlKey, REP_COOLDOWN_TTL);
    if (count !== null && count > 1) {
      await interaction.reply({ content: "❌ You can only give reputation once every 24 hours.", flags: 64 });
      return;
    }

    const current = Number(guildData.reputation[target.id] ?? 0);
    guildData.reputation[target.id] = current + 1;
    await saveGuildData(interaction.guildId, guildData);

    await interaction.reply({
      content: `✅ You gave a reputation point to ${target}! They now have **${current + 1}** rep.`
    });
  } else if (sub === "check") {
    const target = interaction.options.getUser("user") || interaction.user;
    const rep = Number(guildData.reputation[target.id] ?? 0);
    await interaction.reply({ content: `⭐ ${target} has **${rep}** reputation point${rep === 1 ? "" : "s"}.` });
  } else if (sub === "leaderboard") {
    const entries = Object.entries(guildData.reputation)
      .map(([id, val]) => ({ id, rep: Number(val) || 0 }))
      .filter(e => e.rep > 0)
      .sort((a, b) => b.rep - a.rep)
      .slice(0, 10);

    if (entries.length === 0) {
      await interaction.reply({ content: "No reputation data yet for this server." });
      return;
    }

    const lines = entries.map((e, i) => `**${i + 1}.** <@${e.id}> — **${e.rep}** rep`);
    const embed = new EmbedBuilder()
      .setTitle("⭐ Reputation Leaderboard")
      .setDescription(lines.join("\n"))
      .setColor(Colors.PRIMARY);

    await interaction.reply({ embeds: [embed] });
  }
}
