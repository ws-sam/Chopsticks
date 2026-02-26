import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { listShopCategories, listShopItems, findShopItem, searchShopItems } from "../economy/shop.js";
import { addItem } from "../economy/inventory.js";
import { getWallet, removeCredits } from "../economy/wallet.js";
import { Colors, replyError } from "../utils/discordOutput.js";
import { recordQuestEvent } from "../game/quests.js";
import { withTimeout } from "../utils/interactionTimeout.js";

function formatItemLine(it) {
  const emoji = it.emoji || "🧾";
  const price = Math.max(0, Number(it.price) || 0);
  const rarity = it.rarity ? ` [${String(it.rarity).toUpperCase()}]` : "";
  return `${emoji} **${it.name || it.id}**${rarity} • \`${it.id}\` • **${price.toLocaleString()}** Credits`;
}

export const meta = {
  deployGlobal: false,
  category: "economy",
  guildOnly: true,
};

export default {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Buy tools and consumables")
    .addSubcommand(s =>
      s
        .setName("browse")
        .setDescription("Browse shop inventory")
        .addStringOption(o =>
          o
            .setName("category")
            .setDescription("Shop category")
            .setRequired(false)
            .addChoices(
              { name: "Tools", value: "tools" },
              { name: "Consumables", value: "consumables" },
              { name: "Collectibles (Limited)", value: "collectibles" }
            )
        )
    )
    .addSubcommand(s =>
      s
        .setName("buy")
        .setDescription("Buy an item from the shop")
        .addStringOption(o =>
          o
            .setName("item")
            .setDescription("Item id or name")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption(o =>
          o
            .setName("quantity")
            .setDescription("Quantity to buy")
            .setMinValue(1)
            .setMaxValue(99)
        )
    )
    .addSubcommand(s =>
      s
        .setName("info")
        .setDescription("View details about a shop item")
        .addStringOption(o =>
          o
            .setName("item")
            .setDescription("Item id or name")
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (!focused || focused.name !== "item") {
      await interaction.respond([]);
      return;
    }
    const hits = searchShopItems(String(focused.value || ""), 25);
    await interaction.respond(
      hits.map(it => ({
        name: `${it.emoji || "🧾"} ${it.name} (${it.id})`,
        value: it.id
      }))
    );
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    await withTimeout(interaction, async () => {
      if (sub === "browse") {
        const category = interaction.options.getString("category") || "";
        const cats = listShopCategories();
        const items = listShopItems(category);

        const lines = items.slice(0, 12).map(formatItemLine);
        const more = items.length > lines.length ? `\n...and ${items.length - lines.length} more.` : "";

        const embed = new EmbedBuilder()
          .setTitle("Shop")
          .setColor(Colors.PRIMARY)
          .setDescription(
            (category ? `Category: **${category}**\n\n` : "") +
            (lines.length ? lines.join("\n") + more : "No items available.") +
            `\n\nBuy: \`/shop buy item:<id> quantity:1\``
          )
          .addFields({ name: "Categories", value: cats.map(c => `\`${c}\``).join(" ") || "none", inline: false })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === "info") {
        const q = interaction.options.getString("item", true);
        const it = findShopItem(q);
        if (!it || Number(it.price) <= 0) {
          await replyError(interaction, "Item Not Found", "That item isn't sold in the shop.", true);
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle(`${it.emoji || "🧾"} ${it.name}`)
          .setColor(Colors.INFO)
          .setDescription(it.description || "No description.")
          .addFields(
            { name: "ID", value: `\`${it.id}\``, inline: true },
            { name: "Category", value: String(it.group || "unknown"), inline: true },
            { name: "Rarity", value: String(it.rarity || "common").toUpperCase(), inline: true },
            { name: "Price", value: `${Math.max(0, Number(it.price) || 0).toLocaleString()} Credits`, inline: true },
            { name: "Sell Price", value: `${Math.max(0, Number(it.sellPrice) || 0).toLocaleString()} Credits`, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === "buy") {
        const q = interaction.options.getString("item", true);
        const qty = interaction.options.getInteger("quantity") || 1;
        const it = findShopItem(q);
        if (!it || Number(it.price) <= 0) {
          await replyError(interaction, "Item Not Found", "That item isn't sold in the shop.", true);
          return;
        }

        // Limit purchases to tools + consumables by default (collectibles are the core gather loop).
        if (String(it.group) === "collectibles") {
          await replyError(interaction, "Not For Sale", "Collectibles are meant to be found via `/gather` and `/work` drops.", true);
          return;
        }

        const unit = Math.max(0, Math.trunc(Number(it.price) || 0));
        const total = unit * qty;
        if (total <= 0) {
          await replyError(interaction, "Invalid Price", "This item cannot be purchased right now.", true);
          return;
        }

        const debit = await removeCredits(interaction.user.id, total, `shop:${it.id}`);
        if (!debit.ok) {
          const w = await getWallet(interaction.user.id);
          await replyError(
            interaction,
            "Insufficient Funds",
            `You need **${total.toLocaleString()} Credits** but have **${w.balance.toLocaleString()} Credits**.\n\nEarn more: \`/work\` or sell loot via \`/use\`.`,
            true
          );
          return;
        }

        await addItem(interaction.user.id, it.id, qty);
        try { await recordQuestEvent(interaction.user.id, "shop_purchases", 1); } catch {}
        void (async () => {
          try {
            const { addStat } = await import('../game/activityStats.js');
            const { addGuildXp } = await import('../game/guildXp.js');
            addStat(interaction.user.id, interaction.guildId, 'credits_spent', total);
            addStat(interaction.user.id, interaction.guildId, 'items_sold', 0); // items_sold tracks selling, not buying
            await addGuildXp(interaction.user.id, interaction.guildId, 'command', { client: interaction.client }).catch(() => {});
          } catch {}
        })();

        const embed = new EmbedBuilder()
          .setTitle("Purchase Complete")
          .setColor(Colors.SUCCESS)
          .setDescription(`Bought **${qty}x** ${it.emoji || "🧾"} **${it.name}** for **${total.toLocaleString()} Credits**.`)
          .addFields({ name: "Next", value: it.group === "tools" ? "Try: `/gather tool:<your tool>`" : "Try: `/use item:<your item>`", inline: false })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      await replyError(interaction, "Unknown Action", "This shop action is not available.", true);
    }, { label: "shop" });
  }
};
