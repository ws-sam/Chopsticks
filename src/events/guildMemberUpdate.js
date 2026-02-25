// src/events/guildMemberUpdate.js
import { EmbedBuilder } from "discord.js";
import { dispatchAuditLog } from "../tools/auditLog/dispatcher.js";
import { logger } from "../utils/logger.js";

export default {
  name: "guildMemberUpdate",
  async execute(oldMember, newMember) {
    try {
      const changes = [];

      if (oldMember.nickname !== newMember.nickname) {
        changes.push({ name: "Nickname", value: `\`${oldMember.nickname ?? "(none)"}\` → \`${newMember.nickname ?? "(none)"}\`` });
      }
      const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
      if (added.size) changes.push({ name: "Roles Added", value: added.map(r => `<@&${r.id}>`).join(", ") });
      const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
      if (removed.size) changes.push({ name: "Roles Removed", value: removed.map(r => `<@&${r.id}>`).join(", ") });

      const wasTimedOut = !!oldMember.communicationDisabledUntil && oldMember.communicationDisabledUntilTimestamp > Date.now();
      const isTimedOut  = !!newMember.communicationDisabledUntil && newMember.communicationDisabledUntilTimestamp > Date.now();
      if (!wasTimedOut && isTimedOut) changes.push({ name: "Timeout", value: `Until <t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:F>` });
      if (wasTimedOut && !isTimedOut) changes.push({ name: "Timeout Removed", value: "Member can communicate again" });

      if (!changes.length) return;

      const embed = new EmbedBuilder()
        .setTitle("Member Updated")
        .setColor(0x5865F2)
        .addFields({ name: "Member", value: `<@${newMember.id}> (${newMember.user.tag})`, inline: true }, ...changes)
        .setThumbnail(newMember.user.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: `User ID: ${newMember.id}` });

      await dispatchAuditLog(newMember.guild, "guildMemberUpdate", embed);
    } catch (err) {
      logger.error("[event:guildMemberUpdate]", err);
    }
  },
};
