// src/game/guildXp.js
// Per-guild XP system. Config-aware, achievement-triggering, level-up announcing.

import { addGuildXpRow, getGuildXpConfig } from '../utils/storage.js';
import { checkAchievements } from './achievements.js';

const DEFAULT_CONFIG = {
  enabled: true,
  xp_per_message: 5,
  xp_per_vc_minute: 2,
  xp_per_work: 40,
  xp_per_gather: 30,
  xp_per_fight_win: 50,
  xp_per_trivia_win: 60,
  xp_per_daily: 80,
  xp_per_command: 1,
  xp_per_agent_action: 20,
  message_xp_cooldown_s: 60,
  xp_multiplier: 1.0,
  levelup_channel_id: null,
  levelup_message: 'GG {user}, you hit **level {level}**! 🎉',
  levelup_dm: false,
  sync_global_xp: true,
};

// Per-guild per-user message XP cooldown tracking (in-memory, resets on restart — intentional)
const msgCooldowns = new Map();

/**
 * Award per-guild XP to a user.
 * @param {string}  userId
 * @param {string}  guildId
 * @param {string}  reason  - 'message'|'vc_minute'|'work'|'gather'|'fight_win'|'trivia_win'|'daily'|'command'|'agent_action'|'achievement'|custom
 * @param {object}  [opts]
 * @param {object}  [opts.client]    - Discord.js client (for level-up announcement)
 * @param {object}  [opts.stats]     - current user_guild_stats row (for achievement check)
 * @param {number}  [opts.baseXp]    - override base XP (ignores config source lookup)
 * @returns {Promise<{ok:boolean, applied:number, leveledUp:boolean, toLevel:number}|null>}
 */
export async function addGuildXp(userId, guildId, reason, { client = null, stats = null, baseXp = null } = {}) {
  if (!userId || !guildId) return null;
  try {
    const cfg = { ...DEFAULT_CONFIG, ...(await getGuildXpConfig(guildId).catch(() => null) || {}) };
    if (!cfg.enabled) return null;

    // Resolve base XP from reason
    const SOURCE_MAP = {
      message: 'xp_per_message',
      vc_minute: 'xp_per_vc_minute',
      work: 'xp_per_work',
      gather: 'xp_per_gather',
      fight_win: 'xp_per_fight_win',
      trivia_win: 'xp_per_trivia_win',
      daily: 'xp_per_daily',
      command: 'xp_per_command',
      agent_action: 'xp_per_agent_action',
    };

    let base = baseXp;
    if (base === null) {
      const configKey = SOURCE_MAP[reason];
      base = configKey ? Number(cfg[configKey] || 0) : 10;
    }
    if (base <= 0) return null;

    // Message cooldown guard
    if (reason === 'message') {
      const cooldownMs = (Number(cfg.message_xp_cooldown_s) || 60) * 1000;
      const ck = `${guildId}:${userId}`;
      const last = msgCooldowns.get(ck) || 0;
      const now = Date.now();
      if (now - last < cooldownMs) return null;
      msgCooldowns.set(ck, now);
    }

    const multiplier = Number(cfg.xp_multiplier) || 1.0;
    const applied = Math.max(1, Math.round(base * multiplier));

    const result = await addGuildXpRow(userId, guildId, applied);
    if (!result) return null;

    // Achievement check (fire-and-forget)
    if (stats || result.leveledUp) {
      void checkAchievements(userId, guildId, stats, result, client).catch(() => {});
    }

    // Level-up announcement (fire-and-forget)
    if (result.leveledUp && client && (cfg.levelup_channel_id || cfg.levelup_dm)) {
      void announceLevel(client, guildId, userId, result.toLevel, cfg).catch(() => {});
    }

    return { ok: true, applied, ...result };
  } catch {
    return null;
  }
}

async function announceLevel(client, guildId, userId, level, cfg) {
  try {
    const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;
    const msg = (cfg.levelup_message || 'GG {user}, you hit **level {level}**! 🎉')
      .replace(/{user}/g, `<@${userId}>`)
      .replace(/{level}/g, String(level));

    // Send to configured channel
    if (cfg.levelup_channel_id) {
      const channel = guild.channels.cache.get(cfg.levelup_channel_id);
      if (channel?.isTextBased?.()) {
        await channel.send(msg).catch(() => {});
      }
    }

    // Send DM to the user if enabled
    if (cfg.levelup_dm) {
      try {
        const user = await client.users.fetch(userId).catch(() => null);
        if (user) {
          const dmMsg = (cfg.levelup_message || 'GG {user}, you hit **level {level}**! 🎉')
            .replace(/{user}/g, user.username)
            .replace(/{level}/g, String(level));
          await user.send(`🎉 **${guild.name}:** ${dmMsg}`).catch(() => {});
        }
      } catch {}
    }
  } catch {}
}
