import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
  AttachmentBuilder
} from 'discord.js';
import * as storageLayer from '../utils/storage.js';
import { isBotOwner } from '../utils/owners.js';
import { Colors } from '../utils/discordOutput.js';
import { openAdvisorUiHandoff, openDeployUiHandoff } from './agents.js';
import { canManagePool, getUserPoolRole, logPoolEvent, maskToken } from '../utils/storage.js';

export const meta = {
  guildOnly: false, // Pool management can be done outside guilds
  userPerms: [],
  category: "pools"
};

export const data = new SlashCommandBuilder()
    .setName('pools')
    .setDescription('Manage agent pools')
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('View all accessible pools')
    )
    .addSubcommand((sub) =>
      sub
        .setName('public')
        .setDescription('View all public pools (for contribution)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('ui')
        .setDescription('Interactive pool navigator and deployment planner (guild only)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Interactive pool setup (create/select/visibility/delete)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new agent pool')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Pool display name')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('visibility')
            .setDescription('Pool visibility')
            .setRequired(true)
            .addChoices(
              { name: 'Public', value: 'public' },
              { name: 'Private', value: 'private' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View details of a pool')
        .addStringOption((opt) =>
          opt
            .setName('pool')
            .setDescription('Pool ID (e.g., pool_goot27)')
            .setAutocomplete(true)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('select')
        .setDescription('Select which pool this guild uses (admin only)')
        .addStringOption((opt) =>
          opt
            .setName('pool')
            .setDescription('Pool ID to use for agent deployments')
            .setAutocomplete(true)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('settings')
        .setDescription('Manage your pool settings')
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete your pool (owner only)')
        .addStringOption((opt) =>
          opt
            .setName('pool')
            .setDescription('Pool ID to delete')
            .setAutocomplete(true)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('transfer')
        .setDescription('Transfer pool ownership')
        .addStringOption((opt) =>
          opt
            .setName('pool')
            .setDescription('Pool ID to transfer')
            .setAutocomplete(true)
            .setRequired(true)
        )
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('New owner')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('contributions')
        .setDescription('View and manage pending contributions to your pool')
        .addStringOption((opt) =>
          opt
            .setName('pool')
            .setDescription('Pool ID (defaults to your pool)')
            .setAutocomplete(true)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('approve')
        .setDescription('Approve a pending contribution to your pool')
        .addStringOption((opt) =>
          opt
            .setName('agent_id')
            .setDescription('Agent ID to approve')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('reject')
        .setDescription('Reject a pending contribution to your pool')
        .addStringOption((opt) =>
          opt
            .setName('agent_id')
            .setDescription('Agent ID to reject')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('admin_list')
        .setDescription('List all pools including private (master only)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('admin_view')
        .setDescription('View any pool details (master only)')
        .addStringOption((opt) =>
          opt
            .setName('pool')
            .setDescription('Pool ID')
            .setAutocomplete(true)
            .setRequired(true)
        )
    );

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'list':
          await handleList(interaction);
          break;
        case 'public':
          await handlePublic(interaction);
          break;
        case 'ui':
          await handleUi(interaction);
          break;
        case 'setup':
          await handleSetup(interaction);
          break;
        case 'create':
          await handleCreate(interaction);
          break;
        case 'view':
          await handleView(interaction);
          break;
        case 'select':
          await handleSelectPool(interaction);
          break;
        case 'settings':
          await handleSettings(interaction);
          break;
        case 'contributions':
          await handleContributions(interaction);
          break;
        case 'approve':
          await handleApprove(interaction);
          break;
        case 'reject':
          await handleReject(interaction);
          break;
        case 'delete':
          await handleDelete(interaction);
          break;
        case 'transfer':
          await handleTransfer(interaction);
          break;
        case 'admin_list':
          await handleAdminList(interaction);
          break;
        case 'admin_view':
          await handleAdminView(interaction);
          break;
        default:
          await interaction.reply({
            embeds: [buildPoolEmbed('Unknown Subcommand', 'This pool action is not recognized.', Colors.ERROR)],
            ephemeral: true
          });
      }
    } catch (error) {
      console.error('[pools]', error);
      const replyMethod = interaction.deferred ? 'editReply' : 'reply';
      await interaction[replyMethod]({
        embeds: [buildPoolEmbed('Pool Command Failed', error?.message || 'Unknown error.', Colors.ERROR)],
        ephemeral: true
      }).catch(() => {});
    }
}

// ========== HELPERS ==========

function isMaster(userId) {
  return isBotOwner(userId);
}

function isGuildAdmin(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

function canManageGuild(interaction) {
  const perms = interaction?.memberPermissions ?? interaction?.member?.permissions;
  if (!perms?.has) return false;
  return (
    perms.has(PermissionFlagsBits.Administrator) ||
    perms.has(PermissionFlagsBits.ManageGuild)
  );
}

async function canAccessPool(userId, poolId, pool) {
  // Pool owner or manager can manage
  if (pool && pool.owner_user_id === userId) return true;
  if (poolId && await canManagePool(poolId, userId)) return true;
  // Public pools visible to anyone
  if (pool && pool.visibility === 'public') return true;
  // isMaster gets existence-only view (admin_list / admin_view) — NOT management
  return false;
}

/**
 * Build a visual capacity bar: e.g. "████░░░░░░ 4/10"
 */
function buildCapacityBar(current, max, width = 10) {
  const filled = Math.min(Math.round((current / Math.max(max, 1)) * width), width);
  return '█'.repeat(filled) + '░'.repeat(width - filled) + ` ${current}/${max}`;
}

function buildPoolEmbed(title, description = '', color = Colors.INFO) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(String(description || '').slice(0, 4096))
    .setColor(color)
    .setTimestamp();
}

function buildOpenSetupButtonRow(userId, poolId = null, desired = 10) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(poolUiId('refresh', userId, clampPoolUiDesired(desired), poolId))
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Open Pool Navigator')
    )
  ];
}

const POOL_UI_PREFIX = 'poolui';
const POOL_UI_DESIRED = [10, 20, 30, 40, 49];

const POOL_INV_PREFIX = 'poolinv';
const INVITES_PER_PAGE = 10; // 2 rows of 5 link buttons + nav row (fits Discord limits)

function encodeValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '_';
  return encodeURIComponent(raw);
}

function decodeValue(value) {
  const raw = String(value || '');
  if (!raw || raw === '_') return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function poolUiId(action, userId, desired, poolId) {
  return `${POOL_UI_PREFIX}:${action}:${userId}:${desired}:${encodeValue(poolId)}`;
}

function parsePoolUiId(customId) {
  const parts = String(customId || '').split(':');
  if (parts.length < 5 || parts[0] !== POOL_UI_PREFIX) return null;
  const desired = Number(parts[3]);
  return {
    action: parts[1],
    userId: parts[2],
    desired: Number.isFinite(desired) ? desired : 10,
    poolId: decodeValue(parts.slice(4).join(':'))
  };
}

function poolInvId(action, userId, desired, page, poolId) {
  const p = Number.isFinite(Number(page)) ? Math.max(0, Math.trunc(Number(page))) : 0;
  return `${POOL_INV_PREFIX}:${action}:${userId}:${desired}:${p}:${encodeValue(poolId)}`;
}

function parsePoolInvId(customId) {
  const parts = String(customId || '').split(':');
  if (parts.length < 6 || parts[0] !== POOL_INV_PREFIX) return null;
  const desired = Number(parts[3]);
  const page = Number(parts[4]);
  return {
    action: parts[1],
    userId: parts[2],
    desired: Number.isFinite(desired) ? desired : 10,
    page: Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0,
    poolId: decodeValue(parts.slice(5).join(':'))
  };
}

function inviteLabel(inv, idx) {
  const tag = String(inv?.tag || '').trim();
  const agentId = String(inv?.agentId || '').trim();
  const base = tag ? tag : (agentId ? agentId : `Agent ${idx + 1}`);
  return base.slice(0, 80);
}

function buildInvitePanelEmbed({ guildId, poolId, desired, plan, page, pages }) {
  const invites = Array.isArray(plan?.invites) ? plan.invites : [];
  const present = Number(plan?.presentCount || 0);
  const need = Number(plan?.needInvites || 0);
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
      { name: "Desired", value: String(desired ?? "n/a"), inline: true },
      { name: "Present", value: String(present), inline: true },
      { name: "Need", value: String(need), inline: true },
      { name: "Invites", value: String(total), inline: true }
    )
    .setFooter({ text: "In development" })
    .setTimestamp();
}

function buildInvitePanelComponents({ userId, desired, poolId, plan, page, pages }) {
  const invites = Array.isArray(plan?.invites) ? plan.invites : [];
  const rows = [];

  const start = page * INVITES_PER_PAGE;
  const slice = invites.slice(start, start + INVITES_PER_PAGE);
  const btns = slice
    .map((inv, i) => {
      const url = String(inv?.inviteUrl || '').trim();
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
        .setCustomId(poolInvId("prev", userId, desired, Math.max(0, page - 1), poolId))
        .setLabel("Prev")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(poolInvId("next", userId, desired, Math.min(pages - 1, page + 1), poolId))
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages - 1),
      new ButtonBuilder()
        .setCustomId(poolInvId("download", userId, desired, page, poolId))
        .setLabel("Download All")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(invites.length === 0),
      new ButtonBuilder()
        .setCustomId(poolInvId("close", userId, desired, page, poolId))
        .setLabel("Close")
        .setStyle(ButtonStyle.Danger)
    )
  );

  return rows.slice(0, 5);
}

function buildInviteExportFile({ guildId, poolId, desired, plan }) {
  const invites = Array.isArray(plan?.invites) ? plan.invites : [];
  const lines = [];
  lines.push('# Chopsticks Pool Invite Links');
  lines.push(`guild=${guildId || ""}`);
  lines.push(`pool=${poolId || ""}`);
  lines.push(`desired=${desired || ""}`);
  lines.push(`present=${plan?.presentCount ?? ""}`);
  lines.push(`need=${plan?.needInvites ?? ""}`);
  lines.push(`generated=${invites.length}`);
  lines.push('');
  for (let i = 0; i < invites.length; i += 1) {
    const inv = invites[i];
    const label = inv.tag ? `${inv.agentId} (${inv.tag})` : inv.agentId;
    lines.push(`${i + 1}. ${label}`);
    lines.push(inv.inviteUrl);
    lines.push('');
  }
  return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), {
    name: `pool-invites-${poolId || "pool"}-${Date.now()}.txt`
  });
}

async function replyInvitePanel(interaction, { guildId, userId, desired, poolId, plan, page = 0, update = false } = {}) {
  const invites = Array.isArray(plan?.invites) ? plan.invites : [];
  const pages = Math.max(1, Math.ceil(invites.length / INVITES_PER_PAGE));
  const safePage = Math.max(0, Math.min(pages - 1, Math.trunc(Number(page) || 0)));

  const embed = buildInvitePanelEmbed({ guildId, poolId, desired, plan, page: safePage, pages });
  const components = buildInvitePanelComponents({ userId, desired, poolId, plan, page: safePage, pages });

  const payload = { embeds: [embed], components, flags: MessageFlags.Ephemeral };
  if (update) return interaction.update(payload);
  return interaction.reply(payload);
}

function clampPoolUiDesired(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 10;
  if (POOL_UI_DESIRED.includes(n)) return n;
  if (n >= 49) return 49;
  if (n >= 40) return 40;
  if (n >= 30) return 30;
  if (n >= 20) return 20;
  return 10;
}

function summarizePoolAgentHealth(agents) {
  const total = Array.isArray(agents) ? agents.length : 0;
  if (total === 0) return '0 total • 0 active • 0 inactive';
  const active = agents.filter(a => a.status === 'active').length;
  const inactive = Math.max(0, total - active);
  return `${total} total • ${active} active • ${inactive} inactive`;
}

function summarizeDeployDiagnostics(diag) {
  const d = diag && typeof diag === 'object' ? diag : {};
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
  ].join('\n');
}

function explainNoInviteAvailability(plan) {
  const d = plan?.diagnostics || {};
  if (Number(d.scopedTotal || 0) === 0) return 'This pool has no registered agents.';
  if (Number(d.activeTotal || 0) === 0) return 'All agents in this pool are inactive/pending.';
  if (Number(d.missingToken || 0) > 0) {
    return 'Some identities exist but cannot run (token unusable, likely AGENT_TOKEN_KEY rotated). Re-register agents with /agents add_token.';
  }
  if (Number(d.invitable || 0) === 0 && Number(d.alreadyInGuild || 0) > 0) {
    return 'All active identities in this pool already appear present in this guild.';
  }
  if (Number(d.invitable || 0) === 0) return 'No eligible identities are currently invitable from this pool.';
  return 'Invite generation is currently limited by pool capacity.';
}

async function listAccessiblePoolsForUser(userId) {
  const allPools = await storageLayer.listPools();
  const accessible = await Promise.all(allPools.map(async pool =>
    pool.visibility === 'public' || await canManagePool(pool.pool_id, userId)
  ));
  return allPools.filter((_, i) => accessible[i]);
}

async function buildPoolUiContext({ guildId, userId, selectedPoolId = null, desiredTotal = 10 }) {
  const mgr = global.agentManager;
  const pools = await listAccessiblePoolsForUser(userId);
  const guildDefaultPool = guildId ? await storageLayer.getGuildSelectedPool(guildId) : null;

  let selected = null;
  if (selectedPoolId) selected = pools.find(p => p.pool_id === selectedPoolId) || null;
  if (!selected && guildDefaultPool) selected = pools.find(p => p.pool_id === guildDefaultPool) || null;
  if (!selected) selected = pools[0] || null;

  const desired = clampPoolUiDesired(desiredTotal);
  let poolAgents = [];
  let plan = null;
  if (selected) {
    poolAgents = await storageLayer.fetchPoolAgents(selected.pool_id).catch(() => []);
    if (guildId && mgr?.buildDeployPlan) {
      plan = await mgr.buildDeployPlan(guildId, desired, selected.pool_id).catch(() => null);
    }
  }

  return {
    mgr,
    pools,
    selectedPool: selected,
    selectedPoolId: selected?.pool_id || null,
    ownedPoolId: `pool_${userId}`,
    desired,
    inGuild: Boolean(guildId),
    guildDefaultPool,
    poolAgents: Array.isArray(poolAgents) ? poolAgents : [],
    plan,
    canManageGuild: false
  };
}

function buildPoolUiEmbed(ctx, { note = '' } = {}) {
  if (!ctx.selectedPool) {
    return buildPoolEmbed(
      'Pool Navigator',
      'No accessible pools were found. Use `/pools public` to discover public pools.',
      Colors.ERROR
    );
  }

  const pool = ctx.selectedPool;
  const plan = ctx.plan;
  const need = Number(plan?.needInvites || 0);
  const inviteCount = Array.isArray(plan?.invites) ? plan.invites.length : 0;
  const color = ctx.inGuild && need > 0 ? Colors.WARNING : Colors.SUCCESS;

  const embed = new EmbedBuilder()
    .setTitle('Pool Navigator')
    .setColor(color)
    .setDescription(`Viewing **${pool.name}** (\`${pool.pool_id}\`)`)
    .addFields(
      { name: 'Visibility', value: pool.visibility, inline: true },
      { name: 'Owner', value: `<@${pool.owner_user_id}>`, inline: true },
      { name: 'Guild Default', value: ctx.guildDefaultPool ? `\`${ctx.guildDefaultPool}\`` : 'n/a', inline: true },
      { name: 'Pool Health', value: summarizePoolAgentHealth(ctx.poolAgents), inline: false },
      { name: 'Desired', value: String(ctx.desired), inline: true }
    )
    .setTimestamp();

  if (ctx.inGuild && plan) {
    embed.addFields(
      { name: 'Present', value: String(plan?.presentCount ?? 0), inline: true },
      { name: 'Need Invites', value: String(need), inline: true },
      { name: 'Invite Availability', value: summarizeDeployDiagnostics(plan?.diagnostics), inline: false }
    );

    if (need > inviteCount) {
      embed.addFields({
        name: 'Capacity Gap',
        value: `Need ${need}, generated ${inviteCount}.\n${explainNoInviteAvailability(plan)}`,
        inline: false
      });
    }
  } else {
    embed.addFields({
      name: 'Deployment Planning',
      value: 'Run `/pools ui` inside a server to compute deploy capacity and generate invite links.',
      inline: false
    });
  }
  if (note) {
    embed.addFields({ name: 'Update', value: String(note).slice(0, 1024), inline: false });
  }
  embed.addFields({
    name: 'Quick Setup',
    value: [
      'Use **Actions** to create, switch, toggle visibility, or delete your pool.',
      'Use **Set Guild Default** to make this server deploy from the selected pool.',
      'Use **Invite Links** to export deploy links for missing agents.'
    ].join('\n'),
    inline: false
  });
  return embed;
}

function buildPoolUiComponents(ctx, userId) {
  const canManage = Boolean(ctx.canManageGuild);
  const desiredSelect = new StringSelectMenuBuilder()
    .setCustomId(poolUiId('desired', userId, ctx.desired, ctx.selectedPoolId))
    .setPlaceholder('Desired total')
    .addOptions(
      POOL_UI_DESIRED.map(value => ({
        label: `${value} agents`,
        value: String(value),
        default: value === ctx.desired
      }))
    );

  const poolSelect = new StringSelectMenuBuilder()
    .setCustomId(poolUiId('pool', userId, ctx.desired, ctx.selectedPoolId))
    .setPlaceholder(ctx.pools.length ? 'Select a pool' : 'No pools available')
    .setDisabled(ctx.pools.length === 0);
  if (ctx.pools.length) {
    poolSelect.addOptions(
      ctx.pools.slice(0, 25).map(pool => ({
        label: `${pool.name}`.slice(0, 100),
        value: pool.pool_id,
        description: `${pool.visibility} • ${pool.pool_id}`.slice(0, 100),
        default: pool.pool_id === ctx.selectedPoolId
      }))
    );
  } else {
    poolSelect.addOptions({ label: 'No accessible pools', value: '_', default: true });
  }

  const actionSelect = new StringSelectMenuBuilder()
    .setCustomId(poolUiId('action', userId, ctx.desired, ctx.selectedPoolId))
    .setPlaceholder('Pool actions')
    .addOptions([
      {
        label: 'Open My Pool',
        value: 'open_my_pool',
        description: 'Jump to your owned pool.'
      },
      {
        label: 'Create My Pool (Private)',
        value: 'create_private',
        description: 'Create your personal pool with private visibility.'
      },
      {
        label: 'Create My Pool (Public)',
        value: 'create_public',
        description: 'Create your personal pool with public visibility.'
      },
      {
        label: 'Toggle Selected Visibility',
        value: 'toggle_visibility',
        description: 'Owner only: flip selected pool between public/private.'
      },
      {
        label: 'Delete Selected (Empty)',
        value: 'delete_selected',
        description: 'Owner only: delete selected pool if no agents are registered.'
      }
    ]);

  const refresh = new ButtonBuilder()
    .setCustomId(poolUiId('refresh', userId, ctx.desired, ctx.selectedPoolId))
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Refresh');
  const deployUi = new ButtonBuilder()
    .setCustomId(poolUiId('deployui', userId, ctx.desired, ctx.selectedPoolId))
    .setStyle(ButtonStyle.Primary)
    .setLabel('Open Deploy UI')
    .setDisabled(!ctx.inGuild || !ctx.selectedPoolId || !canManage);
  const advisorUi = new ButtonBuilder()
    .setCustomId(poolUiId('advisorui', userId, ctx.desired, ctx.selectedPoolId))
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Open Advisor UI')
    .setDisabled(!ctx.inGuild || !canManage);
  const inviteLinks = new ButtonBuilder()
    .setCustomId(poolUiId('links', userId, ctx.desired, ctx.selectedPoolId))
    .setStyle(ButtonStyle.Primary)
    .setLabel('Invite Links')
    .setDisabled(!ctx.inGuild || !ctx.selectedPoolId || !canManage);
  const setDefault = new ButtonBuilder()
    .setCustomId(poolUiId('setdefault', userId, ctx.desired, ctx.selectedPoolId))
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Set Guild Default')
    .setDisabled(!ctx.inGuild || !ctx.selectedPoolId || ctx.selectedPoolId === ctx.guildDefaultPool || !canManage);

  return [
    new ActionRowBuilder().addComponents(desiredSelect),
    new ActionRowBuilder().addComponents(poolSelect),
    new ActionRowBuilder().addComponents(actionSelect),
    new ActionRowBuilder().addComponents(refresh, deployUi, inviteLinks, advisorUi, setDefault)
  ];
}

function buildPoolListJumpRow(userId, pools, { desired = 10 } = {}) {
  const list = Array.isArray(pools) ? pools : [];
  if (list.length === 0) return [];

  const select = new StringSelectMenuBuilder()
    // Reuse the pool navigator handler: selecting a pool transitions the message into the navigator UI.
    .setCustomId(poolUiId('pool', userId, clampPoolUiDesired(desired), null))
    .setPlaceholder('Jump to a pool (opens navigator)')
    .addOptions(
      list.slice(0, 25).map(pool => ({
        label: String(pool.name || pool.pool_id).slice(0, 100),
        value: pool.pool_id,
        description: `${pool.visibility} • ${pool.pool_id}`.slice(0, 100),
      }))
    );

  return [new ActionRowBuilder().addComponents(select)];
}

async function renderPoolUi(interaction, { update = false, requested = {}, note = '' } = {}) {
  const ctx = await buildPoolUiContext({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    selectedPoolId: requested.poolId ?? null,
    desiredTotal: requested.desiredTotal ?? 10
  });
  ctx.canManageGuild = canManageGuild(interaction) || isMaster(interaction.user.id);
  const embed = buildPoolUiEmbed(ctx, { note });
  const components = buildPoolUiComponents(ctx, interaction.user.id);
  if (update) {
    await interaction.update({ embeds: [embed], components });
  } else {
    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  }
  return ctx;
}

// ========== LIST POOLS ==========

async function handleList(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const allPools = await storageLayer.listPools();
  
  if (!allPools || allPools.length === 0) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('No Pools Found', 'No pools are currently registered.', Colors.INFO)],
      components: buildOpenSetupButtonRow(userId, null, 10)
    });
  }

  // Filter pools based on visibility and ownership
  const accessibleFlags = await Promise.all(allPools.map(async pool =>
    pool.visibility === 'public' || await canManagePool(pool.pool_id, userId)
  ));
  const visiblePools = allPools.filter((_, i) => accessibleFlags[i]);

  if (visiblePools.length === 0) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('No Accessible Pools', 'You do not currently have access to any pools.', Colors.INFO)],
      components: buildOpenSetupButtonRow(userId, null, 10)
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('Agent Pools')
    .setColor(Colors.INFO)
    .setDescription('Available agent pools for deployments')
    .setTimestamp();

  // Fetch all pool agents in parallel to avoid sequential queries
  const agentPromises = visiblePools.map(pool => storageLayer.fetchPoolAgents(pool.pool_id));
  const allAgents = await Promise.all(agentPromises);

  for (let i = 0; i < visiblePools.length; i++) {
    const pool = visiblePools[i];
    const agents = allAgents[i];
    const totalAgents = agents ? agents.length : 0;
    
    // Owner display
    const owner = `<@${pool.owner_user_id}>`;
    
    // Agent status
    let agentStatus = '';
    if (totalAgents === 0) {
      agentStatus = '**0 agents** ⚠️';
    } else {
      const activeAgents = agents.filter(a => a.status === 'active');
      const inactiveAgents = totalAgents - activeAgents.length;
      
      if (activeAgents.length === 0) {
        agentStatus = `**${totalAgents} agents** (⚠️ all inactive)`;
      } else if (inactiveAgents === 0) {
        agentStatus = `**${totalAgents} agents** (✅ all active)`;
      } else {
        agentStatus = `**${totalAgents} agents** (✅ ${activeAgents.length} active, ⚠️ ${inactiveAgents} inactive)`;
      }
    }
    
    let fieldValue = `${pool.visibility === 'public' ? '**Public**' : '**Private**'} | Owner: ${owner}\n`;
    fieldValue += `${agentStatus}`;
    
    embed.addFields({
      name: `${pool.name} \`${pool.pool_id}\``,
      value: fieldValue,
      inline: false,
    });
  }

  embed.setFooter({ text: `Total visible pools: ${visiblePools.length}` });

  await interaction.editReply({
    embeds: [embed],
    components: [
      ...buildPoolListJumpRow(userId, visiblePools, { desired: 10 }),
      ...buildOpenSetupButtonRow(userId, null, 10)
    ]
  });
}

// ========== PUBLIC POOLS (FOR CONTRIBUTION) ==========

async function handlePublic(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const allPools = await storageLayer.listPools();
  const publicPools = allPools.filter(pool => pool.visibility === 'public');
  
  if (publicPools.length === 0) {
    return interaction.editReply({
      embeds: [
        buildPoolEmbed(
          'No Public Pools',
          'No public pools are available for contribution right now.',
          Colors.INFO
        )
      ],
      components: buildOpenSetupButtonRow(interaction.user.id, null, 10)
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('Public Pools - Available for Contribution')
    .setColor(Colors.INFO)
    .setDescription('Choose a pool to contribute your agents to')
    .setTimestamp();

  // Fetch all pool agents in parallel
  const agentPromises = publicPools.map(pool => storageLayer.fetchPoolAgents(pool.pool_id));
  const allAgents = await Promise.all(agentPromises);

  for (let i = 0; i < publicPools.length; i++) {
    const pool = publicPools[i];
    const agents = allAgents[i];
    const totalAgents = agents ? agents.length : 0;
    const activeAgents = agents ? agents.filter(a => a.status === 'active') : [];
    const maxAgents = pool.max_agents ?? 49;
    const recommended = pool.recommended_deploy ?? 10;
    const owner = `<@${pool.owner_user_id}>`;
    
    let healthLabel = 'Healthy';
    if (totalAgents === 0) healthLabel = 'Empty';
    else if (activeAgents.length === 0 || activeAgents.length < totalAgents / 2) healthLabel = 'Limited';
    
    let fieldValue = `Status: **${healthLabel}**\n`;
    fieldValue += `Capacity: \`${buildCapacityBar(totalAgents, maxAgents)}\`\n`;
    fieldValue += `Active: **${activeAgents.length}** · Recommended deploy: **${recommended}**\n`;
    fieldValue += `**Owner:** ${owner}\n`;
    fieldValue += `**Contribute:** \`/agents add_token pool:${pool.pool_id}\``;
    
    embed.addFields({
      name: `${pool.name} \`${pool.pool_id}\``,
      value: fieldValue,
      inline: false,
    });
  }

  embed.setFooter({ 
    text: `${publicPools.length} public pool${publicPools.length === 1 ? '' : 's'} available - Contributions require approval` 
  });

  await interaction.editReply({
    embeds: [embed],
    components: [
      ...buildPoolListJumpRow(interaction.user.id, publicPools, { desired: 10 }),
      ...buildOpenSetupButtonRow(interaction.user.id, null, 10)
    ]
  });
}

// ========== INTERACTIVE POOL UI ==========

async function handleUi(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({
      embeds: [buildPoolEmbed('Guild Only', 'Pool navigator UI requires a server context.', Colors.ERROR)],
      ephemeral: true
    });
    return;
  }

  await renderPoolUi(interaction, { update: false });
}

async function handleSetup(interaction) {
  await handleUi(interaction);
}

// ========== CREATE POOL ==========

async function handleCreate(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolName = interaction.options.getString('name');
  const visibility = interaction.options.getString('visibility');

  // Generate pool ID
  const poolId = `pool_${userId}`;

  // Check if user already has a pool
  const existing = await storageLayer.fetchPool(poolId);
  if (existing) {
    return interaction.editReply({
      embeds: [
        buildPoolEmbed(
          'Pool Already Exists',
          `You already have **${existing.name}** (\`${poolId}\`).`,
          Colors.WARNING
        )
      ],
      components: buildOpenSetupButtonRow(userId, existing.pool_id, 10)
    });
  }

  // Create the pool
  const created = await storageLayer.createPool(poolId, userId, poolName, visibility);
  
  if (!created) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Create Failed', 'Failed to create pool. Please try again.', Colors.ERROR)]
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('Pool Created')
    .setColor(Colors.SUCCESS)
    .setDescription(`Your pool **${poolName}** has been created.`)
    .addFields(
      { name: 'Pool ID', value: `\`${poolId}\``, inline: true },
      { name: 'Visibility', value: visibility === 'public' ? 'Public' : 'Private', inline: true },
      { name: 'Owner', value: `<@${userId}>`, inline: true }
    )
    .setFooter({ text: 'Use /agents add_token to add agents to your pool' })
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
    components: buildOpenSetupButtonRow(userId, poolId, 10)
  });
}

// ========== VIEW POOL ==========

async function handleView(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolId = interaction.options.getString('pool');

  const pool = await storageLayer.fetchPool(poolId);
  
  if (!pool) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Pool Not Found', `Pool \`${poolId}\` does not exist.`, Colors.ERROR)]
    });
  }

  // Check access
  const hasAccess = await canAccessPool(userId, poolId, pool);
  
  if (!hasAccess) {
    return interaction.editReply({
      embeds: [
        buildPoolEmbed(
          'Pool Access Denied',
          `Pool \`${poolId}\` is private and you do not have access.`,
          Colors.ERROR
        )
      ]
    });
  }

  // Fetch agents in this pool
  const agents = await storageLayer.fetchPoolAgents(poolId);
  const agentCount = agents ? agents.length : 0;
  const activeAgents = agents ? agents.filter(a => a.status === 'active') : [];

  const embed = new EmbedBuilder()
    .setTitle(`${pool.name}`)
    .setColor(pool.visibility === 'public' ? Colors.INFO : Colors.WARNING)
    .setDescription(`Pool ID: \`${pool.pool_id}\``)
    .addFields(
      { name: 'Owner', value: `<@${pool.owner_user_id}>`, inline: true },
      { name: 'Visibility', value: pool.visibility === 'public' ? 'Public' : 'Private', inline: true },
      { name: 'Total Agents', value: `${agentCount}`, inline: true },
      { name: 'Active Agents', value: `${activeAgents.length}`, inline: true },
      { name: 'Created', value: `<t:${Math.floor(pool.created_at / 1000)}:R>`, inline: true }
    )
    .setTimestamp();

  // Show agent list if owner or public
  if (pool.visibility === 'public' || await canManagePool(poolId, userId)) {
    if (agentCount > 0) {
      const agentList = agents
        .slice(0, 10) // Max 10 agents
        .map((a) => {
          const statusText = a.status === 'active' ? 'active' : 'inactive';
          return `• ${a.tag} (\`${a.agent_id}\`) - ${statusText}`;
        })
        .join('\n');
      
      embed.addFields({
        name: 'Agents',
        value: agentList + (agentCount > 10 ? `\n*...and ${agentCount - 10} more*` : ''),
      });
    } else {
      embed.addFields({
        name: 'Agents',
        value: '*No agents registered*',
      });
    }
  }

  await interaction.editReply({
    embeds: [embed],
    components: buildOpenSetupButtonRow(userId, pool.pool_id, 10)
  });
}

// ========== SELECT POOL ==========

async function handleSelectPool(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolId = interaction.options.getString('pool');
  const guildId = interaction.guildId;

  if (!guildId) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Guild Only', 'Pool selection must be run inside a server.', Colors.ERROR)]
    });
  }

  // Check if user can manage server or is master.
  if (!canManageGuild(interaction) && !isMaster(userId)) {
    return interaction.editReply({
      embeds: [
        buildPoolEmbed(
          'Permission Required',
          'You need `Manage Server` to select a pool for this guild.',
          Colors.ERROR
        )
      ]
    });
  }

  // Verify pool exists
  const pool = await storageLayer.fetchPool(poolId);
  if (!pool) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Pool Not Found', `Pool \`${poolId}\` does not exist.`, Colors.ERROR)]
    });
  }

  // Check pool access: non-owners cannot select someone else's private pool.
  if (pool.visibility !== 'public' && !(await canManagePool(poolId, userId))) {
    return interaction.editReply({
      embeds: [
        buildPoolEmbed(
          'Pool Access Denied',
          `Pool \`${poolId}\` is private and cannot be selected unless you own it or it is public.`,
          Colors.ERROR
        )
      ]
    });
  }

  // Set guild's selected pool
  await storageLayer.setGuildSelectedPool(guildId, poolId);

  const poolAgents = await storageLayer.fetchPoolAgents(poolId);
  const totalAgents = Array.isArray(poolAgents) ? poolAgents.length : 0;
  const activeAgents = Array.isArray(poolAgents)
    ? poolAgents.filter(a => a.status === 'active').length
    : 0;

  const embed = new EmbedBuilder()
    .setTitle('Pool Selected')
    .setColor(activeAgents > 0 ? Colors.SUCCESS : Colors.WARNING)
    .setDescription(`This guild will now use pool **${pool.name}** for agent deployments.`)
    .addFields(
      { name: 'Pool', value: `\`${poolId}\``, inline: true },
      { name: 'Visibility', value: pool.visibility === 'public' ? 'Public' : 'Private', inline: true },
      { name: 'Owner', value: `<@${pool.owner_user_id}>`, inline: true },
      { name: 'Pool Agents', value: `${totalAgents} total / ${activeAgents} active`, inline: true }
    )
    .setFooter({
      text: activeAgents > 0
        ? 'Use /agents deploy to deploy agents from this pool'
        : 'This pool currently has no active agents; consider /pools public or /agents add_token'
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ========== SETTINGS ==========

async function handleSettings(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolId = `pool_${userId}`;

  const pool = await storageLayer.fetchPool(poolId);
  
  if (!pool) {
    return interaction.editReply({
      embeds: [
        buildPoolEmbed(
          'No Owned Pool',
          "You don't have a pool yet. Use `/pools create` to create one.",
          Colors.INFO
        )
      ],
      components: buildOpenSetupButtonRow(userId, null, 10)
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('Pool Settings')
    .setColor(Colors.INFO)
    .setDescription(`Manage settings for **${pool.name}**`)
    .addFields(
      { name: 'Pool ID', value: `\`${pool.pool_id}\``, inline: true },
      { name: 'Visibility', value: pool.visibility === 'public' ? 'Public' : 'Private', inline: true }
    )
    .setFooter({ text: 'Use /pools delete to remove your pool' })
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
    components: buildOpenSetupButtonRow(userId, pool.pool_id, 10)
  });
}

// ========== DELETE POOL ==========

async function handleDelete(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolId = interaction.options.getString('pool');

  const pool = await storageLayer.fetchPool(poolId);
  
  if (!pool) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Pool Not Found', `Pool \`${poolId}\` does not exist.`, Colors.ERROR)]
    });
  }

  // Check ownership
  if (!(await canManagePool(poolId, userId))) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Delete Denied', 'You can only delete pools you own.', Colors.ERROR)]
    });
  }

  // Check if pool has agents
  const agents = await storageLayer.fetchPoolAgents(poolId);
  if (agents && agents.length > 0) {
    return interaction.editReply({
      embeds: [
        buildPoolEmbed(
          'Pool Not Empty',
          `Cannot delete this pool while agents are registered.\nCurrent agents: **${agents.length}**.`,
          Colors.WARNING
        )
      ]
    });
  }

  // Delete the pool
  const deleted = await storageLayer.deletePool(poolId);
  
  if (!deleted) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Delete Failed', 'Failed to delete pool. Please try again.', Colors.ERROR)]
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('Pool Deleted')
    .setColor(Colors.ERROR)
    .setDescription(`Pool **${pool.name}** has been deleted.`)
    .addFields(
      { name: 'Pool ID', value: `\`${poolId}\``, inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ========== TRANSFER OWNERSHIP ==========

async function handleTransfer(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolId = interaction.options.getString('pool');
  const newOwner = interaction.options.getUser('user');

  const pool = await storageLayer.fetchPool(poolId);
  
  if (!pool) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Pool Not Found', `Pool \`${poolId}\` does not exist.`, Colors.ERROR)]
    });
  }

  // Check ownership
  if (!(await canManagePool(poolId, userId))) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Transfer Denied', 'You can only transfer pools you own.', Colors.ERROR)]
    });
  }

  // Update ownership
  const updated = await storageLayer.updatePool(poolId, {
    owner_user_id: newOwner.id,
  });
  
  if (!updated) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Transfer Failed', 'Failed to transfer pool. Please try again.', Colors.ERROR)]
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('Pool Transferred')
    .setColor(Colors.WARNING)
    .setDescription(`Pool **${pool.name}** has been transferred.`)
    .addFields(
      { name: 'Pool ID', value: `\`${poolId}\``, inline: true },
      { name: 'Previous Owner', value: `<@${userId}>`, inline: true },
      { name: 'New Owner', value: `<@${newOwner.id}>`, inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ========== CONTRIBUTIONS ==========

async function handleContributions(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolOption = interaction.options.getString('pool', false);
  
  // Determine which pool to check
  let poolId;
  if (poolOption) {
    poolId = poolOption;
  } else {
    const userPools = await storageLayer.fetchPoolsByOwner(userId);
    if (!userPools || userPools.length === 0) {
      return interaction.editReply({
        embeds: [
          buildPoolEmbed(
            'No Owned Pools',
            "You don't own any pools. Create one with `/pools create`.",
            Colors.INFO
          )
        ]
      });
    }
    poolId = userPools[0].pool_id;
  }
  
  const pool = await storageLayer.fetchPool(poolId);
  if (!pool) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Pool Not Found', `Pool \`${poolId}\` does not exist.`, Colors.ERROR)]
    });
  }
  
  // Check ownership
  if (!(await canManagePool(poolId, userId))) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Access Denied', 'You can only view contributions to pools you own.', Colors.ERROR)]
    });
  }
  
  // Fetch inactive agents (pending contributions)
  const allAgents = await storageLayer.fetchPoolAgents(poolId);
  const pending = allAgents.filter(a => a.status === 'inactive');
  
  if (pending.length === 0) {
    return interaction.editReply({
      embeds: [
        buildPoolEmbed(
          'No Pending Contributions',
          `No pending contributions for **${pool.name}**.`,
          Colors.SUCCESS
        )
      ]
    });
  }
  
  const embed = new EmbedBuilder()
    .setTitle(`Pending Contributions - ${pool.name}`)
    .setColor(Colors.WARNING)
    .setDescription(`Pool: \`${poolId}\``)
    .setTimestamp();
  
  for (const agent of pending.slice(0, 10)) {
    const ageMs = Date.now() - agent.created_at;
    const ageHours = Math.floor(ageMs / 3600000);
    const ageText = ageHours < 1 ? 'Just now' : `${ageHours}h ago`;
    
    embed.addFields({
      name: `${agent.tag}`,
      value: `ID: \`${agent.agent_id}\`\nClient: \`${agent.client_id}\`\nSubmitted: ${ageText}\n` +
             `**Actions:** \`/pools approve agent_id:${agent.agent_id}\` or \`/pools reject agent_id:${agent.agent_id}\``,
      inline: false,
    });
  }
  
  if (pending.length > 10) {
    embed.setFooter({ text: `Showing 10 of ${pending.length} pending contributions` });
  } else {
    embed.setFooter({ text: `${pending.length} pending contribution${pending.length === 1 ? '' : 's'}` });
  }
  
  await interaction.editReply({ embeds: [embed] });
}

// ========== APPROVE ==========

async function handleApprove(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const agentId = interaction.options.getString('agent_id');
  
  // Import updateAgentBotStatus
  const { updateAgentBotStatus, fetchAgentBots, fetchPool } = await import('../utils/storage.js');
  
  // Find the agent
  const allAgents = await fetchAgentBots();
  const agent = allAgents.find(a => a.agent_id === agentId);
  
  if (!agent) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Agent Not Found', `Agent \`${agentId}\` was not found.`, Colors.ERROR)]
    });
  }
  
  // Check pool ownership
  const pool = await fetchPool(agent.pool_id);
  if (!pool) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Pool Not Found', 'Pool not found for this agent.', Colors.ERROR)]
    });
  }
  
  if (!(await canManagePool(pool.pool_id, userId))) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Approval Denied', 'You can only approve contributions to pools you own.', Colors.ERROR)]
    });
  }
  
  // Approve by setting status to active
  await updateAgentBotStatus(agentId, 'active');
  
  const embed = new EmbedBuilder()
    .setTitle('Contribution Approved')
    .setColor(Colors.SUCCESS)
    .setDescription(`**${agent.tag}** is now active in **${pool.name}**.`)
    .addFields(
      { name: 'Agent ID', value: `\`${agentId}\``, inline: true },
      { name: 'Pool', value: `\`${agent.pool_id}\``, inline: true },
      { name: 'Status', value: 'Active', inline: true }
    )
    .setFooter({ text: 'AgentRunner will start this agent automatically' })
    .setTimestamp();
  
  await interaction.editReply({ embeds: [embed] });
}

// ========== REJECT ==========

async function handleReject(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const agentId = interaction.options.getString('agent_id');
  
  // Import storage functions
  const { deleteAgentBot, fetchAgentBots, fetchPool } = await import('../utils/storage.js');
  
  // Find the agent
  const allAgents = await fetchAgentBots();
  const agent = allAgents.find(a => a.agent_id === agentId);
  
  if (!agent) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Agent Not Found', `Agent \`${agentId}\` was not found.`, Colors.ERROR)]
    });
  }
  
  // Check pool ownership
  const pool = await fetchPool(agent.pool_id);
  if (!pool) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Pool Not Found', 'Pool not found for this agent.', Colors.ERROR)]
    });
  }
  
  if (!(await canManagePool(pool.pool_id, userId))) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Rejection Denied', 'You can only reject contributions to pools you own.', Colors.ERROR)]
    });
  }
  
  // Reject by deleting
  await deleteAgentBot(agentId);
  
  const embed = new EmbedBuilder()
    .setTitle('Contribution Rejected')
    .setColor(Colors.ERROR)
    .setDescription(`**${agent.tag}** contribution has been removed.`)
    .addFields(
      { name: 'Agent ID', value: `\`${agentId}\``, inline: true },
      { name: 'Pool', value: `\`${agent.pool_id}\``, inline: true }
    )
    .setTimestamp();
  
  await interaction.editReply({ embeds: [embed] });
}

// ========== ADMIN LIST (MASTER ONLY) ==========

async function handleAdminList(interaction) {
  const userId = interaction.user.id;
  
  if (!isMaster(userId)) {
    return interaction.reply({
      embeds: [buildPoolEmbed('Restricted Command', 'This command is restricted to bot owners.', Colors.ERROR)],
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const allPools = await storageLayer.listPools();
  
  if (!allPools || allPools.length === 0) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('No Pools Found', 'No pools are currently registered.', Colors.INFO)]
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('All Pools (Master View)')
    .setColor(Colors.WARNING)
    .setDescription('Complete list of all pools including private')
    .setTimestamp();

  // Fetch all pool agents in parallel
  const agentPromises = allPools.map(pool => storageLayer.fetchPoolAgents(pool.pool_id));
  const allAgents = await Promise.all(agentPromises);

  for (let i = 0; i < allPools.length; i++) {
    const pool = allPools[i];
    const agents = allAgents[i];
    const agentCount = agents ? agents.length : 0;
    const activeCount = agents ? agents.filter(a => a.status === 'active').length : 0;
    embed.addFields({
      name: `${pool.name} \`${pool.pool_id}\``,
      value: `${pool.visibility} | Owner: <@${pool.owner_user_id}>\nAgents: ${agentCount} (${activeCount} active)`,
      inline: false,
    });
  }

  embed.setFooter({ text: `Total pools: ${allPools.length}` });

  await interaction.editReply({ embeds: [embed] });
}

// ========== ADMIN VIEW (MASTER ONLY) ==========

async function handleAdminView(interaction) {
  const userId = interaction.user.id;
  
  if (!isMaster(userId)) {
    return interaction.reply({
      embeds: [buildPoolEmbed('Restricted Command', 'This command is restricted to bot owners.', Colors.ERROR)],
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const poolId = interaction.options.getString('pool');
  const pool = await storageLayer.fetchPool(poolId);
  
  if (!pool) {
    return interaction.editReply({
      embeds: [buildPoolEmbed('Pool Not Found', `Pool \`${poolId}\` does not exist.`, Colors.ERROR)]
    });
  }

  const agents = await storageLayer.fetchPoolAgents(poolId);
  const agentCount = agents ? agents.length : 0;
  const activeAgents = agents ? agents.filter(a => a.status === 'active') : [];

  const embed = new EmbedBuilder()
    .setTitle(`${pool.name} (Master View)`)
    .setColor(Colors.WARNING)
    .setDescription(`Pool ID: \`${pool.pool_id}\``)
    .addFields(
      { name: 'Owner', value: `<@${pool.owner_user_id}>`, inline: true },
      { name: 'Visibility', value: pool.visibility === 'public' ? 'Public' : 'Private', inline: true },
      { name: 'Total Agents', value: `${agentCount}`, inline: true },
      { name: 'Active Agents', value: `${activeAgents.length}`, inline: true },
      { name: 'Created', value: `<t:${Math.floor(pool.created_at / 1000)}:R>`, inline: true },
      { name: 'Updated', value: `<t:${Math.floor(pool.updated_at / 1000)}:R>`, inline: true }
    )
    .setTimestamp();

  if (agentCount > 0) {
    const agentList = agents
      .map(a => `${a.tag} (\`${a.agent_id}\`) - Client: ${a.client_id}`)
      .join('\n');
    
    embed.addFields({
      name: 'Agents',
      value: agentList.length > 1024 ? agentList.substring(0, 1020) + '...' : agentList,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handlePoolUiAction(interaction, parsed, actionValue) {
  const userId = interaction.user.id;
  const requested = { desiredTotal: parsed.desired, poolId: parsed.poolId };
  const ownPoolId = `pool_${userId}`;
  const action = String(actionValue || '').trim();

  if (action === 'open_my_pool') {
    const ownPool = await storageLayer.fetchPool(ownPoolId);
    if (!ownPool) {
      return { requested, note: 'No owned pool found yet. Use Actions to create one.' };
    }
    requested.poolId = ownPoolId;
    return { requested, note: `Opened your pool \`${ownPoolId}\`.` };
  }

  if (action === 'create_private' || action === 'create_public') {
    const visibility = action === 'create_public' ? 'public' : 'private';
    const existing = await storageLayer.fetchPool(ownPoolId);
    if (existing) {
      requested.poolId = existing.pool_id;
      return { requested, note: `You already have \`${existing.pool_id}\`.` };
    }
    const poolName = `${interaction.user.username}'s Pool`;
    const created = await storageLayer.createPool(ownPoolId, userId, poolName, visibility);
    if (!created) {
      return { requested, note: 'Pool creation failed. Try again in a few seconds.' };
    }
    requested.poolId = ownPoolId;
    return {
      requested,
      note: `Created \`${ownPoolId}\` as **${visibility}**. You can change this anytime from Actions.`
    };
  }

  if (action === 'toggle_visibility') {
    if (!parsed.poolId) {
      return { requested, note: 'Select a pool first, then run Toggle Selected Visibility.' };
    }
    const pool = await storageLayer.fetchPool(parsed.poolId);
    if (!pool) {
      requested.poolId = null;
      return { requested, note: `Pool \`${parsed.poolId}\` no longer exists.` };
    }
    if (!(await canManagePool(parsed.poolId, userId))) {
      return { requested, note: 'Visibility changes are limited to the pool owner.' };
    }
    const nextVisibility = pool.visibility === 'public' ? 'private' : 'public';
    const updated = await storageLayer.updatePool(parsed.poolId, { visibility: nextVisibility });
    if (!updated) {
      return { requested, note: 'Visibility update failed. Try again.' };
    }
    return { requested, note: `Pool \`${parsed.poolId}\` visibility is now **${nextVisibility}**.` };
  }

  if (action === 'delete_selected') {
    if (!parsed.poolId) {
      return { requested, note: 'Select a pool first, then run Delete Selected.' };
    }
    const pool = await storageLayer.fetchPool(parsed.poolId);
    if (!pool) {
      requested.poolId = null;
      return { requested, note: `Pool \`${parsed.poolId}\` no longer exists.` };
    }
    if (!(await canManagePool(parsed.poolId, userId))) {
      return { requested, note: 'Pool deletion is limited to the pool owner.' };
    }
    const agents = await storageLayer.fetchPoolAgents(parsed.poolId).catch(() => []);
    if (Array.isArray(agents) && agents.length > 0) {
      return { requested, note: `Cannot delete \`${parsed.poolId}\`: pool still has ${agents.length} agent(s).` };
    }
    const deleted = await storageLayer.deletePool(parsed.poolId);
    if (!deleted) {
      return { requested, note: 'Pool delete failed. Try again in a few seconds.' };
    }

    const fallbackPool = await storageLayer.fetchPool(ownPoolId);
    requested.poolId = fallbackPool ? ownPoolId : null;
    return { requested, note: `Deleted pool \`${parsed.poolId}\`.` };
  }

  return { requested, note: 'Unknown action selected.' };
}

export async function handleSelect(interaction) {
  if (!interaction.isStringSelectMenu?.()) return false;
  const parsed = parsePoolUiId(interaction.customId);
  if (!parsed) return false;
  if (!['desired', 'pool', 'action'].includes(parsed.action)) return false;

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({
      embeds: [buildPoolEmbed('Panel Locked', 'This pool panel belongs to another user.', Colors.ERROR)],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const value = interaction.values?.[0] || '';
  if (parsed.action === 'action') {
    const result = await handlePoolUiAction(interaction, parsed, value);
    await renderPoolUi(interaction, {
      update: true,
      requested: result.requested,
      note: result.note
    });
    return true;
  }

  const requested = {
    desiredTotal: parsed.action === 'desired' ? clampPoolUiDesired(value) : parsed.desired,
    poolId: parsed.action === 'pool' ? (value === '_' ? null : value) : parsed.poolId
  };
  await renderPoolUi(interaction, { update: true, requested });
  return true;
}

export async function handleButton(interaction) {
  if (!interaction.isButton?.()) return false;

  const invParsed = parsePoolInvId(interaction.customId);
  if (invParsed) {
    if (invParsed.userId !== interaction.user.id) {
      await interaction.reply({
        embeds: [buildPoolEmbed('Panel Locked', 'This invite panel belongs to another user.', Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    if (!interaction.guildId) {
      await interaction.reply({
        embeds: [buildPoolEmbed('Guild Only', 'Invite links require a server context.', Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    if (!canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [buildPoolEmbed('Permission Required', 'You need `Manage Server` to view invite links.', Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const ctx = await buildPoolUiContext({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      selectedPoolId: invParsed.poolId,
      desiredTotal: invParsed.desired
    });
    const plan = ctx.plan;
    if (!plan || plan.error) {
      await interaction.reply({
        embeds: [buildPoolEmbed('Invite Plan Failed', plan?.error || 'No deployment plan available.', Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (invParsed.action === "download") {
      const file = buildInviteExportFile({
        guildId: interaction.guildId,
        poolId: ctx.selectedPoolId,
        desired: ctx.desired,
        plan
      });
      await interaction.reply({
        embeds: [buildPoolEmbed('Invite Links', 'Download generated invite links.', Colors.INFO).setFooter({ text: "In development" })],
        files: [file],
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    if (invParsed.action === "close") {
      await interaction.update({
        embeds: [buildPoolEmbed('Invite Links', 'Closed.', Colors.INFO).setFooter({ text: "In development" })],
        components: []
      }).catch(() => {});
      return true;
    }

    if (invParsed.action === "prev" || invParsed.action === "next") {
      await replyInvitePanel(interaction, {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        desired: ctx.desired,
        poolId: ctx.selectedPoolId,
        plan,
        page: invParsed.page,
        update: true
      });
      return true;
    }

    await interaction.reply({
      embeds: [buildPoolEmbed('Unsupported', 'Unsupported invite panel action.', Colors.WARNING).setFooter({ text: "In development" })],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const parsed = parsePoolUiId(interaction.customId);
  if (!parsed) return false;
  if (!['refresh', 'setdefault', 'links', 'deployui', 'advisorui'].includes(parsed.action)) return false;

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({
      embeds: [buildPoolEmbed('Panel Locked', 'This pool panel belongs to another user.', Colors.ERROR)],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const requested = { desiredTotal: parsed.desired, poolId: parsed.poolId };
  if (parsed.action === 'refresh') {
    await renderPoolUi(interaction, { update: true, requested, note: 'Refreshed pool status.' });
    return true;
  }

  if (parsed.action === 'deployui') {
    if (!interaction.guildId) {
      await interaction.reply({
        embeds: [buildPoolEmbed('Guild Only', 'Deploy UI requires a server context.', Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    if (!canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [buildPoolEmbed('Permission Required', 'You need `Manage Server` to open Deploy UI.', Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    await openDeployUiHandoff(interaction, requested);
    return true;
  }

  if (parsed.action === 'advisorui') {
    if (!interaction.guildId) {
      await interaction.reply({
        embeds: [buildPoolEmbed('Guild Only', 'Advisor UI requires a server context.', Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    if (!canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [buildPoolEmbed('Permission Required', 'You need `Manage Server` to open Advisor UI.', Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    await openAdvisorUiHandoff(interaction, requested);
    return true;
  }

  if (parsed.action === 'setdefault') {
    if (!interaction.guildId) {
      await interaction.reply({
        embeds: [buildPoolEmbed('Guild Only', 'This action requires a server.', Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    if (!canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [buildPoolEmbed('Permission Required', 'You need `Manage Server` to set guild default pool.', Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    if (!parsed.poolId) {
      await interaction.reply({
        embeds: [buildPoolEmbed('No Pool Selected', 'Select a pool first.', Colors.WARNING)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    await storageLayer.setGuildSelectedPool(interaction.guildId, parsed.poolId);
    await renderPoolUi(interaction, {
      update: true,
      requested,
      note: `Guild default pool updated to \`${parsed.poolId}\`.`
    });
    return true;
  }

  if (parsed.action === 'links') {
    if (!interaction.guildId) {
      await interaction.reply({
        embeds: [buildPoolEmbed('Guild Only', 'Invite links require a server context.', Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    if (!canManageGuild(interaction)) {
      await interaction.reply({
        embeds: [buildPoolEmbed('Permission Required', 'You need `Manage Server` to export invite links.', Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    const ctx = await buildPoolUiContext({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      selectedPoolId: parsed.poolId,
      desiredTotal: parsed.desired
    });
    const plan = ctx.plan;
    if (!plan || plan.error) {
      await interaction.reply({
        embeds: [buildPoolEmbed('Invite Plan Failed', plan?.error || 'No deployment plan available.', Colors.ERROR)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    if (!Array.isArray(plan.invites) || plan.invites.length === 0) {
      await interaction.reply({
        embeds: [buildPoolEmbed('No Invite Links', explainNoInviteAvailability(plan), Colors.WARNING)],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    await replyInvitePanel(interaction, {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      desired: ctx.desired,
      poolId: ctx.selectedPoolId,
      plan,
      page: 0,
      update: false
    });
    return true;
  }

  return false;
}

export async function autocomplete(interaction) {
  try {
    const focused = interaction.options.getFocused(true);
    const subcommand = interaction.options.getSubcommand(false);
    const query = String(focused?.value || '').toLowerCase().trim();
    const userId = interaction.user.id;
    const master = false;

    if (focused?.name === 'pool') {
      const pools = await storageLayer.listPools();
      const visiblePools = pools.filter(pool => {
        if (master) return true;
        if (subcommand === 'delete' || subcommand === 'transfer' || subcommand === 'contributions') {
          return pool.owner_user_id === userId;
        }
        return pool.owner_user_id === userId || pool.visibility === 'public';
      });

      const options = visiblePools
        .filter(pool => {
          if (!query) return true;
          return String(pool.pool_id).toLowerCase().includes(query)
            || String(pool.name || '').toLowerCase().includes(query);
        })
        .slice(0, 25)
        .map(pool => ({
          name: `${pool.name} [${pool.visibility}] (${pool.pool_id})`.slice(0, 100),
          value: pool.pool_id
        }));

      await interaction.respond(options);
      return;
    }

    if (focused?.name === 'agent_id' && (subcommand === 'approve' || subcommand === 'reject')) {
      const allAgents = await storageLayer.fetchAgentBots();
      let ownerPoolIds = new Set();
      if (master) {
        ownerPoolIds = new Set((await storageLayer.listPools()).map(p => p.pool_id));
      } else {
        const owned = await storageLayer.fetchPoolsByOwner(userId);
        ownerPoolIds = new Set((owned || []).map(p => p.pool_id));
      }

      const pendingAgents = allAgents
        .filter(a => ownerPoolIds.has(a.pool_id) && a.status === 'inactive')
        .filter(a => {
          if (!query) return true;
          return String(a.agent_id).toLowerCase().includes(query)
            || String(a.tag || '').toLowerCase().includes(query);
        })
        .slice(0, 25)
        .map(a => ({
          name: `${a.tag} (${a.agent_id})`.slice(0, 100),
          value: a.agent_id
        }));

      await interaction.respond(pendingAgents);
      return;
    }

    await interaction.respond([]);
  } catch {
    try { await interaction.respond([]); } catch {}
  }
}
