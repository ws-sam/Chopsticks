// src/agents/agentRunner.js
import "dotenv/config";
import { Client, GatewayIntentBits, Partials, Events, PermissionsBitField, EmbedBuilder } from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  EndBehaviorType,
  StreamType,
  NoSubscriberBehavior
} from "@discordjs/voice";
import { Readable } from "node:stream";
import * as prism from "prism-media";
import { request } from "undici";
import WebSocket from "ws";
import { createAgentLavalink } from "../lavalink/agentLavalink.js";
import { fetchAgentBots, fetchAgentToken, resetCorruptAgents, updateAgentBotStatus, upsertAgentRunner, deleteAgentRunner } from "../utils/storage.js";
import { randomUUID } from "node:crypto";
import { handleSafeError, handleCriticalError, handleVoiceError, ErrorCategory, ErrorSeverity } from "../utils/errorHandler.js";
import { logger } from "../utils/logger.js";
import { installProcessSafety } from "../utils/processSafety.js";

// Unique ID for this runner instance
const RUNNER_ID = process.env.RUNNER_ID || randomUUID();
const CONTROL_URL = process.env.AGENT_CONTROL_URL || "ws://127.0.0.1:8787"; // Agent-specific WS URL for AgentManager
const MUSIC_CONTROL_LOCKED = String(process.env.MUSIC_CONTROL_LOCKED ?? "true") === "true";
const RUNNER_SECRET = String(process.env.AGENT_RUNNER_SECRET || "").trim();

// Protocol version - increment when making breaking changes
const PROTOCOL_VERSION = "1.0.0";

// Polling interval for DB changes
const POLL_INTERVAL_MS = Number(process.env.AGENT_RUNNER_POLL_INTERVAL_MS) || 10_000;

// Map to keep track of active agent instances managed by this runner
const activeAgents = new Map(); // agentId -> { client, stopFn, agentConfig }

installProcessSafety("chopsticks-agent-runner", logger);

function normalizeControlMode(value) {
  const v = String(value ?? "").toLowerCase();
  return v === "voice" ? "voice" : "owner";
}

function normalizeProviders(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  return raw.split(",").map(v => v.trim()).filter(Boolean);
}

function requireOwnerControl(ctx, controlMode) {
  const mode = normalizeControlMode(
    controlMode ?? ctx?.controlMode ?? (MUSIC_CONTROL_LOCKED ? "owner" : "voice")
  );
  return mode === "owner" || ctx?.mode === "dj";
}

function safeJsonParse(input) {
  try {
    return JSON.parse(String(input));
  } catch {
    return null;
  }
}

function isValidHttpUrl(string) {
  let url;
  try {
    url = new URL(string);
  } catch (_) {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

function getHumanCount(channel) {
  if (!channel?.members) return 0;
  let count = 0;
  for (const member of channel.members.values()) {
    if (!member?.user?.bot) count++;
  }
  return count;
}

function serializeTrack(track) {
  if (!track) return null;
  const info = track.info ?? {};
  return {
    title: info.title ?? "Unknown title",
    uri: info.uri ?? null,
    author: info.author ?? null,
    length: info.length ?? null,
    sourceName: info.sourceName ?? null
  };
}

function getQueueTracks(queue) {
  if (!queue) return [];
  if (Array.isArray(queue.tracks)) return queue.tracks;
  if (Array.isArray(queue)) return queue;
  if (Array.isArray(queue.items)) return queue.items;
  return [];
}


// The startAgent function (now receives agentConfig directly from DB)
async function startAgent(agentConfig) {
  const { agent_id: agentId, token, client_id: clientId, tag } = agentConfig;
  const poolId = String(agentConfig.pool_id ?? agentConfig.poolId ?? "default").trim() || "default";

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    partials: [Partials.Channel]
  });

  let lavalink = null;

  let ws = null; // Agent's own WebSocket to AgentManager
  let wsReady = false;
  let wsHeartbeat = null;

  // assistant session state
  let assistantState = {
    guildId: null,
    voiceChannelId: null,
    textChannelId: null,
    connection: null,
    player: null,
    busy: false,
    lastActive: null,
    auto: false,
    loopRunning: false,
    config: null,
    cooldowns: new Map(),
    rotationState: new Map(),
    ownerUserId: null,
    sessionSettings: new Map()
  };

  function sendWs(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      // Inject agentId into outgoing messages
      const out = { ...payload, agentId, runnerId: RUNNER_ID };
      // DEBUG: log outgoing WS frames for troubleshooting handshake
      try { logger.debug("[agent-runner] OUTGOING_WS", JSON.stringify(out)); } catch {}
      ws.send(JSON.stringify(out));
      return true;
    } catch {
      return false;
    }
  }

  function sendHello() {
    sendWs({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      agentId,
      botUserId: client.user?.id ?? null,
      tag: client.user?.tag ?? null,
      ready: Boolean(lavalink),
      guildIds: Array.from(client.guilds.cache.keys()),
      poolId,
      runnerSecret: RUNNER_SECRET || undefined
    });
  }

  function sendGuilds() {
    sendWs({
      type: "guilds",
      guildIds: Array.from(client.guilds.cache.keys())
    });
  }

  function sendRelease(guildId, voiceChannelId, reason) {
    sendWs({
      type: "event",
      event: "released",
      agentId,
      guildId,
      voiceChannelId,
      reason: reason ?? "unknown",
      kind: "music"
    });
  }

  function sendAssistantRelease(guildId, voiceChannelId, reason) {
    sendWs({
      type: "event",
      event: "released",
      agentId,
      guildId,
      voiceChannelId,
      reason: reason ?? "unknown",
      kind: "assistant"
    });
  }

  function connectAgentControl() { // Each agent has its own WS connection to AgentManager
    if (ws && ws.readyState === WebSocket.OPEN) return;

    ws = new WebSocket(CONTROL_URL);
    wsReady = false;

    ws.on("open", () => {
      wsReady = true;
      logger.info(`[agent:${agentId}] Connected to control plane at ${CONTROL_URL}`);
      sendHello();
      sendGuilds();

      if (wsHeartbeat) clearInterval(wsHeartbeat);
      wsHeartbeat = setInterval(() => {
        sendGuilds();
        sendHello();
      }, 30_000);
      wsHeartbeat.unref?.();
    });

    ws.on("message", data => {
      void (async () => {
        const msg = safeJsonParse(data);
        if (!msg || msg.type !== "req") return;

        const { id, op, data: payload } = msg;
        if (!id || !op) return;

        try {
          // Agent-specific requests handle here
          const result = await handleAgentRequest(op, payload);
          sendWs({ type: "resp", id, ok: true, data: result ?? null });
        } catch (err) {
          sendWs({
            type: "resp",
            id,
            ok: false,
            error: String(err?.message ?? err)
          });
        }
      })().catch(err => {
        logger.error({ err }, `[agent:${agentId}] ws message fatal`);
      });
    });

    ws.on("close", () => {
      wsReady = false;
      if (wsHeartbeat) {
        clearInterval(wsHeartbeat);
        wsHeartbeat = null;
      }
      logger.info(`[agent:${agentId}] WS connection closed. Reconnecting...`);
      setTimeout(connectAgentControl, 2000);
    });

    ws.on("error", (err) => {
      logger.error({ err }, `[agent:${agentId}] WS connection error`);
    });
  }

  async function ensureLavalink() {
    if (lavalink) return lavalink;
    try {
      lavalink = createAgentLavalink(client);
      await lavalink.start();

      // AI DJ hook — fire-and-forget on every track start
      try {
        lavalink.manager?.on?.("trackStart", (player, track) => {
          const guildId = player?.guildId;
          if (!guildId) return;
          fireDJAnnouncement(guildId, player, track).catch(() => {});
          fireMusicTrivia(guildId, player, track).catch(() => {});
        });
      } catch {}

      return lavalink;
    } catch (err) {
      lavalink = null;
      throw err;
    }
  }

  async function fireDJAnnouncement(guildId, player, track) {
    try {
      const { isDJEnabled, getGuildDJPersona, generateDJAnnouncement } = await import("../music/dj.js");
      if (!await isDJEnabled(guildId)) return;

      const { classifyVibe } = await import("../utils/huggingface.js");
      const textChannelId = player?.textChannelId ?? null;
      const channel = textChannelId ? client.channels.cache.get(textChannelId) : null;

      // Detect server vibe from recent messages
      let vibe = "neutral";
      if (channel?.isTextBased?.()) {
        try {
          const msgs = await channel.messages.fetch({ limit: 30 });
          const texts = msgs.map(m => m.content).filter(Boolean);
          vibe = await classifyVibe(texts);
        } catch {}
      }

      const persona = await getGuildDJPersona(guildId);
      const serialized = track?.info
        ? { title: track.info.title, author: track.info.author, uri: track.info.uri }
        : null;

      const announcement = await generateDJAnnouncement(serialized, vibe, persona);
      if (!announcement) return;

      if (channel?.isTextBased?.() && typeof channel.send === "function") {
        await channel.send({ content: `🎙️ ${announcement}` }).catch(() => {});
      }
    } catch {}
  }

  async function fireMusicTrivia(guildId, player, track) {
    // 15% chance to trigger trivia on track start
    if (Math.random() > 0.15) return;
    try {
      const { startTriviaSession } = await import("../music/trivia.js");
      const textChannelId = player?.textChannelId ?? null;
      if (!textChannelId) return;

      const channel = client.channels.cache.get(textChannelId);
      if (!channel?.isTextBased?.()) return;

      const serialized = track?.info
        ? { title: track.info.title, author: track.info.author }
        : null;
      if (!serialized?.title) return;

      const session = await startTriviaSession(guildId, textChannelId, serialized);
      if (!session) return;

      await channel.send({
        content: `🎵 **Music Trivia!** First to answer correctly gets **+75 XP** ⏱️ 30 seconds\n\n❓ ${session.question}`
      }).catch(() => {});
    } catch {}
  }

  // ... (unchanged helper functions for handleAgentRequest below this line)

  async function fetchMember(guildId, userId) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return null;
    const cached = guild.members.cache.get(userId);
    if (cached) return cached;
    return guild.members.fetch(userId).catch(() => null);
  }

  async function assertActorInVoice(guildId, voiceChannelId, actorUserId) {
    if (!actorUserId) throw new Error("missing-actor");
    const m = await fetchMember(guildId, actorUserId);
    if (!m) throw new Error("not-in-guild");
    const chId = m.voice?.channelId ?? null;
    if (chId !== voiceChannelId) throw new Error("not-in-voice");
    return m;
  }

  async function assertActorInGuild(guildId, actorUserId) {
    if (!actorUserId) throw new Error("missing-actor");
    const m = await fetchMember(guildId, actorUserId);
    if (!m) throw new Error("not-in-guild");
    return m;
  }

  function isAdmin(member) {
    const perms = member?.permissions;
    if (!perms) return false;
    return (
      perms.has(PermissionsBitField.Flags.Administrator) ||
      perms.has(PermissionsBitField.Flags.ManageGuild) ||
      perms.has(PermissionsBitField.Flags.ManageChannels)
    );
  }

  function scheduleRelease(guildId, voiceChannelId, reason, disconnectInMs) {
    const ms = Number(disconnectInMs);
    if (!Number.isFinite(ms) || ms <= 0) return;

    setTimeout(() => {
      try {
        sendRelease(guildId, voiceChannelId, reason);
      } catch (err) {
        handleSafeError(err, {
          operation: 'delayed_voice_release',
          category: ErrorCategory.VOICE,
          guildId
        });
      }
    }, ms + 150);
  }

  function isAdminOverride(payload) {
    const token = String(process.env.DASHBOARD_ADMIN_TOKEN || "").trim();
    if (!token) return false;
    return String(payload?.adminToken || "") === token;
  }

  function getVoiceGuild(guildId) {
    return client.guilds.cache.get(guildId) ?? null;
  }

  function getVoiceChannel(guildId, voiceChannelId) {
    const guild = getVoiceGuild(guildId);
    if (!guild) return null;
    return guild.channels.cache.get(voiceChannelId) ?? null;
  }

  async function ensureAssistantConnection(guildId, voiceChannelId) {
    const guild = getVoiceGuild(guildId);
    if (!guild) throw new Error("not-in-guild");

    const channel = getVoiceChannel(guildId, voiceChannelId);
    if (!channel) throw new Error("voice-channel-missing");

    if (
      assistantState.connection &&
      assistantState.guildId === guildId &&
      assistantState.voiceChannelId === voiceChannelId
    ) {
      return assistantState.connection;
    }

    await stopAssistant("switch");

    const connection = joinVoiceChannel({
      channelId: voiceChannelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 10_000).catch(() => {
      throw new Error("voice-not-ready");
    });

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    connection.subscribe(player);

    assistantState = {
      guildId,
      voiceChannelId: voiceChannelId,
      textChannelId: assistantState.textChannelId ?? null,
      connection,
      player,
      busy: false,
      lastActive: Date.now(),
      auto: assistantState.auto ?? false,
      loopRunning: assistantState.loopRunning ?? false,
      config: null,
      cooldowns: new Map(),
      rotationState: new Map(),
      ownerUserId: null,
      sessionSettings: new Map()
    };

    return connection;
  }

  async function stopAssistant(reason = "stop") {
    const { connection, guildId, voiceChannelId, player } = assistantState;
    if (player) {
      try {
        player.stop();
      } catch (err) {
        handleVoiceError(err, {
          operation: 'assistant_player_stop',
          guildId
        });
      }
    }
    if (connection) {
      try {
        connection.destroy();
      } catch (err) {
        handleVoiceError(err, {
          operation: 'assistant_connection_destroy',
          guildId
        });
      }
    }
    if (guildId && voiceChannelId) {
      sendAssistantRelease(guildId, voiceChannelId, reason);
    }
    assistantState = {
      guildId: null,
      voiceChannelId: null,
      textChannelId: null,
      connection: null,
      player: null,
      busy: false,
      lastActive: Date.now(),
      auto: false,
      loopRunning: false,
      config: null,
      cooldowns: new Map(),
      rotationState: new Map(),
      ownerUserId: null,
      sessionSettings: new Map()
    };
  }

  function parseWavToPcm(buffer) {
    if (!buffer || buffer.length < 44) return null;
    if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
    if (buffer.toString("ascii", 8, 12) !== "WAVE") return null;
    let offset = 12;
    let fmt = null;
    let dataOffset = null;
    let dataSize = null;
    while (offset + 8 <= buffer.length) {
      const id = buffer.toString("ascii", offset, offset + 4);
      const size = buffer.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (id === "fmt ") {
        const audioFormat = buffer.readUInt16LE(start);
        const channels = buffer.readUInt16LE(start + 2);
        const sampleRate = buffer.readUInt32LE(start + 4);
        const bitsPerSample = buffer.readUInt16LE(start + 14);
        fmt = { audioFormat, channels, sampleRate, bitsPerSample };
      } else if (id === "data") {
        dataOffset = start;
        dataSize = size;
      }
      offset = start + size + (size % 2);
    }
    if (!fmt || !dataOffset || !dataSize) return null;
    if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) return null;
    const pcm = buffer.slice(dataOffset, dataOffset + dataSize);
    return { pcm, format: fmt };
  }

  function upmixMonoToStereo(pcm) {
    const samples = pcm.length / 2;
    const out = Buffer.alloc(samples * 4);
    for (let i = 0; i < samples; i++) {
      const val = pcm.readInt16LE(i * 2);
      out.writeInt16LE(val, i * 4);
      out.writeInt16LE(val, i * 4 + 2);
    }
    return out;
  }

  function applyVolumePcm(pcm, volumePct) {
    const v = Number(volumePct);
    if (!Number.isFinite(v)) return pcm;
    const gain = Math.max(0, Math.min(2, v / 100)); // 0..2
    if (gain === 1) return pcm;

    const out = Buffer.from(pcm);
    for (let i = 0; i + 1 < out.length; i += 2) {
      let s = out.readInt16LE(i);
      s = Math.trunc(s * gain);
      if (s > 32767) s = 32767;
      if (s < -32768) s = -32768;
      out.writeInt16LE(s, i);
    }
    return out;
  }

  async function playPcm(connection, player, pcmBuffer) {
    if (!connection || !player) throw new Error("assistant-not-ready");
    const resource = createAudioResource(Readable.from(pcmBuffer), { inputType: StreamType.Raw });
    player.play(resource);
    await entersState(player, AudioPlayerStatus.Playing, 5_000).catch(() => {});
    await entersState(player, AudioPlayerStatus.Idle, 60_000).catch(() => {});
  }

  async function recordUserAudio(connection, userId, maxMs, silenceMs) {
    const receiver = connection.receiver;
    if (!receiver) throw new Error("assistant-not-ready");

    return new Promise((resolve, reject) => {
      let ended = false;
      const chunks = [];
      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: silenceMs }
      });

      const decoder = new prism.opus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960
      });

      const onError = err => {
        if (ended) return;
        ended = true;
        reject(err);
      };

      const onEnd = () => {
        if (ended) return;
        ended = true;
        resolve(Buffer.concat(chunks));
      };

      const timeout = setTimeout(() => {
        if (ended) return;
        ended = true;
        try {
          opusStream.destroy();
        } catch (err) {
          handleVoiceError(err, {
            operation: 'opus_stream_destroy_timeout',
            severity: ErrorSeverity.LOW
          });
        }
        resolve(Buffer.concat(chunks));
      }, maxMs);

      opusStream.pipe(decoder);
      decoder.on("data", d => chunks.push(d));
      decoder.on("end", () => {
        clearTimeout(timeout);
        onEnd();
      });
      decoder.on("error", err => {
        clearTimeout(timeout);
        onError(err);
      });
      opusStream.on("error", err => {
        clearTimeout(timeout);
        onError(err);
      });
    });
  }

  async function callStt(wavBuffer) {
    const url = String(process.env.VOICE_ASSIST_STT_URL || "").trim();
    if (!url) throw new Error("stt-not-configured");
    if (!isValidHttpUrl(url)) throw new Error("stt-url-invalid");
    const auth = String(process.env.VOICE_ASSIST_STT_AUTH || "").trim();
    const res = await request(url, {
      method: "POST",
      headers: {
        "Content-Type": "audio/wav",
        ...(auth ? { Authorization: auth } : {})
      },
      body: wavBuffer
    });
    if (res.statusCode >= 400) throw new Error("stt-failed");
    const data = await res.body.json().catch(() => null);
    const text = String(data?.text ?? data?.transcript ?? "").trim();
    if (!text) throw new Error("stt-empty");
    return text;
  }

  async function callLlm(prompt, meta = {}) {
    const url = String(process.env.VOICE_ASSIST_LLM_URL || "").trim();
    if (!url) throw new Error("llm-not-configured");
    if (!isValidHttpUrl(url)) throw new Error("llm-url-invalid");
    const auth = String(process.env.VOICE_ASSIST_LLM_AUTH || "").trim();

    const body = JSON.stringify({
      prompt,
      meta
    });

    const res = await request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: auth } : {})
      },
      body
    });
    if (res.statusCode >= 400) throw new Error("llm-failed");
    const data = await res.body.json().catch(() => null);
    const text = String(data?.text ?? data?.output ?? data?.response ?? "").trim();
    if (!text) throw new Error("llm-empty");
    return text;
  }

  async function callTts(text, voice, speed, pitch) {
    const url = String(process.env.VOICE_ASSIST_TTS_URL || "").trim();
    if (!url) throw new Error("tts-not-configured");
    if (!isValidHttpUrl(url)) throw new Error("tts-url-invalid");
    const auth = String(process.env.VOICE_ASSIST_TTS_AUTH || "").trim();

    const res = await request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: auth } : {})
      },
      body: JSON.stringify({
        text,
        voice: voice ?? null,
        speed: Number.isFinite(Number(speed)) ? Number(speed) : undefined,
        pitch: Number.isFinite(Number(pitch)) ? Number(pitch) : undefined
      })
    });
    if (res.statusCode >= 400) throw new Error("tts-failed");
    const buf = Buffer.from(await res.body.arrayBuffer());
    return buf;
  }

  function getSessionSettings(voiceChannelId) {
    const key = String(voiceChannelId || "");
    const cur = assistantState.sessionSettings.get(key) || {};
    return {
      volume: Number.isFinite(Number(cur.volume)) ? Number(cur.volume) : 100,
      speed: Number.isFinite(Number(cur.speed)) ? Number(cur.speed) : 1.0,
      pitch: Number.isFinite(Number(cur.pitch)) ? Number(cur.pitch) : 1.0
    };
  }

  function setSessionSettings(voiceChannelId, next) {
    const key = String(voiceChannelId || "");
    const cur = assistantState.sessionSettings.get(key) || {};
    const merged = { ...cur, ...next };
    assistantState.sessionSettings.set(key, merged);
    return merged;
  }

  async function runAssistantPipeline({ guildId, voiceChannelId, actorUserId, durationMs, silenceMs, voice, system }) {
    await ensureAssistantConnection(guildId, voiceChannelId);

    if (assistantState.busy) throw new Error("assistant-busy");
    assistantState.busy = true;
    try {
      const connection = assistantState.connection;
      if (!connection) throw new Error("assistant-not-ready");

      const pcm = await recordUserAudio(connection, actorUserId, durationMs, silenceMs);
      if (!pcm || pcm.length < 2000) throw new Error("no-audio");

      // wrap pcm into wav-like? your STT expects wav. you already had wav helper earlier; keep minimal:
      // For now, assume STT endpoint accepts raw wav is required; you can replace with your existing pcmToWav if needed.
      // If you already have pcmToWav elsewhere in this file, use it. (Not included here to keep strict.)
      // Quick wav builder:
      const wav = pcmToWav(pcm, 48000, 2);

      const text = await callStt(wav);
      const reply = await callLlm(text, { guildId, voiceChannelId, actorUserId, system: system ?? null });

      const settings = getSessionSettings(voiceChannelId);
      const ttsAudio = await callTts(reply, voice ?? null, settings.speed, settings.pitch);
      const parsed = parseWavToPcm(ttsAudio);
      if (!parsed) throw new Error("tts-bad-format");
      let pcmOut = parsed.pcm;
      if (parsed.format.channels === 1) pcmOut = upmixMonoToStereo(pcmOut);
      if (parsed.format.sampleRate !== 48000) throw new Error("tts-bad-format");
      const pcmAdj = applyVolumePcm(pcmOut, settings.volume);

      await playPcm(connection, assistantState.player, pcmAdj);

      return { ok: true, heard: text, reply };
    } finally {
      assistantState.busy = false;
      assistantState.lastActive = Date.now();
    }
  }

  // minimal wav builder used above
  function pcmToWav(pcmBuffer, sampleRate = 48000, channels = 2) {
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmBuffer.length;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);
    pcmBuffer.copy(buffer, 44);
    return buffer;
  }

  async function assistantAutoLoop() {
    if (assistantState.loopRunning) return;
    assistantState.loopRunning = true;
    try {
      while (assistantState.auto) {
        await new Promise(r => setTimeout(r, 750));
      }
    } finally {
      assistantState.loopRunning = false;
    }
  }

  async function stopIfEmpty(channel) {
    if (!channel || !lavalink) return;
    const humanCount = getHumanCount(channel);
    if (humanCount > 0) return;

    const ctx = lavalink.getSession(channel.guild.id, channel.id);
    if (!ctx) return;

    try {
      await lavalink.destroySession(channel.guild.id, channel.id);
      try {
        if (typeof ctx.player?.destroy === "function") ctx.player.destroy();
      } catch (err) {
        handleVoiceError(err, {
          operation: 'empty_channel_player_destroy',
          guildId: channel.guild.id
        });
      }
    } catch (err) {
      handleCriticalError(err, {
        operation: 'empty_channel_lavalink_destroy',
        category: ErrorCategory.MUSIC,
        guildId: channel.guild.id
      });
    }

    sendRelease(channel.guild.id, channel.id, "empty-channel");
  }

  async function handleAgentMoved(oldState, newState) {
    if (!lavalink) return;

    const selfId = client.user?.id;
    if (!selfId) return;
    if (newState.id !== selfId && oldState.id !== selfId) return;

    const guildId = (newState.guild ?? oldState.guild)?.id;
    if (!guildId) return;

    const ctx = lavalink.getAnySessionInGuildForAgent(guildId);
    if (!ctx) return;

    const expectedVc = ctx.voiceChannelId;
    const actualVc = newState.channel?.id ?? null;

    if (actualVc !== expectedVc) {
      try {
        await lavalink.destroySession(ctx.guildId, ctx.voiceChannelId);
        try {
          if (typeof ctx.player?.destroy === "function") ctx.player.destroy();
        } catch (err) {
          handleVoiceError(err, {
            operation: 'agent_moved_player_destroy',
            guildId: ctx.guildId
          });
        }
      } catch (err) {
        handleCriticalError(err, {
          operation: 'agent_moved_lavalink_destroy',
          category: ErrorCategory.MUSIC,
          guildId: ctx.guildId
        });
      }

      sendRelease(ctx.guildId, ctx.voiceChannelId, actualVc ? "agent-moved" : "agent-disconnected");
    }
  }

  async function handleAssistantMoved(oldState, newState) {
    const selfId = client.user?.id;
    if (!selfId) return;
    if (newState.id !== selfId && oldState.id !== selfId) return;

    if (!assistantState.connection || !assistantState.guildId) return;
    const expectedVc = assistantState.voiceChannelId;
    const actualVc = newState.channel?.id ?? null;
    if (actualVc !== expectedVc) {
      await stopAssistant(actualVc ? "agent-moved" : "agent-disconnected");
    }
  }

  async function handleAgentRequest(op, payload = {}) { // This is for requests that come from AgentManager via agent's WS
    // No longer handling scale, start_agent, stop_agent here. These are handled by pollForAgentChanges.

    const guildId = payload.guildId;
    const voiceChannelId = payload.voiceChannelId ?? null;
    const textChannelId = payload.textChannelId ?? null;
    const actorUserId = payload.actorUserId ?? payload.ownerUserId ?? payload.adminUserId ?? null;

    const adminOverride = isAdminOverride(payload);

    // Text-only ops do not require a voiceChannelId.
    if (op === "discordSend") {
      if (!guildId) throw new Error("missing-guild");
      if (!textChannelId) throw new Error("missing-channel");
      if (!adminOverride) await assertActorInGuild(guildId, actorUserId);

      const channel = await client.channels.fetch(textChannelId).catch(() => null);
      if (!channel?.isTextBased?.()) throw new Error("channel-not-text");

      const content = String(payload.content || "").slice(0, 1900).trim();
      const embedsIn = Array.isArray(payload.embeds) ? payload.embeds : [];
      const embeds = embedsIn.slice(0, 10).map(e => {
        try { return EmbedBuilder.from(e); } catch { return null; }
      }).filter(Boolean);

      await channel.send({
        content: content || undefined,
        embeds: embeds.length ? embeds : undefined,
        allowedMentions: { parse: [] }
      });

      return { ok: true };
    }

    if (!guildId || !voiceChannelId) throw new Error("missing-session");

    const actorMember = adminOverride ? null : await assertActorInVoice(guildId, voiceChannelId, actorUserId);

    if (op === "assistantJoin") {
      await ensureAssistantConnection(guildId, voiceChannelId);
      if (!assistantState.ownerUserId) assistantState.ownerUserId = actorUserId;
      assistantState.textChannelId = textChannelId ?? assistantState.textChannelId;
      assistantState.lastActive = Date.now();
      return { ok: true, action: "joined", guildId, voiceChannelId };
    }

    if (op === "assistantStart") {
      await ensureAssistantConnection(guildId, voiceChannelId);
      if (!assistantState.ownerUserId) assistantState.ownerUserId = actorUserId;
      assistantState.textChannelId = textChannelId ?? assistantState.textChannelId;
      assistantState.config = payload.config ?? assistantState.config ?? {};
      assistantState.auto = true;
      assistantState.lastActive = Date.now();
      void assistantAutoLoop();
      return { ok: true, action: "started" };
    }

    if (op === "assistantStop") {
      assistantState.auto = false;
      assistantState.lastActive = Date.now();
      return { ok: true, action: "stopped" };
    }

    if (op === "assistantLeave") {
      await stopAssistant("leave");
      return { ok: true, action: "left" };
    }

    if (op === "assistantStatus") {
      return {
        ok: true,
        active: Boolean(assistantState.connection),
        busy: Boolean(assistantState.busy),
        auto: Boolean(assistantState.auto),
        guildId: assistantState.guildId,
        voiceChannelId: assistantState.voiceChannelId,
        lastActive: assistantState.lastActive
      };
    }

    if (op === "assistantListen") {
      const durationMs = Math.max(2_000, Math.min(30_000, Math.trunc(Number(payload.durationMs) || 10_000)));
      const silenceMs = Math.max(500, Math.min(5_000, Math.trunc(Number(payload.silenceMs) || 1_200)));
      if (!assistantState.ownerUserId) assistantState.ownerUserId = actorUserId;
      const res = await runAssistantPipeline({
        guildId,
        voiceChannelId,
        actorUserId,
        durationMs,
        silenceMs,
        voice: payload?.voice ?? null,
        system: payload?.system ?? null
      });
      return res;
    }

    if (op === "assistantSay") {
      if (assistantState.busy) throw new Error("assistant-busy");
      const text = String(payload.text || "").trim();
      if (!text) throw new Error("assistant-empty");
      if (!assistantState.ownerUserId) assistantState.ownerUserId = actorUserId;
      const connection = await ensureAssistantConnection(guildId, voiceChannelId);
      assistantState.busy = true;
      try {
        const settings = getSessionSettings(voiceChannelId);
        const ttsAudio = await callTts(text, payload?.voice ?? null, settings.speed, settings.pitch);
        const parsed = parseWavToPcm(ttsAudio);
        if (!parsed) throw new Error("tts-bad-format");
        let pcmOut = parsed.pcm;
        if (parsed.format.channels === 1) pcmOut = upmixMonoToStereo(pcmOut);
        if (parsed.format.sampleRate !== 48000) throw new Error("tts-bad-format");
        const pcmAdj = applyVolumePcm(pcmOut, settings.volume);
        await playPcm(connection, assistantState.player, pcmAdj);
        return { ok: true, action: "spoken" };
      } finally {
        assistantState.busy = false;
      }
    }

    if (op === "assistantSettings") {
      if (!assistantState.ownerUserId) assistantState.ownerUserId = actorUserId;
      if (!adminOverride && assistantState.ownerUserId !== actorUserId) throw new Error("assistant-not-owner");
      const next = setSessionSettings(voiceChannelId, payload || {});
      return { ok: true, settings: next };
    }

    if (op === "assistantSettingsGet") {
      const settings = getSessionSettings(voiceChannelId);
      return { ok: true, settings };
    }

    const mgr = await ensureLavalink();

    if (op === "search") {
      const defaultMode = String(payload.defaultMode ?? "open").toLowerCase() === "dj" ? "dj" : "open";
      const defaultVolume = payload.defaultVolume;
      const limits = payload.limits ?? null;
      const controlMode = payload.controlMode ?? null;
      const searchProviders = payload.searchProviders ?? null;
      const fallbackProviders = payload.fallbackProviders ?? null;
      const stopGraceMs = payload.stopGraceMs ?? null;

      const ctx = await mgr.createOrGetSession({
        guildId,
        voiceChannelId,
        textChannelId,
        ownerId: actorUserId,
        defaultMode,
        defaultVolume,
        limits,
        controlMode,
        searchProviders,
        fallbackProviders,
        stopGraceMs
      });

      const query = payload.query;
      const requester = payload.requester ?? null;
      const res = await mgr.search(ctx, query, requester);
      const tracks = Array.isArray(res?.tracks) ? res.tracks.map(serializeTrack) : [];
      return { tracks };
    }

    if (op === "play") {
      const defaultMode = String(payload.defaultMode ?? "open").toLowerCase() === "dj" ? "dj" : "open";
      const defaultVolume = payload.defaultVolume;
      const limits = payload.limits ?? null;
      const controlMode = payload.controlMode ?? null;
      const searchProviders = payload.searchProviders ?? null;
      const fallbackProviders = payload.fallbackProviders ?? null;
      const stopGraceMs = payload.stopGraceMs ?? null;

      const ctx = await mgr.createOrGetSession({
        guildId,
        voiceChannelId,
        textChannelId,
        ownerId: actorUserId,
        defaultMode,
        defaultVolume,
        limits,
        controlMode,
        searchProviders,
        fallbackProviders,
        stopGraceMs
      });

      const query = payload.query;
      const requester = payload.requester ?? null;

      logger.debug(`[agent:play] Searching for: ${query}`);
      const res = await mgr.search(ctx, query, requester);
      if (!res?.tracks?.length) {
        logger.debug(`[agent:play] No tracks found for: ${query}`);
        return { track: null, action: "none", mode: ctx.mode };
      }

      const track = res.tracks[0];
      logger.debug(`[agent:play] Found track: ${track.info?.title || track.title}, calling enqueueAndPlay`);
      const playRes = await mgr.enqueueAndPlay(ctx, track);
      logger.debug(`[agent:play] enqueueAndPlay result:`, playRes);

      return {
        track: serializeTrack(track),
        action: playRes?.action ?? "queued",
        mode: ctx.mode,
        ownerId: ctx.ownerId ?? null
      };
    }

    const ctx = mgr.getSession(guildId, voiceChannelId);
    if (!ctx) throw new Error("no-session");

    if (payload?.controlMode) ctx.controlMode = normalizeControlMode(payload.controlMode);
    if (payload?.searchProviders) ctx.searchProviders = normalizeProviders(payload.searchProviders);
    if (payload?.fallbackProviders) ctx.fallbackProviders = normalizeProviders(payload.fallbackProviders);
    if (payload?.stopGraceMs !== undefined) ctx.stopGraceMs = payload.stopGraceMs;

    const requireOwnerMode = requireOwnerControl(ctx, payload?.controlMode);
    const actorIsAdmin = adminOverride ? true : isAdmin(actorMember);

    if (op === "status") {
      const current = ctx.player?.queue?.current ?? null;
      const tracks = getQueueTracks(ctx.player?.queue);
      return {
        playing: Boolean(ctx.player?.playing),
        paused: Boolean(ctx.player?.paused),
        mode: ctx.mode,
        ownerId: ctx.ownerId ?? null,
        current: serializeTrack(current),
        queueLength: tracks.length,
        volume: Number.isFinite(ctx.volume) ? ctx.volume : undefined
      };
    }

    if (op === "queue") return mgr.queue(ctx);

    if (op === "setMode") {
      const mode = String(payload.mode ?? "open").toLowerCase() === "dj" ? "dj" : "open";

      if (mode === "dj") {
        if (ctx.ownerId && ctx.ownerId !== actorUserId && !actorIsAdmin) throw new Error("not-owner");
      }

      if (mode === "open") {
        if (ctx.mode === "dj" && ctx.ownerId && ctx.ownerId !== actorUserId && !actorIsAdmin) throw new Error("not-owner");
      }

      return mgr.setMode(ctx, actorUserId, mode);
    }

    if (op === "skip") {
      const r = await mgr.skip(ctx, actorUserId, requireOwnerMode && !actorIsAdmin);
      if (r?.action === "stopped" && Number(r.disconnectInMs) > 0) {
        scheduleRelease(guildId, voiceChannelId, "grace-expired", r.disconnectInMs);
      }
      return r;
    }

    if (op === "pause") return mgr.pause(ctx, actorUserId, true, requireOwnerMode && !actorIsAdmin);
    if (op === "resume") return mgr.pause(ctx, actorUserId, false, requireOwnerMode && !actorIsAdmin);

    if (op === "stop") {
      const r = await mgr.stop(ctx, actorUserId, requireOwnerMode && !actorIsAdmin);
      if (r?.action === "stopped" && Number(r.disconnectInMs) > 0) {
        scheduleRelease(guildId, voiceChannelId, "grace-expired", r.disconnectInMs);
      } else {
        sendRelease(guildId, voiceChannelId, "stop");
      }
      return r ?? { ok: true };
    }

    if (op === "volume") return mgr.setVolume(ctx, actorUserId, payload.volume, requireOwnerMode && !actorIsAdmin);
    if (op === "remove") return mgr.removeFromQueue(ctx, actorUserId, payload.index, requireOwnerMode && !actorIsAdmin);
    if (op === "move") return mgr.moveInQueue(ctx, actorUserId, payload.from, payload.to, requireOwnerMode && !actorIsAdmin);
    if (op === "swap") return mgr.swapInQueue(ctx, actorUserId, payload.a, payload.b, requireOwnerMode && !actorIsAdmin);
    if (op === "shuffle") return mgr.shuffleQueue(ctx, actorUserId, requireOwnerMode && !actorIsAdmin);
    if (op === "clear") return mgr.clearQueue(ctx, actorUserId, requireOwnerMode && !actorIsAdmin);
    if (op === "preset") return mgr.setPreset(ctx, actorUserId, payload.preset, requireOwnerMode && !actorIsAdmin);

    throw new Error("unknown-op");
  }

  client.once(Events.ClientReady, async () => {
    logger.info(`✅ Agent ready: ${client.user.tag} (${agentId})`);
    try {
      await ensureLavalink();
      logger.info(`[${agentId}] Lavalink initialized successfully.`);
    } catch (err) {
      logger.error({ err }, `[${agentId}] Lavalink init failed`);
    }

    connectAgentControl(); // Each agent connects to the AgentManager
    if (wsReady) {
      sendHello();
      logger.info(`[agent:${agentId}] Connected to control plane at ${CONTROL_URL}`);
    } else {
      logger.error(`[agent:${agentId}] Failed to connect to control plane at ${CONTROL_URL}`);
    }
  });

  client.on("guildCreate", () => sendGuilds());
  client.on("guildDelete", () => sendGuilds());

  client.on("voiceStateUpdate", async (oldState, newState) => {
    const oldChannel = oldState.channel ?? null;
    const newChannel = newState.channel ?? null;

    await handleAgentMoved(oldState, newState);
    await handleAssistantMoved(oldState, newState);

    if (oldChannel && oldChannel.id !== newChannel?.id) {
      await stopIfEmpty(oldChannel);
    }
  });

  client.on("error", () => {});
  client.on("shardError", () => {});
  client.on("warn", () => {});

  await client.login(token);

  return {
    agentId,
    stop: async () => {
      try {
        await stopAssistant("shutdown");
      } catch (err) {
        handleCriticalError(err, {
          operation: 'agent_shutdown_stop_assistant',
          category: ErrorCategory.ASSISTANT
        });
      }
      try {
        if (wsHeartbeat) clearInterval(wsHeartbeat);
      } catch (err) {
        handleSafeError(err, {
          operation: 'agent_shutdown_clear_heartbeat',
          category: ErrorCategory.WEBSOCKET,
          severity: ErrorSeverity.LOW
        });
      }
      try {
        if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      } catch (err) {
        handleSafeError(err, {
          operation: 'agent_shutdown_ws_close',
          category: ErrorCategory.WEBSOCKET,
          severity: ErrorSeverity.LOW
        });
      }
      try {
        await client.destroy();
      } catch (err) {
        handleCriticalError(err, {
          operation: 'agent_shutdown_client_destroy',
          category: ErrorCategory.DISCORD_API
        });
      }
    }
  };
}

// Initial call to connect the runner's control WebSocket
// This is removed as per the new plan.
// connectRunnerControl();


async function pollForAgentChanges() {
  logger.info(`[Runner:${RUNNER_ID}] Polling for agent changes...`);
  await upsertAgentRunner(RUNNER_ID, Date.now(), { pid: process.pid }); // Heartbeat

  const dbAgents = await fetchAgentBots();
  const desiredAgentIds = new Set(dbAgents.filter(a => a.status === 'active').map(a => a.agent_id));
  const currentRunningAgentIds = new Set(activeAgents.keys());

  // Stop agents that are no longer desired or are inactive
  for (const agentId of currentRunningAgentIds) {
    if (!desiredAgentIds.has(agentId)) {
      const agentInstance = activeAgents.get(agentId);
      if (agentInstance) {
        logger.info(`[Runner:${RUNNER_ID}] Stopping agent ${agentId} (no longer active or removed from DB).`);
        try {
          await agentInstance.stopFn(); // Call the stop function returned by startAgent
        } catch (err) {
          logger.error({ err }, `[Runner:${RUNNER_ID}] Error stopping agent ${agentId}`);
        } finally {
          activeAgents.delete(agentId);
        }
      }
    }
  }

  // Start agents that are desired but not currently running
  for (const agentConfig of dbAgents) {
    if (agentConfig.status === 'active' && !activeAgents.has(agentConfig.agent_id)) {
      // fetchAgentBots() intentionally omits the token for security.
      // Fetch and decrypt it now, only when we actually need to start the agent.
      let plainToken;
      try {
        plainToken = await fetchAgentToken(agentConfig.agent_id);
      } catch (err) {
        logger.error({ err, agentId: agentConfig.agent_id, poolId: agentConfig.pool_id, encVersion: agentConfig.enc_version }, `[Runner:${RUNNER_ID}] Could not decrypt token for ${agentConfig.agent_id} — enc_version=${agentConfig.enc_version} pool=${agentConfig.pool_id}`);
        updateAgentBotStatus(agentConfig.agent_id, 'corrupt').catch(() => {});
        continue;
      }
      if (!plainToken) {
        logger.warn({ agentId: agentConfig.agent_id, poolId: agentConfig.pool_id, encVersion: agentConfig.enc_version }, `[Runner:${RUNNER_ID}] Agent ${agentConfig.agent_id} has no usable token (likely key rotated). enc_version=${agentConfig.enc_version}. Marking as corrupt.`);
        updateAgentBotStatus(agentConfig.agent_id, 'corrupt').catch(() => {});
        continue;
      }
      logger.info(`[Runner:${RUNNER_ID}] Starting agent ${agentConfig.agent_id}...`);
      try {
        const { stop: stopFn } = await startAgent({ ...agentConfig, token: plainToken });
        activeAgents.set(agentConfig.agent_id, { stopFn, agentConfig });
      } catch (err) {
        logger.error({ err, agentId: agentConfig.agent_id, tag: agentConfig.tag, poolId: agentConfig.pool_id }, `[Runner:${RUNNER_ID}] Error starting agent ${agentConfig.agent_id} (tag=${agentConfig.tag}): ${err?.message}`);
        updateAgentBotStatus(agentConfig.agent_id, 'failed').catch(e => logger.error({ err: e }, "Failed to update agent status to failed"));
      }
    }
  }
}

// Initial setup on runner boot
(async () => {
  logger.info(`[Runner:${RUNNER_ID}] Initializing...`);
  // Register or update runner on boot
  await upsertAgentRunner(RUNNER_ID, Date.now(), { pid: process.pid, hostname: process.env.HOSTNAME || 'unknown' });

  // Reset any agents previously marked corrupt/failed — they may have been mis-marked
  // due to the token-not-fetched bug. Safe to retry since we now fetch tokens correctly.
  try {
    const reset = await resetCorruptAgents();
    if (reset.length) logger.info(`[Runner:${RUNNER_ID}] Reset ${reset.length} corrupt/failed agent(s) to active: ${reset.join(', ')}`);
  } catch (err) {
    logger.warn({ err }, `[Runner:${RUNNER_ID}] Could not reset corrupt agents`);
  }

  await pollForAgentChanges(); // Initial poll

  // Start polling
  setInterval(pollForAgentChanges, POLL_INTERVAL_MS);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    logger.info(`[Runner:${RUNNER_ID}] SIGINT received. Shutting down...`);
    await deleteAgentRunner(RUNNER_ID); // Remove runner from DB
    for (const agentId of activeAgents.keys()) {
      const agentInstance = activeAgents.get(agentId);
      if (agentInstance) {
        try {
          await agentInstance.stopFn();
        } catch (err) {
          logger.error({ err }, `[Runner:${RUNNER_ID}] Error stopping agent ${agentId} during shutdown`);
        }
      }
    }
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info(`[Runner:${RUNNER_ID}] SIGTERM received. Shutting down...`);
    await deleteAgentRunner(RUNNER_ID); // Remove runner from DB
    for (const agentId of activeAgents.keys()) {
      const agentInstance = activeAgents.get(agentId);
      if (agentInstance) {
        try {
          await agentInstance.stopFn();
        } catch (err) {
          logger.error({ err }, `[Runner:${RUNNER_ID}] Error stopping agent ${agentId} during shutdown`);
        }
      }
    }
    process.exit(0);
  });

})().catch(err => {
  logger.error({ err }, `[Runner:${RUNNER_ID}] Fatal initialization error`);
  process.exit(1);
});
