// src/commands/emojitools.js
// /emoji add <url> <name> — add an emoji from a URL or attachment
// /emoji steal <message_id> — steal an emoji from a message reaction
// /emoji delete <name> — delete a guild emoji
// /emoji rename <name> <new_name> — rename a guild emoji
// /emoji list — list all guild emojis (paginated 20 per page)

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";

export const meta = {
  deployGlobal: false,
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageEmojisAndStickers],
  name: "emoji",
  category: "tools",
};

export const data = new SlashCommandBuilder()
  .setName("emoji")
  .setDescription("Manage server emojis")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageEmojisAndStickers)

  .addSubcommand(s => s
    .setName("add")
    .setDescription("Add a new emoji from a URL or attachment")
    .addStringOption(o => o.setName("name").setDescription("Emoji name (no spaces)").setRequired(true).setMaxLength(32))
    .addStringOption(o => o.setName("url").setDescription("Image URL (PNG, JPEG, GIF)").setMaxLength(400))
    .addAttachmentOption(o => o.setName("image").setDescription("Upload an image directly")))

  .addSubcommand(s => s
    .setName("steal")
    .setDescription("Steal a custom emoji from a message (by message ID or jump URL)")
    .addStringOption(o => o.setName("emoji").setDescription("The emoji to steal (paste it here)").setRequired(true))
    .addStringOption(o => o.setName("name").setDescription("New name (defaults to original name)").setMaxLength(32)))

  .addSubcommand(s => s
    .setName("delete")
    .setDescription("Delete a server emoji")
    .addStringOption(o => o.setName("name").setDescription("Emoji name").setRequired(true)))

  .addSubcommand(s => s
    .setName("rename")
    .setDescription("Rename a server emoji")
    .addStringOption(o => o.setName("name").setDescription("Current emoji name").setRequired(true))
    .addStringOption(o => o.setName("new_name").setDescription("New name").setRequired(true).setMaxLength(32)))

  .addSubcommand(s => s
    .setName("list")
    .setDescription("List all server emojis")
    .addIntegerOption(o => o.setName("page").setDescription("Page number").setMinValue(1)));

const CUSTOM_EMOJI_RE = /<a?:(\w+):(\d+)>/;

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;

  if (sub === "add") {
    const name = interaction.options.getString("name", true).replace(/[^a-zA-Z0-9_]/g, "_");
    const url = interaction.options.getString("url");
    const attachment = interaction.options.getAttachment("image");
    const source = url ?? attachment?.url;
    if (!source) return interaction.reply({ content: "> Provide a URL or upload an image.", flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const emoji = await guild.emojis.create({ attachment: source, name }).catch(e => e);
    if (emoji instanceof Error) {
      return interaction.editReply({ content: `> Failed to add emoji: ${emoji.message}` });
    }
    return interaction.editReply({ content: `> Added emoji ${emoji.toString()} **:${emoji.name}:**` });
  }

  if (sub === "steal") {
    const input = interaction.options.getString("emoji", true);
    const match = CUSTOM_EMOJI_RE.exec(input);
    if (!match) return interaction.reply({ content: "> Could not find a custom emoji. Paste the emoji directly (e.g. `:name:` from another server).", flags: MessageFlags.Ephemeral });

    const [, emojiName, emojiId] = match;
    const animated = input.startsWith("<a:");
    const ext = animated ? "gif" : "png";
    const url = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}`;
    const finalName = (interaction.options.getString("name") ?? emojiName).replace(/[^a-zA-Z0-9_]/g, "_");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const emoji = await guild.emojis.create({ attachment: url, name: finalName }).catch(e => e);
    if (emoji instanceof Error) return interaction.editReply({ content: `> Failed to steal emoji: ${emoji.message}` });
    return interaction.editReply({ content: `> Stolen! ${emoji.toString()} **:${emoji.name}:**` });
  }

  if (sub === "delete") {
    const name = interaction.options.getString("name", true);
    const emoji = guild.emojis.cache.find(e => e.name === name);
    if (!emoji) return interaction.reply({ content: "> Emoji not found.", flags: MessageFlags.Ephemeral });
    await emoji.delete("Deleted via /emoji delete").catch(() => null);
    return interaction.reply({ content: `> Deleted emoji **:${name}:**`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "rename") {
    const name = interaction.options.getString("name", true);
    const newName = interaction.options.getString("new_name", true).replace(/[^a-zA-Z0-9_]/g, "_");
    const emoji = guild.emojis.cache.find(e => e.name === name);
    if (!emoji) return interaction.reply({ content: "> Emoji not found.", flags: MessageFlags.Ephemeral });
    await emoji.setName(newName, "Renamed via /emoji rename");
    return interaction.reply({ content: `> Renamed **:${name}:** to **:${newName}:**`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "list") {
    const page = (interaction.options.getInteger("page") ?? 1) - 1;
    const emojis = [...guild.emojis.cache.values()];
    if (!emojis.length) return interaction.reply({ content: "> This server has no custom emojis.", flags: MessageFlags.Ephemeral });
    const perPage = 20;
    const totalPages = Math.ceil(emojis.length / perPage);
    const slice = emojis.slice(page * perPage, (page + 1) * perPage);
    const embed = new EmbedBuilder()
      .setTitle(`Server Emojis (${emojis.length})`)
      .setDescription(slice.map(e => `${e.toString()} \`:${e.name}:\``).join("  "))
      .setColor(0x5865F2)
      .setFooter({ text: `Page ${page + 1}/${totalPages}` });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}
