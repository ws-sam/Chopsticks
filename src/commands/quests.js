import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder
} from "discord.js";
import { Colors, replyError } from "../utils/discordOutput.js";
import { claimQuestRewards, getDailyQuests } from "../game/quests.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

const QUEST_UI_PREFIX = "questui";

export const meta = {
  category: "economy",
  guildOnly: true,
};

export const data = new SlashCommandBuilder()
  .setName("quests")
  .setDescription("View and claim daily quests");

function uiId(kind, userId) {
  return `${QUEST_UI_PREFIX}:${kind}:${userId}`;
}

function parseUiId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length < 3) return null;
  if (parts[0] !== QUEST_UI_PREFIX) return null;
  return { kind: parts[1], userId: parts[2] };
}

function fmtReward(q) {
  const credits = Math.max(0, Math.trunc(Number(q.reward?.credits) || 0));
  const xp = Math.max(0, Math.trunc(Number(q.reward?.xp) || 0));
  const item = q.reward?.item ? ` +1 ${q.reward.item}` : "";
  return `${credits.toLocaleString()}c, ${xp.toLocaleString()}xp${item}`;
}

async function buildQuestsEmbed(userId) {
  const row = await getDailyQuests(userId);
  const quests = row.quests || [];
  const progress = row.progress || {};
  const claimed = row.claimed || {};

  const lines = quests.map(q => {
    const cur = Math.max(0, Math.trunc(Number(progress[q.id]) || 0));
    const tgt = Math.max(1, Math.trunc(Number(q.target) || 1));
    const done = cur >= tgt;
    const isClaimed = Boolean(claimed[q.id]);
    const box = isClaimed ? "✅" : (done ? "🟩" : "⬜");
    const pct = Math.min(100, Math.round((cur / tgt) * 100));
    return `${box} **${q.title}** (${cur}/${tgt}, ${pct}%)\n${q.description}\nReward: \`${fmtReward(q)}\``;
  });

  const embed = new EmbedBuilder()
    .setTitle("Daily Quests")
    .setColor(Colors.PRIMARY)
    .setDescription(lines.length ? lines.join("\n\n") : "No quests available yet.")
    .setFooter({ text: `Day: ${row.day} • Complete quests by using /work, /gather, /fight, /shop, /use` })
    .setTimestamp();

  return embed;
}

function buildComponents(userId) {
  const claim = new ButtonBuilder()
    .setCustomId(uiId("claim", userId))
    .setLabel("Claim Completed")
    .setStyle(ButtonStyle.Primary);

  const refresh = new ButtonBuilder()
    .setCustomId(uiId("refresh", userId))
    .setLabel("Refresh")
    .setStyle(ButtonStyle.Secondary);

  return [new ActionRowBuilder().addComponents(claim, refresh)];
}

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  await withTimeout(interaction, async () => {
    try {
      const embed = await buildQuestsEmbed(interaction.user.id);
      const components = buildComponents(interaction.user.id);
      await interaction.editReply({ embeds: [embed], components });
    } catch (err) {
      botLogger.error({ err: err }, "[quests] error:");
      await replyError(interaction, "Quests Failed", "Couldn't load quests right now.", true);
    }
  }, { label: "quests" });
}

export default { data, execute };

export async function handleButton(interaction) {
  if (!interaction.isButton?.()) return false;
  const parsed = parseUiId(interaction.customId);
  if (!parsed) return false;

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({ content: "This quest panel belongs to another user.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (parsed.kind === "refresh") {
    await interaction.deferUpdate();
    const embed = await buildQuestsEmbed(interaction.user.id);
    await interaction.editReply({ embeds: [embed], components: buildComponents(interaction.user.id) });
    return true;
  }

  if (parsed.kind === "claim") {
    await interaction.deferUpdate();
    try {
      const res = await claimQuestRewards(interaction.user.id);
      const embed = await buildQuestsEmbed(interaction.user.id);
      await interaction.editReply({ embeds: [embed], components: buildComponents(interaction.user.id) });

      if (!res.ok) {
        const msg = res.reason === "nothing" ? "No completed quests to claim yet." : "No quest data for today yet.";
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
        return true;
      }

      const rewardLine =
        `Claimed **${res.completed.length}** quest(s): ` +
        `+${res.totalCredits.toLocaleString()} Credits, +${res.totalXp.toLocaleString()} XP` +
        (res.items?.length ? `, items: ${res.items.map(i => `\`${i}\``).join(", ")}` : "");

      await interaction.followUp({ content: rewardLine, flags: MessageFlags.Ephemeral });
      return true;
    } catch (err) {
      botLogger.error({ err: err }, "[quests:claim] error:");
      await interaction.followUp({ content: "Claim failed. Try again.", flags: MessageFlags.Ephemeral });
      return true;
    }
  }

  return false;
}

