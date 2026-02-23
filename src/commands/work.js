import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getCooldown, setCooldown, formatCooldown } from "../economy/cooldowns.js";
import { addCredits, getWallet } from "../economy/wallet.js";
import { addItem } from "../economy/inventory.js";
import { Colors, replySuccess, replyError } from "../utils/discordOutput.js";
import { maybeBuildGuildFunLine } from "../fun/integrations.js";
import { addGameXp } from "../game/profile.js";
import { getMultiplier } from "../game/buffs.js";
import { recordQuestEvent } from "../game/quests.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const WORK_COOLDOWN = 30 * 60 * 1000; // 30 minutes

export const JOBS = [
  {
    id: "programmer",
    name: "Code Review",
    emoji: "💻",
    description: "Debug legacy code for a tech startup",
    baseReward: 300,
    variance: 100,
    itemChance: 0.15,
    possibleItems: ["data_fragment", "corrupted_file"]
  },
  {
    id: "musician",
    name: "DJ Gig",
    emoji: "🎵",
    description: "Perform at a virtual nightclub",
    baseReward: 250,
    variance: 80,
    itemChance: 0.1,
    possibleItems: ["data_fragment"]
  },
  {
    id: "miner",
    name: "Data Mining",
    emoji: "⛏️",
    description: "Extract valuable data from abandoned servers",
    baseReward: 350,
    variance: 120,
    itemChance: 0.2,
    possibleItems: ["data_fragment", "encryption_key", "neural_chip"]
  },
  {
    id: "trader",
    name: "Market Trading",
    emoji: "📈",
    description: "Flip items on the marketplace",
    baseReward: 400,
    variance: 150,
    itemChance: 0.05,
    possibleItems: ["hologram_badge"]
  }
];

export const meta = {
  category: "economy",
  guildOnly: true,
};

export default {
  data: new SlashCommandBuilder()
    .setName("work")
    .setDescription("Work a job to earn Credits (30min cooldown)")
    .addStringOption(option =>
      option
        .setName("job")
        .setDescription("Choose your job")
        .setRequired(true)
        .addChoices(
          ...JOBS.map(job => ({ name: `${job.emoji} ${job.name}`, value: job.id }))
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    await withTimeout(interaction, async () => {
      const jobId = interaction.options.getString("job");
      const job = JOBS.find(j => j.id === jobId);

      if (!job) {
        return await replyError(interaction, "Invalid Job", "Job not found.", true);
      }

      try {
        // Check cooldown
        const cooldown = await getCooldown(interaction.user.id, "work");
        if (cooldown && cooldown.ok === false) {
          const timeLeft = formatCooldown(cooldown.remaining);
          return await replyError(
            interaction,
            "On Break",
            `You're still recovering from your last job. Come back in **${timeLeft}**.`,
            true
          );
        }

        // Calculate reward with variance
        const variance = Math.floor(Math.random() * (job.variance * 2)) - job.variance;
        const reward = Math.max(50, job.baseReward + variance);

        // Add credits
        await addCredits(interaction.user.id, reward, `Work: ${job.name}`);

        // XP + cooldown modifiers (from consumables).
        const xpMult = await getMultiplier(interaction.user.id, "xp:mult", 1);
        const cdMult = await getMultiplier(interaction.user.id, "cd:work", 1);

        const xpBase = Math.max(10, Math.trunc(reward / 12));
        const xpRes = await addGameXp(interaction.user.id, xpBase, {
          reason: `work:${job.id}`,
          multiplier: xpMult
        });

        // Per-guild stats + XP
        if (interaction.guildId) {
          void (async () => {
            try {
              const { addStat } = await import('../game/activityStats.js');
              const { addGuildXp } = await import('../game/guildXp.js');
              addStat(interaction.user.id, interaction.guildId, 'work_runs', 1);
              await addGuildXp(interaction.user.id, interaction.guildId, 'work', { client: interaction.client }).catch(() => {});
            } catch {}
          })();
        }

        // Set cooldown (can be reduced by buffs)
        const effectiveCooldown = Math.max(60 * 1000, Math.trunc(WORK_COOLDOWN * cdMult));
        await setCooldown(interaction.user.id, "work", effectiveCooldown);

        // Quest progress (best-effort; do not fail command if quests are misconfigured).
        try { await recordQuestEvent(interaction.user.id, "work_runs", 1); } catch {}

        // Check for item drop
        let itemDropped = null;
        if (Math.random() < job.itemChance) {
          const randomItem = job.possibleItems[Math.floor(Math.random() * job.possibleItems.length)];
          await addItem(interaction.user.id, randomItem, 1);
          itemDropped = randomItem;
        }

        // Get updated balance
        const wallet = await getWallet(interaction.user.id);

        const embed = new EmbedBuilder()
          .setTitle(`${job.emoji} ${job.name}`)
          .setDescription(job.description)
          .setColor(Colors.SUCCESS)
          .addFields(
            { name: "Earned", value: `${reward.toLocaleString()} Credits`, inline: true },
            { name: "New Balance", value: `${wallet.balance.toLocaleString()} Credits`, inline: true },
            {
              name: "XP",
              value: `${xpRes.applied.toLocaleString()} XP${xpRes.leveledUp ? ` • Level Up: ${xpRes.fromLevel} -> ${xpRes.toLevel}` : ""}`,
              inline: false
            }
          )
          .setFooter({ text: `Come back in ${formatCooldown(effectiveCooldown)} for another job.` })
          .setTimestamp();

        if (xpRes.granted?.length) {
          const crates = xpRes.granted.slice(0, 3).map(g => `Lv ${g.level}: \`${g.crateId}\``).join("\n");
          const more = xpRes.granted.length > 3 ? `\n...and ${xpRes.granted.length - 3} more.` : "";
          embed.addFields({ name: "Level Rewards", value: crates + more, inline: false });
        }

        if (itemDropped) {
          const itemData = await import("../economy/items.json", { assert: { type: "json" } });
          let foundItem = null;
          for (const category in itemData.default) {
            if (itemData.default[category][itemDropped]) {
              foundItem = itemData.default[category][itemDropped];
              break;
            }
          }
          if (foundItem) {
            embed.addFields({
              name: "Bonus Item!",
              value: `${foundItem.emoji} **${foundItem.name}**`,
              inline: false
            });
          }
        }

        const flavor = await maybeBuildGuildFunLine({
          guildId: interaction.guildId,
          feature: "work",
          actorTag: interaction.user.username,
          target: job.name,
          intensity: reward >= job.baseReward + Math.floor(job.variance / 2) ? 4 : 3,
          maxLength: 180
        });
        if (flavor) {
          embed.addFields({
            name: "Flavor",
            value: flavor,
            inline: false
          });
        }

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        botLogger.error({ err: error }, "Work command error:");
        await replyError(interaction, "Work Failed", "Failed to complete job. Try again later.", true);
      }
    }, { label: "work" });
  }
};
