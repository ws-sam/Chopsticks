import { SlashCommandBuilder } from "discord.js";
import { getInventory, removeItem, getItemData } from "../economy/inventory.js";
import { addCredits } from "../economy/wallet.js";
import { replySuccess, replyError } from "../utils/discordOutput.js";
import { setBuff } from "../game/buffs.js";
import { recordQuestEvent } from "../game/quests.js";
import { openCrateRolls } from "../game/crates.js";
import itemsData from "../economy/items.json" with { type: "json" };
import { addItem } from "../economy/inventory.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  category: "economy",
  guildOnly: true,
};

export default {
  data: new SlashCommandBuilder()
    .setName("use")
    .setDescription("Use or consume an item from your inventory")
    .addStringOption(option =>
      option
        .setName("item")
        .setDescription("Item ID or name to use")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("quantity")
        .setDescription("Quantity to use (default: 1)")
        .setMinValue(1)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    await withTimeout(interaction, async () => {
      const itemQuery = interaction.options.getString("item").toLowerCase();
      const quantity = interaction.options.getInteger("quantity") || 1;

      try {
        // Get user inventory
        const inventory = await getInventory(interaction.user.id);
        
        // Find matching item
        const matchedItem = inventory.find(invItem => {
          const itemData = invItem.itemData;
          return invItem.item_id === itemQuery || String(itemData?.name || "").toLowerCase().includes(itemQuery);
        });

        if (!matchedItem) {
          return await replyError(
            interaction,
            "Item Not Found",
            `You don't have any item matching "${itemQuery}". Check \`/inventory\` to see what you have.`,
            true
          );
        }

        const itemData = getItemData(matchedItem.item_id, matchedItem.metadata) || matchedItem.itemData;
        if (!itemData) {
          return await replyError(interaction, "Invalid Item", "Item data not found.", true);
        }

        // Check quantity
        if (matchedItem.quantity < quantity) {
          return await replyError(
            interaction,
            "Insufficient Quantity",
            `You only have ${matchedItem.quantity} of ${itemData.name}.`,
            true
          );
        }

        // Handle different item categories
        if (itemData.category === "consumable") {
          await handleConsumable(interaction, matchedItem, itemData, quantity);
        } else if (itemData.category === "collectible") {
          // Sell collectible
          const unitPrice = Math.max(1, Number(itemData.sellPrice || matchedItem.itemData?.sellPrice || 0));
          const totalValue = unitPrice * quantity;
          await removeItem(interaction.user.id, matchedItem.item_id, quantity, matchedItem.metadata);
          await addCredits(interaction.user.id, totalValue, "Sold collectible");
          try { await recordQuestEvent(interaction.user.id, "sell_items", quantity); } catch {}

          await replySuccess(
            interaction,
            "Item Sold",
            `Sold **${quantity}x ${itemData.emoji} ${itemData.name}** for **${totalValue.toLocaleString()} Credits**!`,
            true
          );
        } else if (itemData.category === "tool") {
          return await replyError(
            interaction,
            "Cannot Use Tool",
            `${itemData.emoji} **${itemData.name}** is a tool. Equip it using \`/gather\` instead.`,
            true
          );
        } else {
          return await replyError(interaction, "Unknown Item Type", "This item cannot be used.", true);
        }
      } catch (error) {
        botLogger.error({ err: error }, "Use command error");
        await replyError(interaction, "Error", "Failed to use item. Try again later.", true);
      }
    }, { label: "use" });
  }
};

async function handleConsumable(interaction, matchedItem, itemData, quantity) {
  // Remove item from inventory
  await removeItem(interaction.user.id, matchedItem.item_id, quantity, matchedItem.metadata);

    // Apply effect based on item effect type
    let effectDescription = "";

    switch (itemData.effect) {
      case "loot_crate": {
        const { drops } = openCrateRolls(matchedItem.item_id, quantity);
        for (const id of drops) {
          // eslint-disable-next-line no-await-in-loop
          await addItem(interaction.user.id, id, 1);
        }

        const countBy = new Map();
        for (const id of drops) countBy.set(id, (countBy.get(id) || 0) + 1);
        const lines = Array.from(countBy.entries())
          .slice(0, 12)
          .map(([id, n]) => {
            const it = (itemsData.tools?.[id] || itemsData.consumables?.[id] || itemsData.collectibles?.[id]) || null;
            const name = it?.name || id;
            const emoji = it?.emoji || "📦";
            return `${emoji} **${name}**${n > 1 ? ` ×${n}` : ""}`;
          });
        const more = countBy.size > lines.length ? `\n...and ${countBy.size - lines.length} more.` : "";

        effectDescription = `Opened **${quantity}x ${itemData.emoji} ${itemData.name}** and got:\n\n${lines.join("\n")}${more}`;
        break;
      }

      case "cooldown_reduction":
        // Currently scoped to /work (matches Energy Drink description).
        await setBuff(interaction.user.id, "cd:work", 1 - Number(itemData.effectValue || 0), itemData.duration);
        effectDescription = `Your **/work** cooldown is reduced by ${Math.round(Number(itemData.effectValue || 0) * 100)}% for ${formatDuration(itemData.duration)}.`;
        break;

      case "luck_boost":
        await setBuff(interaction.user.id, "luck:gather", Number(itemData.effectValue || 0), itemData.duration);
        effectDescription = `Your **/gather** luck increased by ${Math.round(Number(itemData.effectValue || 0) * 100)}% for ${formatDuration(itemData.duration)}.`;
        break;

      case "companion_restore":
        effectDescription = `Companion stats restored: +${itemData.effectValue.hunger} hunger, +${itemData.effectValue.happiness} happiness!`;
        // TODO: Update companion stats
        break;

      case "xp_multiplier":
        await setBuff(interaction.user.id, "xp:mult", Number(itemData.effectValue || 1), itemData.duration);
        effectDescription = `XP gain multiplied by **${Number(itemData.effectValue || 1)}x** for ${formatDuration(itemData.duration)}.`;
        break;

      case "premium_unlock":
        effectDescription = `Premium features unlocked for ${formatDuration(itemData.duration)}!`;
        // TODO: Grant temporary premium access
        break;

      default:
        effectDescription = "Item consumed.";
    }

  await replySuccess(
    interaction,
    "Item Used",
    `${itemData.emoji} Used **${quantity}x ${itemData.name}**\n\n${effectDescription}`,
    true
  );
}

function formatDuration(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""}`;
  return "a moment";
}
