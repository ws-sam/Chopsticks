import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getWallet } from "../economy/wallet.js";
import { getGameProfile } from "../game/profile.js";
import { progressToNextLevel } from "../game/progression.js";
import { Colors, replyError } from "../utils/discordOutput.js";

function bar(pct, len = 12) {
  const filled = Math.floor(pct * len);
  const empty = Math.max(0, len - filled);
  return "█".repeat(filled) + "░".repeat(empty);
}

export default {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View your game profile (level, XP, and credits)")
    .addUserOption(o =>
      o.setName("user").setDescription("View another user's profile").setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser("user") || interaction.user;

    try {
      const [wallet, profile] = await Promise.all([
        getWallet(targetUser.id),
        getGameProfile(targetUser.id)
      ]);

      const prog = progressToNextLevel(profile.xp);
      const pct = prog.pct;

      const embed = new EmbedBuilder()
        .setTitle(`${targetUser.username}'s Profile`)
        .setColor(Colors.PRIMARY)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: "Level", value: `**${prog.level}**`, inline: true },
          { name: "XP", value: `${profile.xp.toLocaleString()} XP`, inline: true },
          { name: "Next Level", value: `${Math.max(0, Math.trunc(prog.next - profile.xp)).toLocaleString()} XP`, inline: true },
          { name: "Progress", value: `${bar(pct)} ${Math.round(pct * 100)}%`, inline: false },
          { name: "Wallet", value: `${wallet.balance.toLocaleString()} Credits`, inline: true },
          { name: "Bank", value: `${wallet.bank.toLocaleString()} / ${wallet.bank_capacity.toLocaleString()}`, inline: true },
          { name: "Net Worth", value: `${(wallet.balance + wallet.bank).toLocaleString()} Credits`, inline: true }
        )
        .setFooter({
          text: "Core loop: /work -> earn credits, /gather -> collect loot, /use -> sell loot, /shop -> buy tools, /bank -> store & upgrade"
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("[profile] error:", err);
      await replyError(interaction, "Profile Failed", "Could not load profile right now. Try again.", true);
    }
  }
};

