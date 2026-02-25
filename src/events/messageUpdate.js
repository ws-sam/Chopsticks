// src/events/messageUpdate.js
import { EmbedBuilder } from "discord.js";
import { dispatchAuditLog } from "../tools/auditLog/dispatcher.js";
import { cacheEdit } from "../commands/snipe.js";
import { logger } from "../utils/logger.js";

export default {
  name: "messageUpdate",
  async execute(oldMessage, newMessage) {
    try {
      if (!newMessage.author?.bot && oldMessage.content !== newMessage.content) {
        cacheEdit(oldMessage, newMessage);
      }

      if (!newMessage.guild || newMessage.author?.bot) return;
      if (oldMessage.content === newMessage.content) return;

      const before = (oldMessage.content ?? "(no content)").slice(0, 450);
      const after  = (newMessage.content ?? "(no content)").slice(0, 450);

      const embed = new EmbedBuilder()
        .setTitle("Message Edited")
        .setColor(0xFEE75C)
        .addFields(
          { name: "Author", value: `<@${newMessage.author.id}> (${newMessage.author.tag})`, inline: true },
          { name: "Channel", value: `<#${newMessage.channelId}>`, inline: true },
          { name: "Before", value: before || "(empty)" },
          { name: "After",  value: after  || "(empty)" },
        )
        .setTimestamp()
        .setFooter({ text: `Message ID: ${newMessage.id}` });

      if (newMessage.url) {
        embed.addFields({ name: "Jump", value: `[View Message](${newMessage.url})`, inline: true });
      }

      await dispatchAuditLog(newMessage.guild, "messageUpdate", embed);
    } catch (err) {
      logger.error("[event:messageUpdate]", err);
    }
  },
};
