// src/events/channelUpdate.js
import { EmbedBuilder } from "discord.js";
import { dispatchAuditLog } from "../tools/auditLog/dispatcher.js";
import { logger } from "../utils/logger.js";

export default {
  name: "channelUpdate",
  async execute(oldChannel, newChannel) {
    try {
      if (!newChannel.guild) return;
      const changes = [];

      if (oldChannel.name !== newChannel.name) changes.push({ name: "Name", value: `\`${oldChannel.name}\` → \`${newChannel.name}\``, inline: true });
      if (oldChannel.topic !== newChannel.topic) changes.push({ name: "Topic", value: `\`${oldChannel.topic ?? "(none)"}\` → \`${newChannel.topic ?? "(none)"}\`` });
      if (oldChannel.nsfw !== newChannel.nsfw) changes.push({ name: "NSFW", value: newChannel.nsfw ? "Enabled" : "Disabled", inline: true });
      if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) changes.push({ name: "Slowmode", value: `${oldChannel.rateLimitPerUser ?? 0}s → ${newChannel.rateLimitPerUser ?? 0}s`, inline: true });

      if (!changes.length) return;

      const embed = new EmbedBuilder()
        .setTitle("Channel Updated")
        .setColor(0xFEE75C)
        .addFields({ name: "Channel", value: `<#${newChannel.id}>`, inline: true }, ...changes)
        .setTimestamp()
        .setFooter({ text: `Channel ID: ${newChannel.id}` });

      await dispatchAuditLog(newChannel.guild, "channelUpdate", embed);
    } catch (err) {
      logger.error("[event:channelUpdate]", err);
    }
  },
};
