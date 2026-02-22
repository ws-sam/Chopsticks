// src/music/smartQueue.js
// Smart Queue — Last.fm powered "similar tracks" recommendations for autoplay mode.
// Powers: /music autoplay, "Similar Tracks" button, AI-picked next song.
// Gracefully disabled if LASTFM_API_KEY is not set.

import { getSimilarTracks } from "../utils/lastfm.js";
import { VIBE_GENRE_HINTS } from "./vibe.js";
import { logger } from "../utils/logger.js";

// Per-guild autoplay settings: guildId -> boolean
const autoplaySettings = new Map();

// Pending auto-suggestions: guildId -> { suggestion, expiresAt }
const pendingSuggestions = new Map();
const SUGGESTION_TTL_MS = 30 * 1000; // 30 seconds

export function setAutoplay(guildId, enabled) {
  autoplaySettings.set(guildId, Boolean(enabled));
}

export function isAutoplayEnabled(guildId) {
  return autoplaySettings.get(guildId) ?? false;
}

/**
 * Get similar tracks for a given track.
 * @param {object} track - { title, author }
 * @param {number} [limit=5]
 * @returns {Promise<Array<{title, artist, url, match}>>}
 */
export async function getRelatedTracks(track, limit = 5) {
  if (!track?.title) return [];
  try {
    const similar = await getSimilarTracks(
      track.author ?? "unknown",
      track.title,
      limit
    );
    return similar;
  } catch (err) {
    logger.warn("[smartQueue] getSimilarTracks failed:", err?.message ?? err);
    return [];
  }
}

/**
 * Build the "auto-next" song suggestion when queue empties.
 * Picks the best similar track that matches the current vibe.
 * @param {object} track - Current track { title, author }
 * @param {string} vibe - Current vibe
 * @returns {Promise<{title, artist, searchQuery}|null>}
 */
export async function buildAutoNextSuggestion(track, vibe) {
  if (!track?.title) return null;

  const similar = await getRelatedTracks(track, 10);
  if (!similar.length) return null;

  // Pick highest-match track (Last.fm returns them sorted by match already)
  const pick = similar[0];

  return {
    title: pick.title,
    artist: pick.artist,
    searchQuery: `${pick.artist} - ${pick.title}`,
    vibe
  };
}

/**
 * Store a pending auto-play suggestion for a guild.
 */
export function storePendingSuggestion(guildId, suggestion) {
  pendingSuggestions.set(guildId, {
    suggestion,
    expiresAt: Date.now() + SUGGESTION_TTL_MS
  });
}

/**
 * Get and consume the pending suggestion for a guild.
 */
export function consumePendingSuggestion(guildId) {
  const entry = pendingSuggestions.get(guildId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pendingSuggestions.delete(guildId);
    return null;
  }
  pendingSuggestions.delete(guildId);
  return entry.suggestion;
}

/**
 * Build a human-readable "Up next (AI pick)" description.
 */
export function formatSuggestionLabel(suggestion) {
  if (!suggestion) return null;
  return `🎵 **AI Pick:** ${suggestion.artist} — ${suggestion.title}`;
}
