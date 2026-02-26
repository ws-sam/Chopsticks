import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from "discord.js";
import { getCooldown, setCooldown, formatCooldown } from "../economy/cooldowns.js";
import { hasItem, addItem } from "../economy/inventory.js";
import { performGather, addToCollection } from "../economy/collections.js";
import { Colors, replyError } from "../utils/discordOutput.js";
import itemsData from "../economy/items.json" with { type: "json" };
import { renderGatherCardPng } from "../game/render/imCards.js";
import { loadGuildData } from "../utils/storage.js";
import { addGameXp } from "../game/profile.js";
import { getMultiplier, getBuff } from "../game/buffs.js";
import { recordQuestEvent } from "../game/quests.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const GATHER_COOLDOWN = 5 * 60 * 1000; // 5 minutes

export const meta = {
  deployGlobal: false,
  category: "game",
  guildOnly: true,
};

export default {
  data: new SlashCommandBuilder()
    .setName("gather")
    .setDescription("Run a gather mission for collectible loot (5min cooldown)")
    .addStringOption(option =>
      option
        .setName("tool")
        .setDescription("Tool to use (optional, improves yield)")
        .addChoices(
          { name: "🔍 Basic Scanner (+0% bonus)", value: "basic_scanner" },
          { name: "🔬 Advanced Scanner (+15% bonus)", value: "advanced_scanner" },
          { name: "⚛️ Quantum Scanner (+35% bonus)", value: "quantum_scanner" },
          { name: "🪤 Basic Net (+5% bonus)", value: "basic_net" },
          { name: "🕸️ Reinforced Net (+25% bonus)", value: "reinforced_net" }
        )
    )
    .addStringOption(option =>
      option
        .setName("zone")
        .setDescription("Focus your run on a loot zone")
        .addChoices(
          { name: "🎯 Any Zone", value: "any" },
          { name: "🧙 Characters", value: "characters" },
          { name: "👾 Monsters", value: "monsters" },
          { name: "🎒 Loot", value: "loot" },
          { name: "🍖 Food", value: "food" },
          { name: "✨ Skills", value: "skills" },
          { name: "🧩 Misc", value: "misc" }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    await withTimeout(interaction, async () => {
      try {
        // Check cooldown
        const cooldown = await getCooldown(interaction.user.id, "gather");
        if (cooldown && cooldown.ok === false) {
          const timeLeft = formatCooldown(cooldown.remaining);
          return await replyError(
            interaction,
            "Scanner Recharging",
            `Your gathering equipment is recharging. Try again in **${timeLeft}**.`,
            true
          );
        }

        // Check if user has selected tool
        let toolBonus = 0;
        let toolUsed = null;
        const selectedTool = interaction.options.getString("tool");

        if (selectedTool) {
          const hasTool = await hasItem(interaction.user.id, selectedTool);
          if (!hasTool) {
            return await replyError(
              interaction,
              "Tool Not Found",
              `You don't have a **${itemsData.tools[selectedTool].name}**. Use \`/gather\` without a tool or check \`/inventory\`.`,
              true
            );
          }

          toolUsed = itemsData.tools[selectedTool];
          toolBonus = toolUsed.gatherBonus || 0;

          // Reduce tool durability (20% chance to lose 1 durability)
          if (Math.random() < 0.2) {
            // TODO: Implement durability system with metadata
            // For now, just log
            botLogger.debug(`Tool ${selectedTool} used, durability decreased`);
          }
        }

        const selectedZone = interaction.options.getString("zone") || "any";
        const gatherSource = "core";

        const luck = await getBuff(interaction.user.id, "luck:gather");
        const luckBoostPct = Math.max(0, Math.trunc((Number(luck) || 0) * 100));

        const fallback = performGather(toolBonus, luckBoostPct, selectedZone);
        let results = fallback.map(entry => ({ ...entry, category: selectedZone }));

        if (results.length === 0) {
          return await replyError(
            interaction,
            "Gather Failed",
            "No loot could be generated. Try again.",
            true
          );
        }

        // Add items to inventory AND collection
        for (const result of results) {
          await addItem(interaction.user.id, result.itemId, 1);
          await addToCollection(interaction.user.id, result.category || "general", result.itemId, result.rarity);
        }

        // Set cooldown
        await setCooldown(interaction.user.id, "gather", GATHER_COOLDOWN);

        try { await recordQuestEvent(interaction.user.id, "gather_runs", 1); } catch {}

        // XP gain (rarity-weighted), affected by xp multiplier consumable.
        const rarityXp = { common: 12, rare: 20, epic: 35, legendary: 55, mythic: 120 };
        const xpBase = results.reduce((sum, r) => sum + (rarityXp[r.rarity] || 12), 0);
        const xpMult = await getMultiplier(interaction.user.id, "xp:mult", 1);
        const xpRes = await addGameXp(interaction.user.id, xpBase, {
          reason: "gather",
          multiplier: xpMult
        });

        // Per-guild stats + XP
        if (interaction.guildId) {
          void (async () => {
            try {
              const { addStat } = await import('../game/activityStats.js');
              const { addGuildXp } = await import('../game/guildXp.js');
              addStat(interaction.user.id, interaction.guildId, 'gather_runs', 1);
              await addGuildXp(interaction.user.id, interaction.guildId, 'gather', { client: interaction.client }).catch(() => {});
            } catch {}
          })();
        }

        // Build response
        const rarityEmojis = {
          mythic: "✨",
          legendary: "💎",
          epic: "🔮",
          rare: "💠",
          common: "⚪"
        };

        const itemsList = results.map(r => {
          const foundItem = resolveStaticItem(r.itemId);
          const itemEmoji = foundItem?.emoji || "📦";
          const itemName = foundItem?.name || r.itemId;
          const rarityEmoji = rarityEmojis[r.rarity] || "❓";
          return `${rarityEmoji} ${itemEmoji} **${itemName}** [${r.rarity.toUpperCase()}]`;
        }).join("\n");

        const files = [];

        const embed = new EmbedBuilder()
          .setTitle("⚡ Gather Run Complete")
          .setDescription(`You returned with:\n\n${itemsList}`)
          .setColor(Colors.SUCCESS)
          .addFields(
            { name: "Items Found", value: results.length.toString(), inline: true },
            { name: "Zone", value: formatZone(selectedZone), inline: true },
            { name: "Cooldown", value: "5 minutes", inline: true },
            {
              name: "XP",
              value: `${xpRes.applied.toLocaleString()} XP${xpRes.leveledUp ? ` • Level Up: ${xpRes.fromLevel} -> ${xpRes.toLevel}` : ""}`,
              inline: false
            }
          )
          .setFooter({
            text: toolUsed
              ? `Tool: ${toolUsed.emoji} ${toolUsed.name} | Source: ${gatherSource}`
              : `No tool equipped | Source: ${gatherSource}`
          })
          .setTimestamp();

        if (xpRes.granted?.length) {
          const crates = xpRes.granted.slice(0, 3).map(g => `Lv ${g.level}: \`${g.crateId}\``).join("\n");
          const more = xpRes.granted.length > 3 ? `\n...and ${xpRes.granted.length - 3} more.` : "";
          embed.addFields({ name: "Level Rewards", value: crates + more, inline: false });
        }

        // Pro image output: render an SVG card -> PNG attachment.
        try {
          const theme = interaction.inGuild()
            ? ((await loadGuildData(interaction.guildId))?.game?.theme || "neo")
            : "neo";

          const itemModels = results.slice(0, 4).map(r => {
            const it = resolveStaticItem(r.itemId);
            return {
              id: r.itemId,
              name: it?.name || r.itemId,
              rarity: r.rarity
            };
          });
          const png = await renderGatherCardPng({
            title: "Gather Run",
            subtitle: `Zone: ${formatZone(selectedZone)} | Drops: ${results.length}`,
            items: itemModels,
            theme
          });
          files.push(new AttachmentBuilder(png, { name: "gather.png" }));
          embed.setImage("attachment://gather.png");
        } catch (err) {
          botLogger.warn("[gather] failed to render card image:", err?.message ?? err);
        }

        await interaction.editReply({ embeds: [embed], files });
      } catch (error) {
        botLogger.error({ err: error }, "Gather command error:");
        await replyError(interaction, "Gather Failed", "Something went wrong. Try again later.", true);
      }
    }, { label: "gather" });
  }
};

function resolveStaticItem(itemId) {
  for (const category in itemsData) {
    if (itemsData[category][itemId]) return itemsData[category][itemId];
  }
  return null;
}

function formatZone(zone) {
  const map = {
    any: "Any",
    characters: "Characters",
    monsters: "Monsters",
    loot: "Loot",
    food: "Food",
    skills: "Skills",
    misc: "Misc"
  };
  return map[String(zone || "any").toLowerCase()] || "Any";
}
