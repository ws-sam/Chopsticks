import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from "discord.js";
import { canModerateTarget, fetchTargetMember, moderationGuardMessage } from "../moderation/guards.js";
import { notifyUserByDm, reasonOrDefault, replyModError, replyModSuccess, buildModEmbed, replyModEmbed } from "../moderation/output.js";
import { dispatchModerationLog } from "../utils/modLogs.js";
import { addWarning, listWarnings, clearWarnings } from "../utils/moderation.js";
import { replyError, Colors } from "../utils/discordOutput.js";
import { sanitizeString } from "../utils/validation.js";
import { createCase } from "../tools/modcases/store.js";
import { checkEscalation } from "../tools/modcases/escalation.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  deployGlobal: true,
  guildOnly: true,
  category: "mod"
};

const SNOWFLAKE_RE = /^\d{17,19}$/;

function parseMassBanIds(input) {
  return String(input || "")
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export const data = new SlashCommandBuilder()
  .setName("mod")
  .setDescription("Moderation actions")

  // ban
  .addSubcommand(sub =>
    sub.setName("ban")
      .setDescription("Ban a user from this server")
      .addUserOption(o => o.setName("user").setDescription("User to ban").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
      .addIntegerOption(o =>
        o.setName("delete_days").setDescription("Delete message days (0-7)").setMinValue(0).setMaxValue(7)
      )
      .addBooleanOption(o =>
        o.setName("notify_user").setDescription("Attempt to DM user before ban")
      )
  )

  // unban
  .addSubcommand(sub =>
    sub.setName("unban")
      .setDescription("Unban a user by ID")
      .addStringOption(o => o.setName("user_id").setDescription("User ID").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
  )

  // softban
  .addSubcommand(sub =>
    sub.setName("softban")
      .setDescription("Softban a user (ban then immediately unban to clear messages)")
      .addUserOption(o => o.setName("user").setDescription("User to softban").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
      .addIntegerOption(o =>
        o.setName("delete_days").setDescription("Delete message days (0-7)").setMinValue(0).setMaxValue(7)
      )
  )

  // massban
  .addSubcommand(sub =>
    sub.setName("massban")
      .setDescription("Ban multiple users at once by user ID (max 20)")
      .addStringOption(o =>
        o.setName("users").setDescription("Comma or space-separated user IDs (max 20)").setRequired(true)
      )
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
      .addIntegerOption(o =>
        o.setName("delete_days").setDescription("Delete message days (0-7)").setMinValue(0).setMaxValue(7)
      )
  )

  // kick
  .addSubcommand(sub =>
    sub.setName("kick")
      .setDescription("Kick a member from this server")
      .addUserOption(o => o.setName("user").setDescription("User to kick").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
      .addBooleanOption(o =>
        o.setName("notify_user").setDescription("Attempt to DM user before kick")
      )
  )

  // timeout
  .addSubcommand(sub =>
    sub.setName("timeout")
      .setDescription("Timeout a member (0 minutes to clear)")
      .addUserOption(o => o.setName("user").setDescription("User to timeout").setRequired(true))
      .addIntegerOption(o =>
        o.setName("minutes").setDescription("Minutes (0 to clear timeout)").setRequired(true).setMinValue(0).setMaxValue(10080)
      )
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
      .addBooleanOption(o =>
        o.setName("notify_user").setDescription("Attempt to DM user about timeout")
      )
  )

  // warn
  .addSubcommand(sub =>
    sub.setName("warn")
      .setDescription("Warn a user and record the warning")
      .addUserOption(o => o.setName("user").setDescription("User to warn").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
  )

  // warnings (list)
  .addSubcommand(sub =>
    sub.setName("warnings")
      .setDescription("List recorded warnings for a user")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
  )

  // clearwarns
  .addSubcommand(sub =>
    sub.setName("clearwarns")
      .setDescription("Clear all warnings for a user")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
  );

// ─── Permission guards ────────────────────────────────────────────────────────
const BAN_SUBS = new Set(["ban", "unban", "softban", "massban"]);
const KICK_SUBS = new Set(["kick"]);
const MOD_SUBS = new Set(["timeout", "warn", "warnings", "clearwarns"]);

function checkPerm(interaction, sub) {
  if (BAN_SUBS.has(sub) && !interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
    return "You need the **Ban Members** permission to use this action.";
  }
  if (KICK_SUBS.has(sub) && !interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers)) {
    return "You need the **Kick Members** permission to use this action.";
  }
  if (MOD_SUBS.has(sub) && !interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
    return "You need the **Moderate Members** permission to use this action.";
  }
  return null;
}

// ─── Main execute ─────────────────────────────────────────────────────────────
export async function execute(interaction) {
  await withTimeout(interaction, async () => {
  const sub = interaction.options.getSubcommand();

  const permError = checkPerm(interaction, sub);
  if (permError) {
    await replyModError(interaction, { title: "Missing Permissions", summary: permError });
    return;
  }

  // ── ban ──────────────────────────────────────────────────────────────────────
  if (sub === "ban") {
    const user = interaction.options.getUser("user", true);
    const reason = reasonOrDefault(sanitizeString(interaction.options.getString("reason")));
    const deleteDays = interaction.options.getInteger("delete_days") || 0;
    const notifyUser = Boolean(interaction.options.getBoolean("notify_user"));
    const targetMember = await fetchTargetMember(interaction.guild, user.id);

    const gate = canModerateTarget(interaction, targetMember);
    if (!gate.ok) {
      const failSummary = moderationGuardMessage(gate.reason);
      await replyModError(interaction, { title: "Ban Blocked", summary: failSummary });
      await dispatchModerationLog(interaction.guild, {
        action: "ban", ok: false,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary: failSummary, commandName: "mod ban", channelId: interaction.channelId
      });
      return;
    }

    const dmStatus = await notifyUserByDm(
      user,
      `You were banned from **${interaction.guild?.name || "this server"}**.\nReason: ${reason}`,
      { enabled: notifyUser }
    );

    try {
      await interaction.guild.members.ban(user.id, { reason, deleteMessageSeconds: deleteDays * 86400 });
      const banCase = await createCase(interaction.guildId, { type: "ban", userId: user.id, modId: interaction.user.id, reason }).catch(() => null);
      await replyModSuccess(interaction, {
        title: "User Banned",
        summary: `Successfully banned **${user.tag}**.${banCase ? ` Case #${banCase.id}.` : ""}`,
        fields: [
          { name: "User", value: `${user.tag} (${user.id})` },
          { name: "Delete Message Days", value: String(deleteDays), inline: true },
          { name: "DM Notify", value: dmStatus, inline: true },
          { name: "Reason", value: reason }
        ]
      });
      await dispatchModerationLog(interaction.guild, {
        action: "ban", ok: true,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary: `Banned ${user.tag}.`, commandName: "mod ban", channelId: interaction.channelId,
        details: { deleteDays: String(deleteDays), dmNotify: dmStatus }
      });
    } catch (err) {
      const summary = err?.message || "Unable to ban user.";
      await replyModError(interaction, { title: "Ban Failed", summary });
      await dispatchModerationLog(interaction.guild, {
        action: "ban", ok: false,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary, commandName: "mod ban", channelId: interaction.channelId
      });
    }
    return;
  }

  // ── unban ─────────────────────────────────────────────────────────────────────
  if (sub === "unban") {
    const userId = sanitizeString(interaction.options.getString("user_id", true));
    const reason = reasonOrDefault(sanitizeString(interaction.options.getString("reason")));
    try {
      await interaction.guild.members.unban(userId, reason);
      await replyModSuccess(interaction, {
        title: "User Unbanned",
        summary: `Successfully unbanned **${userId}**.`,
        fields: [{ name: "Reason", value: reason }]
      });
      await dispatchModerationLog(interaction.guild, {
        action: "unban", ok: true,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: userId, reason, summary: `Unbanned ${userId}.`, commandName: "mod unban", channelId: interaction.channelId
      });
    } catch (err) {
      const summary = err?.message || "Unable to unban user.";
      await replyModError(interaction, { title: "Unban Failed", summary });
      await dispatchModerationLog(interaction.guild, {
        action: "unban", ok: false,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: userId, reason, summary, commandName: "mod unban", channelId: interaction.channelId
      });
    }
    return;
  }

  // ── softban ───────────────────────────────────────────────────────────────────
  if (sub === "softban") {
    const user = interaction.options.getUser("user", true);
    const reason = reasonOrDefault(sanitizeString(interaction.options.getString("reason")));
    const deleteDays = interaction.options.getInteger("delete_days") || 0;
    const targetMember = await fetchTargetMember(interaction.guild, user.id);
    const gate = canModerateTarget(interaction, targetMember);
    if (!gate.ok) {
      const failSummary = moderationGuardMessage(gate.reason);
      await replyModError(interaction, { title: "Softban Blocked", summary: failSummary });
      await dispatchModerationLog(interaction.guild, {
        action: "softban", ok: false,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary: failSummary, commandName: "mod softban", channelId: interaction.channelId,
        details: { deleteDays: String(deleteDays) }
      });
      return;
    }
    try {
      await interaction.guild.members.ban(user.id, { reason, deleteMessageSeconds: deleteDays * 86400 });
      await interaction.guild.members.unban(user.id, "Softban cleanup");
      const softbanCase = await createCase(interaction.guildId, { type: "ban", userId: user.id, modId: interaction.user.id, reason }).catch(() => null);
      await replyModSuccess(interaction, {
        title: "Softban Complete",
        summary: `Softbanned **${user.tag}** (ban + immediate unban).${softbanCase ? ` Case #${softbanCase.id}.` : ""}`,
        fields: [
          { name: "User", value: `${user.tag} (${user.id})` },
          { name: "Delete Message Days", value: String(deleteDays), inline: true },
          { name: "Reason", value: reason }
        ]
      });
      await dispatchModerationLog(interaction.guild, {
        action: "softban", ok: true,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary: `Softbanned ${user.tag}.`, commandName: "mod softban", channelId: interaction.channelId,
        details: { deleteDays: String(deleteDays) }
      });
    } catch (err) {
      const summary = err?.message || "Unable to softban user.";
      await replyModError(interaction, { title: "Softban Failed", summary });
      await dispatchModerationLog(interaction.guild, {
        action: "softban", ok: false,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary, commandName: "mod softban", channelId: interaction.channelId,
        details: { deleteDays: String(deleteDays) }
      });
    }
    return;
  }

  // ── massban ───────────────────────────────────────────────────────────────────
  if (sub === "massban") {
    const usersInput = sanitizeString(interaction.options.getString("users", true));
    const reason = reasonOrDefault(sanitizeString(interaction.options.getString("reason")));
    const deleteDays = interaction.options.getInteger("delete_days") ?? 0;
    const ids = parseMassBanIds(usersInput);

    const invalid = ids.filter(id => !SNOWFLAKE_RE.test(id));
    if (invalid.length) {
      await replyError(interaction, "Invalid User IDs", `The following are not valid Discord user IDs: ${invalid.join(", ")}`);
      return;
    }
    if (ids.length === 0) {
      await replyError(interaction, "No Users", "Please provide at least one user ID.");
      return;
    }
    if (ids.length > 20) {
      await replyError(interaction, "Too Many Users", `You can only ban up to 20 users at once. Provided: ${ids.length}`);
      return;
    }

    const successes = [];
    const failures = [];

    await interaction.deferReply({ ephemeral: true });

    for (const userId of ids) {
      if (userId === interaction.user.id) {
        failures.push({ id: userId, reason: "Cannot ban yourself" });
        continue;
      }
      const targetMember = await fetchTargetMember(interaction.guild, userId);
      const gate = canModerateTarget(interaction, targetMember);
      if (!gate.ok) {
        failures.push({ id: userId, reason: moderationGuardMessage(gate.reason) });
        await dispatchModerationLog(interaction.guild, {
          action: "ban", ok: false,
          actorId: interaction.user.id, actorTag: interaction.user.tag,
          targetId: userId, targetTag: targetMember?.user?.tag ?? userId,
          reason, summary: moderationGuardMessage(gate.reason), commandName: "mod massban", channelId: interaction.channelId
        });
        continue;
      }
      try {
        await interaction.guild.members.ban(userId, { reason, deleteMessageSeconds: deleteDays * 86400 });
        successes.push(userId);
        await dispatchModerationLog(interaction.guild, {
          action: "ban", ok: true,
          actorId: interaction.user.id, actorTag: interaction.user.tag,
          targetId: userId, targetTag: targetMember?.user?.tag ?? userId,
          reason, summary: `Mass banned ${userId}.`, commandName: "mod massban", channelId: interaction.channelId,
          details: { deleteDays: String(deleteDays) }
        });
      } catch (err) {
        failures.push({ id: userId, reason: err?.message || "Ban failed" });
        await dispatchModerationLog(interaction.guild, {
          action: "ban", ok: false,
          actorId: interaction.user.id, actorTag: interaction.user.tag,
          targetId: userId, targetTag: targetMember?.user?.tag ?? userId,
          reason, summary: err?.message || "Ban failed", commandName: "mod massban", channelId: interaction.channelId
        });
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`Mass Ban — ${successes.length}/${ids.length} users banned`)
      .setColor(successes.length === ids.length ? Colors.Success : failures.length === ids.length ? Colors.Error : Colors.Warning)
      .setTimestamp();
    if (successes.length) embed.addFields({ name: "✅ Banned", value: successes.map(id => `\`${id}\``).join("\n").slice(0, 1024) });
    if (failures.length) embed.addFields({ name: "❌ Failed", value: failures.map(f => `\`${f.id}\`: ${f.reason}`).join("\n").slice(0, 1024) });
    embed.addFields({ name: "Reason", value: reason });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── kick ──────────────────────────────────────────────────────────────────────
  if (sub === "kick") {
    const user = interaction.options.getUser("user", true);
    const reason = reasonOrDefault(sanitizeString(interaction.options.getString("reason")));
    const notifyUser = Boolean(interaction.options.getBoolean("notify_user"));
    const member = await fetchTargetMember(interaction.guild, user.id);
    if (!member) {
      await replyModError(interaction, { title: "Kick Failed", summary: "User is not a member of this guild." });
      await dispatchModerationLog(interaction.guild, {
        action: "kick", ok: false,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary: "Target user is not in the guild.", commandName: "mod kick", channelId: interaction.channelId
      });
      return;
    }
    const gate = canModerateTarget(interaction, member);
    if (!gate.ok) {
      const failSummary = moderationGuardMessage(gate.reason);
      await replyModError(interaction, { title: "Kick Blocked", summary: failSummary });
      await dispatchModerationLog(interaction.guild, {
        action: "kick", ok: false,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary: failSummary, commandName: "mod kick", channelId: interaction.channelId
      });
      return;
    }
    const dmStatus = await notifyUserByDm(
      user,
      `You were kicked from **${interaction.guild?.name || "this server"}**.\nReason: ${reason}`,
      { enabled: notifyUser }
    );
    try {
      await member.kick(reason);
      const kickCase = await createCase(interaction.guildId, { type: "kick", userId: user.id, modId: interaction.user.id, reason }).catch(() => null);
      await replyModSuccess(interaction, {
        title: "User Kicked",
        summary: `Successfully kicked **${user.tag}**.${kickCase ? ` Case #${kickCase.id}.` : ""}`,
        fields: [
          { name: "User", value: `${user.tag} (${user.id})` },
          { name: "DM Notify", value: dmStatus, inline: true },
          { name: "Reason", value: reason }
        ]
      });
      await dispatchModerationLog(interaction.guild, {
        action: "kick", ok: true,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary: `Kicked ${user.tag}.`, commandName: "mod kick", channelId: interaction.channelId,
        details: { dmNotify: dmStatus }
      });
    } catch (err) {
      const summary = err?.message || "Unable to kick user.";
      await replyModError(interaction, { title: "Kick Failed", summary });
      await dispatchModerationLog(interaction.guild, {
        action: "kick", ok: false,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary, commandName: "mod kick", channelId: interaction.channelId
      });
    }
    return;
  }

  // ── timeout ───────────────────────────────────────────────────────────────────
  if (sub === "timeout") {
    const user = interaction.options.getUser("user", true);
    const minutes = interaction.options.getInteger("minutes", true);
    const reason = reasonOrDefault(sanitizeString(interaction.options.getString("reason")));
    const notifyUser = Boolean(interaction.options.getBoolean("notify_user"));
    const member = await fetchTargetMember(interaction.guild, user.id);
    if (!member) {
      await replyModError(interaction, { title: "Timeout Failed", summary: "User is not a member of this guild." });
      await dispatchModerationLog(interaction.guild, {
        action: "timeout", ok: false,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary: "Target user is not in the guild.", commandName: "mod timeout", channelId: interaction.channelId,
        details: { minutes: String(minutes) }
      });
      return;
    }
    const gate = canModerateTarget(interaction, member);
    if (!gate.ok) {
      const failSummary = moderationGuardMessage(gate.reason);
      await replyModError(interaction, { title: "Timeout Blocked", summary: failSummary });
      await dispatchModerationLog(interaction.guild, {
        action: "timeout", ok: false,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary: failSummary, commandName: "mod timeout", channelId: interaction.channelId,
        details: { minutes: String(minutes) }
      });
      return;
    }
    let dmMessage = "";
    if (notifyUser) {
      dmMessage = minutes === 0
        ? `Your timeout was cleared in **${interaction.guild?.name || "this server"}**.`
        : `You were timed out in **${interaction.guild?.name || "this server"}** for ${minutes} minute(s).\nReason: ${reason}`;
    }
    const dmStatus = await notifyUserByDm(user, dmMessage, { enabled: notifyUser });
    const ms = minutes === 0 ? null : minutes * 60 * 1000;
    try {
      await member.timeout(ms, reason);
      if (minutes > 0) {
        await createCase(interaction.guildId, { type: "mute", userId: user.id, modId: interaction.user.id, reason, duration: ms }).catch(() => null);
      }
      await replyModSuccess(interaction, {
        title: minutes === 0 ? "Timeout Cleared" : "User Timed Out",
        summary: minutes === 0
          ? `Cleared timeout for **${user.tag}**.`
          : `Timed out **${user.tag}** for **${minutes} minute(s)**.`,
        fields: [
          { name: "User", value: `${user.tag} (${user.id})` },
          { name: "DM Notify", value: dmStatus, inline: true },
          { name: "Reason", value: reason }
        ]
      });
      await dispatchModerationLog(interaction.guild, {
        action: "timeout", ok: true,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason,
        summary: minutes === 0 ? `Cleared timeout for ${user.tag}.` : `Timed out ${user.tag} for ${minutes} minute(s).`,
        commandName: "mod timeout", channelId: interaction.channelId,
        details: { minutes: String(minutes), dmNotify: dmStatus }
      });
    } catch (err) {
      const summary = err?.message || "Unable to apply timeout.";
      await replyModError(interaction, { title: "Timeout Failed", summary });
      await dispatchModerationLog(interaction.guild, {
        action: "timeout", ok: false,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary, commandName: "mod timeout", channelId: interaction.channelId,
        details: { minutes: String(minutes) }
      });
    }
    return;
  }

  // ── warn ──────────────────────────────────────────────────────────────────────
  if (sub === "warn") {
    const user = interaction.options.getUser("user", true);
    const reason = reasonOrDefault(sanitizeString(interaction.options.getString("reason")));
    const targetMember = await fetchTargetMember(interaction.guild, user.id);
    const gate = canModerateTarget(interaction, targetMember);
    if (!gate.ok) {
      const failSummary = moderationGuardMessage(gate.reason);
      await replyModError(interaction, { title: "Warn Blocked", summary: failSummary });
      await dispatchModerationLog(interaction.guild, {
        action: "warn", ok: false,
        actorId: interaction.user.id, actorTag: interaction.user.tag,
        targetId: user.id, targetTag: user.tag,
        reason, summary: failSummary, commandName: "mod warn", channelId: interaction.channelId
      });
      return;
    }
    const list = await addWarning(interaction.guildId, user.id, interaction.user.id, reason);

    // Create mod case
    const modCase = await createCase(interaction.guildId, {
      type: "warn", userId: user.id, modId: interaction.user.id, reason,
    }).catch(() => null);

    // Check escalation
    const escalation = await checkEscalation(interaction.guildId, user.id).catch(() => null);
    const escalationNote = escalation ? `\n> Escalation triggered: **${escalation.action}** — execute manually or enable auto-escalation.` : "";

    await replyModSuccess(interaction, {
      title: "User Warned",
      summary: `Warning recorded for **${user.tag}**.${modCase ? ` Case #${modCase.id}.` : ""}${escalationNote}`,
      fields: [
        { name: "User", value: `${user.tag} (${user.id})` },
        { name: "Total Warnings", value: String(list.length), inline: true },
        { name: "Reason", value: reason }
      ]
    });
    await dispatchModerationLog(interaction.guild, {
      action: "warn", ok: true,
      actorId: interaction.user.id, actorTag: interaction.user.tag,
      targetId: user.id, targetTag: user.tag,
      reason, summary: `Warning added for ${user.tag}.`, commandName: "mod warn", channelId: interaction.channelId,
      details: { totalWarnings: String(list.length) }
    });
    return;
  }

  // ── warnings ──────────────────────────────────────────────────────────────────
  if (sub === "warnings") {
    const user = interaction.options.getUser("user", true);
    const list = await listWarnings(interaction.guildId, user.id);
    if (list.length === 0) {
      await replyModEmbed(interaction, {
        embeds: [buildModEmbed({
          title: "Warnings",
          summary: `No warnings found for **${user.tag}**.`,
          fields: [{ name: "User", value: `${user.tag} (${user.id})` }],
          actor: interaction.user?.tag || interaction.user?.username
        })]
      });
      return;
    }
    const lines = list.slice(0, 10).map((w, i) => {
      const when = w.at ? `<t:${Math.floor(w.at / 1000)}:R>` : "unknown";
      return `${i + 1}. ${when} by <@${w.by}> - ${w.reason}`;
    });
    await replyModEmbed(interaction, {
      embeds: [buildModEmbed({
        title: "Warnings",
        summary: `Showing ${Math.min(list.length, 10)} of ${list.length} warnings for **${user.tag}**.`,
        fields: [
          { name: "User", value: `${user.tag} (${user.id})` },
          { name: "Warning Log", value: lines.join("\n") }
        ],
        actor: interaction.user?.tag || interaction.user?.username
      })]
    });
    return;
  }

  // ── clearwarns ────────────────────────────────────────────────────────────────
  if (sub === "clearwarns") {
    const user = interaction.options.getUser("user", true);
    await clearWarnings(interaction.guildId, user.id);
    await replyModSuccess(interaction, {
      title: "Warnings Cleared",
      summary: `Cleared all warnings for **${user.tag}**.`,
      fields: [{ name: "User", value: `${user.tag} (${user.id})` }]
    });
    await dispatchModerationLog(interaction.guild, {
      action: "clearwarns", ok: true,
      actorId: interaction.user.id, actorTag: interaction.user.tag,
      targetId: user.id, targetTag: user.tag,
      reason: "Warnings reset by moderator.",
      summary: `Warnings cleared for ${user.tag}.`,
      commandName: "mod clearwarns", channelId: interaction.channelId
    });
    return;
  }
  }, { label: "mod" });
}
