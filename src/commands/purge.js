import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import { buildModEmbed, replyModEmbed, replyModError, sanitizeText } from "../moderation/output.js";
import { dispatchModerationLog } from "../utils/modLogs.js";
import { withTimeout } from "../utils/interactionTimeout.js";

const PURGE_UI_PREFIX = "purgeui";
const PURGE_TTL_MS = 10 * 60_000;
const MAX_SCAN_MESSAGES = 2500;
const MAX_PURGE_COUNT = 500;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

const pendingPurges = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [token, req] of pendingPurges.entries()) {
    if (now - req.createdAt > PURGE_TTL_MS) pendingPurges.delete(token);
  }
}, 60_000).unref?.();

function makeToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function uiId(action, userId, token) {
  return `${PURGE_UI_PREFIX}:${action}:${userId}:${token}`;
}

function parseUiId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length !== 4 || parts[0] !== PURGE_UI_PREFIX) return null;
  return {
    action: parts[1],
    userId: parts[2],
    token: parts[3]
  };
}

function hasLink(content) {
  return /(https?:\/\/|discord\.gg\/|www\.)/i.test(String(content || ""));
}

function normalizeFilters(interaction) {
  const count = Math.max(1, Math.min(MAX_PURGE_COUNT, interaction.options.getInteger("count", true)));
  const user = interaction.options.getUser("user");
  const contains = sanitizeText(interaction.options.getString("contains") || "", 120);
  const hasLinks = interaction.options.getBoolean("has_links");
  const hasAttachments = interaction.options.getBoolean("has_attachments");
  const botsOnly = interaction.options.getBoolean("bots_only");
  const includePinned = Boolean(interaction.options.getBoolean("include_pinned"));
  const dryRun = Boolean(interaction.options.getBoolean("dry_run"));
  const publicResult = Boolean(interaction.options.getBoolean("public_result"));

  return {
    count,
    userId: user?.id || null,
    userTag: user?.tag || null,
    contains,
    hasLinks,
    hasAttachments,
    botsOnly,
    includePinned,
    dryRun,
    publicResult
  };
}

function matchesFilters(message, filters) {
  if (!filters.includePinned && message.pinned) return false;
  if (filters.userId && message.author?.id !== filters.userId) return false;
  if (filters.botsOnly === true && !message.author?.bot) return false;
  if (filters.hasLinks === true && !hasLink(message.content)) return false;
  if (filters.hasAttachments === true && (message.attachments?.size || 0) === 0) return false;
  if (filters.contains && !String(message.content || "").toLowerCase().includes(filters.contains.toLowerCase())) return false;
  return true;
}

function filterSummary(filters) {
  const list = [];
  list.push(`count=${filters.count}`);
  if (filters.userTag) list.push(`user=${filters.userTag}`);
  if (filters.contains) list.push(`contains="${filters.contains}"`);
  if (filters.hasLinks === true) list.push("links=true");
  if (filters.hasAttachments === true) list.push("attachments=true");
  if (filters.botsOnly === true) list.push("bots_only=true");
  if (filters.includePinned) list.push("include_pinned=true");
  return list.join(" | ");
}

async function collectCandidates(channel, filters) {
  const candidates = [];
  let scanned = 0;
  let before = null;
  const targetCount = filters.count;
  const scanBudget = Math.min(MAX_SCAN_MESSAGES, Math.max(targetCount * 8, 150));

  while (candidates.length < targetCount && scanned < scanBudget) {
    const remaining = scanBudget - scanned;
    const limit = Math.max(1, Math.min(100, remaining));
    const batch = await channel.messages.fetch({ limit, before }).catch(() => null);
    if (!batch?.size) break;

    scanned += batch.size;
    for (const message of batch.values()) {
      if (matchesFilters(message, filters)) {
        candidates.push(message);
        if (candidates.length >= targetCount) break;
      }
    }

    before = batch.last()?.id;
    if (!before) break;
  }

  return { scanned, candidates: candidates.slice(0, targetCount) };
}

function splitByAge(messages) {
  const cutoff = Date.now() - FOURTEEN_DAYS_MS;
  const younger = [];
  const older = [];
  for (const m of messages) {
    if (!m?.id) continue;
    if (Number(m.createdTimestamp || 0) >= cutoff) younger.push(m);
    else older.push(m);
  }
  return { younger, older };
}

async function deleteMessages(channel, messages) {
  const { younger, older } = splitByAge(messages);
  let deleted = 0;
  let failed = 0;

  if (younger.length >= 2) {
    const ids = younger.map(m => m.id);
    const out = await channel.bulkDelete(ids, true).catch(() => null);
    if (out?.size !== undefined) {
      deleted += out.size;
    } else {
      for (const msg of younger) {
        const ok = await msg.delete().then(() => true).catch(() => false);
        if (ok) deleted += 1;
        else failed += 1;
      }
    }
  } else if (younger.length === 1) {
    const ok = await younger[0].delete().then(() => true).catch(() => false);
    if (ok) deleted += 1;
    else failed += 1;
  }

  for (const msg of older) {
    const ok = await msg.delete().then(() => true).catch(() => false);
    if (ok) deleted += 1;
    else failed += 1;
  }

  return { deleted, failed, younger: younger.length, older: older.length };
}

function buildStatusEmbed(title, summary, requestedBy) {
  return buildModEmbed({ title, summary, actor: requestedBy });
}

function buildPreviewEmbed({ filters, scanned, matched, younger, older, requestedBy }) {
  return buildModEmbed({
    title: "Purge Preview",
    summary: "Review this purge request before confirming.",
    fields: [
      { name: "Filters", value: filterSummary(filters) || "none" },
      { name: "Scanned", value: String(scanned), inline: true },
      { name: "Matched", value: String(matched), inline: true },
      { name: "Eligible (<14d)", value: String(younger), inline: true },
      { name: "Old (>14d)", value: String(older), inline: true },
      { name: "Requested By", value: requestedBy, inline: true }
    ],
    actor: requestedBy
  });
}

function buildResultEmbed({ filters, scanned, matched, result, requestedBy }) {
  return buildModEmbed({
    title: "Purge Completed",
    summary: "Messages were removed successfully.",
    fields: [
      { name: "Filters", value: filterSummary(filters) || "none" },
      { name: "Scanned", value: String(scanned), inline: true },
      { name: "Matched", value: String(matched), inline: true },
      { name: "Deleted", value: String(result.deleted), inline: true },
      { name: "Failed", value: String(result.failed), inline: true },
      { name: "Bulk Eligible", value: String(result.younger), inline: true },
      { name: "Manual Deletes", value: String(result.older), inline: true }
    ],
    actor: requestedBy
  });
}

function buildCanceledEmbed(requestedBy) {
  return buildStatusEmbed("Purge Canceled", "No messages were deleted.", requestedBy);
}

function buildExpiredEmbed(requestedBy) {
  return buildStatusEmbed("Purge Request Expired", "The preview expired. Run `/purge` again.", requestedBy);
}

function buildProcessingEmbed(requestedBy) {
  return buildStatusEmbed("Purge In Progress", "Deleting matched messages...", requestedBy);
}

function previewComponents(requesterId, token) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(uiId("confirm", requesterId, token))
        .setStyle(ButtonStyle.Danger)
        .setLabel("Confirm Purge"),
      new ButtonBuilder()
        .setCustomId(uiId("cancel", requesterId, token))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Cancel")
    )
  ];
}

export const meta = {
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageMessages],
  category: "mod"
};

export const data = new SlashCommandBuilder()
  .setName("purge")
  .setDescription("Delete messages with robust filters and confirmation")
  .addIntegerOption(o =>
    o
      .setName("count")
      .setDescription("How many matching messages to delete (1-500)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_PURGE_COUNT)
  )
  .addUserOption(o => o.setName("user").setDescription("Only purge messages from this user"))
  .addStringOption(o => o.setName("contains").setDescription("Only purge messages containing this text"))
  .addBooleanOption(o => o.setName("has_links").setDescription("Only purge messages that contain links"))
  .addBooleanOption(o => o.setName("has_attachments").setDescription("Only purge messages with attachments"))
  .addBooleanOption(o => o.setName("bots_only").setDescription("Only purge bot messages"))
  .addBooleanOption(o => o.setName("include_pinned").setDescription("Include pinned messages in matches"))
  .addBooleanOption(o => o.setName("dry_run").setDescription("Preview only, do not delete"))
  .addBooleanOption(o => o.setName("public_result").setDescription("Post result publicly instead of ephemeral"))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export async function execute(interaction) {
  const channel = interaction.channel;
  if (!channel || !channel.messages?.fetch || !channel.bulkDelete) {
    await replyModError(interaction, {
      title: "Purge Unsupported",
      summary: "This channel does not support purge operations."
    });
    await dispatchModerationLog(interaction.guild, {
      action: "purge",
      ok: false,
      actorId: interaction.user.id,
      actorTag: interaction.user.tag,
      reason: "Unsupported channel type",
      summary: "Purge blocked because channel does not support message deletion.",
      commandName: "purge",
      channelId: interaction.channelId
    });
    return;
  }

  const filters = normalizeFilters(interaction);
  await interaction.deferReply({
    flags: filters.publicResult ? undefined : MessageFlags.Ephemeral
  });

  await withTimeout(interaction, async () => {

    const { scanned, candidates } = await collectCandidates(channel, filters);
    const split = splitByAge(candidates);
    const matched = candidates.length;
    const requestedBy = interaction.user?.tag || interaction.user?.username || "unknown";

    if (!matched) {
      await replyModEmbed(interaction, {
        embeds: [buildModEmbed({
          title: "Purge Preview",
          summary: "No messages matched your filters.",
          fields: [
            { name: "Filters", value: filterSummary(filters) || "none" },
            { name: "Scanned", value: String(scanned), inline: true },
            { name: "Matched", value: "0", inline: true }
          ],
          actor: requestedBy
        })]
      }, { ephemeral: !filters.publicResult });
      return;
    }

    const preview = buildPreviewEmbed({
      filters,
      scanned,
      matched,
      younger: split.younger.length,
      older: split.older.length,
      requestedBy
    });

    if (filters.dryRun) {
      await replyModEmbed(interaction, { embeds: [preview] }, { ephemeral: !filters.publicResult });
      return;
    }

    const token = makeToken();
    pendingPurges.set(token, {
      token,
      createdAt: Date.now(),
      requesterId: interaction.user.id,
      requestedBy,
      channelId: channel.id,
      guildId: interaction.guildId,
      messageIds: candidates.map(m => m.id),
      scanned,
      matched,
      filters,
      publicResult: filters.publicResult
    });

    await replyModEmbed(
      interaction,
      {
        embeds: [preview],
        components: previewComponents(interaction.user.id, token)
      },
      { ephemeral: !filters.publicResult }
    );
  }, { label: "purge" });
}

export async function handleButton(interaction) {
  if (!interaction.isButton?.()) return false;
  const parsed = parseUiId(interaction.customId);
  if (!parsed) return false;

  const request = pendingPurges.get(parsed.token);

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({
      embeds: [buildModEmbed({ title: "Not Authorized", summary: "Only the moderator who created this purge preview can use these buttons." })],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (!request || (Date.now() - request.createdAt > PURGE_TTL_MS)) {
    pendingPurges.delete(parsed.token);
    await interaction.update({
      embeds: [buildExpiredEmbed(interaction.user?.tag || interaction.user?.username || "unknown")],
      components: []
    });
    return true;
  }

  if (parsed.action === "cancel") {
    pendingPurges.delete(parsed.token);
    await interaction.update({
      embeds: [buildCanceledEmbed(request.requestedBy)],
      components: []
    });
    return true;
  }

  if (parsed.action !== "confirm") return true;

  pendingPurges.delete(parsed.token);
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [buildProcessingEmbed(request.requestedBy)], components: [] });

  const channel = await interaction.client.channels.fetch(request.channelId).catch(() => null);
  if (!channel || !channel.messages?.fetch) {
    await interaction.editReply({
      embeds: [buildModEmbed({
        title: "Purge Failed",
        summary: "Channel is no longer available or cannot fetch messages.",
        actor: request.requestedBy,
        color: 0xED4245
      })]
    });
    await dispatchModerationLog(interaction.guild, {
      action: "purge",
      ok: false,
      actorId: interaction.user.id,
      actorTag: interaction.user.tag,
      reason: "Channel unavailable",
      summary: "Purge failed because the target channel was unavailable.",
      commandName: "purge",
      channelId: request.channelId
    });
    return true;
  }

  const messages = [];
  for (const id of request.messageIds) {
    const msg = await channel.messages.fetch(id).catch(() => null);
    if (msg) messages.push(msg);
  }

  const result = await deleteMessages(channel, messages);
  const embed = buildResultEmbed({
    filters: request.filters,
    scanned: request.scanned,
    matched: request.matched,
    result,
    requestedBy: request.requestedBy
  });

  await interaction.editReply({ embeds: [embed], components: [] });
  await dispatchModerationLog(interaction.guild, {
    action: "purge",
    ok: true,
    actorId: interaction.user.id,
    actorTag: interaction.user.tag,
    reason: "Filtered purge run",
    summary: `Purge removed ${result.deleted} message(s).`,
    commandName: "purge",
    channelId: request.channelId,
    details: {
      matched: String(request.matched),
      deleted: String(result.deleted),
      failed: String(result.failed)
    }
  });
  return true;
}
