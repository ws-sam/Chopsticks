import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getInventory } from "../economy/inventory.js";
import { Colors, replyEmbed } from "../utils/discordOutput.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

const ITEMS_PER_PAGE = 10;

export const meta = {
  category: "economy",
  guildOnly: true,
};

export default {
  data: new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("View your inventory items")
    .addIntegerOption(option =>
      option
        .setName("page")
        .setDescription("Page number to view")
        .setMinValue(1)
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("View another user's inventory")
    ),

  async execute(interaction) {
    await interaction.deferReply();

    await withTimeout(interaction, async () => {
      const targetUser = interaction.options.getUser("user") || interaction.user;
      const page = interaction.options.getInteger("page") || 1;

      try {
        const inventory = await getInventory(targetUser.id);

        if (inventory.length === 0) {
          return await replyEmbed(
            interaction,
            "Empty Inventory",
            `${targetUser.id === interaction.user.id ? "You don't" : `${targetUser.username} doesn't`} have any items yet. Use \`/work\` or \`/gather\` to collect items!`,
            Colors.WARNING,
            true
          );
        }

        // Pagination
        const totalPages = Math.ceil(inventory.length / ITEMS_PER_PAGE);
        const validPage = Math.max(1, Math.min(page, totalPages));
        const start = (validPage - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const pageItems = inventory.slice(start, end);

        // Build inventory list
        const itemList = pageItems
          .map(item => {
            const emoji = item.itemData.emoji || "📦";
            const name = item.itemData.name || item.item_id;
            const qty = item.quantity > 1 ? ` ×${item.quantity}` : "";
            const rarity = item.itemData.rarity ? ` [${item.itemData.rarity.toUpperCase()}]` : "";
            return `${emoji} **${name}**${qty}${rarity}`;
          })
          .join("\n");

        // Calculate total value
        const totalValue = inventory.reduce((sum, item) => {
          const price = item.itemData.sellPrice || 0;
          return sum + (price * item.quantity);
        }, 0);

        const embed = new EmbedBuilder()
          .setTitle(`${targetUser.username}'s Inventory`)
          .setDescription(itemList)
          .setColor(Colors.PRIMARY)
          .addFields(
            { name: "Total Items", value: inventory.length.toString(), inline: true },
            { name: "Total Value", value: `${totalValue.toLocaleString()} Credits`, inline: true },
            { name: "Page", value: `${validPage} / ${totalPages}`, inline: true }
          )
          .setFooter({ text: "Use /use [item] to consume items" })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        botLogger.error({ err: error }, "Inventory command error");
        await interaction.editReply({
          content: "❌ Failed to load inventory. Try again later.",
          ephemeral: true
        });
      }
    }, { label: "inventory" });
  }
};
