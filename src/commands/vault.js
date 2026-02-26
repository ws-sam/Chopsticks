import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getCollection } from "../economy/collections.js";
import { getItemData } from "../economy/inventory.js";
import { describeLegacyItem, isLegacyItemId } from "../economy/legacyItems.js";
import { Colors, replyEmbed } from "../utils/discordOutput.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  deployGlobal: false,
  category: "economy",
  guildOnly: true,
};

export default {
  data: new SlashCommandBuilder()
    .setName("vault")
    .setDescription("Showcase your rarest catches")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("View another user's vault")
    ),

  async execute(interaction) {
    await interaction.deferReply();

    await withTimeout(interaction, async () => {
      const targetUser = interaction.options.getUser("user") || interaction.user;

      try {
        const collection = await getCollection(targetUser.id);

        if (collection.length === 0) {
          return await replyEmbed(
            interaction,
            "Empty Vault",
            `${targetUser.id === interaction.user.id ? "Your vault is" : `${targetUser.username}'s vault is`} empty. Start gathering to fill it with rare items!`,
            Colors.WARNING,
            true
          );
        }

        // Get rarest items (mythic > legendary > epic)
        const mythics = collection.filter(item => item.rarity === "mythic");
        const legendaries = collection.filter(item => item.rarity === "legendary");
        const epics = collection.filter(item => item.rarity === "epic");

        // Build showcase
        const rarityEmojis = {
          mythic: "✨",
          legendary: "💎",
          epic: "🔮"
        };

        const buildSection = (items, rarity) => {
          if (items.length === 0) return null;
          
          return items.slice(0, 5).map(item => {
            const foundItem = getItemData(item.item_id) || (isLegacyItemId(item.item_id) ? describeLegacyItem(item.item_id, item.rarity) : null);
            const itemEmoji = foundItem?.emoji || "📦";
            const itemName = foundItem?.name || item.item_id;
            const countText = item.count > 1 ? ` (×${item.count})` : "";
            return `${rarityEmojis[rarity]} ${itemEmoji} **${itemName}**${countText}`;
          }).join("\n");
        };

        const embed = new EmbedBuilder()
          .setTitle(`${targetUser.username}'s Vault`)
          .setDescription("A showcase of the rarest items collected from the digital void.")
          .setColor(Colors.PRIMARY)
          .setThumbnail(targetUser.displayAvatarURL())
          .setTimestamp();

        if (mythics.length > 0) {
          embed.addFields({ 
            name: "✨ Mythic Treasures", 
            value: buildSection(mythics, "mythic"), 
            inline: false 
          });
        }

        if (legendaries.length > 0) {
          embed.addFields({ 
            name: "💎 Legendary Items", 
            value: buildSection(legendaries, "legendary"), 
            inline: false 
          });
        }

        if (epics.length > 0) {
          embed.addFields({ 
            name: "🔮 Epic Finds", 
            value: buildSection(epics, "epic"), 
            inline: false 
          });
        }

        if (mythics.length === 0 && legendaries.length === 0 && epics.length === 0) {
          embed.setDescription("No rare items to showcase yet. Keep gathering to find mythic, legendary, and epic treasures!");
        }

        embed.setFooter({ 
          text: `Total Rare Items: ${mythics.length + legendaries.length + epics.length}` 
        });

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        botLogger.error({ err: error }, "Vault command error");
        await interaction.editReply({
          content: "❌ Failed to load vault. Try again later.",
          ephemeral: true
        });
      }
    }, { label: "vault" });
  }
};
