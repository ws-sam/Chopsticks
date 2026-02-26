// src/commands/stats.js
// /stats me|user|leaderboard|achievements — per-guild activity stats

import {
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { getGuildStats, getUserAchievements, getGuildLeaderboard, getGuildXpLeaderboard } from '../utils/storage.js';
import { FIELD_LABELS, LEADERBOARD_FIELDS } from '../game/activityStats.js';
import { ACHIEVEMENT_DEFS, ensureAchievementsSeed } from '../game/achievements.js';
import { withTimeout } from '../utils/interactionTimeout.js';
import { progressBar } from '../utils/embedComponents.js';

export const meta = {
  deployGlobal: false,
  name: 'stats',
  description: 'Per-guild activity stats, leaderboards, and achievements',
  category: "info",
};

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('📊 View server stats, leaderboards, and achievements')
  .addSubcommand(s => s
    .setName('me')
    .setDescription('View your stats in this server'))
  .addSubcommand(s => s
    .setName('user')
    .setDescription("View another user's stats")
    .addUserOption(o => o.setName('target').setDescription('User to view').setRequired(true)))
  .addSubcommand(s => s
    .setName('leaderboard')
    .setDescription('View the server leaderboard')
    .addStringOption(o => o.setName('metric').setDescription('What to rank by').setRequired(false)
      .addChoices(
        { name: '⚡ XP / Level', value: 'xp' },
        { name: '🏆 Level (global)', value: 'level' },
        { name: '💎 Net Worth', value: 'networth' },
        { name: '🎙️ VC Time', value: 'vc' },
        { name: '💬 Messages', value: 'messages' },
        { name: '💰 Credits Earned', value: 'credits' },
        { name: '💼 Work Runs', value: 'work' },
        { name: '⛏️ Gather Runs', value: 'gather' },
        { name: '⚔️ Fight Wins', value: 'fights' },
        { name: '🧠 Trivia Wins', value: 'trivia' },
        { name: '⌨️ Commands Used', value: 'commands' },
        { name: '🤖 Agent Actions', value: 'agent_actions' },
      )))
  .addSubcommand(s => s
    .setName('achievements')
    .setDescription('View your or another user\'s achievements')
    .addUserOption(o => o.setName('target').setDescription('User to view (default: you)').setRequired(false)));

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'me' || sub === 'user') {
    const target = sub === 'user'
      ? (interaction.options.getUser('target') || interaction.user)
      : interaction.user;

    await interaction.deferReply({ ephemeral: sub === 'me' });
    await withTimeout(interaction, async () => {
      const [stats, xpRow, achRows] = await Promise.all([
        getGuildStats(target.id, interaction.guildId).catch(() => null),
        import('../utils/storage.js').then(s => s.getGuildXpLeaderboard
          ? null
          : null).catch(() => null),
        getUserAchievements(target.id, interaction.guildId).catch(() => []),
      ]);

      // Fetch guild XP separately
      let guildXp = null;
      try {
        const { getPool } = await import('../utils/storage_pg.js');
        const p = getPool();
        const r = await p.query('SELECT xp, level FROM user_guild_xp WHERE user_id=$1 AND guild_id=$2', [target.id, interaction.guildId]);
        guildXp = r.rows[0] || null;
      } catch {}

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${target.username}'s Stats — ${interaction.guild.name}`)
        .setThumbnail(target.displayAvatarURL({ size: 128 }))
        .setColor(Colors.Blurple);

      if (guildXp) {
        const xpInLevel = Number(guildXp.xp) % 1000;
        const xpBar = progressBar(xpInLevel, 1000);
        embed.addFields({ name: '⚡ Guild Level', value: `Level **${guildXp.level}** — ${Number(guildXp.xp).toLocaleString()} XP\n${xpBar}`, inline: false });
      }

      if (stats) {
        embed.addFields(
          { name: '🎙️ VC Time', value: formatMinutes(stats.vc_minutes), inline: true },
          { name: '🎙️ VC Sessions', value: String(stats.vc_sessions || 0), inline: true },
          { name: '💬 Messages', value: Number(stats.messages_sent || 0).toLocaleString(), inline: true },
          { name: '💰 Credits Earned', value: Number(stats.credits_earned || 0).toLocaleString(), inline: true },
          { name: '💼 Work Runs', value: String(stats.work_runs || 0), inline: true },
          { name: '⛏️ Gather Runs', value: String(stats.gather_runs || 0), inline: true },
          { name: '⚔️ Fight Wins', value: String(stats.fight_wins || 0), inline: true },
          { name: '🧠 Trivia Wins', value: String(stats.trivia_wins || 0), inline: true },
          { name: '🤖 Agent Actions', value: String(stats.agent_actions_used || 0), inline: true },
          { name: '⌨️ Commands Used', value: Number(stats.commands_used || 0).toLocaleString(), inline: true },
        );
      } else {
        embed.setDescription('No activity recorded yet in this server.');
      }

      if (achRows.length) {
        const badges = achRows.slice(0, 12).map(a => `${a.emoji} ${a.name}`).join(' • ');
        embed.addFields({ name: `🏆 Achievements (${achRows.length})`, value: badges });
      }

      await interaction.editReply({ embeds: [embed] });
    }, { label: 'stats' });
    return;
  }

  if (sub === 'leaderboard') {
    const metric = interaction.options.getString('metric') || 'xp';
    await interaction.deferReply();
    await withTimeout(interaction, async () => {
      let rows;
      let title;
      let formatter;

      if (metric === 'xp') {
        rows = await getGuildXpLeaderboard(interaction.guildId, 10).catch(() => []);
        title = '⚡ XP Leaderboard';
        formatter = r => `Level **${r.level}** • ${Number(r.xp).toLocaleString()} XP`;
      } else if (metric === 'level') {
        // Global level leaderboard (user_game_profiles)
        const { getPool } = await import('../utils/storage_pg.js');
        const p = getPool();
        const res = await p.query(
          `SELECT user_id, level, xp FROM user_game_profiles ORDER BY level DESC, xp DESC LIMIT 10`
        ).catch(() => ({ rows: [] }));
        rows = res.rows.map(r => ({ user_id: r.user_id, value: r.level, xp: r.xp }));
        title = '🏆 Global Level Leaderboard';
        formatter = r => `Level **${r.value}** • ${Number(r.xp || 0).toLocaleString()} XP`;
      } else if (metric === 'networth') {
        // Net worth = wallet + bank balance
        const { getPool } = await import('../utils/storage_pg.js');
        const p = getPool();
        const res = await p.query(
          `SELECT w.user_id, COALESCE(w.balance,0)+COALESCE(b.balance,0) AS networth
           FROM wallets w LEFT JOIN bank_accounts b ON b.user_id = w.user_id
           ORDER BY networth DESC LIMIT 10`
        ).catch(() => ({ rows: [] }));
        rows = res.rows.map(r => ({ user_id: r.user_id, value: r.networth }));
        title = '💎 Net Worth Leaderboard';
        formatter = r => `💰 ${Number(r.value).toLocaleString()} credits`;
      } else {
        const field = LEADERBOARD_FIELDS[metric] || metric;
        rows = await getGuildLeaderboard(interaction.guildId, field, 10).catch(() => []);
        title = `${FIELD_LABELS[field] || field} Leaderboard`;
        formatter = r => {
          if (field === 'vc_minutes') return formatMinutes(r.value);
          return Number(r.value).toLocaleString();
        };
      }

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${interaction.guild.name} — ${title}`)
        .setColor(Colors.Blurple);

      if (!rows.length) {
        embed.setDescription('No data yet. Get active to appear here!');
      } else {
        const MEDALS = ['🥇', '🥈', '🥉'];
        const lines = rows.map((r, i) => {
          const medal = MEDALS[i] || `**${i + 1}.**`;
          return `${medal} <@${r.user_id}> — ${formatter(r)}`;
        });
        embed.setDescription(lines.join('\n'));
      }

      await interaction.editReply({ embeds: [embed] });
    }, { label: 'stats' });
    return;
  }

  if (sub === 'achievements') {
    const target = interaction.options.getUser('target') || interaction.user;
    await interaction.deferReply({ ephemeral: target.id === interaction.user.id });
    await withTimeout(interaction, async () => {
      await ensureAchievementsSeed();

      const achRows = await getUserAchievements(target.id, interaction.guildId).catch(() => []);
      const totalDefs = ACHIEVEMENT_DEFS.length;

      const embed = new EmbedBuilder()
        .setTitle(`🏆 ${target.username}'s Achievements — ${interaction.guild.name}`)
        .setThumbnail(target.displayAvatarURL({ size: 64 }))
        .setColor(Colors.Gold)
        .setFooter({ text: `${achRows.length}/${totalDefs} achievements unlocked` });

      if (!achRows.length) {
        embed.setDescription('No achievements unlocked yet.\nStart playing to earn badges!');
      } else {
        const byCategory = {};
        for (const a of achRows) {
          byCategory[a.category] = byCategory[a.category] || [];
          byCategory[a.category].push(a);
        }
        for (const [cat, achs] of Object.entries(byCategory)) {
          const list = achs.map(a => `${a.emoji} **${a.name}** *(${a.rarity})*`).join('\n');
          embed.addFields({ name: `${capitalize(cat)} (${achs.length})`, value: list, inline: true });
        }
      }

      await interaction.editReply({ embeds: [embed] });
    }, { label: 'stats' });
    return;
  }

  await interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
}

function formatMinutes(mins) {
  const m = Number(mins || 0);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
