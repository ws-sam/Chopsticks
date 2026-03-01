// src/tools/antinuke/engine.js
// Anti-nuke protection engine.
// Tracks destructive actions per executor per guild in a sliding time window.
// If threshold is exceeded, the engine "punishes" the executor automatically.

import { loadGuildData, saveGuildData } from "../../utils/storage.js";

// In-memory action counters: Map<"guildId:userId:action", { count, firstAt }>
const actionCounters = new Map();
// Corresponding cleanup timers (one per key, replaced on each new action)
const actionTimers = new Map();

const DEFAULT_CONFIG = {
  enabled: false,
  // Thresholds: number of actions within `windowMs` before punishment
  thresholds: {
    ban: 3,
    kick: 5,
    channelDelete: 3,
    roleDelete: 3,
    webhookCreate: 5,
    emojiDelete: 10,
  },
  windowMs: 10_000,       // 10-second sliding window
  punishment: "stripperms", // "stripperms" | "kick" | "ban"
  whitelistUserIds: [],
  whitelistRoleIds: [],
  logChannelId: null,
};

export async function getAntinukeConfig(guildId) {
  const gd = await loadGuildData(guildId);
  gd.antinuke ??= { ...DEFAULT_CONFIG };
  return gd.antinuke;
}

export async function saveAntinukeConfig(guildId, config) {
  const gd = await loadGuildData(guildId);
  gd.antinuke = config;
  await saveGuildData(guildId, gd);
}

/**
 * Record an action and check if the executor has exceeded the threshold.
 * Returns true if the action crossed the threshold (punishment needed).
 */
export function recordAction(guildId, userId, action, config) {
  if (!config?.enabled) return false;

  const threshold = config.thresholds?.[action] ?? Infinity;
  if (threshold === Infinity) return false;

  const key = `${guildId}:${userId}:${action}`;
  const now = Date.now();
  const entry = actionCounters.get(key) ?? { count: 0, firstAt: now };

  // Reset window if expired
  if (now - entry.firstAt > (config.windowMs ?? 10_000)) {
    entry.count = 0;
    entry.firstAt = now;
  }

  entry.count++;
  actionCounters.set(key, entry);

  // Replace any existing cleanup timer so only one fires per key
  clearTimeout(actionTimers.get(key));
  const timer = setTimeout(() => {
    actionCounters.delete(key);
    actionTimers.delete(key);
  }, (config.windowMs ?? 10_000) * 2);
  actionTimers.set(key, timer);

  return entry.count >= threshold;
}

/**
 * Punish the executor: strip dangerous permissions or kick/ban.
 */
export async function punishExecutor(guild, userId, action, config) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    // Don't punish server owner
    if (guild.ownerId === userId) return;

    // Check whitelist (explicit user or role exemptions only)
    if (config.whitelistUserIds?.includes(userId)) return;
    if (config.whitelistRoleIds?.some(rid => member.roles.cache.has(rid))) return;

    const punishment = config.punishment ?? "stripperms";

    if (punishment === "ban") {
      await guild.bans.create(userId, { reason: `[AntiNuke] Exceeded ${action} threshold` }).catch(() => null);
    } else if (punishment === "kick") {
      await member.kick(`[AntiNuke] Exceeded ${action} threshold`).catch(() => null);
    } else {
      // Strip all managed roles that grant dangerous permissions
      const dangerousPerms = 0n
        | BigInt(0x00000004)  // ADMINISTRATOR
        | BigInt(0x00000008)  // MANAGE_CHANNELS
        | BigInt(0x00000010)  // MANAGE_GUILD
        | BigInt(0x10000000) // MANAGE_ROLES
        | BigInt(0x00400000); // MANAGE_WEBHOOKS

      for (const role of member.roles.cache.values()) {
        if (role.managed) continue;
        if (role.permissions.any(dangerousPerms)) {
          await member.roles.remove(role, "[AntiNuke] Dangerous permission role stripped").catch(() => null);
        }
      }
    }

    // Log to channel
    if (config.logChannelId) {
      const ch = guild.channels.cache.get(config.logChannelId);
      if (ch?.isTextBased()) {
        await ch.send({
          embeds: [{
            title: "⚠️ Anti-Nuke Triggered",
            description: `<@${userId}> exceeded the **${action}** threshold and received punishment: **${punishment}**.`,
            color: 0xFF0000,
            timestamp: new Date().toISOString(),
          }]
        }).catch(() => null);
      }
    }

    // Alert guild owner via DM
    const owner = await guild.fetchOwner().catch(() => null);
    if (owner) {
      await owner.send({
        embeds: [{
          title: "⚠️ Anti-Nuke Triggered",
          description: `In **${guild.name}**: <@${userId}> exceeded the **${action}** threshold.\nPunishment applied: **${punishment}**.`,
          color: 0xFF0000,
          timestamp: new Date().toISOString(),
        }]
      }).catch(() => null);
    }
  } catch { /* punishment errors must not crash the bot */ }
}
