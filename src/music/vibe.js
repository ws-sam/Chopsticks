// src/music/vibe.js
// Vibe Engine — detects server mood from recent messages and shapes music recommendations.
// Uses HuggingFace (free) with keyword fallback. No API key required for fallback.

import { classifyVibe } from "../utils/huggingface.js";
import { logger } from "../utils/logger.js";

// Per-guild vibe cache: guildId -> { vibe, detectedAt, override, overrideExpiresAt }
const vibeCache = new Map();
const VIBE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const VIBE_OVERRIDE_TTL_MS = 60 * 60 * 1000; // 1 hour

export const VIBES = ["energetic", "hype", "chill", "focus", "melancholy", "neutral"];

// Maps vibe to search query hints to shape Lavalink/YouTube searches
export const VIBE_GENRE_HINTS = {
  energetic: "upbeat electronic dance",
  hype:      "hip hop trap banger",
  chill:     "lo-fi chill beats",
  focus:     "ambient focus instrumental",
  melancholy:"sad indie acoustic",
  neutral:   ""
};

/**
 * Get the current vibe for a guild, using cache or detecting fresh.
 * @param {string} guildId
 * @param {string|null} textChannelId - Channel to read messages from
 * @param {import('discord.js').Client} client
 * @returns {Promise<string>} vibe string
 */
export async function getChannelVibe(guildId, textChannelId, client) {
  const cached = vibeCache.get(guildId);
  const now = Date.now();

  // Check manual override first
  if (cached?.override && cached.overrideExpiresAt > now) {
    return cached.override;
  }

  // Check fresh cache
  if (cached?.vibe && (now - cached.detectedAt) < VIBE_CACHE_TTL_MS) {
    return cached.vibe;
  }

  // Detect fresh
  let vibe = "neutral";
  if (textChannelId && client) {
    try {
      const channel = client.channels.cache.get(textChannelId);
      if (channel?.isTextBased?.()) {
        const msgs = await channel.messages.fetch({ limit: 30 });
        const texts = msgs.map(m => m.content).filter(s => s && s.length < 500);
        if (texts.length > 0) {
          vibe = await classifyVibe(texts);
        }
      }
    } catch (err) {
      logger.warn("[vibe] Detection failed:", err?.message ?? err);
    }
  }

  vibeCache.set(guildId, {
    vibe,
    detectedAt: now,
    override: cached?.override ?? null,
    overrideExpiresAt: cached?.overrideExpiresAt ?? 0
  });

  return vibe;
}

/**
 * Manually set vibe override for a guild (expires after 1 hour).
 */
export function setVibeOverride(guildId, vibe) {
  const existing = vibeCache.get(guildId) ?? {};
  vibeCache.set(guildId, {
    ...existing,
    override: VIBES.includes(vibe) ? vibe : "neutral",
    overrideExpiresAt: Date.now() + VIBE_OVERRIDE_TTL_MS
  });
}

/**
 * Clear vibe override for a guild.
 */
export function clearVibeOverride(guildId) {
  const existing = vibeCache.get(guildId) ?? {};
  vibeCache.set(guildId, { ...existing, override: null, overrideExpiresAt: 0 });
}

/**
 * Get current vibe info for a guild (for display).
 */
export function getVibeInfo(guildId) {
  const cached = vibeCache.get(guildId);
  if (!cached) return { vibe: "neutral", source: "default", detectedAt: null, override: null };

  const now = Date.now();
  const hasOverride = cached.override && cached.overrideExpiresAt > now;

  return {
    vibe: hasOverride ? cached.override : (cached.vibe ?? "neutral"),
    source: hasOverride ? "manual" : "detected",
    detectedAt: cached.detectedAt ? new Date(cached.detectedAt).toISOString() : null,
    override: hasOverride ? cached.override : null,
    overrideExpiresAt: hasOverride ? new Date(cached.overrideExpiresAt).toISOString() : null
  };
}

/**
 * Shape a search query with vibe genre hints.
 * @param {string} query - Original search query
 * @param {string} vibe - Current vibe
 * @returns {string} Potentially modified query
 */
export function shapeQueryForVibe(query, vibe) {
  // Only append hint if query doesn't already have genre words
  const hint = VIBE_GENRE_HINTS[vibe] ?? "";
  if (!hint) return query;

  // Don't modify URL queries
  if (/^https?:\/\//i.test(query)) return query;

  // If query is very specific (has quotes, artist - title format), don't modify
  if (query.includes('"') || / - /.test(query)) return query;

  return query; // Conservative: don't modify by default, return as-is
  // Future: could append hint for "autoplay" mode suggestions
}
