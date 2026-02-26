import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { Colors } from "../utils/discordOutput.js";
import { sanitizeString } from "../utils/validation.js";

export const meta = {
  deployGlobal: true,
  category: "admin",
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild]
};

export const data = new SlashCommandBuilder()
  .setName("welcome")
  .setDescription("Welcome and goodbye message settings")
  .addSubcommand(s =>
    s.setName("set").setDescription("Set welcome channel")
      .addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true)))
  .addSubcommand(s =>
    s.setName("message").setDescription("Set welcome message")
      .addStringOption(o => o.setName("text").setDescription("Message with {user}, {server}, {membercount}").setRequired(true)))
  .addSubcommand(s => s.setName("preview").setDescription("Preview current welcome configuration"))
  .addSubcommand(s => s.setName("disable").setDescription("Disable welcome messages"))
  // DM on join
  .addSubcommand(s =>
    s.setName("dm-set").setDescription("Set a DM message sent to new members")
      .addStringOption(o => o.setName("text").setDescription("DM text (supports {user}, {server})").setRequired(true).setMaxLength(1900)))
  .addSubcommand(s => s.setName("dm-enable").setDescription("Enable DM on join"))
  .addSubcommand(s => s.setName("dm-disable").setDescription("Disable DM on join"))
  // Goodbye
  .addSubcommand(s =>
    s.setName("goodbye-set").setDescription("Set goodbye channel and message")
      .addChannelOption(o => o.setName("channel").setDescription("Goodbye channel").setRequired(true))
      .addStringOption(o => o.setName("text").setDescription("Goodbye message (supports {user}, {server})").setMaxLength(1900)))
  .addSubcommand(s => s.setName("goodbye-enable").setDescription("Enable goodbye messages"))
  .addSubcommand(s => s.setName("goodbye-disable").setDescription("Disable goodbye messages"))
  // Member count VC
  .addSubcommand(s =>
    s.setName("membercount").setDescription("Set a voice channel to display live member count")
      .addChannelOption(o => o.setName("channel").setDescription("Voice channel").setRequired(true)))
  .addSubcommand(s => s.setName("membercount-disable").setDescription("Disable member count voice channel"))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function reply(title, description, color = Colors.INFO) {
  return { embeds: [{ title, description, color, timestamp: new Date().toISOString() }], flags: MessageFlags.Ephemeral };
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const gd = await loadGuildData(interaction.guildId);
  gd.welcome ??= { enabled: false, channelId: null, message: "Welcome {user}!" };
  gd.goodbye ??= { enabled: false, channelId: null, message: "Goodbye {user}." };
  gd.joinDm ??= { enabled: false, message: null };

  if (sub === "set") {
    const channel = interaction.options.getChannel("channel", true);
    gd.welcome.channelId = channel.id;
    gd.welcome.enabled = true;
    await saveGuildData(interaction.guildId, gd);
    return interaction.reply(reply("Welcome Channel Updated", `Welcome messages will post in <#${channel.id}>.`, Colors.SUCCESS));
  }

  if (sub === "message") {
    gd.welcome.message = sanitizeString(interaction.options.getString("text", true));
    gd.welcome.enabled = true;
    await saveGuildData(interaction.guildId, gd);
    return interaction.reply(reply("Welcome Message Updated", `Template saved.\n\nPreview:\n${gd.welcome.message.slice(0, 900)}`, Colors.SUCCESS));
  }

  if (sub === "preview") {
    const channelLine = gd.welcome.channelId ? `<#${gd.welcome.channelId}>` : "Not set";
    return interaction.reply(reply(
      "Welcome Configuration",
      `Status: **${gd.welcome.enabled ? "Enabled" : "Disabled"}**\nChannel: ${channelLine}\nTemplate:\n${String(gd.welcome.message || "Welcome {user}!").slice(0, 900)}\n\nPlaceholders: \`{user}\`, \`{server}\`, \`{membercount}\``,
      Colors.INFO
    ));
  }

  if (sub === "disable") {
    gd.welcome.enabled = false;
    await saveGuildData(interaction.guildId, gd);
    return interaction.reply(reply("Welcome Disabled", "Welcome messages are now disabled.", Colors.WARNING));
  }

  if (sub === "dm-set") {
    gd.joinDm.message = sanitizeString(interaction.options.getString("text", true));
    gd.joinDm.enabled = true;
    await saveGuildData(interaction.guildId, gd);
    return interaction.reply(reply("DM on Join Updated", "New members will receive this DM when they join.", Colors.SUCCESS));
  }

  if (sub === "dm-enable") {
    if (!gd.joinDm.message) return interaction.reply(reply("No DM Set", "Use `/welcome dm-set` first.", Colors.WARNING));
    gd.joinDm.enabled = true;
    await saveGuildData(interaction.guildId, gd);
    return interaction.reply(reply("DM on Join Enabled", "New members will receive a DM on join.", Colors.SUCCESS));
  }

  if (sub === "dm-disable") {
    gd.joinDm.enabled = false;
    await saveGuildData(interaction.guildId, gd);
    return interaction.reply(reply("DM on Join Disabled", "Join DMs are now off.", Colors.WARNING));
  }

  if (sub === "goodbye-set") {
    const channel = interaction.options.getChannel("channel", true);
    const text = interaction.options.getString("text");
    gd.goodbye.channelId = channel.id;
    if (text) gd.goodbye.message = sanitizeString(text);
    gd.goodbye.enabled = true;
    await saveGuildData(interaction.guildId, gd);
    return interaction.reply(reply("Goodbye Configured", `Goodbye messages will post in <#${channel.id}>.`, Colors.SUCCESS));
  }

  if (sub === "goodbye-enable") {
    if (!gd.goodbye.channelId) return interaction.reply(reply("No Channel Set", "Use `/welcome goodbye-set` first.", Colors.WARNING));
    gd.goodbye.enabled = true;
    await saveGuildData(interaction.guildId, gd);
    return interaction.reply(reply("Goodbye Enabled", "Goodbye messages are now on.", Colors.SUCCESS));
  }

  if (sub === "goodbye-disable") {
    gd.goodbye.enabled = false;
    await saveGuildData(interaction.guildId, gd);
    return interaction.reply(reply("Goodbye Disabled", "Goodbye messages are now off.", Colors.WARNING));
  }

  if (sub === "membercount") {
    const channel = interaction.options.getChannel("channel", true);
    gd.memberCountChannelId = channel.id;
    await saveGuildData(interaction.guildId, gd);
    // Update immediately
    const vc = interaction.guild.channels.cache.get(channel.id);
    if (vc) await vc.setName(`Members: ${interaction.guild.memberCount}`).catch(() => null);
    return interaction.reply(reply("Member Count Channel Set", `<#${channel.id}> will show live member count.`, Colors.SUCCESS));
  }

  if (sub === "membercount-disable") {
    delete gd.memberCountChannelId;
    await saveGuildData(interaction.guildId, gd);
    return interaction.reply(reply("Member Count Disabled", "Member count channel updates are off.", Colors.WARNING));
  }
}

