import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { canModerateTarget, fetchTargetMember, moderationGuardMessage } from "../moderation/guards.js";
import { replyModError, replyModSuccess } from "../moderation/output.js";
import { dispatchModerationLog } from "../utils/modLogs.js";

export const meta = {
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageNicknames],
  category: "mod",
  deployGlobal: false,
};

export const data = new SlashCommandBuilder()
  .setName("nick")
  .setDescription("Set or clear a nickname")
  .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
  .addStringOption(o => o.setName("nickname").setDescription("New nickname").setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames);

export async function execute(interaction) {
  const user = interaction.options.getUser("user", true);
  const nickname = interaction.options.getString("nickname");
  const member = await fetchTargetMember(interaction.guild, user.id);
  if (!member) {
    await replyModError(interaction, {
      title: "Nickname Update Failed",
      summary: "User is not a member of this guild."
    });
    await dispatchModerationLog(interaction.guild, {
      action: "nick",
      ok: false,
      actorId: interaction.user.id,
      actorTag: interaction.user.tag,
      targetId: user.id,
      targetTag: user.tag,
      reason: nickname || "(clear nickname)",
      summary: "Nickname update failed because target user is not in the guild.",
      commandName: "nick",
      channelId: interaction.channelId
    });
    return;
  }

  const gate = canModerateTarget(interaction, member);
  if (!gate.ok) {
    const failSummary = moderationGuardMessage(gate.reason);
    await replyModError(interaction, {
      title: "Nickname Update Blocked",
      summary: failSummary
    });
    await dispatchModerationLog(interaction.guild, {
      action: "nick",
      ok: false,
      actorId: interaction.user.id,
      actorTag: interaction.user.tag,
      targetId: user.id,
      targetTag: user.tag,
      reason: nickname || "(clear nickname)",
      summary: failSummary,
      commandName: "nick",
      channelId: interaction.channelId
    });
    return;
  }

  try {
    await member.setNickname(nickname || null);
    await replyModSuccess(interaction, {
      title: "Nickname Updated",
      summary: nickname
        ? `Set nickname for **${user.tag}**.`
        : `Cleared nickname for **${user.tag}**.`,
      fields: [
        { name: "User", value: `${user.tag} (${user.id})` },
        { name: "Nickname", value: nickname || "(cleared)" }
      ]
    });
    await dispatchModerationLog(interaction.guild, {
      action: "nick",
      ok: true,
      actorId: interaction.user.id,
      actorTag: interaction.user.tag,
      targetId: user.id,
      targetTag: user.tag,
      reason: nickname || "(clear nickname)",
      summary: nickname ? `Set nickname for ${user.tag}.` : `Cleared nickname for ${user.tag}.`,
      commandName: "nick",
      channelId: interaction.channelId
    });
  } catch (err) {
    const summary = err?.message || "Unable to update nickname.";
    await replyModError(interaction, {
      title: "Nickname Update Failed",
      summary
    });
    await dispatchModerationLog(interaction.guild, {
      action: "nick",
      ok: false,
      actorId: interaction.user.id,
      actorTag: interaction.user.tag,
      targetId: user.id,
      targetTag: user.tag,
      reason: nickname || "(clear nickname)",
      summary,
      commandName: "nick",
      channelId: interaction.channelId
    });
  }
}
