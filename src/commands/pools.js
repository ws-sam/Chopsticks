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
import { canManagePool, getUserPoolRole, logPoolEvent, maskToken, SPECIALTIES, BADGE_DEFS,
         fetchPoolAlliances, proposeAlliance, acceptAlliance, dissolveAlliance,
         setPoolSpecialty, getGuildPoolConfig, setGuildPoolConfig,
         addGuildSecondaryPool, removeGuildSecondaryPool, getGuildAllPoolIds,
         rankPoolsBySpecialty, evaluatePoolBadges } from '../utils/storage.js';
import { botLogger } from "../utils/modernLogger.js";
import { sanitizeString } from "../utils/validation.js";

const _poolWriteRateLimit = new Map();
function checkPoolWriteRateLimit(userId, cooldownMs = 5000) {
  const last = _poolWriteRateLimit.get(userId) || 0;
  const now = Date.now();
  if (now - last < cooldownMs) return false;
  _poolWriteRateLimit.set(userId, now);
  return true;
}

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
        .setDescription('Create your agent pool (one pool per user)')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Pool display name')
            .setRequired(true)
            .setMaxLength(50)
        )
        .addStringOption((opt) =>
          opt
            .setName('visibility')
            .setDescription('Public pools appear in /pools discover for admins to deploy')
            .setRequired(true)
            .addChoices(
              { name: 'Public — visible in discover list for server admins', value: 'public' },
              { name: 'Private — only you can see/manage it', value: 'private' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('description')
            .setDescription('What do your agents do? Admins read this to decide whether to deploy your pool (max 300 chars)')
            .setMaxLength(300)
        )
        .addStringOption((opt) =>
          opt
            .setName('specialty')
            .setDescription('Primary focus tag shown in the discover list')
            .addChoices(
              { name: '🎵 Music', value: 'music' },
              { name: '🤖 Voice Assistant', value: 'voice_assistant' },
              { name: '🔧 Utility', value: 'utility' },
              { name: '📡 Relay', value: 'relay' },
              { name: '✨ Custom', value: 'custom' },
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
        .addChannelOption((opt) =>
          opt
            .setName('notify_channel')
            .setDescription('Channel to notify when pool agents change (optional)')
            .setRequired(false)
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
    )
    .addSubcommand((sub) =>
      sub
        .setName('profile')
        .setDescription('Set your pool appearance — description and tags are what admins see when browsing /pools discover')
        .addStringOption(o => o.setName('pool').setDescription('Pool ID').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('description').setDescription('What do your agents do? Admins read this to decide whether to deploy your pool (max 300 chars)').setMaxLength(300))
        .addStringOption(o => o.setName('tags').setDescription('Comma-separated tags (max 5, e.g. "lofi music, jazz, 24-7 radio") — shown in discover list').setMaxLength(120))
        .addStringOption(o => o.setName('color').setDescription('Hex color e.g. #5865F2'))
        .addStringOption(o => o.setName('emoji').setDescription('Pool emoji e.g. 🎵'))
        .addStringOption(o => o.setName('specialty').setDescription('Focus tag e.g. music, assistant, moderation'))
        .addStringOption(o => o.setName('banner_url').setDescription('Image URL for banner'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('leaderboard')
        .setDescription('Top public pools ranked by activity')
        .addStringOption(o => o.setName('sort').setDescription('Sort by').addChoices(
          { name: '🎵 Songs Played', value: 'songs_played' },
          { name: '🚀 Deployments', value: 'total_deployments' },
          { name: '🏆 Score', value: 'composite_score' },
        ))
    )
    .addSubcommand((sub) =>
      sub
        .setName('stats')
        .setDescription('View stats for a pool')
        .addStringOption(o => o.setName('pool').setDescription('Pool ID (defaults to selected pool)').setAutocomplete(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('discover')
        .setDescription('Browse and filter public pools')
        .addStringOption(o => o.setName('specialty').setDescription('Filter by specialty tag e.g. music'))
        .addBooleanOption(o => o.setName('featured').setDescription('Show featured pools only'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('specialty')
        .setDescription('Set your pool\'s primary specialization')
        .addStringOption(o => o.setName('pool').setDescription('Pool ID').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('type').setDescription('Specialization type').setRequired(true).addChoices(
          { name: '🎵 Music', value: 'music' },
          { name: '🤖 Voice Assistant', value: 'voice_assistant' },
          { name: '🔧 Utility', value: 'utility' },
          { name: '📡 Relay', value: 'relay' },
          { name: '✨ Custom', value: 'custom' },
        ))
    )
    .addSubcommand((sub) =>
      sub
        .setName('ally')
        .setDescription('Manage pool alliances')
        .addStringOption(o => o.setName('pool').setDescription('Your pool ID').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('target').setDescription('Target pool ID to ally with').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('action').setDescription('Action').setRequired(true).addChoices(
          { name: 'Propose Alliance', value: 'propose' },
          { name: 'Accept Alliance', value: 'accept' },
          { name: 'Dissolve Alliance', value: 'dissolve' },
          { name: 'View Alliances', value: 'view' },
        ))
    )
    .addSubcommand((sub) =>
      sub
        .setName('secondary')
        .setDescription('Add or remove a secondary pool for cross-pool deployment')
        .addStringOption(o => o.setName('action').setDescription('Add or remove').setRequired(true).addChoices(
          { name: 'Add secondary pool', value: 'add' },
          { name: 'Remove secondary pool', value: 'remove' },
          { name: 'View config', value: 'view' },
        ))
        .addStringOption(o => o.setName('pool').setDescription('Pool ID to add/remove').setAutocomplete(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('members')
        .setDescription('Manage pool managers and view roster')
        .addStringOption(o => o.setName('pool').setDescription('Pool ID').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('action').setDescription('Action').addChoices(
          { name: 'View members', value: 'view' },
          { name: 'Add manager', value: 'add_manager' },
          { name: 'Remove member', value: 'remove' },
        ))
        .addUserOption(o => o.setName('user').setDescription('User to add/remove'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('help')
        .setDescription('Show help for the agent pool system — workflows, security promises, and quick-start guide')
    )
    .addSubcommand((sub) =>
      sub
        .setName('review')
        .setDescription('Leave a star rating and review for a pool')
        .addStringOption(o => o.setName('pool').setDescription('Pool ID to review').setRequired(true).setAutocomplete(true))
        .addIntegerOption(o => o.setName('stars').setDescription('Rating 1-5 stars').setRequired(true).setMinValue(1).setMaxValue(5))
        .addStringOption(o => o.setName('comment').setDescription('Optional comment (max 300 chars)').setMaxLength(300))
        .addStringOption(o => o.setName('action').setDescription('Action').addChoices(
          { name: '⭐ Submit review', value: 'submit' },
          { name: '🗑️ Delete my review', value: 'delete' },
          { name: '📋 View reviews', value: 'view' },
        ))
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
        case 'profile':
          await handleProfile(interaction);
          break;
        case 'leaderboard':
          await handleLeaderboard(interaction);
          break;
        case 'stats':
          await handleStats(interaction);
          break;
        case 'discover':
          await handleDiscover(interaction);
          break;
        case 'specialty':
          await handleSpecialty(interaction);
          break;
        case 'ally':
          await handleAlly(interaction);
          break;
        case 'secondary':
          await handleSecondary(interaction);
          break;
        case 'members':
          await handleMembers(interaction);
          break;
        case 'help':
          await handleHelp(interaction);
          break;
        case 'review':
          await handleReview(interaction);
          break;
        default:
          await interaction.reply({
            embeds: [buildPoolEmbed('Unknown Subcommand', 'This pool action is not recognized.', Colors.ERROR)],
            ephemeral: true
          });
      }
    } catch (error) {
      botLogger.error({ err: error }, '[pools]');
      const replyMethod = interaction.deferred ? 'editReply' : 'reply';
      await interaction[replyMethod]({
        embeds: [buildPoolEmbed('Pool Command Failed', error?.message || 'Unknown error.', Colors.ERROR)],
        ephemeral: true
      }).catch(() => {});
    }
}

// ========== HELPERS ==========

/**
 * C3a: Compute pool tier based on active agent count.
 * Bronze → Silver → Gold → Platinum
 */
function computePoolTier(activeAgentCount) {
  if (activeAgentCount >= 20) return { label: '🏆 Platinum', color: 0xe5e4e2 };
  if (activeAgentCount >= 10) return { label: '🥇 Gold', color: 0xffd700 };
  if (activeAgentCount >= 5)  return { label: '🥈 Silver', color: 0xc0c0c0 };
  if (activeAgentCount >= 1)  return { label: '🥉 Bronze', color: 0xcd7f32 };
  return { label: '⚪ Unranked', color: 0x95a5a6 };
}

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

function validatePoolMeta(meta) {
  const errors = [];
  if (meta.description && meta.description.length > 300) errors.push('Description must be ≤ 300 characters.');
  if (meta.color && !/^#[0-9a-fA-F]{6}$/.test(meta.color)) errors.push('Color must be a hex code like #FF5500.');
  if (meta.banner_url && !/^https?:\/\/.{4,}/.test(meta.banner_url)) errors.push('Banner URL must be a valid http/https URL.');
  if (meta.emoji && [...meta.emoji].length > 2) errors.push('Emoji must be a single emoji character.');
  if (meta.tags) {
    const tags = String(meta.tags).split(',').map(t => t.trim()).filter(Boolean);
    if (tags.length > 5) errors.push('You can set a maximum of 5 tags.');
    if (tags.some(t => t.length > 20)) errors.push('Each tag must be 20 characters or fewer.');
  }
  return errors;
}

/**
 * Scores how complete a pool's public profile is (0–100).
 * Returns { score, missing: string[], complete: boolean }
 */
function getProfileCompleteness(pool) {
  const meta = pool?.meta || {};
  const checks = [
    { label: 'description', points: 35, ok: Boolean(meta.description?.trim()) },
    { label: 'specialty',   points: 25, ok: Boolean(meta.specialty?.trim()) },
    { label: 'emoji',       points: 15, ok: Boolean(meta.emoji?.trim()) },
    { label: 'tags',        points: 15, ok: Boolean(meta.tags?.trim()) },
    { label: 'public visibility', points: 10, ok: pool?.visibility === 'public' },
  ];
  const score = checks.reduce((s, c) => s + (c.ok ? c.points : 0), 0);
  const missing = checks.filter(c => !c.ok).map(c => c.label);
  return { score, missing, complete: score === 100 };
}

/** Render a compact completeness indicator string, e.g. "▓▓▓░░ 60%" */
function renderCompleteness(pool) {
  const { score, missing } = getProfileCompleteness(pool);
  const filled = Math.round(score / 20);
  const bar = '▓'.repeat(filled) + '░'.repeat(5 - filled);
  const label = score === 100 ? '✅ Complete' : `${bar} ${score}%`;
  return { label, score, missing };
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
  // Show onboarding wizard if guild has no pool configured yet
  if (interaction.guildId && !interaction.replied && !interaction.deferred) {
    const shown = await maybeShowOnboarding(interaction);
    if (shown) return;
  }

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
    const activeAgents = agents ? agents.filter(a => a.status === 'active') : [];
    const tier = computePoolTier(activeAgents.length);
    
    // Owner display
    const owner = `<@${pool.owner_user_id}>`;
    
    // Agent status
    let agentStatus = '';
    if (totalAgents === 0) {
      agentStatus = '**0 agents** ⚠️';
    } else {
      const inactiveAgents = totalAgents - activeAgents.length;
      if (activeAgents.length === 0) {
        agentStatus = `**${totalAgents} agents** (⚠️ all inactive)`;
      } else if (inactiveAgents === 0) {
        agentStatus = `**${totalAgents} agents** (✅ all active)`;
      } else {
        agentStatus = `**${totalAgents} agents** (✅ ${activeAgents.length} active, ⚠️ ${inactiveAgents} inactive)`;
      }
    }
    
    let fieldValue = `${tier.label} | ${pool.visibility === 'public' ? '**Public**' : '**Private**'} | Owner: ${owner}\n`;
    fieldValue += agentStatus;
    
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
  if (!checkPoolWriteRateLimit(interaction.user.id)) {
    return interaction.reply({ embeds: [buildPoolEmbed('Slow Down', 'Please wait a few seconds before doing that again.', Colors.WARNING)], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const poolName = sanitizeString(interaction.options.getString('name') ?? '').slice(0, 50) || 'My Pool';
  const visibility = interaction.options.getString('visibility');

  // Generate pool ID
  const poolId = `pool_${userId}`;

  // Check if user already has a pool — 1 pool per user, enforced by pool_${userId} ID scheme
  const existing = await storageLayer.fetchPool(poolId);
  if (existing) {
    const { label: completenessLabel, score } = renderCompleteness(existing);
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('You Already Have a Pool')
          .setColor(Colors.WARNING)
          .setDescription(
            `You can only own **one pool**. Your pool is **${existing.name}** (\`${poolId}\`).\n\n` +
            `**Profile Completeness:** ${completenessLabel}\n` +
            (score < 100
              ? `\nAdmins browse \`/pools discover\` to decide which pools to deploy. A complete profile makes your pool stand out.\nUse \`/pools profile\` to fill in the missing fields.`
              : `\n✅ Your public profile is complete — admins can find your pool easily.`)
          )
          .setTimestamp()
      ],
      components: buildOpenSetupButtonRow(userId, existing.pool_id, 10)
    });
  }

  try {
    const initDescription = interaction.options.getString('description');
    const initSpecialty = interaction.options.getString('specialty');
    const created = await storageLayer.createPool(poolId, userId, poolName, visibility);

    if (!created) {
      return interaction.editReply({
        embeds: [buildPoolEmbed('Create Failed', 'Failed to create pool. Please try again.', Colors.ERROR)]
      });
    }

    // Apply optional description and specialty immediately if provided
    if (initDescription || initSpecialty) {
      const initMeta = {
        ...(initDescription ? { description: sanitizeString(initDescription).slice(0, 300) } : {}),
        ...(initSpecialty ? { specialty: initSpecialty } : {}),
      };
      await storageLayer.updatePool(poolId, { meta: initMeta }, userId).catch(() => {});
    }

    // Fetch the freshly created pool for completeness score
    const freshPool = await storageLayer.fetchPool(poolId).catch(() => null) || {
      pool_id: poolId, name: poolName, visibility, owner_user_id: userId,
      meta: { description: initDescription || null, specialty: initSpecialty || null }
    };
    const { label: completenessLabel, score, missing } = renderCompleteness(freshPool);

    // Build completeness checklist
    const checklistItems = [
      { label: 'description', done: Boolean(initDescription), hint: 'Tell admins what your agents do — this is the most important field' },
      { label: 'specialty',   done: Boolean(initSpecialty),   hint: 'Set via `/pools profile specialty:...`' },
      { label: 'emoji',       done: false,                    hint: 'Set via `/pools profile emoji:🎵`' },
      { label: 'tags',        done: false,                    hint: 'Set via `/pools profile tags:"music, lofi, chill"`' },
      { label: 'public visibility', done: visibility === 'public', hint: 'Private pools are hidden from /pools discover' },
    ];
    const checklist = checklistItems.map(c => `${c.done ? '✅' : '⬜'} **${c.label}**${!c.done ? ` — ${c.hint}` : ''}`).join('\n');

    const embed = new EmbedBuilder()
      .setTitle('🎉 Pool Created!')
      .setColor(Colors.SUCCESS)
      .addFields(
        { name: 'Pool ID',    value: `\`${poolId}\``,                                     inline: true },
        { name: 'Visibility', value: visibility === 'public' ? '🌐 Public' : '🔒 Private', inline: true },
        { name: 'Profile',    value: completenessLabel,                                    inline: true },
        {
          name: '📋 Public Profile Checklist',
          value: checklist + `\n\n**Why this matters:** Server admins browse \`/pools discover\` to choose which pools to deploy in their server. Your description and tags are how they know what your agents do.`,
          inline: false
        }
      )
      .setFooter({ text: 'Use /pools profile to complete your public profile · /agents add_token to add agents' })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: buildOpenSetupButtonRow(userId, poolId, 10)
    });
  } catch (err) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Create Failed', err.message || 'Failed to create pool.', Colors.ERROR)] });
  }
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
  const tier = computePoolTier(activeAgents.length);
  const meta = pool.meta || {};
  const tags = meta.tags ? meta.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const { label: completenessLabel, score, missing } = renderCompleteness(pool);

  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji || (pool.visibility === 'public' ? '🌐' : '🔒')} ${pool.name}`)
    .setColor(pool.visibility === 'public' ? Colors.INFO : Colors.WARNING)
    .setDescription(
      [
        meta.description || '⚠️ *No description — use `/pools profile` to add one*',
        meta.specialty ? `**Specialty:** \`${meta.specialty}\`` : null,
        tags.length > 0 ? `**Tags:** ${tags.map(t => `\`${t}\``).join(' ')}` : null,
      ].filter(Boolean).join('\n')
    )
    .addFields(
      { name: 'Owner',       value: `<@${pool.owner_user_id}>`,                    inline: true },
      { name: 'Visibility',  value: pool.visibility === 'public' ? '🌐 Public' : '🔒 Private', inline: true },
      { name: 'Tier',        value: tier.label,                                    inline: true },
      { name: 'Profile',     value: completenessLabel,                             inline: true },
      { name: 'Total Agents', value: `${agentCount}`,                              inline: true },
      { name: 'Active Agents', value: `${activeAgents.length}`,                   inline: true },
      { name: 'Created',     value: `<t:${Math.floor(pool.created_at / 1000)}:R>`, inline: true }
    )
    .setTimestamp();

  // Show owner reminder if profile is incomplete
  const isOwner = pool.owner_user_id === userId;
  if (isOwner && score < 100) {
    embed.addFields({
      name: '⚠️ Complete Your Public Profile',
      value: `Your profile is **${score}%** complete. Missing: **${missing.join(', ')}**\n\nServer admins browse \`/pools discover\` to choose which pools to deploy in their server — your **description** and **tags** are how they know what your agents do.\n\nRun \`/pools profile\` to fill in the missing fields.`,
      inline: false
    });
  }

  // Show agent list if owner or public
  if (pool.visibility === 'public' || await canManagePool(poolId, userId)) {
    if (agentCount > 0) {
      const agentList = agents
        .slice(0, 10)
        .map((a) => {
          const statusText = a.status === 'active' ? '✅' : '⚠️';
          const caps = Array.isArray(a.capabilities) && a.capabilities.length ? ` [${a.capabilities.join(', ')}]` : '';
          return `${statusText} ${a.tag} (\`${a.agent_id}\`)${caps}`;
        })
        .join('\n');
      
      embed.addFields({
        name: 'Agents',
        value: agentList + (agentCount > 10 ? `\n*...and ${agentCount - 10} more*` : ''),
      });
    } else {
      embed.addFields({
        name: 'Agents',
        value: '*No agents registered — use `/agents add_token` to add your first agent*',
      });
    }
  }

  // C3c: Show rating summary in pool view
  try {
    const ratingSummary = await storageLayer.fetchPoolRatingSummary(poolId);
    if (ratingSummary.count > 0) {
      const { count, avg } = ratingSummary;
      embed.addFields({ name: '⭐ Rating', value: `${'⭐'.repeat(Math.round(avg))} **${Number(avg).toFixed(1)}/5** (${count} review${count !== 1 ? 's' : ''})  ·  \`/pools review pool:${poolId} action:view\``, inline: false });
    }
  } catch {}

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

  // C3h: Save optional notify_channel to guild data
  const notifyChannel = interaction.options.getChannel('notify_channel', false);
  if (notifyChannel) {
    try {
      const guildData = await storageLayer.loadGuildData(guildId) || {};
      guildData.poolNotifyChannelId = notifyChannel.id;
      await storageLayer.saveGuildData(guildId, guildData);
    } catch { /* ignore — non-critical */ }
  }

  const poolAgents = await storageLayer.fetchPoolAgents(poolId);
  const totalAgents = Array.isArray(poolAgents) ? poolAgents.length : 0;
  const activeAgents = Array.isArray(poolAgents)
    ? poolAgents.filter(a => a.status === 'active').length
    : 0;

  const meta = pool.meta || {};
  const tags = meta.tags ? meta.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const { score: profileScore, missing: profileMissing } = getProfileCompleteness(pool);

  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji || '🌐'} Pool Selected — ${pool.name}`)
    .setColor(activeAgents > 0 ? Colors.SUCCESS : Colors.WARNING)
    .setDescription(
      [
        `This server will now use **${pool.name}** for agent deployments.`,
        meta.description ? `\n> ${meta.description}` : null,
        tags.length > 0 ? `🏷️ ${tags.map(t => `\`${t}\``).join(' ')}` : null,
      ].filter(Boolean).join('\n')
    )
    .addFields(
      { name: 'Pool ID',    value: `\`${poolId}\``,                              inline: true },
      { name: 'Visibility', value: pool.visibility === 'public' ? '🌐 Public' : '🔒 Private', inline: true },
      { name: 'Owner',      value: `<@${pool.owner_user_id}>`,                   inline: true },
      { name: 'Specialty',  value: meta.specialty ? `\`${meta.specialty}\`` : '*not set*',    inline: true },
      { name: 'Agents',     value: `${totalAgents} total / ${activeAgents} active`,           inline: true },
    )
    .setTimestamp();

  if (profileScore < 60) {
    embed.addFields({
      name: '⚠️ Incomplete Pool Profile',
      value: `This pool's public profile is **${profileScore}%** complete (missing: ${profileMissing.join(', ')}). The pool owner can run \`/pools profile\` to fill in missing details so you know exactly what you're deploying.`,
      inline: false
    });
  }

  embed.setFooter({
    text: activeAgents > 0
      ? 'Use /agents deploy to deploy agents from this pool'
      : 'This pool has no active agents yet. Ask the pool owner to add agents with /agents add_token.'
  });

  if (notifyChannel) {
    embed.addFields({ name: '🔔 Notifications', value: `Pool change alerts will be sent to <#${notifyChannel.id}>.`, inline: false });
  }

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

  try {
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
  } catch (err) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Delete Failed', err.message || 'Failed to delete pool.', Colors.ERROR)] });
  }
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

  try {
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
  } catch (err) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Transfer Failed', err.message || 'Failed to transfer pool.', Colors.ERROR)] });
  }
}

// ========== CONTRIBUTIONS ==========

async function handleContributions(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;
  const poolOption = interaction.options.getString('pool', false);
  
  let poolId;
  if (poolOption) {
    poolId = poolOption;
  } else {
    const userPools = await storageLayer.fetchPoolsByOwner(userId);
    if (!userPools || userPools.length === 0) {
      return interaction.editReply({ embeds: [buildPoolEmbed('No Owned Pools', "You don't own any pools. Create one with `/pools create`.", Colors.INFO)] });
    }
    poolId = userPools[0].pool_id;
  }
  
  const pool = await storageLayer.fetchPool(poolId);
  if (!pool) return interaction.editReply({ embeds: [buildPoolEmbed('Pool Not Found', `Pool \`${poolId}\` does not exist.`, Colors.ERROR)] });
  if (!(await canManagePool(poolId, userId))) return interaction.editReply({ embeds: [buildPoolEmbed('Access Denied', 'Only pool owners and managers can view contributions.', Colors.ERROR)] });
  
  const allAgents = await storageLayer.fetchPoolAgents(poolId);
  const pending = allAgents.filter(a => a.status === 'pending');
  const suspended = allAgents.filter(a => a.status === 'suspended');
  const active = allAgents.filter(a => a.status === 'active');
  
  const embed = new EmbedBuilder()
    .setTitle(`📋 Contributions — ${pool.name}`)
    .setColor(pending.length > 0 ? Colors.WARNING : Colors.SUCCESS)
    .setDescription(`Pool \`${poolId}\``)
    .setTimestamp()
    .addFields(
      { name: '⏳ Pending', value: `**${pending.length}**`, inline: true },
      { name: '🟢 Active',  value: `**${active.length}**`,  inline: true },
      { name: '🟠 Suspended', value: `**${suspended.length}**`, inline: true },
    );

  for (const agent of pending.slice(0, 8)) {
    const ageMs = Date.now() - agent.created_at;
    const ageText = ageMs < 3600000 ? `${Math.floor(ageMs / 60000)}m ago` : `${Math.floor(ageMs / 3600000)}h ago`;
    const by = agent.contributed_by ? `<@${agent.contributed_by}>` : 'unknown';
    embed.addFields({
      name: `⏳ ${agent.tag}`,
      value: `ID: \`${agent.agent_id}\` · By: ${by} · ${ageText}`,
      inline: false,
    });
  }

  if (pending.length > 8) embed.setFooter({ text: `+${pending.length - 8} more pending. Use /pools approve or /pools reject.` });

  const components = [];
  if (pending.length > 0) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`contrib_bulk:approve_all:${poolId}`)
        .setLabel(`✅ Approve All (${pending.length})`)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`contrib_bulk:reject_all:${poolId}`)
        .setLabel(`❌ Reject All (${pending.length})`)
        .setStyle(ButtonStyle.Danger),
    ));
  }
  if (active.length > 0) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`contrib_bulk:suspend_all:${poolId}`)
        .setLabel(`🟠 Suspend All Active (${active.length})`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`contrib_bulk:unsuspend_all:${poolId}`)
        .setLabel(`🟢 Unsuspend All (${suspended.length})`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(suspended.length === 0),
    ));
  }

  await interaction.editReply({ embeds: [embed], components });
}

// ========== APPROVE ==========

async function handleApprove(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;
  const agentId = interaction.options.getString('agent_id');

  try {
    const allAgents = await storageLayer.fetchAgentBots();
    const agent = allAgents.find(a => a.agent_id === agentId);

    if (!agent) return interaction.editReply({ embeds: [buildPoolEmbed('Agent Not Found', `Agent \`${agentId}\` was not found.`, Colors.ERROR)] });

    const pool = await storageLayer.fetchPool(agent.pool_id);
    if (!pool) return interaction.editReply({ embeds: [buildPoolEmbed('Pool Not Found', 'Pool not found.', Colors.ERROR)] });

    if (!(await canManagePool(pool.pool_id, userId))) {
      return interaction.editReply({ embeds: [buildPoolEmbed('Approval Denied', 'Only pool owners and managers can approve contributions.', Colors.ERROR)] });
    }

    await storageLayer.updateAgentBotStatus(agentId, 'active', userId);
    await evaluatePoolBadges(pool.pool_id).catch(() => {});

    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${agent.client_id}&permissions=277293639680&scope=bot%20applications.commands`;
    const inviteBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(`➕ Add ${agent.tag} to your server`)
        .setURL(inviteUrl)
    );
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('✅ Contribution Approved')
          .setColor(Colors.SUCCESS)
          .setDescription(`**${agent.tag}** is now active in **${pool.name}**.\n\n> **Next step:** Click below to invite the agent to your server.`)
          .addFields(
            { name: 'Agent ID', value: `\`${agentId}\``, inline: true },
            { name: 'Pool', value: `\`${agent.pool_id}\``, inline: true },
            { name: 'Status', value: '🟢 Active', inline: true }
          )
          .setFooter({ text: 'AgentRunner starts the bot — invite it to go live' })
          .setTimestamp()
      ],
      components: [inviteBtn]
    });
  } catch (err) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Approve Failed', err.message || 'Unexpected error.', Colors.ERROR)] });
  }
}

// ========== REJECT ==========

async function handleReject(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;
  const agentId = interaction.options.getString('agent_id');

  try {
    const allAgents = await storageLayer.fetchAgentBots();
    const agent = allAgents.find(a => a.agent_id === agentId);

    if (!agent) return interaction.editReply({ embeds: [buildPoolEmbed('Agent Not Found', `Agent \`${agentId}\` was not found.`, Colors.ERROR)] });

    const pool = await storageLayer.fetchPool(agent.pool_id);
    if (!pool) return interaction.editReply({ embeds: [buildPoolEmbed('Pool Not Found', 'Pool not found.', Colors.ERROR)] });

    if (!(await canManagePool(pool.pool_id, userId))) {
      return interaction.editReply({ embeds: [buildPoolEmbed('Rejection Denied', 'Only pool owners and managers can reject contributions.', Colors.ERROR)] });
    }

    await storageLayer.revokeAgentToken(agentId, userId);

    await interaction.editReply({ embeds: [
      buildPoolEmbed('Contribution Rejected', `**${agent.tag}** (\`${agentId}\`) has been rejected and removed from **${pool.name}**.`, Colors.WARNING)
    ] });
  } catch (err) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Reject Failed', err.message || 'Unexpected error.', Colors.ERROR)] });
  }
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

// ──────────────────────────────────────────────────────────────────────────
// Button handling for wizard, leaderboard sort, and contribution shortcuts
// ──────────────────────────────────────────────────────────────────────────
export async function handlePoolGlobalButton(interaction) {
  if (!interaction.isButton?.()) return false;
  const id = interaction.customId;

  // Onboarding wizard buttons
  if (id === 'pool_wizard:browse') {
    // Re-use handlePublic logic inline
    await interaction.deferUpdate();
    const allPools = await storageLayer.listPools().catch(() => []);
    const publicPools = allPools.filter(p => p.visibility === 'public');
    if (publicPools.length === 0) {
      await interaction.editReply({ embeds: [buildPoolEmbed('No Public Pools', 'There are no public pools yet. Create one with `/pools create`.', Colors.INFO)], components: [] });
      return true;
    }
    const agentLists = await Promise.all(publicPools.map(p => storageLayer.fetchPoolAgents(p.pool_id).catch(() => [])));
    const statsLists = await Promise.all(publicPools.map(p => storageLayer.fetchPoolStats(p.pool_id).catch(() => null)));
    const embeds = publicPools.slice(0, 3).map((pool, i) => buildPoolCard(pool, agentLists[i] || [], statsLists[i]));
    const row = new ActionRowBuilder().addComponents(
      ...publicPools.slice(0, 3).map(p =>
        new ButtonBuilder().setCustomId(`pool_contribute:${p.pool_id}`).setLabel(`Use ${p.name.slice(0,18)}`).setStyle(ButtonStyle.Primary)
      )
    );
    await interaction.editReply({ embeds, components: [row] });
    return true;
  }

  if (id === 'pool_wizard:create') {
    await interaction.reply({
      embeds: [buildPoolEmbed('Create a Pool', 'Use `/pools create` to set up your pool.\n\n**Tips:**\n• Use `/pools profile` to customize its look\n• Set visibility to `public` to accept contributions\n• Recommended deploy size is 10 agents', Colors.INFO)],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (id === 'pool_wizard:help') {
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('How Agent Pools Work')
        .setColor(Colors.INFO)
        .setDescription([
          '**What is an agent pool?**',
          'A pool is a group of Discord bots (agents) that can be deployed into voice channels to play music or assist users.',
          '',
          '**How do I get agents?**',
          'You can add your own bot tokens with `/agents add_token`, or contributors can donate tokens to your public pool.',
          '',
          '**What is the recommended deploy size?**',
          'Deploy **10 agents** per server to leave room for other bots. Pools support up to **49 agents**.',
          '',
          '**Public vs Private pools**',
          '• **Public** — visible on leaderboard and discover, accepts contributions',
          '• **Private** — only you and your managers can use it',
          '',
          '**Ready to start?**',
          '`/pools create` → Create your pool',
          '`/pools discover` → Browse existing pools',
        ].join('\n'))
        .setTimestamp()
      ],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  // Leaderboard sort buttons
  if (id.startsWith('leaderboard:')) {
    const sort = id.split(':')[1];
    if (!['songs_played', 'total_deployments', 'composite_score'].includes(sort)) return false;
    const rows = await storageLayer.fetchPoolLeaderboard(10, sort);
    const sortLabels = { songs_played: '🎵 Songs Played', total_deployments: '🚀 Deployments', composite_score: '🏆 Score' };
    const embed = new EmbedBuilder()
      .setTitle(`🏆 Agent Pool Leaderboard — ${sortLabels[sort]}`)
      .setColor(Colors.INFO)
      .setTimestamp()
      .setFooter({ text: 'Rankings based on public pool activity' });
    let desc = '';
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < (rows || []).length; i++) {
      const r = rows[i];
      const meta = r.meta || {};
      const emoji = meta.emoji || '🌐';
      const spec = meta.specialty ? ` \`${meta.specialty}\`` : '';
      const rank = medals[i] || `**${i + 1}.**`;
      const score = sort === 'songs_played' ? `🎵 ${r.songs_played ?? 0}` : sort === 'total_deployments' ? `🚀 ${r.total_deployments ?? 0}` : `🏆 ${r.composite_score ?? 0}`;
      desc += `${rank} ${emoji} **${r.name}**${spec}  ${score}\n`;
    }
    embed.setDescription(desc || 'No data yet.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('leaderboard:songs_played').setLabel('🎵 Songs').setStyle(sort === 'songs_played' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('leaderboard:total_deployments').setLabel('🚀 Deploys').setStyle(sort === 'total_deployments' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('leaderboard:composite_score').setLabel('🏆 Score').setStyle(sort === 'composite_score' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );
    await interaction.update({ embeds: [embed], components: [row] });
    return true;
  }

  // Quick-contribute shortcut from discover / wizard
  if (id.startsWith('pool_contribute:')) {
    const poolId = id.split(':')[1];
    await interaction.reply({
      embeds: [buildPoolEmbed('Contribute an Agent', `To contribute to pool \`${poolId}\`, use:\n\`/agents add_token pool:${poolId}\`\n\nYou'll need a Discord bot token. Your contribution will be reviewed by the pool owner.`, Colors.INFO)],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  // Bulk contribution buttons
  if (id.startsWith('contrib_bulk:')) {
    return handleContribBulkButton(interaction);
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

    if (focused?.name === 'target' && subcommand === 'ally') {
      // Autocomplete for ally target — show all public pools except owned by user
      const pools = await storageLayer.listPools();
      const options = pools
        .filter(pool => pool.visibility === 'public' || pool.owner_user_id === userId)
        .filter(pool => {
          if (!query) return true;
          return String(pool.pool_id).toLowerCase().includes(query)
            || String(pool.name || '').toLowerCase().includes(query);
        })
        .slice(0, 25)
        .map(pool => ({
          name: `${pool.name} [${pool.visibility}] (${pool.pool_id})`.slice(0, 100),
          value: pool.pool_id,
        }));
      await interaction.respond(options);
      return;
    }

    await interaction.respond([]);
  } catch {
    try { await interaction.respond([]); } catch {}
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POOL CARD BUILDER — shared rich embed used across view / leaderboard / discover
// ──────────────────────────────────────────────────────────────────────────
function resolvePoolColor(pool) {
  const hex = pool?.meta?.color;
  if (hex && /^#?[0-9a-fA-F]{6}$/.test(hex)) {
    return parseInt(hex.replace('#', ''), 16);
  }
  return pool?.visibility === 'public' ? Colors.INFO : Colors.WARNING;
}

function buildPoolCard(pool, agents = [], stats = null, opts = {}) {
  const meta    = pool.meta || {};
  const emoji   = meta.emoji   || (pool.visibility === 'public' ? '🌐' : '🔒');
  const spec    = meta.specialty ? `\`${meta.specialty}\`` : null;
  const tags    = meta.tags ? meta.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const maxAgt  = pool.max_agents || 49;
  const recDep  = pool.recommended_deploy || 10;
  const active  = agents.filter(a => a.status === 'active').length;
  const total   = agents.length;
  const capBar  = buildCapacityBar(total, maxAgt);

  const descParts = [];
  if (meta.description) descParts.push(meta.description);
  if (spec)             descParts.push(`**Specialty:** ${spec}`);
  if (tags.length > 0)  descParts.push(`**Tags:** ${tags.map(t => `\`${t}\``).join(' ')}`);
  const desc = descParts.join('\n') || `⚠️ *No description set — use \`/pools profile\` to tell admins what your agents do.*`;

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} ${pool.name}`)
    .setDescription(desc.slice(0, 4096))
    .setColor(resolvePoolColor(pool))
    .addFields(
      { name: 'Owner',       value: `<@${pool.owner_user_id}>`,                    inline: true },
      { name: 'Visibility',  value: pool.visibility === 'public' ? '🌐 Public' : '🔒 Private', inline: true },
      { name: 'Profile',     value: renderCompleteness(pool).label,               inline: true },
      { name: 'Capacity',    value: `\`${capBar}\``,                               inline: false },
      { name: 'Active',      value: `**${active}** active  ·  **${total}** total`, inline: true },
      { name: 'Rec. Deploy', value: `**${recDep}** agents`,                        inline: true },
    );

  if (stats) {
    embed.addFields({
      name: '📊 Stats',
      value: [
        `🎵 Songs: **${stats.songs_played ?? 0}**`,
        `🚀 Deploys: **${stats.total_deployments ?? 0}**`,
        `🏆 Score: **${stats.composite_score ?? 0}**`,
      ].join('  ·  '),
      inline: false,
    });

    // Badge display
    const badgeIds = stats.badges_json || [];
    if (badgeIds.length > 0) {
      const earned = BADGE_DEFS.filter(b => badgeIds.includes(b.id));
      if (earned.length > 0) {
        embed.addFields({
          name: '🏅 Badges',
          value: earned.map(b => `${b.emoji} ${b.label}`).join(' · '),
          inline: false,
        });
      }
    }
  }

  if (meta.banner_url) {
    embed.setImage(meta.banner_url);
  }

  if (opts.showId !== false) {
    embed.setFooter({ text: `Pool ID: ${pool.pool_id}` });
  }

  embed.setTimestamp();
  return embed;
}

// ──────────────────────────────────────────────────────────────────────────
// ONBOARDING WIZARD — shown when user has no pool context in a guild
// ──────────────────────────────────────────────────────────────────────────
async function maybeShowOnboarding(interaction) {
  if (!interaction.guildId) return false;

  const selected = await storageLayer.getGuildSelectedPool(interaction.guildId).catch(() => null);
  if (selected) return false; // Already configured

  const userId = interaction.user.id;
  const allPools = await storageLayer.listPools().catch(() => []);
  const publicPools = allPools.filter(p => p.visibility === 'public');
  const ownedCount = allPools.filter(p => p.owner_user_id === userId).length;

  // Top 3 by composite_score for recommendations (P5)
  const topPools = await storageLayer.fetchPoolLeaderboard(3, 'composite_score').catch(() => []);

  const embed = new EmbedBuilder()
    .setTitle('\u{1F44B} Welcome to Agent Pools')
    .setColor(Colors.INFO)
    .setDescription(
      'Agent pools let servers deploy music & assistant bots powered by community-contributed Discord bot tokens.\n\n' +
      '**This server doesn\'t have an agent pool selected yet.**'
    )
    .addFields(
      { name: '\uD83C\uDF10 Public Pools', value: `**${publicPools.length}** available`, inline: true },
      { name: '\uD83D\uDD11 Your Pools', value: `**${ownedCount}** owned`, inline: true },
    );

  if (topPools.length > 0) {
    const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
    const recLines = topPools.map((r, i) => {
      const meta = r.meta || {};
      const poolEmoji = meta.emoji || '\uD83C\uDF10';
      return `${medals[i]} ${poolEmoji} **${r.name}** \`${r.pool_id}\` \u00B7 \`${r.specialty || 'music'}\` \u00B7 \uD83C\uDFC6 ${r.composite_score ?? 0}`;
    }).join('\n');
    embed.addFields({ name: '\u2B50 Top Recommended Pools', value: recLines, inline: false });
  }

  embed.addFields({ name: '\u200b', value: '**What would you like to do?**', inline: false });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pool_wizard:browse').setLabel('Browse Public Pools').setStyle(ButtonStyle.Primary).setEmoji('\uD83C\uDF10'),
    new ButtonBuilder().setCustomId('pool_wizard:create').setLabel('Create My Pool').setStyle(ButtonStyle.Success).setEmoji('\uD83D\uDD11'),
    new ButtonBuilder().setCustomId('pool_wizard:help').setLabel('How Pools Work').setStyle(ButtonStyle.Secondary).setEmoji('\u2753'),
  );

  await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  return true;
}

// ──────────────────────────────────────────────────────────────────────────
// /pools profile
// ──────────────────────────────────────────────────────────────────────────
async function handleProfile(interaction) {
  if (!checkPoolWriteRateLimit(interaction.user.id)) {
    return interaction.reply({ embeds: [buildPoolEmbed('Slow Down', 'Please wait a few seconds before doing that again.', Colors.WARNING)], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const userId = interaction.user.id;
  const poolId = interaction.options.getString('pool');

  const pool = await storageLayer.fetchPool(poolId);
  if (!pool) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Not Found', `Pool \`${poolId}\` not found.`, Colors.ERROR)] });
  }

  if (!(await canManagePool(poolId, userId))) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Not Authorized', 'Only pool owners and managers can edit the pool profile.', Colors.ERROR)] });
  }

  const description = interaction.options.getString('description');
  const color       = interaction.options.getString('color');
  const emoji       = interaction.options.getString('emoji');
  const specialty   = interaction.options.getString('specialty');
  const bannerUrl   = interaction.options.getString('banner_url');
  const tagsRaw     = interaction.options.getString('tags');

  // Validate color
  if (color && !/^#?[0-9a-fA-F]{6}$/.test(color)) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Invalid Color', 'Color must be a hex value like `#5865F2`.', Colors.ERROR)] });
  }

  // Validate URL
  if (bannerUrl) {
    try { new URL(bannerUrl); } catch {
      return interaction.editReply({ embeds: [buildPoolEmbed('Invalid URL', 'Banner URL must be a valid https:// URL.', Colors.ERROR)] });
    }
    if (!bannerUrl.startsWith('https://')) {
      return interaction.editReply({ embeds: [buildPoolEmbed('Invalid URL', 'Banner URL must use HTTPS.', Colors.ERROR)] });
    }
  }

  // Normalise tags: comma-separated, trimmed, lowercase, max 5
  let normalisedTags = null;
  if (tagsRaw !== null) {
    const tagList = tagsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 5);
    normalisedTags = tagList.join(', ');
  }

  const currentMeta = pool.meta || {};
  const updatedMeta = {
    ...currentMeta,
    ...(description !== null ? { description: description.slice(0, 300) } : {}),
    ...(color      !== null ? { color: color.startsWith('#') ? color : '#' + color } : {}),
    ...(emoji      !== null ? { emoji: emoji.slice(0, 4) } : {}),
    ...(specialty  !== null ? { specialty: specialty.slice(0, 30).toLowerCase() } : {}),
    ...(bannerUrl  !== null ? { banner_url: bannerUrl } : {}),
    ...(normalisedTags !== null ? { tags: normalisedTags } : {}),
  };

  const profileErrors = validatePoolMeta(updatedMeta);
  if (profileErrors.length > 0) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Invalid Input', profileErrors.join('\n'), Colors.ERROR)] });
  }

  await storageLayer.updatePool(poolId, { meta: updatedMeta }, userId);

  const updatedPool = await storageLayer.fetchPool(poolId);
  const displayPool = updatedPool || pool;
  const agents = await storageLayer.fetchPoolAgents(poolId).catch(() => []);
  const { label: completenessLabel, score, missing } = renderCompleteness(displayPool);
  const card = buildPoolCard(displayPool, agents);
  card.setTitle(`✅ Profile Updated — ${displayPool.name}`);
  // Show completeness on profile update
  card.addFields({
    name: '📋 Profile Completeness',
    value: completenessLabel + (missing.length > 0
      ? `\nStill missing: **${missing.join(', ')}**\nAdmins see your description and tags in \`/pools discover\` to decide what to deploy.`
      : '\n✅ Your public profile is fully complete — admins can find and deploy your pool easily.'),
    inline: false
  });

  await interaction.editReply({ embeds: [card] });
}

// ──────────────────────────────────────────────────────────────────────────
// /pools leaderboard
// ──────────────────────────────────────────────────────────────────────────
async function handleLeaderboard(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sort = interaction.options.getString('sort') || 'composite_score';

  const rows = await storageLayer.fetchPoolLeaderboard(10, sort);

  if (!rows || rows.length === 0) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Leaderboard Empty', 'No public pools have recorded stats yet.', Colors.INFO)] });
  }

  const sortLabels = { songs_played: '🎵 Songs Played', total_deployments: '🚀 Deployments', composite_score: '🏆 Score' };
  const embed = new EmbedBuilder()
    .setTitle(`🏆 Agent Pool Leaderboard — ${sortLabels[sort] || 'Score'}`)
    .setColor(Colors.INFO)
    .setTimestamp()
    .setFooter({ text: 'Rankings based on public pool activity' });

  let desc = '';
  const medals = ['🥇', '🥈', '🥉'];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const meta = r.meta || {};
    const emoji = meta.emoji || '🌐';
    const spec = meta.specialty ? ` \`${meta.specialty}\`` : '';
    const rank = medals[i] || `**${i + 1}.**`;
    const score = sort === 'songs_played'       ? `🎵 ${r.songs_played ?? 0} songs`
                : sort === 'total_deployments'  ? `🚀 ${r.total_deployments ?? 0} deploys`
                :                                 `🏆 ${r.composite_score ?? 0} pts`;
    const agents = r.active_agents ?? 0;
    desc += `${rank} ${emoji} **${r.name}**${spec}\n`;
    desc += `   ${score}  ·  ${agents} active agents  ·  <@${r.owner_user_id}>\n`;
  }

  embed.setDescription(desc.slice(0, 4096));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('leaderboard:songs_played').setLabel('🎵 Songs').setStyle(sort === 'songs_played' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('leaderboard:total_deployments').setLabel('🚀 Deploys').setStyle(sort === 'total_deployments' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('leaderboard:composite_score').setLabel('🏆 Score').setStyle(sort === 'composite_score' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ──────────────────────────────────────────────────────────────────────────
// /pools stats
// ──────────────────────────────────────────────────────────────────────────
async function handleStats(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const userId = interaction.user.id;
  let poolId = interaction.options.getString('pool');

  if (!poolId && interaction.guildId) {
    poolId = await storageLayer.getGuildSelectedPool(interaction.guildId).catch(() => null);
  }

  if (!poolId) {
    return interaction.editReply({ embeds: [buildPoolEmbed('No Pool Selected', 'Provide a pool ID or select a pool for this server first with `/pools select`.', Colors.WARNING)] });
  }

  const [pool, agents, stats] = await Promise.all([
    storageLayer.fetchPool(poolId),
    storageLayer.fetchPoolAgents(poolId).catch(() => []),
    storageLayer.fetchPoolStats(poolId).catch(() => null),
  ]);

  if (!pool) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Not Found', `Pool \`${poolId}\` not found.`, Colors.ERROR)] });
  }

  const hasAccess = await canAccessPool(userId, poolId, pool);
  if (!hasAccess) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Access Denied', 'This pool is private.', Colors.ERROR)] });
  }

  const card = buildPoolCard(pool, agents, stats);
  card.setTitle(`📊 Stats — ${pool.name}`);

  // Add contribution breakdown
  const byStatus = agents.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});
  const statusLine = Object.entries(byStatus).map(([s, n]) => `${s}: **${n}**`).join('  ·  ') || 'No agents';
  card.addFields({ name: 'Agent Breakdown', value: statusLine, inline: false });

  // C3e: Capacity alert
  const maxAgents = pool.max_agents || 49;
  const activeCount = agents.filter(a => a.status === 'active').length;
  const capacityPct = Math.round((activeCount / maxAgents) * 100);
  card.addFields({ name: '📊 Capacity', value: `${activeCount} / ${maxAgents} (${capacityPct}%)${capacityPct >= 90 ? ' 🔴 Near limit' : capacityPct >= 75 ? ' 🟡 Filling up' : ' 🟢 OK'}`, inline: false });
  const tier = computePoolTier(activeCount);
  card.addFields({ name: '🏅 Tier', value: tier.label, inline: true });

  // C3f: Contributor spotlight
  try {
    const [topContribs, ratingSummary] = await Promise.all([
      storageLayer.fetchPoolTopContributors(poolId, 5),
      storageLayer.fetchPoolRatingSummary(poolId),
    ]);
    if (topContribs.length > 0) {
      const lines = topContribs.map((c, i) => {
        const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i] || `${i + 1}.`;
        return `${medal} <@${c.user_id}> — ${c.active_count} active / ${c.agent_count} total`;
      });
      card.addFields({ name: '🌟 Top Contributors', value: lines.join('\n'), inline: false });
    }
    if (ratingSummary.count > 0) {
      const { count, avg } = ratingSummary;
      card.addFields({ name: '⭐ Reviews', value: `${'⭐'.repeat(Math.round(avg))} **${Number(avg).toFixed(1)}** / 5 (${count} review${count !== 1 ? 's' : ''})  ·  \`/pools review pool:${poolId} action:view\``, inline: false });
    }
  } catch { /* non-critical */ }

  await interaction.editReply({ embeds: [card] });
}

// ──────────────────────────────────────────────────────────────────────────
// /pools discover
// ──────────────────────────────────────────────────────────────────────────
async function handleDiscover(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const specialty = interaction.options.getString('specialty')?.toLowerCase().trim();
  const featuredOnly = interaction.options.getBoolean('featured') ?? false;

  const allPools = await storageLayer.listPools().catch(() => []);
  let pools = allPools.filter(p => p.visibility === 'public');

  if (featuredOnly) pools = pools.filter(p => p.is_featured);
  if (specialty)    pools = pools.filter(p => (p.meta?.specialty || '').toLowerCase().includes(specialty));

  if (pools.length === 0) {
    const hint = specialty ? ` matching \`${specialty}\`` : '';
    return interaction.editReply({ embeds: [buildPoolEmbed('No Results', `No public pools found${hint}. Try \`/pools discover\` without filters.`, Colors.INFO)] });
  }

  // Fetch stats and agents in parallel
  const [allStats, allAgents] = await Promise.all([
    Promise.all(pools.map(p => storageLayer.fetchPoolStats(p.pool_id).catch(() => null))),
    Promise.all(pools.map(p => storageLayer.fetchPoolAgents(p.pool_id).catch(() => []))),
  ]);

  // Sort: featured first, then by composite score, then by completeness
  const ranked = pools.map((p, i) => ({
    pool: p, stats: allStats[i], agents: allAgents[i],
    completeness: getProfileCompleteness(p)
  }));
  ranked.sort((a, b) => {
    if (a.pool.is_featured !== b.pool.is_featured) return a.pool.is_featured ? -1 : 1;
    const scoreDiff = (b.stats?.composite_score ?? 0) - (a.stats?.composite_score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return b.completeness.score - a.completeness.score; // more complete profiles rank higher
  });

  const isAdmin = interaction.guildId
    ? Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild))
    : false;

  const embed = new EmbedBuilder()
    .setTitle(featuredOnly ? '⭐ Featured Agent Pools' : '🔍 Discover Agent Pools')
    .setColor(Colors.INFO)
    .setTimestamp()
    .setFooter({
      text: isAdmin
        ? `${pools.length} pool${pools.length !== 1 ? 's' : ''} · Use /pools select pool:<id> to deploy one · /pools view pool:<id> for full details`
        : `${pools.length} pool${pools.length !== 1 ? 's' : ''} found${specialty ? ` · specialty: ${specialty}` : ''} · Ask your server admin to deploy a pool`
    });

  let desc = isAdmin
    ? '**You are viewing this as a server admin.** Use `/pools select pool:<id>` to attach a pool to this server. Agents from that pool can then be deployed with `/agents deploy`.\n\n'
    : '';

  for (const { pool, stats, agents, completeness } of ranked.slice(0, 6)) {
    const meta    = pool.meta || {};
    const emoji   = meta.emoji || '🌐';
    const feat    = pool.is_featured ? ' ⭐' : '';
    const active  = (agents || []).filter(a => a.status === 'active').length;
    const total   = (agents || []).length;
    const score   = stats?.composite_score ?? 0;
    const maxAgt  = pool.max_agents || 49;
    const bar     = buildCapacityBar(total, maxAgt, 8);

    // Specialty + tags line
    const specParts = [];
    if (meta.specialty) specParts.push(`\`${meta.specialty}\``);
    if (meta.tags) {
      const tagList = meta.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 3);
      specParts.push(...tagList.map(t => `\`${t}\``));
    }
    const specLine = specParts.length > 0 ? `   🏷️ ${specParts.join(' ')}` : '';

    // Description — show full, truncate at 150 chars
    const descText = meta.description
      ? (meta.description.length > 150 ? meta.description.slice(0, 147) + '…' : meta.description)
      : '⚠️ *No description provided*';

    desc += `${emoji}${feat} **${pool.name}**  ·  🏆 ${score} pts\n`;
    desc += `   ${descText}\n`;
    if (specLine) desc += `${specLine}\n`;
    desc += `   \`${bar}\`  ${active}/${total} active  ·  👤 <@${pool.owner_user_id}>\n`;
    desc += `   \`/pools select pool:${pool.pool_id}\`  ·  \`/pools view pool:${pool.pool_id}\`\n\n`;
  }

  if (ranked.length > 6) desc += `*...and ${ranked.length - 6} more. Use \`/pools discover specialty:<tag>\` to filter.*`;

  embed.setDescription(desc.slice(0, 4096));

  // Action buttons for top 3
  const topPools = ranked.slice(0, 3);
  const components = [];
  if (topPools.length > 0 && isAdmin) {
    const row = new ActionRowBuilder().addComponents(
      ...topPools.map(({ pool }) =>
        new ButtonBuilder()
          .setCustomId(`pool_select_ui:${pool.pool_id}:${interaction.user.id}`)
          .setLabel(`Deploy ${pool.name.slice(0, 18)}`)
          .setStyle(ButtonStyle.Primary)
      )
    );
    components.push(row);
  } else if (topPools.length > 0) {
    const row = new ActionRowBuilder().addComponents(
      ...topPools.slice(0, 2).map(({ pool }) =>
        new ButtonBuilder()
          .setCustomId(`pool_contribute:${pool.pool_id}`)
          .setLabel(`Contribute to ${pool.name.slice(0, 18)}`)
          .setStyle(ButtonStyle.Secondary)
      )
    );
    components.push(row);
  }

  await interaction.editReply({ embeds: [embed], components });
}

// ──────────────────────────────────────────────────────────────────────────
// /pools specialty
// ──────────────────────────────────────────────────────────────────────────
async function handleSpecialty(interaction) {
  if (!checkPoolWriteRateLimit(interaction.user.id)) {
    return interaction.reply({ embeds: [buildPoolEmbed('Slow Down', 'Please wait a few seconds before doing that again.', Colors.WARNING)], flags: MessageFlags.Ephemeral });
  }
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const userId = interaction.user.id;
    const poolId = interaction.options.getString('pool');
    const type   = interaction.options.getString('type');

    const pool = await storageLayer.fetchPool(poolId);
    if (!pool) return interaction.editReply({ embeds: [buildPoolEmbed('Not Found', `Pool \`${poolId}\` not found.`, Colors.ERROR)] });
    if (!(await canManagePool(poolId, userId))) return interaction.editReply({ embeds: [buildPoolEmbed('Not Authorized', 'Only pool owners and managers can set specialty.', Colors.ERROR)] });

    await setPoolSpecialty(poolId, type, userId);

    const labels = { music: '🎵 Music', voice_assistant: '🤖 Voice Assistant', utility: '🔧 Utility', relay: '📡 Relay', custom: '✨ Custom' };
    await interaction.editReply({ embeds: [
      buildPoolEmbed('Specialty Updated', `**${pool.name}** is now specialized in **${labels[type] || type}**.\n\nThis will affect specialty-based matching when guilds deploy agents.`, Colors.SUCCESS)
    ] });
  } catch (err) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Error', err.message || 'Unexpected error.', Colors.ERROR)] });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// /pools ally
// ──────────────────────────────────────────────────────────────────────────
async function handleAlly(interaction) {
  if (!checkPoolWriteRateLimit(interaction.user.id)) {
    return interaction.reply({ embeds: [buildPoolEmbed('Slow Down', 'Please wait a few seconds before doing that again.', Colors.WARNING)], flags: MessageFlags.Ephemeral });
  }
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const userId = interaction.user.id;
    const poolId  = interaction.options.getString('pool');
    const target  = interaction.options.getString('target');
    const action  = interaction.options.getString('action');

    if (poolId === target) return interaction.editReply({ embeds: [buildPoolEmbed('Invalid', 'Cannot ally a pool with itself.', Colors.ERROR)] });

    const [pool, targetPool] = await Promise.all([storageLayer.fetchPool(poolId), storageLayer.fetchPool(target)]);
    if (!pool) return interaction.editReply({ embeds: [buildPoolEmbed('Not Found', `Your pool \`${poolId}\` not found.`, Colors.ERROR)] });
    if (!targetPool) return interaction.editReply({ embeds: [buildPoolEmbed('Not Found', `Target pool \`${target}\` not found.`, Colors.ERROR)] });

    if (action === 'view') {
      const alliances = await fetchPoolAlliances(poolId, null);
      if (alliances.length === 0) {
        return interaction.editReply({ embeds: [buildPoolEmbed('No Alliances', `**${pool.name}** has no alliances.`, Colors.INFO)] });
      }
      const partnerIds = alliances.map(a => a.partner_pool_id);
      const partners = await Promise.all(partnerIds.map(id => storageLayer.fetchPool(id).catch(() => null)));
      const embed = new EmbedBuilder()
        .setTitle(`🤝 Alliances — ${pool.name}`)
        .setColor(Colors.INFO)
        .setTimestamp();
      for (let i = 0; i < alliances.length; i++) {
        const a = alliances[i];
        const partner = partners[i];
        const statusEmoji = { active: '🤜🤛', pending: '⏳', dissolved: '💔' }[a.status] || '❓';
        embed.addFields({
          name: `${statusEmoji} ${partner?.name || a.partner_pool_id}`,
          value: `Status: **${a.status}** · Initiated by: <@${a.initiated_by}> · \`${a.partner_pool_id}\``,
          inline: false,
        });
      }
      return interaction.editReply({ embeds: [embed] });
    }

    if (action === 'dissolve') {
      if (!(await canManagePool(poolId, userId)) && !(await canManagePool(target, userId))) {
        return interaction.editReply({ embeds: [buildPoolEmbed('Not Authorized', 'You must own or manage one of the pools to dissolve this alliance.', Colors.ERROR)] });
      }
      await dissolveAlliance(poolId, target, userId);
      return interaction.editReply({ embeds: [
        buildPoolEmbed('Alliance Dissolved', `Alliance between **${pool.name}** and **${targetPool.name}** has been dissolved.`, Colors.WARNING)
      ] });
    }

    // Management actions require owning YOUR pool
    if (!(await canManagePool(poolId, userId))) return interaction.editReply({ embeds: [buildPoolEmbed('Not Authorized', 'You must own or manage your pool to manage alliances.', Colors.ERROR)] });

    if (action === 'propose') {
      await proposeAlliance(poolId, target, userId);
      return interaction.editReply({ embeds: [
        buildPoolEmbed('Alliance Proposed', `Alliance proposal sent from **${pool.name}** to **${targetPool.name}**.\n\nThe target pool owner must accept with \`/pools ally pool:${target} target:${poolId} action:accept\`.`, Colors.SUCCESS)
      ] });
    }

    if (action === 'accept') {
      // The accepting party should be the target pool owner
      if (!(await canManagePool(target, userId))) return interaction.editReply({ embeds: [buildPoolEmbed('Not Authorized', 'You must manage the target pool to accept its alliances.', Colors.ERROR)] });
      await acceptAlliance(poolId, target, userId);
      await evaluatePoolBadges(poolId).catch(() => {});
      await evaluatePoolBadges(target).catch(() => {});
      return interaction.editReply({ embeds: [
        buildPoolEmbed('🤜🤛 Alliance Formed!', `**${pool.name}** and **${targetPool.name}** are now allied!\n\nAllied pools cross-promote in discovery and gain the **Allied** badge.`, Colors.SUCCESS)
      ] });
    }
  } catch (err) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Error', err.message || 'Unexpected error.', Colors.ERROR)] });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// /pools secondary — multi-pool configuration per guild
// ──────────────────────────────────────────────────────────────────────────
async function handleSecondary(interaction) {
  if (!interaction.guildId) {
    return interaction.reply({ embeds: [buildPoolEmbed('Guild Only', 'Secondary pools are configured per server.', Colors.ERROR)], flags: MessageFlags.Ephemeral });
  }
  if (!canManageGuild(interaction)) {
    return interaction.reply({ embeds: [buildPoolEmbed('Permission Required', 'You need `Manage Server` to configure secondary pools.', Colors.ERROR)], flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const action  = interaction.options.getString('action');
  const poolId  = interaction.options.getString('pool');
  const guildId = interaction.guildId;

  if (action === 'view') {
    const config = await storageLayer.getGuildPoolConfig(guildId);
    const primaryId = config?.primary_pool_id || await storageLayer.getGuildSelectedPool(guildId);
    const secondaryIds = Array.isArray(config?.secondary_pool_ids) ? config.secondary_pool_ids : [];
    const allIds = [primaryId, ...secondaryIds].filter(Boolean);
    const pools = await Promise.all(allIds.map(id => storageLayer.fetchPool(id).catch(() => null)));

    const embed = new EmbedBuilder()
      .setTitle('🔗 Guild Pool Configuration')
      .setColor(Colors.INFO)
      .setTimestamp()
      .setFooter({ text: 'Primary pool + up to 2 secondary pools for cross-pool deployment' });

    const primary = pools[0];
    embed.addFields({ name: '🌟 Primary Pool', value: primary ? `**${primary.name}** \`${primary.pool_id}\`` : 'Not set — use `/pools select`', inline: false });
    for (let i = 1; i < pools.length; i++) {
      const p = pools[i];
      embed.addFields({ name: `📌 Secondary Pool ${i}`, value: p ? `**${p.name}** \`${p.pool_id}\`` : 'Not found', inline: true });
    }
    if (secondaryIds.length === 0) embed.addFields({ name: 'Secondary Pools', value: 'None configured. Add up to 2 with `/pools secondary action:add pool:<id>`', inline: false });

    return interaction.editReply({ embeds: [embed] });
  }

  if (!poolId) return interaction.editReply({ embeds: [buildPoolEmbed('Missing Pool', 'Provide a pool ID with the `pool` option.', Colors.ERROR)] });

  if (action === 'add') {
    const target = await storageLayer.fetchPool(poolId);
    if (!target) return interaction.editReply({ embeds: [buildPoolEmbed('Not Found', `Pool \`${poolId}\` not found.`, Colors.ERROR)] });
    try {
      await addGuildSecondaryPool(guildId, poolId);
      return interaction.editReply({ embeds: [buildPoolEmbed('Secondary Pool Added', `**${target.name}** added as a secondary pool. Deployment planner will now draw agents from this pool too.`, Colors.SUCCESS)] });
    } catch (err) {
      return interaction.editReply({ embeds: [buildPoolEmbed('Error', err.message, Colors.ERROR)] });
    }
  }

  if (action === 'remove') {
    try {
      await removeGuildSecondaryPool(guildId, poolId);
      return interaction.editReply({ embeds: [buildPoolEmbed('Secondary Pool Removed', `Pool \`${poolId}\` removed from secondary slots.`, Colors.SUCCESS)] });
    } catch (err) {
      return interaction.editReply({ embeds: [buildPoolEmbed('Error', err.message, Colors.ERROR)] });
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// /pools members — roster management UI
// ──────────────────────────────────────────────────────────────────────────
async function handleMembers(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const userId = interaction.user.id;
    const poolId = interaction.options.getString('pool');
    const action = interaction.options.getString('action') || 'view';
    const target = interaction.options.getUser('user');

    const pool = await storageLayer.fetchPool(poolId);
    if (!pool) return interaction.editReply({ embeds: [buildPoolEmbed('Not Found', `Pool \`${poolId}\` not found.`, Colors.ERROR)] });
    if (!(await canManagePool(poolId, userId))) return interaction.editReply({ embeds: [buildPoolEmbed('Not Authorized', 'Only pool owners and managers can manage members.', Colors.ERROR)] });

    if (action === 'view') {
      const members = await storageLayer.fetchPoolMembers(poolId);
      const roleEmoji = { owner: '👑', manager: '⚙️', contributor: '🤝', viewer: '👁️' };
      const embed = new EmbedBuilder()
        .setTitle(`👥 Members — ${pool.name}`)
        .setColor(Colors.INFO)
        .setTimestamp()
        .setFooter({ text: `${members.length} member${members.length !== 1 ? 's' : ''}` });

      if (members.length === 0) {
        embed.setDescription('No members registered yet (pool owner is implicitly always owner).');
      } else {
        const lines = members.map(m => `${roleEmoji[m.role] || '•'} <@${m.user_id}> — **${m.role}**`);
        embed.setDescription(lines.join('\n').slice(0, 4096));
      }
      return interaction.editReply({ embeds: [embed] });
    }

    if (!target) return interaction.editReply({ embeds: [buildPoolEmbed('Missing User', 'Provide a user with the `user` option.', Colors.ERROR)] });

    if (action === 'add_manager') {
      if (pool.owner_user_id !== userId) return interaction.editReply({ embeds: [buildPoolEmbed('Owner Only', 'Only the pool owner can assign managers.', Colors.ERROR)] });
      await storageLayer.setPoolMemberRole(poolId, target.id, 'manager', userId);
      return interaction.editReply({ embeds: [buildPoolEmbed('Manager Added', `<@${target.id}> is now a **manager** of **${pool.name}**.`, Colors.SUCCESS)] });
    }

    if (action === 'remove') {
      if (pool.owner_user_id !== userId) return interaction.editReply({ embeds: [buildPoolEmbed('Owner Only', 'Only the pool owner can remove members.', Colors.ERROR)] });
      if (target.id === pool.owner_user_id) return interaction.editReply({ embeds: [buildPoolEmbed('Cannot Remove', 'Cannot remove the pool owner.', Colors.ERROR)] });
      await storageLayer.removePoolMember(poolId, target.id, userId);
      return interaction.editReply({ embeds: [buildPoolEmbed('Member Removed', `<@${target.id}> has been removed from **${pool.name}**.`, Colors.SUCCESS)] });
    }
  } catch (err) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Error', err.message || 'Unexpected error.', Colors.ERROR)] });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Bulk contribution button handler (called from handlePoolGlobalButton)
// ──────────────────────────────────────────────────────────────────────────
export async function handleContribBulkButton(interaction) {
  if (!interaction.isButton?.()) return false;
  if (!interaction.customId.startsWith('contrib_bulk:')) return false;

  const [, bulkAction, poolId] = interaction.customId.split(':');
  const userId = interaction.user.id;

  const pool = await storageLayer.fetchPool(poolId).catch(() => null);
  if (!pool) {
    await interaction.reply({ embeds: [buildPoolEmbed('Pool Not Found', `Pool \`${poolId}\` not found.`, Colors.ERROR)], flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!(await canManagePool(poolId, userId))) {
    await interaction.reply({ embeds: [buildPoolEmbed('Not Authorized', 'Only pool owners and managers can perform bulk actions.', Colors.ERROR)], flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferUpdate();

  const allAgents = await storageLayer.fetchPoolAgents(poolId);

  if (bulkAction === 'approve_all') {
    const pending = allAgents.filter(a => a.status === 'pending');
    await Promise.all(pending.map(a => storageLayer.updateAgentBotStatus(a.agent_id, 'active', userId).catch(() => {})));
    await evaluatePoolBadges(poolId).catch(() => {});
    await interaction.editReply({ embeds: [buildPoolEmbed('✅ All Approved', `**${pending.length}** pending agent${pending.length !== 1 ? 's' : ''} approved and activated in **${pool.name}**.`, Colors.SUCCESS)], components: [] });
    return true;
  }

  if (bulkAction === 'reject_all') {
    const pending = allAgents.filter(a => a.status === 'pending');
    await Promise.all(pending.map(a => storageLayer.revokeAgentToken(a.agent_id, userId).catch(() => {})));
    await interaction.editReply({ embeds: [buildPoolEmbed('❌ All Rejected', `**${pending.length}** pending contribution${pending.length !== 1 ? 's' : ''} rejected and removed.`, Colors.WARNING)], components: [] });
    return true;
  }

  if (bulkAction === 'suspend_all') {
    const active = allAgents.filter(a => a.status === 'active');
    await Promise.all(active.map(a => storageLayer.updateAgentBotStatus(a.agent_id, 'suspended', userId).catch(() => {})));
    await interaction.editReply({ embeds: [buildPoolEmbed('🟠 All Suspended', `**${active.length}** active agent${active.length !== 1 ? 's' : ''} suspended from **${pool.name}**.`, Colors.WARNING)], components: [] });
    return true;
  }

  if (bulkAction === 'unsuspend_all') {
    const suspended = allAgents.filter(a => a.status === 'suspended');
    await Promise.all(suspended.map(a => storageLayer.updateAgentBotStatus(a.agent_id, 'active', userId).catch(() => {})));
    await evaluatePoolBadges(poolId).catch(() => {});
    await interaction.editReply({ embeds: [buildPoolEmbed('🟢 All Unsuspended', `**${suspended.length}** suspended agent${suspended.length !== 1 ? 's' : ''} restored to active.`, Colors.SUCCESS)], components: [] });
    return true;
  }

  return false;
}

// ──────────────────────────────────────────────────────────────────────────
// /pools help — inline guide for new users
// ──────────────────────────────────────────────────────────────────────────
async function handleHelp(interaction) {
  const pages = [
    new EmbedBuilder()
      .setTitle('\uD83C\uDFB8 Agent Pools — Quick Start Guide')
      .setColor(0x5865F2)
      .setDescription(
        'Agent pools are groups of Discord bot tokens that power music playback and assistant features in your server.\n\n' +
        'Pools are owned and managed by community members. You can use a public pool or create your own.'
      )
      .addFields(
        { name: '\uD83D\uDE80 Use a Public Pool (easiest)', value:
          '1. `/pools list` — browse available pools\n' +
          '2. `/pools select pool:<id>` — attach a pool to your server\n' +
          '3. `/agents deploy` — deploy an agent to your voice channel', inline: false },
        { name: '\uD83D\uDD11 Create Your Own Pool', value:
          '1. `/pools create name:<name>` — create a pool\n' +
          '2. `/agents add_token` — contribute your own Discord bot token\n' +
          '3. `/agents deploy` — start using your pool', inline: false },
        { name: '\uD83E\uDD1D Contribute to a Pool', value:
          '1. `/pools public` — view pools accepting contributions\n' +
          '2. `/agents add_token pool:<id>` — submit a bot token\n' +
          '3. Wait for the pool owner to approve your contribution', inline: false },
      )
      .setFooter({ text: 'Page 1/3 — Workflows' }),

    new EmbedBuilder()
      .setTitle('\uD83D\uDD12 Security Promises')
      .setColor(0x57F287)
      .addFields(
        { name: 'Token Storage', value: 'Bot tokens are AES-256-GCM encrypted at rest using a per-pool HKDF-derived key. The plaintext token is never logged or shown in embeds — only a masked version like `BOT_***...***_xyz` is ever displayed.', inline: false },
        { name: 'Token Revocation', value: 'When you revoke a token (`/agents revoke`), the ciphertext is **immediately nulled in the database** — not just status-flagged. Revoked tokens cannot be recovered or reactivated.', inline: false },
        { name: 'Pool Ownership', value: 'Only the pool owner and appointed managers can approve contributions, change settings, or transfer ownership. Admins of other servers **cannot** manage your pool.', inline: false },
        { name: 'Capacity Limits', value: 'Each pool holds a maximum of 49 agents (recommended: 10 active). Going over capacity is blocked at every insertion and activation point.', inline: false },
      )
      .setFooter({ text: 'Page 2/3 — Security' }),

    new EmbedBuilder()
      .setTitle('\u2699\uFE0F Pool Commands Reference')
      .setColor(0xFEE75C)
      .addFields(
        { name: '\uD83D\uDCCB Discovery & Stats', value:
          '`/pools list` · `/pools discover` · `/pools leaderboard` · `/pools stats`', inline: false },
        { name: '\uD83D\uDD27 Pool Management', value:
          '`/pools create` · `/pools view` · `/pools settings` · `/pools profile` · `/pools delete` · `/pools transfer`', inline: false },
        { name: '\uD83E\uDD1D Contributions', value:
          '`/pools contributions` · `/pools approve` · `/pools reject`', inline: false },
        { name: '\uD83C\uDF10 Multi-Pool & Alliances', value:
          '`/pools secondary` · `/pools ally` · `/pools specialty` · `/pools members`', inline: false },
        { name: '\uD83E\uDD16 Agents', value:
          '`/agents deploy` · `/agents list` · `/agents add_token` · `/agents revoke` · `/agents my_agents`', inline: false },
      )
      .setFooter({ text: 'Page 3/3 — Commands' }),
  ];

  // Send all 3 pages as separate embeds in one reply
  await interaction.reply({ embeds: pages, flags: MessageFlags.Ephemeral });
}

// ── Pool Reviews (C3c) ──────────────────────────────────────────────────────

function starsDisplay(avg) {
  const full = Math.round(avg);
  return '⭐'.repeat(Math.min(5, full)) + '☆'.repeat(Math.max(0, 5 - full)) + ` (${Number(avg).toFixed(1)})`;
}

async function handleReview(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const poolId = interaction.options.getString('pool', true);
  const action = interaction.options.getString('action') || 'submit';
  const userId = interaction.user.id;

  const pool = await storageLayer.fetchPool(poolId).catch(() => null);
  if (!pool) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Pool Not Found', `Pool \`${poolId}\` does not exist.`, Colors.ERROR)] });
  }

  // VIEW
  if (action === 'view') {
    const [reviews, summary] = await Promise.all([
      storageLayer.fetchPoolReviews(poolId, 8),
      storageLayer.fetchPoolRatingSummary(poolId),
    ]);
    const embed = new EmbedBuilder()
      .setTitle(`⭐ Reviews — ${pool.name}`)
      .setColor(Colors.INFO)
      .setTimestamp();

    if (summary.count === 0) {
      embed.setDescription('No reviews yet. Be the first to review this pool!');
    } else {
      embed.setDescription(`**${starsDisplay(summary.avg)}** · ${summary.count} review${summary.count !== 1 ? 's' : ''}`);
      for (const r of reviews) {
        const stars = '⭐'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
        embed.addFields({
          name: `${stars} — <@${r.user_id}>`,
          value: r.comment || '*No comment*',
          inline: false,
        });
      }
    }
    return interaction.editReply({ embeds: [embed] });
  }

  // DELETE
  if (action === 'delete') {
    const deleted = await storageLayer.deletePoolReview(poolId, userId);
    return interaction.editReply({
      embeds: [buildPoolEmbed(deleted ? 'Review Deleted' : 'No Review Found',
        deleted ? 'Your review has been removed.' : "You haven't reviewed this pool.",
        deleted ? Colors.SUCCESS : Colors.WARNING)]
    });
  }

  // SUBMIT
  const stars = interaction.options.getInteger('stars', true);
  const comment = interaction.options.getString('comment', false) || null;

  // Don't let pool owners review their own pool
  if (pool.owner_user_id === userId) {
    return interaction.editReply({ embeds: [buildPoolEmbed('Cannot Review', 'Pool owners cannot review their own pool.', Colors.WARNING)] });
  }

  await storageLayer.upsertPoolReview(poolId, userId, stars, comment, interaction.guildId);
  const summary = await storageLayer.fetchPoolRatingSummary(poolId);

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('✅ Review Submitted')
        .setColor(Colors.SUCCESS)
        .setDescription(`You rated **${pool.name}** ${'⭐'.repeat(stars)}${'☆'.repeat(5 - stars)}\n\nPool average: **${starsDisplay(summary.avg)}** (${summary.count} reviews)`)
        .setTimestamp()
    ]
  });
}
