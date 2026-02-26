// src/commands/theme.js
// Per-server theming and feature toggles.
// /theme color <slot> <hex>   — set a color for this server
// /theme reset-colors         — reset all colors to defaults
// /theme name <text>          — custom bot persona name for this server
// /theme footer <text>        — custom embed footer
// /theme feature <module> enable|disable — toggle a feature in this server
// /theme preview              — show current theme
// /theme reset                — reset everything to default

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { getTheme, applyThemeChange } from "../utils/theme.js";
import { Branding } from "../config/branding.js";

export const meta = {
  name: "theme",
  category: "utility",
  deployGlobal: false,
};

const COLOR_SLOTS = ["primary", "success", "error", "warning", "info", "neutral"];
const FEATURE_NAMES = Object.keys(Branding.features);

export const data = new SlashCommandBuilder()
  .setName("theme")
  .setDescription("Customize how the bot looks and behaves in this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  .addSubcommand(s => s
    .setName("color")
    .setDescription("Set a theme color")
    .addStringOption(o => o
      .setName("slot")
      .setDescription("Which color to change")
      .setRequired(true)
      .addChoices(...COLOR_SLOTS.map(slot => ({ name: slot, value: slot }))))
    .addStringOption(o => o
      .setName("hex")
      .setDescription("Hex color code, e.g. #FF5733")
      .setRequired(true)
      .setMaxLength(7)))

  .addSubcommand(s => s
    .setName("name")
    .setDescription("Set a custom persona name for the bot in this server")
    .addStringOption(o => o.setName("text").setDescription("Bot name (max 32 chars)").setRequired(true).setMaxLength(32)))

  .addSubcommand(s => s
    .setName("footer")
    .setDescription("Set a custom embed footer text")
    .addStringOption(o => o.setName("text").setDescription("Footer text (max 100 chars). Use {botname} for the bot name.").setRequired(true).setMaxLength(100)))

  .addSubcommand(s => s
    .setName("feature")
    .setDescription("Enable or disable a feature module for this server")
    .addStringOption(o => o
      .setName("module")
      .setDescription("Feature module")
      .setRequired(true)
      .addChoices(...FEATURE_NAMES.map(f => ({ name: f, value: f }))))
    .addBooleanOption(o => o
      .setName("enabled")
      .setDescription("Enable or disable")
      .setRequired(true)))

  .addSubcommand(s => s
    .setName("preview")
    .setDescription("Preview the current theme for this server"))

  .addSubcommand(s => s
    .setName("reset-colors")
    .setDescription("Reset all colors to the bot's default palette"))

  .addSubcommand(s => s
    .setName("reset")
    .setDescription("Reset the entire theme (all customizations) for this server"));

function parseHex(value) {
  const s = String(value).replace("#", "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(s)) return null;
  return parseInt(s, 16);
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const gd = await loadGuildData(guildId);

  if (sub === "color") {
    const slot = interaction.options.getString("slot", true);
    const hex = interaction.options.getString("hex", true);
    const color = parseHex(hex);
    if (color === null) return interaction.reply({ content: "> Invalid hex color. Format: `#RRGGBB`", flags: MessageFlags.Ephemeral });
    applyThemeChange(gd, `color:${slot}`, hex);
    await saveGuildData(guildId, gd);
    const swatch = new EmbedBuilder().setDescription(`**${slot}** color set to **${hex}**`).setColor(color);
    return interaction.reply({ embeds: [swatch], flags: MessageFlags.Ephemeral });
  }

  if (sub === "name") {
    const text = interaction.options.getString("text", true);
    applyThemeChange(gd, "name", text);
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Bot persona name set to **${text}** for this server.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "footer") {
    const text = interaction.options.getString("text", true);
    applyThemeChange(gd, "footer", text.replace("{botname}", gd.theme?.name ?? Branding.name));
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Embed footer set to: *${text}*`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "feature") {
    const module = interaction.options.getString("module", true);
    const enabled = interaction.options.getBoolean("enabled", true);
    applyThemeChange(gd, `feature:${module}`, enabled);
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Feature **${module}** is now **${enabled ? "enabled" : "disabled"}** in this server.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "preview") {
    const theme = await getTheme(guildId);
    const colorFields = Object.entries(theme.colors).map(([slot, val]) => ({
      name: slot,
      value: `\`#${val.toString(16).padStart(6, "0")}\``,
      inline: true,
    }));
    const featureFields = Object.entries(theme.features).map(([feat, on]) => ({
      name: feat,
      value: on ? "✅" : "❌",
      inline: true,
    }));
    const embed = new EmbedBuilder()
      .setTitle(`Theme Preview — ${theme.name}`)
      .setDescription(`**Footer:** ${theme.footer}`)
      .addFields(
        { name: "── Colors ──", value: "\u200b" },
        ...colorFields,
        { name: "── Features ──", value: "\u200b" },
        ...featureFields,
      )
      .setColor(theme.colors.primary);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === "reset-colors") {
    if (gd.theme) delete gd.theme.colors;
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: "> Color theme reset to bot defaults.", flags: MessageFlags.Ephemeral });
  }

  if (sub === "reset") {
    delete gd.theme;
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: "> All theme customizations cleared. The bot will now use its default appearance in this server.", flags: MessageFlags.Ephemeral });
  }
}
