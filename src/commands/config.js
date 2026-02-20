import {
  SlashCommandBuilder,
  PermissionFlagsBits
} from "discord.js";
import {
  setCommandRoles,
  clearCommandRoles,
  listCommandRoles,
  setCommandEnabled,
  setCategoryEnabled,
  listCommandSettings
} from "../utils/permissions.js";
import { replyEmbed, replyEmbedWithJson } from "../utils/discordOutput.js";

export const meta = {
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
  category: "admin"
};

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configuration commands")
  .addSubcommand(sub =>
    sub
      .setName("command-roles")
      .setDescription("Set roles required to use a command")
      .addStringOption(o =>
        o.setName("command").setDescription("Command name").setRequired(true)
      )
      .addStringOption(o =>
        o
          .setName("action")
          .setDescription("add/remove/clear")
          .setRequired(true)
          .addChoices(
            { name: "add", value: "add" },
            { name: "remove", value: "remove" },
            { name: "clear", value: "clear" }
          )
      )
      .addRoleOption(o =>
        o.setName("role").setDescription("Role to add/remove").setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub.setName("command-roles-list").setDescription("List command role rules")
  )
  .addSubcommand(sub =>
    sub
      .setName("command-enable")
      .setDescription("Enable or disable a command")
      .addStringOption(o =>
        o.setName("command").setDescription("Command name").setRequired(true)
      )
      .addBooleanOption(o =>
        o.setName("enabled").setDescription("true/false").setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("category-enable")
      .setDescription("Enable or disable a category")
      .addStringOption(o =>
        o.setName("category").setDescription("Category name").setRequired(true)
      )
      .addBooleanOption(o =>
        o.setName("enabled").setDescription("true/false").setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName("settings").setDescription("Show command settings")
  );

export async function execute(interaction) {
  if (!interaction.inGuild()) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === "command-roles-list") {
    const res = await listCommandRoles(guildId);
    await replyEmbedWithJson(
      interaction,
      "Command role rules",
      "Role rules per command.",
      res.commandPerms ?? {},
      "command-roles.json"
    );
    return;
  }

  if (sub === "command-enable") {
    const commandName = interaction.options.getString("command", true);
    const enabled = interaction.options.getBoolean("enabled", true);
    await setCommandEnabled(guildId, commandName, enabled);
    await replyEmbed(interaction, "Command status", `${commandName} ${enabled ? "enabled" : "disabled"}`);
    return;
  }

  if (sub === "category-enable") {
    const category = interaction.options.getString("category", true);
    const enabled = interaction.options.getBoolean("enabled", true);
    await setCategoryEnabled(guildId, category, enabled);
    await replyEmbed(interaction, "Category status", `${category} ${enabled ? "enabled" : "disabled"}`);
    return;
  }

  if (sub === "settings") {
    const settings = await listCommandSettings(guildId);
    await replyEmbedWithJson(
      interaction,
      "Command settings",
      "Current command settings.",
      settings ?? {},
      "command-settings.json"
    );
    return;
  }

  const commandName = interaction.options.getString("command", true);
  const action = interaction.options.getString("action", true);
  const role = interaction.options.getRole("role");

  if (action === "clear") {
    const res = await clearCommandRoles(guildId, commandName);
    await replyEmbed(interaction, "Command roles", `Cleared role rules for ${res.commandName}.`);
    return;
  }

  if (!role) {
    await replyEmbed(interaction, "Command roles", "Role is required for add/remove.");
    return;
  }

  const res = await listCommandRoles(guildId);
  const existing = res.commandPerms?.[commandName]?.roleIds ?? [];
  let next = existing.slice();

  if (action === "add") {
    if (!next.includes(role.id)) next.push(role.id);
  } else if (action === "remove") {
    next = next.filter(r => r !== role.id);
  }

  const saved = await setCommandRoles(guildId, commandName, next);
  await replyEmbed(
    interaction,
    "Command roles",
    `Roles for ${commandName}: ${saved.roleIds.join(", ") || "none"}`
  );
}
