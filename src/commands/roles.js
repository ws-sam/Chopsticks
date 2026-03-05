// src/commands/roles.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import {
  createRoleMenu, addRoleOption, removeRoleOption, getRoleMenu,
  listRoleMenus, deleteRoleMenu, setRoleMenuMessage,
  addTempRole, removeTempRole,
} from "../tools/roles/menus.js";
import { buildRoleMenuComponents, buildRoleMenuEmbed } from "../tools/roles/handler.js";

export const meta = {
  name: "roles",
  category: "mod",
  deployGlobal: true,
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageRoles],
};

export const data = new SlashCommandBuilder()
  .setName("roles")
  .setDescription("Role menus, temp roles, and role management")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)

  .addSubcommand(s => s
    .setName("menu-create")
    .setDescription("Create a new role menu")
    .addStringOption(o => o.setName("title").setDescription("Menu title").setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("type").setDescription("Menu type").setRequired(true)
      .addChoices({ name: "Buttons", value: "button" }, { name: "Dropdown", value: "select" }))
    .addStringOption(o => o.setName("description").setDescription("Menu description").setMaxLength(200))
    .addBooleanOption(o => o.setName("exclusive").setDescription("Allow only one role at a time?")))

  .addSubcommand(s => s
    .setName("menu-add")
    .setDescription("Add a role option to a menu")
    .addIntegerOption(o => o.setName("menu_id").setDescription("Menu ID").setRequired(true).setMinValue(1))
    .addRoleOption(o => o.setName("role").setDescription("Role to add").setRequired(true))
    .addStringOption(o => o.setName("label").setDescription("Button/option label").setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("emoji").setDescription("Emoji for the button/option"))
    .addStringOption(o => o.setName("description").setDescription("Description for dropdown option").setMaxLength(100))
    .addStringOption(o => o.setName("style").setDescription("Button color (button menus only)")
      .addChoices(
        { name: "Blue (Primary)", value: "Primary" },
        { name: "Grey (Secondary)", value: "Secondary" },
        { name: "Green (Success)", value: "Success" },
        { name: "Red (Danger)", value: "Danger" },
      )))

  .addSubcommand(s => s
    .setName("menu-remove")
    .setDescription("Remove a role from a menu")
    .addIntegerOption(o => o.setName("menu_id").setDescription("Menu ID").setRequired(true).setMinValue(1))
    .addRoleOption(o => o.setName("role").setDescription("Role to remove").setRequired(true)))

  .addSubcommand(s => s
    .setName("menu-publish")
    .setDescription("Publish a role menu to a channel")
    .addIntegerOption(o => o.setName("menu_id").setDescription("Menu ID").setRequired(true).setMinValue(1))
    .addChannelOption(o => o.setName("channel").setDescription("Channel to post in").setRequired(true)))

  .addSubcommand(s => s
    .setName("menu-delete")
    .setDescription("Delete a role menu")
    .addIntegerOption(o => o.setName("menu_id").setDescription("Menu ID").setRequired(true).setMinValue(1)))

  .addSubcommand(s => s
    .setName("menu-list")
    .setDescription("List all role menus in this server"))

  .addSubcommand(s => s
    .setName("temprole")
    .setDescription("Give a user a temporary role that expires after a duration")
    .addUserOption(o => o.setName("member").setDescription("User to give the role to").setRequired(true))
    .addRoleOption(o => o.setName("role").setDescription("Role to assign").setRequired(true))
    .addStringOption(o => o.setName("duration").setDescription("Duration (e.g. 1h, 30m, 7d)").setRequired(true)))

  .addSubcommand(s => s
    .setName("temprole-remove")
    .setDescription("Remove a user's temp role early")
    .addUserOption(o => o.setName("member").setDescription("User").setRequired(true))
    .addRoleOption(o => o.setName("role").setDescription("Role to remove").setRequired(true)));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === "menu-create") {
    const title = interaction.options.getString("title", true);
    const type = interaction.options.getString("type", true);
    const description = interaction.options.getString("description");
    const exclusive = interaction.options.getBoolean("exclusive") ?? false;
    const menu = await createRoleMenu(guildId, { title, description, menuType: type, exclusive });
    return interaction.reply({
      content: `> Role menu **#${menu.id}** created (${type}). Add options with \`/roles menu-add menu_id:${menu.id}\`, then publish with \`/roles menu-publish\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === "menu-add") {
    const menuId = interaction.options.getInteger("menu_id", true);
    const role = interaction.options.getRole("role", true);
    const label = interaction.options.getString("label", true);
    const emoji = interaction.options.getString("emoji");
    const description = interaction.options.getString("description");
    const style = interaction.options.getString("style") ?? "Secondary";
    const result = await addRoleOption(guildId, menuId, { roleId: role.id, label, emoji, description, style });
    if (!result) return interaction.reply({ content: "> Menu not found.", flags: MessageFlags.Ephemeral });
    if (result.error) return interaction.reply({ content: `> ${result.error}`, flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: `> Added **${role.name}** to menu #${menuId}.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "menu-remove") {
    const menuId = interaction.options.getInteger("menu_id", true);
    const role = interaction.options.getRole("role", true);
    await removeRoleOption(guildId, menuId, role.id);
    return interaction.reply({ content: `> Removed **${role.name}** from menu #${menuId}.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "menu-publish") {
    const menuId = interaction.options.getInteger("menu_id", true);
    const channel = interaction.options.getChannel("channel", true);

    const menu = await getRoleMenu(guildId, menuId);
    if (!menu) return interaction.reply({ content: "> Menu not found.", flags: MessageFlags.Ephemeral });
    if (!menu.options.length) return interaction.reply({ content: "> Add at least one role option before publishing.", flags: MessageFlags.Ephemeral });

    const embed = buildRoleMenuEmbed(menu);
    const components = buildRoleMenuComponents(menu);
    const msg = await channel.send({ embeds: [embed], components });
    await setRoleMenuMessage(guildId, menuId, msg.id, channel.id);

    return interaction.reply({ content: `> Role menu **#${menuId}** published in <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "menu-delete") {
    const menuId = interaction.options.getInteger("menu_id", true);
    const deleted = await deleteRoleMenu(guildId, menuId);
    return interaction.reply({ content: deleted ? `> Menu #${menuId} deleted.` : "> Menu not found.", flags: MessageFlags.Ephemeral });
  }

  if (sub === "menu-list") {
    const menus = await listRoleMenus(guildId);
    if (!menus.length) return interaction.reply({ content: "> No role menus. Create one with `/roles menu-create`.", flags: MessageFlags.Ephemeral });
    const lines = menus.map(m => `**#${m.id}** ${m.title} (${m.menuType}, ${m.options.length} options)${m.messageId ? ` • published` : ""}`);
    const embed = new EmbedBuilder().setTitle("Role Menus").setDescription(lines.join("\n")).setColor(0x5865F2);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === "temprole") {
    const user = interaction.options.getUser("member", true);
    const role = interaction.options.getRole("role", true);
    const durationStr = interaction.options.getString("duration", true);

    const durationMs = parseDuration(durationStr);
    if (!durationMs || durationMs < 60000) {
      return interaction.reply({ content: "> Invalid duration. Use format like `30m`, `1h`, `7d`. Minimum 1 minute.", flags: MessageFlags.Ephemeral });
    }
    if (durationMs > 365 * 24 * 60 * 60 * 1000) {
      return interaction.reply({ content: "> Maximum duration is 1 year.", flags: MessageFlags.Ephemeral });
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ content: "> User not found.", flags: MessageFlags.Ephemeral });

    await member.roles.add(role).catch(() => null);
    const expiresAt = Date.now() + durationMs;
    await addTempRole(guildId, user.id, role.id, expiresAt);

    return interaction.reply({
      content: `> <@${user.id}> given **${role.name}** temporarily. Expires <t:${Math.floor(expiresAt / 1000)}:R>.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === "temprole-remove") {
    const user = interaction.options.getUser("member", true);
    const role = interaction.options.getRole("role", true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member) await member.roles.remove(role).catch(() => null);
    await removeTempRole(guildId, user.id, role.id);
    return interaction.reply({ content: `> Temp role **${role.name}** removed from <@${user.id}>.`, flags: MessageFlags.Ephemeral });
  }
}

/**
 * Parse a duration string like "30m", "1h", "7d" into milliseconds.
 */
function parseDuration(str) {
  const match = str.trim().match(/^(\d+)\s*(s|m|h|d|w)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  return n * (mult[unit] ?? 0);
}
