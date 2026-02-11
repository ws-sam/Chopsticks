// src/music/service.js
export function getSessionAgent(guildId, voiceChannelId) {
  const mgr = global.agentManager;
  if (!mgr) return { ok: false, reason: "agents-not-ready" };
  return mgr.getSessionAgent(guildId, voiceChannelId);
}

export function ensureSessionAgent(guildId, voiceChannelId, { textChannelId, ownerUserId } = {}) {
  const mgr = global.agentManager;
  if (!mgr) return { ok: false, reason: "agents-not-ready" };
  return mgr.ensureSessionAgent(guildId, voiceChannelId, { textChannelId, ownerUserId });
}

export function releaseSession(guildId, voiceChannelId) {
  const mgr = global.agentManager;
  if (!mgr) return;
  mgr.releaseSession(guildId, voiceChannelId);
}

export async function sendAgentCommand(agent, op, data) {
  const mgr = global.agentManager;
  if (!mgr) throw new Error("agents-not-ready");
  return mgr.request(agent, op, data);
}

export function formatMusicError(reasonOrErr) {
  const msg = String(reasonOrErr?.message ?? reasonOrErr);

  if (msg === "no-agents-in-guild" || msg === "no-free-agents") {
    return "No music agents available. Chopsticks never plays music directly — deploy/invite agents to enable playback.";
  }
  if (msg === "agents-not-ready") return "Music agents are still starting up.";
  if (msg === "not-owner") return "This voice channel is in DJ mode and is owned by someone else.";
  if (msg === "not-in-voice") return "You must be in the same voice channel to control that session.";
  if (msg === "missing-actor") return "Missing actor.";
  if (msg === "not-in-guild") return "You are not in that guild.";
  if (msg === "player-search-missing") return "Search is unavailable (check Lavalink/plugin).";
  if (msg === "lavalink-not-ready") return "Lavalink is not ready.";
  if (msg === "no-session") return "Nothing playing in this channel.";
  if (msg === "agent-offline") return "Music agent went offline. Try again.";
  if (msg === "agent-timeout") return "Music agent timed out. Try again.";
  if (msg === "voice-not-ready") return "Voice connection not ready yet. Try again.";
  if (msg === "bad-volume") return "Volume must be between 0 and 150.";
  if (msg === "queue-full") return "Queue is full for this channel.";
  if (msg === "track-too-long") return "Track is longer than the server limit.";
  if (msg === "queue-too-long") return "Queue duration would exceed the server limit.";
  if (msg === "bad-index") return "Queue index is invalid.";
  if (msg === "bad-preset" || msg === "preset-failed") return "Audio preset failed.";

  if (process.env.NODE_ENV === "development") {
    return `Command failed: ${msg || "unknown error"}`;
  }
  return "Command failed.";
}
