// src/commands/daily.js
import { SlashCommandBuilder } from "discord.js";
import { makeEmbed, Colors } from "../utils/discordOutput.js";
import { claimDaily } from "../economy/streaks.js";
import { addCredits } from "../economy/wallet.js";
import { formatCooldown } from "../economy/cooldowns.js";
import { maybeBuildGuildFunLine } from "../fun/integrations.js";
import { addGameXp } from "../game/profile.js";
import { getMultiplier } from "../game/buffs.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  category: "economy",
  guildOnly: true,
};

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily credits reward");

export async function execute(interaction) {
  await interaction.deferReply();

  await withTimeout(interaction, async () => {
  
    const userId = interaction.user.id;
  
    try {
      const claim = await claimDaily(userId);
    
      if (!claim.ok) {
        if (claim.reason === "already-claimed") {
          const remaining = claim.nextClaim - Date.now();
          const embed = makeEmbed(
            "Daily Reward",
            `You've already claimed your daily reward!\n\nCome back in **${formatCooldown(remaining)}**`,
            [],
            null,
            null,
            Colors.WARNING
          );
          await interaction.editReply({ embeds: [embed] });
          return;
        }
      }
    
      // Award credits
      await addCredits(userId, claim.totalReward, "daily");

      const xpMult = await getMultiplier(userId, "xp:mult", 1);
      const xpBase = 120 + Math.min(600, claim.streak * 15);
      const xpRes = await addGameXp(userId, xpBase, { reason: "daily", multiplier: xpMult });

      // Per-guild stats + XP
      if (interaction.guildId) {
        void (async () => {
          try {
            const { addStat } = await import('../game/activityStats.js');
            const { addGuildXp } = await import('../game/guildXp.js');
            addStat(userId, interaction.guildId, 'credits_earned', claim.totalReward);
            await addGuildXp(userId, interaction.guildId, 'daily', { client: interaction.client }).catch(() => {});
          } catch {}
        })();
      }
    
      const fields = [
        { name: "🔥 Current Streak", value: `${claim.streak} day${claim.streak === 1 ? '' : 's'}`, inline: true },
        { name: "✨ Multiplier", value: `${claim.multiplier.toFixed(2)}x`, inline: true },
        { name: "💰 Earned", value: `${claim.totalReward.toLocaleString()} Credits`, inline: true },
        {
          name: "XP",
          value: `${xpRes.applied.toLocaleString()} XP${xpRes.leveledUp ? ` • Level Up: ${xpRes.fromLevel} -> ${xpRes.toLevel}` : ""}`,
          inline: false
        }
      ];

      if (xpRes.granted?.length) {
        const crates = xpRes.granted.slice(0, 3).map(g => `Lv ${g.level}: \`${g.crateId}\``).join("\n");
        const more = xpRes.granted.length > 3 ? `\n...and ${xpRes.granted.length - 3} more.` : "";
        fields.push({ name: "Level Rewards", value: crates + more, inline: false });
      }
    
      if (claim.bonusReward > 0) {
        fields.push({
          name: "🎁 Streak Bonus",
          value: `+${claim.bonusReward.toLocaleString()} Credits`,
          inline: false
        });
      }
    
      const embed = makeEmbed(
        "Daily Reward Claimed!",
        `Keep your streak going to earn more!`,
        fields,
        null,
        null,
        Colors.SUCCESS
      );

      const flavor = await maybeBuildGuildFunLine({
        guildId: interaction.guildId,
        feature: "daily",
        actorTag: interaction.user.username,
        target: interaction.user.username,
        intensity: claim.streak >= 7 ? 4 : 3,
        maxLength: 180
      });
      if (flavor) {
        embed.addFields({ name: "Flavor", value: flavor, inline: false });
      }
    
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      botLogger.error({ err: err }, "[daily] Error:");
      await interaction.editReply({
        embeds: [makeEmbed("Error", "Failed to claim daily reward.", [], null, null, Colors.ERROR)]
      });
    }
  }, { label: "daily" });
}
