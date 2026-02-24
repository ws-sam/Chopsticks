// src/agents/agentManager.js
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { fetchAgentBots, fetchAgentToken, fetchAgentRunners, fetchPool, loadGuildData, updateAgentBotStatus } from "../utils/storage.js";
import { logger, createAgentScopedLogger, generateCorrelationId } from "../utils/logger.js";
import {
  trackAgentRegistration,
  trackAgentRestart,
  trackAgentDisconnect,
  updateAgentGauges,
  updateAgentUptimeMetrics,
  updatePoolUtilization,
  trackSessionAllocation,
  trackSessionRelease,
  updateSessionGauges
} from "../utils/metrics.js";
import CircuitBreaker from "opossum";
import { createPrimarySession, getPrimarySession, releasePrimarySession } from "../music/primarySession.js";

// Protocol version - must match agent version
const PROTOCOL_VERSION = "1.0.0";
const SUPPORTED_VERSIONS = new Set(["1.0.0"]); // Add older versions here for compatibility

// Agent limits per guild (Level 1: Invariants Locked)
const MAX_AGENTS_PER_GUILD = 49;

function sessionKey(guildId, voiceChannelId) {
  return `${guildId}:${voiceChannelId}`;
}

function assistantKey(guildId, voiceChannelId) {
  return `a:${guildId}:${voiceChannelId}`;
}

function textKey(kind, guildId, textChannelId, ownerUserId) {
  const k = String(kind || "text");
  return `t:${k}:${guildId}:${textChannelId}:${ownerUserId || "0"}`;
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
    this.runnerSecret = String(process.env.AGENT_RUNNER_SECRET || "").trim();

    this.started = false;
    this.wss = null;

    this.liveAgents = new Map(); // agentId -> { ws, clientId, tag, ready, guildIds, busyKey, busyKind, ... } - runtime state for connected agents
    this.pending = new Map(); // requestId -> { resolve, reject, timeout }
    this.sessions = new Map(); // sessionKey -> agentId
    this.assistantSessions = new Map(); // assistantKey -> agentId
    this.textSessions = new Map(); // textKey -> agentId


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

    // Idle auto-release watchdog
    this.sessionIdleReleaseMs = safeInt(process.env.AGENT_SESSION_IDLE_RELEASE_MS, 1_800_000); // 30m default
    this.sessionIdleSweepMs = safeInt(process.env.AGENT_SESSION_IDLE_SWEEP_MS, 60_000); // 1m
    this.textSessionIdleReleaseMs = safeInt(process.env.AGENT_TEXT_SESSION_IDLE_RELEASE_MS, 900_000); // 15m default
    this._idleSweepTimer = null;
    this._idleSweepRunning = false;
    this.guildIdleConfigCacheMs = safeInt(process.env.AGENT_GUILD_IDLE_CACHE_MS, 60_000);
    this._guildIdleReleaseCache = new Map(); // guildId -> { value, expiresAt }
    this.adminOverrideToken = String(process.env.DASHBOARD_ADMIN_TOKEN || "").trim();
    this._agentDeployerCache = new Map(); // agentId -> ownerUserId
    this._agentDeployerCacheAt = 0;

    // Invite perms for agents (connect/speak/read history)
    // Conservative by default. Override with AGENT_INVITE_PERMS if you want.
    this.invitePerms = BigInt(process.env.AGENT_INVITE_PERMS || "3147776");

    // Circuit breaker for agent requests
    this.circuitBreaker = new CircuitBreaker(this._performRequest.bind(this), {
      timeout: 20000, // If our function takes longer than 20s, trigger a failure
      errorThresholdPercentage: 50, // When 50% of requests fail, open the circuit
      resetTimeout: 30000, // After 30s, try again
      rollingCountTimeout: 10000, // Check the last 10s for failures
      rollingCountBuckets: 10
    });

    // A2: WS heartbeat — manager actively pings agents, lastSeen updated on pong
    this.heartbeatIntervalMs = safeInt(process.env.AGENT_HEARTBEAT_INTERVAL_MS, 15_000);
    this._heartbeatTimer = null;
  }

  async start() {
    if (this.started) return;
    this.started = true;

    this.wss = new WebSocketServer({
      host: this.host,
      port: this.port,
      // Avoid memory bombs from large frames; our protocol payloads are small.
      maxPayload: Math.max(16 * 1024, Math.trunc(Number(process.env.AGENT_CONTROL_MAX_PAYLOAD || 262_144))),
      perMessageDeflate: false
    });
    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
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

    if (this.sessionIdleSweepMs > 0) {
      this._idleSweepTimer = setInterval(() => {
        this.releaseIdleSessions().catch(err => {
          logger.error("[AgentManager] Idle session sweep failed", { error: err?.message ?? err });
        });
      }, this.sessionIdleSweepMs);
      this._idleSweepTimer.unref?.();
    }

    // A2: Start WS-level heartbeat — send ping frames to all connected agents
    if (this.heartbeatIntervalMs > 0) {
      this._heartbeatTimer = setInterval(() => this._sendHeartbeats(), this.heartbeatIntervalMs);
      this._heartbeatTimer.unref?.();
    }
  }

  stop() {
    try {
      if (this._pruneTimer) clearInterval(this._pruneTimer);
      if (this._reconcileTimer) clearInterval(this._reconcileTimer);
      if (this._idleSweepTimer) clearInterval(this._idleSweepTimer);
      if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
      this._pruneTimer = null;
      this._reconcileTimer = null;
      this._idleSweepTimer = null;
      this._heartbeatTimer = null;
      this.wss?.close?.();
    } catch {}
  }

  handleConnection(ws, req) {
    // Enforce a fast handshake to avoid idle connection buildup.
    const handshakeMs = Math.max(1000, Math.trunc(Number(process.env.AGENT_CONTROL_HANDSHAKE_MS || 8000)));
    ws.__remoteAddress = req?.socket?.remoteAddress || null;
    ws.__helloTimer = setTimeout(() => {
      if (!ws.__agentId) {
        logger.warn({ remoteAddress: ws._socket?.remoteAddress }, "Agent WS connected but no hello received within timeout — closing connection");
        try { ws.close(1008, "hello-required"); } catch {}
      }
    }, handshakeMs);
    ws.__helloTimer.unref?.();

    // When an agent connects, it will send a "hello" message containing its agentId
    ws.on("message", data => this.handleMessage(ws, data));
    // A2: Update lastSeen when agent responds to a WS-level ping frame
    ws.on("pong", () => {
      const agent = ws.__agentId ? this.liveAgents.get(ws.__agentId) : null;
      if (agent) {
        agent.lastSeen = now();
        if (agent._pingTs) {
          const rtt = now() - agent._pingTs;
          agent.rttMs = agent.rttMs == null ? rtt : Math.round(agent.rttMs * 0.8 + rtt * 0.2);
          agent._pingTs = null;
        }
      }
    });
    ws.on("close", () => {
      if (ws.__helloTimer) {
        try { clearTimeout(ws.__helloTimer); } catch {}
        ws.__helloTimer = null;
      }
      // Make async cleanup non-blocking
      this.handleClose(ws).catch(err => {
        logger.error(`[AgentManager] Error in handleClose: ${err?.message}`);
      });
    });
    ws.on("error", (err) => {
      logger.error(`[AgentManager] Agent WS error:`, { error: err?.message ?? err });
    });
  }

  async handleClose(ws) {
    const agentId = ws.__agentId;
    if (!agentId) return; // Unknown connection

    logger.info('Agent WebSocket closed', { agentId });
    trackAgentDisconnect('unknown'); // We don't have close code here
    await this._cleanupAgentOnDisconnect(agentId);
  }

  handleMessage(ws, data) {
    let msg;
    try {
      logger.debug({ raw: String(data) }, '[AgentManager:RAW]');
      msg = JSON.parse(String(data));
    } catch {
      logger.warn('[AgentManager] Invalid JSON received from agent');
      return;
    }
    
    logger.debug({ type: msg?.type, agentId: msg?.agentId || ws.__agentId }, '[AgentManager] Message received');

    if (msg?.type === "hello") return void this.handleHello(ws, msg);
    if (msg?.type === "guilds") return void this.handleGuilds(ws, msg);
    if (msg?.type === "event") return void this.handleEvent(ws, msg);
    if (msg?.type === "resp") return void this.handleResponse(ws, msg);
  }

  handleHello(ws, msg) { // Now directly from an agent
    const agentId = String(msg?.agentId ?? "").trim();
    if (!agentId) return;

    const agentLogger = createAgentScopedLogger(agentId);
    agentLogger.info('Agent handshake received', {
      protocolVersion: msg?.protocolVersion,
      ready: msg?.ready,
      guildCount: msg?.guildIds?.length || 0
    });

    // Validate protocol version
    const agentVersion = msg?.protocolVersion || msg?.protocol_version || msg?.protocolversion || msg?.version || null;
    if (!agentVersion) {
      agentLogger.warn('Agent missing protocol version, rejecting');
      trackAgentRegistration('rejected');
      ws.send(JSON.stringify({
        type: "error",
        error: "Protocol version required. Please upgrade agent."
      }));
      ws.close(1008, "Missing protocol version");
      return;
    }

    if (!SUPPORTED_VERSIONS.has(agentVersion)) {
      agentLogger.warn('Agent has incompatible protocol version', {
        agentVersion,
        expectedVersion: PROTOCOL_VERSION
      });
      trackAgentRegistration('rejected');
      ws.send(JSON.stringify({
        type: "error",
        error: `Incompatible protocol version ${agentVersion}. Controller expects ${PROTOCOL_VERSION}.`
      }));
      ws.close(1008, "Incompatible protocol version");
      return;
    }

    // Optional control-plane authentication between controller and runners.
    // If AGENT_RUNNER_SECRET is set on the controller, the agent MUST present it in hello.
    if (this.runnerSecret) {
      const presented = String(msg?.runnerSecret || "").trim();
      if (!presented || presented !== this.runnerSecret) {
        agentLogger.warn("Agent presented invalid runner secret, rejecting", {
          remoteAddress: ws.__remoteAddress || undefined
        });
        trackAgentRegistration("rejected");
        try {
          ws.send(JSON.stringify({ type: "error", error: "Unauthorized runner secret." }));
        } catch {}
        ws.close(1008, "Unauthorized");
        return;
      }
    }

    // Attach agentId to WebSocket for future messages
    ws.__agentId = agentId;
    if (ws.__helloTimer) {
      try { clearTimeout(ws.__helloTimer); } catch {}
      ws.__helloTimer = null;
    }

    let agent = this.liveAgents.get(agentId);
    const isReconnect = !!agent;
    
    if (!agent) {
      agentLogger.info('Registering new agent');
      trackAgentRegistration('success');
      agent = {
        agentId,
        ws,
        protocolVersion: agentVersion,
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
        tag: msg?.tag ?? null,
        // A2: Per-agent health metrics
        rttMs: null,         // Exponential moving average of WS ping RTT
        _pingTs: null,       // Timestamp of last outbound ping frame
        errorCount: 0,       // Cumulative request errors
        requestCount: 0,     // Cumulative requests sent
        errorWindow: [],     // Rolling 60s error timestamps
      };
      this.liveAgents.set(agentId, agent);
    } else {
      agentLogger.info('Agent reconnecting');
      trackAgentRestart();
      // If agent reconnected, update its WebSocket
      if (agent.ws !== ws) {
        // Optionally terminate old WS if it's still alive to ensure clean state
        try { agent.ws.terminate(); } catch {}
        agent.ws = ws;
      }
      // Update protocol version in case agent upgraded
      agent.protocolVersion = agentVersion;
    }

    // Update common runtime properties
    agent.ready = Boolean(msg?.ready);
    agent.guildIds = new Set(Array.isArray(msg?.guildIds) ? msg.guildIds : []);
    agent.botUserId = msg?.botUserId ?? agent.botUserId;
    agent.tag = msg?.tag ?? agent.tag;
    agent.runnerId = String(msg?.runnerId || agent.runnerId || "").trim() || null;
    agent.poolId = String(msg?.poolId || agent.poolId || "").trim() || null;
    agent.startedAt = agent.startedAt ?? now();
    agent.lastSeen = now();
    
    // Update metrics
    this._updateMetrics();
  }

  handleGuilds(ws, msg) { // Now directly from an agent
    const agentId = ws.__agentId;
    if (!agentId) return;

    const agent = this.liveAgents.get(agentId);
    if (!agent) return;

    const oldGuildIds = agent.guildIds ? Array.from(agent.guildIds) : [];
    const newGuildIds = Array.isArray(msg?.guildIds) ? msg.guildIds : [];
    
    agent.guildIds = new Set(newGuildIds);
    agent.lastSeen = now();
    
    // Log changes for debugging
    const added = newGuildIds.filter(g => !oldGuildIds.includes(g));
    const removed = oldGuildIds.filter(g => !newGuildIds.includes(g));
    
    if (added.length > 0) {
      logger.debug({ agentId, added }, '[GUILDS_UPDATE] Agent joined guilds');
    }
    if (removed.length > 0) {
      logger.debug({ agentId, removed }, '[GUILDS_UPDATE] Agent left guilds');
    }
    
    if (added.length === 0 && removed.length === 0 && newGuildIds.length > 0) {
      logger.debug({ agentId, guildCount: newGuildIds.length }, '[GUILDS_UPDATE] Agent guild list unchanged');
    }
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
        // A2/A3: Health metrics
        rttMs: liveAgent?.rttMs ?? null,
        requestCount: liveAgent?.requestCount ?? 0,
        errorCount: liveAgent?.errorCount ?? 0,
        healthScore: liveAgent ? this._agentHealthScore(liveAgent) : null,

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

  async getDeployDiagnostics(guildId, poolId = null) {
    const registeredAgents = await fetchAgentBots();
    const diagnostics = {
      scopedTotal: 0,
      activeTotal: 0,
      inactiveTotal: 0,
      missingToken: 0,
      missingClientId: 0,
      alreadyInGuild: 0,
      invitable: 0,
      invitableConnected: 0,
      invitableOffline: 0
    };
    const out = [];
    for (const regAgent of registeredAgents) {
      if (!regAgent) continue;

      // Filter by pool if specified
      if (poolId && regAgent.pool_id !== poolId) continue;
      diagnostics.scopedTotal += 1;

      if (!regAgent?.client_id) {
        diagnostics.missingClientId += 1;
        continue; // Must have a client ID to be invitable
      }
      if (regAgent.status !== 'active') {
        diagnostics.inactiveTotal += 1;
        continue; // Only consider active registered agents
      }
      // Check if token is decryptable (fetch separately to avoid token in memory unless needed)
      const tokenCheck = await fetchAgentToken(regAgent.agent_id);
      if (!tokenCheck) {
        // Key rotation or corrupt record: identity exists but cannot be started by a runner.
        diagnostics.missingToken += 1;
        diagnostics.inactiveTotal += 1;
        continue;
      }
      diagnostics.activeTotal += 1;

      const liveAgent = this.liveAgents.get(regAgent.agent_id);
      if (liveAgent) {
        // If agent is live, check its current guild status
        if (liveAgent.guildIds?.has?.(guildId)) {
          diagnostics.alreadyInGuild += 1;
          continue; // Already in guild
        }
        diagnostics.invitableConnected += 1;
      } else {
        // If agent is not live, we assume it's not in the guild for now.
        // If we want to be more precise, we'd need to query Discord API for non-live agents, which is out of scope for this.
        diagnostics.invitableOffline += 1;
      }
      out.push({
        agentId: regAgent.agent_id,
        botUserId: regAgent.client_id,
        tag: regAgent.tag
      });
    }
    diagnostics.invitable = out.length;
    out.sort((a, b) => String(a.agentId).localeCompare(String(b.agentId)));
    return { diagnostics, invitableAgents: out };
  }

  async listInvitableAgentsForGuild(guildId, poolId = null) {
    const { invitableAgents } = await this.getDeployDiagnostics(guildId, poolId);
    return invitableAgents;
  }

  buildInviteForAgent(agent) {
    if (!agent?.botUserId) return null;
    return buildInviteUrl({ clientId: agent.botUserId, permissions: this.invitePerms });
  }

  async buildDeployPlan(guildId, desiredCount, poolId = null) {
    const desired = Math.max(0, Number(desiredCount || 0) || 0);

    // Enforce 49-agent per guild limit (Level 1: Invariants Locked)
    if (desired > MAX_AGENTS_PER_GUILD) {
      return {
        guildId,
        desired,
        presentCount: 0,
        invitableCount: 0,
        needInvites: 0,
        invites: [],
        error: `Agent limit exceeded. Maximum ${MAX_AGENTS_PER_GUILD} agents per guild.`
      };
    }

    const present = [];
    for (const agent of this.liveAgents.values()) { // Iterate liveAgents
      if (agent.guildIds?.has?.(guildId)) present.push(agent);
    }

    const { diagnostics, invitableAgents: invitable } = await this.getDeployDiagnostics(guildId, poolId);

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
      invites,
      diagnostics,
      poolId
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
        
        logger.debug('Session released', { agentId, guildId, voiceChannelId });
        trackSessionRelease('music');
      }
    }
    this.sessions.delete(key);
    this._updateMetrics();
  }

  async ensureSessionAgent(guildId, voiceChannelId, { textChannelId, ownerUserId } = {}) {
    const startTime = Date.now();
    const sessionLogger = logger.child({ guildId, voiceChannelId });
    
    // 1. Check for existing active session agent
    const existing = this.getSessionAgent(guildId, voiceChannelId);
    if (existing.ok) {
      sessionLogger.debug('Using existing session agent', { agentId: existing.agent.agentId });
      return existing;
    }

    // 2. Check for preferred agent (must be active)
    const preferred = this.getPreferredAgent(guildId, voiceChannelId);
    if (preferred && !preferred.busyKey) {
      this.bindAgentToSession(preferred, { guildId, voiceChannelId, textChannelId, ownerUserId });
      const duration = Date.now() - startTime;
      sessionLogger.info('Session allocated to preferred agent', {
        agentId: preferred.agentId,
        durationMs: duration
      });
      trackSessionAllocation('music', 'success', duration);
      this._updateMetrics();
      return { ok: true, agent: preferred };
    }

    // 3. Find an idle agent already in the guild
    const idleAgentInGuild = this.findIdleAgentInGuildRoundRobin(guildId);
    if (idleAgentInGuild) {
      this.bindAgentToSession(idleAgentInGuild, { guildId, voiceChannelId, textChannelId, ownerUserId });
      const duration = Date.now() - startTime;
      sessionLogger.info('Session allocated to idle agent', {
        agentId: idleAgentInGuild.agentId,
        durationMs: duration
      });
      trackSessionAllocation('music', 'success', duration);
      this._updateMetrics();
      return { ok: true, agent: idleAgentInGuild };
    }

    // 4. No idle agents in guild - check if we have any agents at all
    const present = this.countPresentInGuild(guildId);
    if (present === 0) {
      sessionLogger.warn('No agents in guild');
      trackSessionAllocation('music', 'no_agents');
      return { ok: false, reason: "no-agents-in-guild" };
    }
    
    // All agents are busy
    sessionLogger.warn('All agents busy', { present });
    trackSessionAllocation('music', 'no_free_agents');
    return { ok: false, reason: "no-free-agents" };
  }

  // A2: Send WS ping frames to all connected agents
  _sendHeartbeats() {
    const ts = now();
    for (const agent of this.liveAgents.values()) {
      if (!agent.ws || agent.ws.readyState !== 1 /* OPEN */) continue;
      try {
        agent._pingTs = ts;
        agent.ws.ping();
      } catch (err) {
        logger.debug(`[AgentManager] Heartbeat ping failed for ${agent.agentId}: ${err?.message}`);
      }
    }
  }

  // A3: Composite health score for agent selection (higher = healthier, 0–100)
  _agentHealthScore(agent) {
    let score = 100;
    // Penalise by rolling error rate in last 60s
    const cutoff = now() - 60_000;
    const recentErrors = (agent.errorWindow || []).filter(t => t >= cutoff).length;
    if (recentErrors > 0) score -= Math.min(40, recentErrors * 10);
    // Penalise by RTT (>200ms = -10, >500ms = -20, >1000ms = -30)
    if (agent.rttMs != null) {
      if (agent.rttMs > 1000) score -= 30;
      else if (agent.rttMs > 500) score -= 20;
      else if (agent.rttMs > 200) score -= 10;
    }
    // Bonus for idle agents (not holding any sessions)
    if (!agent.busyKey) score += 5;
    return Math.max(0, score);
  }

  listIdleAgentsInGuild(guildId) {
    const out = [];
    for (const agent of this.liveAgents.values()) {
      if (!agent.ready || !agent.ws) continue;
      if (agent.busyKey) continue;
      if (!agent.guildIds.has(guildId)) continue;
      out.push(agent);
    }
    // A3: Sort by health score descending (healthiest first), then by agentId for stability
    out.sort((a, b) => {
      const scoreDiff = this._agentHealthScore(b) - this._agentHealthScore(a);
      return scoreDiff !== 0 ? scoreDiff : String(a.agentId).localeCompare(String(b.agentId));
    });
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

  // ===== leasing (text) =====

  getTextSessionAgent(guildId, textChannelId, { ownerUserId, kind = "text" } = {}) {
    const k = textKey(kind, guildId, textChannelId, ownerUserId);
    const agentId = this.textSessions.get(k);
    if (!agentId) return { ok: false, reason: "no-session" };
    const agent = this.liveAgents.get(agentId);
    if (!agent?.ready || !agent.ws) {
      this.textSessions.delete(k);
      return { ok: false, reason: "agent-offline" };
    }
    return { ok: true, agent, key: k };
  }

  bindAgentToTextSession(agent, { guildId, textChannelId, ownerUserId, kind = "text" } = {}) {
    const k = textKey(kind, guildId, textChannelId, ownerUserId);
    this.textSessions.set(k, agent.agentId);

    agent.busyKey = k;
    agent.busyKind = String(kind || "text");
    agent.guildId = guildId;
    agent.voiceChannelId = null;
    agent.textChannelId = textChannelId ?? null;
    agent.ownerUserId = ownerUserId ?? null;
    agent.lastActive = now();
    return k;
  }

  releaseTextSession(guildId, textChannelId, { ownerUserId, kind = "text" } = {}) {
    const k = textKey(kind, guildId, textChannelId, ownerUserId);
    const agentId = this.textSessions.get(k);
    if (agentId) {
      const agent = this.liveAgents.get(agentId);
      if (agent && agent.busyKey === k) {
        agent.busyKey = null;
        agent.busyKind = null;
        agent.guildId = null;
        agent.voiceChannelId = null;
        agent.textChannelId = null;
        agent.ownerUserId = null;
      }
    }
    this.textSessions.delete(k);
    this._updateMetrics();
  }

  async ensureTextSessionAgent(guildId, textChannelId, { ownerUserId, kind = "text" } = {}) {
    const existing = this.getTextSessionAgent(guildId, textChannelId, { ownerUserId, kind });
    if (existing.ok) return existing;

    const idleAgentInGuild = this.findIdleAgentInGuildRoundRobin(guildId);
    if (idleAgentInGuild) {
      const k = this.bindAgentToTextSession(idleAgentInGuild, { guildId, textChannelId, ownerUserId, kind });
      this._updateMetrics();
      return { ok: true, agent: idleAgentInGuild, key: k };
    }

    const present = this.countPresentInGuild(guildId);
    if (present === 0) return { ok: false, reason: "no-agents-in-guild" };
    return { ok: false, reason: "no-free-agents" };
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
        trackSessionRelease('assistant');
      }
    }
    this.assistantSessions.delete(key);
    this._updateMetrics();
  }

  async ensureAssistantAgent(guildId, voiceChannelId, { textChannelId, ownerUserId } = {}) {
    const startTime = Date.now();

    // 1. Check for existing active assistant session agent
    const existing = this.getAssistantSessionAgent(guildId, voiceChannelId);
    if (existing.ok) return existing;

    // 2. Check for preferred assistant agent (must be active)
    const preferred = this.getPreferredAssistant(guildId, voiceChannelId);
    if (preferred && !preferred.busyKey) {
      this.bindAgentToAssistant(preferred, { guildId, voiceChannelId, textChannelId, ownerUserId });
      trackSessionAllocation('assistant', 'success', Date.now() - startTime);
      this._updateMetrics();
      return { ok: true, agent: preferred };
    }

    // 3. Find an idle agent already in the guild
    const idleAgentInGuild = this.findIdleAgentInGuildRoundRobin(guildId);
    if (idleAgentInGuild) {
      this.bindAgentToAssistant(idleAgentInGuild, { guildId, voiceChannelId, textChannelId, ownerUserId });
      trackSessionAllocation('assistant', 'success', Date.now() - startTime);
      this._updateMetrics();
      return { ok: true, agent: idleAgentInGuild };
    }

    // 4. No idle agents in guild - check if we have any agents at all
    const present = this.countPresentInGuild(guildId);
    if (present === 0) {
      trackSessionAllocation('assistant', 'no_agents');
      return { ok: false, reason: "no-agents-in-guild" };
    }
    
    // All agents are busy
    trackSessionAllocation('assistant', 'no_free_agents');
    return { ok: false, reason: "no-free-agents" };
  }

  // ===== idle auto-release =====

  getDefaultIdleReleaseMs() {
    return this._normalizeIdleReleaseMs(this.sessionIdleReleaseMs, 1_800_000);
  }

  _normalizeIdleReleaseMs(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (n <= 0) return 0;
    return Math.max(60_000, Math.trunc(n));
  }

  clearGuildIdleReleaseCache(guildId = null) {
    if (guildId == null) {
      this._guildIdleReleaseCache.clear();
      return;
    }
    this._guildIdleReleaseCache.delete(String(guildId));
  }

  async getGuildIdleReleaseMs(guildId) {
    const gid = String(guildId || "").trim();
    if (!gid) return this.getDefaultIdleReleaseMs();

    const cached = this._guildIdleReleaseCache.get(gid);
    const nowTs = now();
    if (cached && cached.expiresAt > nowTs) return cached.value;

    let resolved = this.getDefaultIdleReleaseMs();
    try {
      const data = await loadGuildData(gid);
      const customMs = data?.agents?.idleReleaseMs;
      if (customMs !== undefined && customMs !== null) {
        resolved = this._normalizeIdleReleaseMs(customMs, resolved);
      }
    } catch (error) {
      logger.warn("[AgentManager] Failed to load guild idle config; using default", {
        guildId: gid,
        error: error?.message ?? error
      });
    }

    const ttlMs = Math.max(5_000, this.guildIdleConfigCacheMs);
    this._guildIdleReleaseCache.set(gid, { value: resolved, expiresAt: nowTs + ttlMs });
    return resolved;
  }

  async releaseIdleSessions() {
    if (this._idleSweepRunning) return;

    this._idleSweepRunning = true;
    const sweepStartedAt = now();
    let releasedMusic = 0;
    let releasedAssistant = 0;
    let releasedText = 0;

    try {
      await this._refreshAgentDeployerCache();
      const idleByGuild = new Map();
      const getIdleForGuild = async guildId => {
        const gid = String(guildId || "").trim();
        if (!gid) return 0;
        if (!idleByGuild.has(gid)) {
          idleByGuild.set(gid, await this.getGuildIdleReleaseMs(gid));
        }
        return idleByGuild.get(gid);
      };

      for (const [key, agentId] of Array.from(this.sessions.entries())) {
        const [guildId, voiceChannelId] = String(key).split(":");
        if (!guildId || !voiceChannelId) continue;

        const agent = this.liveAgents.get(agentId);
        if (!agent || agent.busyKey !== key || agent.busyKind !== "music") {
          this.releaseSession(guildId, voiceChannelId);
          continue;
        }

        const guildIdleMs = await getIdleForGuild(guildId);
        if (guildIdleMs <= 0) continue;

        const idleMs = this._computeIdleMs(agent.lastActive);
        if (idleMs === null || idleMs < guildIdleMs) continue;

        const humans = await this._getHumanCountInVoice(guildId, voiceChannelId);
        if (humans === null) continue;
        if (humans > 0) continue;

        const notifyAgent = {
          agentId: agent.agentId,
          ownerUserId: agent.ownerUserId ?? null,
          textChannelId: agent.textChannelId ?? null
        };
        await this._releaseRemoteAgentSession(agent, "music", { guildId, voiceChannelId });
        await this._notifyIdleRelease({
          kind: "music",
          agent: notifyAgent,
          guildId,
          voiceChannelId,
          idleMs,
          reason: "idle-timeout"
        });
        this.releaseSession(guildId, voiceChannelId);
        releasedMusic++;
      }

      for (const [key, agentId] of Array.from(this.assistantSessions.entries())) {
        const parts = String(key).split(":");
        const guildId = parts[1];
        const voiceChannelId = parts[2];
        if (!guildId || !voiceChannelId) continue;

        const agent = this.liveAgents.get(agentId);
        if (!agent || agent.busyKey !== key || agent.busyKind !== "assistant") {
          this.releaseAssistantSession(guildId, voiceChannelId);
          continue;
        }

        const guildIdleMs = await getIdleForGuild(guildId);
        if (guildIdleMs <= 0) continue;

        const idleMs = this._computeIdleMs(agent.lastActive);
        if (idleMs === null || idleMs < guildIdleMs) continue;

        const humans = await this._getHumanCountInVoice(guildId, voiceChannelId);
        if (humans === null) continue;
        if (humans > 0) continue;

        const notifyAgent = {
          agentId: agent.agentId,
          ownerUserId: agent.ownerUserId ?? null,
          textChannelId: agent.textChannelId ?? null
        };
        await this._releaseRemoteAgentSession(agent, "assistant", { guildId, voiceChannelId });
        await this._notifyIdleRelease({
          kind: "assistant",
          agent: notifyAgent,
          guildId,
          voiceChannelId,
          idleMs,
          reason: "idle-timeout"
        });
        this.releaseAssistantSession(guildId, voiceChannelId);
        releasedAssistant++;
      }

      // Text sessions: release purely on idle time (no voice-member check).
      const textIdleMsDefault = this._normalizeIdleReleaseMs(this.textSessionIdleReleaseMs, 0);
      if (textIdleMsDefault > 0) {
        for (const [key, agentId] of Array.from(this.textSessions.entries())) {
          const parts = String(key).split(":");
          const kind = parts[1] || "text";
          const guildId = parts[2];
          const textChannelId = parts[3];
          const ownerUserId = parts[4] && parts[4] !== "0" ? parts[4] : null;
          if (!guildId || !textChannelId) {
            this.textSessions.delete(key);
            continue;
          }

          const agent = this.liveAgents.get(agentId);
          if (!agent || agent.busyKey !== key || String(agent.busyKind || "") !== String(kind)) {
            this.textSessions.delete(key);
            continue;
          }

          const idleMs = this._computeIdleMs(agent.lastActive);
          if (idleMs === null || idleMs < textIdleMsDefault) continue;

          const notifyAgent = {
            agentId: agent.agentId,
            ownerUserId: agent.ownerUserId ?? null,
            textChannelId: agent.textChannelId ?? null
          };
          await this._notifyIdleRelease({
            kind: String(kind || "text"),
            agent: notifyAgent,
            guildId,
            voiceChannelId: null,
            idleMs,
            reason: "idle-timeout"
          });
          this.releaseTextSession(guildId, textChannelId, { ownerUserId, kind });
          releasedText++;
        }
      }
    } catch (error) {
      logger.error("[AgentManager] Idle release sweep failed", {
        error: error?.message ?? error
      });
    } finally {
      this._idleSweepRunning = false;
      const releasedTotal = releasedMusic + releasedAssistant + releasedText;
      if (releasedTotal > 0) {
        logger.info("[AgentManager] Idle sweep released sessions", {
          releasedMusic,
          releasedAssistant,
          releasedText,
          releasedTotal,
          sweepDurationMs: now() - sweepStartedAt
        });
      }
    }
  }

  _computeIdleMs(lastActiveAt) {
    const ts = Number(lastActiveAt);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    return Math.max(0, now() - ts);
  }

  async _getHumanCountInVoice(guildId, voiceChannelId) {
    const client = global.client;
    if (!client) return null;

    try {
      const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return 0;

      const channel = guild.channels.cache.get(voiceChannelId) ?? await guild.channels.fetch(voiceChannelId).catch(() => null);
      if (!channel?.members) return 0;

      let humans = 0;
      for (const member of channel.members.values()) {
        if (!member?.user?.bot) humans += 1;
      }
      return humans;
    } catch (error) {
      logger.warn("[AgentManager] Failed to inspect voice channel for idle release", {
        guildId,
        voiceChannelId,
        error: error?.message ?? error
      });
      return null;
    }
  }

  _buildReleasePayload(agent, { guildId, voiceChannelId }) {
    const payload = {
      guildId,
      voiceChannelId,
      textChannelId: agent?.textChannelId ?? null,
      ownerUserId: agent?.ownerUserId ?? null
    };

    if (this.adminOverrideToken) {
      payload.adminToken = this.adminOverrideToken;
      payload.adminUserId = "idle-watchdog";
    } else if (agent?.ownerUserId) {
      payload.actorUserId = agent.ownerUserId;
    }

    return payload;
  }

  async _releaseRemoteAgentSession(agent, kind, { guildId, voiceChannelId }) {
    if (!agent?.ready || !agent?.ws) return;

    const op = kind === "assistant" ? "assistantLeave" : "stop";
    const payload = this._buildReleasePayload(agent, { guildId, voiceChannelId });

    try {
      await this.request(agent, op, payload, 12_000);
    } catch (error) {
      const msg = String(error?.message ?? error);
      if (msg === "no-session" || msg === "agent-offline") return;
      logger.warn("[AgentManager] Failed to release idle agent session remotely", {
        op,
        kind,
        agentId: agent.agentId,
        guildId,
        voiceChannelId,
        error: msg
      });
    }
  }

  async _refreshAgentDeployerCache(force = false) {
    const ttlMs = 5 * 60_000;
    if (!force && this._agentDeployerCacheAt > 0 && (now() - this._agentDeployerCacheAt) < ttlMs) {
      return;
    }

    try {
      const bots = await fetchAgentBots();
      const poolIds = Array.from(new Set(
        bots
          .map(b => String(b?.pool_id ?? "").trim())
          .filter(Boolean)
      ));

      const poolOwners = new Map();
      await Promise.all(poolIds.map(async poolId => {
        const pool = await fetchPool(poolId).catch(() => null);
        const owner = String(pool?.owner_user_id ?? "").trim();
        if (owner) poolOwners.set(poolId, owner);
      }));

      const next = new Map();
      for (const bot of bots) {
        const agentId = String(bot?.agent_id ?? "").trim();
        if (!agentId) continue;
        const poolId = String(bot?.pool_id ?? "").trim();
        const owner = poolOwners.get(poolId);
        if (owner) next.set(agentId, owner);
      }

      this._agentDeployerCache = next;
      this._agentDeployerCacheAt = now();
    } catch (error) {
      logger.warn("[AgentManager] Failed refreshing deployer cache", {
        error: error?.message ?? error
      });
    }
  }

  async _notifyIdleRelease({ kind, agent, guildId, voiceChannelId, idleMs, reason }) {
    const client = global.client;
    if (!client || !agent?.agentId) return;

    const recipients = new Set();
    if (agent.ownerUserId) recipients.add(String(agent.ownerUserId));
    const deployerUserId = this._agentDeployerCache.get(String(agent.agentId));
    if (deployerUserId) recipients.add(String(deployerUserId));

    const idleMinutes = Math.max(1, Math.round(Number(idleMs || 0) / 60_000));
    const title =
      kind === "assistant" ? "Assistant session released"
      : kind === "music" ? "Music session released"
      : "Agent session released";

    const lines = [
      `Agent \`${agent.agentId}\` was auto-released after ${idleMinutes}m of inactivity.`,
      `Kind: \`${kind || "unknown"}\``,
      `Guild: \`${guildId}\``,
      voiceChannelId ? `Voice channel: \`${voiceChannelId}\`` : null,
      agent.textChannelId ? `Text channel: \`${agent.textChannelId}\`` : null,
      `Reason: \`${reason || "idle-timeout"}\``
    ].filter(Boolean);

    const body = lines.join("\n");

    for (const userId of recipients) {
      try {
        const user = await client.users.fetch(userId).catch(() => null);
        if (!user) continue;
        await user.send(`⚠️ ${title}\n${body}`);
      } catch (error) {
        logger.warn("[AgentManager] Failed DM for idle release", {
          userId,
          agentId: agent.agentId,
          error: error?.message ?? error
        });
      }
    }

    if (agent.textChannelId) {
      try {
        const channel = await client.channels.fetch(agent.textChannelId).catch(() => null);
        if (channel?.isTextBased?.()) {
          await channel.send({
            content: `⚠️ ${title}\n${body}`
          });
        }
      } catch (error) {
        logger.warn("[AgentManager] Failed channel notify for idle release", {
          channelId: agent.textChannelId,
          agentId: agent.agentId,
          error: error?.message ?? error
        });
      }
    }
  }

  // ===== health =====

  async _cleanupAgentOnDisconnect(agentId) {
    const agent = this.liveAgents.get(agentId);
    if (!agent) return;

    const affectedSessions = [];
    
    // Release music sessions held by this agent
    for (const [k, aId] of this.sessions.entries()) {
      if (aId === agentId) {
        affectedSessions.push(k);
        this.sessions.delete(k);
      }
    }
    
    // Release assistant sessions held by this agent
    for (const [k, aId] of this.assistantSessions.entries()) {
      if (aId === agentId) this.assistantSessions.delete(k);
    }

    // Release text sessions held by this agent
    for (const [k, aId] of this.textSessions.entries()) {
      if (aId === agentId) this.textSessions.delete(k);
    }

    this.liveAgents.delete(agentId);
    logger.info(`[AgentManager] Cleaned up disconnected agent ${agentId}. Affected sessions: ${affectedSessions.length}`);
    
    // Notify users in affected voice channels
    if (affectedSessions.length > 0 && global.client) {
      for (const sessionKey of affectedSessions) {
        const [guildId, voiceChannelId] = sessionKey.split(':');
        
        try {
          const guild = await global.client.guilds.fetch(guildId).catch(() => null);
          if (!guild) continue;
          
          const voiceChannel = await guild.channels.fetch(voiceChannelId).catch(() => null);
          if (!voiceChannel) continue;
          
          // Try to find an associated text channel
          let textChannel = null;
          if (voiceChannel.parent) {
            // Look for a text channel in the same category
            const channels = voiceChannel.parent.children.cache;
            textChannel = channels.find(c => c.isTextBased() && c.permissionsFor(guild.members.me).has('SendMessages'));
          }
          
          if (!textChannel) {
            // Fall back to system channel or first available text channel
            textChannel = guild.systemChannel || 
                         guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(guild.members.me).has('SendMessages'));
          }
          
          if (textChannel) {
            await textChannel.send({
              content: `⚠️ **Music agent disconnected** from ${voiceChannel.name}\n💡 Music playback has stopped. Use \`/music play\` to resume.`
            }).catch(err => {
              logger.warn(`[AgentManager] Failed to notify channel about agent disconnect: ${err?.message}`);
            });
          }
        } catch (err) {
          logger.warn(`[AgentManager] Error notifying session ${sessionKey}: ${err?.message}`);
        }
      }
    }
  }

  // Update metrics gauges (Level 2: Observability)
  _updateMetrics() {
    const agents = Array.from(this.liveAgents.values());
    const connected = agents.length;
    const ready = agents.filter(a => a.ready && !a.busyKey).length;
    
    const busyMusic = agents.filter(a => a.busyKey && a.busyKind === 'music').length;
    const busyAssistant = agents.filter(a => a.busyKey && a.busyKind === 'assistant').length;
    
    const musicSessions = this.sessions.size;
    const assistantSessions = this.assistantSessions.size;

    const nowTs = now();
    const uptimes = agents
      .map(a => Number(a.startedAt))
      .filter(ts => Number.isFinite(ts) && ts > 0)
      .map(ts => Math.max(0, (nowTs - ts) / 1000));

    let uptimeMin = 0;
    let uptimeMax = 0;
    let uptimeAvg = 0;
    if (uptimes.length > 0) {
      uptimeMin = Math.min(...uptimes);
      uptimeMax = Math.max(...uptimes);
      uptimeAvg = uptimes.reduce((sum, cur) => sum + cur, 0) / uptimes.length;
    }
    
    updateAgentGauges(connected, ready, { music: busyMusic, assistant: busyAssistant });
    updateAgentUptimeMetrics({ min: uptimeMin, max: uptimeMax, avg: uptimeAvg });
    updatePoolUtilization({ connected, busyMusic, busyAssistant });
    updateSessionGauges({ music: musicSessions, assistant: assistantSessions });
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
    // Primary bot session — handles operations locally without WebSocket
    if (agent?.isPrimary && typeof agent.handleRequest === "function") {
      return agent.handleRequest(op, data);
    }

    if (!agent?.ws || !agent?.ready) throw new Error("agent-offline");

    return await this.circuitBreaker.fire(agent, op, data, timeoutMs);
  }

  async _performRequest(agent, op, data, timeoutMs) {
    const id = randomUUID();
    const payload = { type: "req", id, op, data, agentId: agent.agentId };
    agent.lastActive = now();
    // A2: track request count and start time for latency measurement
    agent.requestCount = (agent.requestCount || 0) + 1;
    const reqStartTs = now();

    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        // A2: Record timeout as an error in rolling window
        agent.errorCount = (agent.errorCount || 0) + 1;
        if (!agent.errorWindow) agent.errorWindow = [];
        agent.errorWindow.push(now());
        // Trim window older than 60s
        const cutoff = now() - 60_000;
        agent.errorWindow = agent.errorWindow.filter(t => t >= cutoff);
        reject(new Error("agent-timeout"));
      }, timeoutMs);

      this.pending.set(id, {
        resolve,
        reject,
        timeout,
      });
    });

    try {
      agent.ws.send(JSON.stringify(payload));
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
  }

  createPrimaryBotSession(guildId, voiceChannelId, textChannelId, ownerUserId) {
    return createPrimarySession(guildId, voiceChannelId, textChannelId, ownerUserId);
  }

  getPrimaryBotSession(guildId) {
    return getPrimarySession(guildId);
  }
}

// Enhanced logging for debugging
const originalRequest = AgentManager.prototype.request;
AgentManager.prototype.request = function(agent, op, data, timeoutMs) {
  logger.debug({ op, agentId: agent?.agentId ?? "unknown" }, '[AgentManager] RPC request');
  return originalRequest.call(this, agent, op, data, timeoutMs).catch(err => {
    logger.error({ op, err }, '[AgentManager] RPC failed');
    throw err;
  });
};
