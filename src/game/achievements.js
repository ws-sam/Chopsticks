// src/game/achievements.js
// 40+ achievement definitions + unlock checker.

import { grantAchievement, seedAchievements, getUserAchievements } from '../utils/storage.js';

export const ACHIEVEMENT_DEFS = [
  // ── VC ──────────────────────────────────────────────────────────────────
  { id: 'vc_first',       name: 'First Contact',        emoji: '🎙️', category: 'vc',      rarity: 'common',    description: 'Join a voice channel for the first time',              xp_reward: 50,   credit_reward: 10 },
  { id: 'vc_hour',        name: 'Talker',               emoji: '💬', category: 'vc',      rarity: 'common',    description: 'Spend 1 hour in voice channels',                        xp_reward: 100,  credit_reward: 25 },
  { id: 'vc_10h',         name: 'Social Butterfly',     emoji: '🦋', category: 'vc',      rarity: 'rare',      description: 'Spend 10 hours in voice channels',                      xp_reward: 250,  credit_reward: 75 },
  { id: 'vc_50h',         name: 'Mic Hog',              emoji: '🎤', category: 'vc',      rarity: 'epic',      description: 'Spend 50 hours in voice channels',                      xp_reward: 500,  credit_reward: 200 },
  { id: 'vc_100h',        name: 'Night Owl',            emoji: '🦉', category: 'vc',      rarity: 'legendary', description: 'Spend 100 hours in voice channels',                     xp_reward: 1000, credit_reward: 500 },
  { id: 'vc_sessions_10', name: 'Regular',              emoji: '🪑', category: 'vc',      rarity: 'common',    description: 'Join VC 10 times',                                      xp_reward: 75,   credit_reward: 20 },
  { id: 'vc_sessions_50', name: 'Always Here',          emoji: '🏠', category: 'vc',      rarity: 'rare',      description: 'Join VC 50 times',                                      xp_reward: 200,  credit_reward: 60 },

  // ── Messages ─────────────────────────────────────────────────────────────
  { id: 'msg_first',      name: 'Hello World',          emoji: '👋', category: 'social',  rarity: 'common',    description: 'Send your first message',                               xp_reward: 25,   credit_reward: 5 },
  { id: 'msg_100',        name: 'Chatterbox',           emoji: '🗣️', category: 'social',  rarity: 'common',    description: 'Send 100 messages',                                     xp_reward: 100,  credit_reward: 30 },
  { id: 'msg_1000',       name: 'Text Machine',         emoji: '⌨️', category: 'social',  rarity: 'rare',      description: 'Send 1,000 messages',                                   xp_reward: 300,  credit_reward: 100 },
  { id: 'msg_10000',      name: 'Wordsmith',            emoji: '📝', category: 'social',  rarity: 'epic',      description: 'Send 10,000 messages',                                  xp_reward: 750,  credit_reward: 300 },

  // ── Economy ──────────────────────────────────────────────────────────────
  { id: 'econ_first_earn',name: 'Bread Winner',         emoji: '🍞', category: 'economy', rarity: 'common',    description: 'Earn your first credits',                               xp_reward: 50,   credit_reward: 0 },
  { id: 'econ_1k',        name: 'Pocket Money',         emoji: '💵', category: 'economy', rarity: 'common',    description: 'Earn 1,000 credits total',                              xp_reward: 100,  credit_reward: 0 },
  { id: 'econ_10k',       name: 'Investor',             emoji: '📈', category: 'economy', rarity: 'rare',      description: 'Earn 10,000 credits total',                             xp_reward: 250,  credit_reward: 0 },
  { id: 'econ_100k',      name: 'Market Mogul',         emoji: '🏦', category: 'economy', rarity: 'epic',      description: 'Earn 100,000 credits total',                            xp_reward: 600,  credit_reward: 0 },
  { id: 'econ_1m',        name: 'Millionaire',          emoji: '💎', category: 'economy', rarity: 'legendary', description: 'Earn 1,000,000 credits total',                          xp_reward: 2000, credit_reward: 0 },
  { id: 'trade_first',    name: 'Handshake',            emoji: '🤝', category: 'economy', rarity: 'common',    description: 'Complete your first trade',                             xp_reward: 75,   credit_reward: 15 },
  { id: 'trade_50',       name: 'Deal Maker',           emoji: '📦', category: 'economy', rarity: 'rare',      description: 'Complete 50 trades',                                    xp_reward: 300,  credit_reward: 100 },
  { id: 'trade_250',      name: 'Merchant Prince',      emoji: '👑', category: 'economy', rarity: 'epic',      description: 'Complete 250 trades',                                   xp_reward: 750,  credit_reward: 300 },

  // ── Gaming ───────────────────────────────────────────────────────────────
  { id: 'work_first',     name: 'Clocker',              emoji: '⏰', category: 'gaming',  rarity: 'common',    description: 'Complete your first work run',                          xp_reward: 40,   credit_reward: 10 },
  { id: 'work_50',        name: 'Grinder',              emoji: '⚙️', category: 'gaming',  rarity: 'common',    description: 'Complete 50 work runs',                                 xp_reward: 150,  credit_reward: 50 },
  { id: 'work_250',       name: 'Workaholic',           emoji: '💼', category: 'gaming',  rarity: 'rare',      description: 'Complete 250 work runs',                                xp_reward: 400,  credit_reward: 150 },
  { id: 'gather_first',   name: 'Forager',              emoji: '⛏️', category: 'gaming',  rarity: 'common',    description: 'Complete your first gather run',                        xp_reward: 40,   credit_reward: 10 },
  { id: 'gather_50',      name: 'Gatherer',             emoji: '🌾', category: 'gaming',  rarity: 'common',    description: 'Complete 50 gather runs',                               xp_reward: 150,  credit_reward: 50 },
  { id: 'fight_first',    name: 'Warrior',              emoji: '⚔️', category: 'gaming',  rarity: 'common',    description: 'Win your first fight',                                  xp_reward: 60,   credit_reward: 15 },
  { id: 'fight_25',       name: 'Fighter',              emoji: '🥊', category: 'gaming',  rarity: 'common',    description: 'Win 25 fights',                                         xp_reward: 200,  credit_reward: 75 },
  { id: 'fight_100',      name: 'Champion',             emoji: '🏆', category: 'gaming',  rarity: 'rare',      description: 'Win 100 fights',                                        xp_reward: 500,  credit_reward: 200 },
  { id: 'trivia_first',   name: 'Curious',              emoji: '🤔', category: 'gaming',  rarity: 'common',    description: 'Win your first trivia question',                        xp_reward: 60,   credit_reward: 15 },
  { id: 'trivia_25',      name: 'Quiz Kid',             emoji: '📚', category: 'gaming',  rarity: 'common',    description: 'Win 25 trivia questions',                               xp_reward: 200,  credit_reward: 75 },
  { id: 'trivia_100',     name: 'Trivia Master',        emoji: '🧠', category: 'gaming',  rarity: 'rare',      description: 'Win 100 trivia questions',                              xp_reward: 500,  credit_reward: 200 },
  { id: 'heist_first',    name: 'Rookie Thief',         emoji: '🕵️', category: 'gaming',  rarity: 'common',    description: 'Complete your first heist',                             xp_reward: 75,   credit_reward: 20 },
  { id: 'casino_first',   name: 'High Roller',          emoji: '🎰', category: 'gaming',  rarity: 'common',    description: 'Win your first casino game',                            xp_reward: 50,   credit_reward: 15 },
  { id: 'casino_50',      name: 'Lucky Charm',          emoji: '🍀', category: 'gaming',  rarity: 'rare',      description: 'Win 50 casino games',                                   xp_reward: 300,  credit_reward: 100 },

  // ── Agent ────────────────────────────────────────────────────────────────
  { id: 'agent_first',    name: 'Agent Whisperer',      emoji: '🤖', category: 'agent',   rarity: 'rare',      description: 'Use your first agent action',                           xp_reward: 150,  credit_reward: 50 },
  { id: 'agent_10',       name: 'Agent Commander',      emoji: '🎮', category: 'agent',   rarity: 'epic',      description: 'Use 10 agent actions',                                  xp_reward: 400,  credit_reward: 150 },
  { id: 'agent_50',       name: 'Agent Overlord',       emoji: '🦾', category: 'agent',   rarity: 'legendary', description: 'Use 50 agent actions',                                  xp_reward: 1000, credit_reward: 500 },

  // ── Commands / Bot usage ─────────────────────────────────────────────────
  { id: 'cmd_10',         name: 'Button Pusher',        emoji: '🖱️', category: 'bot',     rarity: 'common',    description: 'Use 10 commands',                                       xp_reward: 30,   credit_reward: 5 },
  { id: 'cmd_100',        name: 'Bot Friend',           emoji: '🤝', category: 'bot',     rarity: 'common',    description: 'Use 100 commands',                                      xp_reward: 100,  credit_reward: 25 },
  { id: 'cmd_500',        name: 'Power User',           emoji: '⚡', category: 'bot',     rarity: 'rare',      description: 'Use 500 commands',                                      xp_reward: 300,  credit_reward: 100 },
  { id: 'cmd_2000',       name: 'Committed',            emoji: '💯', category: 'bot',     rarity: 'epic',      description: 'Use 2,000 commands',                                    xp_reward: 750,  credit_reward: 300 },
];

// Stat-field → achievement check mapping
const CHECKS = [
  // [stat_field, threshold, achievement_id]
  ['vc_sessions',         1,    'vc_first'],
  ['vc_sessions',         10,   'vc_sessions_10'],
  ['vc_sessions',         50,   'vc_sessions_50'],
  ['vc_minutes',          60,   'vc_hour'],
  ['vc_minutes',          600,  'vc_10h'],
  ['vc_minutes',          3000, 'vc_50h'],
  ['vc_minutes',          6000, 'vc_100h'],
  ['messages_sent',       1,    'msg_first'],
  ['messages_sent',       100,  'msg_100'],
  ['messages_sent',       1000, 'msg_1000'],
  ['messages_sent',       10000,'msg_10000'],
  ['credits_earned',      1,    'econ_first_earn'],
  ['credits_earned',      1000, 'econ_1k'],
  ['credits_earned',      10000,'econ_10k'],
  ['credits_earned',      100000,'econ_100k'],
  ['credits_earned',      1000000,'econ_1m'],
  ['trades_completed',    1,    'trade_first'],
  ['trades_completed',    50,   'trade_50'],
  ['trades_completed',    250,  'trade_250'],
  ['work_runs',           1,    'work_first'],
  ['work_runs',           50,   'work_50'],
  ['work_runs',           250,  'work_250'],
  ['gather_runs',         1,    'gather_first'],
  ['gather_runs',         50,   'gather_50'],
  ['fight_wins',          1,    'fight_first'],
  ['fight_wins',          25,   'fight_25'],
  ['fight_wins',          100,  'fight_100'],
  ['trivia_wins',         1,    'trivia_first'],
  ['trivia_wins',         25,   'trivia_25'],
  ['trivia_wins',         100,  'trivia_100'],
  ['heist_runs',          1,    'heist_first'],
  ['casino_wins',         1,    'casino_first'],
  ['casino_wins',         50,   'casino_50'],
  ['agent_actions_used',  1,    'agent_first'],
  ['agent_actions_used',  10,   'agent_10'],
  ['agent_actions_used',  50,   'agent_50'],
  ['commands_used',       10,   'cmd_10'],
  ['commands_used',       100,  'cmd_100'],
  ['commands_used',       500,  'cmd_500'],
  ['commands_used',       2000, 'cmd_2000'],
];

// Level-based achievements
const LEVEL_CHECKS = [
  [5,  'level_5',  'Level 5',  '🌱', 'Reach level 5',  100, 25,  'common'],
  [10, 'level_10', 'Veteran',  '🌿', 'Reach level 10', 250, 75,  'rare'],
  [25, 'level_25', 'Elder',    '🌳', 'Reach level 25', 600, 200, 'epic'],
  [50, 'level_50', 'Legend',   '🔥', 'Reach level 50', 1500,500, 'legendary'],
];

// Add level achievements to DEFS
for (const [lvl, id, name, emoji, desc, xp, cr, rarity] of LEVEL_CHECKS) {
  ACHIEVEMENT_DEFS.push({ id, name, emoji, category: 'progression', rarity, description: desc, xp_reward: xp, credit_reward: cr });
}

let _seeded = false;
export async function ensureAchievementsSeed() {
  if (_seeded) return;
  _seeded = true;
  await seedAchievements(ACHIEVEMENT_DEFS).catch(() => {});
}

/**
 * Check if the user has earned any new achievements after a stat update.
 * Fires credit/XP rewards automatically. Returns newly unlocked achievement ids.
 *
 * @param {string}       userId
 * @param {string}       guildId
 * @param {object|null}  stats      - user_guild_stats row (may be null — fetched if needed)
 * @param {object|null}  xpResult   - result from addGuildXpRow ({ leveledUp, toLevel })
 * @param {object|null}  client     - Discord.js client for notifications (optional)
 */
export async function checkAchievements(userId, guildId, stats, xpResult, client) {
  if (!userId || !guildId) return [];
  await ensureAchievementsSeed();

  const { getGuildStats } = await import('../utils/storage.js');
  const currentStats = stats || await getGuildStats(userId, guildId).catch(() => null);
  if (!currentStats) return [];

  const unlocked = [];

  for (const [field, threshold, achId] of CHECKS) {
    const val = Number(currentStats[field] || 0);
    if (val >= threshold) {
      const granted = await grantAchievement(userId, guildId, achId).catch(() => false);
      if (granted) unlocked.push(achId);
    }
  }

  // Level achievements
  if (xpResult?.leveledUp) {
    const level = xpResult.toLevel;
    for (const [lvl, id] of LEVEL_CHECKS) {
      if (level >= lvl) {
        const granted = await grantAchievement(userId, guildId, id).catch(() => false);
        if (granted) unlocked.push(id);
      }
    }
  }

  // Reward credits for unlocked achievements
  if (unlocked.length) {
    const defs = ACHIEVEMENT_DEFS.filter(d => unlocked.includes(d.id));
    for (const def of defs) {
      if (def.credit_reward > 0) {
        try {
          const { addCredits } = await import('../economy/wallet.js');
          await addCredits(userId, def.credit_reward, `achievement:${def.id}`).catch(() => {});
        } catch {}
      }
    }
    // Announce unlocks if client provided (find levelup channel or DM)
    if (client) {
      void notifyAchievements(client, userId, guildId, unlocked).catch(() => {});
    }
  }

  return unlocked;
}

async function notifyAchievements(client, userId, guildId, achIds) {
  try {
    const { getGuildXpConfig } = await import('../utils/storage.js');
    const { EmbedBuilder } = await import('discord.js');
    const cfg = await getGuildXpConfig(guildId).catch(() => null);
    const channelId = cfg?.levelup_channel_id;
    if (!channelId) return;
    const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased?.()) return;
    const defs = ACHIEVEMENT_DEFS.filter(d => achIds.includes(d.id));
    for (const def of defs) {
      const embed = new EmbedBuilder()
        .setColor(0xF5A623)
        .setDescription(`${def.emoji} <@${userId}> unlocked **${def.name}** *(${def.rarity})*\n${def.description}`)
        .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined })
        .setTimestamp();
      await channel.send({ content: `<@${userId}>`, embeds: [embed], allowedMentions: { users: [userId] } }).catch(() => {});
    }
  } catch {}
}

export function getAchievementDef(id) {
  return ACHIEVEMENT_DEFS.find(d => d.id === id) || null;
}
