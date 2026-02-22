// src/utils/lastfm.js
// Last.fm REST API client — free, no credit card required.
// Get a free key at: https://www.last.fm/api/account/create
// Powers: similar tracks, artist bios, track metadata for smart queue + now-playing enrichment.

import { createClient } from "redis";
import { logger } from "./logger.js";

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";
const CACHE_PREFIX = "lastfm:";
const CACHE_TTL_SEC = 3600; // 1 hour

let redisClient = null;

async function getRedis() {
  if (redisClient?.isOpen) return redisClient;
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  redisClient = createClient({ url });
  redisClient.on("error", () => {});
  await redisClient.connect().catch(() => {});
  return redisClient;
}

async function cachedFetch(cacheKey, fetchFn) {
  // Try cache first
  try {
    const redis = await getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {}

  // Fetch fresh
  let result = null;
  try {
    result = await fetchFn();
  } catch (err) {
    logger.warn("[lastfm] Fetch failed:", err?.message ?? err);
    return null;
  }

  // Store in cache
  if (result !== null) {
    try {
      const redis = await getRedis();
      await redis.setEx(cacheKey, CACHE_TTL_SEC, JSON.stringify(result));
    } catch {}
  }

  return result;
}

async function lfmRequest(params) {
  const key = process.env.LASTFM_API_KEY;
  if (!key) return null;

  const url = new URL(LASTFM_BASE);
  url.searchParams.set("api_key", key);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10_000)
  });

  if (!res.ok) {
    logger.warn(`[lastfm] HTTP ${res.status}`);
    return null;
  }

  const json = await res.json();
  if (json?.error) {
    // Last.fm API error (e.g., track not found = error 6)
    return null;
  }

  return json;
}

/**
 * Get tracks similar to a given track.
 * @param {string} artist
 * @param {string} title
 * @param {number} [limit=5]
 * @returns {Promise<Array<{title:string, artist:string, url:string, match:number}>>}
 */
export async function getSimilarTracks(artist, title, limit = 5) {
  if (!artist || !title) return [];

  const ck = `${CACHE_PREFIX}similar:${artist}:${title}:${limit}`.toLowerCase().replace(/\s+/g, "_");
  const result = await cachedFetch(ck, () => lfmRequest({
    method: "track.getSimilar",
    artist,
    track: title,
    limit
  }));

  const tracks = result?.similartracks?.track ?? [];
  return (Array.isArray(tracks) ? tracks : [tracks]).slice(0, limit).map(t => ({
    title: t.name ?? "Unknown",
    artist: t.artist?.name ?? artist,
    url: t.url ?? null,
    match: parseFloat(t.match ?? "0")
  }));
}

/**
 * Get track info (duration, listeners, tags).
 * @param {string} artist
 * @param {string} title
 * @returns {Promise<{title, artist, album, duration, listeners, playcount, tags, url}|null>}
 */
export async function getTrackInfo(artist, title) {
  if (!artist || !title) return null;

  const ck = `${CACHE_PREFIX}track:${artist}:${title}`.toLowerCase().replace(/\s+/g, "_");
  return cachedFetch(ck, async () => {
    const json = await lfmRequest({ method: "track.getInfo", artist, track: title });
    if (!json?.track) return null;
    const t = json.track;
    return {
      title: t.name ?? title,
      artist: t.artist?.name ?? artist,
      album: t.album?.title ?? null,
      duration: t.duration ? Number(t.duration) * 1000 : null, // ms
      listeners: t.listeners ? Number(t.listeners) : null,
      playcount: t.playcount ? Number(t.playcount) : null,
      tags: (t.toptags?.tag ?? []).slice(0, 5).map(tag => tag.name),
      url: t.url ?? null
    };
  });
}

/**
 * Get artist biography and info.
 * @param {string} artist
 * @returns {Promise<{name, bio, listeners, tags, url}|null>}
 */
export async function getArtistBio(artist) {
  if (!artist) return null;

  const ck = `${CACHE_PREFIX}artist:${artist}`.toLowerCase().replace(/\s+/g, "_");
  return cachedFetch(ck, async () => {
    const json = await lfmRequest({ method: "artist.getInfo", artist });
    if (!json?.artist) return null;
    const a = json.artist;
    const bioFull = a.bio?.summary ?? null;
    const bioClean = bioFull ? bioFull.replace(/<a[^>]*>.*?<\/a>/gi, "").replace(/<[^>]+>/g, "").trim() : null;
    return {
      name: a.name ?? artist,
      bio: bioClean ? bioClean.slice(0, 500) : null,
      listeners: a.stats?.listeners ? Number(a.stats.listeners) : null,
      tags: (a.tags?.tag ?? []).slice(0, 5).map(t => t.name),
      url: a.url ?? null
    };
  });
}
