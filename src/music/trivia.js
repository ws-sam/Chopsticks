// src/music/trivia.js
// AI Music Trivia — generates trivia questions about currently playing artists/songs.
// Triggered randomly during playback (15% chance on track start, or manually via /music trivia).
// First correct answer earns +75 XP via the existing levels system.

import { groqComplete } from "../utils/groq.js";
import { getArtistBio } from "../utils/lastfm.js";
import { logger } from "../utils/logger.js";

// Active trivia sessions: guildId -> { question, answer, endsAt, channelId, trackTitle }
const activeSessions = new Map();
const TRIVIA_WINDOW_MS = 30 * 1000; // 30 second answer window
const TRIVIA_XP_REWARD = 75;

/**
 * Generate a trivia question about an artist/song using Groq + Last.fm.
 * @param {string} artist
 * @param {string} title
 * @returns {Promise<{question: string, answer: string}|null>}
 */
export async function generateTrivia(artist, title) {
  if (!artist && !title) return null;

  // Try to get artist bio for more context
  let bioSnippet = "";
  if (artist) {
    try {
      const bio = await getArtistBio(artist);
      if (bio?.bio) bioSnippet = `Context: ${bio.bio.slice(0, 300)}`;
    } catch {}
  }

  const prompt = `Generate a fun, interesting trivia question about the music artist "${artist || "unknown"}" or the song "${title || "unknown"}".
${bioSnippet}

Rules:
- Question must be answerable with 1-3 words
- Must be factual and verifiable
- Not too obscure — something a casual music fan might know or find interesting
- Format EXACTLY as:
Q: [question]
A: [short answer]

Example:
Q: What city is Drake from?
A: Toronto`;

  const text = await groqComplete(prompt, { maxTokens: 80, temperature: 0.7 });
  if (!text) return null;

  const qMatch = text.match(/Q:\s*(.+)/i);
  const aMatch = text.match(/A:\s*(.+)/i);

  if (!qMatch || !aMatch) return null;

  return {
    question: qMatch[1].trim(),
    answer: aMatch[1].trim().toLowerCase()
  };
}

/**
 * Start a trivia session for a guild.
 * @param {string} guildId
 * @param {string} channelId
 * @param {object} track - { title, author }
 * @returns {Promise<{question:string}|null>}
 */
export async function startTriviaSession(guildId, channelId, track) {
  // Don't start if one is already active
  if (activeSessions.has(guildId)) return null;

  const trivia = await generateTrivia(track.author ?? "", track.title ?? "");
  if (!trivia) return null;

  activeSessions.set(guildId, {
    question: trivia.question,
    answer: trivia.answer,
    endsAt: Date.now() + TRIVIA_WINDOW_MS,
    channelId,
    trackTitle: track.title ?? "this song"
  });

  // Auto-expire
  setTimeout(() => {
    const session = activeSessions.get(guildId);
    if (session && Date.now() >= session.endsAt) {
      activeSessions.delete(guildId);
    }
  }, TRIVIA_WINDOW_MS + 1000);

  return { question: trivia.question };
}

/**
 * Check if a message is a correct trivia answer.
 * @param {string} guildId
 * @param {string} guess
 * @returns {boolean}
 */
export function checkTriviaAnswer(guildId, guess) {
  const session = activeSessions.get(guildId);
  if (!session) return false;
  if (Date.now() > session.endsAt) {
    activeSessions.delete(guildId);
    return false;
  }

  const normalized = guess.trim().toLowerCase();
  const correct = session.answer;

  // Exact match or close enough (contains the answer)
  return normalized === correct || normalized.includes(correct) || correct.includes(normalized);
}

/**
 * Consume the active trivia session (mark as answered).
 * @param {string} guildId
 * @returns {object|null} The session data if active
 */
export function consumeTriviaSession(guildId) {
  const session = activeSessions.get(guildId);
  if (!session) return null;
  activeSessions.delete(guildId);
  return session;
}

/**
 * Get active trivia session for a guild (for display).
 */
export function getActiveTriviaSession(guildId) {
  const session = activeSessions.get(guildId);
  if (!session) return null;
  if (Date.now() > session.endsAt) {
    activeSessions.delete(guildId);
    return null;
  }
  return session;
}

export { TRIVIA_XP_REWARD };
