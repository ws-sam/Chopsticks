// src/commands/card.js
// /card tweet|quote|profile — generate stylized image cards

import {
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  Colors,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
} from 'discord.js';
import { fetchAvatar, roundRect, drawCircleImage, drawWrappedText, drawProgressBar, createDarkCard, toPngBuffer } from '../utils/canvas.js';
import { withTimeout } from '../utils/interactionTimeout.js';

export const meta = {
  name: 'card',
  description: 'Generate stylized image cards',
  category: 'fun',
};

export const data = new SlashCommandBuilder()
  .setName('card')
  .setDescription('🎴 Generate stylized image cards')
  .addSubcommand(s => s
    .setName('tweet')
    .setDescription('Create a Twitter/X-style post image')
    .addStringOption(o => o.setName('text').setDescription('Your post content').setRequired(true).setMaxLength(280))
    .addStringOption(o => o.setName('username').setDescription('Display name (default: your username)').setRequired(false).setMaxLength(50))
    .addStringOption(o => o.setName('handle').setDescription('@handle (default: your tag)').setRequired(false).setMaxLength(50)))
  .addSubcommand(s => s
    .setName('quote')
    .setDescription('Create a quote card from text')
    .addStringOption(o => o.setName('text').setDescription('The quote text').setRequired(true).setMaxLength(300))
    .addStringOption(o => o.setName('author').setDescription('Quote author (default: your username)').setRequired(false).setMaxLength(60)))
  .addSubcommand(s => s
    .setName('profile')
    .setDescription('Generate your server profile card'))
;

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  await interaction.deferReply();

  await withTimeout(interaction, async () => {
    try {
      if (sub === 'tweet') {
        const buf = await buildTweetCard(interaction);
        const att = new AttachmentBuilder(buf, { name: 'tweet.png' });
        await interaction.editReply({ files: [att] });
        return;
      }

      if (sub === 'quote') {
        const buf = await buildQuoteCard(interaction);
        const att = new AttachmentBuilder(buf, { name: 'quote.png' });
        await interaction.editReply({ files: [att] });
        return;
      }

      if (sub === 'profile') {
        const buf = await buildProfileCard(interaction);
        const att = new AttachmentBuilder(buf, { name: 'profile.png' });
        await interaction.editReply({ files: [att] });
        return;
      }
    } catch (err) {
      await interaction.editReply({ content: `❌ Failed to generate card: ${err.message}` });
    }
  }, { label: "card" });
}

// ── Tweet Card ────────────────────────────────────────────────────────────────

async function buildTweetCard(interaction) {
  const text = interaction.options.getString('text');
  const displayName = interaction.options.getString('username') || interaction.user.displayName || interaction.user.username;
  const handle = '@' + (interaction.options.getString('handle') || interaction.user.username).replace(/^@/, '');

  const W = 600, H = 300;
  const { canvas, ctx } = createDarkCard(W, H);

  // Twitter blue accent bar top
  ctx.fillStyle = '#1D9BF0';
  ctx.fillRect(0, 0, W, 4);

  // Avatar
  const avatarUrl = interaction.user.displayAvatarURL({ size: 64, extension: 'png' });
  const avatar = await fetchAvatar(avatarUrl, 64);
  drawCircleImage(ctx, avatar, 24, 24, 52, '#5865F2');

  // Name + handle
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(displayName, 88, 42);
  ctx.fillStyle = '#8B98A5';
  ctx.font = '14px sans-serif';
  ctx.fillText(handle, 88, 62);

  // Twitter bird icon (simplified)
  ctx.fillStyle = '#1D9BF0';
  ctx.font = '22px sans-serif';
  ctx.fillText('𝕏', W - 44, 48);

  // Divider
  ctx.strokeStyle = '#2E3035';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(24, 88);
  ctx.lineTo(W - 24, 88);
  ctx.stroke();

  // Post text
  ctx.fillStyle = '#E7E9EA';
  ctx.font = '18px sans-serif';
  const textY = drawWrappedText(ctx, text, 24, 116, W - 48, 28);

  // Divider
  ctx.strokeStyle = '#2E3035';
  ctx.beginPath();
  ctx.moveTo(24, Math.max(textY + 12, 220));
  ctx.lineTo(W - 24, Math.max(textY + 12, 220));
  ctx.stroke();

  // Timestamp + cosmetic stats
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) +
    ' · ' + now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  ctx.fillStyle = '#8B98A5';
  ctx.font = '13px sans-serif';
  ctx.fillText(timeStr, 24, H - 30);

  // Cosmetic engagement numbers
  const likes = Math.floor(Math.random() * 9000) + 100;
  const rts = Math.floor(Math.random() * 500) + 5;
  ctx.fillText(`♡ ${likes.toLocaleString()}   🔁 ${rts.toLocaleString()}`, W - 180, H - 30);

  return toPngBuffer(canvas);
}

// ── Quote Card ────────────────────────────────────────────────────────────────

async function buildQuoteCard(interaction) {
  const text = interaction.options.getString('text');
  const author = interaction.options.getString('author') || interaction.user.displayName || interaction.user.username;

  const W = 600, H = 280;
  const { canvas, ctx } = createDarkCard(W, H);

  // Glassmorphism overlay
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  roundRect(ctx, 16, 16, W - 32, H - 32, 12);
  ctx.fill();

  // Quote marks
  ctx.fillStyle = '#5865F2';
  ctx.font = 'bold 72px serif';
  ctx.fillText('"', 24, 80);

  // Quote text
  ctx.fillStyle = '#E7E9EA';
  ctx.font = 'italic 20px sans-serif';
  drawWrappedText(ctx, text, 56, 60, W - 80, 30);

  // Author line
  ctx.fillStyle = '#5865F2';
  ctx.font = 'bold 15px sans-serif';
  const avatarUrl = interaction.user.displayAvatarURL({ size: 32, extension: 'png' });
  const avatar = await fetchAvatar(avatarUrl, 32);
  drawCircleImage(ctx, avatar, 40, H - 64, 32, '#5865F2');
  ctx.fillText('— ' + author, 82, H - 42);

  // Server footer
  ctx.fillStyle = '#8B98A5';
  ctx.font = '12px sans-serif';
  ctx.fillText(interaction.guild.name, W - ctx.measureText(interaction.guild.name).width - 20, H - 20);

  return toPngBuffer(canvas);
}

// ── Profile Card ──────────────────────────────────────────────────────────────

async function buildProfileCard(interaction) {
  const { getGuildStats, getUserAchievements } = await import('../utils/storage.js');

  const W = 700, H = 260;
  const { canvas, ctx } = createDarkCard(W, H);

  // Top accent
  ctx.fillStyle = '#5865F2';
  ctx.fillRect(0, 0, W, 6);

  // Avatar
  const avatarUrl = interaction.user.displayAvatarURL({ size: 80, extension: 'png' });
  const avatar = await fetchAvatar(avatarUrl, 80);
  drawCircleImage(ctx, avatar, 24, 24, 80, '#5865F2');

  // Name
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(interaction.user.displayName || interaction.user.username, 118, 52);

  // Guild name
  ctx.fillStyle = '#8B98A5';
  ctx.font = '14px sans-serif';
  ctx.fillText(interaction.guild.name, 118, 74);

  // XP bar
  let guildXp = { xp: 0, level: 1 };
  try {
    const { getPool } = await import('../utils/storage_pg.js');
    const p = getPool();
    const r = await p.query('SELECT xp, level FROM user_guild_xp WHERE user_id=$1 AND guild_id=$2', [interaction.user.id, interaction.guildId]);
    if (r.rows[0]) guildXp = r.rows[0];
  } catch {}

  const { xpForLevel, levelFromXp } = await import('../game/progression.js');
  const lvl = Number(guildXp.level) || 1;
  const curXp = Number(guildXp.xp) || 0;
  const floorXp = xpForLevel(lvl);
  const nextXp = xpForLevel(lvl + 1);
  const progress = nextXp > floorXp ? (curXp - floorXp) / (nextXp - floorXp) : 0;

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`Level ${lvl}`, 118, 100);
  ctx.fillStyle = '#8B98A5';
  ctx.font = '13px sans-serif';
  ctx.fillText(`${curXp.toLocaleString()} / ${nextXp.toLocaleString()} XP`, 220, 100);
  drawProgressBar(ctx, 118, 110, W - 150, 12, progress, { fill: '#5865F2' });

  // Stats row
  const stats = await getGuildStats(interaction.user.id, interaction.guildId).catch(() => null);
  if (stats) {
    const statItems = [
      { label: '🎙️ VC', value: formatMinutes(stats.vc_minutes) },
      { label: '💬 Msgs', value: Number(stats.messages_sent || 0).toLocaleString() },
      { label: '💼 Work', value: String(stats.work_runs || 0) },
      { label: '⚔️ Wins', value: String(stats.fight_wins || 0) },
      { label: '🧠 Trivia', value: String(stats.trivia_wins || 0) },
    ];
    const colW = (W - 24) / statItems.length;
    statItems.forEach((s, i) => {
      const x = 12 + i * colW;
      ctx.fillStyle = '#8B98A5';
      ctx.font = '12px sans-serif';
      ctx.fillText(s.label, x, 160);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(s.value, x, 180);
    });
  }

  // Achievements
  const achs = await getUserAchievements(interaction.user.id, interaction.guildId).catch(() => []);
  if (achs.length) {
    ctx.fillStyle = '#8B98A5';
    ctx.font = '12px sans-serif';
    ctx.fillText('Achievements', 24, 216);
    const badges = achs.slice(0, 10).map(a => a.emoji).join(' ');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '18px sans-serif';
    ctx.fillText(badges, 24, 240);
  }

  return toPngBuffer(canvas);
}

function formatMinutes(mins) {
  const m = Number(mins || 0);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h >= 10 ? `${h}h` : `${h}h ${m % 60}m`;
}
