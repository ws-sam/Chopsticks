// src/commands/customcmd.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { setCustomCmd, deleteCustomCmd, getCustomCmd, listCustomCmds } from "../tools/customcmd/store.js";
import { sanitizeString } from "../utils/validation.js";

export const meta = {
  deployGlobal: false,
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
  name: "customcmd",
  category: "tools",
};

export const data = new SlashCommandBuilder()
  .setName("customcmd")
  .setDescription("Create and manage custom text commands triggered by prefix")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  .addSubcommand(s => s
    .setName("create")
    .setDescription("Create a custom command")
    .addStringOption(o => o.setName("name").setDescription("Command name (no spaces)").setRequired(true).setMaxLength(30))
    .addStringOption(o => o.setName("response").setDescription("Response text. Use {user}, {server}, {args}, {random:a|b}").setRequired(true).setMaxLength(1900))
    .addBooleanOption(o => o.setName("as_embed").setDescription("Post response as an embed (default false)"))
    .addStringOption(o => o.setName("embed_title").setDescription("Embed title if using embed mode").setMaxLength(100))
    .addRoleOption(o => o.setName("required_role").setDescription("Only allow users with this role"))
    .addChannelOption(o => o.setName("channel_only").setDescription("Only respond in this channel"))
    .addBooleanOption(o => o.setName("delete_input").setDescription("Delete the triggering message (default false)"))
    .addBooleanOption(o => o.setName("dm_user").setDescription("DM the response to the user (default false)")))

  .addSubcommand(s => s
    .setName("edit")
    .setDescription("Edit a custom command's response")
    .addStringOption(o => o.setName("name").setDescription("Command name").setRequired(true).setMaxLength(30))
    .addStringOption(o => o.setName("response").setDescription("New response text").setRequired(true).setMaxLength(1900)))

  .addSubcommand(s => s
    .setName("delete")
    .setDescription("Delete a custom command")
    .addStringOption(o => o.setName("name").setDescription("Command name").setRequired(true).setMaxLength(30)))

  .addSubcommand(s => s
    .setName("list")
    .setDescription("List all custom commands"))

  .addSubcommand(s => s
    .setName("info")
    .setDescription("View details of a custom command")
    .addStringOption(o => o.setName("name").setDescription("Command name").setRequired(true).setMaxLength(30)));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === "create") {
    const name = interaction.options.getString("name", true).toLowerCase().replace(/\s+/g, "-");
    if (/[^a-z0-9\-_]/.test(name)) {
      return interaction.reply({ content: "> Command names may only contain letters, numbers, hyphens, and underscores.", flags: MessageFlags.Ephemeral });
    }
    const existing = await getCustomCmd(guildId, name);
    if (existing) return interaction.reply({ content: "> A command with that name already exists. Use `/customcmd edit` to update it.", flags: MessageFlags.Ephemeral });

    const all = await listCustomCmds(guildId);
    if (all.length >= 100) return interaction.reply({ content: "> Maximum of 100 custom commands per server.", flags: MessageFlags.Ephemeral });

    await setCustomCmd(guildId, name, {
      response: sanitizeString(interaction.options.getString("response", true)).slice(0, 2000),
      asEmbed: interaction.options.getBoolean("as_embed") ?? false,
      embedTitle: interaction.options.getString("embed_title") ?? null,
      requiredRoleId: interaction.options.getRole("required_role")?.id ?? null,
      allowedChannelId: interaction.options.getChannel("channel_only")?.id ?? null,
      deleteInput: interaction.options.getBoolean("delete_input") ?? false,
      dmUser: interaction.options.getBoolean("dm_user") ?? false,
      createdBy: interaction.user.id,
    });
    return interaction.reply({ content: `> Custom command \`!${name}\` created.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "edit") {
    const name = interaction.options.getString("name", true).toLowerCase();
    const cmd = await getCustomCmd(guildId, name);
    if (!cmd) return interaction.reply({ content: "> Command not found.", flags: MessageFlags.Ephemeral });
    await setCustomCmd(guildId, name, { ...cmd, response: sanitizeString(interaction.options.getString("response", true)).slice(0, 2000) });
    return interaction.reply({ content: `> Command \`!${name}\` updated.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "delete") {
    const name = interaction.options.getString("name", true).toLowerCase();
    const cmd = await getCustomCmd(guildId, name);
    if (!cmd) return interaction.reply({ content: "> Command not found.", flags: MessageFlags.Ephemeral });
    await deleteCustomCmd(guildId, name);
    return interaction.reply({ content: `> Command \`!${name}\` deleted.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "list") {
    const cmds = await listCustomCmds(guildId);
    if (!cmds.length) return interaction.reply({ content: "> No custom commands configured.", flags: MessageFlags.Ephemeral });
    const chunks = [];
    for (let i = 0; i < cmds.length; i += 25) chunks.push(cmds.slice(i, i + 25));
    const embed = new EmbedBuilder()
      .setTitle(`Custom Commands (${cmds.length})`)
      .setColor(0x5865F2)
      .setDescription(chunks[0].map(c => `\`!${c.name}\` — ${c.uses} uses`).join("\n"))
      .setFooter({ text: `Trigger with your server prefix + command name` });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === "info") {
    const name = interaction.options.getString("name", true).toLowerCase();
    const cmd = await getCustomCmd(guildId, name);
    if (!cmd) return interaction.reply({ content: "> Command not found.", flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder()
      .setTitle(`!${cmd.name}`)
      .setColor(0x5865F2)
      .addFields(
        { name: "Response", value: cmd.response.slice(0, 300), inline: false },
        { name: "Uses", value: String(cmd.uses), inline: true },
        { name: "Embed", value: cmd.asEmbed ? "Yes" : "No", inline: true },
        { name: "Delete input", value: cmd.deleteInput ? "Yes" : "No", inline: true },
        { name: "DM user", value: cmd.dmUser ? "Yes" : "No", inline: true },
        ...(cmd.requiredRoleId ? [{ name: "Required role", value: `<@&${cmd.requiredRoleId}>`, inline: true }] : []),
        ...(cmd.allowedChannelId ? [{ name: "Channel only", value: `<#${cmd.allowedChannelId}>`, inline: true }] : []),
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}
