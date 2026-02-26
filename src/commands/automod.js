// src/commands/automod.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { defaultAutomodConfig, RULE_TYPES, ACTIONS } from "../tools/automod/rules.js";

const RULE_LABELS = {
  words:      "Word/Phrase Blacklist",
  invites:    "Discord Invite Links",
  links:      "All Links",
  phishing:   "Phishing / Scam Links",
  caps:       "Excessive Caps",
  mentions:   "Mention Spam",
  duplicates: "Duplicate Messages",
  newlines:   "Newline Spam",
};

export const meta = {
  deployGlobal: true,
  name: "automod",
  category: "safety",
};

export const data = new SlashCommandBuilder()
  .setName("automod")
  .setDescription("Configure AutoMod content filtering")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  // /automod setup enable|disable [log-channel]
  .addSubcommand(s => s
    .setName("setup")
    .setDescription("Enable or disable AutoMod")
    .addBooleanOption(o => o.setName("enabled").setDescription("Enable AutoMod?").setRequired(true))
    .addChannelOption(o => o.setName("log_channel").setDescription("Channel to log AutoMod actions")))

  // /automod rules — show current rule status
  .addSubcommand(s => s
    .setName("rules")
    .setDescription("Show current AutoMod rule configuration"))

  // /automod rule-set — configure a specific rule
  .addSubcommand(s => s
    .setName("rule-set")
    .setDescription("Enable/disable a rule and set its action")
    .addStringOption(o => o
      .setName("rule")
      .setDescription("Which rule to configure")
      .setRequired(true)
      .addChoices(...RULE_TYPES.map(r => ({ name: RULE_LABELS[r] ?? r, value: r }))))
    .addBooleanOption(o => o.setName("enabled").setDescription("Enable this rule?").setRequired(true))
    .addStringOption(o => o
      .setName("action")
      .setDescription("Action to take when triggered")
      .addChoices(...ACTIONS.map(a => ({ name: a, value: a })))))

  // /automod words add|remove|list
  .addSubcommand(s => s
    .setName("words-add")
    .setDescription("Add a word/phrase/regex to the blacklist")
    .addStringOption(o => o.setName("pattern").setDescription("Word, phrase, or /regex/").setRequired(true)))

  .addSubcommand(s => s
    .setName("words-remove")
    .setDescription("Remove a word/phrase from the blacklist")
    .addStringOption(o => o.setName("pattern").setDescription("Pattern to remove").setRequired(true)))

  .addSubcommand(s => s
    .setName("words-list")
    .setDescription("List all blacklisted words/patterns"))

  // /automod exempt add|remove channel
  .addSubcommand(s => s
    .setName("exempt-add")
    .setDescription("Exempt a channel from AutoMod")
    .addChannelOption(o => o.setName("channel").setDescription("Channel to exempt").setRequired(true)))

  .addSubcommand(s => s
    .setName("exempt-remove")
    .setDescription("Remove a channel exemption")
    .addChannelOption(o => o.setName("channel").setDescription("Channel to un-exempt").setRequired(true)))

  // /automod exempt-role add|remove
  .addSubcommand(s => s
    .setName("exempt-role")
    .setDescription("Toggle a role exemption from AutoMod")
    .addRoleOption(o => o.setName("role").setDescription("Role to exempt/un-exempt").setRequired(true)))

  // /automod test
  .addSubcommand(s => s
    .setName("test")
    .setDescription("Test a message against AutoMod rules without sending anything")
    .addStringOption(o => o.setName("message").setDescription("Message text to test").setRequired(true)));

async function ensureAutomod(guildId) {
  const gd = await loadGuildData(guildId);
  if (!gd.automod) gd.automod = defaultAutomodConfig();
  return { gd, automod: gd.automod };
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === "setup") {
    const { gd, automod } = await ensureAutomod(guildId);
    const enabled = interaction.options.getBoolean("enabled");
    const logCh = interaction.options.getChannel("log_channel");
    automod.enabled = enabled;
    if (logCh) automod.logChannelId = logCh.id;
    await saveGuildData(guildId, gd);
    return interaction.reply({
      content: `> AutoMod **${enabled ? "enabled" : "disabled"}**.${logCh ? ` Logging to <#${logCh.id}>.` : ""}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === "rules") {
    const { automod } = await ensureAutomod(guildId);
    const rows = RULE_TYPES.map(r => {
      const rule = automod.rules?.[r] ?? {};
      const status = rule.enabled ? "✅" : "❌";
      const action = rule.action ?? "delete";
      return `${status} **${RULE_LABELS[r] ?? r}** — action: \`${action}\``;
    });
    const embed = new EmbedBuilder()
      .setTitle("AutoMod Rules")
      .setDescription(rows.join("\n"))
      .addFields({ name: "Status", value: automod.enabled ? "Enabled" : "Disabled", inline: true })
      .setColor(automod.enabled ? 0x57F287 : 0xED4245);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === "rule-set") {
    const { gd, automod } = await ensureAutomod(guildId);
    const rule = interaction.options.getString("rule");
    const enabled = interaction.options.getBoolean("enabled");
    const action = interaction.options.getString("action");
    if (!automod.rules[rule]) automod.rules[rule] = {};
    automod.rules[rule].enabled = enabled;
    if (action) automod.rules[rule].action = action;
    await saveGuildData(guildId, gd);
    return interaction.reply({
      content: `> Rule **${RULE_LABELS[rule] ?? rule}** ${enabled ? "enabled" : "disabled"}.${action ? ` Action: \`${action}\`.` : ""}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === "words-add") {
    const { gd, automod } = await ensureAutomod(guildId);
    const pattern = interaction.options.getString("pattern");
    automod.rules.words ??= { enabled: false, action: "delete", patterns: [] };
    automod.rules.words.patterns ??= [];
    if (automod.rules.words.patterns.includes(pattern)) {
      return interaction.reply({ content: "> Pattern already in list.", flags: MessageFlags.Ephemeral });
    }
    if (automod.rules.words.patterns.length >= 100) {
      return interaction.reply({ content: "> Maximum 100 patterns reached.", flags: MessageFlags.Ephemeral });
    }
    automod.rules.words.patterns.push(pattern);
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Added pattern \`${pattern}\` to word blacklist.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "words-remove") {
    const { gd, automod } = await ensureAutomod(guildId);
    const pattern = interaction.options.getString("pattern");
    const list = automod.rules?.words?.patterns ?? [];
    const idx = list.indexOf(pattern);
    if (idx === -1) return interaction.reply({ content: "> Pattern not found.", flags: MessageFlags.Ephemeral });
    list.splice(idx, 1);
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Removed \`${pattern}\` from word blacklist.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "words-list") {
    const { automod } = await ensureAutomod(guildId);
    const patterns = automod.rules?.words?.patterns ?? [];
    if (!patterns.length) {
      return interaction.reply({ content: "> No blacklisted words/patterns.", flags: MessageFlags.Ephemeral });
    }
    const list = patterns.map((p, i) => `${i + 1}. \`${p}\``).join("\n");
    return interaction.reply({ content: `**Word Blacklist (${patterns.length}):**\n${list}`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "exempt-add") {
    const { gd, automod } = await ensureAutomod(guildId);
    const ch = interaction.options.getChannel("channel");
    automod.exemptChannels ??= [];
    if (!automod.exemptChannels.includes(ch.id)) automod.exemptChannels.push(ch.id);
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> <#${ch.id}> is now exempt from AutoMod.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "exempt-remove") {
    const { gd, automod } = await ensureAutomod(guildId);
    const ch = interaction.options.getChannel("channel");
    automod.exemptChannels = (automod.exemptChannels ?? []).filter(id => id !== ch.id);
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> <#${ch.id}> exemption removed.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "exempt-role") {
    const { gd, automod } = await ensureAutomod(guildId);
    const role = interaction.options.getRole("role");
    automod.exemptRoles ??= [];
    const idx = automod.exemptRoles.indexOf(role.id);
    if (idx === -1) {
      automod.exemptRoles.push(role.id);
      await saveGuildData(guildId, gd);
      return interaction.reply({ content: `> Role **${role.name}** exempted from AutoMod.`, flags: MessageFlags.Ephemeral });
    } else {
      automod.exemptRoles.splice(idx, 1);
      await saveGuildData(guildId, gd);
      return interaction.reply({ content: `> Role **${role.name}** exemption removed.`, flags: MessageFlags.Ephemeral });
    }
  }

  if (sub === "test") {
    const { automod } = await ensureAutomod(guildId);
    const msgText = interaction.options.getString("message");
    const { checkRule } = await import("../tools/automod/rules.js");
    const state = new Map();
    const rules = automod.rules ?? {};
    const hits = [];
    for (const [type, rule] of Object.entries(rules)) {
      const r = checkRule(msgText, rule, type, state, interaction.user.id);
      if (r) hits.push(`**${type}**: ${r.reason}`);
    }
    if (!hits.length) {
      return interaction.reply({ content: "> No rules triggered by that message.", flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ content: `**AutoMod Test — Triggered:**\n${hits.join("\n")}`, flags: MessageFlags.Ephemeral });
  }
}
