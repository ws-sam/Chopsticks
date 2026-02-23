import "dotenv/config";
import express from "express";
import session from "express-session";
import { createClient } from "redis";
import { RedisStore } from "connect-redis";
import { request } from "undici";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getMusicConfig, setDefaultMusicMode, setDefaultMusicVolume } from "../music/config.js";
import { getAssistantConfig, setAssistantConfig } from "../assistant/config.js";
import { countAssistantSessionsInGuild } from "../assistant/service.js";
import { getStatus as getVoiceStatus, updateLobby, addLobby, removeLobby, setLobbyEnabled } from "../tools/voice/domain.js";
import { checkRateLimit } from "../utils/ratelimit.js";
import { auditLog, getAuditLog } from "../utils/audit.js";
import { getCommandStats, getCommandStatsForGuild } from "../utils/healthServer.js";
import { getPersistedCommandStats, getPersistedCommandStatsDaily } from "../utils/audit.js";
import { getDashboardPerms, setDashboardPerms } from "./permissions.js";
import { setCommandEnabled, listCommandSettings } from "../utils/permissions.js";
import {
  getUserPets,
  createPet,
  deletePet,
  listPools,
  fetchPoolsByOwner,
  createPool,
  loadGuildData,
  saveGuildData
} from "../utils/storage.js";
import { applySecurityMiddleware, requireAdmin as modernRequireAdmin, auditLog as modernAudit } from "./securityMiddleware.js";
import { dashboardLogger } from "../utils/modernLogger.js";
import { metricsHandler, healthHandler } from "../utils/metrics.js";
import { getFunCatalog, randomFunFromRuntime, renderFunFromRuntime, resolveVariantId } from "../fun/runtime.js";
import { embedToCardSvg, renderEmbedCardPng } from "../render/svgCard.js";
import Joi from "joi";
import { generateCorrelationId } from "../utils/logger.js";
import { installProcessSafety } from "../utils/processSafety.js";
import { createRequire as _cjsRequire } from "node:module";
const _require = _cjsRequire(import.meta.url);
const jwt = _require("jsonwebtoken");

const app = express();
installProcessSafety("dashboard", dashboardLogger);

// Apply modern security middleware FIRST
applySecurityMiddleware(app);

app.use(express.json({ limit: "200kb" }));
// Serve static assets for the guild console SPA
const __dashboardDir = path.dirname(new URL(import.meta.url).pathname);
app.use("/console-assets", express.static(path.join(__dashboardDir, "public")));
app.use((req, res, next) => {
  const requestId = String(req.headers["x-correlation-id"] || generateCorrelationId());
  const startedAt = Date.now();
  req.requestId = requestId;
  res.setHeader("x-correlation-id", requestId);
  dashboardLogger.info({ requestId, method: req.method, path: req.path }, "dashboard request");
  res.on("finish", () => {
    dashboardLogger.info(
      {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt
      },
      "dashboard response"
    );
  });
  next();
});

// Expose metrics and health endpoints (no auth needed for Prometheus)
app.get("/metrics", metricsHandler);
app.get("/health", healthHandler);

const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT || 8788);
const DASHBOARD_BASE_URL = String(process.env.DASHBOARD_BASE_URL || "").trim();
const DISCORD_CLIENT_ID = String(process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID || "").trim();
const DISCORD_CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || "").trim();
const DISCORD_REDIRECT_URI = String(process.env.DISCORD_REDIRECT_URI || "").trim();
const DISCORD_TOKEN = String(process.env.DISCORD_TOKEN || "").trim();

if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
  console.warn("[dashboard] DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET missing");
}

let sessionSecret = String(process.env.DASHBOARD_SESSION_SECRET || "").trim();
if (!sessionSecret) {
  // Avoid a known default secret. In multi-instance deployments, set DASHBOARD_SESSION_SECRET explicitly.
  sessionSecret = randomBytes(32).toString("hex");
  console.warn(
    "[dashboard] DASHBOARD_SESSION_SECRET missing; generated an ephemeral secret (sessions will reset on restart)."
  );
}
const cookieSecure = String(process.env.DASHBOARD_COOKIE_SECURE || "false").toLowerCase() === "true";
const trustProxyRaw = String(
  process.env.DASHBOARD_TRUST_PROXY || (process.env.NODE_ENV === "production" ? "1" : "false")
).toLowerCase();
if (trustProxyRaw !== "false" && trustProxyRaw !== "0") {
  const n = Number(trustProxyRaw);
  app.set("trust proxy", Number.isFinite(n) ? n : 1);
}

let redisClient = null;
let store = null;
const REDIS_URL = String(process.env.REDIS_URL || "").trim();
if (REDIS_URL) {
  redisClient = createClient({ url: REDIS_URL });
  redisClient.on("error", () => {});
  redisClient.connect().catch(() => {});
  store = new RedisStore({ client: redisClient });
} else {
  console.warn("[dashboard] REDIS_URL not set, using in-memory sessions.");
}

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: store ?? undefined,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure
    }
  })
);

function oauthRedirectUri() {
  if (DISCORD_REDIRECT_URI) return DISCORD_REDIRECT_URI;
  if (!DASHBOARD_BASE_URL) return "";
  return `${DASHBOARD_BASE_URL.replace(/\/$/, "")}/oauth/callback`;
}

function oauthAuthorizeUrl() {
  const redirectUri = oauthRedirectUri();
  if (!redirectUri) return "";

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify guilds"
  });

  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

async function oauthToken(code) {
  const redirectUri = oauthRedirectUri();
  if (!redirectUri) throw new Error("redirect-uri-missing");

  const body = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  });

  const res = await request("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  const json = await res.body.json();
  if (res.statusCode >= 400) throw new Error(json?.error ?? "oauth-failed");
  return json;
}

async function apiGet(url, token) {
  const res = await request(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.statusCode >= 400) return null;
  return res.body.json();
}

function manageGuildPerms(guild) {
  const perms = BigInt(guild?.permissions ?? 0);
  const ADMIN = 0x8n;
  const MANAGE_GUILD = 0x20n;
  return (perms & ADMIN) === ADMIN || (perms & MANAGE_GUILD) === MANAGE_GUILD;
}

function validateInput(schema, data) {
  const { error } = schema.validate(data);
  if (error) {
    throw new Error(`Validation error: ${error.details.map(d => d.message).join(', ')}`);
  }
}

// Validation schemas
const guildIdSchema = Joi.string().pattern(/^[0-9]{5,20}$/);
const agentIdSchema = Joi.string().min(1).max(100);
const petSchema = Joi.object({
  name: Joi.string().min(1).max(50).required(),
  type: Joi.string().valid('cat', 'dog', 'bird', 'fish').required()
});
const musicConfigSchema = Joi.object({
  mode: Joi.string().valid('open', 'dj').required(),
  defaultVolume: Joi.number().integer().min(0).max(150).required()
});
const assistantConfigSchema = Joi.object({
  enabled: Joi.boolean().required(),
  maxListenSec: Joi.number().integer().min(2).max(30).required(),
  silenceMs: Joi.number().integer().min(500).max(5000).required(),
  cooldownSec: Joi.number().integer().min(0).max(120).required(),
  allowRoleIds: Joi.array().items(Joi.string().pattern(/^[0-9]{5,20}$/)),
  allowChannelIds: Joi.array().items(Joi.string().pattern(/^[0-9]{5,20}$/)),
  maxSessions: Joi.number().integer().min(1).max(10).required(),
  voice: Joi.string().optional(),
  voicePresets: Joi.array().items(Joi.string()).optional(),
  channelVoices: Joi.object().pattern(Joi.string(), Joi.string()).optional()
});

function requireAuth(req, res, next) {
  if (!req.session?.accessToken) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  next();
}

function ensureCsrf(req) {
  if (!req.session) return null;
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(16).toString("hex");
  }
  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
  const token = ensureCsrf(req);
  const header = String(req.headers["x-csrf-token"] || "");
  if (!token || token !== header) {
    res.status(403).json({ ok: false, error: "csrf" });
    return;
  }
  next();
}

function agentManagerStatus() {
  const mgr = global.agentManager;
  if (!mgr) return { ok: false, agents: [], sessions: [], assistantSessions: [] };
  return {
    ok: true,
    agents: mgr.listAgents(),
    sessions: mgr.listSessions(),
    assistantSessions: mgr.listAssistantSessions()
  };
}

function isDashboardAdmin(req) {
  const list = String(process.env.DASHBOARD_ADMIN_IDS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
  if (!list.length) return false;
  return list.includes(String(req.session?.userId || ""));
}

async function getMemberRoleIds(guildId, userId) {
  if (!guildId || !userId) return [];
  const member = await botGet(`https://discord.com/api/guilds/${guildId}/members/${userId}`);
  if (!member || !Array.isArray(member.roles)) return [];
  return member.roles.map(String);
}

async function hasDashboardAccess(guildId, userId, canManage) {
  if (canManage) return { ok: true, canManage: true };
  const perms = await getDashboardPerms(guildId);
  const allowUsers = new Set((perms.allowUserIds || []).map(String));
  const allowRoles = new Set((perms.allowRoleIds || []).map(String));
  if (allowUsers.size === 0 && allowRoles.size === 0) return { ok: false, canManage: false };
  if (allowUsers.has(String(userId))) return { ok: true, canManage: false };
  const roles = await getMemberRoleIds(guildId, userId);
  for (const r of roles) if (allowRoles.has(String(r))) return { ok: true, canManage: false };
  return { ok: false, canManage: false };
}

async function sendAgentCommand(agent, op, data) {
  const mgr = global.agentManager;
  if (!mgr) throw new Error("agents-not-ready");
  return mgr.request(agent, op, data);
}

function adminTokenOk(req) {
  const token = String(process.env.DASHBOARD_ADMIN_TOKEN || "").trim();
  if (!token) return false;
  const header = String(req.headers["x-admin-token"] || "");
  return header === token;
}

function requireAdmin(req, res, next) {
  const token = String(process.env.DASHBOARD_ADMIN_TOKEN || "").trim();
  if (!token) {
    res.status(403).json({ ok: false, error: "admin-token-missing" });
    return;
  }
  if (!isDashboardAdmin(req)) {
    res.status(403).json({ ok: false, error: "not-admin" });
    return;
  }
  next();
}

// Allows bot owners OR guild admins who authenticated via /console token.
function requireGuildAdminOrOwner(guildId) {
  return (req, res, next) => {
    const id = guildId || req.params?.id;
    if (isDashboardAdmin(req)) return next();
    if (req.session?.guildAdmin && String(req.session.guildId) === String(id)) return next();
    res.status(403).json({ ok: false, error: "not-authorized-for-guild" });
  };
}

function getJwtSecret() {
  return String(
    process.env.DASHBOARD_SECRET || process.env.DASHBOARD_SESSION_SECRET || ""
  ).trim();
}

function parsePeers() {
  const raw = String(process.env.DASHBOARD_PEERS || "");
  if (!raw.trim()) return [];
  return raw.split(",").map(p => {
    const [name, url] = p.split("|").map(x => x.trim());
    return { name: name || url, url };
  }).filter(p => p.url);
}

function parseVoicePresets() {
  const raw = String(process.env.ASSISTANT_VOICE_PRESETS || "");
  const list = raw.split(",").map(x => x.trim()).filter(Boolean);
  if (!list.length) return ["default"];
  if (!list.includes("default")) list.unshift("default");
  return Array.from(new Set(list));
}

function resolveVoicePresets(assistantCfg) {
  const guildList = Array.isArray(assistantCfg?.voicePresets) ? assistantCfg.voicePresets : [];
  if (guildList.length) {
    const out = guildList.map(String).filter(Boolean);
    if (!out.includes("default")) out.unshift("default");
    return Array.from(new Set(out));
  }
  return parseVoicePresets();
}

function loadVoicePresetMap() {
  try {
    const file = path.join(process.cwd(), "scripts", "voice-presets.json");
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

let commandCatalogCache = { at: 0, list: [] };

async function loadCommandCatalog() {
  const now = Date.now();
  if (commandCatalogCache.list.length && now - commandCatalogCache.at < 60_000) {
    return commandCatalogCache.list;
  }

  const dir = path.join(process.cwd(), "src", "commands");
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js")).sort();
  const out = [];

  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      const mod = await import(pathToFileURL(fullPath).href);
      const cmd = mod.default ?? (mod.data && mod.execute ? { data: mod.data, meta: mod.meta } : null);
      const name = cmd?.data?.name ?? file.replace(/\.js$/, "");
      const description = cmd?.data?.description ?? "";
      const category = cmd?.meta?.category ?? "general";
      const guildOnly = Boolean(cmd?.meta?.guildOnly);
      out.push({ name, description, category, guildOnly });
    } catch (err) {
      out.push({ name: file.replace(/\.js$/, ""), description: "import failed", category: "unknown", guildOnly: false });
    }
  }

  commandCatalogCache = { at: now, list: out };
  return out;
}

async function botGet(url) {
  const token = String(process.env.DISCORD_TOKEN || "").trim();
  if (!token) return null;
  const res = await request(url, {
    headers: { Authorization: `Bot ${token}` }
  });
  if (res.statusCode >= 400) return null;
  return res.body.json();
}

async function botJson(method, url, body) {
  const token = String(process.env.DISCORD_TOKEN || "").trim();
  if (!token) return { ok: false, statusCode: 0, body: null };
  const res = await request(url, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body || {})
  });
  let parsed = null;
  try {
    parsed = await res.body.json();
  } catch {
    parsed = null;
  }
  return { ok: res.statusCode < 400, statusCode: res.statusCode, body: parsed };
}

function playlistHubPayload() {
  // Buttons use ids handled by src/commands/music.js (mplhub:*).
  return {
    embeds: [
      {
        title: "Music Playlist Hub",
        description:
          "A self-serve playlist station. Create a personal drop thread, then drop audio files, links, or `q: keywords`.",
        color: 0x0ea5e9,
        fields: [
          { name: "What You Can Drop", value: "- audio uploads\n- http(s) links\n- `q: keywords` (search item)", inline: false },
          { name: "Flow", value: "Create drop -> add tracks -> browse -> queue into VC", inline: false }
        ]
      }
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 1, custom_id: "mplhub:create", label: "Create Personal Drop" },
          { type: 2, style: 2, custom_id: "mplhub:browse", label: "Browse Playlists" },
          { type: 2, style: 2, custom_id: "mplhub:help", label: "How It Works" }
        ]
      }
    ]
  };
}

async function listGuildSessions(guildId) {
  const mgr = global.agentManager;
  if (!mgr) return [];
  const sessions = [];
  for (const [key, agentId] of mgr.sessions.entries()) {
    const [gId, vcId] = String(key).split(":");
    if (String(gId) !== String(guildId)) continue;
    const agent = mgr.agents.get(agentId);
    if (!agent?.ws) {
      sessions.push({ voiceChannelId: vcId, agentId, status: "offline" });
      continue;
    }
    try {
      const res = await mgr.request(agent, "status", {
        guildId: gId,
        voiceChannelId: vcId,
        adminToken: process.env.DASHBOARD_ADMIN_TOKEN,
        adminUserId: "dashboard"
      });
      sessions.push({
        voiceChannelId: vcId,
        agentId,
        playing: Boolean(res?.playing),
        paused: Boolean(res?.paused),
        queueLength: res?.queueLength ?? null,
        mode: res?.mode ?? null
      });
    } catch {
      sessions.push({ voiceChannelId: vcId, agentId, status: "error" });
    }
  }
  return sessions;
}

async function listGuildAssistantSessions(guildId) {
  const mgr = global.agentManager;
  if (!mgr) return [];
  const sessions = [];
  for (const [key, agentId] of mgr.assistantSessions.entries()) {
    const parts = String(key).split(":");
    const gId = parts[1];
    const vcId = parts[2];
    if (String(gId) !== String(guildId)) continue;
    const agent = mgr.agents.get(agentId);
    if (!agent?.ws) {
      sessions.push({ voiceChannelId: vcId, agentId, status: "offline" });
      continue;
    }
    try {
      const res = await mgr.request(agent, "assistantStatus", {
        guildId: gId,
        voiceChannelId: vcId,
        adminToken: process.env.DASHBOARD_ADMIN_TOKEN,
        adminUserId: "dashboard"
      });
      sessions.push({
        voiceChannelId: vcId,
        agentId,
        active: Boolean(res?.active),
        busy: Boolean(res?.busy),
        auto: Boolean(res?.auto),
        lastActive: res?.lastActive ?? null
      });
    } catch {
      sessions.push({ voiceChannelId: vcId, agentId, status: "error" });
    }
  }
  return sessions;
}

async function getInstancesStatus() {
  const peers = parsePeers();
  const token = String(process.env.DASHBOARD_ADMIN_TOKEN || "").trim();
  const self = (() => {
    const list = agentManagerStatus().agents;
    const total = list.length;
    const ready = list.filter(a => a.ready).length;
    const busy = list.filter(a => a.busyKey).length;
    return { name: process.env.DASHBOARD_INSTANCE_NAME || "local", ok: true, total, ready, busy };
  })();

  const out = [self];
  for (const p of peers) {
    try {
      const res = await request(`${p.url.replace(/\/$/, "")}/api/internal/status`, {
        headers: { "x-admin-token": token }
      });
      if (res.statusCode >= 400) {
        out.push({ name: p.name, ok: false });
        continue;
      }
      const json = await res.body.json();
      out.push({
        name: p.name,
        ok: true,
        total: json.total,
        ready: json.ready,
        busy: json.busy,
        uptimeSec: json.uptimeSec,
        rss: json.rss,
        heapUsed: json.heapUsed,
        heapTotal: json.heapTotal
      });
    } catch {
      out.push({ name: p.name, ok: false });
    }
  }
  return out;
}

async function rateLimitDashboard(req, res, next) {
  const limit = Number(process.env.DASH_RATE_LIMIT ?? 30);
  const windowSec = Number(process.env.DASH_RATE_WINDOW_SEC ?? 10);
  const id = req.session?.userId || req.ip || "anon";
  const rl = await checkRateLimit(`dash:${id}`, limit, windowSec);
  if (!rl.ok) {
    res.status(429).json({ ok: false, error: "rate-limited", retryIn: rl.resetIn });
    return;
  }
  next();
}

app.get("/", (req, res) => {
  const loginUrl = oauthAuthorizeUrl();
  const authed = Boolean(req.session?.accessToken);
  const csrf = ensureCsrf(req) || "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Chopsticks Dashboard</title>
    <style>
      :root { color-scheme: light; }
      body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin: 0; background: #0c0e14; color: #e6e6e6; }
      header { padding: 24px; border-bottom: 1px solid #2a2f3a; }
      main { padding: 24px; }
      a.button { display: inline-block; padding: 10px 14px; border: 1px solid #4b5563; color: #e6e6e6; text-decoration: none; border-radius: 6px; }
      .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      .card { border: 1px solid #2a2f3a; border-radius: 10px; padding: 14px; background: #111827; }
      input, select, button { background: #0b0f1a; color: #e6e6e6; border: 1px solid #2a2f3a; border-radius: 6px; padding: 8px; }
      button { cursor: pointer; }
      .muted { color: #9ca3af; }
    </style>
  </head>
  <body>
    <header>
      <div>Chopsticks Dashboard</div>
      <div class="muted">Self-hosted control panel</div>
    </header>
    <main>
      ${
        authed
          ? `<a class="button" href="/logout">Logout</a> <a class="button" href="/fun">Fun Generator</a> <a class="button" href="/embed">Embed Builder</a>`
          : `<a class="button" href="${loginUrl}">Login with Discord</a>`
      }
      <div id="app"></div>
    </main>
    <script>
      const app = document.getElementById("app");
      const csrf = ${JSON.stringify(csrf)};
      async function postJson(url, body) {
        return fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify(body || {})
        });
      }
      async function loadGuilds() {
        const res = await fetch("/api/guilds");
        if (res.status === 401) {
          app.innerHTML = "<div style='text-align:center; margin-top:40px;'><p class='muted'>Login required.</p></div>";
          return;
        }
        
        // Load User Data
        const meRes = await fetch("/api/me");
        const meData = await meRes.json();
        const user = meData.user || {};
        const pets = meData.pets || [];
        const pools = meData.myPools || [];

        const data = await res.json();
        const list = data.guilds || [];
        
        app.innerHTML = \`
          <div style="display:flex; gap:20px; flex-direction:column;">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <h3>System Status</h3>
                <div class="muted">Logged in as \${user.username}</div>
              </div>
              <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
                <div class="card">
                  <div class="muted">Active Servers</div>
                  <div style="font-size:1.5em; font-weight:bold;">\${list.length}</div>
                </div>
                <div class="card">
                  <div class="muted">Your Agent Pools</div>
                  <div style="font-size:1.5em; font-weight:bold;">\${pools.length}</div>
                </div>
              </div>
            </div>

            <div>
              <h3>Manage Servers</h3>
              <div class="grid">
                \${list.map(g => \`
                  <div class="card" style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                      <div style="font-weight:bold;">\${g.name}</div>
                      <div class="muted">\${g.id}</div>
                    </div>
                    <button onclick="openGuild('\${g.id}')">Manage</button>
                  </div>
                \`).join("")}
              </div>
            </div>
          </div>
        \`;
      }

      function renderPet(pet) {
        return \`
          <div style="background:#0b0f1a; border:1px solid #2a2f3a; border-radius:6px; padding:8px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div><strong>\${pet.name}</strong> <span class="muted">(\${pet.pet_type})</span></div>
              <div class="muted" style="font-size:0.9em;">Level \${pet.stats?.level || 1} • Mood: \${pet.stats?.mood || "Neutral"}</div>
            </div>
            <button onclick="releasePet('\${pet.id}')" style="background:#3f1818; border-color:#5a2525;">Release</button>
          </div>
        \`;
      }

      async function adoptPet() {
        const name = document.getElementById("new-pet-name").value;
        const type = document.getElementById("new-pet-type").value;
        if (!name) return alert("Name is required");
        
        const res = await postJson("/api/me/pets", { name, type });
        const data = await res.json();
        if (data.ok) {
          loadGuilds(); // Refresh
        } else {
          alert("Error: " + data.error);
        }
      }

      async function releasePet(id) {
        if (!confirm("Are you sure you want to release this pet?")) return;
        const res = await postJson("/api/me/pets/" + id + "/delete");
        const data = await res.json();
        if (data.ok) {
          loadGuilds(); // Refresh
        } else {
          alert("Error: " + (data.error || "failed"));
        }
      }

      async function openGuild(id) {
        const res = await fetch("/api/guild/" + id);
        const data = await res.json();
        if (!data.ok) {
          app.innerHTML = "<p class='muted'>Unable to load guild.</p>";
          return;
        }
        const mode = data.music?.defaultMode || "open";
        const assistant = data.assistant || {};
        const lobbies = data.voice?.lobbies || {};
        const channels = data.channels || [];
        const roles = data.roles || [];
        const voiceChannels = channels.filter(c => c.type === 2);
        const textChannels = channels.filter(c => c.type === 0 || c.type === 5);
        const categories = channels.filter(c => c.type === 4);
        const voicePresets = data.voicePresets || [];
        const channelVoices = assistant.channelVoices || {};
        const playlists = data.musicPlaylists || {};
        const hub = playlists.hub || null;
        window.__auditRows = data.audit || [];
        window.__auditBefore = (data.audit && data.audit.length) ? data.audit[data.audit.length - 1].id : null;
        window.__currentGuildId = id;
        window.__commandSettings = data.commandSettings || { disabled: {} };
        window.__canManage = data.canManage;
        app.innerHTML = \`
          <h3>\${data.guild?.name || "Guild"} (\${id})</h3>
          <div class="card">
            <div>Instances</div>
            <div class="muted">Cluster view (peers)</div>
            <div id="instances-box">\${renderInstancesTable(data.instances || [])}</div>
          </div>
          <div class="card">
            <div>Agents</div>
            <div class="muted">Live status from this Chopsticks instance</div>
            <div class="muted">\${data.isAdmin ? "Admin controls enabled" : "Admin controls disabled"}</div>
            \${renderAgentsTable(data.agents || [])}
            \${data.isAdmin ? \`
              <div style="margin-top:8px;">
                <label>Agent ID</label>
                <input id="agent-id" placeholder="agent0001" />
                <button onclick="disconnectAgent()">Disconnect</button>
                <button onclick="restartAgent()">Restart</button>
                <button onclick="releaseAgent()">Release Session</button>
                <button onclick="handoffAgent()">Move Session (Next Play)</button>
              </div>
            \` : ""}
          </div>
          <div class="card">
            <div>Sessions</div>
            <div class="muted">Active music sessions</div>
            <div id="sessions-box">\${renderSessionsTable(data.sessions || [])}</div>
            <button onclick="refreshSessions('\${id}')">Refresh Sessions</button>
          </div>
          <div class="card">
            <div>Assistant Sessions</div>
            <div class="muted">Active voice assistant sessions</div>
            <div id="assistant-sessions-box">\${renderAssistantSessionsTable(data.assistantSessions || [])}</div>
            <button onclick="refreshSessions('\${id}')">Refresh Sessions</button>
          </div>
          <div class="card">
            <div>Command Analytics (Guild)</div>
            <div class="muted">Top commands by usage in this guild</div>
            <div>
              <label>days</label>
              <input id="analytics-days" type="number" min="1" max="90" value="7" />
              <button onclick="reloadAnalytics('\${id}')">Reload</button>
            </div>
            <div id="analytics-box">\${renderAnalyticsTable(data.analyticsGuild || [])}</div>
          </div>
          <div class="card">
            <div>Command Analytics (Global)</div>
            <div class="muted">Top commands across all guilds</div>
            <div>\${renderAnalyticsTable(data.analyticsGlobal || [])}</div>
          </div>
          <div class="card">
            <div>Commands</div>
            <div class="muted">Command catalog</div>
            <div id="commands-box" class="muted">Loading...</div>
            <button onclick="reloadCommands()">Reload</button>
          </div>

          <div class="card">
            <div>Audit Log</div>
            <div class="muted">Recent admin actions</div>
            <div class="muted">Filter by action or user_id</div>
            <div>
              <input id="audit-action" placeholder="action contains..." />
              <input id="audit-user" placeholder="user_id" />
              <button onclick="reloadAudit('\${id}')">Filter</button>
            </div>
            <div id="audit-box">\${renderAuditTable(data.audit || [])}</div>
            <button onclick="loadMoreAudit('\${id}')">Load More</button>
          </div>
          <div class="card">
            <div>Music Default Mode</div>
            <div class="muted">Controls default session mode</div>
            <select id="mode">
              <option value="open" \${mode === "open" ? "selected" : ""}>open</option>
              <option value="dj" \${mode === "dj" ? "selected" : ""}>dj</option>
            </select>
            <div>
              <label>Default Volume</label>
              <input id="defvol" type="number" min="0" max="150" value="\${data.music?.defaultVolume ?? 100}" />
            </div>
            <button onclick="saveMusic('\${id}')">Save</button>
          </div>
          <div class="card">
            <div>Music Controls</div>
            <div class="muted">Admin override (does not require you to be in voice)</div>
            <div>
              <label>voice_channel</label>
              <select id="music-vc">
                \${voiceChannels.map(c => \`<option value="\${c.id}">\${c.name} (\${c.id})</option>\`).join("")}
              </select>
            </div>
            <div>
              <label>query</label>
              <input id="music-query" placeholder="song or url" />
            </div>
            <div>
              <button onclick="musicAction('\${id}','play')">Play</button>
              <button onclick="musicAction('\${id}','pause')">Pause</button>
              <button onclick="musicAction('\${id}','resume')">Resume</button>
              <button onclick="musicAction('\${id}','skip')">Skip</button>
              <button onclick="musicAction('\${id}','stop')">Stop</button>
              <button onclick="musicAction('\${id}','queue')">Queue</button>
              <button onclick="musicAction('\${id}','now')">Now</button>
            </div>
            <div style="margin-top:8px;">
              <button onclick="loadQueue('\${id}')">Load Queue</button>
              <input id="queue-filter" placeholder="filter queue..." oninput="filterQueue()" />
              <div id="queue-box" class="muted" style="margin-top:6px;"></div>
            </div>
	            <div style="margin-top:8px;">
	              <label>preset</label>
	              <select id="music-preset">
	                <option value="flat">flat</option>
	                <option value="bassboost">bassboost</option>
	                <option value="nightcore">nightcore</option>
	                <option value="vaporwave">vaporwave</option>
	                <option value="8d">8d</option>
	              </select>
	              <button onclick="musicPreset('\${id}')">Apply Preset</button>
	            </div>
	          </div>
	          <div class="card">
	            <div>Music Playlists</div>
	            <div class="muted">Post a single hub message so users can create personal drop threads with one click.</div>
	            <div style="margin-top:8px;">
	              <div class="muted">Hub Status</div>
	              <div>\${hub ? ("<#"+hub.channelId+"> / " + hub.messageId) : "<span class='muted'>(not set)</span>"}</div>
	            </div>
	            <div style="margin-top:8px;">
	              <label>hub_channel</label>
	              <select id="mpl-hub-ch">
	                \${textChannels.map(c => \`<option value="\${c.id}" \${hub?.channelId === c.id ? "selected" : ""}>\${c.name} (\${c.id})</option>\`).join("")}
	              </select>
	            </div>
	            <div style="margin-top:8px;">
	              <button onclick="postPlaylistHub('\${id}')" \${data.canManage ? "" : "disabled"}>Post/Update Hub Message</button>
	              <div class="muted">\${data.canManage ? "" : "Manage Server required to post messages"}</div>
	            </div>
	            <div style="margin-top:10px;">
	              <div class="muted">Playlists</div>
	              <div>\${playlists.playlistsCount ?? 0} total, \${playlists.boundChannelsCount ?? 0} bound channels</div>
	            </div>
	          </div>
	          <div class="card">
	            <div>Assistant</div>
	            <div class="muted">Voice assistant config + controls</div>
	            <div>
	              <label>Enabled</label>
              <select id="assistant-enabled">
                <option value="true" \${assistant.enabled ? "selected" : ""}>true</option>
                <option value="false" \${assistant.enabled ? "" : "selected"}>false</option>
              </select>
            </div>
            <div>
              <label>Max Listen Sec</label>
              <input id="assistant-max-listen" type="number" min="2" max="30" value="\${assistant.maxListenSec ?? 10}" />
            </div>
            <div>
              <label>Silence Ms</label>
              <input id="assistant-silence" type="number" min="500" max="5000" value="\${assistant.silenceMs ?? 1200}" />
            </div>
            <div>
              <label>Cooldown Sec</label>
              <input id="assistant-cooldown" type="number" min="0" max="120" value="\${assistant.cooldownSec ?? 8}" />
            </div>
            <div>
              <label>Allowed Role IDs (comma)</label>
              <input id="assistant-roles" placeholder="roleId,roleId" value="\${(assistant.allowRoleIds || []).join(",")}" />
            </div>
            <div class="muted">Role Picker</div>
            <div style="max-height:140px; overflow:auto; border:1px solid #2a2f3a; padding:6px; border-radius:6px;">
              \${roles.map(r => \`
                <label style="display:flex; align-items:center; gap:6px; margin:2px 0;">
                  <input type="checkbox" class="assistant-role" value="\${r.id}" \${assistant.allowRoleIds?.includes?.(r.id) ? "checked" : ""} />
                  <span>\${r.name} (\${r.id})</span>
                </label>
              \`).join("")}
            </div>
            <div style="margin-top:6px;">
              <label>Allowed Voice Channels (comma)</label>
              <input id="assistant-channels" placeholder="channelId,channelId" value="\${(assistant.allowChannelIds || []).join(",")}" />
            </div>
            <div class="muted">Channel Picker</div>
            <div style="max-height:140px; overflow:auto; border:1px solid #2a2f3a; padding:6px; border-radius:6px;">
              \${voiceChannels.map(c => \`
                <label style="display:flex; align-items:center; gap:6px; margin:2px 0;">
                  <input type="checkbox" class="assistant-channel" value="\${c.id}" \${assistant.allowChannelIds?.includes?.(c.id) ? "checked" : ""} />
                  <span>\${c.name} (\${c.id})</span>
                </label>
              \`).join("")}
            </div>
            <div style="margin-top:6px;">
              <label>Max Sessions</label>
              <input id="assistant-max-sessions" type="number" min="1" max="10" value="\${assistant.maxSessions ?? 2}" />
            </div>
            <div style="margin-top:6px;">
              <label>Voice Name</label>
              <input id="assistant-voice" placeholder="default or custom voice name" value="\${assistant.voice ?? \"\"}" />
            </div>
            <div style="margin-top:6px;">
              <label>Voice Presets</label>
              <select id="assistant-voice-preset">
                \${voicePresets.map(v => \`<option value="\${v}">\${v}</option>\`).join("")}
              </select>
              <button onclick="applyAssistantVoicePreset()">Use Preset</button>
            </div>
            <div style="margin-top:6px;">
              <label>Voice Presets (comma)</label>
              <input id="assistant-voice-presets" placeholder="default,lessac-medium,amy-medium" value="\${voicePresets.join(\",\")}" />
            </div>
            <div style="margin-top:6px;">
              <label>Install Voice Preset</label>
              <select id="assistant-voice-install">
                \${data.voiceInstallPresets?.map?.(v => \`<option value="\${v}">\${v}</option>\`).join(\"\") || \"\"}
              </select>
              <button onclick="installAssistantVoicePreset('\${id}')">Install</button>
            </div>
            <div style="margin-top:6px;">
              <label>Channel Voice Overrides</label>
              <div class="muted">Format: channel_id=voice,channel_id=voice</div>
              <input id="assistant-channel-voices" placeholder="123=amy-medium,456=lessac-medium" value="\${Object.entries(channelVoices).map(([k,v]) => \`\${k}=\${v}\`).join(\",\")}" />
            </div>
            <button onclick="saveAssistant('\${id}')">Save Assistant Config</button>
            <div style="margin-top:8px;">
              <label>Voice Channel</label>
              <select id="assistant-vc">
                \${voiceChannels.map(c => \`<option value="\${c.id}">\${c.name} (\${c.id})</option>\`).join("")}
              </select>
            </div>
            <div>
              <label>Listen Seconds</label>
              <input id="assistant-listen-sec" type="number" min="2" max="30" value="10" />
            </div>
            <div>
              <label>Say Text</label>
              <input id="assistant-say-text" placeholder="Say something..." />
            </div>
            <div style="margin-top:6px;">
              <button onclick="assistantAction('\${id}','join')">Join</button>
              <button onclick="assistantAction('\${id}','leave')">Leave</button>
              <button onclick="assistantAction('\${id}','start')">Start Free Mode</button>
              <button onclick="assistantAction('\${id}','stop')">Stop Free Mode</button>
              <button onclick="assistantAction('\${id}','listen')">Listen Once</button>
              <button onclick="assistantAction('\${id}','say')">Say</button>
            </div>
          </div>
          <div class="card">
            <div>Voice Lobbies</div>
            <div class="muted">Update user limit / bitrate for existing lobbies</div>
            <div style="margin-top:8px; padding:8px; border:1px solid #2a2f3a; border-radius:8px;">
              <div><strong>Add Lobby</strong></div>
              <div>
                <label>lobby_channel</label>
                <select id="new-lobby">
                  \${voiceChannels.map(c => \`<option value="\${c.id}">\${c.name} (\${c.id})</option>\`).join("")}
                </select>
              </div>
              <div>
                <label>category</label>
                <select id="new-cat">
                  \${categories.map(c => \`<option value="\${c.id}">\${c.name} (\${c.id})</option>\`).join("")}
                </select>
              </div>
              <div><label>template</label><input id="new-tpl" placeholder="{user}'s room" /></div>
              <div><label>user_limit</label><input id="new-ul" type="number" min="0" max="99" value="0" /></div>
              <div><label>bitrate_kbps</label><input id="new-br" type="number" min="8" max="512" /></div>
              <div><label>max_channels</label><input id="new-mc" type="number" min="0" max="99" placeholder="0 = unlimited" /></div>
              <button onclick="addLobby('\${id}')">Add Lobby</button>
            </div>
            <div>\${Object.entries(lobbies).map(([cid, lobby]) => \`
              <div style="margin-top:10px; padding:8px; border:1px solid #2a2f3a; border-radius:8px;">
                <div><strong>\${cid}</strong></div>
                <div class="muted">template: \${lobby.nameTemplate || ""}</div>
                <div>
                  <label>user_limit</label>
                  <input id="ul-\${cid}" type="number" min="0" max="99" value="\${lobby.userLimit ?? 0}" />
                </div>
                <div>
                  <label>bitrate_kbps</label>
                  <input id="br-\${cid}" type="number" min="8" max="512" value="\${lobby.bitrateKbps ?? ""}" />
                </div>
                <div>
                  <label>max_channels</label>
                  <input id="mc-\${cid}" type="number" min="0" max="99" value="\${lobby.maxChannels ?? ""}" placeholder="0 = unlimited" />
                </div>
                <button onclick="saveLobby('\${id}','\${cid}')">Save Lobby</button>
                <button onclick="toggleLobby('\${id}','\${cid}', \${!lobby.enabled})">\${lobby.enabled ? "Disable" : "Enable"}</button>
                <button onclick="removeLobby('\${id}','\${cid}')">Remove</button>
              </div>
            \`).join("")}</div>
          </div>
          <div class="card">
            <div>Dashboard Permissions</div>
            <div class="muted">Allow users or roles to access this guild dashboard</div>
            <div>
              <label>allow_user_ids (comma)</label>
              <input id="dash-users" value="\${(data.dashboardPerms?.allowUserIds || []).join(",")}" />
            </div>
            <div>
              <label>allow_role_ids (comma)</label>
              <input id="dash-roles" value="\${(data.dashboardPerms?.allowRoleIds || []).join(",")}" />
            </div>
            <button onclick="saveDashPerms('\${id}')" \${data.canManage ? "" : "disabled"}>Save Permissions</button>
            <div class="muted">\${data.canManage ? "" : "Manage Server required to edit"}</div>
          </div>
          <button onclick="loadGuilds()">Back</button>
        \`;
        reloadCommands();
      }

      async function saveMusic(id) {
        const mode = document.getElementById("mode").value;
        const defaultVolume = Number(document.getElementById("defvol").value);
        await postJson("/api/guild/" + id + "/music/default", { mode, defaultVolume });
        alert("Saved");
      }

      async function saveAssistant(id) {
        const enabled = document.getElementById("assistant-enabled").value === "true";
        const maxListenSec = Number(document.getElementById("assistant-max-listen").value);
        const silenceMs = Number(document.getElementById("assistant-silence").value);
        const cooldownSec = Number(document.getElementById("assistant-cooldown").value);
        const maxSessions = Number(document.getElementById("assistant-max-sessions").value);
        const voice = (document.getElementById("assistant-voice").value || "").trim();
        const presetsRaw = document.getElementById("assistant-voice-presets").value || "";
        const voicePresets = presetsRaw.split(",").map(x => x.trim()).filter(Boolean);
        const channelVoicesRaw = document.getElementById("assistant-channel-voices").value || "";
        const channelVoices = {};
        if (channelVoicesRaw.trim()) {
          channelVoicesRaw.split(",").forEach(pair => {
            const [k, v] = pair.split("=").map(x => x.trim());
            if (k && v) channelVoices[k] = v;
          });
        }
        let profiles = {};
        let voicePersonalities = {};
        let channelProfiles = {};
        let rotation = {};
        try {
          const raw = document.getElementById("assistant-profiles").value || "{}";
          profiles = JSON.parse(raw);
        } catch { return alert("Invalid profiles JSON"); }
        try {
          const raw = document.getElementById("assistant-voice-personalities").value || "{}";
          voicePersonalities = JSON.parse(raw);
        } catch { return alert("Invalid voice personalities JSON"); }
        try {
          const raw = document.getElementById("assistant-channel-profiles").value || "{}";
          channelProfiles = JSON.parse(raw);
        } catch { return alert("Invalid channel profiles JSON"); }
        try {
          const raw = document.getElementById("assistant-rotation").value || "{}";
          rotation = JSON.parse(raw);
        } catch { return alert("Invalid rotation JSON"); }
        const rolesRaw = document.getElementById("assistant-roles").value || "";
        const allowRoleIdsManual = rolesRaw.split(",").map(x => x.trim()).filter(Boolean);
        const roleChecks = Array.from(document.querySelectorAll(".assistant-role:checked")).map(
          el => el.value
        );
        const allowRoleIds = Array.from(new Set([...allowRoleIdsManual, ...roleChecks]));
        const channelsRaw = document.getElementById("assistant-channels").value || "";
        const allowChannelIdsManual = channelsRaw.split(",").map(x => x.trim()).filter(Boolean);
        const channelChecks = Array.from(document.querySelectorAll(".assistant-channel:checked")).map(
          el => el.value
        );
        const allowChannelIds = Array.from(new Set([...allowChannelIdsManual, ...channelChecks]));
        await postJson("/api/guild/" + id + "/assistant/config", {
          enabled,
          maxListenSec,
          silenceMs,
          cooldownSec,
          maxSessions,
          allowRoleIds,
          allowChannelIds,
          voice,
          voicePresets,
          channelVoices,
          profiles,
          voicePersonalities,
          channelProfiles,
          rotation
        });
        alert("Assistant config saved");
      }

      function applyAssistantVoicePreset() {
        const preset = document.getElementById("assistant-voice-preset").value;
        document.getElementById("assistant-voice").value = preset || "";
      }

      async function installAssistantVoicePreset(id) {
        const preset = document.getElementById("assistant-voice-install").value;
        if (!preset) return;
        const res = await postJson("/api/guild/" + id + "/assistant/install-voice", { preset });
        const data = await res.json();
        alert(data.ok ? "Install started" : ("Error: " + (data.error || "failed")));
      }

      async function musicAction(guildId, action) {
        const voiceChannelId = document.getElementById("music-vc").value;
        const query = document.getElementById("music-query").value;
        const res = await postJson("/api/guild/" + guildId + "/music/control", { voiceChannelId, action, query });
        const data = await res.json();
        alert(data.ok ? "OK" : ("Error: " + (data.error || "failed")));
      }

      async function loadQueue(guildId) {
        const voiceChannelId = document.getElementById("music-vc").value;
        const res = await fetch("/api/guild/" + guildId + "/music/queue?voiceChannelId=" + voiceChannelId);
        const data = await res.json();
        if (!data.ok) return alert("Error");
        const list = data.tracks || [];
        window.__queueItems = list;
        renderQueue(list, guildId);
      }

      function renderQueue(list, guildId) {
        const box = document.getElementById("queue-box");
        box.innerHTML = list.map((t, i) => \`
          <div style="display:flex; gap:8px; align-items:center; margin:4px 0;">
            <div style="flex:1;">\${i + 1}. \${t.title || "Unknown"}</div>
            <button onclick="removeQueueItem('\${guildId}', \${i})">Remove</button>
          </div>
        \`).join("") || "<div class='muted'>(empty)</div>";
      }

      function filterQueue() {
        const q = document.getElementById("queue-filter").value.toLowerCase();
        const list = window.__queueItems || [];
        if (!q) return renderQueue(list, window.__currentGuildId);
        const filtered = list.filter(t => String(t.title || "").toLowerCase().includes(q));
        renderQueue(filtered, window.__currentGuildId);
      }

      async function removeQueueItem(guildId, index) {
        const voiceChannelId = document.getElementById("music-vc").value;
        const res = await postJson("/api/guild/" + guildId + "/music/remove", { voiceChannelId, index });
        const data = await res.json();
        if (!data.ok) return alert("Error");
        await loadQueue(guildId);
      }

      async function musicPreset(guildId) {
        const voiceChannelId = document.getElementById("music-vc").value;
        const preset = document.getElementById("music-preset").value;
        const res = await postJson("/api/guild/" + guildId + "/music/preset", { voiceChannelId, preset });
        const data = await res.json();
        alert(data.ok ? "Preset applied" : "Error");
      }

      async function assistantAction(guildId, action) {
        const voiceChannelId = document.getElementById("assistant-vc").value;
        const seconds = Number(document.getElementById("assistant-listen-sec").value) || 10;
        const text = document.getElementById("assistant-say-text").value || "";
        const res = await postJson("/api/guild/" + guildId + "/assistant/control", {
          voiceChannelId,
          action,
          seconds,
          text
        });
        const data = await res.json();
        alert(data.ok ? "OK" : ("Error: " + (data.error || "failed")));
      }

      function renderAuditTable(rows) {
        if (!rows.length) return "<div class='muted'>No audit entries.</div>";
        return \`
          <table style="width:100%; border-collapse: collapse;">
            <thead>
              <tr>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">id</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">action</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">user</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">time</th>
              </tr>
            </thead>
            <tbody>
              \${rows.map(r => \`
                <tr>
                  <td>\${r.id}</td>
                  <td>\${r.action}</td>
                  <td>\${r.user_id}</td>
                  <td>\${new Date(r.created_at).toLocaleString()}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      function renderAgentsTable(rows) {
        if (!rows.length) return "<div class='muted'>No agents.</div>";
        return \`
          <table style="width:100%; border-collapse: collapse;">
            <thead>
              <tr>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">agent</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">ready</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">busy</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">kind</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">guild</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">voice</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">lastSeen</th>
              </tr>
            </thead>
            <tbody>
              \${rows.map(a => \`
                <tr>
                  <td>\${a.agentId}</td>
                  <td>\${a.ready ? "yes" : "no"}</td>
                  <td>\${a.busyKey ? "yes" : "no"}</td>
                  <td>\${a.busyKind || ""}</td>
                  <td>\${a.guildId || ""}</td>
                  <td>\${a.voiceChannelId || ""}</td>
                  <td>\${a.lastSeen ? new Date(a.lastSeen).toLocaleString() : ""}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      function renderSessionsTable(rows) {
        if (!rows.length) return "<div class='muted'>No sessions.</div>";
        return \`
          <table style="width:100%; border-collapse: collapse;">
            <thead>
              <tr>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">voice</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">agent</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">playing</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">paused</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">queue</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">mode</th>
              </tr>
            </thead>
            <tbody>
              \${rows.map(s => \`
                <tr>
                  <td>\${s.voiceChannelId}</td>
                  <td>\${s.agentId}</td>
                  <td>\${s.playing ? "yes" : "no"}</td>
                  <td>\${s.paused ? "yes" : "no"}</td>
                  <td>\${s.queueLength ?? ""}</td>
                  <td>\${s.mode ?? ""}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      function renderAssistantSessionsTable(rows) {
        if (!rows.length) return "<div class='muted'>No assistant sessions.</div>";
        return \`
          <table style="width:100%; border-collapse: collapse;">
            <thead>
              <tr>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">voice</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">agent</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">active</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">busy</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">auto</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">lastActive</th>
              </tr>
            </thead>
            <tbody>
              \${rows.map(s => \`
                <tr>
                  <td>\${s.voiceChannelId}</td>
                  <td>\${s.agentId}</td>
                  <td>\${s.active ? "yes" : "no"}</td>
                  <td>\${s.busy ? "yes" : "no"}</td>
                  <td>\${s.auto ? "yes" : "no"}</td>
                  <td>\${s.lastActive ? new Date(s.lastActive).toLocaleString() : ""}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      function renderAnalyticsTable(rows) {
        if (!rows.length) return "<div class='muted'>No data.</div>";
        return \`
          <table style="width:100%; border-collapse: collapse;">
            <thead>
              <tr>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">command</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">ok</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">err</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">avg_ms</th>
              </tr>
            </thead>
            <tbody>
              \${rows.map(r => \`
                <tr>
                  <td>\${r.command}</td>
                  <td>\${r.ok}</td>
                  <td>\${r.err}</td>
                  <td>\${r.avgMs}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      function renderCommandsTable(rows) {
        if (!rows.length) return "<div class='muted'>No commands loaded.</div>";
        const disabled = window.__commandSettings?.disabled || {};
        const canManage = window.__canManage;
        return \`
          <table style="width:100%; border-collapse: collapse;">
            <thead>
              <tr>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">enabled</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">command</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">category</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">scope</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">description</th>
              </tr>
            </thead>
            <tbody>
              \${rows.map(r => \`
                <tr>
                  <td>
                    <input type="checkbox" 
                      \${!disabled[r.name] ? "checked" : ""} 
                      \${canManage ? \`onclick="toggleCommand('\${r.name}', this.checked)"\` : "disabled"} 
                    />
                  </td>
                  <td>\${r.name}</td>
                  <td>\${r.category}</td>
                  <td>\${r.guildOnly ? "guild" : "global"}</td>
                  <td>\${r.description || ""}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      function renderInstancesTable(rows) {
        if (!rows.length) return "<div class='muted'>No peers configured.</div>";
        return \`
          <table style="width:100%; border-collapse: collapse;">
            <thead>
              <tr>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">instance</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">status</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">agents</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">ready</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">busy</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">uptime</th>
                <th style="text-align:left; border-bottom:1px solid #2a2f3a;">rss</th>
              </tr>
            </thead>
            <tbody>
              \${rows.map(r => \`
                <tr>
                  <td>\${r.name}</td>
                  <td>\${r.ok ? "ok" : "down"}</td>
                  <td>\${r.total ?? ""}</td>
                  <td>\${r.ready ?? ""}</td>
                  <td>\${r.busy ?? ""}</td>
                  <td>\${r.uptimeSec ? (Math.floor(r.uptimeSec / 60) + "m") : ""}</td>
                  <td>\${r.rss ? Math.round(r.rss / 1024 / 1024) + "MB" : ""}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      }

      async function saveLobby(guildId, channelId) {
        const userLimit = Number(document.getElementById("ul-" + channelId).value);
        const bitrateKbpsRaw = document.getElementById("br-" + channelId).value;
        const bitrateKbps = bitrateKbpsRaw ? Number(bitrateKbpsRaw) : null;
        const maxChannelsRaw = document.getElementById("mc-" + channelId).value;
        const maxChannels = maxChannelsRaw === "" ? null : Number(maxChannelsRaw);
        await postJson("/api/guild/" + guildId + "/voice/lobby/" + channelId, {
          userLimit,
          bitrateKbps,
          maxChannels
        });
        alert("Saved");
      }

      async function addLobby(guildId) {
        const channelId = document.getElementById("new-lobby").value.trim();
        const categoryId = document.getElementById("new-cat").value.trim();
        const template = document.getElementById("new-tpl").value.trim() || "{user}'s room";
        const userLimit = Number(document.getElementById("new-ul").value);
        const bitrateKbpsRaw = document.getElementById("new-br").value;
        const bitrateKbps = bitrateKbpsRaw ? Number(bitrateKbpsRaw) : null;
        const maxChannelsRaw = document.getElementById("new-mc").value;
        const maxChannels = maxChannelsRaw === "" ? null : Number(maxChannelsRaw);
        await postJson("/api/guild/" + guildId + "/voice/lobby/add", {
          channelId,
          categoryId,
          template,
          userLimit,
          bitrateKbps,
          maxChannels
        });
        alert("Added");
      }

      async function removeLobby(guildId, channelId) {
        await postJson("/api/guild/" + guildId + "/voice/lobby/remove", { channelId });
        alert("Removed");
      }

      async function toggleLobby(guildId, channelId, enable) {
        await postJson("/api/guild/" + guildId + "/voice/lobby/toggle", { channelId, enable });
        alert("Updated");
      }

      async function saveDashPerms(guildId) {
        const allowUserIds = document.getElementById("dash-users").value.split(",").map(x => x.trim()).filter(Boolean);
        const allowRoleIds = document.getElementById("dash-roles").value.split(",").map(x => x.trim()).filter(Boolean);
        const res = await postJson("/api/guild/" + guildId + "/dashboard/permissions", { allowUserIds, allowRoleIds });
        const data = await res.json();
        alert(data.ok ? "Saved" : "Error");
      }

      async function reloadAudit(guildId) {
        const action = document.getElementById("audit-action").value.trim();
        const userId = document.getElementById("audit-user").value.trim();
        const qs = new URLSearchParams();
        if (action) qs.set("action", action);
        if (userId) qs.set("userId", userId);
        const res = await fetch("/api/guild/" + guildId + "/audit?" + qs.toString());
        const data = await res.json();
        document.getElementById("audit-box").innerHTML = renderAuditTable(data.audit || []);
        window.__auditBefore = (data.audit && data.audit.length) ? data.audit[data.audit.length - 1].id : null;
      }

      async function loadMoreAudit(guildId) {
        const action = document.getElementById("audit-action").value.trim();
        const userId = document.getElementById("audit-user").value.trim();
        const qs = new URLSearchParams();
        if (action) qs.set("action", action);
        if (userId) qs.set("userId", userId);
        if (window.__auditBefore) qs.set("before", String(window.__auditBefore));
        const res = await fetch("/api/guild/" + guildId + "/audit?" + qs.toString());
        const data = await res.json();
        const box = document.getElementById("audit-box");
        const existing = (window.__auditRows || []).concat(data.audit || []);
        window.__auditRows = existing;
        box.innerHTML = renderAuditTable(existing);
        window.__auditBefore = (data.audit && data.audit.length) ? data.audit[data.audit.length - 1].id : window.__auditBefore;
      }

      async function disconnectAgent() {
        const id = document.getElementById("agent-id").value.trim();
        if (!id) return;
        await postJson("/api/agents/" + id + "/disconnect");
        alert("Disconnected");
      }

      async function restartAgent() {
        const id = document.getElementById("agent-id").value.trim();
        if (!id) return;
        await postJson("/api/agents/" + id + "/restart");
        alert("Restarted");
      }

      async function releaseAgent() {
        const id = document.getElementById("agent-id").value.trim();
        if (!id) return;
        await postJson("/api/agents/" + id + "/release");
        alert("Released");
      }

      async function handoffAgent() {
        const id = document.getElementById("agent-id").value.trim();
        if (!id) return;
        await postJson("/api/agents/" + id + "/handoff");
        alert("Handoff scheduled");
      }

      async function refreshSessions(guildId) {
        const res = await fetch("/api/guild/" + guildId + "/sessions");
        const data = await res.json();
        document.getElementById("sessions-box").innerHTML = renderSessionsTable(data.sessions || []);
        const box = document.getElementById("assistant-sessions-box");
        if (box) box.innerHTML = renderAssistantSessionsTable(data.assistantSessions || []);
      }

      async function reloadAnalytics(guildId) {
        const days = Number(document.getElementById("analytics-days").value) || 7;
        const res = await fetch("/api/guild/" + guildId + "/analytics?days=" + days);
        const data = await res.json();
        document.getElementById("analytics-box").innerHTML = renderAnalyticsTable(data.analytics || []);
      }

      async function reloadCommands() {
        const res = await fetch("/api/commands");
        const data = await res.json();
        document.getElementById("commands-box").innerHTML = renderCommandsTable(data.commands || []);
      }

      async function toggleCommand(command, enabled) {
        const guildId = window.__currentGuildId;
        if (!guildId) return;
        
        // update local state immediately
        const settings = window.__commandSettings || { disabled: {} };
        if (enabled) {
          delete settings.disabled[command];
        } else {
          settings.disabled[command] = true;
        }
        window.__commandSettings = settings;

        const res = await postJson("/api/guild/" + guildId + "/commands/toggle", { command, enabled });
        const data = await res.json();
        if (!data.ok) {
          alert("Error: " + (data.error || "failed"));
          // revert local state
          if (enabled) settings.disabled[command] = true;
          else delete settings.disabled[command];
          // re-render?
          // reloadCommands(); // no need if we assume failure is rare, but good practice
        }
      }

      if (${authed}) loadGuilds();
    </script>
  </body>
  </html>`);
});

app.get("/login", (req, res) => {
  const url = oauthAuthorizeUrl();
  if (!url) {
    res.status(500).send("OAuth not configured.");
    return;
  }
  res.redirect(url);
});

// One-click console auth from /console Discord command
app.get("/console-auth", async (req, res) => {
  const token = String(req.query.token || "").trim();
  if (!token) return res.status(400).send("Missing token.");

  const secret = getJwtSecret();
  if (!secret) return res.status(500).send("Dashboard secret not configured.");

  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch (err) {
    return res.status(401).send(
      `<html><body style="font-family:sans-serif;background:#0b0f1a;color:#e6e6e6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center"><h2>🔒 Link Expired or Invalid</h2><p>Run <code>/console</code> in Discord again to get a new link.</p>
        <a href="/" style="color:#7c3aed">Return to dashboard</a></div></body></html>`
    );
  }

  const { jti, userId, guildId, username, avatarHash } = payload;

  // One-time use: try to atomically mark token as consumed
  let ok = true;
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const rc = createClient({ url: redisUrl });
      await rc.connect();
      const result = await rc.set(`console_token_used:${jti}`, "1", { EX: 600, NX: true });
      await rc.quit();
      ok = result !== null; // null = already set = already used
    } catch { /* Redis unavailable — allow */ }
  }

  if (!ok) {
    return res.status(401).send(
      `<html><body style="font-family:sans-serif;background:#0b0f1a;color:#e6e6e6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center"><h2>🔒 Link Already Used</h2><p>Each console link can only be used once.<br>Run <code>/console</code> again for a fresh link.</p>
        <a href="/" style="color:#7c3aed">Return to dashboard</a></div></body></html>`
    );
  }

  // Create guild-scoped session
  req.session.userId = String(userId);
  req.session.username = String(username || "");
  req.session.avatar = String(avatarHash || "");
  req.session.guildAdmin = true;
  req.session.guildId = String(guildId);
  req.session.consoleAuth = true;
  await new Promise(r => req.session.save(r));

  res.redirect(`/guild/${guildId}`);
});

// Guild console SPA
app.get("/guild/:id", requireAuth, (req, res) => {
  const guildId = req.params.id;
  // Auth check: must be bot admin OR the guild admin who console-authed for this guild
  const isOwner = isDashboardAdmin(req);
  const isGuildAdmin = req.session?.guildAdmin && String(req.session.guildId) === String(guildId);
  if (!isOwner && !isGuildAdmin) {
    return res.redirect(`/?error=unauthorized&guild=${guildId}`);
  }

  const __dirname2 = path.dirname(new URL(import.meta.url).pathname);
  const spaPath = path.join(__dirname2, "public", "guild.html");
  if (fs.existsSync(spaPath)) {
    return res.sendFile(spaPath);
  }
  // Fallback: inline SPA shell
  res.redirect(`/?guild=${guildId}`);
});

app.get("/oauth/callback", async (req, res) => {
  const code = String(req.query.code || "");
  if (!code) {
    res.redirect("/");
    return;
  }

  try {
    const token = await oauthToken(code);
    req.session.accessToken = token.access_token;
    const user = await apiGet("https://discord.com/api/users/@me", token.access_token);
    if (user?.id) {
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.avatar = user.avatar;
    }
    res.redirect("/");
  } catch (err) {
    console.error("OAuth Error:", err);
    res.status(500).send("OAuth failed: " + err.message);
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/api/commands", requireAuth, rateLimitDashboard, requireAdmin, async (req, res) => {
  const list = await loadCommandCatalog();
  res.json({ ok: true, commands: list });
});

app.get("/api/guilds", requireAuth, rateLimitDashboard, requireAdmin, async (req, res) => {
  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const out = [];
  for (const g of guilds) {
    const canManage = manageGuildPerms(g);
    if (canManage) {
      out.push({ id: g.id, name: g.name });
      continue;
    }
    const access = await hasDashboardAccess(g.id, req.session?.userId, canManage);
    if (access.ok) out.push({ id: g.id, name: g.name });
  }
  res.json({ ok: true, guilds: out });
});

app.get("/api/guild/:id", requireAuth, rateLimitDashboard, requireGuildAdminOrOwner(), async (req, res) => {
  const guildId = String(req.params.id || "");
  if (!guildId || !isSnowflake(guildId)) {
    res.status(400).json({ ok: false, error: "bad-guild" });
    return;
  }

  // Console-auth sessions (guild admins via /console) don't have a Discord OAuth token —
  // they are already validated by requireGuildAdminOrOwner; fetch guild info via bot.
  let guild, canManage;
  if (req.session?.guildAdmin && req.session?.consoleAuth) {
    const botGuild = await botGet(`https://discord.com/api/guilds/${guildId}?with_counts=true`);
    guild = botGuild ? { id: guildId, name: botGuild.name, icon: botGuild.icon } : { id: guildId };
    canManage = true;
  } else {
    const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
    guild = guilds.find(g => g.id === guildId);
    if (!guild) {
      res.status(403).json({ ok: false, error: "no-permission" });
      return;
    }
    canManage = manageGuildPerms(guild);
    const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
    if (!access.ok) {
      res.status(403).json({ ok: false, error: "no-permission" });
      return;
    }
  }

  const music = await getMusicConfig(guildId);
  const assistant = await getAssistantConfig(guildId);
  const voice = await getVoiceStatus(guildId);
  const agents = agentManagerStatus().agents;
  const audit = await getAuditLog(guildId, 50, null);
  const persistedGlobal = await getPersistedCommandStats(null, 50);
  const persistedGuild = await getPersistedCommandStatsDaily(guildId, 7, 50);
  const analyticsGlobal = persistedGlobal.length ? persistedGlobal : getCommandStats();
  const analyticsGuild = persistedGuild.length ? persistedGuild : getCommandStatsForGuild(guildId);
  const channels = await botGet(`https://discord.com/api/guilds/${guildId}/channels`);
  const roles = await botGet(`https://discord.com/api/guilds/${guildId}/roles`);
  const sessions = await listGuildSessions(guildId);
  const assistantSessions = await listGuildAssistantSessions(guildId);
  const dashboardPerms = await getDashboardPerms(guildId);
  const commandSettings = await listCommandSettings(guildId);
  const instances = await getInstancesStatus();
  const voicePresets = resolveVoicePresets(assistant);
  const voiceInstallPresets = Object.keys(loadVoicePresetMap());
  res.json({
    ok: true,
    guild,
    music,
    assistant,
    voice,
    agents,
    audit,
    analyticsGlobal,
    analyticsGuild,
    sessions,
    assistantSessions,
    instances,
    channels: channels ?? [],
    roles: roles ?? [],
    voicePresets,
    voiceInstallPresets,
    isAdmin: isDashboardAdmin(req),
    canManage,
    dashboardPerms,
    commandSettings
  });
});

app.get("/api/guild/:id/sessions", requireAuth, rateLimitDashboard, requireGuildAdminOrOwner(), async (req, res) => {
  const guildId = String(req.params.id || "");
  if (!guildId || !isSnowflake(guildId)) {
    res.status(400).json({ ok: false, error: "bad-guild" });
    return;
  }
  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const sessions = await listGuildSessions(guildId);
  const assistantSessions = await listGuildAssistantSessions(guildId);
  res.json({ ok: true, sessions, assistantSessions });
});

app.get("/api/instances", requireAuth, rateLimitDashboard, requireAdmin, async (req, res) => {
  const instances = await getInstancesStatus();
  res.json({ ok: true, instances });
});

app.get("/api/guild/:id/analytics", requireAuth, rateLimitDashboard, requireGuildAdminOrOwner(), async (req, res) => {
  const guildId = String(req.params.id || "");
  const days = Number(req.query.days || 7);
  if (!guildId || !isSnowflake(guildId)) {
    res.status(400).json({ ok: false, error: "bad-guild" });
    return;
  }
  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const persisted = await getPersistedCommandStatsDaily(guildId, days, 50);
  const analytics = persisted.length ? persisted : getCommandStatsForGuild(guildId);
  res.json({ ok: true, analytics });
});

app.get("/api/internal/status", async (req, res) => {
  if (!adminTokenOk(req)) {
    res.status(403).json({ ok: false, error: "not-admin" });
    return;
  }
  const list = agentManagerStatus().agents;
  const total = list.length;
  const ready = list.filter(a => a.ready).length;
  const busy = list.filter(a => a.busyKey).length;
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    total,
    ready,
    busy,
    uptimeSec: Math.floor(process.uptime()),
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal
  });
});

app.get("/api/guild/:id/audit", requireAuth, rateLimitDashboard, requireGuildAdminOrOwner(), async (req, res) => {
  const guildId = String(req.params.id || "");
  const before = req.query.before ? Number(req.query.before) : null;
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const action = req.query.action ? String(req.query.action) : null;
  const userId = req.query.userId ? String(req.query.userId) : null;
  if (!guildId || !isSnowflake(guildId)) {
    res.status(400).json({ ok: false, error: "bad-guild" });
    return;
  }

  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }

  const audit = await getAuditLog(guildId, limit, before, action, userId);
  res.json({ ok: true, audit });
});

app.get("/api/agents", requireAuth, rateLimitDashboard, requireAdmin, async (req, res) => {
  const data = agentManagerStatus();
  res.json(data);
});

app.get("/api/me", requireAuth, rateLimitDashboard, async (req, res) => {
  const userId = req.session.userId;
  const pets = await getUserPets(userId);
  const myPools = await fetchPoolsByOwner(userId);
  const publicPools = await listPools();
  const csrf = ensureCsrf(req);
  
  res.json({ 
    ok: true, 
    csrfToken: csrf,
    user: { 
      id: userId, 
      username: req.session.username,
      avatar: req.session.avatar
    },
    guildAdmin: req.session?.guildAdmin ?? false,
    scopedGuildId: req.session?.guildId ?? null,
    pets,
    myPools,
    publicPools
  });
});

app.get("/fun", requireAuth, rateLimitDashboard, (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Chopsticks Fun Generator</title>
    <style>
      body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background: radial-gradient(circle at top right, #14213d, #0b0f1a 60%); color: #e6e6e6; }
      main { max-width: 1080px; margin: 0 auto; padding: 24px; }
      .bar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
      .btn { display: inline-block; text-decoration: none; color: #e6e6e6; border: 1px solid #344055; border-radius: 8px; padding: 8px 12px; background: #111827; }
      .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
      .card { border: 1px solid #2a2f3a; border-radius: 12px; background: rgba(17,24,39,.92); padding: 14px; }
      label { display: block; color: #9ca3af; font-size: 12px; margin-bottom: 5px; }
      input, select, button { width: 100%; box-sizing: border-box; background: #0b0f1a; color: #e6e6e6; border: 1px solid #344055; border-radius: 8px; padding: 9px; }
      button { cursor: pointer; font-weight: 700; }
      .row { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
      pre { background: #09101d; border: 1px solid #243145; border-radius: 8px; padding: 12px; white-space: pre-wrap; word-break: break-word; min-height: 140px; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 6px 0; border-bottom: 1px dashed #243145; vertical-align: top; }
      .mono { font-family: ui-monospace, Menlo, monospace; color: #86efac; }
      .muted { color: #9ca3af; }
    </style>
  </head>
  <body>
    <main>
      <div class="bar">
        <a class="btn" href="/">Dashboard</a>
        <a class="btn" href="/logout">Logout</a>
      </div>
      <h2>Fun Generator</h2>
      <div class="muted">One content engine across Discord, web, and game surfaces.</div>
      <div class="grid" style="margin-top:14px;">
        <section class="card">
          <h3>Generate Output</h3>
          <div class="row">
            <div>
              <label>Target</label>
              <input id="target" placeholder="raid-team" />
            </div>
            <div>
              <label>Intensity (1-5)</label>
              <select id="intensity">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3" selected>3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
            </div>
          </div>
          <div style="margin-top:10px;">
            <label>Variant ID (optional for random)</label>
            <input id="variant" placeholder="hype-burst" />
          </div>
          <div class="row" style="margin-top:10px;">
            <button id="run-random">Random</button>
            <button id="run-variant">Use Variant</button>
          </div>
          <pre id="output">No output yet.</pre>
        </section>
        <section class="card">
          <h3>Catalog Search</h3>
          <div class="row">
            <div>
              <label>Query</label>
              <input id="query" placeholder="hype" />
            </div>
            <div>
              <label>Limit</label>
              <select id="limit">
                <option value="10">10</option>
                <option value="20" selected>20</option>
                <option value="25">25</option>
              </select>
            </div>
          </div>
          <div style="margin-top:10px;">
            <button id="search">Search Catalog</button>
          </div>
          <div id="meta" class="muted" style="margin-top:10px;"></div>
          <table id="catalog" style="margin-top:8px;"></table>
        </section>
      </div>
    </main>
    <script>
      const output = document.getElementById("output");
      const catalog = document.getElementById("catalog");
      const meta = document.getElementById("meta");

      async function getJson(url) {
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || data.detail || ("HTTP " + res.status));
        }
        return data;
      }

      function safe(v) {
        return String(v ?? "").replace(/[&<>"]/g, s => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;" }[s]));
      }

      function renderOutput(data) {
        output.textContent =
          "Source: " + (data.source || "local") + "\\n" +
          "Variant: " + (data.variantId || data?.variant?.id || "unknown") + "\\n" +
          "Intensity: " + (data.intensity ?? 3) + "\\n\\n" +
          String(data.text || "No text returned.");
      }

      function renderCatalog(data) {
        const stats = data.stats || {};
        meta.textContent = "source=" + (data.source || "local") + " | total=" + (stats.total || data.total || 0) + " | themes=" + (stats.themes || "?") + " | styles=" + (stats.styles || "?");
        const rows = (data.matches || []).map(v => "<tr><td class='mono'>" + safe(v.id) + "</td><td>" + safe(v.label) + "</td></tr>");
        catalog.innerHTML = rows.length ? rows.join("") : "<tr><td class='muted'>No matches</td><td></td></tr>";
      }

      async function runRandom() {
        const target = encodeURIComponent(document.getElementById("target").value.trim());
        const intensity = encodeURIComponent(document.getElementById("intensity").value);
        const data = await getJson("/api/fun/random?target=" + target + "&intensity=" + intensity);
        renderOutput(data);
      }

      async function runVariant() {
        const variant = encodeURIComponent(document.getElementById("variant").value.trim());
        const target = encodeURIComponent(document.getElementById("target").value.trim());
        const intensity = encodeURIComponent(document.getElementById("intensity").value);
        if (!variant) {
          output.textContent = "Variant id required for this action.";
          return;
        }
        const data = await getJson("/api/fun/render?variant=" + variant + "&target=" + target + "&intensity=" + intensity);
        renderOutput(data);
      }

      async function searchCatalog() {
        const q = encodeURIComponent(document.getElementById("query").value.trim());
        const limit = encodeURIComponent(document.getElementById("limit").value);
        const data = await getJson("/api/fun/catalog?q=" + q + "&limit=" + limit);
        renderCatalog(data);
      }

      document.getElementById("run-random").addEventListener("click", () => runRandom().catch(err => { output.textContent = "Error: " + err.message; }));
      document.getElementById("run-variant").addEventListener("click", () => runVariant().catch(err => { output.textContent = "Error: " + err.message; }));
      document.getElementById("search").addEventListener("click", () => searchCatalog().catch(err => { meta.textContent = "Error: " + err.message; }));
      searchCatalog().catch(() => {});
    </script>
  </body>
</html>`);
});

app.get("/api/fun/catalog", requireAuth, rateLimitDashboard, async (req, res) => {
  try {
    const query = String(req.query.q || "");
    const limit = Number(req.query.limit || 20);
    const out = await getFunCatalog({ query, limit });
    res.json(out);
  } catch (err) {
    res.status(500).json({ ok: false, error: "fun-catalog-failed", detail: err?.message || "unknown" });
  }
});

app.get("/api/fun/random", requireAuth, rateLimitDashboard, async (req, res) => {
  try {
    const target = String(req.query.target || "").trim() || req.session?.username || "guest";
    const intensity = Number(req.query.intensity || 3);
    const out = await randomFunFromRuntime({
      actorTag: req.session?.username || "dashboard-user",
      target,
      intensity
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ ok: false, error: "fun-random-failed", detail: err?.message || "unknown" });
  }
});

app.get("/api/fun/render", requireAuth, rateLimitDashboard, async (req, res) => {
  try {
    const rawVariant = String(req.query.variant || "");
    const variantId = resolveVariantId(rawVariant);
    if (!variantId) {
      res.status(400).json({ ok: false, error: "bad-variant", detail: "Unknown variant id." });
      return;
    }
    const target = String(req.query.target || "").trim() || req.session?.username || "guest";
    const intensity = Number(req.query.intensity || 3);
    const out = await renderFunFromRuntime({
      variantId,
      actorTag: req.session?.username || "dashboard-user",
      target,
      intensity
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ ok: false, error: "fun-render-failed", detail: err?.message || "unknown" });
  }
});

app.get("/api/fun/pack", requireAuth, rateLimitDashboard, async (req, res) => {
  try {
    const count = Math.max(1, Math.min(10, Number(req.query.count || 3) || 3));
    const target = String(req.query.target || "").trim() || req.session?.username || "guest";
    const intensity = Number(req.query.intensity || 3);
    const items = [];
    for (let i = 0; i < count; i += 1) {
      const out = await randomFunFromRuntime({
        actorTag: req.session?.username || "dashboard-user",
        target,
        intensity
      });
      if (out?.ok) items.push(out);
    }
    res.json({ ok: true, source: items[0]?.source || "local", count: items.length, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: "fun-pack-failed", detail: err?.message || "unknown" });
  }
});

app.post("/api/me/pets", requireAuth, rateLimitDashboard, requireCsrf, async (req, res) => {
  const { name, type } = req.body;
  if (!name || !type) return res.status(400).json({ ok: false, error: "missing-fields" });
  
  // Basic validation
  if (name.length > 32) return res.status(400).json({ ok: false, error: "name-too-long" });
  
  const pet = await createPet(req.session.userId, type, name);
  res.json({ ok: true, pet });
});

app.post("/api/me/pets/:id/delete", requireAuth, rateLimitDashboard, requireCsrf, async (req, res) => {
  const petId = req.params.id;
  const deleted = await deletePet(petId, req.session.userId);
  if (!deleted) return res.status(404).json({ ok: false, error: "not-found" });
  res.json({ ok: true });
});

app.post("/api/agents/:id/disconnect", requireAuth, rateLimitDashboard, requireCsrf, requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const mgr = global.agentManager;
  const agent = mgr?.agents?.get?.(id) ?? null;
  if (!agent?.ws) {
    res.status(404).json({ ok: false, error: "agent-not-found" });
    return;
  }
  try {
    agent.ws.terminate();
  } catch {}
  res.json({ ok: true, action: "disconnected", agentId: id });
});

app.post("/api/agents/:id/restart", requireAuth, rateLimitDashboard, requireCsrf, requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const mgr = global.agentManager;
  const agent = mgr?.agents?.get?.(id) ?? null;
  if (!agent?.ws) {
    res.status(404).json({ ok: false, error: "agent-not-found" });
    return;
  }
  try {
    agent.ws.terminate();
  } catch {}
  res.json({ ok: true, action: "restarted", agentId: id });
});

app.post("/api/agents/:id/release", requireAuth, rateLimitDashboard, requireCsrf, requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const mgr = global.agentManager;
  const agent = mgr?.agents?.get?.(id) ?? null;
  if (!agent) {
    res.status(404).json({ ok: false, error: "agent-not-found" });
    return;
  }
  const guildId = agent.guildId;
  const voiceChannelId = agent.voiceChannelId;
  if (guildId && voiceChannelId && mgr) {
    try {
      await mgr.request(agent, "stop", {
        guildId,
        voiceChannelId,
        textChannelId: agent.textChannelId,
        ownerUserId: agent.ownerUserId,
        actorUserId: agent.ownerUserId
      });
    } catch {}
    try {
      mgr.releaseSession(guildId, voiceChannelId);
    } catch {}
  }
  res.json({ ok: true, action: "released", agentId: id });
});

app.post("/api/agents/:id/handoff", requireAuth, rateLimitDashboard, requireCsrf, requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const mgr = global.agentManager;
  const agent = mgr?.agents?.get?.(id) ?? null;
  if (!agent) {
    res.status(404).json({ ok: false, error: "agent-not-found" });
    return;
  }
  const guildId = agent.guildId;
  const voiceChannelId = agent.voiceChannelId;
  if (!guildId || !voiceChannelId) {
    res.status(400).json({ ok: false, error: "no-session" });
    return;
  }
  const idle = mgr.findIdleAgentInGuildRoundRobin(guildId);
  if (!idle) {
    res.status(400).json({ ok: false, error: "no-idle-agent" });
    return;
  }
  mgr.setPreferredAgent(guildId, voiceChannelId, idle.agentId, 300_000);
  res.json({ ok: true, action: "handoff", from: id, to: idle.agentId });
});

app.post("/api/guild/:id/music/default", requireAuth, rateLimitDashboard, requireCsrf, async (req, res) => {
  const guildId = String(req.params.id || "");
  const mode = String(req.body?.mode || "open");
  const defaultVolume = req.body?.defaultVolume;
  if (!guildId || !isSnowflake(guildId)) {
    res.status(400).json({ ok: false, error: "bad-guild" });
    return;
  }

  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  if (!canManage) {
    res.status(403).json({ ok: false, error: "manage-required" });
    return;
  }

  const out = await setDefaultMusicMode(guildId, mode);
  if (defaultVolume !== undefined) await setDefaultMusicVolume(guildId, defaultVolume);
  await auditLog({
    guildId,
    userId: req.session?.userId ?? "unknown",
    action: "music.default.set",
    details: { mode: out.defaultMode, defaultVolume, source: "dashboard" }
  });
  res.json({ ok: true, ...out });
});

app.post("/api/guild/:id/music/control", requireAuth, rateLimitDashboard, requireCsrf, requireGuildAdminOrOwner(), async (req, res) => {
  const guildId = String(req.params.id || "");
  const { voiceChannelId, action, query } = req.body ?? {};
  if (!guildId || !isSnowflake(guildId) || !isSnowflake(String(voiceChannelId || "")) || !action) {
    res.status(400).json({ ok: false, error: "bad-request" });
    return;
  }

  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }

  const mgr = global.agentManager;
  if (!mgr) {
    res.status(503).json({ ok: false, error: "agents-not-ready" });
    return;
  }

  const opMap = {
    play: "play",
    pause: "pause",
    resume: "resume",
    skip: "skip",
    stop: "stop",
    now: "status",
    queue: "queue"
  };

  const op = opMap[String(action)];
  if (!op) {
    res.status(400).json({ ok: false, error: "bad-action" });
    return;
  }

  let agentRes;
  if (op === "play") {
    const alloc = mgr.ensureSessionAgent(guildId, voiceChannelId, {
      textChannelId: null,
      ownerUserId: req.session?.userId ?? "dashboard"
    });
    if (!alloc.ok) {
      res.status(400).json({ ok: false, error: alloc.reason });
      return;
    }
    const config = await getMusicConfig(guildId);
    agentRes = await sendAgentCommand(alloc.agent, "play", {
      guildId,
      voiceChannelId,
      textChannelId: null,
      ownerUserId: req.session?.userId ?? "dashboard",
      actorUserId: req.session?.userId ?? "dashboard",
      query: String(query || ""),
      defaultMode: config.defaultMode,
      defaultVolume: config.defaultVolume,
      limits: config.limits,
      adminToken: process.env.DASHBOARD_ADMIN_TOKEN,
      adminUserId: req.session?.userId ?? "dashboard"
    });
  } else {
    const sess = mgr.getSessionAgent(guildId, voiceChannelId);
    if (!sess.ok) {
      res.status(400).json({ ok: false, error: "no-session" });
      return;
    }
    agentRes = await sendAgentCommand(sess.agent, op, {
      guildId,
      voiceChannelId,
      textChannelId: null,
      ownerUserId: req.session?.userId ?? "dashboard",
      actorUserId: req.session?.userId ?? "dashboard",
      adminToken: process.env.DASHBOARD_ADMIN_TOKEN,
      adminUserId: req.session?.userId ?? "dashboard"
    });
  }

  res.json({ ok: true, result: agentRes ?? null });
});

app.get("/api/guild/:id/music/queue", requireAuth, rateLimitDashboard, requireGuildAdminOrOwner(), async (req, res) => {
  const guildId = String(req.params.id || "");
  const voiceChannelId = String(req.query.voiceChannelId || "");
  if (!guildId || !isSnowflake(guildId) || !isSnowflake(voiceChannelId)) {
    res.status(400).json({ ok: false, error: "bad-request" });
    return;
  }
  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const mgr = global.agentManager;
  if (!mgr) {
    res.status(503).json({ ok: false, error: "agents-not-ready" });
    return;
  }
  const sess = mgr.getSessionAgent(guildId, voiceChannelId);
  if (!sess.ok) {
    res.status(400).json({ ok: false, error: "no-session" });
    return;
  }
  const data = await sendAgentCommand(sess.agent, "queue", {
    guildId,
    voiceChannelId,
    adminToken: process.env.DASHBOARD_ADMIN_TOKEN,
    adminUserId: req.session?.userId ?? "dashboard"
  });
  res.json({ ok: true, ...data });
});

app.post("/api/guild/:id/music/remove", requireAuth, rateLimitDashboard, requireCsrf, requireGuildAdminOrOwner(), async (req, res) => {
  const guildId = String(req.params.id || "");
  const { voiceChannelId, index } = req.body ?? {};
  if (!guildId || !isSnowflake(guildId) || !isSnowflake(String(voiceChannelId || "")) || index === undefined) {
    res.status(400).json({ ok: false, error: "bad-request" });
    return;
  }
  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const mgr = global.agentManager;
  if (!mgr) {
    res.status(503).json({ ok: false, error: "agents-not-ready" });
    return;
  }
  const sess = mgr.getSessionAgent(guildId, voiceChannelId);
  if (!sess.ok) {
    res.status(400).json({ ok: false, error: "no-session" });
    return;
  }
  await sendAgentCommand(sess.agent, "remove", {
    guildId,
    voiceChannelId,
    index,
    adminToken: process.env.DASHBOARD_ADMIN_TOKEN,
    adminUserId: req.session?.userId ?? "dashboard"
  });
  res.json({ ok: true });
});

app.post("/api/guild/:id/music/preset", requireAuth, rateLimitDashboard, requireCsrf, requireGuildAdminOrOwner(), async (req, res) => {
  const guildId = String(req.params.id || "");
  const { voiceChannelId, preset } = req.body ?? {};
  if (!guildId || !isSnowflake(guildId) || !isSnowflake(String(voiceChannelId || "")) || !preset) {
    res.status(400).json({ ok: false, error: "bad-request" });
    return;
  }
  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const mgr = global.agentManager;
  if (!mgr) {
    res.status(503).json({ ok: false, error: "agents-not-ready" });
    return;
  }
  const sess = mgr.getSessionAgent(guildId, voiceChannelId);
  if (!sess.ok) {
    res.status(400).json({ ok: false, error: "no-session" });
    return;
  }
  await sendAgentCommand(sess.agent, "preset", {
    guildId,
    voiceChannelId,
    preset,
    adminToken: process.env.DASHBOARD_ADMIN_TOKEN,
    adminUserId: req.session?.userId ?? "dashboard"
  });
  res.json({ ok: true });
});

app.post("/api/guild/:id/assistant/config", requireAuth, rateLimitDashboard, requireCsrf, async (req, res) => {
  const guildId = String(req.params.id || "");
  if (!guildId || !isSnowflake(guildId)) {
    res.status(400).json({ ok: false, error: "bad-guild" });
    return;
  }

  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  if (!canManage) {
    res.status(403).json({ ok: false, error: "manage-required" });
    return;
  }

  const {
    enabled,
    maxListenSec,
    silenceMs,
    cooldownSec,
    allowRoleIds,
    allowChannelIds,
    maxSessions,
    voice,
    voicePresets
  } = req.body ?? {};

  const out = await setAssistantConfig(guildId, {
    enabled: enabled === undefined ? undefined : Boolean(enabled),
    maxListenSec: Number.isFinite(maxListenSec) ? maxListenSec : undefined,
    silenceMs: Number.isFinite(silenceMs) ? silenceMs : undefined,
    cooldownSec: Number.isFinite(cooldownSec) ? cooldownSec : undefined,
    allowRoleIds: Array.isArray(allowRoleIds) ? allowRoleIds : undefined,
    allowChannelIds: Array.isArray(allowChannelIds) ? allowChannelIds : undefined,
    maxSessions: Number.isFinite(maxSessions) ? maxSessions : undefined,
    voice: typeof voice === "string" ? voice : undefined,
    voicePresets: Array.isArray(voicePresets) ? voicePresets : undefined,
    channelVoices: channelVoices && typeof channelVoices === "object" ? channelVoices : undefined
  });
  await auditLog({
    guildId,
    userId: req.session?.userId ?? "unknown",
    action: "assistant.config.set",
    details: out.assistant ?? {}
  });
  res.json({ ok: true, assistant: out.assistant });
});

app.post("/api/guild/:id/assistant/control", requireAuth, rateLimitDashboard, requireCsrf, requireGuildAdminOrOwner(), async (req, res) => {
  const guildId = String(req.params.id || "");
  const { voiceChannelId, action, seconds, text } = req.body ?? {};
  if (!guildId || !isSnowflake(guildId) || !isSnowflake(String(voiceChannelId || "")) || !action) {
    res.status(400).json({ ok: false, error: "bad-request" });
    return;
  }

  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }

  const mgr = global.agentManager;
  if (!mgr) {
    res.status(503).json({ ok: false, error: "agents-not-ready" });
    return;
  }

  const op = String(action);
  const cfg = await getAssistantConfig(guildId);
  if (!cfg.enabled && op !== "leave" && op !== "stop") {
    res.status(400).json({ ok: false, error: "assistant-disabled" });
    return;
  }
  if (cfg.allowChannelIds?.length && !cfg.allowChannelIds.includes(String(voiceChannelId))) {
    res.status(400).json({ ok: false, error: "assistant-channel-not-allowed" });
    return;
  }

  let result = null;
  if (op === "join" || op === "start" || op === "listen" || op === "say") {
    if (Number.isFinite(cfg.maxSessions)) {
      const sess = mgr.getAssistantSessionAgent(guildId, voiceChannelId);
      const activeCount = countAssistantSessionsInGuild(guildId);
      if (!sess.ok && activeCount >= cfg.maxSessions) {
        res.status(400).json({ ok: false, error: "assistant-max-sessions" });
        return;
      }
    }
    const alloc = mgr.ensureAssistantAgent(guildId, voiceChannelId, {
      textChannelId: null,
      ownerUserId: req.session?.userId ?? "dashboard"
    });
    if (!alloc.ok) {
      res.status(400).json({ ok: false, error: alloc.reason });
      return;
    }
    if (op === "join") {
      result = await sendAgentCommand(alloc.agent, "assistantJoin", {
        guildId,
        voiceChannelId,
        adminToken: process.env.DASHBOARD_ADMIN_TOKEN,
        adminUserId: req.session?.userId ?? "dashboard"
      });
    } else if (op === "start") {
      result = await sendAgentCommand(alloc.agent, "assistantStart", {
        guildId,
        voiceChannelId,
        adminToken: process.env.DASHBOARD_ADMIN_TOKEN,
        adminUserId: req.session?.userId ?? "dashboard",
        config: cfg
      });
    } else if (op === "listen") {
      const sec = Math.max(2, Math.min(cfg.maxListenSec || 10, Math.trunc(Number(seconds) || 10)));
      result = await sendAgentCommand(alloc.agent, "assistantListen", {
        guildId,
        voiceChannelId,
        adminToken: process.env.DASHBOARD_ADMIN_TOKEN,
        adminUserId: req.session?.userId ?? "dashboard",
        durationMs: sec * 1000,
        silenceMs: cfg.silenceMs,
        voice: cfg.voice
      });
    } else if (op === "say") {
      result = await sendAgentCommand(alloc.agent, "assistantSay", {
        guildId,
        voiceChannelId,
        adminToken: process.env.DASHBOARD_ADMIN_TOKEN,
        adminUserId: req.session?.userId ?? "dashboard",
        text: String(text || ""),
        voice: cfg.voice
      });
    }
  } else if (op === "leave" || op === "stop") {
    const sess = mgr.getAssistantSessionAgent(guildId, voiceChannelId);
    if (sess.ok) {
      if (op === "stop") {
        result = await sendAgentCommand(sess.agent, "assistantStop", {
          guildId,
          voiceChannelId,
          adminToken: process.env.DASHBOARD_ADMIN_TOKEN,
          adminUserId: req.session?.userId ?? "dashboard"
        });
      } else {
        result = await sendAgentCommand(sess.agent, "assistantLeave", {
          guildId,
          voiceChannelId,
          adminToken: process.env.DASHBOARD_ADMIN_TOKEN,
          adminUserId: req.session?.userId ?? "dashboard"
        });
        mgr.releaseAssistantSession(guildId, voiceChannelId);
      }
    }
  } else {
    res.status(400).json({ ok: false, error: "bad-action" });
    return;
  }

  res.json({ ok: true, result });
});

app.post("/api/guild/:id/assistant/install-voice", requireAuth, rateLimitDashboard, requireCsrf, requireGuildAdminOrOwner(), async (req, res) => {
  const preset = String(req.body?.preset || "").trim();
  if (!preset) {
    res.status(400).json({ ok: false, error: "missing-preset" });
    return;
  }
  const map = loadVoicePresetMap();
  if (!map[preset]) {
    res.status(400).json({ ok: false, error: "unknown-preset" });
    return;
  }
  const child = spawn("node", ["scripts/voice-install-preset.js", preset], {
    stdio: "ignore",
    detached: true
  });
  child.unref();
  res.json({ ok: true, preset });
});

app.post("/api/guild/:id/voice/lobby/:channelId", requireAuth, rateLimitDashboard, requireCsrf, async (req, res) => {
  const guildId = String(req.params.id || "");
  const channelId = String(req.params.channelId || "");
  const patch = req.body ?? {};
  if (!guildId || !isSnowflake(guildId) || !isSnowflake(channelId)) {
    res.status(400).json({ ok: false, error: "bad-request" });
    return;
  }

  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  if (!canManage) {
    res.status(403).json({ ok: false, error: "manage-required" });
    return;
  }

  const out = await updateLobby(guildId, channelId, patch);
  await auditLog({
    guildId,
    userId: req.session?.userId ?? "unknown",
    action: "voice.lobby.update",
    details: { channelId, patch, source: "dashboard" }
  });
  res.json({ ok: true, ...out });
});

app.post("/api/guild/:id/voice/lobby/add", requireAuth, rateLimitDashboard, requireCsrf, async (req, res) => {
  const guildId = String(req.params.id || "");
  const { channelId, categoryId, template, userLimit, bitrateKbps, maxChannels } = req.body ?? {};
  if (!guildId || !isSnowflake(guildId) || !isSnowflake(String(channelId || "")) || !isSnowflake(String(categoryId || ""))) {
    res.status(400).json({ ok: false, error: "bad-request" });
    return;
  }

  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  if (!canManage) {
    res.status(403).json({ ok: false, error: "manage-required" });
    return;
  }

  const out = await addLobby(guildId, channelId, categoryId, template || "{user}'s room", {
    userLimit,
    bitrateKbps,
    maxChannels
  });
  await auditLog({
    guildId,
    userId: req.session?.userId ?? "unknown",
    action: "voice.lobby.add",
    details: { channelId, categoryId, userLimit, bitrateKbps, maxChannels, source: "dashboard" }
  });
  res.json({ ok: true, ...out });
});

app.post("/api/guild/:id/voice/lobby/remove", requireAuth, rateLimitDashboard, requireCsrf, async (req, res) => {
  const guildId = String(req.params.id || "");
  const { channelId } = req.body ?? {};
  if (!guildId || !isSnowflake(guildId) || !isSnowflake(String(channelId || ""))) {
    res.status(400).json({ ok: false, error: "bad-request" });
    return;
  }

  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  if (!canManage) {
    res.status(403).json({ ok: false, error: "manage-required" });
    return;
  }

  const out = await removeLobby(guildId, channelId);
  await auditLog({
    guildId,
    userId: req.session?.userId ?? "unknown",
    action: "voice.lobby.remove",
    details: { channelId, source: "dashboard" }
  });
  res.json({ ok: true, ...out });
});

app.post("/api/guild/:id/voice/lobby/toggle", requireAuth, rateLimitDashboard, requireCsrf, async (req, res) => {
  const guildId = String(req.params.id || "");
  const { channelId, enable } = req.body ?? {};
  if (!guildId || !isSnowflake(guildId) || !isSnowflake(String(channelId || ""))) {
    res.status(400).json({ ok: false, error: "bad-request" });
    return;
  }

  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  const canManage = manageGuildPerms(guild);
  const access = await hasDashboardAccess(guildId, req.session?.userId, canManage);
  if (!access.ok) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  if (!canManage) {
    res.status(403).json({ ok: false, error: "manage-required" });
    return;
  }

  const out = await setLobbyEnabled(guildId, channelId, Boolean(enable));
  await auditLog({
    guildId,
    userId: req.session?.userId ?? "unknown",
    action: "voice.lobby.toggle",
    details: { channelId, enable: Boolean(enable), source: "dashboard" }
  });
  res.json({ ok: true, ...out });
});

app.post("/api/guild/:id/dashboard/permissions", requireAuth, rateLimitDashboard, requireCsrf, async (req, res) => {
  const guildId = String(req.params.id || "");
  const { allowUserIds, allowRoleIds } = req.body ?? {};
  if (!guildId || !isSnowflake(guildId)) {
    res.status(400).json({ ok: false, error: "bad-request" });
    return;
  }
  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild || !manageGuildPerms(guild)) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  await setDashboardPerms(guildId, { allowUserIds, allowRoleIds });
  res.json({ ok: true });
});

app.post("/api/guild/:id/commands/toggle", requireAuth, rateLimitDashboard, requireCsrf, async (req, res) => {
  const guildId = String(req.params.id || "");
  const { command, enabled } = req.body ?? {};
  if (!guildId || !isSnowflake(guildId) || !command) {
    res.status(400).json({ ok: false, error: "bad-request" });
    return;
  }
  const guilds = (await apiGet("https://discord.com/api/users/@me/guilds", req.session.accessToken)) || [];
  const guild = guilds.find(g => g.id === guildId);
  if (!guild || !manageGuildPerms(guild)) {
    res.status(403).json({ ok: false, error: "no-permission" });
    return;
  }
  await setCommandEnabled(guildId, command, Boolean(enabled));
  res.json({ ok: true });
});

app.listen(DASHBOARD_PORT, () => {
  console.log(`[dashboard] listening on :${DASHBOARD_PORT}`);
});
