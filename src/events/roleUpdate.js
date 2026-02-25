// src/events/roleUpdate.js
import { EmbedBuilder } from "discord.js";
import { dispatchAuditLog } from "../tools/auditLog/dispatcher.js";
import { logger } from "../utils/logger.js";

export default {
  name: "roleUpdate",
  async execute(oldRole, newRole) {
    try {
      const changes = [];
      if (oldRole.name !== newRole.name) changes.push({ name: "Name", value: `\`${oldRole.name}\` → \`${newRole.name}\``, inline: true });
      if (oldRole.color !== newRole.color) changes.push({ name: "Color", value: `\`${oldRole.hexColor}\` → \`${newRole.hexColor}\``, inline: true });
      if (oldRole.hoist !== newRole.hoist) changes.push({ name: "Hoisted", value: newRole.hoist ? "Yes" : "No", inline: true });
      if (oldRole.mentionable !== newRole.mentionable) changes.push({ name: "Mentionable", value: newRole.mentionable ? "Yes" : "No", inline: true });
      if (!changes.length) return;

      const embed = new EmbedBuilder()
        .setTitle("Role Updated")
        .setColor(newRole.color || 0xFEE75C)
        .addFields({ name: "Role", value: `<@&${newRole.id}> (${newRole.name})`, inline: true }, ...changes)
        .setTimestamp()
        .setFooter({ text: `Role ID: ${newRole.id}` });

      await dispatchAuditLog(newRole.guild, "roleUpdate", embed);
    } catch (err) {
      logger.error("[event:roleUpdate]", err);
    }
  },
};
