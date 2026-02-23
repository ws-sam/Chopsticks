import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder
} from "discord.js";
import itemsData from "../economy/items.json" with { type: "json" };
import { Colors, replyError } from "../utils/discordOutput.js";
import { listRecipes, craftRecipe, getRecipe } from "../game/crafting.js";
import { withTimeout } from "../utils/interactionTimeout.js";

const UI_PREFIX = "craftui";

function uiId(kind, userId) {
  return `${UI_PREFIX}:${kind}:${userId}`;
}

function parseUiId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length < 3) return null;
  if (parts[0] !== UI_PREFIX) return null;
  return { kind: parts[1], userId: parts[2] };
}

function itemLabel(itemId) {
  const it = itemsData.tools?.[itemId] || itemsData.consumables?.[itemId] || itemsData.collectibles?.[itemId] || null;
  return it ? `${it.emoji || "📦"} ${it.name}` : itemId;
}

function recipeLine(r) {
  const out = `${itemLabel(r.output.itemId)} ×${r.output.qty}`;
  const ins = r.inputs.map(i => `${itemLabel(i.itemId)} ×${i.qty}`).join(", ");
  return { out, ins };
}

function buildEmbed(selectedRecipeId) {
  const recipes = listRecipes();
  const selected = getRecipe(selectedRecipeId) || recipes[0];
  const { out, ins } = recipeLine(selected);

  const embed = new EmbedBuilder()
    .setTitle("Crafting Bench")
    .setColor(Colors.PRIMARY)
    .setDescription("Pick a recipe from the dropdown, then craft using buttons.\n\nCrafting consumes items from your inventory.")
    .addFields(
      { name: "Selected Recipe", value: `**${selected.name}** (\`${selected.id}\`)`, inline: false },
      { name: "Output", value: out, inline: false },
      { name: "Inputs", value: ins, inline: false },
      { name: "XP", value: `${selected.xp} XP per craft`, inline: true }
    )
    .setTimestamp();

  return embed;
}

function buildComponents(userId, selectedRecipeId) {
  const recipes = listRecipes().slice(0, 25);
  const options = recipes.map(r => ({
    label: r.name,
    value: r.id,
    description: `Craft ${r.output.itemId}`,
    default: r.id === selectedRecipeId
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(uiId("select", userId))
    .setPlaceholder("Choose a recipe")
    .addOptions(options);

  const b1 = new ButtonBuilder().setCustomId(uiId("x1", userId)).setLabel("Craft x1").setStyle(ButtonStyle.Primary);
  const b5 = new ButtonBuilder().setCustomId(uiId("x5", userId)).setLabel("Craft x5").setStyle(ButtonStyle.Secondary);
  const b10 = new ButtonBuilder().setCustomId(uiId("x10", userId)).setLabel("Craft x10").setStyle(ButtonStyle.Secondary);

  // Store selection in the message's embed footer via customId is messy; simplest is to re-read from interaction.message embeds.
  return [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(b1, b5, b10)
  ];
}

function selectedFromMessage(interaction) {
  const emb = interaction.message?.embeds?.[0];
  const field = emb?.fields?.find(f => f.name === "Selected Recipe");
  const m = String(field?.value || "").match(/\(`([^`]+)`\)/);
  return m?.[1] || null;
}

export const meta = {
  category: "economy",
  guildOnly: true,
};

export const data = new SlashCommandBuilder()
  .setName("craft")
  .setDescription("Craft items from recipes (interactive)")
  .addSubcommand(s =>
    s
      .setName("bench")
      .setDescription("Open the crafting bench (dropdown + buttons)")
  )
  .addSubcommand(s =>
    s
      .setName("make")
      .setDescription("Craft by recipe id (non-interactive)")
      .addStringOption(o => o.setName("recipe").setDescription("Recipe id").setRequired(true))
      .addIntegerOption(o => o.setName("times").setDescription("How many times").setMinValue(1).setMaxValue(25))
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ ephemeral: true });

  await withTimeout(interaction, async () => {

    if (sub === "bench") {
      const recipes = listRecipes();
      const first = recipes[0]?.id || "energy_drink";
      const embed = buildEmbed(first);
      const components = buildComponents(interaction.user.id, first);
      await interaction.editReply({ embeds: [embed], components });
      return;
    }

    if (sub === "make") {
      const recipeId = interaction.options.getString("recipe", true);
      const times = interaction.options.getInteger("times") || 1;
      const res = await craftRecipe(interaction.user.id, recipeId, times);
      if (!res.ok) {
        if (res.reason === "insufficient") {
          await replyError(
            interaction,
            "Insufficient Materials",
            `Need **${res.need}x** \`${res.itemId}\`, you have **${res.have}x**.\n\nTip: gather with \`/gather\` or work with \`/work\`.`,
            true
          );
          return;
        }
        await replyError(interaction, "Craft Failed", "Could not craft that recipe.", true);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Craft Complete")
        .setColor(Colors.SUCCESS)
        .setDescription(`Crafted **${res.times}x** **${res.recipe.name}** -> \`${res.recipe.output.itemId}\` ×${res.outQty}`)
        .setTimestamp();
      if (res.xpRes?.applied) {
        embed.addFields({ name: "XP", value: `${res.xpRes.applied} XP${res.xpRes.leveledUp ? ` • ${res.xpRes.fromLevel} -> ${res.xpRes.toLevel}` : ""}`, inline: false });
      }
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    await replyError(interaction, "Unknown Action", "This craft action is not available.", true);
  }, { label: "craft" });
}

export default { data, execute };

export async function handleSelect(interaction) {
  if (!interaction.isStringSelectMenu?.()) return false;
  const parsed = parseUiId(interaction.customId);
  if (!parsed) return false;

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({ content: "This craft bench belongs to another user.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const recipeId = interaction.values?.[0] || "energy_drink";
  const embed = buildEmbed(recipeId);
  const components = buildComponents(interaction.user.id, recipeId);
  await interaction.update({ embeds: [embed], components });
  return true;
}

export async function handleButton(interaction) {
  if (!interaction.isButton?.()) return false;
  const parsed = parseUiId(interaction.customId);
  if (!parsed) return false;

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({ content: "This craft bench belongs to another user.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const sel = selectedFromMessage(interaction) || "energy_drink";
  const times = parsed.kind === "x10" ? 10 : (parsed.kind === "x5" ? 5 : (parsed.kind === "x1" ? 1 : 0));
  if (!times) return false;

  await interaction.deferUpdate();
  const res = await craftRecipe(interaction.user.id, sel, times);
  const embed = buildEmbed(sel);
  const components = buildComponents(interaction.user.id, sel);
  await interaction.editReply({ embeds: [embed], components });

  if (!res.ok) {
    const msg = res.reason === "insufficient"
      ? `Need ${res.need}x \`${res.itemId}\` but you have ${res.have}x.`
      : "Craft failed.";
    await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
    return true;
  }

  const msg = `Crafted **${res.times}x ${res.recipe.name}** -> \`${res.recipe.output.itemId}\` ×${res.outQty}` +
    (res.xpRes?.applied ? ` • +${res.xpRes.applied} XP` : "");
  await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
  return true;
}

