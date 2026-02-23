import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getPool } from "../utils/storage_pg.js";
import { Colors, replyError } from "../utils/discordOutput.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

function rankLines(rows, fmt) {
  return rows.map((r, i) => `${i + 1}. <@${r.user_id}> ${fmt(r)}`).join("\n");
}

export const meta = {
  category: "economy",
  guildOnly: true,
};

export default {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View game leaderboards")
    .addSubcommand(s =>
      s
        .setName("level")
        .setDescription("Top levels")
        .addBooleanOption(o => o.setName("private").setDescription("Show only to you").setRequired(false))
    )
    .addSubcommand(s =>
      s
        .setName("credits")
        .setDescription("Top wallet credits")
        .addBooleanOption(o => o.setName("private").setDescription("Show only to you").setRequired(false))
    )
    .addSubcommand(s =>
      s
        .setName("networth")
        .setDescription("Top net worth (wallet + bank)")
        .addBooleanOption(o => o.setName("private").setDescription("Show only to you").setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const priv = Boolean(interaction.options.getBoolean("private"));
    await interaction.deferReply({ ephemeral: priv });

    await withTimeout(interaction, async () => {
      const p = getPool();
      try {
        let title = "Leaderboard";
        let rows = [];
        let desc = "";

        if (sub === "level") {
          title = "🏆 Level Leaderboard";
          const res = await p.query(
            `SELECT user_id, level, xp
             FROM user_game_profiles
             ORDER BY level DESC, xp DESC
             LIMIT 10`
          );
          rows = res.rows || [];
          desc = rows.length
            ? rankLines(rows, r => `• **Lv ${Number(r.level)}** (${Number(r.xp).toLocaleString()} XP)`)
            : "No profiles yet.";
        } else if (sub === "credits") {
          title = "💰 Credits Leaderboard";
          const res = await p.query(
            `SELECT user_id, balance
             FROM user_wallets
             ORDER BY balance DESC
             LIMIT 10`
          );
          rows = res.rows || [];
          desc = rows.length
            ? rankLines(rows, r => `• **${Number(r.balance).toLocaleString()}** Credits`)
            : "No wallets yet.";
        } else if (sub === "networth") {
          title = "💎 Net Worth Leaderboard";
          const res = await p.query(
            `SELECT user_id, (balance + bank) AS networth, balance, bank
             FROM user_wallets
             ORDER BY (balance + bank) DESC
             LIMIT 10`
          );
          rows = res.rows || [];
          desc = rows.length
            ? rankLines(rows, r => `• **${Number(r.networth).toLocaleString()}** (wallet ${Number(r.balance).toLocaleString()} + bank ${Number(r.bank).toLocaleString()})`)
            : "No wallets yet.";
        } else {
          await replyError(interaction, "Unknown Leaderboard", "That leaderboard is not available.", true);
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle(title)
          .setColor(Colors.PRIMARY)
          .setDescription(desc)
          .setFooter({ text: "Tip: level up with /work, /gather, /fight, /quests, and /craft" })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        botLogger.error({ err: err }, "[leaderboard] error:");
        await replyError(interaction, "Leaderboard Failed", "Could not load leaderboard right now.", true);
      }
    }, { label: "leaderboard" });
  }
};
