import {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import { Colors } from "../utils/discordOutput.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { auditLog } from "../utils/audit.js";
import { dispatchModerationLog } from "../utils/modLogs.js";
import {
  TICKET_TYPES,
  normalizeTicketsConfig,
  parseUiId,
  uiId,
  panelComponents,
  closeTicketButton,
  buildPanelEmbed,
  buildTicketTopic,
  parseTicketTopic,
  formatTicketChannelName,
  buildTicketWelcomeEmbed,
  buildTicketStatusEmbed,
  buildTicketLogEmbed,
  buildTicketPermissionOverwrites,
  canManageTickets,
  canCloseTicket,
  ensureTicketCategory,
  countOpenTicketsInCategory,
  findOpenTicketForOwner,
  ticketTypeLabel
} from "../utils/tickets.js";

const TYPE_KEYS = new Set(TICKET_TYPES.map(t => t.key));

export const meta = {
  deployGlobal: true,
  guildOnly: true,
  category: "tools"
};

export const data = new SlashCommandBuilder()
  .setName("tickets")
  .setDescription("Support ticket system with panel, private channels, and transcripts")
  .addSubcommand(sub =>
    sub
      .setName("setup")
      .setDescription("Configure ticket system settings")
      .addChannelOption(o =>
        o
          .setName("category")
          .setDescription("Category where ticket channels are created")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
      .addChannelOption(o =>
        o
          .setName("panel_channel")
          .setDescription("Channel to post ticket panel")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      )
      .addChannelOption(o =>
        o
          .setName("log_channel")
          .setDescription("Channel to post ticket logs/transcripts")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      )
      .addRoleOption(o =>
        o
          .setName("support_role")
          .setDescription("Role that can access and manage tickets")
          .setRequired(false)
      )
      .addBooleanOption(o =>
        o
          .setName("transcript_on_close")
          .setDescription("Generate transcript attachment when closing tickets")
          .setRequired(false)
      )
      .addBooleanOption(o =>
        o
          .setName("enabled")
          .setDescription("Enable ticket system after setup")
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("panel")
      .setDescription("Send or refresh the ticket panel")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Channel to post panel (defaults to configured panel channel)")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false)
      )
  )
  .addSubcommand(sub => sub.setName("status").setDescription("Show ticket configuration and open count"))
  .addSubcommand(sub =>
    sub
      .setName("open")
      .setDescription("Open a support ticket")
      .addStringOption(o =>
        o
          .setName("type")
          .setDescription("Ticket type")
          .setRequired(false)
          .addChoices(...TICKET_TYPES.map(type => ({ name: type.label, value: type.key })))
      )
      .addStringOption(o =>
        o
          .setName("subject")
          .setDescription("Short subject for this ticket")
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("close")
      .setDescription("Close an active ticket")
      .addChannelOption(o =>
        o
          .setName("channel")
          .setDescription("Target ticket channel (defaults to current channel)")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)
      )
      .addStringOption(o =>
        o
          .setName("reason")
          .setDescription("Closure reason")
          .setRequired(false)
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function createEmbed(title, description, color = Colors.INFO) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(String(description || ""))
    .setColor(color)
    .setTimestamp();
}

async function replyEphemeral(interaction, payload) {
  if (interaction.deferred) {
    await interaction.editReply(payload);
    return;
  }
  if (interaction.replied) {
    await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function postTicketLog(guild, cfg, payload) {
  if (!cfg.logChannelId) return false;
  const channel = guild.channels.cache.get(cfg.logChannelId) || await guild.channels.fetch(cfg.logChannelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== "function") return false;
  await channel.send(payload).catch(() => null);
  return true;
}

async function saveTicketConfig(guildId, guildData) {
  normalizeTicketsConfig(guildData);
  await saveGuildData(guildId, guildData);
}

async function requireManageGuild(interaction) {
  if (canManageTickets(interaction)) return true;
  await replyEphemeral(interaction, {
    embeds: [createEmbed("Permission Required", "You need `Manage Server` to run this subcommand.", Colors.ERROR)]
  });
  return false;
}

async function createTicket(interaction, guildData, { typeKey = "support", subject = "", source = "slash" } = {}) {
  const guild = interaction.guild;
  normalizeTicketsConfig(guildData);
  const cfg = guildData.tickets;

  if (!cfg.enabled) {
    return { ok: false, reason: "disabled", message: "Ticket system is disabled in this server." };
  }

  if (!cfg.categoryId) {
    return { ok: false, reason: "missing-category", message: "Ticket category is not configured. Ask an admin to run `/tickets setup`." };
  }

  const category = guild.channels.cache.get(cfg.categoryId) || await guild.channels.fetch(cfg.categoryId).catch(() => null);
  if (!ensureTicketCategory(category)) {
    return { ok: false, reason: "bad-category", message: "Configured ticket category is invalid or missing." };
  }

  const existing = await findOpenTicketForOwner(guild, cfg.categoryId, interaction.user.id);
  if (existing) {
    return {
      ok: true,
      created: false,
      channel: existing,
      message: `You already have an open ticket: <#${existing.id}>.`
    };
  }

  const nextCounter = Math.max(1, Number(cfg.counter || 0) + 1);
  const normalizedType = TYPE_KEYS.has(String(typeKey || "").toLowerCase()) ? String(typeKey).toLowerCase() : "support";
  const name = formatTicketChannelName(nextCounter, normalizedType);
  const permissionOverwrites = buildTicketPermissionOverwrites({
    guild,
    ownerId: interaction.user.id,
    supportRoleId: cfg.supportRoleId
  });

  const topic = buildTicketTopic({
    ownerId: interaction.user.id,
    status: "open",
    createdAt: Date.now(),
    type: normalizedType
  });

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: cfg.categoryId,
    topic,
    permissionOverwrites,
    reason: `Ticket opened by ${interaction.user.tag} via ${source}`
  });

  cfg.counter = nextCounter;
  await saveTicketConfig(guild.id, guildData);

  const subjectValue = String(subject || "").trim();
  const introEmbed = buildTicketWelcomeEmbed({
    ownerId: interaction.user.id,
    typeKey: normalizedType,
    createdByTag: interaction.user.tag
  });
  if (subjectValue) {
    introEmbed.addFields({ name: "Subject", value: subjectValue.slice(0, 200) });
  }

  await channel.send({
    content: cfg.supportRoleId ? `<@&${cfg.supportRoleId}> <@${interaction.user.id}>` : `<@${interaction.user.id}>`,
    embeds: [introEmbed],
    components: [closeTicketButton()]
  }).catch(() => null);

  await auditLog({
    guildId: guild.id,
    userId: interaction.user.id,
    action: "ticket.open",
    details: {
      channelId: channel.id,
      type: normalizedType,
      subject: subjectValue || null,
      source
    }
  });

  await dispatchModerationLog(guild, {
    action: "ticket",
    ok: true,
    actorId: interaction.user.id,
    actorTag: interaction.user.tag,
    targetId: interaction.user.id,
    targetTag: interaction.user.tag,
    reason: `open:${normalizedType}`,
    summary: `Ticket opened in #${channel.name}.`,
    commandName: "tickets",
    channelId: channel.id,
    details: {
      source,
      type: normalizedType
    }
  });

  await postTicketLog(guild, cfg, {
    embeds: [
      buildTicketLogEmbed({
        title: "Ticket Opened",
        summary: `A new ticket was opened by <@${interaction.user.id}> in <#${channel.id}>.`,
        color: Colors.SUCCESS,
        fields: [
          { name: "Type", value: ticketTypeLabel(normalizedType), inline: true },
          { name: "Source", value: source, inline: true },
          { name: "Owner", value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
          { name: "Subject", value: subjectValue || "(none)", inline: false }
        ]
      })
    ]
  });

  return {
    ok: true,
    created: true,
    channel,
    message: `Ticket created: <#${channel.id}>.`
  };
}

async function createTranscriptAttachment(channel, closerTag) {
  const lines = [];
  let before = null;
  let fetched = 0;
  const limitMessages = 500;

  while (fetched < limitMessages) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    fetched += batch.size;
    const items = Array.from(batch.values());
    for (const msg of items) {
      const stamp = new Date(msg.createdTimestamp || Date.now()).toISOString();
      const author = msg.author?.tag || msg.author?.id || "unknown";
      const content = String(msg.content || "").replace(/\r?\n/g, " ").trim() || "(no text)";
      const attachments = (msg.attachments?.size || 0)
        ? ` attachments=${Array.from(msg.attachments.values()).map(a => a.url).join(",")}`
        : "";
      lines.push(`[${stamp}] ${author}: ${content}${attachments}`);
    }
    before = batch.last()?.id;
    if (!before || batch.size < 100) break;
  }

  lines.reverse();
  lines.unshift(`# Ticket Transcript`);
  lines.unshift(`# Closed by: ${closerTag}`);
  lines.unshift(`# Channel: ${channel.name} (${channel.id})`);

  const body = lines.join("\n").slice(0, 900_000);
  const file = new AttachmentBuilder(Buffer.from(body, "utf8"), {
    name: `ticket-${channel.id}-transcript.txt`
  });
  return file;
}

async function closeTicket(interaction, guildData, { channel, reason = "No reason provided.", source = "slash" } = {}) {
  normalizeTicketsConfig(guildData);
  const cfg = guildData.tickets;
  const ticketMeta = parseTicketTopic(channel?.topic);
  if (!ticketMeta) {
    return { ok: false, reason: "not-ticket", message: "This is not a managed ticket channel." };
  }
  if (ticketMeta.status === "closed") {
    return { ok: false, reason: "already-closed", message: "This ticket is already closed." };
  }

  const canClose = canCloseTicket({
    interaction,
    ownerId: ticketMeta.ownerId,
    supportRoleId: cfg.supportRoleId
  });
  if (!canClose) {
    return { ok: false, reason: "forbidden", message: "You do not have permission to close this ticket." };
  }

  const transcript = cfg.transcriptOnClose
    ? await createTranscriptAttachment(channel, interaction.user.tag).catch(() => null)
    : null;

  const nextTopic = buildTicketTopic({
    ownerId: ticketMeta.ownerId,
    status: "closed",
    createdAt: ticketMeta.createdAt || Date.now(),
    type: ticketMeta.type || "support"
  });

  const closedName = channel.name.startsWith("closed-")
    ? channel.name
    : `closed-${channel.name}`.slice(0, 90);

  await channel.edit({
    name: closedName,
    topic: nextTopic,
    reason: `Ticket closed by ${interaction.user.tag} via ${source}`
  }).catch(() => null);

  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
    ViewChannel: false
  }).catch(() => null);

  if (ticketMeta.ownerId) {
    await channel.permissionOverwrites.edit(ticketMeta.ownerId, {
      ViewChannel: false,
      SendMessages: false
    }).catch(() => null);
  }

  if (cfg.supportRoleId) {
    await channel.permissionOverwrites.edit(cfg.supportRoleId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    }).catch(() => null);
  }

  const logFields = [
    { name: "Ticket Channel", value: `<#${channel.id}>`, inline: true },
    { name: "Closed By", value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
    { name: "Owner", value: ticketMeta.ownerId ? `<@${ticketMeta.ownerId}> (${ticketMeta.ownerId})` : "unknown", inline: false },
    { name: "Reason", value: String(reason || "No reason provided.").slice(0, 300), inline: false }
  ];

  await auditLog({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    action: "ticket.close",
    details: {
      channelId: channel.id,
      ownerId: ticketMeta.ownerId || null,
      reason: String(reason || "").slice(0, 300),
      source
    }
  });

  await dispatchModerationLog(interaction.guild, {
    action: "ticket",
    ok: true,
    actorId: interaction.user.id,
    actorTag: interaction.user.tag,
    targetId: ticketMeta.ownerId || interaction.user.id,
    reason: "close",
    summary: `Ticket closed in #${channel.name}.`,
    commandName: "tickets",
    channelId: channel.id,
    details: {
      source,
      type: ticketMeta.type || "support"
    }
  });

  const logPayload = {
    embeds: [
      buildTicketLogEmbed({
        title: "Ticket Closed",
        summary: `Ticket <#${channel.id}> has been closed.`,
        color: Colors.WARNING,
        fields: logFields
      })
    ]
  };
  if (transcript) logPayload.files = [transcript];
  await postTicketLog(interaction.guild, cfg, logPayload);

  await channel.send({
    embeds: [
      createEmbed(
        "Ticket Closed",
        `Closed by <@${interaction.user.id}>.\nReason: ${String(reason || "No reason provided.").slice(0, 300)}`,
        Colors.WARNING
      )
    ],
    components: []
  }).catch(() => null);

  return { ok: true, transcriptIncluded: Boolean(transcript) };
}

async function handleOpenFlow(interaction, { typeKey = "support", subject = "", source = "slash" } = {}) {
  const guildData = await loadGuildData(interaction.guildId);
  const result = await createTicket(interaction, guildData, { typeKey, subject, source });

  if (!result.ok) {
    await replyEphemeral(interaction, {
      embeds: [createEmbed("Ticket Open Failed", result.message || "Could not open ticket.", Colors.ERROR)]
    });
    return;
  }

  await replyEphemeral(interaction, {
    embeds: [
      createEmbed(
        result.created ? "Ticket Created" : "Ticket Already Open",
        result.message,
        result.created ? Colors.SUCCESS : Colors.INFO
      )
    ]
  });
}

async function handleCloseFlow(interaction, { channel, reason = "No reason provided.", source = "slash" }) {
  const guildData = await loadGuildData(interaction.guildId);
  const result = await closeTicket(interaction, guildData, { channel, reason, source });
  if (!result.ok) {
    await replyEphemeral(interaction, {
      embeds: [createEmbed("Ticket Close Failed", result.message || "Could not close ticket.", Colors.ERROR)]
    });
    return;
  }

  await replyEphemeral(interaction, {
    embeds: [
      createEmbed(
        "Ticket Closed",
        result.transcriptIncluded
          ? "Ticket was closed and transcript was generated for logs."
          : "Ticket was closed.",
        Colors.SUCCESS
      )
    ]
  });
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(true);

  if (sub === "open") {
    const type = interaction.options.getString("type", false) || "support";
    const subject = interaction.options.getString("subject", false) || "";
    await handleOpenFlow(interaction, { typeKey: type, subject, source: "slash-open" });
    return;
  }

  if (sub === "close") {
    const channel = interaction.options.getChannel("channel", false) || interaction.channel;
    const reason = interaction.options.getString("reason", false) || "No reason provided.";
    await handleCloseFlow(interaction, { channel, reason, source: "slash-close" });
    return;
  }

  const isAdmin = await requireManageGuild(interaction);
  if (!isAdmin) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildData = await loadGuildData(interaction.guildId);
  normalizeTicketsConfig(guildData);
  const cfg = guildData.tickets;

  if (sub === "setup") {
    const category = interaction.options.getChannel("category", true);
    const panelChannel = interaction.options.getChannel("panel_channel", false);
    const logChannel = interaction.options.getChannel("log_channel", false);
    const supportRole = interaction.options.getRole("support_role", false);
    const transcriptOnClose = interaction.options.getBoolean("transcript_on_close", false);
    const enabled = interaction.options.getBoolean("enabled", false);

    cfg.categoryId = category.id;
    if (panelChannel) cfg.panelChannelId = panelChannel.id;
    if (logChannel) cfg.logChannelId = logChannel.id;
    if (supportRole) cfg.supportRoleId = supportRole.id;
    if (transcriptOnClose !== null) cfg.transcriptOnClose = Boolean(transcriptOnClose);
    cfg.enabled = enabled === null ? true : Boolean(enabled);

    await saveTicketConfig(interaction.guildId, guildData);

    await interaction.editReply({
      embeds: [
        createEmbed(
          "Tickets Configured",
          `Enabled: **${cfg.enabled ? "yes" : "no"}**\n` +
            `Category: <#${cfg.categoryId}>\n` +
            `Panel Channel: ${cfg.panelChannelId ? `<#${cfg.panelChannelId}>` : "not set"}\n` +
            `Log Channel: ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : "not set"}\n` +
            `Support Role: ${cfg.supportRoleId ? `<@&${cfg.supportRoleId}>` : "not set"}\n` +
            `Transcript on Close: **${cfg.transcriptOnClose ? "yes" : "no"}**`,
          Colors.SUCCESS
        )
      ]
    });
    return;
  }

  if (sub === "panel") {
    const provided = interaction.options.getChannel("channel", false);
    const panelChannelId = provided?.id || cfg.panelChannelId || interaction.channelId;
    const panelChannel = interaction.guild.channels.cache.get(panelChannelId)
      || await interaction.guild.channels.fetch(panelChannelId).catch(() => null);

    if (!panelChannel?.isTextBased?.()) {
      await interaction.editReply({
        embeds: [createEmbed("Panel Failed", "Panel channel is invalid or inaccessible.", Colors.ERROR)]
      });
      return;
    }

    const panelMessage = await panelChannel.send({
      embeds: [buildPanelEmbed(cfg)],
      components: panelComponents()
    }).catch(() => null);

    if (!panelMessage) {
      await interaction.editReply({
        embeds: [createEmbed("Panel Failed", "Could not send panel message in that channel.", Colors.ERROR)]
      });
      return;
    }

    cfg.panelChannelId = panelChannel.id;
    cfg.panelMessageId = panelMessage.id;
    await saveTicketConfig(interaction.guildId, guildData);

    await interaction.editReply({
      embeds: [
        createEmbed(
          "Ticket Panel Posted",
          `Panel message created in <#${panelChannel.id}>.\n[Jump to panel](https://discord.com/channels/${interaction.guildId}/${panelChannel.id}/${panelMessage.id})`,
          Colors.SUCCESS
        )
      ]
    });
    return;
  }

  if (sub === "status") {
    const openCount = await countOpenTicketsInCategory(interaction.guild, cfg.categoryId);
    await interaction.editReply({ embeds: [buildTicketStatusEmbed(cfg, openCount)] });
    return;
  }
}

export async function handleButton(interaction) {
  if (!interaction.isButton?.()) return false;
  const parsed = parseUiId(interaction.customId);
  if (!parsed) return false;

  if (parsed.action === "open") {
    await handleOpenFlow(interaction, { typeKey: "support", source: "panel-button" });
    return true;
  }

  if (parsed.action === "close") {
    await handleCloseFlow(interaction, {
      channel: interaction.channel,
      reason: "Closed via ticket button.",
      source: "ticket-button"
    });
    return true;
  }

  return false;
}

export async function handleSelect(interaction) {
  if (!interaction.isStringSelectMenu?.()) return false;
  const parsed = parseUiId(interaction.customId);
  if (!parsed || parsed.action !== "type") return false;

  const typeKey = interaction.values?.[0] || "support";
  const safeType = TYPE_KEYS.has(typeKey) ? typeKey : "support";
  await handleOpenFlow(interaction, {
    typeKey: safeType,
    subject: `Ticket type: ${ticketTypeLabel(safeType)}`,
    source: "panel-select"
  });
  return true;
}

export default {
  data,
  execute,
  meta
};
