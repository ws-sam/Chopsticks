// src/music/dj.js
// AI DJ Mode — generates personality-driven song announcements using Groq.
// Powers the "living bot" experience: DJ speaks between songs in character.
// Completely free via Groq API. Gracefully disabled if no Groq key.

import { groqChat } from "../utils/groq.js";
import { getPool } from "../utils/storage_pg.js";
import { logger } from "../utils/logger.js";

// ── Persona Templates ────────────────────────────────────────────────────────

export const DJ_PERSONAS = {
  hype: {
    name: "DJ Hype",
    description: "An over-the-top hypeman who makes everything sound like the most insane banger ever dropped",
    traits: "energetic, uses slang, yells in caps occasionally, uses fire emojis, calls everyone 'chat'",
    example: "YO CHAT we are NOT slowing down!! This absolute BANGER just dropped into the queue and I am LOSING MY MIND 🔥🔥"
  },
  smooth: {
    name: "DJ Smooth",
    description: "A late-night radio host with a silky voice, smooth transitions, and poetic commentary",
    traits: "calm, eloquent, uses music terminology, nostalgic, references feelings and atmosphere",
    example: "And now we drift into something a little different... let this one wash over you. Pure atmosphere."
  },
  chaotic: {
    name: "DJ Chaos",
    description: "An unhinged gremlin DJ who makes zero sense but somehow always vibes perfectly",
    traits: "random tangents, nonsensical energy, absurdist humor, still somehow hypes the song",
    example: "okay so i was eating cereal at 3am and suddenly this song appeared in my brain and now it's YOUR problem 💀"
  },
  chill: {
    name: "DJ Chill",
    description: "A lo-fi cafe DJ who keeps it mellow, introspective, and always matches the vibe",
    traits: "laid back, minimal energy, uses soft language, references late nights and rainy days",
    example: "this one's for the people up late. settle in."
  },
  roast: {
    name: "DJ Roast",
    description: "A playful DJ who gently roasts the song choices and the people who added them",
    traits: "sarcastic but loving, comments on song choices, self-aware, funny",
    example: "oh we're really playing this again? third time this week. y'all have a type and that type is questionable 💀"
  }
};

export const DEFAULT_PERSONA = "smooth";

// ── Guild DJ Settings ────────────────────────────────────────────────────────

const djSettingsCache = new Map(); // guildId -> { enabled, persona, updatedAt }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getGuildDJSettings(guildId) {
  const cached = djSettingsCache.get(guildId);
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) return cached;

  try {
    const pool = getPool();
    const res = await pool.query(
      `SELECT settings FROM guild_settings WHERE guild_id = $1`,
      [guildId]
    );
    const settings = res.rows[0]?.settings ?? {};
    const music = settings.music ?? {};
    const result = {
      enabled: Boolean(music.dj_enabled),
      persona: music.dj_persona ?? DEFAULT_PERSONA,
      customPersonaName: music.dj_custom_name ?? null,
      updatedAt: Date.now()
    };
    djSettingsCache.set(guildId, result);
    return result;
  } catch {
    return { enabled: false, persona: DEFAULT_PERSONA, customPersonaName: null, updatedAt: Date.now() };
  }
}

export async function setGuildDJSettings(guildId, { enabled, persona, customPersonaName } = {}) {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO guild_settings (guild_id, settings)
       VALUES ($1, jsonb_build_object('music', jsonb_build_object('dj_enabled', $2::boolean, 'dj_persona', $3, 'dj_custom_name', $4)))
       ON CONFLICT (guild_id) DO UPDATE
       SET settings = guild_settings.settings ||
         jsonb_build_object('music', COALESCE(guild_settings.settings->'music', '{}'::jsonb) ||
           jsonb_build_object('dj_enabled', $2::boolean, 'dj_persona', $3, 'dj_custom_name', $4))`,
      [guildId, Boolean(enabled), persona ?? DEFAULT_PERSONA, customPersonaName ?? null]
    );
    djSettingsCache.delete(guildId);
  } catch (err) {
    logger.warn("[dj] Failed to save DJ settings:", err?.message ?? err);
  }
}

export async function isDJEnabled(guildId) {
  const s = await getGuildDJSettings(guildId);
  return s.enabled;
}

export async function getGuildDJPersona(guildId) {
  const s = await getGuildDJSettings(guildId);
  return {
    key: s.persona,
    template: DJ_PERSONAS[s.persona] ?? DJ_PERSONAS[DEFAULT_PERSONA],
    customName: s.customPersonaName
  };
}

// ── Announcement Generation ──────────────────────────────────────────────────

const announcementCache = new Map(); // trackUri -> announcement (soft cache, evicted by size)
const MAX_CACHE = 200;

function cleanAnnouncementCache() {
  if (announcementCache.size > MAX_CACHE) {
    const oldest = [...announcementCache.keys()].slice(0, 50);
    for (const k of oldest) announcementCache.delete(k);
  }
}

/**
 * Generate an AI DJ announcement for a track.
 * @param {object} track - Serialized track { title, author, sourceName, uri }
 * @param {string} vibe - Current server vibe (energetic|chill|focus|hype|melancholy|neutral)
 * @param {object} persona - { key, template, customName }
 * @param {string} [apiKey] - Optional Groq API key override
 * @returns {Promise<string|null>} Announcement text, or null to skip
 */
export async function generateDJAnnouncement(track, vibe = "neutral", persona, apiKey) {
  if (!track?.title) return null;

  const p = persona?.template ?? DJ_PERSONAS[DEFAULT_PERSONA];
  const djName = persona?.customName ?? p.name;

  // Cache key: persona + vibe + track title (not URI — same song on different platforms)
  const cacheKey = `${persona?.key}:${vibe}:${track.title}`.toLowerCase().replace(/\s+/g, "_");
  if (announcementCache.has(cacheKey)) return announcementCache.get(cacheKey);

  const vibeMap = {
    energetic: "the server energy is HIGH right now",
    hype: "the server is absolutely hyped",
    chill: "the server has a chill, relaxed atmosphere",
    focus: "people are focused and working",
    melancholy: "the mood is a bit reflective and emotional",
    neutral: "the server is just vibing"
  };

  const vibeContext = vibeMap[vibe] ?? vibeMap.neutral;

  const prompt = `You are ${djName}, a Discord music bot DJ with this personality: ${p.description}.
Your traits: ${p.traits}.
Example of your style: "${p.example}"

A new song is starting. Make a short, in-character DJ announcement (1-2 sentences, max 120 characters).
Context: ${vibeContext}.
Song: "${track.title}"${track.author ? ` by ${track.author}` : ""}.

Rules:
- Stay fully in character
- Do NOT say "Now playing" or just repeat the song title flatly
- Do NOT use quotation marks around the song title
- Keep it under 120 characters
- Make it feel alive and natural

Announcement:`;

  const text = await groqChat(
    [{ role: "user", content: prompt }],
    { maxTokens: 80, temperature: 1.0, cache: true, apiKey }
  );

  if (text) {
    cleanAnnouncementCache();
    // Strip any "Announcement:" prefix the model might add
    const clean = text.replace(/^(announcement:|dj\s+\w+:|>)/i, "").trim();
    announcementCache.set(cacheKey, clean);
    return clean;
  }

  return null;
}

/**
 * Generate a test announcement using the guild's current DJ persona.
 */
export async function generateTestAnnouncement(guildId) {
  const persona = await getGuildDJPersona(guildId);
  const testTrack = { title: "a test song", author: "Test Artist" };
  return generateDJAnnouncement(testTrack, "energetic", persona);
}
