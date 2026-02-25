// src/events/roleCreate.js
import { EmbedBuilder } from "discord.js";
import { dispatchAuditLog } from "../tools/auditLog/dispatcher.js";
import { logger } from "../utils/logger.js";

export default {
  name: "roleCreate",
  async execute(role) {
    try {
      const embed = new EmbedBuilder()
        .setTitle("Role Created")
        .setColor(role.color || 0x57F287)
        .addFields(
          { name: "Name", value: role.name, inline: true },
          { name: "ID", value: role.id, inline: true },
          { name: "Color", value: role.hexColor, inline: true },
        )
        .setTimestamp();
      await dispatchAuditLog(role.guild, "roleCreate", embed);
    } catch (err) {
      logger.error("[event:roleCreate]", err);
    }
  },
};
