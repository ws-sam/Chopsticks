import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
  ChannelType
} from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { Colors } from "../utils/discordOutput.js";
import { normalizeStarboardConfig, starboardEmojiKey } from "../utils/starboard.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
  category: "tools"
};

function embed(title, description, color = Colors.INFO) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(String(description || ""))
    .setColor(color)
    .setTimestamp();
}

export const data = new SlashCommandBuilder()
  .setName("starboard")
  .setDescription("Configure highlighted message feed from reactions")
  .addSubcommand(sub =>
    sub
      .setName("setup")
      .setDescription("Enable and configure starboard")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Channel where highlighted posts will be sent")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
      .addIntegerOption(o =>
        o
          .setName("threshold")
          .setDescription("Minimum matching reactions required")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(20)
      )
      .addStringOption(o =>
        o
          .setName("emoji")
          .setDescription("Reaction emoji to track (default ⭐)")
          .setRequired(false)
      )
      .addBooleanOption(o =>
        o
          .setName("allow_self_star")
          .setDescription("Allow users to star their own messages")
          .setRequired(false)
      )
      .addBooleanOption(o =>
        o
          .setName("include_bot_messages")
          .setDescription("Include bot-authored messages")
          .setRequired(false)
      )
  )
  .addSubcommand(sub => sub.setName("status").setDescription("Show current starboard settings"))
  .addSubcommand(sub => sub.setName("disable").setDescription("Disable starboard"))
  .addSubcommand(sub => sub.setName("clear_posts").setDescription("Clear tracked post mapping cache"))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await withTimeout(interaction, async () => {

    const guildId = interaction.guildId;
    const data = normalizeStarboardConfig(await loadGuildData(guildId));
    const cfg = data.starboard;

    if (sub === "setup") {
      const channel = interaction.options.getChannel("channel", true);
      const threshold = interaction.options.getInteger("threshold", false);
      const emoji = interaction.options.getString("emoji", false);
      const selfStar = interaction.options.getBoolean("allow_self_star", false);
      const includeBotMessages = interaction.options.getBoolean("include_bot_messages", false);

      cfg.enabled = true;
      cfg.channelId = channel.id;
      if (Number.isFinite(Number(threshold))) cfg.threshold = Math.min(20, Math.max(1, Math.trunc(Number(threshold))));
      if (emoji) cfg.emoji = emoji.trim();
      if (selfStar !== null) cfg.selfStar = Boolean(selfStar);
      if (includeBotMessages !== null) cfg.ignoreBots = !Boolean(includeBotMessages);

      await saveGuildData(guildId, data);
      await interaction.editReply({
        embeds: [
          embed(
            "Starboard Enabled",
            `Channel: <#${cfg.channelId}>\n` +
            `Threshold: **${cfg.threshold}**\n` +
            `Emoji: **${cfg.emoji}** (\`${starboardEmojiKey(cfg.emoji)}\`)\n` +
            `Self-star: **${cfg.selfStar ? "allowed" : "blocked"}**\n` +
            `Bot messages: **${cfg.ignoreBots ? "ignored" : "included"}**`,
            Colors.SUCCESS
          )
        ]
      });
      return;
    }

    if (sub === "disable") {
      cfg.enabled = false;
      await saveGuildData(guildId, data);
      await interaction.editReply({
        embeds: [embed("Starboard Disabled", "Starboard is now disabled for this server.", Colors.WARNING)]
      });
      return;
    }

    if (sub === "clear_posts") {
      const count = Object.keys(cfg.posts || {}).length;
      cfg.posts = {};
      await saveGuildData(guildId, data);
      await interaction.editReply({
        embeds: [embed("Starboard Cache Cleared", `Cleared **${count}** tracked source post mapping(s).`, Colors.SUCCESS)]
      });
      return;
    }

    const channelLine = cfg.channelId ? `<#${cfg.channelId}>` : "Not configured";
    const mapped = Object.keys(cfg.posts || {}).length;
    await interaction.editReply({
      embeds: [
        embed(
          "Starboard Status",
          `Enabled: **${cfg.enabled ? "yes" : "no"}**\n` +
          `Channel: ${channelLine}\n` +
          `Threshold: **${cfg.threshold}**\n` +
          `Emoji: **${cfg.emoji}** (\`${starboardEmojiKey(cfg.emoji)}\`)\n` +
          `Self-star: **${cfg.selfStar ? "allowed" : "blocked"}**\n` +
          `Bot messages: **${cfg.ignoreBots ? "ignored" : "included"}**\n` +
          `Tracked posts: **${mapped}**`,
          Colors.INFO
        )
      ]
    });
  }, { label: "starboard" });
}

export default { data, execute, meta };
