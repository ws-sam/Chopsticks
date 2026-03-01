// src/commands/antinuke.js
import {
  ChannelType,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { getAntinukeConfig, saveAntinukeConfig } from "../tools/antinuke/engine.js";

export const meta = {
  deployGlobal: false,
  name: "antinuke",
  category: "safety",
};

export const data = new SlashCommandBuilder()
  .setName("antinuke")
  .setDescription("Anti-nuke / anti-raid protection system")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  .addSubcommand(s => s
    .setName("enable").setDescription("Enable anti-nuke protection"))
  .addSubcommand(s => s
    .setName("disable").setDescription("Disable anti-nuke protection"))
  .addSubcommand(s => s
    .setName("status").setDescription("View current anti-nuke configuration"))

  .addSubcommand(s => s
    .setName("punishment")
    .setDescription("Set punishment for nuke attempts")
    .addStringOption(o => o
      .setName("action")
      .setDescription("What to do to the attacker")
      .setRequired(true)
      .addChoices(
        { name: "Strip dangerous roles/permissions (default)", value: "stripperms" },
        { name: "Kick the attacker", value: "kick" },
        { name: "Ban the attacker", value: "ban" },
      )))

  .addSubcommand(s => s
    .setName("threshold")
    .setDescription("Set how many of an action triggers anti-nuke")
    .addStringOption(o => o
      .setName("action")
      .setDescription("Action type")
      .setRequired(true)
      .addChoices(
        { name: "Bans", value: "ban" },
        { name: "Kicks", value: "kick" },
        { name: "Channel deletes", value: "channelDelete" },
        { name: "Role deletes", value: "roleDelete" },
        { name: "Webhook creates", value: "webhookCreate" },
        { name: "Emoji deletes", value: "emojiDelete" },
      ))
    .addIntegerOption(o => o
      .setName("count")
      .setDescription("Number of actions within the window to trigger (1-50)")
      .setRequired(true).setMinValue(1).setMaxValue(50)))

  .addSubcommand(s => s
    .setName("window")
    .setDescription("Set the sliding time window in seconds (default: 10)")
    .addIntegerOption(o => o
      .setName("seconds")
      .setDescription("Window in seconds (5-60)")
      .setRequired(true).setMinValue(5).setMaxValue(60)))

  .addSubcommand(s => s
    .setName("whitelist-add")
    .setDescription("Whitelist a user (exempt from anti-nuke)")
    .addUserOption(o => o.setName("user").setDescription("User to whitelist").setRequired(true)))

  .addSubcommand(s => s
    .setName("whitelist-remove")
    .setDescription("Remove a user from whitelist")
    .addUserOption(o => o.setName("user").setDescription("User to remove").setRequired(true)))

  .addSubcommand(s => s
    .setName("log-channel")
    .setDescription("Set channel for anti-nuke alerts")
    .addChannelOption(o => o
      .setName("channel")
      .setDescription("Alert channel")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true)));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  // Only guild owner or admins
  if (interaction.guild.ownerId !== interaction.user.id &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "> Only the server owner or admins can configure anti-nuke.", flags: MessageFlags.Ephemeral });
  }

  const config = await getAntinukeConfig(guildId);

  if (sub === "enable") {
    config.enabled = true;
    await saveAntinukeConfig(guildId, config);
    return interaction.reply({ content: "> Anti-nuke protection **enabled**. The bot will now monitor for mass destructive actions.", flags: MessageFlags.Ephemeral });
  }

  if (sub === "disable") {
    config.enabled = false;
    await saveAntinukeConfig(guildId, config);
    return interaction.reply({ content: "> Anti-nuke protection **disabled**.", flags: MessageFlags.Ephemeral });
  }

  if (sub === "status") {
    const embed = new EmbedBuilder()
      .setTitle("Anti-Nuke Configuration")
      .setColor(config.enabled ? 0x57F287 : 0xED4245)
      .addFields(
        { name: "Status", value: config.enabled ? "✅ Enabled" : "❌ Disabled", inline: true },
        { name: "Punishment", value: config.punishment ?? "stripperms", inline: true },
        { name: "Window", value: `${(config.windowMs ?? 10000) / 1000}s`, inline: true },
        { name: "Thresholds", value: Object.entries(config.thresholds ?? {}).map(([k, v]) => `${k}: **${v}**`).join("\n") || "default" },
        { name: "Whitelisted Users", value: config.whitelistUserIds?.length ? config.whitelistUserIds.map(id => `<@${id}>`).join(", ") : "None" },
        { name: "Log Channel", value: config.logChannelId ? `<#${config.logChannelId}>` : "None", inline: true },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === "punishment") {
    config.punishment = interaction.options.getString("action", true);
    await saveAntinukeConfig(guildId, config);
    return interaction.reply({ content: `> Punishment set to **${config.punishment}**.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "threshold") {
    const action = interaction.options.getString("action", true);
    const count = interaction.options.getInteger("count", true);
    config.thresholds ??= {};
    config.thresholds[action] = count;
    await saveAntinukeConfig(guildId, config);
    return interaction.reply({ content: `> Threshold for **${action}** set to **${count}** within the window.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "window") {
    config.windowMs = interaction.options.getInteger("seconds", true) * 1000;
    await saveAntinukeConfig(guildId, config);
    return interaction.reply({ content: `> Detection window set to **${config.windowMs / 1000}s**.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "whitelist-add") {
    const user = interaction.options.getUser("user", true);
    config.whitelistUserIds ??= [];
    if (!config.whitelistUserIds.includes(user.id)) config.whitelistUserIds.push(user.id);
    await saveAntinukeConfig(guildId, config);
    return interaction.reply({ content: `> <@${user.id}> added to anti-nuke whitelist.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "whitelist-remove") {
    const user = interaction.options.getUser("user", true);
    config.whitelistUserIds = (config.whitelistUserIds ?? []).filter(id => id !== user.id);
    await saveAntinukeConfig(guildId, config);
    return interaction.reply({ content: `> <@${user.id}> removed from whitelist.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "log-channel") {
    const ch = interaction.options.getChannel("channel", true);
    config.logChannelId = ch.id;
    await saveAntinukeConfig(guildId, config);
    return interaction.reply({ content: `> Anti-nuke alerts will be posted in <#${ch.id}>.`, flags: MessageFlags.Ephemeral });
  }
}
