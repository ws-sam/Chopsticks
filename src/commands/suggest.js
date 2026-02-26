import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { loadGuildData } from "../utils/storage.js";
import { Colors } from "../utils/discordOutput.js";
import { cacheIncr } from "../utils/cache.js";
import { sanitizeString } from "../utils/validation.js";

export const meta = {
  deployGlobal: false,
  guildOnly: true,
  userPerms: [],
  category: "community"
};

export const data = new SlashCommandBuilder()
  .setName("suggest")
  .setDescription("Submit a suggestion to the server's suggestions channel")
  .addStringOption(o =>
    o.setName("text").setDescription("Your suggestion (up to 1000 chars)").setRequired(true).setMaxLength(1000)
  );

export async function execute(interaction) {
  const text = sanitizeString(interaction.options.getString("text", true));
  const guildData = await loadGuildData(interaction.guildId);

  if (!guildData.suggestionChannelId) {
    await interaction.reply({
      content: "❌ No suggestions channel configured. An admin can set one with `/config suggestions-channel #channel`.",
      flags: 64
    });
    return;
  }

  // Redis rate limit: 1 suggestion per 10 minutes per user
  const rlKey = `suggest:${interaction.guildId}:${interaction.user.id}`;
  const count = await cacheIncr(rlKey, 600);
  if (count !== null && count > 1) {
    await interaction.reply({
      content: "❌ You can only submit one suggestion every 10 minutes. Please wait before trying again.",
      flags: 64
    });
    return;
  }

  const channel = await interaction.guild.channels.fetch(guildData.suggestionChannelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
    await interaction.reply({
      content: "❌ The configured suggestions channel is no longer accessible.",
      flags: 64
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("💡 New Suggestion")
    .setDescription(text)
    .setColor(Colors.Info)
    .setFooter({ text: `Submitted by ${interaction.user.tag}` })
    .setTimestamp();

  const msg = await channel.send({ embeds: [embed] });
  await msg.react("👍").catch(() => {});
  await msg.react("👎").catch(() => {});

  await interaction.reply({ content: "✅ Your suggestion has been submitted!", flags: 64 });
}
