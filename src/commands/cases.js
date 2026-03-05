// src/commands/cases.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import {
  createCase,
  getCase,
  listCases,
  pardonCase,
  addCaseNote,
  CASE_TYPES,
} from "../tools/modcases/store.js";
import {
  getEscalationConfig,
  saveEscalationConfig,
  defaultEscalationChain,
} from "../tools/modcases/escalation.js";

export const meta = {
  deployGlobal: false,
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ModerateMembers],
  name: "cases",
  category: "mod",
};

export const data = new SlashCommandBuilder()
  .setName("cases")
  .setDescription("View and manage moderation cases")
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)

  .addSubcommand(s => s
    .setName("list")
    .setDescription("List recent mod cases")
    .addIntegerOption(o => o.setName("limit").setDescription("Number of cases").setMinValue(1).setMaxValue(50)))

  .addSubcommand(s => s
    .setName("user")
    .setDescription("List cases for a specific user")
    .addUserOption(o => o.setName("member").setDescription("User to look up").setRequired(true))
    .addIntegerOption(o => o.setName("limit").setDescription("Number of cases").setMinValue(1).setMaxValue(50)))

  .addSubcommand(s => s
    .setName("get")
    .setDescription("Get details of a specific case")
    .addIntegerOption(o => o.setName("id").setDescription("Case ID").setRequired(true).setMinValue(1)))

  .addSubcommand(s => s
    .setName("pardon")
    .setDescription("Pardon (clear) a case")
    .addIntegerOption(o => o.setName("id").setDescription("Case ID").setRequired(true).setMinValue(1)))

  .addSubcommand(s => s
    .setName("note")
    .setDescription("Add a note to a case")
    .addIntegerOption(o => o.setName("id").setDescription("Case ID").setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName("text").setDescription("Note text").setRequired(true).setMaxLength(500)))

  .addSubcommand(s => s
    .setName("escalation-view")
    .setDescription("View the current escalation chain configuration"))

  .addSubcommand(s => s
    .setName("escalation-toggle")
    .setDescription("Enable or disable automatic escalation")
    .addBooleanOption(o => o.setName("enabled").setDescription("Enable escalation?").setRequired(true)))

  .addSubcommand(s => s
    .setName("escalation-window")
    .setDescription("Set the rolling window for warn counting (days)")
    .addIntegerOption(o => o.setName("days").setDescription("Window in days").setRequired(true).setMinValue(1).setMaxValue(365)));

function caseEmbed(c, guild) {
  const embed = new EmbedBuilder()
    .setTitle(`Case #${c.id} — ${c.type.toUpperCase()}`)
    .setColor(c.pardoned ? 0x808080 : c.type === "ban" ? 0xED4245 : c.type === "warn" ? 0xFEE75C : 0xF47B67)
    .addFields(
      { name: "User", value: `<@${c.userId}> (${c.userId})`, inline: true },
      { name: "Moderator", value: `<@${c.modId}> (${c.modId})`, inline: true },
      { name: "Reason", value: c.reason },
      { name: "Status", value: c.pardoned ? "Pardoned" : "Active", inline: true },
      { name: "Date", value: `<t:${Math.floor(c.createdAt / 1000)}:F>`, inline: true },
    );
  if (c.duration) {
    embed.addFields({ name: "Duration", value: `${Math.round(c.duration / 60000)} minutes`, inline: true });
  }
  if (c.notes?.length) {
    embed.addFields({ name: "Notes", value: c.notes.map((n, i) => `${i + 1}. <@${n.modId}>: ${n.text}`).join("\n").slice(0, 500) });
  }
  return embed;
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === "list") {
    const limit = interaction.options.getInteger("limit") ?? 10;
    const cases = await listCases(guildId, { limit });
    if (!cases.length) return interaction.reply({ content: "> No cases found.", flags: MessageFlags.Ephemeral });
    const lines = cases.map(c => `**#${c.id}** \`${c.type}\` <@${c.userId}>${c.pardoned ? " ~~pardoned~~" : ""} — ${c.reason.slice(0, 50)}`);
    const embed = new EmbedBuilder().setTitle("Recent Cases").setDescription(lines.join("\n")).setColor(0x5865F2);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === "user") {
    const user = interaction.options.getUser("member", true);
    const limit = interaction.options.getInteger("limit") ?? 10;
    const cases = await listCases(guildId, { userId: user.id, limit });
    if (!cases.length) return interaction.reply({ content: `> No cases found for <@${user.id}>.`, flags: MessageFlags.Ephemeral });
    const lines = cases.map(c => `**#${c.id}** \`${c.type}\`${c.pardoned ? " ~~pardoned~~" : ""} — ${c.reason.slice(0, 60)}`);
    const embed = new EmbedBuilder()
      .setTitle(`Cases for ${user.tag}`)
      .setDescription(lines.join("\n"))
      .setThumbnail(user.displayAvatarURL())
      .setColor(0x5865F2);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === "get") {
    const id = interaction.options.getInteger("id", true);
    const c = await getCase(guildId, id);
    if (!c) return interaction.reply({ content: `> Case #${id} not found.`, flags: MessageFlags.Ephemeral });
    return interaction.reply({ embeds: [caseEmbed(c)], flags: MessageFlags.Ephemeral });
  }

  if (sub === "pardon") {
    const id = interaction.options.getInteger("id", true);
    const c = await pardonCase(guildId, id, interaction.user.id);
    if (!c) return interaction.reply({ content: `> Case #${id} not found.`, flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: `> Case **#${id}** pardoned.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "note") {
    const id = interaction.options.getInteger("id", true);
    const text = interaction.options.getString("text", true);
    const c = await addCaseNote(guildId, id, interaction.user.id, text);
    if (!c) return interaction.reply({ content: `> Case #${id} not found.`, flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: `> Note added to case **#${id}**.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "escalation-view") {
    const config = await getEscalationConfig(guildId);
    const chain = config.chain ?? defaultEscalationChain();
    const lines = chain.map(s => `${s.warnCount} warns → \`${s.action}\`${s.durationMs ? ` (${Math.round(s.durationMs / 60000)}m)` : ""}`);
    const embed = new EmbedBuilder()
      .setTitle("Escalation Chain")
      .setDescription(lines.join("\n"))
      .addFields(
        { name: "Status", value: config.enabled ? "Enabled" : "Disabled", inline: true },
        { name: "Window", value: `${config.windowDays ?? 30} days`, inline: true },
      )
      .setColor(config.enabled ? 0x57F287 : 0xED4245);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === "escalation-toggle") {
    const enabled = interaction.options.getBoolean("enabled", true);
    await saveEscalationConfig(guildId, { enabled });
    return interaction.reply({ content: `> Escalation **${enabled ? "enabled" : "disabled"}**.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "escalation-window") {
    const days = interaction.options.getInteger("days", true);
    await saveEscalationConfig(guildId, { windowDays: days });
    return interaction.reply({ content: `> Escalation window set to **${days} days**.`, flags: MessageFlags.Ephemeral });
  }
}
