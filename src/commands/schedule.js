// src/commands/schedule.js
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { schedule, cancel } from "../utils/scheduler.js";
import { makeEmbed } from "../utils/discordOutput.js";

export const meta = {
  category: "tools",
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageMessages]
};

export const data = new SlashCommandBuilder()
  .setName("schedule")
  .setDescription("Schedule a message to be sent in a channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand(s =>
    s.setName("message")
      .setDescription("Schedule a message for a channel")
      .addChannelOption(o =>
        o.setName("channel").setDescription("Channel to send to").setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .addStringOption(o => o.setName("message").setDescription("Message to send").setRequired(true).setMaxLength(2000))
      .addStringOption(o => o.setName("time").setDescription('Relative ("1h30m", "2d") or ISO date ("2026-03-01T15:00:00")').setRequired(true))
  )
  .addSubcommand(s => s.setName("list").setDescription("List pending scheduled messages for this server"))
  .addSubcommand(s =>
    s.setName("cancel")
      .setDescription("Cancel a scheduled message by ID")
      .addIntegerOption(o => o.setName("id").setDescription("Scheduled message ID").setRequired(true).setMinValue(1))
  );

/**
 * Parse a time string into milliseconds from now.
 * Supports relative ("1h30m", "2d") and absolute ISO date strings.
 * @param {string} raw
 * @returns {{ ms: number, sendAt: number }|{ error: string }}
 */
export function parseTime(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { error: "Empty time string." };

  // Try relative: match patterns like 1d, 2h, 30m, 1h30m, etc.
  const relRe = /(\d+)(d|h|m)/gi;
  if (/^(\d+[dhm])+$/i.test(s)) {
    let ms = 0;
    for (const m of [...s.matchAll(relRe)]) {
      const n = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      if (unit === "d") ms += n * 86_400_000;
      else if (unit === "h") ms += n * 3_600_000;
      else if (unit === "m") ms += n * 60_000;
    }
    if (ms <= 0) return { error: "Time must be positive." };
    return { ms, sendAt: Date.now() + ms };
  }

  // Try absolute ISO date
  const ts = Date.parse(s);
  if (!isNaN(ts)) {
    const ms = ts - Date.now();
    if (ms <= 0) return { error: "Scheduled time must be in the future." };
    return { ms, sendAt: ts };
  }

  return { error: "Invalid time format. Use relative (\"1h30m\", \"2d\") or ISO date (\"2026-01-01T12:00:00\")." };
}

export async function execute(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const sub = interaction.options.getSubcommand();

  if (sub === "message") {
    const channel = interaction.options.getChannel("channel", true);
    const message = interaction.options.getString("message", true);
    const timeRaw = interaction.options.getString("time", true);

    const parsed = parseTime(timeRaw);
    if (parsed.error) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Schedule", `❌ ${parsed.error}`, [], null, null, 0xFF0000)] });
      return;
    }

    const gData = await loadGuildData(guildId);
    gData.scheduledMessages ??= [];
    const nextId = (gData.scheduledMessages.reduce((max, m) => Math.max(max, m.id ?? 0), 0)) + 1;

    const entry = {
      id: nextId,
      channelId: channel.id,
      message,
      sendAt: parsed.sendAt,
      createdBy: userId,
      created: Date.now()
    };
    gData.scheduledMessages.push(entry);
    await saveGuildData(guildId, gData);

    // Register with scheduler (note: won't survive bot restarts for long delays)
    const timerId = `schedule:${guildId}:${nextId}`;
    schedule(timerId, parsed.ms, async () => {
      try {
        const ch = await interaction.client.channels.fetch(channel.id);
        if (ch?.isTextBased?.()) await ch.send(message);
      } catch {}
      // Clean up from storage after send
      try {
        const d = await loadGuildData(guildId);
        if (Array.isArray(d.scheduledMessages)) {
          d.scheduledMessages = d.scheduledMessages.filter(m => m.id !== nextId);
          await saveGuildData(guildId, d);
        }
      } catch {}
    });

    const sendAtStr = new Date(parsed.sendAt).toUTCString();
    const fields = [
      { name: "ID", value: String(nextId), inline: true },
      { name: "Channel", value: `<#${channel.id}>`, inline: true },
      { name: "Send At", value: sendAtStr, inline: false }
    ];
    const note = parsed.ms > 3_600_000 ? "\n⚠️ Delays >1h won't survive bot restarts." : "";
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [makeEmbed("Schedule", `✅ Message scheduled.${note}`, fields, null, null, 0x57F287)]
    });
    return;
  }

  if (sub === "list") {
    const gData = await loadGuildData(guildId);
    const pending = Array.isArray(gData.scheduledMessages) ? gData.scheduledMessages : [];
    if (!pending.length) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Schedule", "No pending scheduled messages.", [], null, null, 0x5865F2)] });
      return;
    }
    const lines = pending.map(m => {
      const sendAt = new Date(m.sendAt).toUTCString();
      const preview = String(m.message ?? "").slice(0, 60);
      return `**ID ${m.id}** → <#${m.channelId}> at ${sendAt}\n> ${preview}${String(m.message).length > 60 ? "…" : ""}`;
    });
    const embed = new EmbedBuilder()
      .setTitle("Scheduled Messages")
      .setDescription(lines.join("\n\n").slice(0, 4096))
      .setColor(0x5865F2);
    await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
    return;
  }

  if (sub === "cancel") {
    const cancelId = interaction.options.getInteger("id", true);
    const gData = await loadGuildData(guildId);
    if (!Array.isArray(gData.scheduledMessages)) gData.scheduledMessages = [];
    const before = gData.scheduledMessages.length;
    gData.scheduledMessages = gData.scheduledMessages.filter(m => m.id !== cancelId);
    if (gData.scheduledMessages.length === before) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Schedule", `❌ No scheduled message with ID ${cancelId}.`, [], null, null, 0xFF0000)] });
      return;
    }
    await saveGuildData(guildId, gData);
    cancel(`schedule:${guildId}:${cancelId}`);
    await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Schedule", `✅ Cancelled scheduled message #${cancelId}.`, [], null, null, 0x57F287)] });
    return;
  }

  await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [makeEmbed("Schedule", "Unknown action.", [], null, null, 0xFF0000)] });
}
