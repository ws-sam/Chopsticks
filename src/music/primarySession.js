// src/music/primarySession.js
// Primary bot music session — plays music using the main bot's own Lavalink connection.
// Used when no agents are deployed in a guild (1 VC at a time, no agent required).

import {
  createOrGetPlayer,
  searchOnPlayer,
  playFirst,
  skip as lavalinkSkip,
  pause as lavalinkPause,
  stop as lavalinkStop,
  destroy as lavalinkDestroy,
  getPlayerContext
} from "../lavalink/client.js";

// Primary sessions: guildId -> primarySession object
const primarySessions = new Map();

function serializeTrack(track) {
  if (!track) return null;
  const info = track.info ?? track ?? {};
  return {
    title: info.title ?? track.title ?? "Unknown title",
    uri: info.uri ?? track.uri ?? null,
    author: info.author ?? null,
    length: info.length ?? null,
    sourceName: info.sourceName ?? null
  };
}

function getQueueTracks(player) {
  const q = player?.queue;
  if (!q) return [];
  if (Array.isArray(q.tracks)) return q.tracks;
  if (Array.isArray(q)) return q;
  return [];
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function getPrimarySession(guildId) {
  return primarySessions.get(guildId) ?? null;
}

export function releasePrimarySession(guildId) {
  primarySessions.delete(guildId);
  lavalinkDestroy(guildId);
}

export function createPrimarySession(guildId, voiceChannelId, textChannelId, ownerUserId) {
  const existing = primarySessions.get(guildId);
  if (existing && existing.voiceChannelId === voiceChannelId) return existing;

  const session = {
    isPrimary: true,
    guildId,
    voiceChannelId,
    textChannelId,
    ownerUserId,
    lastActive: Date.now(),

    async handleRequest(op, payload) {
      this.lastActive = Date.now();
      const gId = this.guildId;
      const vcId = this.voiceChannelId;
      const tcId = payload.textChannelId ?? this.textChannelId;
      const ownerId = this.ownerUserId;
      const actorUserId = payload.actorUserId ?? ownerId;

      if (op === "play" || op === "search") {
        const ctx = await createOrGetPlayer({ guildId: gId, voiceChannelId: vcId, textChannelId: tcId, ownerId });
        const query = payload.query;
        const res = await searchOnPlayer(ctx, query, { id: actorUserId });
        const tracks = Array.isArray(res?.tracks) ? res.tracks : [];

        if (op === "search") {
          return { tracks: tracks.map(serializeTrack) };
        }

        if (!tracks.length) return { track: null, action: "none", mode: "open", ownerId };
        const track = tracks[0];
        const wasPlaying = Boolean(ctx.player.playing || ctx.player.queue?.current);
        await playFirst(ctx, track);
        return {
          track: serializeTrack(track),
          action: wasPlaying ? "queued" : "playing",
          mode: "open",
          ownerId
        };
      }

      const ctx = getPlayerContext(gId);
      if (!ctx) throw new Error("no-session");

      if (op === "status") {
        const current = ctx.player?.queue?.current ?? null;
        const tracks = getQueueTracks(ctx.player);
        return {
          playing: Boolean(ctx.player?.playing),
          paused: Boolean(ctx.player?.paused),
          mode: "open",
          ownerId: this.ownerUserId,
          current: serializeTrack(current),
          queueLength: tracks.length,
          volume: ctx.player?.volume ?? 100
        };
      }

      if (op === "queue") {
        const current = ctx.player?.queue?.current ?? null;
        const tracks = getQueueTracks(ctx.player);
        return {
          current: serializeTrack(current),
          tracks: tracks.map(serializeTrack),
          mode: "open",
          ownerId: this.ownerUserId
        };
      }

      if (op === "skip") {
        lavalinkSkip(ctx);
        return { ok: true, action: "skipped" };
      }

      if (op === "pause") {
        lavalinkPause(ctx, true);
        return { ok: true, paused: true };
      }

      if (op === "resume") {
        lavalinkPause(ctx, false);
        return { ok: true, paused: false };
      }

      if (op === "stop") {
        lavalinkStop(ctx);
        releasePrimarySession(gId);
        return { ok: true, action: "stopped" };
      }

      if (op === "volume") {
        const vol = Math.max(0, Math.min(150, Number(payload.volume ?? 100)));
        if (typeof ctx.player?.setVolume === "function") await ctx.player.setVolume(vol);
        return { ok: true, volume: vol };
      }

      if (op === "shuffle") {
        const q = ctx.player?.queue;
        const arr = Array.isArray(q?.tracks) ? q.tracks : null;
        if (arr) shuffleArray(arr);
        return { ok: true };
      }

      if (op === "clear") {
        const q = ctx.player?.queue;
        if (typeof q?.clear === "function") q.clear();
        else if (Array.isArray(q?.tracks)) q.tracks.length = 0;
        return { ok: true };
      }

      if (op === "remove") {
        const idx = Number(payload.index ?? -1);
        const arr = ctx.player?.queue?.tracks;
        if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) throw new Error("bad-index");
        arr.splice(idx, 1);
        return { ok: true };
      }

      if (op === "move") {
        const arr = ctx.player?.queue?.tracks;
        const from = Number(payload.from ?? -1);
        const to = Number(payload.to ?? -1);
        if (!Array.isArray(arr) || from < 0 || to < 0 || from >= arr.length || to >= arr.length) throw new Error("bad-index");
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
        return { ok: true };
      }

      if (op === "swap") {
        const arr = ctx.player?.queue?.tracks;
        const a = Number(payload.a ?? -1);
        const b = Number(payload.b ?? -1);
        if (!Array.isArray(arr) || a < 0 || b < 0 || a >= arr.length || b >= arr.length) throw new Error("bad-index");
        [arr[a], arr[b]] = [arr[b], arr[a]];
        return { ok: true };
      }

      // preset and setMode: graceful no-op for primary mode
      if (op === "preset" || op === "setMode") return { ok: true };

      throw new Error("unknown-op");
    }
  };

  primarySessions.set(guildId, session);
  return session;
}
