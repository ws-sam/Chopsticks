// src/commands/autoresponder.js
// Auto-responder: guild admins set trigger → response pairs.
// Triggers are checked against each message in messageCreate.
// Supports match types: exact, contains, startswith, endswith, regex.
// Variables: {user}, {username}, {server}, {args}

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { sanitizeString } from "../utils/validation.js";

export const meta = {
  name: "autoresponder",
  category: "admin",
  deployGlobal: true,
};

export const data = new SlashCommandBuilder()
  .setName("autoresponder")
  .setDescription("Create auto-responders that react to message triggers")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  .addSubcommand(s => s
    .setName("add")
    .setDescription("Add an auto-responder trigger")
    .addStringOption(o => o.setName("trigger").setDescription("The trigger text").setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName("response").setDescription("The response (supports {user}, {server}, {args})").setRequired(true).setMaxLength(1900))
    .addStringOption(o => o
      .setName("match_type")
      .setDescription("How to match the trigger (default: contains)")
      .addChoices(
        { name: "Contains — trigger appears anywhere", value: "contains" },
        { name: "Exact — full message must match", value: "exact" },
        { name: "Starts with", value: "startswith" },
        { name: "Ends with", value: "endswith" },
        { name: "Regex — advanced pattern", value: "regex" },
      ))
    .addBooleanOption(o => o.setName("case_sensitive").setDescription("Case-sensitive match (default: false)"))
    .addBooleanOption(o => o.setName("delete_trigger").setDescription("Delete the triggering message"))
    .addBooleanOption(o => o.setName("reply").setDescription("Reply to the triggering message instead of a new message")))

  .addSubcommand(s => s
    .setName("remove")
    .setDescription("Remove an auto-responder by trigger text")
    .addStringOption(o => o.setName("trigger").setDescription("The trigger to remove").setRequired(true).setMaxLength(100)))

  .addSubcommand(s => s
    .setName("list")
    .setDescription("List all auto-responders"))

  .addSubcommand(s => s
    .setName("clear")
    .setDescription("Clear all auto-responders"));

function ensureAr(gd) {
  gd.autoresponders ??= [];
  return gd.autoresponders;
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const gd = await loadGuildData(guildId);
  const ars = ensureAr(gd);

  if (sub === "add") {
    const trigger = sanitizeString(interaction.options.getString("trigger", true)).slice(0, 200);
    const response = sanitizeString(interaction.options.getString("response", true)).slice(0, 1900);
    const matchType = interaction.options.getString("match_type") ?? "contains";
    const caseSensitive = interaction.options.getBoolean("case_sensitive") ?? false;
    const deleteTrigger = interaction.options.getBoolean("delete_trigger") ?? false;
    const useReply = interaction.options.getBoolean("reply") ?? false;

    if (matchType === "regex") {
      try { new RegExp(trigger); } catch {
        return interaction.reply({ content: "> Invalid regex pattern.", flags: MessageFlags.Ephemeral });
      }
    }

    if (ars.length >= 50) return interaction.reply({ content: "> Maximum 50 auto-responders per server.", flags: MessageFlags.Ephemeral });
    const existing = ars.findIndex(r => r.trigger === trigger && r.matchType === matchType);
    if (existing !== -1) ars.splice(existing, 1); // overwrite

    ars.push({ trigger, response, matchType, caseSensitive, deleteTrigger, reply: useReply });
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Auto-responder added for trigger \`${trigger}\` (${matchType}).`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "remove") {
    const trigger = interaction.options.getString("trigger", true);
    const before = ars.length;
    gd.autoresponders = ars.filter(r => r.trigger !== trigger);
    if (gd.autoresponders.length === before) return interaction.reply({ content: "> Trigger not found.", flags: MessageFlags.Ephemeral });
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: `> Auto-responder for \`${trigger}\` removed.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === "list") {
    if (!ars.length) return interaction.reply({ content: "> No auto-responders configured.", flags: MessageFlags.Ephemeral });
    const lines = ars.map((r, i) => `**${i + 1}.** \`${r.trigger}\` (${r.matchType}) → ${r.response.slice(0, 60)}${r.response.length > 60 ? "…" : ""}`);
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle(`Auto-Responders (${ars.length}/50)`).setDescription(lines.join("\n")).setColor(0x5865F2)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === "clear") {
    gd.autoresponders = [];
    await saveGuildData(guildId, gd);
    return interaction.reply({ content: "> All auto-responders cleared.", flags: MessageFlags.Ephemeral });
  }
}

/**
 * Check a message against all guild auto-responders.
 * Called from messageCreate handler.
 */
export async function processAutoresponders(message) {
  if (!message.guildId || message.author?.bot) return;
  try {
    const gd = await loadGuildData(message.guildId);
    const ars = gd.autoresponders ?? [];
    if (!ars.length) return;

    for (const ar of ars) {
      let content = message.content ?? "";
      let trigger = ar.trigger;
      if (!ar.caseSensitive) { content = content.toLowerCase(); trigger = trigger.toLowerCase(); }

      let matched = false;
      if (ar.matchType === "exact") matched = content === trigger;
      else if (ar.matchType === "contains") matched = content.includes(trigger);
      else if (ar.matchType === "startswith") matched = content.startsWith(trigger);
      else if (ar.matchType === "endswith") matched = content.endsWith(trigger);
      else if (ar.matchType === "regex") {
        try { matched = new RegExp(ar.trigger, ar.caseSensitive ? "" : "i").test(message.content ?? ""); } catch {}
      }

      if (!matched) continue;

      const args = message.content.trim().split(/\s+/).slice(1);
      const resolved = ar.response
        .replace(/\{user\}/g, `<@${message.author.id}>`)
        .replace(/\{username\}/g, message.author.username)
        .replace(/\{server\}/g, message.guild?.name ?? "")
        .replace(/\{args\}/g, args.join(" "));

      if (ar.deleteTrigger) await message.delete().catch(() => null);

      if (ar.reply) {
        await message.reply(resolved.slice(0, 2000)).catch(() => null);
      } else {
        await message.channel.send(resolved.slice(0, 2000)).catch(() => null);
      }
      break; // only first matching responder fires
    }
  } catch { /* auto-responder errors must not crash the bot */ }
}
