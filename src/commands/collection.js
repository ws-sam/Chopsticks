import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getCollection, getCollectionStats } from "../economy/collections.js";
import { getItemData } from "../economy/inventory.js";
import { describeLegacyItem, isLegacyItemId } from "../economy/legacyItems.js";
import { Colors, replyEmbed } from "../utils/discordOutput.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

const ITEMS_PER_PAGE = 12;

export const meta = {
  category: "economy",
  guildOnly: true,
};

export default {
  data: new SlashCommandBuilder()
    .setName("collection")
    .setDescription("View your collection of gathered items")
    .addIntegerOption(option =>
      option
        .setName("page")
        .setDescription("Page number")
        .setMinValue(1)
    )
    .addStringOption(option =>
      option
        .setName("filter")
        .setDescription("Filter by rarity")
        .addChoices(
          { name: "✨ Mythic", value: "mythic" },
          { name: "💎 Legendary", value: "legendary" },
          { name: "🔮 Epic", value: "epic" },
          { name: "💠 Rare", value: "rare" },
          { name: "⚪ Common", value: "common" }
        )
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("View another user's collection")
    ),

  async execute(interaction) {
    await interaction.deferReply();

    await withTimeout(interaction, async () => {
      const targetUser = interaction.options.getUser("user") || interaction.user;
      const page = interaction.options.getInteger("page") || 1;
      const filter = interaction.options.getString("filter");

      try {
        const collection = await getCollection(targetUser.id);
        const stats = await getCollectionStats(targetUser.id);

        if (collection.length === 0) {
          return await replyEmbed(
            interaction,
            "Empty Collection",
            `${targetUser.id === interaction.user.id ? "You haven't" : `${targetUser.username} hasn't`} gathered any items yet. Use \`/gather\` to start collecting!`,
            Colors.WARNING,
            true
          );
        }

        // Filter by rarity if specified
        let filteredCollection = filter 
          ? collection.filter(item => item.rarity === filter)
          : collection;

        if (filteredCollection.length === 0) {
          return await replyEmbed(
            interaction,
            "No Items Found",
            `No ${filter} items in this collection.`,
            Colors.WARNING,
            true
          );
        }

        // Pagination
        const totalPages = Math.ceil(filteredCollection.length / ITEMS_PER_PAGE);
        const validPage = Math.max(1, Math.min(page, totalPages));
        const start = (validPage - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const pageItems = filteredCollection.slice(start, end);

        // Build collection display
        const rarityEmojis = {
          mythic: "✨",
          legendary: "💎",
          epic: "🔮",
          rare: "💠",
          common: "⚪"
        };

        const itemsList = pageItems.map(item => {
          const foundItem = getItemData(item.item_id) || (isLegacyItemId(item.item_id) ? describeLegacyItem(item.item_id, item.rarity) : null);
          const itemEmoji = foundItem?.emoji || "📦";
          const itemName = foundItem?.name || item.item_id;
          const rarityEmoji = rarityEmojis[item.rarity] || "❓";
          const countText = item.count > 1 ? ` ×${item.count}` : "";
          return `${rarityEmoji} ${itemEmoji} **${itemName}**${countText}`;
        }).join("\n");

        const embed = new EmbedBuilder()
          .setTitle(`${targetUser.username}'s Collection`)
          .setDescription(itemsList || "No items to display")
          .setColor(Colors.PRIMARY)
          .addFields(
            { name: "Unique Items", value: stats.unique_items.toString(), inline: true },
            { name: "Total Caught", value: stats.total_caught.toString(), inline: true },
            { name: "Page", value: `${validPage} / ${totalPages}`, inline: true }
          )
          .setFooter({ 
            text: `✨ ${stats.mythic_count} | 💎 ${stats.legendary_count} | 🔮 ${stats.epic_count} | 💠 ${stats.rare_count} | ⚪ ${stats.common_count}` 
          })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        botLogger.error({ err: error }, "Collection command error");
        await interaction.editReply({
          content: "❌ Failed to load collection. Try again later.",
          ephemeral: true
        });
      }
    }, { label: "collection" });
  }
};
