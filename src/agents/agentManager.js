// src/agents/agentManager.js
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { fetchAgentBots, fetchAgentRunners, updateAgentBotStatus } from "../utils/storage.js";
import { logger } from "../utils/logger.js";

function sessionKey(guildId, voiceChannelId) {
  return `${guildId}:${voiceChannelId}`;
}

function assistantKey(guildId, voiceChannelId) {
  return `a:${guildId}:${voiceChannelId}`;
}

function now() {
  return Date.now();
}

function safeInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function buildInviteUrl({ clientId, permissions }) {
  const perms = BigInt(permissions ?? 0);
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${perms.toString()}&scope=bot%20applications.commands`;
}

/**
 * Control-plane between main bot and agentRunner.
 * - Agents connect in, announce themselves (hello) and guild membership.
 * - Main bot leases an agent per (guildId, voiceChannelId) session (music or assistant).
 * - Main bot can generate invite links for connected agent identities to "deploy agents" into new guilds.
 */
export class AgentManager {
  constructor({ host, port } = {}) {
    this.host = host || "127.0.0.1";
    this.port = Number(port) || 8787;

    this.started = false;
    this.wss = null;

    this.liveAgents = new Map(); // agentId -> { ws, clientId, tag, ready, guildIds, busyKey, busyKind, ... } - runtime state for connected agents
    this.pending = new Map(); // requestId -> { resolve, reject, timeout }
    this.sessions = new Map(); // sessionKey -> agentId
    this.assistantSessions = new Map(); // assistantKey -> agentId


    // Hardening: fair selection per guild
    this.guildCursors = new Map(); // guildId -> last selected index

    // Preferred agent per session (soft hint)
    this.preferred = new Map(); // sessionKey -> { agentId, expiresAt }
    this.assistantPreferred = new Map(); // assistantKey -> { agentId, expiresAt }

    // Health / pruning
    this.staleAgentMs = safeInt(process.env.AGENT_STALE_MS, 45_000);
    this.pruneEveryMs = safeInt(process.env.AGENT_PRUNE_EVERY_MS, 10_000);
    this._pruneTimer = null;

    // Reconciliation
    this.reconcileEveryMs = safeInt(process.env.AGENT_RECONCILE_EVERY_MS, 300_000); // 5 minutes
    this._reconcileTimer = null;

    // Invite perms for agents (connect/speak/read history)
    // Conservative by default. Override with AGENT_INVITE_PERMS if you want.
    this.invitePerms = BigInt(process.env.AGENT_INVITE_PERMS || "3147776");
  }

  async start() {
    if (this.started) return;
    this.started = true;

    this.wss = new WebSocketServer({ host: this.host, port: this.port });
    this.wss.on("connection", ws => this.handleConnection(ws));
    this.wss.on("error", err => {
      logger.error("[agent:control:server:error]", { error: err?.message ?? err });
    });

    await new Promise(resolve => {
      this.wss.once("listening", resolve);
    });

    this._pruneTimer = setInterval(() => this.pruneStaleAgents(), this.pruneEveryMs);
    this._pruneTimer.unref?.();
    
    // Start reconciliation loop
    this._reconcileTimer = setInterval(() => this.reconcileAgents(), this.reconcileEveryMs);
    this._reconcileTimer.unref?.();
    await this.reconcileAgents(); // Run once on startup
  }

  stop() {
    try {
      if (this._pruneTimer) clearInterval(this._pruneTimer);
      if (this._reconcileTimer) clearInterval(this._reconcileTimer);
      this._pruneTimer = null;
      this._reconcileTimer = null;
      this.wss?.close?.();
    } catch {}
  }

  handleConnection(ws) {
    // When an agent connects, it will send a "hello" message containing its agentId
    ws.on("message", data => this.handleMessage(ws, data));
    ws.on("close", () => this.handleClose(ws));
    ws.on("error", (err) => {
      logger.error(`[AgentManager] Agent WS error:`, { error: err?.message ?? err });
    });
  }

  handleClose(ws) {
    const agentId = ws.__agentId;
    if (!agentId) return; // Unknown connection

    this._cleanupAgentOnDisconnect(agentId);
  }

  handleMessage(ws, data) {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }

    if (msg?.type === "hello") return void this.handleHello(ws, msg);
    if (msg?.type === "guilds") return void this.handleGuilds(ws, msg);
    if (msg?.type === "event") return void this.handleEvent(ws, msg);
    if (msg?.type === "resp") return void this.handleResponse(ws, msg);
  }

  handleHello(ws, msg) { // Now directly from an agent
    const agentId = String(msg?.agentId ?? "").trim();
    if (!agentId) return;

    // Attach agentId to WebSocket for future messages
    ws.__agentId = agentId;

    let agent = this.liveAgents.get(agentId);
    if (!agent) {
      agent = {
        agentId,
        ws,
        ready: false,
        busyKey: null,
        busyKind: null,
        guildIds: new Set(),
        guildId: null,
        voiceChannelId: null,
        textChannelId: null,
        ownerUserId: null,
        lastActive: null,
        startedAt: null,
        lastSeen: null,
        botUserId: msg?.botUserId ?? null,
        tag: msg?.tag ?? null
      };
      this.liveAgents.set(agentId, agent);
    } else {
      // If agent reconnected, update its WebSocket
      if (agent.ws !== ws) {
        // Optionally terminate old WS if it's still alive to ensure clean state
        try { agent.ws.terminate(); } catch {}
        agent.ws = ws;
      }
    }

    // Update common runtime properties
    agent.ready = Boolean(msg?.ready);
    agent.guildIds = new Set(Array.isArray(msg?.guildIds) ? msg.guildIds : []);
    agent.botUserId = msg?.botUserId ?? agent.botUserId;
    agent.tag = msg?.tag ?? agent.tag;
    agent.startedAt = agent.startedAt ?? now();
    agent.lastSeen = now();
  }

  handleGuilds(ws, msg) { // Now directly from an agent
    const agentId = ws.__agentId;
    if (!agentId) return;

    const agent = this.liveAgents.get(agentId);
    if (!agent) return;

    agent.guildIds = new Set(Array.isArray(msg?.guildIds) ? msg.guildIds : []);
    agent.lastSeen = now();
  }

  handleEvent(ws, msg) { // Now directly from an agent
    const agentId = ws.__agentId;
    if (!agentId) return;
    const agent = this.liveAgents.get(agentId);
    if (agent) agent.lastSeen = now();
    else return;

    if (msg?.event === "released") {
      const guildId = msg?.guildId;
      const voiceChannelId = msg?.voiceChannelId;
      if (!guildId || !voiceChannelId) return;

      const kind = String(msg?.kind || "music");
      if (kind === "assistant") {
        const key = assistantKey(guildId, voiceChannelId);
        const currentAgentId = this.assistantSessions.get(key);
        if (currentAgentId !== agentId) return;
        this.releaseAssistantSession(guildId, voiceChannelId);
      } else {
        const key = sessionKey(guildId, voiceChannelId);
        const currentAgentId = this.sessions.get(key);
        if (currentAgentId !== agentId) return;
        this.releaseSession(guildId, voiceChannelId);
      }
    } else if (msg?.event === "add") { // Handle "add" event
      if (msg?.ok && msg?.channelId) {
        const guildId = msg?.guildId;
        const voiceChannelId = msg?.voiceChannelId;
        const textChannelId = msg?.textChannelId;
        const ownerUserId = msg?.ownerUserId;
        const kind = String(msg?.kind || "music");

        if (!guildId || !voiceChannelId) return;

        if (kind === "assistant") {
          const key = assistantKey(guildId, voiceChannelId);
          if (this.assistantSessions.get(key) !== agentId) {
            // Agent is reporting "add" for a session it's not assigned to, or session doesn't exist.
            // Potentially update state or log a warning. For now, proceed cautiously.
          }
          this.bindAgentToAssistant(agent, { guildId, voiceChannelId, textChannelId, ownerUserId });
          logger.info(`[AgentManager] Agent ${agentId} reported adding to assistant session ${key} on channel ${msg.channelId}.`);
        } else {
          const key = sessionKey(guildId, voiceChannelId);
          if (this.sessions.get(key) !== agentId) {
            // Agent is reporting "add" for a session it's not assigned to, or session doesn't exist.
          }
          this.bindAgentToSession(agent, { guildId, voiceChannelId, textChannelId, ownerUserId });
          logger.info(`[AgentManager] Agent ${agentId} reported adding to session ${key} on channel ${msg.channelId}.`);
        }
        // Update agent's last seen and busy status
        agent.lastSeen = now();
        agent.busyKey = kind === "assistant" ? assistantKey(guildId, voiceChannelId) : sessionKey(guildId, voiceChannelId);
        agent.busyKind = kind;
        agent.guildId = guildId;
        agent.voiceChannelId = voiceChannelId;
        agent.textChannelId = textChannelId ?? null;
        agent.ownerUserId = ownerUserId ?? null;
        agent.lastActive = now();
      } else {
        logger.warn(`[AgentManager] Agent ${agentId} reported "add" event failure for channel ${msg?.channelId}. Reason: ${msg?.error || 'unknown'}`);
        // If the agent reported failure, we might need to unbind it or handle it.
        // For now, just log the warning.
      }
    }
  }

  handleResponse(ws, msg) { // Now directly from an agent
    const reqId = msg?.id;
    if (!reqId) return;

    const pending = this.pending.get(reqId);
    if (!pending) return;

    const agentId = ws.__agentId; // AgentId should already be attached to the WS
    const agent = agentId ? this.liveAgents.get(agentId) : null;
    if (agent) agent.lastSeen = now();

    this.pending.delete(reqId);
    clearTimeout(pending.timeout);

    if (msg?.ok) {
      pending.resolve(msg?.data ?? null);
    } else {
      pending.reject(new Error(String(msg?.error ?? "agent-error")));
    }
  }

  // ===== listing / manifest =====



  async listAgents() {
    const registeredAgents = await fetchAgentBots();
    const runners = await fetchAgentRunners();

    const runnerMap = new Map();
    for (const r of runners) {
      runnerMap.set(r.runner_id, r);
    }

    const out = [];
    for (const regAgent of registeredAgents) {
      const liveAgent = this.liveAgents.get(regAgent.agent_id);
      const runner = liveAgent?.runnerId ? runnerMap.get(liveAgent.runnerId) : null; // Access runnerId from liveAgent

      out.push({
        agentId: regAgent.agent_id,
        clientId: regAgent.client_id,
        tag: regAgent.tag,
        status: regAgent.status, // DB status (active/inactive/failed)

        // Live WS status (from liveAgents map)
        ready: Boolean(liveAgent?.ready),
        busyKey: liveAgent?.busyKey ?? null,
        busyKind: liveAgent?.busyKind ?? null,
        guildIds: liveAgent?.guildIds ? Array.from(liveAgent.guildIds) : [],
        guildId: liveAgent?.guildId ?? null,
        voiceChannelId: liveAgent?.voiceChannelId ?? null,
        textChannelId: liveAgent?.textChannelId ?? null,
        ownerUserId: liveAgent?.ownerUserId ?? null,
        lastActive: liveAgent?.lastActive ?? null, // Last time RPC request was made
        lastSeen: liveAgent?.lastSeen ?? null, // Last WS heartbeat
        startedAt: liveAgent?.startedAt ?? null, // When agent process started

        // Runner info
        runnerId: runner?.runner_id ?? null,
        runnerLastSeen: runner?.last_seen ?? null,
      });
    }
    out.sort((a, b) => String(a.agentId).localeCompare(String(b.agentId)));
    return out;
  }

  listSessions() {
    const out = [];
    for (const [key, agentId] of this.sessions.entries()) {
      const [guildId, voiceChannelId] = String(key).split(":");
      out.push({ guildId, voiceChannelId, agentId });
    }
    out.sort((a, b) => String(a.voiceChannelId).localeCompare(String(b.voiceChannelId)));
    return out;
  }

  listAssistantSessions() {
    const out = [];
    for (const [key, agentId] of this.assistantSessions.entries()) {
      const [_p, guildId, voiceChannelId] = String(key).split(":");
      out.push({ guildId, voiceChannelId, agentId });
    }
    out.sort((a, b) => String(a.voiceChannelId).localeCompare(String(b.voiceChannelId)));
    return out;
  }

  // ===== invite helpers / deploy =====

  async listInvitableAgentsForGuild(guildId) {
    const registeredAgents = await fetchAgentBots();
    const out = [];
    for (const regAgent of registeredAgents) {
      if (!regAgent?.client_id) continue; // Must have a client ID to be invitable
      if (regAgent.status !== 'active') continue; // Only consider active registered agents

      const liveAgent = this.liveAgents.get(regAgent.agent_id);
      if (liveAgent) {
        // If agent is live, check its current guild status
        if (liveAgent.guildIds?.has?.(guildId)) continue; // Already in guild
      } else {
        // If agent is not live, we assume it's not in the guild for now.
        // If we want to be more precise, we'd need to query Discord API for non-live agents, which is out of scope for this.
      }
      out.push({
        agentId: regAgent.agent_id,
        botUserId: regAgent.client_id,
        tag: regAgent.tag
      });
    }
    out.sort((a, b) => String(a.agentId).localeCompare(String(b.agentId)));
    return out;
  }

  buildInviteForAgent(agent) {
    if (!agent?.botUserId) return null;
    return buildInviteUrl({ clientId: agent.botUserId, permissions: this.invitePerms });
  }

  async buildDeployPlan(guildId, desiredCount) {
    const desired = Math.max(0, Number(desiredCount || 0) || 0);

    const present = [];
    for (const agent of this.liveAgents.values()) { // Iterate liveAgents
      if (agent.guildIds?.has?.(guildId)) present.push(agent);
    }

    const invitable = await this.listInvitableAgentsForGuild(guildId); // Now async

    const need = Math.max(0, desired - present.length);
    const picks = invitable.slice(0, need);

    const invites = picks
      .map(a => ({
        agentId: a.agentId,
        tag: a.tag ?? null,
        botUserId: a.botUserId,
        inviteUrl: (() => {
          logger.info(`[DEBUG] Building invite for agent: ${a.agentId}, botUserId: ${a.botUserId}`);
          return this.buildInviteForAgent(a);
        })()
      }))
      .filter(x => x.inviteUrl);

    return {
      guildId,
      desired,
      presentCount: present.length,
      invitableCount: invitable.length,
      needInvites: need,
      invites
    };
  }

  // ===== leasing (music) =====

  getSessionAgent(guildId, voiceChannelId) {
    const key = sessionKey(guildId, voiceChannelId);
    const agentId = this.sessions.get(key);
    if (!agentId) return { ok: false, reason: "no-session" };
    const agent = this.liveAgents.get(agentId); // Get from liveAgents
    if (!agent?.ready || !agent.ws) { // Check agent.ws (its own WebSocket)
      this.sessions.delete(key);
      return { ok: false, reason: "agent-offline" };
    }
    return { ok: true, agent };
  }

  setPreferredAgent(guildId, voiceChannelId, agentId, ttlMs = 300_000) {
    const key = sessionKey(guildId, voiceChannelId);
    this.preferred.set(key, { agentId, expiresAt: now() + ttlMs });
  }

  getPreferredAgent(guildId, voiceChannelId) {
    const key = sessionKey(guildId, voiceChannelId);
    const pref = this.preferred.get(key);
    if (!pref) return null;
    if (pref.expiresAt <= now()) {
      this.preferred.delete(key);
      return null;
    }
    const agent = this.liveAgents.get(pref.agentId); // Get from liveAgents
    if (!agent?.ready || !agent.ws) return null; // Check agent.ws
    return agent;
  }

  bindAgentToSession(agent, { guildId, voiceChannelId, textChannelId, ownerUserId }) {
    const key = sessionKey(guildId, voiceChannelId);
    this.sessions.set(key, agent.agentId);

    agent.busyKey = key;
    agent.busyKind = "music";
    agent.guildId = guildId;
    agent.voiceChannelId = voiceChannelId;
    agent.textChannelId = textChannelId ?? null;
    agent.ownerUserId = ownerUserId ?? null;
    agent.lastActive = now();
  }

  releaseSession(guildId, voiceChannelId) {
    const key = sessionKey(guildId, voiceChannelId);
    const agentId = this.sessions.get(key);
    if (agentId) {
      const agent = this.liveAgents.get(agentId);
      if (agent && agent.busyKey === key) {
        agent.busyKey = null;
        agent.busyKind = null;
        agent.guildId = null;
        agent.voiceChannelId = null;
        agent.textChannelId = null;
        agent.ownerUserId = null;
      }
    }
    this.sessions.delete(key);
  }

  async ensureSessionAgent(guildId, voiceChannelId, { textChannelId, ownerUserId } = {}) {
    // 1. Check for existing active session agent
    const existing = this.getSessionAgent(guildId, voiceChannelId);
    if (existing.ok) return existing;

    // 2. Check for preferred agent (must be active)
    const preferred = this.getPreferredAgent(guildId, voiceChannelId);
    if (preferred && !preferred.busyKey) {
      this.bindAgentToSession(preferred, { guildId, voiceChannelId, textChannelId, ownerUserId });
      return { ok: true, agent: preferred };
    }

    // 3. Find an idle agent already in the guild
    const idleAgentInGuild = this.findIdleAgentInGuildRoundRobin(guildId);
    if (idleAgentInGuild) {
      this.bindAgentToSession(idleAgentInGuild, { guildId, voiceChannelId, textChannelId, ownerUserId });
      return { ok: true, agent: idleAgentInGuild };
    }

    // 4. No idle agents in guild - check if we have any agents at all
    const present = this.countPresentInGuild(guildId);
    if (present === 0) return { ok: false, reason: "no-agents-in-guild" };
    
    // All agents are busy
    return { ok: false, reason: "no-free-agents" };
  }

  listIdleAgentsInGuild(guildId) {
    const out = [];
    for (const agent of this.liveAgents.values()) {
      if (!agent.ready || !agent.ws) continue;
      if (agent.busyKey) continue;
      if (!agent.guildIds.has(guildId)) continue;
      out.push(agent);
    }
    out.sort((a, b) => String(a.agentId).localeCompare(String(b.agentId)));
    return out;
  }

  findIdleAgentInGuildRoundRobin(guildId) {
    const list = this.listIdleAgentsInGuild(guildId);
    if (list.length === 0) return null;

    const prev = this.guildCursors.get(guildId) ?? -1;
    const nextIndex = (prev + 1) % list.length;
    this.guildCursors.set(guildId, nextIndex);

    return list[nextIndex];
  }

  countPresentInGuild(guildId) {
    let count = 0;
    for (const agent of this.liveAgents.values()) {
      if (agent.guildIds.has(guildId)) count++;
    }
    return count;
  }



  // ===== leasing (assistant) =====

  getAssistantSessionAgent(guildId, voiceChannelId) {
    const key = assistantKey(guildId, voiceChannelId);
    const agentId = this.assistantSessions.get(key);
    if (!agentId) return { ok: false, reason: "no-session" };
    const agent = this.liveAgents.get(agentId);
    if (!agent?.ready || !agent.ws) {
      this.assistantSessions.delete(key);
      return { ok: false, reason: "agent-offline" };
    }
    return { ok: true, agent };
  }

  setPreferredAssistant(guildId, voiceChannelId, agentId, ttlMs = 300_000) {
    const key = assistantKey(guildId, voiceChannelId);
    this.assistantPreferred.set(key, { agentId, expiresAt: now() + ttlMs });
  }

  getPreferredAssistant(guildId, voiceChannelId) {
    const key = assistantKey(guildId, voiceChannelId);
    const pref = this.assistantPreferred.get(key);
    if (!pref) return null;
    if (pref.expiresAt <= now()) {
      this.assistantPreferred.delete(key);
      return null;
    }
    const agent = this.liveAgents.get(pref.agentId);
    if (!agent?.ready || !agent.ws) return null;
    return agent;
  }

  bindAgentToAssistant(agent, { guildId, voiceChannelId, textChannelId, ownerUserId }) {
    const key = assistantKey(guildId, voiceChannelId);
    this.assistantSessions.set(key, agent.agentId);

    agent.busyKey = key;
    agent.busyKind = "assistant";
    agent.guildId = guildId;
    agent.voiceChannelId = voiceChannelId;
    agent.textChannelId = textChannelId ?? null;
    agent.ownerUserId = ownerUserId ?? null;
    agent.lastActive = now();
  }

  releaseAssistantSession(guildId, voiceChannelId) {
    const key = assistantKey(guildId, voiceChannelId);
    const agentId = this.assistantSessions.get(key);
    if (agentId) {
      const agent = this.liveAgents.get(agentId);
      if (agent && agent.busyKey === key) {
        agent.busyKey = null;
        agent.busyKind = null;
        agent.guildId = null;
        agent.voiceChannelId = null;
        agent.textChannelId = null;
        agent.ownerUserId = null;
      }
    }
    this.assistantSessions.delete(key);
  }

  async ensureAssistantAgent(guildId, voiceChannelId, { textChannelId, ownerUserId } = {}) {
    // 1. Check for existing active assistant session agent
    const existing = this.getAssistantSessionAgent(guildId, voiceChannelId);
    if (existing.ok) return existing;

    // 2. Check for preferred assistant agent (must be active)
    const preferred = this.getPreferredAssistant(guildId, voiceChannelId);
    if (preferred && !preferred.busyKey) {
      this.bindAgentToAssistant(preferred, { guildId, voiceChannelId, textChannelId, ownerUserId });
      return { ok: true, agent: preferred };
    }

    // 3. Find an idle agent already in the guild
    const idleAgentInGuild = this.findIdleAgentInGuildRoundRobin(guildId);
    if (idleAgentInGuild) {
      this.bindAgentToAssistant(idleAgentInGuild, { guildId, voiceChannelId, textChannelId, ownerUserId });
      return { ok: true, agent: idleAgentInGuild };
    }

    // 4. No idle agents in guild - check if we have any agents at all
    const present = this.countPresentInGuild(guildId);
    if (present === 0) return { ok: false, reason: "no-agents-in-guild" };
    
    // All agents are busy
    return { ok: false, reason: "no-free-agents" };
  }

  // ===== health =====

  _cleanupAgentOnDisconnect(agentId) {
    const agent = this.liveAgents.get(agentId);
    if (!agent) return;

    // Release leases held by this agent
    for (const [k, aId] of this.sessions.entries()) {
      if (aId === agentId) this.sessions.delete(k);
    }
    for (const [k, aId] of this.assistantSessions.entries()) {
      if (aId === agentId) this.assistantSessions.delete(k);
    }

    this.liveAgents.delete(agentId);
    logger.info(`[AgentManager] Cleaned up disconnected agent ${agentId}.`);
  }

  pruneStaleAgents() {
    const cutoff = now() - this.staleAgentMs;

    for (const agent of this.liveAgents.values()) {
      if (!agent.ws) continue; // Agent is not associated with a WebSocket
      if ((agent.lastSeen ?? 0) >= cutoff) {
        // logger.info(`[AgentManager] Agent ${agent.agentId} is active. Last seen: ${new Date(agent.lastSeen).toISOString()}`);
        continue; // Not stale
      }

      const agentId = agent.agentId;
      logger.warn(`[AgentManager] Terminating stale agent WS connection: ${agentId}. Last seen: ${new Date(agent.lastSeen).toISOString()}`);
      try {
        agent.ws.terminate(); // Terminate the WebSocket connection
      } catch (err) {
        logger.error(`[AgentManager] Error terminating WS for stale agent ${agentId}:`, { error: err?.message ?? err });
      }
      // handleClose will take care of cleaning up the liveAgents map
    }
  }

  // ===== RPC =====

  async request(agent, op, data, timeoutMs = 20_000) {
    if (!agent?.ws || !agent?.ready) throw new Error("agent-offline"); // Check agent's WS and ready status

    const id = randomUUID();
    const payload = { type: "req", id, op, data, agentId: agent.agentId }; // Include agentId in payload
    agent.lastActive = now();

    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("agent-timeout"));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
    });

    try {
      agent.ws.send(JSON.stringify(payload)); // Send via agent's WebSocket
    } catch {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(id);
      }
      throw new Error("agent-offline");
    }

    return response;
  }

  // ===== Reconciliation =====

  async reconcileAgents() {
    logger.info("Starting agent reconciliation...");
    try {
      const dbAgents = await fetchAgentBots();
      const liveAgentIds = new Set(this.liveAgents.keys());
      const dbAgentMap = new Map(dbAgents.map(a => [a.agent_id, a]));

      // Check 1: Find live agents that are not in the DB or are marked inactive
      for (const liveAgent of this.liveAgents.values()) {
        const dbRecord = dbAgentMap.get(liveAgent.agentId);
        if (!dbRecord) {
          logger.warn(`Reconciliation: Live agent ${liveAgent.agentId} is not in the database. It may need to be terminated.`, { agentId: liveAgent.agentId });
        } else if (dbRecord.status !== 'active') {
          logger.warn(`Reconciliation: Live agent ${liveAgent.agentId} is marked as '${dbRecord.status}' in the DB but is connected.`, { agentId: liveAgent.agentId, status: dbRecord.status });
        }
      }

      // Check 2: Find active DB agents that are not live
      for (const dbAgent of dbAgents) {
        if (dbAgent.status === 'active' && !liveAgentIds.has(dbAgent.agent_id)) {
          logger.warn(`Reconciliation: Agent ${dbAgent.agent_id} is 'active' in the DB but is not connected.`, { agentId: dbAgent.agent_id });
        }
      }
    } catch (error) {
      logger.error("Agent reconciliation failed", { error: error.message });
    }
    logger.info("Agent reconciliation finished.");
  }
}

// Enhanced logging for debugging
const originalRequest = AgentManager.prototype.request;
AgentManager.prototype.request = function(agent, op, data) {
  console.log(`[AgentManager] RPC request: ${op} to agent ${agent.agentId}`);
  return originalRequest.call(this, agent, op, data).catch(err => {
    console.error(`[AgentManager] RPC failed: ${op}`, err.message);
    throw err;
  });
};
