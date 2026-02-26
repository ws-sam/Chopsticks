import {
  AttachmentBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
  EmbedBuilder
} from "discord.js";
import {
  insertAgentBot,
  fetchAgentBots,
  fetchAgentToken,
  revokeAgentToken,
  updateAgentBotStatus,
  updateAgentCapabilities,
  deleteAgentBot,
  updateAgentBotProfile,
  fetchAgentBotProfile,
  fetchPool,
  fetchPoolsByOwner,
  getGuildSelectedPool,
  setGuildSelectedPool,
  fetchPoolAgents,
  listPools,
  loadGuildData,
  saveGuildData,
  getUserPoolRole,
  canManagePool,
  maskToken,
  getGuildPoolConfig,
} from "../utils/storage.js";
import {
  replyEmbed,
  replyEmbedWithJson,
  buildEmbed,
  replyError,
  replySuccess,
  Colors
} from "../utils/discordOutput.js";
import { getBotOwnerIds, isBotOwner } from "../utils/owners.js";
import { replyInteraction } from "../utils/interactionReply.js";
import { trackAgentDeployment } from "../utils/metrics.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  deployGlobal: true,
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
  category: "agents"
};

function canManageGuild(interaction, ownerIds = []) {
  if (!interaction?.inGuild?.() || !interaction.guildId) return false;
  const perms = interaction.memberPermissions;
  if (perms?.has?.(PermissionFlagsBits.ManageGuild) || perms?.has?.(PermissionFlagsBits.Administrator)) return true;
  const userId = interaction.user?.id;
  if (!userId) return false;
  return Array.isArray(ownerIds) && ownerIds.includes(userId);
}

function fmtTs(ms) {
  if (!ms) return "n/a";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function buildMainInvite(clientId) {
  const perms = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.Connect,
    PermissionsBitField.Flags.Speak,
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.ModerateMembers
  ]);
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${perms.bitfield}&scope=bot%20applications.commands`;
}

function trimText(value, max = 1024) {
  const text = String(value ?? "").trim();
  if (!text) return "n/a";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function buildInfoEmbed(title, description = "", color = Colors.INFO) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(trimText(description, 4096))
    .setColor(color)
    .setTimestamp();
}

function summarizePool(pool, selectedPoolId) {
  if (!pool) return `\`${selectedPoolId}\``;
  return `${pool.name} (\`${selectedPoolId}\`)`;
}

function isPoolAccessibleForUser(pool, userId, ownerIds) {
  if (!pool) return false;
  if (ownerIds.has(userId)) return true;
  if (pool.owner_user_id === userId) return true;
  return pool.visibility === "public";
}

async function listAccessiblePoolsForUser(userId, ownerIds, guildId = null) {
  const pools = await listPools();
  const accessible = pools.filter(pool => isPoolAccessibleForUser(pool, userId, ownerIds));
  // If we have a guild context, sort by specialty preference (local sort — no extra DB call)
  if (guildId) {
    const config = await getGuildPoolConfig(guildId).catch(() => null);
    const specialty = config?.preferred_specialty;
    if (specialty) {
      return [...accessible].sort((a, b) => {
        const aMatch = (a.specialty || a.meta?.specialty) === specialty ? 1 : 0;
        const bMatch = (b.specialty || b.meta?.specialty) === specialty ? 1 : 0;
        return bMatch - aMatch; // specialty matches first
      });
    }
  }
  return accessible;
}

function selectVisibleRegisteredAgents(allAgents, liveAgents, guildId, selectedPoolId, requesterIsBotOwner) {
  if (requesterIsBotOwner) return allAgents;
  const liveInGuildIds = new Set(
    liveAgents
      .filter(a => a.guildIds.includes(guildId))
      .map(a => a.agentId)
  );
  return allAgents.filter(a => a.pool_id === selectedPoolId || liveInGuildIds.has(a.agent_id));
}

function summarizePoolAgentHealth(poolAgents) {
  const total = Array.isArray(poolAgents) ? poolAgents.length : 0;
  if (total === 0) return "0 total • 0 active • 0 inactive";
  const active = poolAgents.filter(a => a.status === "active").length;
  const inactive = Math.max(0, total - active);
  return `${total} total • ${active} active • ${inactive} inactive`;
}

function summarizeDeployDiagnostics(diag) {
  const d = diag && typeof diag === "object" ? diag : {};
  const scopedTotal = Number(d.scopedTotal || 0);
  const activeTotal = Number(d.activeTotal || 0);
  const inactiveTotal = Number(d.inactiveTotal || 0);
  const missingToken = Number(d.missingToken || 0);
  const missingClientId = Number(d.missingClientId || 0);
  const alreadyInGuild = Number(d.alreadyInGuild || 0);
  const invitable = Number(d.invitable || 0);
  const invitableConnected = Number(d.invitableConnected || 0);
  const invitableOffline = Number(d.invitableOffline || 0);

  return [
    `Scoped pool agents: **${scopedTotal}**`,
    `Active: **${activeTotal}** • Inactive/Pending: **${inactiveTotal}**`,
    `Unusable tokens: **${missingToken}**`,
    `Missing client id: **${missingClientId}**`,
    `Already in guild: **${alreadyInGuild}**`,
    `Invitable now: **${invitable}** (connected ${invitableConnected}, offline ${invitableOffline})`
  ].join("\n");
}

function explainNoInviteAvailability(plan) {
  const d = plan?.diagnostics || {};
  if (Number(d.scopedTotal || 0) === 0) {
    return "This pool has no registered agents.";
  }
  if (Number(d.activeTotal || 0) === 0) {
    if (Number(d.missingToken || 0) > 0) {
      return "Agents exist but their tokens are unusable (likely AGENT_TOKEN_KEY rotated). Re-register agents with /agents add_token.";
    }
    return "All agents in this pool are currently inactive/pending.";
  }
  if (Number(d.invitable || 0) === 0 && Number(d.alreadyInGuild || 0) > 0) {
    return "All active identities in this pool already appear present in this guild.";
  }
  if (Number(d.invitable || 0) === 0) {
    return "No eligible identities are currently invitable from this pool.";
  }
  return "Invite generation is currently limited by pool capacity.";
}

function summarizeAdvisorRow(row, idx) {
  const status = row.plan?.error
    ? "blocked"
    : row.fulfilled
      ? "ready"
      : row.inviteCount > 0
        ? "partial"
        : "empty";
  const reason = row.plan?.error
    ? String(row.plan.error)
    : row.fulfilled
      ? "Meets desired target now."
      : explainNoInviteAvailability(row.plan);

  return [
    `**${idx + 1}. ${row.pool.name}** (\`${row.pool.pool_id}\`) • ${row.pool.visibility} • ${status}`,
    `Present ${row.presentCount} • Need ${row.needInvites} • Links ${row.inviteCount} • Invitable ${row.invitableCount}`,
    trimText(reason, 180)
  ].join("\n");
}

async function buildAdvisorRows(mgr, guildId, desiredTotal, pools) {
  const rows = await Promise.all(
    pools.map(async pool => {
      const plan = await mgr.buildDeployPlan(guildId, desiredTotal, pool.pool_id).catch(error => ({
        error: error?.message || "Failed to build plan.",
        presentCount: 0,
        needInvites: desiredTotal,
        invitableCount: 0,
        invites: [],
        diagnostics: {}
      }));
      const inviteCount = Array.isArray(plan?.invites) ? plan.invites.length : 0;
      const needInvites = Number(plan?.needInvites || 0);
      const invitableCount = Number(plan?.invitableCount || 0);
      const presentCount = Number(plan?.presentCount || 0);
      const fulfilled = !plan?.error && (needInvites === 0 || inviteCount >= needInvites);
      const gap = Math.max(0, needInvites - inviteCount);

      return {
        pool,
        plan,
        inviteCount,
        needInvites,
        invitableCount,
        presentCount,
        fulfilled,
        gap
      };
    })
  );

  rows.sort((a, b) =>
    Number(b.fulfilled) - Number(a.fulfilled) ||
    b.inviteCount - a.inviteCount ||
    b.invitableCount - a.invitableCount ||
    a.gap - b.gap ||
    String(a.pool.pool_id).localeCompare(String(b.pool.pool_id))
  );
  return rows;
}

const ADVISOR_UI_PREFIX = "agadvisorui";

const DEPLOY_UI_PREFIX = "agdeployui";
const DEPLOY_UI_DESIRED = [10, 20, 30, 40, 49];

const AGENT_INV_PREFIX = "agentinv";
const INVITES_PER_PAGE = 10; // 2 rows of 5 link buttons + nav row

function encodePoolId(poolId) {
  const raw = String(poolId || "").trim();
  if (!raw) return "_";
  return encodeURIComponent(raw);
}

function decodePoolId(value) {
  const raw = String(value || "");
  if (!raw || raw === "_") return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function buildDeployUiId(action, userId, desiredTotal, poolId) {
  return `${DEPLOY_UI_PREFIX}:${action}:${userId}:${desiredTotal}:${encodePoolId(poolId)}`;
}

function parseDeployUiId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length < 5 || parts[0] !== DEPLOY_UI_PREFIX) return null;
  const desired = Number(parts[3]);
  return {
    action: parts[1],
    userId: parts[2],
    desired: Number.isFinite(desired) ? desired : DEPLOY_UI_DESIRED[0],
    poolId: decodePoolId(parts.slice(4).join(":"))
  };
}

function clampDeployUiDesired(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEPLOY_UI_DESIRED[0];
  if (DEPLOY_UI_DESIRED.includes(n)) return n;
  if (n >= 49) return 49;
  if (n >= 40) return 40;
  if (n >= 30) return 30;
  if (n >= 20) return 20;
  return 10;
}

function buildAdvisorUiId(action, userId, desiredTotal, poolId) {
  return `${ADVISOR_UI_PREFIX}:${action}:${userId}:${desiredTotal}:${encodePoolId(poolId)}`;
}

function parseAdvisorUiId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length < 5 || parts[0] !== ADVISOR_UI_PREFIX) return null;
  const desired = Number(parts[3]);
  return {
    action: parts[1],
    userId: parts[2],
    desired: Number.isFinite(desired) ? desired : DEPLOY_UI_DESIRED[0],
    poolId: decodePoolId(parts.slice(4).join(":"))
  };
}

function agentInvId(action, userId, desiredTotal, page, poolId) {
  const p = Number.isFinite(Number(page)) ? Math.max(0, Math.trunc(Number(page))) : 0;
  return `${AGENT_INV_PREFIX}:${action}:${userId}:${desiredTotal}:${p}:${encodePoolId(poolId)}`;
}

function parseAgentInvId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length < 6 || parts[0] !== AGENT_INV_PREFIX) return null;
  const desired = Number(parts[3]);
  const page = Number(parts[4]);
  return {
    action: parts[1],
    userId: parts[2],
    desired: Number.isFinite(desired) ? desired : DEPLOY_UI_DESIRED[0],
    page: Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0,
    poolId: decodePoolId(parts.slice(5).join(":"))
  };
}

function inviteLabel(inv, idx) {
  const tag = String(inv?.tag || "").trim();
  const agentId = String(inv?.agentId || "").trim();
  const base = tag ? tag : (agentId ? agentId : `Agent ${idx + 1}`);
  return base.slice(0, 80);
}

function buildInvitePanelEmbed({ guildId, poolId, desiredTotal, plan, page, pages }) {
  const invites = Array.isArray(plan?.invites) ? plan.invites : [];
  const total = invites.length;
  const start = page * INVITES_PER_PAGE;
  const end = Math.min(total, start + INVITES_PER_PAGE);

  const desc = [
    "Click a button to open Discord's invite flow for that agent identity.",
    "You still need Discord permissions to add bots to this server.",
    pages > 1 ? `Page **${page + 1}** / **${pages}**` : null,
    "",
    total
      ? `Showing invites **${start + 1}**-${end} of **${total}**.`
      : "No invite links available for this plan."
  ].filter(Boolean).join("\n");

  return new EmbedBuilder()
    .setTitle("Agent Invite Links")
    .setColor(total ? Colors.INFO : Colors.WARNING)
    .setDescription(desc.slice(0, 4096))
    .addFields(
      { name: "Guild", value: guildId ? `\`${guildId}\`` : "n/a", inline: true },
      { name: "Pool", value: poolId ? `\`${poolId}\`` : "n/a", inline: true },
      { name: "Desired", value: String(desiredTotal ?? "n/a"), inline: true },
      { name: "Present", value: String(plan?.presentCount ?? 0), inline: true },
      { name: "Need", value: String(plan?.needInvites ?? 0), inline: true },
      { name: "Invites", value: String(total), inline: true }
    )
    .setFooter({ text: "In development" })
    .setTimestamp();
}

function buildInvitePanelComponents({ userId, desiredTotal, poolId, plan, page, pages }) {
  const invites = Array.isArray(plan?.invites) ? plan.invites : [];
  const rows = [];

  const start = page * INVITES_PER_PAGE;
  const slice = invites.slice(start, start + INVITES_PER_PAGE);
  const btns = slice
    .map((inv, i) => {
      const url = String(inv?.inviteUrl || "").trim();
      if (!/^https?:\/\//i.test(url)) return null;
      return new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(inviteLabel(inv, start + i))
        .setURL(url);
    })
    .filter(Boolean);

  for (let i = 0; i < btns.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(...btns.slice(i, i + 5)));
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(agentInvId("prev", userId, desiredTotal, Math.max(0, page - 1), poolId))
        .setLabel("Prev")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(agentInvId("next", userId, desiredTotal, Math.min(pages - 1, page + 1), poolId))
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages - 1),
      new ButtonBuilder()
        .setCustomId(agentInvId("download", userId, desiredTotal, page, poolId))
        .setLabel("Download All")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(invites.length === 0),
      new ButtonBuilder()
        .setCustomId(agentInvId("close", userId, desiredTotal, page, poolId))
        .setLabel("Close")
        .setStyle(ButtonStyle.Danger)
    )
  );

  return rows.slice(0, 5);
}

function buildInviteExportFile({ guildId, poolId, desiredTotal, plan }) {
  const invites = Array.isArray(plan?.invites) ? plan.invites : [];
  const lines = [];
  lines.push(`# Chopsticks Agent Invite Links`);
  lines.push(`guild=${guildId || ""}`);
  lines.push(`pool=${poolId || ""}`);
  lines.push(`desired=${desiredTotal || ""}`);
  lines.push(`present=${plan?.presentCount ?? ""}`);
  lines.push(`need=${plan?.needInvites ?? ""}`);
  lines.push(`generated=${invites.length}`);
  lines.push("");
  for (let idx = 0; idx < invites.length; idx += 1) {
    const inv = invites[idx];
    const label = inv.tag ? `${inv.agentId} (${inv.tag})` : inv.agentId;
    lines.push(`${idx + 1}. ${label}`);
    lines.push(inv.inviteUrl);
    lines.push("");
  }
  const payload = Buffer.from(lines.join("\n"), "utf8");
  return new AttachmentBuilder(payload, {
    name: `agent-invites-${guildId}-${Date.now()}.txt`
  });
}

async function replyInvitePanel(interaction, { guildId, userId, desiredTotal, poolId, plan, page = 0, update = false } = {}) {
  const invites = Array.isArray(plan?.invites) ? plan.invites : [];
  const pages = Math.max(1, Math.ceil(invites.length / INVITES_PER_PAGE));
  const safePage = Math.max(0, Math.min(pages - 1, Math.trunc(Number(page) || 0)));

  const embed = buildInvitePanelEmbed({ guildId, poolId, desiredTotal, plan, page: safePage, pages });
  const components = buildInvitePanelComponents({ userId, desiredTotal, poolId, plan, page: safePage, pages });

  const payload = { embeds: [embed], components, flags: MessageFlags.Ephemeral };
  if (update) return interaction.update(payload);
  return interaction.reply(payload);
}

async function resolveAdvisorUiState(guildId, userId, ownerIds, mgr, requested = {}) {
  const desiredTotal = clampDeployUiDesired(requested.desiredTotal);
  const requestedPoolId = String(requested.poolId || "").trim();
  const defaultPoolId = await getGuildSelectedPool(guildId);
  const accessiblePools = await listAccessiblePoolsForUser(userId, ownerIds, guildId);
  const rows = await buildAdvisorRows(mgr, guildId, desiredTotal, accessiblePools);

  let selectedRow = null;
  if (requestedPoolId) {
    selectedRow = rows.find(row => row.pool.pool_id === requestedPoolId) || null;
  }
  if (!selectedRow && defaultPoolId) {
    selectedRow = rows.find(row => row.pool.pool_id === defaultPoolId) || null;
  }
  if (!selectedRow) {
    selectedRow = rows[0] || null;
  }

  const poolOptions = rows.slice(0, 25).map((row, idx) => ({
    label: trimText(`${idx + 1}. ${row.pool.name}`, 100),
    value: row.pool.pool_id,
    description: trimText(
      `${row.pool.visibility} • links ${row.inviteCount} • need ${row.needInvites} • invitable ${row.invitableCount}`,
      100
    ),
    default: selectedRow?.pool?.pool_id === row.pool.pool_id
  }));

  return {
    guildId,
    desiredTotal,
    defaultPoolId,
    rows,
    selectedRow,
    selectedPoolId: selectedRow?.pool?.pool_id || null,
    poolOptions
  };
}

function buildAdvisorUiEmbed(state, note = "") {
  if (!state.rows.length) {
    const empty = buildInfoEmbed(
      "Pool Advisor",
      "No accessible pools were found. Use `/pools public` to discover public pools.",
      Colors.ERROR
    ).addFields(
      { name: "Desired", value: String(state.desiredTotal), inline: true },
      { name: "Guild Default", value: `\`${state.defaultPoolId || "n/a"}\``, inline: true }
    );
    if (note) empty.addFields({ name: "Update", value: trimText(note, 1024), inline: false });
    return empty;
  }

  const best = state.rows[0];
  const selected = state.selectedRow || best;
  const color = best?.fulfilled ? Colors.SUCCESS : Colors.WARNING;
  const ranking = state.rows.slice(0, 8).map((row, idx) => summarizeAdvisorRow(row, idx)).join("\n\n");
  const selectedReason = selected.fulfilled
    ? "Can satisfy target now."
    : explainNoInviteAvailability(selected.plan);

  const embed = buildInfoEmbed(
    "Pool Advisor Control Panel",
    "Ranked by deploy capacity. Choose a pool and hand off directly to deployment.",
    color
  ).addFields(
    { name: "Desired", value: String(state.desiredTotal), inline: true },
    { name: "Guild Default", value: `\`${state.defaultPoolId || "n/a"}\``, inline: true },
    { name: "Accessible Pools", value: String(state.rows.length), inline: true },
    {
      name: "Best Candidate",
      value: summarizeAdvisorRow(best, 0),
      inline: false
    },
    {
      name: "Selected Pool",
      value: [
        `${summarizePool(selected.pool, selected.pool.pool_id)}`,
        `Present ${selected.presentCount} • Need ${selected.needInvites} • Links ${selected.inviteCount} • Invitable ${selected.invitableCount}`,
        trimText(selectedReason, 240)
      ].join("\n"),
      inline: false
    },
    { name: "Pool Ranking", value: trimText(ranking, 1024), inline: false }
  );

  if (note) {
    embed.addFields({ name: "Update", value: trimText(note, 1024), inline: false });
  }
  return embed;
}

function buildAdvisorUiComponents(state, actorUserId) {
  const desiredSelect = new StringSelectMenuBuilder()
    .setCustomId(buildAdvisorUiId("desired", actorUserId, state.desiredTotal, state.selectedPoolId))
    .setPlaceholder("Target total")
    .addOptions(
      DEPLOY_UI_DESIRED.map(value => ({
        label: `${value} agents`,
        value: String(value),
        description: value === 49 ? "Maximum per guild" : "Target total in this guild",
        default: value === state.desiredTotal
      }))
    );

  const poolSelect = new StringSelectMenuBuilder()
    .setCustomId(buildAdvisorUiId("pool", actorUserId, state.desiredTotal, state.selectedPoolId))
    .setPlaceholder(state.poolOptions.length ? "Ranked pools" : "No accessible pools")
    .setDisabled(state.poolOptions.length === 0);
  if (state.poolOptions.length) {
    poolSelect.addOptions(state.poolOptions);
  } else {
    poolSelect.addOptions({ label: "No accessible pools", value: "_", default: true });
  }

  const refreshButton = new ButtonBuilder()
    .setCustomId(buildAdvisorUiId("refresh", actorUserId, state.desiredTotal, state.selectedPoolId))
    .setStyle(ButtonStyle.Secondary)
    .setLabel("Refresh");
  const linksButton = new ButtonBuilder()
    .setCustomId(buildAdvisorUiId("links", actorUserId, state.desiredTotal, state.selectedPoolId))
    .setStyle(ButtonStyle.Primary)
    .setLabel("Invite Links")
    .setDisabled(!state.selectedPoolId);
  const setDefaultButton = new ButtonBuilder()
    .setCustomId(buildAdvisorUiId("setdefault", actorUserId, state.desiredTotal, state.selectedPoolId))
    .setStyle(ButtonStyle.Secondary)
    .setLabel("Set As Guild Default")
    .setDisabled(!state.selectedPoolId || state.selectedPoolId === state.defaultPoolId);

  return [
    new ActionRowBuilder().addComponents(desiredSelect),
    new ActionRowBuilder().addComponents(poolSelect),
    new ActionRowBuilder().addComponents(refreshButton, linksButton, setDefaultButton)
  ];
}

async function renderAdvisorUi(interaction, mgr, ownerIds, requested = {}, { update = false, note = "" } = {}) {
  const state = await resolveAdvisorUiState(interaction.guildId, interaction.user.id, ownerIds, mgr, requested);
  const embed = buildAdvisorUiEmbed(state, note);
  const components = buildAdvisorUiComponents(state, interaction.user.id);
  if (update) {
    await interaction.update({ embeds: [embed], components });
  } else {
    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  }
  return state;
}

async function resolveDeployUiState(guildId, userId, ownerIds, mgr, requested = {}) {
  const accessiblePools = await listAccessiblePoolsForUser(userId, ownerIds, guildId);
  const defaultPoolId = await getGuildSelectedPool(guildId);
  const desired = clampDeployUiDesired(requested.desiredTotal);
  const requestedPoolId = String(requested.poolId || "").trim();

  let selectedPool = null;
  if (requestedPoolId) {
    selectedPool = accessiblePools.find(pool => pool.pool_id === requestedPoolId) || null;
  }
  if (!selectedPool) {
    selectedPool = accessiblePools.find(pool => pool.pool_id === defaultPoolId) || null;
  }
  if (!selectedPool) {
    selectedPool = accessiblePools[0] || null;
  }

  let poolOptions = [];
  if (accessiblePools.length) {
    const rows = await Promise.all(accessiblePools.slice(0, 25).map(async pool => {
      const invitable = await mgr.listInvitableAgentsForGuild(guildId, pool.pool_id).catch(() => []);
      const invitableCount = Array.isArray(invitable) ? invitable.length : 0;
      const label = trimText(`${pool.name} (${pool.pool_id})`, 100);
      const description = trimText(
        `${pool.visibility} • ${invitableCount} invitable`,
        100
      );
      return {
        label,
        value: pool.pool_id,
        description,
        default: selectedPool?.pool_id === pool.pool_id
      };
    }));
    poolOptions = rows;
  }

  return {
    guildId,
    desiredTotal: desired,
    defaultPoolId,
    selectedPoolId: selectedPool?.pool_id || null,
    selectedPool,
    accessiblePools,
    poolOptions
  };
}

async function buildDeployUiContext(guildId, userId, ownerIds, mgr, requested = {}) {
  const state = await resolveDeployUiState(guildId, userId, ownerIds, mgr, requested);
  const selectedPoolId = state.selectedPoolId;
  if (!selectedPoolId) {
    return {
      state,
      poolAgents: [],
      plan: null
    };
  }
  const [poolAgents, plan] = await Promise.all([
    fetchPoolAgents(selectedPoolId).catch(() => []),
    mgr.buildDeployPlan(guildId, state.desiredTotal, selectedPoolId).catch(() => null)
  ]);
  return {
    state,
    poolAgents: Array.isArray(poolAgents) ? poolAgents : [],
    plan
  };
}

function buildDeployUiComponents(state, actorUserId) {
  const desiredSelect = new StringSelectMenuBuilder()
    .setCustomId(buildDeployUiId("desired", actorUserId, state.desiredTotal, state.selectedPoolId))
    .setPlaceholder("Choose desired total")
    .addOptions(
      DEPLOY_UI_DESIRED.map(value => ({
        label: `${value} agents`,
        value: String(value),
        description: value === 49 ? "Maximum per guild" : "Target total in this guild",
        default: value === state.desiredTotal
      }))
    );

  const poolSelect = new StringSelectMenuBuilder()
    .setCustomId(buildDeployUiId("pool", actorUserId, state.desiredTotal, state.selectedPoolId))
    .setPlaceholder(state.poolOptions.length ? "Choose a pool" : "No accessible pools")
    .setDisabled(state.poolOptions.length === 0);

  if (state.poolOptions.length) {
    poolSelect.addOptions(state.poolOptions.slice(0, 25));
  } else {
    poolSelect.addOptions({ label: "No accessible pools", value: "_", default: true });
  }

  const refreshButton = new ButtonBuilder()
    .setCustomId(buildDeployUiId("refresh", actorUserId, state.desiredTotal, state.selectedPoolId))
    .setStyle(ButtonStyle.Secondary)
    .setLabel("Refresh");

  const linksButton = new ButtonBuilder()
    .setCustomId(buildDeployUiId("links", actorUserId, state.desiredTotal, state.selectedPoolId))
    .setStyle(ButtonStyle.Primary)
    .setLabel("Invite Links");

  const setDefaultButton = new ButtonBuilder()
    .setCustomId(buildDeployUiId("setdefault", actorUserId, state.desiredTotal, state.selectedPoolId))
    .setStyle(ButtonStyle.Secondary)
    .setLabel("Set As Guild Default")
    .setDisabled(!state.selectedPoolId || state.selectedPoolId === state.defaultPoolId);

  return [
    new ActionRowBuilder().addComponents(desiredSelect),
    new ActionRowBuilder().addComponents(poolSelect),
    new ActionRowBuilder().addComponents(refreshButton, linksButton, setDefaultButton)
  ];
}

function buildDeployUiEmbed(context) {
  const { state, poolAgents, plan } = context;
  if (!state.selectedPoolId || !state.selectedPool) {
    return buildInfoEmbed(
      "Deployment Control Panel",
      "No accessible pool was found for your account.\nUse `/pools public` to discover public pools or ask an admin to configure access.",
      Colors.ERROR
    ).addFields(
      { name: "Guild Default Pool", value: `\`${state.defaultPoolId}\``, inline: true },
      { name: "Desired", value: String(state.desiredTotal), inline: true }
    );
  }

  const poolName = summarizePool(state.selectedPool, state.selectedPoolId);
  const poolHealth = summarizePoolAgentHealth(poolAgents);
  const invitableNow = plan?.invitableCount ?? 0;
  const needInvites = plan?.needInvites ?? 0;
  const inviteCount = Array.isArray(plan?.invites) ? plan.invites.length : 0;
  const fulfilled = needInvites === 0 || inviteCount >= needInvites;

  const embed = buildInfoEmbed(
    "Deployment Control Panel",
    "Pick a target total and pool, then use **Invite Links** to generate deployment links.",
    fulfilled ? Colors.SUCCESS : Colors.WARNING
  ).addFields(
    { name: "Selected Pool", value: poolName, inline: false },
    { name: "Guild Default", value: `\`${state.defaultPoolId}\``, inline: true },
    { name: "Desired", value: String(state.desiredTotal), inline: true },
    { name: "Present", value: String(plan?.presentCount ?? 0), inline: true },
    { name: "Need Invites", value: String(needInvites), inline: true },
    { name: "Invitable Now", value: String(invitableNow), inline: true },
    { name: "Pool Health", value: poolHealth, inline: false },
    { name: "Invite Availability", value: summarizeDeployDiagnostics(plan?.diagnostics), inline: false }
  );

  if (plan?.error) {
    embed.addFields({
      name: "Blocked",
      value: trimText(plan.error, 1024),
      inline: false
    });
    embed.setColor(Colors.ERROR);
    return embed;
  }

  const previewInvites = (plan?.invites || []).slice(0, 3).map((invite, idx) => {
    const label = invite.tag ? `${invite.agentId} (${invite.tag})` : invite.agentId;
    return `${idx + 1}. ${label}\n<${invite.inviteUrl}>`;
  });
  if (previewInvites.length) {
    embed.addFields({
      name: "Invite Preview",
      value: trimText(previewInvites.join("\n"), 1024),
      inline: false
    });
  }

  if (needInvites > inviteCount) {
    embed.addFields({
      name: "Capacity Gap",
      value:
        `Need ${needInvites}, generated ${inviteCount}.\n` +
        `${explainNoInviteAvailability(plan)}\n` +
        "Add more active agents to this pool or choose another pool.",
      inline: false
    });
  }

  return embed;
}

async function renderDeployUi(interaction, mgr, ownerIds, requested = {}, { update = false, note = "" } = {}) {
  const context = await buildDeployUiContext(interaction.guildId, interaction.user.id, ownerIds, mgr, requested);
  const embed = buildDeployUiEmbed(context);
  if (note) {
    embed.addFields({ name: "Update", value: trimText(note, 1024), inline: false });
  }
  const components = buildDeployUiComponents(context.state, interaction.user.id);
  if (update) {
    await interaction.update({ embeds: [embed], components });
  } else {
    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  }
  return context;
}

// External handoff helper: lets other command UIs open the Agents deploy panel without duplicating UI code.
export async function openDeployUiHandoff(interaction, requested = {}) {
  const ownerIds = getBotOwnerIds();
  if (!canManageGuild(interaction, ownerIds)) {
    const payload = {
      embeds: [buildInfoEmbed("Permission Required", "You need `Manage Server` to open Deploy UI.", Colors.ERROR)],
      flags: MessageFlags.Ephemeral
    };
    if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
    return interaction.reply(payload);
  }

  const mgr = global.agentManager;
  const ownerSet = new Set(ownerIds);
  const payloadRequested = {
    desiredTotal: requested?.desiredTotal,
    poolId: requested?.poolId
  };

  const context = await buildDeployUiContext(interaction.guildId, interaction.user.id, ownerSet, mgr, payloadRequested);
  const embed = buildDeployUiEmbed(context);
  const components = buildDeployUiComponents(context.state, interaction.user.id);
  const payload = { embeds: [embed], components, flags: MessageFlags.Ephemeral };

  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

export async function openAdvisorUiHandoff(interaction, requested = {}) {
  const ownerIds = getBotOwnerIds();
  if (!canManageGuild(interaction, ownerIds)) {
    const payload = {
      embeds: [buildInfoEmbed("Permission Required", "You need `Manage Server` to open Advisor UI.", Colors.ERROR)],
      flags: MessageFlags.Ephemeral
    };
    if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
    return interaction.reply(payload);
  }

  const mgr = global.agentManager;
  const ownerSet = new Set(ownerIds);

  const state = await resolveAdvisorUiState(interaction.guildId, interaction.user.id, ownerSet, mgr, {
    desiredTotal: requested?.desiredTotal,
    poolId: requested?.poolId
  });
  const embed = buildAdvisorUiEmbed(state);
  const components = buildAdvisorUiComponents(state, interaction.user.id);
  const payload = { embeds: [embed], components, flags: MessageFlags.Ephemeral };

  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

export const data = new SlashCommandBuilder()
  .setName("agents")
  .setDescription("Deploy and manage Chopsticks agents")
  .addSubcommand(s => s.setName("status").setDescription("Status overview for this guild"))
  .addSubcommand(s => s.setName("manifest").setDescription("List every connected agent and identity"))
  .addSubcommand(s => s.setName("diagnose").setDescription("Diagnose why an agent may not be coming online")
    .addStringOption(o => o.setName("agent_id").setDescription("Agent ID to diagnose (optional — diagnoses all if omitted)").setRequired(false)))
  .addSubcommand(s =>
    s
      .setName("deploy")
      .setDescription("Generate invite links to deploy more agents into this guild")
      .addIntegerOption(o =>
        o
          .setName("desired_total")
          .setDescription("Total number of agents you want available in this guild (multiples of 10, max 49)")
          .setRequired(true)
          .setMinValue(10) // Enforce minimum package size
          .setMaxValue(49)  // Enforce maximum total agents (Level 1: Invariants Locked)
      )
      .addStringOption(o =>
        o
          .setName("from_pool")
          .setDescription("Deploy from specific pool (leave empty to use guild default)")
          .setAutocomplete(true)
          .setRequired(false)
      )
  )
  .addSubcommand(s =>
    s
      .setName("advisor")
      .setDescription("Compare accessible pools and recommend the best deployment source")
      .addIntegerOption(o =>
        o
          .setName("desired_total")
          .setDescription("Target total agents for this guild (default: 10, max 49)")
          .setRequired(false)
          .setMinValue(10)
          .setMaxValue(49)
      )
      .addBooleanOption(o =>
        o
          .setName("set_best_default")
          .setDescription("Set best-ranked pool as this guild default")
          .setRequired(false)
      )
  )
  .addSubcommand(s =>
    s
      .setName("panel")
      .setDescription("Interactive agent deployment panel (pool selector + invite links)")
  )
  .addSubcommand(s =>
    s
      .setName("idle_policy")
      .setDescription("View or configure idle auto-release timeout for this server")
      .addIntegerOption(o =>
        o
          .setName("minutes")
          .setDescription("Idle minutes before release (1-720)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(720)
      )
      .addBooleanOption(o =>
        o
          .setName("use_default")
          .setDescription("Clear this server override and use global default")
          .setRequired(false)
      )
      .addBooleanOption(o =>
        o
          .setName("disable")
          .setDescription("Disable idle auto-release for this server")
          .setRequired(false)
      )
  )
  .addSubcommand(s => s.setName("sessions").setDescription("List active sessions for this guild"))
  .addSubcommand(s =>
    s
      .setName("assign")
      .setDescription("Pin a specific agent to a voice channel")
      .addChannelOption(o =>
        o.setName("channel").setDescription("Voice channel").setRequired(true).addChannelTypes(ChannelType.GuildVoice)
      )
      .addStringOption(o => o.setName("agent_id").setDescription("Agent ID (e.g. agent0001)").setRequired(true))
      .addStringOption(o =>
        o
          .setName("kind")
          .setDescription("Session type")
          .addChoices(
            { name: "music", value: "music" },
            { name: "assistant", value: "assistant" }
          )
      )
  )
  .addSubcommand(s =>
    s
      .setName("release")
      .setDescription("Release a session for a voice channel")
      .addChannelOption(o =>
        o.setName("channel").setDescription("Voice channel").setRequired(true).addChannelTypes(ChannelType.GuildVoice)
      )
      .addStringOption(o =>
        o
          .setName("kind")
          .setDescription("Session type")
          .addChoices(
            { name: "music", value: "music" },
            { name: "assistant", value: "assistant" }
          )
      )
  )
  .addSubcommand(s =>
    s
      .setName("scale")
      .setDescription("Scale active agents inside agentRunner (requires AGENT_SCALE_TOKEN)")
      .addIntegerOption(o =>
        o.setName("count").setDescription("Desired active agents").setRequired(true).setMinValue(1).setMaxValue(200)
      )
  )
  .addSubcommand(s =>
    s
      .setName("restart")
      .setDescription("Restart an agent by id (disconnects it so agentRunner reconnects)")
      .addStringOption(o => o.setName("agent_id").setDescription("Agent ID").setRequired(true))
  )
  .addSubcommand(s =>
    s
      .setName("add_token")
      .setDescription("Register your bot agent")
      .addStringOption(o => o.setName("token").setDescription("Discord Bot Token").setRequired(true))
      .addStringOption(o => o.setName("client_id").setDescription("Bot Application/Client ID").setRequired(true))
      .addStringOption(o => o.setName("tag").setDescription("Bot username (e.g., MyBot#1234)").setRequired(true))
      .addStringOption(o =>
        o
          .setName("pool")
          .setDescription("Target pool ID (use /pools public to see options)")
          .setAutocomplete(true)
          .setRequired(false)
      )
      .addStringOption(o =>
        o.setName("capabilities")
          .setDescription("What this agent can do (comma-separated: music,chat,tts,moderation)")
          .setRequired(false)
      )
  )
  .addSubcommand(s =>
    s
      .setName("verify_membership")
      .setDescription("Force check which agents are actually in this guild (admin only)")
  )
  .addSubcommand(s => s.setName("list_tokens").setDescription("View registered agents in accessible pools"))
  .addSubcommand(s =>
    s
      .setName("update_token_status")
      .setDescription("Update the status of an agent token")
      .addStringOption(o => o.setName("agent_id").setDescription("Agent ID (e.g., agent0001)").setRequired(true))
      .addStringOption(o =>
        o
          .setName("status")
          .setDescription("New status for the agent (active, inactive, or restarting)") // Added restarting
          .setRequired(true)
          .addChoices({ name: "active", value: "active" }, { name: "inactive", value: "inactive" }, { name: "restarting", value: "restarting" })
      )
  )
  .addSubcommand(s =>
    s
      .setName("delete_token")
      .setDescription("Delete an agent token from the system")
      .addStringOption(o => o.setName("agent_id").setDescription("Agent ID (e.g., agent0001)").setRequired(true))
  )
  .addSubcommand(s =>
    s
      .setName("revoke")
      .setDescription("Revoke your contributed agent from a pool (permanent)")
      .addStringOption(o => o.setName("agent_id").setDescription("Agent ID to revoke").setRequired(true))
  )
  .addSubcommand(s =>
    s
      .setName("my_agents")
      .setDescription("View all agents you have contributed across all pools")
  )
  .addSubcommand(s =>
    s
      .setName("set_profile")
      .setDescription("Set the AI profile for an agent.")
      .addStringOption(o => o.setName("agent_id").setDescription("The ID of the agent to update").setRequired(true))
      .addStringOption(o => o.setName("profile").setDescription("The JSON profile string for the agent").setRequired(true))
  )
  .addSubcommand(s =>
    s
      .setName("get_profile")
      .setDescription("Get the AI profile for an agent.")
      .addStringOption(o => o.setName("agent_id").setDescription("The ID of the agent").setRequired(true))
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const mgr = global.agentManager;
  if (!mgr) {
    await replyError(interaction, "Agent Control Offline", "Agent orchestration is not running.");
    return;
  }

  await withTimeout(interaction, async () => {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  // --- Bot Owner Permissions ---
  const ownerIds = getBotOwnerIds();
  const requesterIsBotOwner = isBotOwner(interaction.user.id);
  const ownerOnlySubcommands = new Set([
    "add_token",
    "delete_token",
    "set_profile",
    "update_token_status",
    "scale",
    "restart"
  ]);

  if (ownerOnlySubcommands.has(sub) && !requesterIsBotOwner) {
    await replyError(interaction, "Restricted Command", "This subcommand is limited to bot owners.");
    return;
  }
  // -----------------------------

  if (sub === "status") {
    try {
      const allAgentsRaw = await fetchAgentBots(); // Fetch all registered agents from DB
      const liveAgents = await mgr.listAgents(); // Currently connected agents
      const selectedPoolId = await getGuildSelectedPool(guildId);
      const allAgents = selectVisibleRegisteredAgents(
        allAgentsRaw,
        liveAgents,
        guildId,
        selectedPoolId,
        requesterIsBotOwner
      );
      const liveAgentIds = new Set(liveAgents.map(a => a.agentId));
      const liveById = new Map(liveAgents.map(a => [a.agentId, a]));

      const inGuild = liveAgents.filter(a => a.guildIds.includes(guildId));
      const idleInGuild = inGuild.filter(a => a.ready && !a.busyKey);
      const busyInGuild = inGuild.filter(a => a.ready && a.busyKey);

      // Registered in DB with active status
      const registeredActive = allAgents.filter(a => a.status === 'active');
      // Online = connected to agentManager WebSocket
      const onlineAgents = registeredActive.filter(a => liveAgentIds.has(a.agent_id));
      // Offline = active in DB but NOT connected (agentRunner hasn't started them yet)
      const offlineAgents = registeredActive.filter(a => !liveAgentIds.has(a.agent_id));
      // Online but not yet in this guild (need invite)
      const onlineNotInGuild = onlineAgents.filter(a => !liveById.get(a.agent_id)?.guildIds?.includes?.(guildId));
      // Invitable = offline active agents (once runner starts them, they'll need inviting)
      const invitable = offlineAgents;

      // Status emoji legend
      const statusLine = [
        `🟢 **Online:** ${liveAgents.length}`,
        `🔵 **In server:** ${inGuild.length}`,
        `⚪ **Registered:** ${registeredActive.length}`,
        `🔴 **Offline / starting:** ${offlineAgents.length}`,
      ].join("\n");

      const guildHealth = inGuild.length > 0
        ? `🎵 Idle **${idleInGuild.length}**  ·  ⚡ Busy **${busyInGuild.length}**`
        : onlineNotInGuild.length > 0
          ? `${onlineNotInGuild.length} agent(s) online but not yet in this server — use **Deploy** to invite them.`
          : registeredActive.length > 0
            ? `Agents are registered but not in this server yet — use **Deploy** to invite them.`
            : "No agents configured. Use **Add Token** then **Deploy**.";

      const embed = new EmbedBuilder()
        .setTitle("🤖 Agent Status")
        .setColor(inGuild.length > 0 ? Colors.SUCCESS : offlineAgents.length > 0 || onlineNotInGuild.length > 0 ? Colors.WARNING : Colors.INFO)
        .setTimestamp()
        .addFields(
          { name: "Pool", value: `\`${selectedPoolId}\``, inline: true },
          { name: "This Server", value: `${inGuild.length} agent${inGuild.length !== 1 ? 's' : ''}`, inline: true },
          { name: "Status", value: guildHealth, inline: false },
          { name: "Network Overview", value: statusLine, inline: false }
        );

      // In-guild agent list (compact)
      if (inGuild.length > 0) {
        const liveInGuildText = inGuild
          .sort((x, y) => String(x.agentId).localeCompare(String(y.agentId)))
          .map(a => {
            const caps = a.podTag ? ` [${a.podTag}]` : "";
            const statusIcon = !a.ready ? '🔴' : a.busyKey ? '⚡' : '🟢';
            const busyNote = a.busyKey ? ` (${a.busyKind || "busy"})` : "";
            const ident = a.tag ? ` — ${a.tag}` : "";
            return `${statusIcon} \`${a.agentId}\`${caps}${ident}${busyNote}`;
          })
          .join("\n");
        embed.addFields({ name: `Agents in Server (${inGuild.length})`, value: liveInGuildText.slice(0, 1024) });
      }

      // Online but needs invite
      if (onlineNotInGuild.length > 0) {
        const text = onlineNotInGuild
          .sort((x, y) => String(x.agent_id).localeCompare(String(y.agent_id)))
          .map(a => `🔵 \`${a.agent_id}\`${a.tag ? ` — ${a.tag}` : ""}  ← needs invite`)
          .join("\n");
        embed.addFields({ name: `Online — Not Yet in Server (${onlineNotInGuild.length})`, value: text.slice(0, 1024) });
      }

      // Offline active agents
      if (offlineAgents.length > 0) {
        const text = offlineAgents
          .sort((x, y) => String(x.agent_id).localeCompare(String(y.agent_id)))
          .slice(0, 10)
          .map(a => `🔴 \`${a.agent_id}\`${a.tag ? ` — ${a.tag}` : ""}  ← starting`)
          .join("\n");
        const more = offlineAgents.length > 10 ? `\n… and ${offlineAgents.length - 10} more` : "";
        embed.addFields({ name: `Offline — Agent Runner Starting (${offlineAgents.length})`, value: (text + more).slice(0, 512) });
      }

      if (inGuild.length === 0 && registeredActive.length === 0) {
        embed.addFields({
          name: "🚀 Getting Started",
          value: "1. `/pools create` — create an agent pool\n2. `/agents add_token` — register a bot token\n3. `/agents deploy` — get invite links to add bots here"
        });
      }

      // Action buttons: Deploy, Advisor, Sessions, Setup Music, Setup AI
      const statusActionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildDeployUiId("refresh", interaction.user.id, 10, selectedPoolId))
          .setLabel("🚀 Deploy Agents")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(buildAdvisorUiId("refresh", interaction.user.id, 10, selectedPoolId))
          .setLabel("📊 Pool Advisor")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`agentssessions:${interaction.guildId}`)
          .setLabel("📋 Sessions")
          .setStyle(ButtonStyle.Secondary)
      );
      const statusCapabilityRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`agentssetup:music:${interaction.guildId}`)
          .setLabel("🎵 Setup Music")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`agentssetup:ai:${interaction.guildId}`)
          .setLabel("🤖 Setup AI Tools")
          .setStyle(ButtonStyle.Success)
      );

      await replyInteraction(interaction, { embeds: [embed], components: [statusActionRow, statusCapabilityRow] });
    } catch (error) {
      botLogger.error({ err: error }, "[agents:status] Error");
      await replyError(interaction, "Status Failed", `Could not fetch agent status.\n${error.message}`);
    }
    return;
  }

  if (sub === "manifest") {
    try {
      const allAgentsRaw = await fetchAgentBots(); // Fetch all registered agents from DB
      const liveAgents = await mgr.listAgents(); // Currently connected agents
      const selectedPoolId = await getGuildSelectedPool(guildId);
      const agents = selectVisibleRegisteredAgents(
        allAgentsRaw,
        liveAgents,
        guildId,
        selectedPoolId,
        requesterIsBotOwner
      );
      const liveAgentMap = new Map(liveAgents.map(a => [a.agentId, a]));

      const embed = new EmbedBuilder()
        .setTitle("Agent Manifest")
        .setColor(Colors.INFO)
        .setTimestamp();
        
      const descriptionLines = agents
        .sort((x, y) => String(x.agent_id).localeCompare(String(y.agent_id)))
        .map(a => {
          const liveStatus = liveAgentMap.get(a.agent_id);
          const state = liveStatus ? (liveStatus.ready ? (liveStatus.busyKey ? `busy(${liveStatus.busyKind || "?"})` : "idle") : "down") : "offline";
          const inGuildState = liveStatus?.guildIds.includes(guildId) ? "in-guild" : "not-in-guild";
          const profileState = a.profile ? "Yes" : "No";
          const caps = Array.isArray(a.capabilities) && a.capabilities.length ? a.capabilities.join(', ') : 'none';
          return `**${a.agent_id}** (${a.tag})\nDB: \`${a.status}\` | Live: \`${state}\` | Guild: \`${inGuildState}\` | Profile: \`${profileState}\` | Caps: \`${caps}\``;
        });

      if (!descriptionLines.length) {
        embed.setDescription("No visible agents for your current pool scope in this guild.");
      } else {
        embed.setDescription(descriptionLines.join("\n\n").slice(0, 4096));
      }
      if (!requesterIsBotOwner) {
        embed.addFields({
          name: "Scope",
          value: `Showing guild-selected pool \`${selectedPoolId}\` plus agents currently connected in this guild.`,
          inline: false
        });
      }

      await replyInteraction(interaction, { embeds: [embed] });
    } catch (error) {
      botLogger.error({ err: error }, "[agents:manifest] Error");
      await replyError(interaction, "Manifest Failed", `Could not fetch agent manifest.\n${error.message}`);
    }
    return;
  }

  if (sub === "diagnose") {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetAgentId = interaction.options.getString("agent_id", false);
      const allAgentsRaw = await fetchAgentBots();
      const liveAgents = await mgr.listAgents();
      const liveById = new Map(liveAgents.map(a => [a.agentId, a]));

      const agents = targetAgentId
        ? allAgentsRaw.filter(a => a.agent_id === targetAgentId)
        : allAgentsRaw.slice(0, 10);

      if (!agents.length) {
        await interaction.editReply({ content: `❌ No agents found${targetAgentId ? ` matching \`${targetAgentId}\`` : ""}.` });
        return;
      }

      const tokenKeyOk = process.env.AGENT_TOKEN_KEY && process.env.AGENT_TOKEN_KEY.length === 32;
      const runnerSecretOk = Boolean(process.env.AGENT_RUNNER_SECRET);

      const lines = [`**Environment**\n🔑 AGENT_TOKEN_KEY: ${tokenKeyOk ? "✅ 32-byte key found" : "❌ Missing or wrong length — tokens cannot decrypt"}\n🔒 AGENT_RUNNER_SECRET: ${runnerSecretOk ? "✅ Set" : "⚠️ Not set (runner hello may fail)"}\n`];

      for (const a of agents) {
        const live = liveById.get(a.agent_id);
        const inGuild = live?.guildIds?.includes?.(guildId);
        const phase =
          a.status === 'pending' ? "⏳ Pending — awaiting pool owner approval" :
          a.status === 'corrupt' ? `🔴 Corrupt — token failed to decrypt (AGENT_TOKEN_KEY mismatch, enc_version=${a.enc_version ?? "?"})\n   → Fix: re-add token with \`/agents add_token\`` :
          a.status === 'suspended' ? "🟠 Suspended by pool owner" :
          a.status === 'revoked' ? "🔴 Revoked" :
          !live ? "⚪ Active in DB — agentRunner hasn't started it yet (check runner process)" :
          !live.ready ? "🔵 Runner started — waiting for hello from agent client" :
          !inGuild ? `🟡 Online — NOT in this guild\n   → [Invite link](${buildMainInvite(a.client_id)}) — click to add agent to this server` :
          `🟢 Fully online and in this guild`;

        lines.push(`**\`${a.agent_id}\`** — ${a.tag || "no tag"}\n${phase}`);
      }

      if (!targetAgentId && allAgentsRaw.length > 10) {
        lines.push(`\n_+${allAgentsRaw.length - 10} more — use \`agent_id\` option to diagnose specific agents._`);
      }

      const embed = new EmbedBuilder()
        .setTitle("🩺 Agent Diagnostics")
        .setDescription(lines.join("\n\n").slice(0, 4096))
        .setColor(Colors.INFO)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      botLogger.error({ err: error }, "[agents:diagnose] Error");
      await replyError(interaction, "Diagnose Failed", error.message || "Unknown error.");
    }
    return;
  }

  if (sub === "panel" || sub === "advisor_ui" || sub === "deploy_ui") {
    try {
      await renderAdvisorUi(interaction, mgr, ownerIds);
    } catch (error) {
      botLogger.error({ err: error }, "[agents:panel] Error");
      await replyError(interaction, "Panel Failed", error.message || "Unknown error.");
    }
    return;
  }

  if (sub === "deploy") {
    try {
      const desiredTotal = interaction.options.getInteger("desired_total", true);
      const fromPoolOption = interaction.options.getString("from_pool", false);
      const requesterUserId = interaction.user.id;


      // Defer reply because verification may take time
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Determine which pool to use
      let selectedPoolId;
      let selectedPool = null;
      let poolContextNote = "";
      if (fromPoolOption) {
        // User specified a pool - verify it exists and is accessible
        const specifiedPool = await fetchPool(fromPoolOption);
        if (!specifiedPool) {
          trackAgentDeployment(false);
          return await interaction.editReply({
            embeds: [
              buildInfoEmbed(
                "Pool Not Found",
                `Pool \`${fromPoolOption}\` was not found.\nUse \`/pools public\` to list available pools.`,
                Colors.ERROR
              )
            ]
          });
        }
        
        // Check if pool is accessible
        if (!isPoolAccessibleForUser(specifiedPool, requesterUserId, ownerIds)) {
          trackAgentDeployment(false);
          return await interaction.editReply({
            embeds: [
              buildInfoEmbed(
                "Pool Access Denied",
                `Pool \`${fromPoolOption}\` is private and not accessible to you.`,
                Colors.ERROR
              )
            ]
          });
        }
        
        selectedPoolId = fromPoolOption;
        selectedPool = specifiedPool;
        poolContextNote = `Using requested pool (guild default: \`${await getGuildSelectedPool(guildId)}\`).`;
      } else {
        // Use guild's default pool
        selectedPoolId = await getGuildSelectedPool(guildId);
        selectedPool = await fetchPool(selectedPoolId);
        const accessiblePools = await listAccessiblePoolsForUser(requesterUserId, ownerIds);

        if (!selectedPool) {
          const fallback = accessiblePools[0] || null;
          if (!fallback) {
            trackAgentDeployment(false);
            return await interaction.editReply({
              embeds: [
                buildInfoEmbed(
                  "No Accessible Pool",
                  "The guild default pool no longer exists and you do not have access to any replacement pool.\n" +
                  "Use `/pools public` to discover public pools or ask a bot owner to configure one.",
                  Colors.ERROR
                )
              ]
            });
          }
          poolContextNote =
            `Guild default pool \`${selectedPoolId}\` was not found.\n` +
            `Using fallback pool \`${fallback.pool_id}\` for this plan only.`;
          selectedPoolId = fallback.pool_id;
          selectedPool = fallback;
        } else if (!isPoolAccessibleForUser(selectedPool, requesterUserId, ownerIds)) {
          const fallback = accessiblePools.find(p => p.pool_id !== selectedPoolId) || null;
          if (!fallback) {
            trackAgentDeployment(false);
            return await interaction.editReply({
              embeds: [
                buildInfoEmbed(
                  "Pool Access Denied",
                  `Guild default pool \`${selectedPoolId}\` is private and not accessible to you.\n` +
                  "Ask an admin to run `/pools select pool:<public_or_owned_pool_id>`.",
                  Colors.ERROR
                )
              ]
            });
          }
          poolContextNote =
            `Guild default pool \`${selectedPoolId}\` is private and inaccessible to you.\n` +
            `Using fallback pool \`${fallback.pool_id}\` for this plan only.`;
          selectedPoolId = fallback.pool_id;
          selectedPool = fallback;
        } else {
          poolContextNote = "Using guild default pool. Change with `/pools select`.";
        }
      }

      const plan = await mgr.buildDeployPlan(guildId, desiredTotal, selectedPoolId); // Now async with poolId

      // Check for limit error (Level 1: Invariants Locked)
      if (plan.error) {
        trackAgentDeployment(false);
        await interaction.editReply({
          embeds: [
            buildInfoEmbed(
              "Deployment Blocked",
              `${plan.error}\n\nMaximum supported agents per guild: **49**.`,
              Colors.ERROR
            )
          ]
        });
        return;
      }

      const poolAgents = await fetchPoolAgents(selectedPoolId).catch(() => []);
      const accessiblePools = await listAccessiblePoolsForUser(requesterUserId, ownerIds);
      const recommendationCandidates = accessiblePools.filter(p => p.pool_id !== selectedPoolId);
      const recommendationRows = await Promise.all(
        recommendationCandidates.map(async pool => {
          const invitable = await mgr.listInvitableAgentsForGuild(guildId, pool.pool_id).catch(() => []);
          return {
            pool,
            invitableCount: Array.isArray(invitable) ? invitable.length : 0
          };
        })
      );
      const recommendedPools = recommendationRows
        .filter(row => row.invitableCount > 0)
        .sort((a, b) => b.invitableCount - a.invitableCount || String(a.pool.pool_id).localeCompare(String(b.pool.pool_id)))
        .slice(0, 3);

      const embed = buildInfoEmbed(
        "Agent Deployment Plan",
        poolContextNote,
        plan.needInvites > 0 ? Colors.WARNING : Colors.SUCCESS
      ).addFields(
        { name: "Pool", value: summarizePool(selectedPool, selectedPoolId), inline: false },
        { name: "Pool Capacity", value: summarizePoolAgentHealth(poolAgents), inline: false },
        { name: "Desired", value: String(plan.desired), inline: true },
        { name: "Present", value: String(plan.presentCount), inline: true },
        { name: "Need Invites", value: String(plan.needInvites), inline: true },
        { name: "Invite Availability", value: summarizeDeployDiagnostics(plan.diagnostics), inline: false }
      );

      if (plan.invites.length) {
        const inviteLines = plan.invites.map((inv, idx) => {
          const label = inv.tag ? `${inv.agentId} (${inv.tag})` : inv.agentId;
          return `${idx + 1}. ${label}\n<${buildMainInvite(inv.botUserId)}>`;
        });
        embed.addFields({
          name: "Invite Links",
          value: trimText(inviteLines.join("\n"), 1024),
          inline: false
        });
      } else {
        embed.addFields({
          name: "Invite Links",
          value: "No additional invites required right now.",
          inline: false
        });
      }

      if (plan.needInvites > 0 && plan.invites.length === 0) {
        embed.addFields({
          name: "No Available Agents",
          value: trimText(
            [
              explainNoInviteAvailability(plan),
              "Use `/agents deploy from_pool:<pool_id>` with another pool.",
              "Use `/pools public` to discover public pools.",
              "Use `/agents add_token pool:" + selectedPoolId + "` to contribute agents."
            ].join("\n"),
            1024
          ),
          inline: false
        });
      }
      if (plan.needInvites > plan.invites.length) {
        const shortfall = plan.needInvites - plan.invites.length;
        embed.addFields({
          name: "Capacity Gap",
          value: `You still need **${shortfall}** more agent invite(s) to reach your desired total.`,
          inline: false
        });
      }
      if (recommendedPools.length) {
        const lines = recommendedPools.map(row =>
          `• \`${row.pool.pool_id}\` (${row.pool.name}) — ${row.invitableCount} invitable now\n` +
          `  Run: \`/agents deploy desired_total:${desiredTotal} from_pool:${row.pool.pool_id}\``
        );
        embed.addFields({
          name: "Recommended Pools",
          value: trimText(lines.join("\n"), 1024),
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed] });
      const deploymentFulfilled = plan.needInvites === 0 || plan.invites.length >= plan.needInvites;
      trackAgentDeployment(deploymentFulfilled);
      // Track pool stat + evaluate badges
      if (deploymentFulfilled && selectedPoolId) {
        storageLayer.incrementPoolStat(selectedPoolId, 'total_deployments').catch(() => {});
        storageLayer.evaluatePoolBadges(selectedPoolId).catch(() => {});
      }
    } catch (error) {
      botLogger.error({ err: error }, "[agents:deploy] Error");
      trackAgentDeployment(false);
      const embeds = [buildInfoEmbed("Deployment Failed", error.message || "Unknown error.", Colors.ERROR)];
      if (interaction.deferred) {
        await interaction.editReply({ embeds });
      } else {
        await replyInteraction(interaction, { embeds });
      }
    }
    return;
  }

  if (sub === "advisor") {
    try {
      const desiredTotal = interaction.options.getInteger("desired_total", false) ?? 10;
      const setBestDefault = interaction.options.getBoolean("set_best_default", false) === true;


      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const accessiblePools = await listAccessiblePoolsForUser(interaction.user.id, ownerIds);
      if (!accessiblePools.length) {
        await interaction.editReply({
          embeds: [
            buildInfoEmbed(
              "No Accessible Pools",
              "No accessible pools were found for your account.\nUse `/pools public` to discover public pools.",
              Colors.ERROR
            )
          ]
        });
        return;
      }

      const rows = await buildAdvisorRows(mgr, guildId, desiredTotal, accessiblePools);
      const top = rows[0] || null;
      const currentDefault = await getGuildSelectedPool(guildId);

      let updateNote = "";
      if (setBestDefault && top?.pool?.pool_id) {
        await setGuildSelectedPool(guildId, top.pool.pool_id);
        updateNote = `Guild default updated to \`${top.pool.pool_id}\`.`;
      }

      const summaryLines = rows.slice(0, 8).map((row, idx) => summarizeAdvisorRow(row, idx));
      const color = top?.fulfilled ? Colors.SUCCESS : Colors.WARNING;
      const embed = buildInfoEmbed(
        "Agent Pool Advisor",
        "Ranked by immediate deploy capacity for this guild.",
        color
      ).addFields(
        { name: "Desired Total", value: String(desiredTotal), inline: true },
        { name: "Current Default", value: `\`${currentDefault}\``, inline: true },
        { name: "Accessible Pools", value: String(accessiblePools.length), inline: true }
      );

      if (top) {
        const topReason = top.fulfilled
          ? "Can satisfy the target now."
          : explainNoInviteAvailability(top.plan);
        embed.addFields({
          name: "Best Candidate",
          value: [
            `${summarizePool(top.pool, top.pool.pool_id)}`,
            `Present ${top.presentCount} • Need ${top.needInvites} • Links ${top.inviteCount} • Invitable ${top.invitableCount}`,
            trimText(topReason, 240)
          ].join("\n"),
          inline: false
        });
      }

      embed.addFields({
        name: "Pool Ranking",
        value: trimText(summaryLines.join("\n\n"), 1024),
        inline: false
      });

      embed.addFields({
        name: "Next Actions",
        value: [
          "Use the button below to open the interactive deployment panel.",
          `Or deploy directly: \`/agents deploy desired_total:${desiredTotal} from_pool:${top?.pool?.pool_id || currentDefault}\``,
          "Browse public pools: `/pools public`"
        ].join("\n"),
        inline: false
      });

      if (updateNote) {
        embed.addFields({ name: "Update", value: updateNote, inline: false });
      }

      const selectedPoolId = top?.pool?.pool_id || currentDefault || null;
      const actionRows = [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(buildAdvisorUiId("refresh", interaction.user.id, desiredTotal, selectedPoolId))
            .setStyle(ButtonStyle.Primary)
            .setLabel("Open Panel")
        )
      ];

      await interaction.editReply({ embeds: [embed], components: actionRows });
    } catch (error) {
      botLogger.error({ err: error }, "[agents:advisor] Error");
      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [buildInfoEmbed("Advisor Failed", error.message || "Unknown error.", Colors.ERROR)]
        });
      } else {
        await replyError(interaction, "Advisor Failed", error.message || "Unknown error.");
      }
    }
    return;
  }

  if (sub === "idle_policy") {
    try {
      const minutes = interaction.options.getInteger("minutes", false);
      const useDefault = interaction.options.getBoolean("use_default", false) === true;
      const disable = interaction.options.getBoolean("disable", false) === true;
      const configured = (minutes !== null ? 1 : 0) + (useDefault ? 1 : 0) + (disable ? 1 : 0);

      if (configured > 1) {
        await replyError(
          interaction,
          "Invalid Options",
          "Use one option only: `minutes`, `use_default`, or `disable`."
        );
        return;
      }

      const defaultIdleMs = typeof mgr.getDefaultIdleReleaseMs === "function"
        ? mgr.getDefaultIdleReleaseMs()
        : Math.max(0, Number(process.env.AGENT_SESSION_IDLE_RELEASE_MS || 1_800_000));

      const data = await loadGuildData(guildId);
      if (!data.agents || typeof data.agents !== "object" || Array.isArray(data.agents)) {
        data.agents = {};
      }

      let changed = false;
      if (useDefault) {
        delete data.agents.idleReleaseMs;
        changed = true;
      } else if (disable) {
        data.agents.idleReleaseMs = 0;
        changed = true;
      } else if (minutes !== null) {
        data.agents.idleReleaseMs = Math.trunc(Number(minutes) * 60_000);
        changed = true;
      }

      if (changed) {
        await saveGuildData(guildId, data);
        if (typeof mgr.clearGuildIdleReleaseCache === "function") {
          mgr.clearGuildIdleReleaseCache(guildId);
        }
      }

      const guildOverride = Number(data?.agents?.idleReleaseMs);
      const hasOverride = Number.isFinite(guildOverride);
      const effectiveMs = hasOverride
        ? (guildOverride <= 0 ? 0 : guildOverride)
        : (defaultIdleMs <= 0 ? 0 : defaultIdleMs);
      const effectiveMin = effectiveMs > 0 ? Math.max(1, Math.round(effectiveMs / 60_000)) : 0;
      const defaultMin = defaultIdleMs > 0 ? Math.max(1, Math.round(defaultIdleMs / 60_000)) : 0;

      const embed = buildInfoEmbed(
        "Idle Auto-Release Policy",
        "Controls how long inactive agent sessions remain reserved in this server.",
        Colors.INFO
      ).addFields(
        { name: "Global Default", value: defaultIdleMs > 0 ? `${defaultMin} minutes` : "Disabled", inline: true },
        {
          name: "Server Override",
          value: hasOverride
            ? (guildOverride > 0 ? `${Math.max(1, Math.round(guildOverride / 60_000))} minutes` : "Disabled")
            : "None",
          inline: true
        },
        { name: "Effective", value: effectiveMs > 0 ? `${effectiveMin} minutes` : "Disabled", inline: true },
        {
          name: "Update",
          value: "Set `minutes` (1-720), set `disable:true`, or set `use_default:true`.",
          inline: false
        }
      );
      await replyInteraction(interaction, { embeds: [embed] });
    } catch (error) {
      botLogger.error({ err: error }, "[agents:idle_policy] Error");
      await replyError(interaction, "Idle Policy Failed", error.message || "Unknown error.");
    }
    return;
  }

  if (sub === "verify_membership") {
    // Check admin permissions
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await replyError(interaction, "Permission Required", "Only server administrators can verify agent membership.");
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = await interaction.guild.fetch();
    const agentsToCheck = [];
    
    // Get all agents that claim to be in this guild
    for (const agent of mgr.liveAgents.values()) {
      if (agent.guildIds?.has?.(guildId) && agent.botUserId) {
        agentsToCheck.push(agent);
      }
    }

    if (agentsToCheck.length === 0) {
      await interaction.editReply({
        embeds: [
          buildInfoEmbed(
            "No Agents To Verify",
            "No agents currently claim membership in this guild.\nUse `/agents deploy` to request invitations.",
            Colors.INFO
          )
        ]
      });
      return;
    }

    // Fetch actual members from Discord
    const members = await guild.members.fetch({ 
      user: agentsToCheck.map(a => a.botUserId),
      force: true // Force cache refresh
    }).catch(err => {
      botLogger.error({ err }, "[VERIFY_MEMBERSHIP] Error fetching members");
      return null; // Indicate failure
    });

    if (members === null) {
      await interaction.editReply({
        embeds: [
          buildInfoEmbed(
            "Verification Failed",
            "Discord API verification failed. Cache was not modified.",
            Colors.ERROR
          )
        ]
      });
      return;
    }

    const statusLines = [];

    let verified = 0, removed = 0;

    for (const agent of agentsToCheck) {
      const inGuild = members.has(agent.botUserId);
      
      if (inGuild) {
        statusLines.push(`• ${agent.agentId} (${agent.tag}) - in guild`);
        verified++;
      } else {
        statusLines.push(`• ${agent.agentId} (${agent.tag}) - missing, removed from cache`);
        agent.guildIds.delete(guildId);
        removed++;
      }
    }

    const embed = buildInfoEmbed(
      "Membership Verification",
      `Checked **${agentsToCheck.length}** agent(s) for this guild.`,
      removed > 0 ? Colors.WARNING : Colors.SUCCESS
    ).addFields(
      { name: "Verified", value: String(verified), inline: true },
      { name: "Removed", value: String(removed), inline: true },
      { name: "Details", value: trimText(statusLines.join("\n"), 1024), inline: false }
    );
    if (removed > 0) {
      embed.addFields({ name: "Next Step", value: "Run `/agents deploy` to re-invite missing agents.", inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === "sessions") {
    try {
      const sessions = mgr
        .listSessions()
        .filter(s => s.guildId === guildId)
        .map(s => `music ${s.voiceChannelId} -> ${s.agentId}`);

      const assistantSessions = mgr
        .listAssistantSessions()
        .filter(s => s.guildId === guildId)
        .map(s => `assistant ${s.voiceChannelId} -> ${s.agentId}`);

      const lines = [...sessions, ...assistantSessions];
      const embed = buildInfoEmbed(
        "Active Agent Sessions",
        lines.length ? "Current pinned sessions for this guild." : "No active sessions in this guild.",
        lines.length ? Colors.INFO : Colors.SUCCESS
      );
      if (lines.length) {
        embed.addFields({ name: "Sessions", value: trimText(lines.map(v => `• ${v}`).join("\n"), 1024), inline: false });
      }
      await replyInteraction(interaction, { embeds: [embed] });
    } catch (error) {
      botLogger.error({ err: error }, "[agents:sessions] Error");
      await replyError(interaction, "Sessions Failed", error.message || "Unknown error.");
    }
    return;
  }

  if (sub === "assign") {
    try {
      const channel = interaction.options.getChannel("channel", true);
      const agentId = interaction.options.getString("agent_id", true);
      const kind = interaction.options.getString("kind") || "music";
      const agent = mgr.agents.get(agentId);
      if (!agent?.ready || !agent.ws) {
        await replyError(interaction, "Agent Not Ready", `Agent \`${agentId}\` is not ready.`);
        return;
      }
      if (kind === "assistant") {
        mgr.setPreferredAssistant(guildId, channel.id, agentId, 300_000);
      } else {
        mgr.setPreferredAgent(guildId, channel.id, agentId, 300_000);
      }
      await replySuccess(
        interaction,
        "Session Pinned",
        `Pinned \`${agentId}\` to <#${channel.id}> for **${kind}** usage.`
      );
    } catch (error) {
      botLogger.error({ err: error }, "[agents:assign] Error");
      await replyError(interaction, "Assign Failed", error.message || "Unknown error.");
    }
    return;
  }

  if (sub === "release") {
    try {
      const channel = interaction.options.getChannel("channel", true);
      const kind = interaction.options.getString("kind") || "music";

      if (kind === "assistant") {
        const sess = mgr.getAssistantSessionAgent(guildId, channel.id);
        if (sess.ok) {
          try {
            await mgr.request(sess.agent, "assistantLeave", {
              guildId,
              voiceChannelId: channel.id,
              actorUserId: interaction.user.id
            });
          } catch {}
          mgr.releaseAssistantSession(guildId, channel.id);
        }
      } else {
        const sess = mgr.getSessionAgent(guildId, channel.id);
        if (sess.ok) {
          try {
            await mgr.request(sess.agent, "stop", {
              guildId,
              voiceChannelId: channel.id,
              actorUserId: interaction.user.id
            });
          } catch {}
          mgr.releaseSession(guildId, channel.id);
        }
      }

      await replySuccess(
        interaction,
        "Session Released",
        `Released **${kind}** session for <#${channel.id}>.`
      );
    } catch (error) {
      botLogger.error({ err: error }, "[agents:release] Error");
      await replyError(interaction, "Release Failed", error.message || "Unknown error.");
    }
    return;
  }

  if (sub === "scale") {
    const count = interaction.options.getInteger("count", true);
    const scaleToken = String(process.env.AGENT_SCALE_TOKEN || "").trim();
    if (!scaleToken) {
      await replyError(interaction, "Scaling Disabled", "AGENT_SCALE_TOKEN is not configured.");
      return;
    }
    const any = mgr.listAgents().find(a => a.ready);
    if (!any) {
      await replyError(interaction, "No Ready Agent", "No ready agent is available to process the scale request.");
      return;
    }
    const agentObj = mgr.agents.get(any.agentId);
    try {
      const res = await mgr.request(agentObj, "scale", { desiredActive: count, scaleToken });
      await replySuccess(
        interaction,
        "Scale Result",
        `Action: **${res?.action ?? "ok"}**\nActive agents: **${res?.active ?? "?"}**`
      );
    } catch (err) {
      await replyError(interaction, "Scale Failed", String(err?.message ?? err));
    }
    return;
  }

  if (sub === "restart") {
    const agentId = interaction.options.getString("agent_id", true);
    // Use the new updateAgentBotStatus to set status to 'restarting'
    try {
      await mgr.updateAgentBotStatus(agentId, 'restarting');
      await replySuccess(
        interaction,
        "Restart Scheduled",
        `Agent \`${agentId}\` marked for restart. AgentRunner will reconnect it.`
      );
    } catch (error) {
      botLogger.error({ err: error, agentId }, "Error marking agent for restart");
      await replyError(interaction, "Restart Failed", error.message || "Unknown error.");
    }
    return;
  }

  if (sub === "add_token") {
    const token = interaction.options.getString("token", true);
    const clientId = interaction.options.getString("client_id", true);
    const tag = interaction.options.getString("tag", true);
    const poolOption = interaction.options.getString("pool", false);
    const capabilitiesRaw = interaction.options.getString("capabilities", false);
    const agentId = `agent${clientId}`;
    const userId = interaction.user.id;
    const parsedCapabilities = capabilitiesRaw
      ? capabilitiesRaw.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
      : [];

    // Defer immediately since we're doing validation and database queries
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // STEP 1: Validate token is real by attempting to fetch bot user
      let botUser;
      try {
        const { Client, GatewayIntentBits } = await import('discord.js');
        const testClient = new Client({ intents: [GatewayIntentBits.Guilds] });
        
        // Set timeout for validation
        const validationPromise = new Promise(async (resolve, reject) => {
          testClient.once('ready', async () => {
            try {
              botUser = testClient.user;
              await testClient.destroy();
              resolve(botUser);
            } catch (err) {
              await testClient.destroy();
              reject(err);
            }
          });
          
          testClient.on('error', async (err) => {
            await testClient.destroy();
            reject(err);
          });
          
          await testClient.login(token);
        });
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Token validation timeout')), 10000)
        );
        
        botUser = await Promise.race([validationPromise, timeoutPromise]);
        
        // Verify client_id matches
        if (botUser.id !== clientId) {
          return await interaction.editReply({
            embeds: [
              buildInfoEmbed(
                "Client ID Mismatch",
                `Token belongs to **${botUser.tag}** (\`${botUser.id}\`), not \`${clientId}\`.`,
                Colors.ERROR
              )
            ]
          });
        }
        
        // Verify tag matches (approximately)
        if (botUser.tag !== tag && botUser.username !== tag.split('#')[0]) {
          return await interaction.editReply({
            embeds: [
              buildInfoEmbed(
                "Tag Mismatch",
                `This bot is **${botUser.tag}**. Update the tag value and try again.`,
                Colors.ERROR
              )
            ]
          });
        }
        
      } catch (validationError) {
        botLogger.error({ err: validationError }, "[add_token] Token validation failed");
        return await interaction.editReply({
          embeds: [
            buildInfoEmbed(
              "Token Validation Failed",
              `Ensure the token is valid and belongs to a bot account.\n${validationError.message}`,
              Colors.ERROR
            )
          ]
        });
      }

      // STEP 2: Determine target pool and check permissions
      let poolId;
      let isContribution = false;
      
      if (poolOption) {
        // User specified a pool - verify it exists
        const specifiedPool = await fetchPool(poolOption);
        if (!specifiedPool) {
          return await interaction.editReply({ 
            embeds: [buildInfoEmbed("Pool Not Found", `Pool \`${poolOption}\` was not found.`, Colors.ERROR)]
          });
        }
        
        // Check if user owns this pool
        if (specifiedPool.owner_user_id === userId || ownerIds.has(userId)) {
          // User owns pool - direct add
          poolId = poolOption;
        } else if (specifiedPool.visibility === 'public') {
          // Contributing to public pool - mark for verification
          poolId = poolOption;
          isContribution = true;
        } else {
          // Private pool they don't own
          return await interaction.editReply({ 
            embeds: [
              buildInfoEmbed(
                "Pool Access Denied",
                `Pool \`${poolOption}\` is private and you are not the owner.`,
                Colors.ERROR
              )
            ]
          });
        }
      } else {
        // No pool specified - show available options
        const userPools = await fetchPoolsByOwner(userId);
        const publicPools = await listPools();
        const availablePublicPools = publicPools.filter(p => p.visibility === 'public');
        
        if (userPools && userPools.length > 0) {
          // User has their own pool - add there
          poolId = userPools[0].pool_id;
        } else {
          // No personal pool - must contribute to public pool
          if (availablePublicPools.length === 0) {
            return await interaction.editReply({
              embeds: [
                buildInfoEmbed(
                  "No Public Pools",
                  "No public pools are currently available.\nCreate one with `/pools create`.",
                  Colors.WARNING
                )
              ]
            });
          }
          
          // Show available public pools
          let poolList = "";
          for (const p of availablePublicPools) {
            const owner = ownerIds.has(p.owner_user_id) ? 'Bot Owner' : `<@${p.owner_user_id}>`;
            poolList += `• \`${p.pool_id}\` - ${p.name} (by ${owner})\n`;
          }
          
          return await interaction.editReply({
            embeds: [
              buildInfoEmbed(
                "Choose a Pool",
                "Re-run this command with `pool:<pool_id>`.\nExample: `/agents add_token pool:pool_goot27`.",
                Colors.INFO
              ).addFields(
                { name: "Available Public Pools", value: trimText(poolList, 1024), inline: false },
                { name: "Or Create One", value: "`/pools create`", inline: false }
              )
            ]
          });
        }
      }

      // STEP 3: Handle contribution vs direct management
      if (isContribution) {
        // Contributing to public pool - requires verification
        const pool = await fetchPool(poolId);
        
        // Check rate limiting (max 3 contributions per user per hour)
        const recentContributions = await fetchAgentBots();
        const userContributions = recentContributions.filter(a => 
          a.pool_id === poolId && 
          a.contributed_by === userId &&
          a.status === 'pending' &&
          Date.now() - a.created_at < 3600000 // Last hour
        );
        
        if (userContributions.length >= 3 && !ownerIds.has(userId)) {
          return await interaction.editReply({
            embeds: [
              buildInfoEmbed(
                "Contribution Rate Limited",
                "You can contribute up to 3 agents per hour to public pools. Please try again later.",
                Colors.WARNING
              )
            ]
          });
        }
        
        // Add as pending (requires manual activation by pool owner)
        const result = await insertAgentBot(agentId, token, clientId, botUser.tag, poolId, userId, 'pending');
        
        // DM the pool owner to notify them of the pending contribution
        try {
          const ownerUser = await interaction.client.users.fetch(pool.owner_user_id);
          if (ownerUser && ownerUser.id !== userId) {
            await ownerUser.send({
              embeds: [{
                title: '📥 New Agent Contribution',
                description: `**${interaction.user.tag}** submitted agent **${botUser.tag}** to your pool **${pool.name}**.`,
                color: 0xf0a500,
                fields: [
                  { name: 'Agent ID', value: `\`${agentId}\``, inline: true },
                  { name: 'Pool', value: `\`${poolId}\``, inline: true },
                  { name: 'Action', value: 'Run `/pools approve agent_id:' + agentId + '` to activate it.', inline: false }
                ],
                timestamp: new Date()
              }]
            });
          }
        } catch { /* DM may fail if owner has DMs closed — ignore */ }

        const operationMsg = result.operation === 'inserted' ? 'submitted' : 'updated';
        if (parsedCapabilities.length) {
          await updateAgentCapabilities(agentId, parsedCapabilities).catch(() => {});
        }
        await interaction.editReply({
          embeds: [{
            title: 'Contribution submitted',
            description: `Agent **${botUser.tag}** ${operationMsg} to **${pool.name}**.`,
            color: 0x57f287,
            fields: [
              { name: 'Agent ID', value: `\`${agentId}\``, inline: true },
              { name: 'Pool', value: `\`${poolId}\``, inline: true },
              { name: 'Status', value: 'pending', inline: true },
              { name: 'Token', value: `\`${maskToken(token)}\``, inline: false },
              ...(parsedCapabilities.length ? [{ name: 'Capabilities', value: parsedCapabilities.join(', '), inline: false }] : []),
              { 
                name: 'Review',
                value: 'Pool owner reviews and activates if approved.'
              }
            ],
            timestamp: new Date()
          }]
        });
      } else {
        // Adding to own pool - direct activation
        const result = await insertAgentBot(agentId, token, clientId, botUser.tag, poolId, userId);
        const operationMsg = result.operation === 'inserted' ? 'added' : 'updated';
        if (parsedCapabilities.length) {
          await updateAgentCapabilities(agentId, parsedCapabilities).catch(() => {});
        }
        
        const inviteUrl = buildMainInvite(clientId);
        const inviteBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(`➕ Add ${botUser.tag} to this server`)
            .setURL(inviteUrl)
        );
        await interaction.editReply({
          embeds: [{
            title: `Agent ${operationMsg}`,
            description: `Agent **${botUser.tag}** is registered and will start automatically.\n\n> **Next step:** Click the button below to invite the bot to your server so it can receive tasks.`,
            color: 0x57f287,
            fields: [
              { name: 'Agent ID', value: `\`${agentId}\``, inline: true },
              { name: 'Pool', value: `\`${poolId}\``, inline: true },
              { name: 'Status', value: '🟢 Active', inline: true },
              ...(parsedCapabilities.length ? [{ name: '🏷️ Capabilities', value: parsedCapabilities.join(', '), inline: false }] : []),
            ],
            timestamp: new Date()
          }],
          components: [inviteBtn]
        });
      }
      
    } catch (error) {
      botLogger.error({ err: error }, "[add_token] Error");
      await interaction.editReply({ 
        embeds: [buildInfoEmbed("Add Token Failed", error.message || "Unknown error.", Colors.ERROR)]
      });
    }
    return;
  }

  if (sub === "list_tokens") {
    // Defer immediately since we're fetching multiple pools
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const allTokens = await fetchAgentBots();
      let tokens = allTokens;
      if (!requesterIsBotOwner) {
        const accessiblePools = await listAccessiblePoolsForUser(interaction.user.id, ownerIds);
        const accessiblePoolIds = new Set(accessiblePools.map(p => p.pool_id));
        tokens = allTokens.filter(token => accessiblePoolIds.has(token.pool_id || "pool_goot27"));
      }

      if (tokens.length === 0) {
        await interaction.editReply({
          embeds: [
            buildInfoEmbed(
              "No Visible Agent Tokens",
              requesterIsBotOwner
                ? "No agent tokens are currently registered."
                : "No agent tokens are visible from your accessible pools.",
              Colors.INFO
            )
          ]
        });
        return;
      }

      // Group by pool
      const poolMap = new Map();
      for (const token of tokens) {
        const poolId = token.pool_id || 'pool_goot27';
        if (!poolMap.has(poolId)) {
          poolMap.set(poolId, []);
        }
        poolMap.get(poolId).push(token);
      }

      // Fetch all pools at once to avoid sequential queries
      const poolIds = Array.from(poolMap.keys());
      const poolPromises = poolIds.map(id => fetchPool(id));
      const pools = await Promise.all(poolPromises);
      const poolDataMap = new Map();
      pools.forEach((pool, idx) => {
        if (pool) poolDataMap.set(poolIds[idx], pool);
      });

      const embed = new EmbedBuilder()
        .setTitle("Registered Agent Tokens")
        .setColor(Colors.INFO)
        .setTimestamp();
        
      let description = '';
      for (const [poolId, poolTokens] of poolMap) {
        const pool = poolDataMap.get(poolId);
        const poolName = pool ? pool.name : poolId;
        const visibility = pool?.visibility === "public" ? "public" : "private";
        
        description += `\n**${poolName}** (\`${poolId}\`) • ${visibility}\n`;
        const tokenList = poolTokens
          .map(t => `**${t.agent_id}** (${t.tag})\nClient ID: \`${t.client_id}\` | Status: \`${t.status}\``)
          .join("\n");
        description += tokenList + '\n';
      }

      embed.setDescription(description.slice(0, 4096));

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      botLogger.error({ err: error }, "Error listing agent tokens");
      await interaction.editReply({
        embeds: [buildInfoEmbed("List Tokens Failed", error.message || "Unknown error.", Colors.ERROR)]
      });
    }
    return;
  }

  if (sub === "update_token_status") {
    const agentId = interaction.options.getString("agent_id", true);
    const status = interaction.options.getString("status", true);

    try {
      const updated = await updateAgentBotStatus(agentId, status); // Await boolean return
      if (updated) {
        await replySuccess(interaction, "Status Updated", `Agent \`${agentId}\` updated to **${status}**.`);
      } else {
        await replyError(interaction, "Agent Not Found", `Agent \`${agentId}\` was not found.`);
      }
    } catch (error) {
      botLogger.error({ err: error }, "Error updating agent token status");
      await replyError(interaction, "Status Update Failed", error.message || "Unknown error.");
    }
    return;
  }

  if (sub === "delete_token") {
    const agentId = interaction.options.getString("agent_id", true);

    try {
      const allAgents = await fetchAgentBots();
      const agentToDelete = allAgents.find(a => a.agent_id === agentId);

      if (!agentToDelete) {
        await replyError(interaction, "Agent Not Found", `Agent token \`${agentId}\` was not found.`);
        return;
      }

      const confirmId = `confirm_delete_${agentId}_${Date.now()}`;
      const cancelId = `cancel_delete_${agentId}_${Date.now()}`;

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(cancelId)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(confirmId)
            .setLabel("Confirm Delete")
            .setStyle(ButtonStyle.Danger),
        );

      const reply = await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [
          buildInfoEmbed(
            "Confirm Agent Deletion",
            `Delete **${agentToDelete.tag}** (\`${agentId}\`)? This action cannot be undone.`,
            Colors.WARNING
          )
        ],
        components: [row]
      });

      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15000,
        filter: i => i.user.id === interaction.user.id,
      });

      collector.on('collect', async i => {
        if (i.customId === confirmId) {
          const deleted = await deleteAgentBot(agentId);
          if (deleted) {
            await i.update({
              embeds: [buildEmbed("Agent token deleted", `${agentToDelete.tag} (${agentId})`)],
              components: []
            });
          } else {
            await i.update({
              embeds: [buildEmbed("Agent token delete failed", `Agent ${agentId} may already be deleted.`)],
              components: []
            });
          }
        } else {
          await i.update({ embeds: [buildEmbed("Agent token delete", "Deletion cancelled.")], components: [] });
        }
        collector.stop();
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          interaction.editReply({
            embeds: [buildEmbed("Agent token delete", "Confirmation timed out. Deletion cancelled.")],
            components: []
          });
        }
      });

    } catch (error) {
      botLogger.error({ err: error }, "Error during agent token deletion process");
      await replyEmbed(interaction, "Agent token delete", `Error: ${error.message}`);
    }
    return;
  }

  if (sub === "my_agents") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const userId = interaction.user.id;
      const allAgents = await fetchAgentBots();
      const myAgents = allAgents.filter(a => a.contributed_by === userId);

      if (myAgents.length === 0) {
        return await interaction.editReply({
          embeds: [buildInfoEmbed("My Contributed Agents", "You haven't contributed any agents yet. Use `/agents add_token` to contribute to a pool.", Colors.INFO)]
        });
      }

      const poolIds = [...new Set(myAgents.map(a => a.pool_id).filter(Boolean))];
      const poolMap = new Map();
      await Promise.all(poolIds.map(async id => {
        const pool = await fetchPool(id).catch(() => null);
        if (pool) poolMap.set(id, pool);
      }));

      const embed = new EmbedBuilder()
        .setTitle(`Your Contributed Agents (${myAgents.length})`)
        .setColor(Colors.INFO)
        .setTimestamp();

      let desc = '';
      for (const a of myAgents) {
        const pool = poolMap.get(a.pool_id);
        const poolName = pool ? pool.name : a.pool_id;
        const statusEmoji = { active: '🟢', pending: '🟡', suspended: '🟠', revoked: '🔴', approved: '🔵', inactive: '🟡' }[a.status] ?? '⚪';
        desc += `${statusEmoji} **${a.tag}** \`${a.agent_id}\`\n`;
        desc += `   Pool: **${poolName}** • Status: \`${a.status}\`\n`;
      }

      embed.setDescription(desc.slice(0, 4096));
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ embeds: [buildInfoEmbed("My Agents Failed", err.message, Colors.ERROR)] });
    }
    return;
  }

  if (sub === "revoke") {
    const agentId = interaction.options.getString("agent_id", true);
    const userId = interaction.user.id;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const allAgents = await fetchAgentBots();
      const agent = allAgents.find(a => a.agent_id === agentId);

      if (!agent) {
        return await interaction.editReply({ embeds: [buildInfoEmbed("Not Found", `Agent \`${agentId}\` not found.`, Colors.ERROR)] });
      }

      // Only the contributor or a pool manager/owner can revoke
      const isContributor = agent.contributed_by === userId;
      const canManage = await canManagePool(agent.pool_id, userId);
      if (!isContributor && !canManage && !requesterIsBotOwner) {
        return await interaction.editReply({ embeds: [buildInfoEmbed("Not Authorized", "Only the agent contributor or pool manager can revoke this agent.", Colors.ERROR)] });
      }

      if (agent.status === 'revoked') {
        return await interaction.editReply({ embeds: [buildInfoEmbed("Already Revoked", `Agent \`${agentId}\` is already revoked.`, Colors.WARNING)] });
      }

      const confirmId = `confirm_revoke_${agentId}_${Date.now()}`;
      const cancelId  = `cancel_revoke_${agentId}_${Date.now()}`;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cancelId).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(confirmId).setLabel("Revoke Agent").setStyle(ButtonStyle.Danger)
      );

      const reply = await interaction.editReply({
        embeds: [buildInfoEmbed("Confirm Revocation", `Permanently revoke **${agent.tag}** (\`${agentId}\`) from pool? This cannot be undone.`, Colors.WARNING)],
        components: [row]
      });

      const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button, time: 15000, filter: i => i.user.id === userId });
      collector.on('collect', async i => {
        if (i.customId === confirmId) {
          await revokeAgentToken(agentId, userId);
          await i.update({ embeds: [buildInfoEmbed("Agent Revoked", `**${agent.tag}** has been permanently revoked and removed from the pool.`, Colors.SUCCESS)], components: [] });
        } else {
          await i.update({ embeds: [buildInfoEmbed("Revocation Cancelled", "No changes made.", Colors.INFO)], components: [] });
        }
        collector.stop();
      });
      collector.on('end', collected => {
        if (collected.size === 0) interaction.editReply({ embeds: [buildInfoEmbed("Timed Out", "Revocation cancelled.", Colors.INFO)], components: [] });
      });
    } catch (err) {
      await interaction.editReply({ embeds: [buildInfoEmbed("Revoke Failed", err.message, Colors.ERROR)] });
    }
    return;
  }

  if (sub === "set_profile") {
    const agentId = interaction.options.getString("agent_id", true);
    const profileString = interaction.options.getString("profile", true);

    let profileJson;
    try {
      profileJson = JSON.parse(profileString);
    } catch (error) {
      await replyEmbed(interaction, "Agent profile", `Invalid JSON: ${error.message}`);
      return;
    }

    try {
      const updated = await updateAgentBotProfile(agentId, profileJson);
      if (updated) {
        await replyEmbed(interaction, "Agent profile updated", `Agent ${agentId}`);
      } else {
        await replyEmbed(interaction, "Agent profile", `Agent ${agentId} not found.`);
      }
    } catch (error) {
      botLogger.error({ err: error }, "Error setting agent profile");
      await replyEmbed(interaction, "Agent profile", `Error: ${error.message}`);
    }
    return;
  }

  if (sub === "get_profile") {
    const agentId = interaction.options.getString("agent_id", true);

    try {
      const profile = await fetchAgentBotProfile(agentId);
      if (profile) {
        // C3g: Surface agent personality in a readable embed
        const embed = new EmbedBuilder()
          .setTitle(`🤖 Agent Profile — \`${agentId}\``)
          .setColor(Colors.INFO)
          .setTimestamp();

        if (profile.name) embed.addFields({ name: 'Name', value: String(profile.name), inline: true });
        if (profile.persona || profile.personality) embed.addFields({ name: '🎭 Personality', value: String(profile.persona || profile.personality).slice(0, 512), inline: false });
        if (profile.style) embed.addFields({ name: '🎨 Style', value: String(profile.style), inline: true });
        if (profile.voice) embed.addFields({ name: '🎙️ Voice', value: String(profile.voice), inline: true });
        if (profile.specialty) embed.addFields({ name: '⭐ Specialty', value: String(profile.specialty), inline: true });
        if (profile.description) embed.addFields({ name: 'Description', value: String(profile.description).slice(0, 512), inline: false });

        const knownFields = new Set(['name','persona','personality','style','voice','specialty','description']);
        const extra = Object.entries(profile).filter(([k]) => !knownFields.has(k));
        if (extra.length) {
          embed.addFields({ name: 'Extra', value: extra.map(([k,v]) => `\`${k}\`: ${JSON.stringify(v)}`).join('\n').slice(0, 512), inline: false });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
      } else {
        await replyEmbed(interaction, "Agent profile", `No profile set for agent ${agentId}. Use \`/agents set_profile\` to configure personality.`);
      }
    } catch (error) {
      botLogger.error({ err: error }, "Error fetching agent profile");
      await replyEmbed(interaction, "Agent profile", `Error: ${error.message}`);
    }
    return;
  }
  }, { label: "agents" });
}

export async function handleSelect(interaction) {
  if (!interaction.isStringSelectMenu?.()) return false;
  const selectedValue = interaction.values?.[0] || "";

  const deployParsed = parseDeployUiId(interaction.customId);
  if (deployParsed && (deployParsed.action === "desired" || deployParsed.action === "pool")) {
    if (deployParsed.userId !== interaction.user.id) {
      await interaction.reply({
        embeds: [buildInfoEmbed("Panel Locked", "This deployment panel belongs to another user.", Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const mgr = global.agentManager;
    if (!mgr) {
      await interaction.reply({
        embeds: [buildInfoEmbed("Agent Control Offline", "Agent orchestration is not running.", Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const ownerIds = getBotOwnerIds();
    const requested = {
      desiredTotal: deployParsed.action === "desired" ? clampDeployUiDesired(selectedValue) : deployParsed.desired,
      poolId: deployParsed.action === "pool" ? (selectedValue === "_" ? null : selectedValue) : deployParsed.poolId
    };
    await renderAdvisorUi(interaction, mgr, ownerIds, requested, { update: true });
    return true;
  }

  const advisorParsed = parseAdvisorUiId(interaction.customId);
  if (advisorParsed && (advisorParsed.action === "desired" || advisorParsed.action === "pool")) {
    if (advisorParsed.userId !== interaction.user.id) {
      await interaction.reply({
        embeds: [buildInfoEmbed("Panel Locked", "This advisor panel belongs to another user.", Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const mgr = global.agentManager;
    if (!mgr) {
      await interaction.reply({
        embeds: [buildInfoEmbed("Agent Control Offline", "Agent orchestration is not running.", Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const ownerIds = getBotOwnerIds();
    const requested = {
      desiredTotal: advisorParsed.action === "desired" ? clampDeployUiDesired(selectedValue) : advisorParsed.desired,
      poolId: advisorParsed.action === "pool" ? (selectedValue === "_" ? null : selectedValue) : advisorParsed.poolId
    };
    await renderAdvisorUi(interaction, mgr, ownerIds, requested, { update: true });
    return true;
  }

  return false;
}

export async function handleButton(interaction) {
  if (!interaction.isButton?.()) return false;

  const invParsed = parseAgentInvId(interaction.customId);
  if (invParsed) {
    if (invParsed.userId !== interaction.user.id) {
      await interaction.reply({
        embeds: [buildInfoEmbed("Panel Locked", "This invite panel belongs to another user.", Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const mgr = global.agentManager;
    if (!mgr) {
      await interaction.reply({
        embeds: [buildInfoEmbed("Agent Control Offline", "Agent orchestration is not running.", Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const ownerIds = getBotOwnerIds();
    if (!canManageGuild(interaction, ownerIds)) {
      await interaction.reply({
        embeds: [buildInfoEmbed("Permission Required", "You need `Manage Server` to view invite links.", Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const poolId = invParsed.poolId;
    if (!poolId) {
      await interaction.reply({
        embeds: [buildInfoEmbed("No Pool Selected", "Select a pool before generating invite links.", Colors.WARNING)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const desiredTotal = clampDeployUiDesired(invParsed.desired);
    const plan = await mgr.buildDeployPlan(interaction.guildId, desiredTotal, poolId).catch(() => null);
    if (!plan || plan.error) {
      await interaction.reply({
        embeds: [buildInfoEmbed("No Invite Plan", plan?.error || "Could not build deployment plan.", Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (invParsed.action === "download") {
      const file = buildInviteExportFile({
        guildId: interaction.guildId,
        poolId,
        desiredTotal,
        plan
      });
      await interaction.reply({
        embeds: [buildInfoEmbed("Invite Links", "Download generated invite links.", Colors.INFO).setFooter({ text: "In development" })],
        files: [file],
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    if (invParsed.action === "close") {
      await interaction.update({
        embeds: [buildInfoEmbed("Invite Links", "Closed.", Colors.INFO).setFooter({ text: "In development" })],
        components: []
      }).catch(() => {});
      return true;
    }

    if (invParsed.action === "prev" || invParsed.action === "next") {
      await replyInvitePanel(interaction, {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        desiredTotal,
        poolId,
        plan,
        page: invParsed.page,
        update: true
      });
      return true;
    }

    await interaction.reply({
      embeds: [buildInfoEmbed("Unsupported", "Unsupported invite panel action.", Colors.WARNING).setFooter({ text: "In development" })],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const deployParsed = parseDeployUiId(interaction.customId);
  const advisorParsed = parseAdvisorUiId(interaction.customId);
  if (!deployParsed && !advisorParsed) return false;

  const mgr = global.agentManager;
  if (!mgr) {
    await interaction.reply({
      embeds: [buildInfoEmbed("Agent Control Offline", "Agent orchestration is not running.", Colors.ERROR)],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const ownerIds = getBotOwnerIds();

  if (deployParsed && ["refresh", "links", "setdefault"].includes(deployParsed.action)) {
    if (deployParsed.userId !== interaction.user.id) {
      await interaction.reply({
        embeds: [buildInfoEmbed("Panel Locked", "This deployment panel belongs to another user.", Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const requested = { desiredTotal: deployParsed.desired, poolId: deployParsed.poolId };

    if (deployParsed.action === "refresh") {
      await renderAdvisorUi(interaction, mgr, ownerIds, requested, { update: true, note: "Refreshed deployment plan." });
      return true;
    }

    if (deployParsed.action === "setdefault") {
      if (!canManageGuild(interaction, ownerIds)) {
        await interaction.reply({
          embeds: [buildInfoEmbed("Permission Required", "You need `Manage Server` to set the guild default pool.", Colors.ERROR)],
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      if (!deployParsed.poolId) {
        await interaction.reply({
          embeds: [buildInfoEmbed("No Pool Selected", "Select a pool before setting guild default.", Colors.WARNING)],
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      await setGuildSelectedPool(interaction.guildId, deployParsed.poolId);
      await renderAdvisorUi(interaction, mgr, ownerIds, requested, {
        update: true,
        note: `Guild default pool updated to \`${deployParsed.poolId}\`.`
      });
      return true;
    }

    if (deployParsed.action === "links") {
      if (!canManageGuild(interaction, ownerIds)) {
        await interaction.reply({
          embeds: [buildInfoEmbed("Permission Required", "You need `Manage Server` to export invite links.", Colors.ERROR)],
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      const context = await buildDeployUiContext(interaction.guildId, interaction.user.id, ownerIds, mgr, requested);
      const plan = context.plan;
      if (!plan || plan.error) {
        await interaction.reply({
          embeds: [buildInfoEmbed("No Invite Plan", plan?.error || "Could not build deployment plan.", Colors.ERROR)],
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      if (!Array.isArray(plan.invites) || plan.invites.length === 0) {
        await interaction.reply({
          embeds: [buildInfoEmbed("No Invite Links", "No invite links available for this plan.", Colors.WARNING)],
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      await replyInvitePanel(interaction, {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        desiredTotal: context.state.desiredTotal,
        poolId: context.state.selectedPoolId,
        plan,
        page: 0,
        update: false
      });
      return true;
    }
  }

  if (advisorParsed && ["refresh", "links", "setdefault"].includes(advisorParsed.action)) {
    if (advisorParsed.userId !== interaction.user.id) {
      await interaction.reply({
        embeds: [buildInfoEmbed("Panel Locked", "This advisor panel belongs to another user.", Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const requested = { desiredTotal: advisorParsed.desired, poolId: advisorParsed.poolId };

    if (advisorParsed.action === "refresh") {
      await renderAdvisorUi(interaction, mgr, ownerIds, requested, { update: true, note: "Refreshed advisor ranking." });
      return true;
    }

    if (advisorParsed.action === "setdefault") {
      if (!canManageGuild(interaction, ownerIds)) {
        await interaction.reply({
          embeds: [buildInfoEmbed("Permission Required", "You need `Manage Server` to set the guild default pool.", Colors.ERROR)],
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      if (!advisorParsed.poolId) {
        await interaction.reply({
          embeds: [buildInfoEmbed("No Pool Selected", "Select a pool before setting guild default.", Colors.WARNING)],
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      await setGuildSelectedPool(interaction.guildId, advisorParsed.poolId);
      await renderAdvisorUi(interaction, mgr, ownerIds, requested, {
        update: true,
        note: `Guild default pool updated to \`${advisorParsed.poolId}\`.`
      });
      return true;
    }

    if (advisorParsed.action === "links") {
      if (!canManageGuild(interaction, ownerIds)) {
        await interaction.reply({
          embeds: [buildInfoEmbed("Permission Required", "You need `Manage Server` to export invite links.", Colors.ERROR)],
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      const state = await resolveAdvisorUiState(interaction.guildId, interaction.user.id, ownerIds, mgr, requested);
      const selected = state.selectedRow || state.rows[0];
      if (!selected || !selected.plan || selected.plan.error) {
        await interaction.reply({
          embeds: [buildInfoEmbed("No Invite Plan", selected?.plan?.error || "Could not build advisor plan.", Colors.ERROR)],
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      if (!Array.isArray(selected.plan.invites) || selected.plan.invites.length === 0) {
        await interaction.reply({
          embeds: [buildInfoEmbed("No Invite Links", explainNoInviteAvailability(selected.plan), Colors.WARNING)],
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
      await replyInvitePanel(interaction, {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        desiredTotal: state.desiredTotal,
        poolId: selected.pool.pool_id,
        plan: selected.plan,
        page: 0,
        update: false
      });
      return true;
    }
  }

  return false;
}

// Handler for status panel quick-action buttons (sessions + setup shortcuts)
export async function handleStatusButton(interaction) {
  if (!interaction.isButton?.()) return false;
  const cid = String(interaction.customId || "");

  if (cid.startsWith("agentssessions:")) {
    const mgr = global.agentManager;
    if (!mgr) {
      await interaction.reply({ embeds: [buildInfoEmbed("Offline", "Agent control is offline.", Colors.ERROR)], flags: MessageFlags.Ephemeral });
      return true;
    }
    const guildId = interaction.guildId;
    const sessions = mgr.listSessions().filter(s => s.guildId === guildId);
    const assistantSessions = mgr.listAssistantSessions().filter(s => s.guildId === guildId);
    const lines = [
      ...sessions.map(s => `🎵 music  <#${s.voiceChannelId}>  →  \`${s.agentId}\``),
      ...assistantSessions.map(s => `🤖 assistant  <#${s.voiceChannelId}>  →  \`${s.agentId}\``)
    ];
    const embed = buildInfoEmbed(
      "Active Agent Sessions",
      lines.length ? "Live sessions in this server:" : "No active sessions in this server.",
      lines.length ? Colors.INFO : Colors.SUCCESS
    );
    if (lines.length) embed.addFields({ name: `Sessions (${lines.length})`, value: lines.map(l => `• ${l}`).join("\n").slice(0, 1024) });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return true;
  }

  if (cid.startsWith("agentssetup:music:")) {
    const embed = buildInfoEmbed(
      "🎵 Music Setup Guide",
      "To enable music in this server with your agents:",
      Colors.Music ?? Colors.INFO
    ).addFields(
      { name: "1. Deploy Agents", value: "Use `/agents deploy` to invite agent bots with **music** capability into this server.", inline: false },
      { name: "2. Play Music", value: "Use `/music play <song>` to queue a track. Agents will auto-join your voice channel.", inline: false },
      { name: "3. Tip: Agent Capabilities", value: "When registering via `/agents add_token`, set `capabilities: music` so the pool advisor prioritises music-ready agents.", inline: false },
      { name: "4. Need Lavalink?", value: "Lavalink is the audio server. See `SELF_HOSTING.md` for deployment instructions.", inline: false }
    );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return true;
  }

  if (cid.startsWith("agentssetup:ai:")) {
    const embed = buildInfoEmbed(
      "🤖 AI Tools Setup Guide",
      "To enable AI tools for agents in this server:",
      Colors.INFO
    ).addFields(
      { name: "1. Set AI Provider", value: "Use `/ai set-provider` to choose `ollama`, `openai`, `anthropic`, or `groq` as the server default.", inline: false },
      { name: "2. Link Your API Key", value: "Use `/ai token link` to attach your personal API key (encrypted, per-user).", inline: false },
      { name: "3. Chat with Agents", value: "Use `/ai chat` to talk to the AI. Agents with the **assistant** or **chat** capability will handle voice queries.", inline: false },
      { name: "4. Image Generation", value: "Use `/ai image` for AI images. Free via HuggingFace FLUX, or use your OpenAI token for premium quality.", inline: false },
      { name: "5. Deploy AI-Capable Agents", value: "Register agents with `capabilities: chat,tts` via `/agents add_token` for full voice assistant support.", inline: false }
    );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return true;
  }

  return false;
}

export async function autocomplete(interaction) {
  try {
    const focused = interaction.options.getFocused(true);
    if (!focused || (focused.name !== "from_pool" && focused.name !== "pool")) {
      await interaction.respond([]);
      return;
    }

    const userId = interaction.user.id;
    const ownerIds = getBotOwnerIds();
    const pools = await listAccessiblePoolsForUser(userId, ownerIds);
    const query = String(focused.value || "").toLowerCase().trim();

    const options = pools
      .filter(pool => {
        if (!query) return true;
        return String(pool.pool_id).toLowerCase().includes(query)
          || String(pool.name || "").toLowerCase().includes(query);
      })
      .sort((a, b) => String(a.pool_id).localeCompare(String(b.pool_id)))
      .slice(0, 25)
      .map(pool => ({
        name: trimText(`${pool.name} [${pool.visibility}] (${pool.pool_id})`, 100),
        value: String(pool.pool_id)
      }));

    await interaction.respond(options);
  } catch {
    try { await interaction.respond([]); } catch {}
  }
}
