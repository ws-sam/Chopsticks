import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from "discord.js";
import { replyError } from "../utils/discordOutput.js";

export const meta = {
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageMessages],
  category: "tools"
};

export const data = new SlashCommandBuilder()
  .setName("embed")
  .setDescription("Create and send a custom embed to a channel")
  .addSubcommand(sub =>
    sub
      .setName("create")
      .setDescription("Send a custom embed to a channel")
      .addChannelOption(o =>
        o.setName("channel").setDescription("Target channel").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("title").setDescription("Embed title").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("description").setDescription("Embed description").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("color").setDescription("Hex color (#RRGGBB). Default: #5865F2").setRequired(false)
      )
      .addStringOption(o =>
        o.setName("image_url").setDescription("Image URL to attach to embed").setRequired(false)
      )
      .addStringOption(o =>
        o.setName("footer").setDescription("Footer text").setRequired(false)
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

const DEFAULT_COLOR = 0x5865F2;
const HEX_RE = /^#?([0-9A-Fa-f]{6})$/;

export function parseColor(input) {
  if (!input) return DEFAULT_COLOR;
  const m = HEX_RE.exec(input.trim());
  if (!m) return null;
  return parseInt(m[1], 16);
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub !== "create") return;

  const channel = interaction.options.getChannel("channel", true);
  const title = interaction.options.getString("title", true);
  const description = interaction.options.getString("description", true);
  const colorInput = interaction.options.getString("color");
  const imageUrl = interaction.options.getString("image_url");
  const footerText = interaction.options.getString("footer");

  const color = parseColor(colorInput);
  if (color === null) {
    await replyError(interaction, "❌ Invalid color. Please use a hex color like `#5865F2`.");
    return;
  }

  // Verify bot can send in target channel
  const botMember = interaction.guild?.members?.me;
  if (botMember && channel.permissionsFor) {
    const perms = channel.permissionsFor(botMember);
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
      await replyError(interaction, `❌ I don't have permission to send embeds in ${channel}.`);
      return;
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color);

  if (imageUrl) embed.setImage(imageUrl);
  if (footerText) embed.setFooter({ text: footerText });

  try {
    await channel.send({ embeds: [embed] });
    await interaction.reply({
      content: `✅ Embed sent to ${channel}.`,
      flags: 64
    });
  } catch {
    await replyError(interaction, `❌ I don't have permission to send embeds in that channel.`);
  }
}
