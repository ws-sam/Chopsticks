// src/commands/verify.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import {
  getVerifyConfig,
  ensureQuarantineRole,
  applyQuarantinePermissions,
  VERIFY_MODES,
  defaultVerifyConfig,
} from "../tools/verify/setup.js";
import { buildVerifyPanel } from "../tools/verify/handler.js";

export const meta = {
  name: "verify",
  category: "safety",
  deployGlobal: true,
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
};

export const data = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("Set up and manage the member verification system")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  .addSubcommand(s => s
    .setName("setup")
    .setDescription("Configure verification mode and roles")
    .addStringOption(o => o
      .setName("mode")
      .setDescription("Verification mode")
      .setRequired(true)
      .addChoices(
        { name: "Button (click to verify)", value: "button" },
        { name: "Captcha (DM code)", value: "captcha" }
      ))
    .addRoleOption(o => o.setName("member_role").setDescription("Role to grant on verification"))
    .addChannelOption(o => o.setName("panel_channel").setDescription("Channel to post the verify panel in"))
    .addChannelOption(o => o.setName("log_channel").setDescription("Channel for verification logs"))
    .addIntegerOption(o => o.setName("timeout_hours").setDescription("Hours before unverified members are kicked (0 = disabled)").setMinValue(0).setMaxValue(168))
  )

  .addSubcommand(s => s
    .setName("enable")
    .setDescription("Enable the verification system"))

  .addSubcommand(s => s
    .setName("disable")
    .setDescription("Disable the verification system"))

  .addSubcommand(s => s
    .setName("panel")
    .setDescription("Post the verification panel in the configured channel"))

  .addSubcommand(s => s
    .setName("quarantine-role")
    .setDescription("Set or auto-create the quarantine role")
    .addRoleOption(o => o.setName("role").setDescription("Existing role to use as quarantine (leave blank to auto-create)")))

  .addSubcommand(s => s
    .setName("message")
    .setDescription("Set the verification message shown in the panel")
    .addStringOption(o => o.setName("text").setDescription("Verification message").setRequired(true).setMaxLength(500)))

  .addSubcommand(s => s
    .setName("dm-message")
    .setDescription("Set the DM message sent to new members (or clear it)")
    .addStringOption(o => o.setName("text").setDescription("DM message text (leave blank to disable)").setMaxLength(500)))

  .addSubcommand(s => s
    .setName("status")
    .setDescription("Show current verification configuration"));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === "setup") {
    const mode = interaction.options.getString("mode", true);
    const memberRole = interaction.options.getRole("member_role");
    const panelCh = interaction.options.getChannel("panel_channel");
    const logCh = interaction.options.getChannel("log_channel");
    const timeoutHrs = interaction.options.getInteger("timeout_hours");

    const gd = await loadGuildData(guildId);
    gd.verify ??= defaultVerifyConfig();
    gd.verify.mode = mode;
    if (memberRole) gd.verify.memberRoleId = memberRole.id;
    if (panelCh) gd.verify.panelChannelId = panelCh.id;
    if (logCh) gd.verify.logChannelId = logCh.id;
    if (timeoutHrs !== null) gd.verify.timeoutHours = timeoutHrs;
    await saveGuildData(guildId, gd);

    return interaction.reply({
      content: `> Verification configured — mode: **${mode}**${memberRole ? `, member role: <@&${memberRole.id}>` : ""}${panelCh ? `, panel: <#${panelCh.id}>` : ""}\n> Use \`/verify enable\` to turn it on, then \`/verify panel\` to post the panel.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === "enable" || sub === "disable") {
    const { gd, verify } = await getVerifyConfig(guildId);
    verify.enabled = sub === "enable";
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Verification **${sub}d**.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "panel") {
    const { verify } = await getVerifyConfig(guildId);
    if (!verify.panelChannelId) {
      return interaction.reply({ content: "> No panel channel configured. Use `/verify setup` first.", flags: MessageFlags.Ephemeral });
    }
    const channel = interaction.guild.channels.cache.get(verify.panelChannelId)
      ?? await interaction.guild.channels.fetch(verify.panelChannelId).catch(() => null);
    if (!channel?.isTextBased()) {
      return interaction.reply({ content: "> Panel channel not found or not a text channel.", flags: MessageFlags.Ephemeral });
    }
    const panel = buildVerifyPanel(verify);
    await channel.send(panel);
    return interaction.reply({ content: `> Verification panel posted in <#${verify.panelChannelId}>.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "quarantine-role") {
    const existingRole = interaction.options.getRole("role");
    const { gd, verify } = await getVerifyConfig(guildId);

    if (existingRole) {
      verify.quarantineRoleId = existingRole.id;
      await saveGuildData(guildId, gd);
      return interaction.reply({ content: `> Quarantine role set to <@&${existingRole.id}>.`, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ ephemeral: true });
    const role = await ensureQuarantineRole(interaction.guild);
    return interaction.editReply({ content: `> Quarantine role created/confirmed: <@&${role.id}>.\n> Run \`/verify setup panel_channel:#channel\` and \`/verify panel\` to complete setup.` });
  }

  if (sub === "message") {
    const text = interaction.options.getString("text", true);
    const { gd, verify } = await getVerifyConfig(guildId);
    verify.message = text;
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: "> Verification message updated.", flags: MessageFlags.Ephemeral });
  }

  if (sub === "dm-message") {
    const text = interaction.options.getString("text");
    const { gd, verify } = await getVerifyConfig(guildId);
    verify.dmMessage = text || null;
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: text ? "> DM message set." : "> DM message disabled.", flags: MessageFlags.Ephemeral });
  }

  if (sub === "status") {
    const { verify } = await getVerifyConfig(guildId);
    const embed = new EmbedBuilder()
      .setTitle("Verification Status")
      .setColor(verify.enabled ? 0x57F287 : 0xED4245)
      .addFields(
        { name: "Status", value: verify.enabled ? "Enabled" : "Disabled", inline: true },
        { name: "Mode", value: verify.mode ?? "button", inline: true },
        { name: "Quarantine Role", value: verify.quarantineRoleId ? `<@&${verify.quarantineRoleId}>` : "Not set", inline: true },
        { name: "Member Role", value: verify.memberRoleId ? `<@&${verify.memberRoleId}>` : "Not set", inline: true },
        { name: "Panel Channel", value: verify.panelChannelId ? `<#${verify.panelChannelId}>` : "Not set", inline: true },
        { name: "Auto-kick", value: verify.timeoutHours ? `After ${verify.timeoutHours}h` : "Disabled", inline: true },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}
