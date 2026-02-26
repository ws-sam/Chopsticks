import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getCooldown, setCooldown, formatCooldown } from "../economy/cooldowns.js";
import { addCredits, getWallet, removeCredits } from "../economy/wallet.js";
import { addItem } from "../economy/inventory.js";
import { Colors, replyError } from "../utils/discordOutput.js";
import { addGameXp, getGameProfile } from "../game/profile.js";
import { getMultiplier } from "../game/buffs.js";
import { recordQuestEvent } from "../game/quests.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const BATTLE_COOLDOWN = 10 * 60 * 1000; // 10 minutes

export const DIFFICULTIES = [
  { id: "easy", name: "Easy", emoji: "🥊", minLevel: 1, baseWin: 0.85, creditMin: 120, creditMax: 220, xp: 65, drops: ["data_fragment"] },
  { id: "medium", name: "Medium", emoji: "⚔️", minLevel: 4, baseWin: 0.72, creditMin: 220, creditMax: 380, xp: 110, drops: ["neural_chip", "corrupted_file"] },
  { id: "hard", name: "Hard", emoji: "🛡️", minLevel: 8, baseWin: 0.60, creditMin: 380, creditMax: 650, xp: 170, drops: ["corrupted_file", "encryption_key"] },
  { id: "elite", name: "Elite", emoji: "👑", minLevel: 12, baseWin: 0.48, creditMin: 650, creditMax: 1100, xp: 240, drops: ["encryption_key", "hologram_badge", "quantum_core"] }
];

function rollInt(min, max) {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  return a + Math.floor(Math.random() * (b - a + 1));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const meta = {
  deployGlobal: false,
  category: "game",
  guildOnly: true,
};

export default {
  data: new SlashCommandBuilder()
    .setName("fight")
    .setDescription("Fight an encounter for XP, credits, and drops (10min cooldown)")
    .addStringOption(o =>
      o
        .setName("difficulty")
        .setDescription("Choose an encounter difficulty")
        .setRequired(true)
        .addChoices(...DIFFICULTIES.map(d => ({ name: `${d.emoji} ${d.name} (Lv ${d.minLevel}+)`, value: d.id })))
    ),

  async execute(interaction) {
    await interaction.deferReply();

    await withTimeout(interaction, async () => {
      try {
        const cd = await getCooldown(interaction.user.id, "battle");
        if (cd && cd.ok === false) {
          return await replyError(
            interaction,
            "Recovering",
            `You're still recovering from your last fight. Try again in **${formatCooldown(cd.remaining)}**.`,
            true
          );
        }

        const diffId = interaction.options.getString("difficulty", true);
        const diff = DIFFICULTIES.find(d => d.id === diffId);
        if (!diff) return await replyError(interaction, "Invalid Difficulty", "That fight difficulty doesn't exist.", true);

        const profile = await getGameProfile(interaction.user.id);
        if (profile.level < diff.minLevel) {
          return await replyError(
            interaction,
            "Locked",
            `You need **Level ${diff.minLevel}** to fight **${diff.name}** encounters.\n\nYour level: **${profile.level}** (try: \`/work\`, \`/gather\`, \`/daily\`).`,
            true
          );
        }

        // Slightly scale win chance with player level advantage.
        const advantage = Math.max(0, profile.level - diff.minLevel);
        const winChance = Math.max(0.15, Math.min(0.95, diff.baseWin + advantage * 0.02));
        const won = Math.random() < winChance;

        const xpMult = await getMultiplier(interaction.user.id, "xp:mult", 1);

        if (!won) {
          // Small loss penalty to create stakes without griefing.
          const penalty = 50 + Math.min(250, profile.level * 10);
          const debit = await removeCredits(interaction.user.id, penalty, `fight_loss:${diff.id}`);
          await setCooldown(interaction.user.id, "battle", BATTLE_COOLDOWN);

          const wallet = await getWallet(interaction.user.id);
          const embed = new EmbedBuilder()
            .setTitle(`${diff.emoji} Fight Lost`)
            .setColor(Colors.ERROR)
            .setDescription(`You were overwhelmed in an **${diff.name}** encounter.`)
            .addFields(
              { name: "Penalty", value: debit.ok ? `-${penalty.toLocaleString()} Credits` : "No credits lost (insufficient funds).", inline: true },
              { name: "New Balance", value: `${wallet.balance.toLocaleString()} Credits`, inline: true },
              { name: "Cooldown", value: formatCooldown(BATTLE_COOLDOWN), inline: true }
            )
            .setFooter({ text: "Tip: Buy tools and boosts in /shop, then level up faster with /work + /gather." })
            .setTimestamp();
          await interaction.editReply({ embeds: [embed] });
          return;
        }

        const credits = rollInt(diff.creditMin, diff.creditMax);
        await addCredits(interaction.user.id, credits, `fight_win:${diff.id}`);

        const xpRes = await addGameXp(interaction.user.id, diff.xp, {
          reason: `fight:${diff.id}`,
          multiplier: xpMult
        });

        // Per-guild stats + XP
        if (interaction.guildId) {
          void (async () => {
            try {
              const { addStat } = await import('../game/activityStats.js');
              const { addGuildXp } = await import('../game/guildXp.js');
              addStat(interaction.user.id, interaction.guildId, 'fight_wins', 1);
              addStat(interaction.user.id, interaction.guildId, 'credits_earned', credits);
              await addGuildXp(interaction.user.id, interaction.guildId, 'fight_win', { client: interaction.client }).catch(() => {});
            } catch {}
          })();
        }

        // Drop: always one, with a small chance for an extra on harder difficulties.
        const drop1 = pick(diff.drops);
        await addItem(interaction.user.id, drop1, 1);
        let drop2 = null;
        if (diff.id === "hard" || diff.id === "elite") {
          if (Math.random() < (diff.id === "elite" ? 0.35 : 0.2)) {
            drop2 = pick(diff.drops);
            await addItem(interaction.user.id, drop2, 1);
          }
        }

        await setCooldown(interaction.user.id, "battle", BATTLE_COOLDOWN);
        const wallet = await getWallet(interaction.user.id);

        const embed = new EmbedBuilder()
          .setTitle(`${diff.emoji} Victory`)
          .setColor(Colors.SUCCESS)
          .setDescription(`You cleared an **${diff.name}** encounter.`)
          .addFields(
            { name: "Rewards", value: `+${credits.toLocaleString()} Credits\n+${xpRes.applied.toLocaleString()} XP`, inline: true },
            { name: "Balance", value: `${wallet.balance.toLocaleString()} Credits`, inline: true },
            { name: "Cooldown", value: formatCooldown(BATTLE_COOLDOWN), inline: true },
            { name: "Drops", value: drop2 ? `📦 \`${drop1}\`\n📦 \`${drop2}\`` : `📦 \`${drop1}\``, inline: false }
          )
          .setFooter({ text: xpRes.leveledUp ? `Level Up: ${xpRes.fromLevel} -> ${xpRes.toLevel}` : "Sell drops with /use or store value in /bank." })
          .setTimestamp();

        if (xpRes.granted?.length) {
          const crates = xpRes.granted.slice(0, 3).map(g => `Lv ${g.level}: \`${g.crateId}\``).join("\n");
          const more = xpRes.granted.length > 3 ? `\n...and ${xpRes.granted.length - 3} more.` : "";
          embed.addFields({ name: "Level Rewards", value: crates + more, inline: false });
        }

        await interaction.editReply({ embeds: [embed] });

        try { await recordQuestEvent(interaction.user.id, "fight_wins", 1); } catch {}
      } catch (err) {
        botLogger.error({ err: err }, "[fight] error:");
        await replyError(interaction, "Fight Failed", "Something went wrong. Try again later.", true);
      }
    }, { label: "fight" });
  }
};
