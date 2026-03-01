// src/commands/boosterperks.js
// Booster perks: server boosters can customize their personal boost role
// (color, name, icon). The bot creates/manages a personal role per booster.
//
// Commands:
//   /boostcolor <hex>  — set your boost role color
//   /boostname <name>  — set your boost role name
//   /boosterperks setup — admin: configure where boost roles are positioned
//   /boosterperks status — view your boost role

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { hasPremiumBuff } from "../game/buffs.js";

export const meta = {
  deployGlobal: false,
  name: "boosterperks",
  category: "admin",
};

export const data = new SlashCommandBuilder()
  .setName("boosterperks")
  .setDescription("Customize your server boost role or configure boost perks (admins)")

  .addSubcommand(s => s
    .setName("color")
    .setDescription("Set your personal boost role color (boosters only)")
    .addStringOption(o => o.setName("hex").setDescription("Hex color, e.g. #FF5733").setRequired(true).setMaxLength(7)))

  .addSubcommand(s => s
    .setName("name")
    .setDescription("Set your personal boost role name (boosters only)")
    .addStringOption(o => o.setName("text").setDescription("Role name (max 30 chars)").setRequired(true).setMaxLength(30)))

  .addSubcommand(s => s
    .setName("view")
    .setDescription("View your current boost role"))

  .addSubcommand(s => s
    .setName("setup")
    .setDescription("(Admin) Set the position role — boost roles are placed below it")
    .addRoleOption(o => o.setName("above_role").setDescription("Boost roles will be placed just below this role").setRequired(true)))

  .addSubcommand(s => s
    .setName("reset")
    .setDescription("Remove your personal boost role"));

async function ensureBoosterRole(guild, member, gd) {
  gd.boosterRoles ??= { positionRoleId: null, userRoles: {} };
  const userRoles = gd.boosterRoles.userRoles;
  let roleId = userRoles[member.id];
  let role = roleId ? guild.roles.cache.get(roleId) : null;

  if (!role) {
    // Find position
    const posRole = gd.boosterRoles.positionRoleId
      ? guild.roles.cache.get(gd.boosterRoles.positionRoleId)
      : null;
    const position = posRole ? Math.max(0, posRole.position - 1) : 1;

    role = await guild.roles.create({
      name: `${member.user.username}'s Role`,
      color: 0x99AAB5,
      position,
      reason: "Booster perk role",
    }).catch(() => null);

    if (!role) return null;
    userRoles[member.id] = role.id;
    await member.roles.add(role).catch(() => null);
  }

  return role;
}

function parseHex(hex) {
  const clean = hex.replace("#", "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(clean)) return null;
  return parseInt(clean, 16);
}

async function isBoosting(member) {
  if (member.premiumSince) return true;
  return hasPremiumBuff(member.id);
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const member = interaction.member;
  const gd = await loadGuildData(guildId);

  if (sub === "setup") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "> You need **Manage Guild** for this.", flags: MessageFlags.Ephemeral });
    }
    const posRole = interaction.options.getRole("above_role", true);
    gd.boosterRoles ??= { positionRoleId: null, userRoles: {} };
    gd.boosterRoles.positionRoleId = posRole.id;
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Boost roles will be positioned below **${posRole.name}**.`, flags: MessageFlags.Ephemeral });
  }

  // All other subcommands require boosting
  if (!await isBoosting(member)) {
    return interaction.reply({ content: "> You need to be boosting this server to use booster perks.", flags: MessageFlags.Ephemeral });
  }

  if (sub === "color") {
    const hex = interaction.options.getString("hex", true);
    const color = parseHex(hex);
    if (color === null) return interaction.reply({ content: "> Invalid hex color. Use format `#RRGGBB`.", flags: MessageFlags.Ephemeral });
    const role = await ensureBoosterRole(interaction.guild, member, gd);
    if (!role) return interaction.reply({ content: "> Failed to create boost role. Does the bot have Manage Roles?", flags: MessageFlags.Ephemeral });
    await role.setColor(color, "Booster perk: color change").catch(() => null);
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Your boost role color is now **${hex}**. 🎨`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "name") {
    const text = interaction.options.getString("text", true);
    const role = await ensureBoosterRole(interaction.guild, member, gd);
    if (!role) return interaction.reply({ content: "> Failed to create boost role.", flags: MessageFlags.Ephemeral });
    await role.setName(text, "Booster perk: name change").catch(() => null);
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Your boost role is now named **${text}**.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "view") {
    gd.boosterRoles ??= { userRoles: {} };
    const roleId = gd.boosterRoles.userRoles?.[member.id];
    const role = roleId ? interaction.guild.roles.cache.get(roleId) : null;
    if (!role) return interaction.reply({ content: "> You don't have a boost role yet. Use `/boosterperks color` or `/boosterperks name` to create one.", flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder()
      .setTitle("Your Boost Role")
      .addFields(
        { name: "Name", value: role.name, inline: true },
        { name: "Color", value: `#${role.color.toString(16).padStart(6, "0")}`, inline: true },
        { name: "Role", value: `<@&${role.id}>`, inline: true },
      )
      .setColor(role.color || 0x99AAB5);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === "reset") {
    gd.boosterRoles ??= { userRoles: {} };
    const roleId = gd.boosterRoles.userRoles?.[member.id];
    if (!roleId) return interaction.reply({ content: "> You don't have a boost role to remove.", flags: MessageFlags.Ephemeral });
    const role = interaction.guild.roles.cache.get(roleId);
    if (role) await role.delete("Booster perk: user reset").catch(() => null);
    delete gd.boosterRoles.userRoles[member.id];
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: "> Your boost role has been removed.", flags: MessageFlags.Ephemeral });
  }
}
