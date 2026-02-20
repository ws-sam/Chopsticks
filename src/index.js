// src/index.js
// ENTRY

import "dotenv/config";

// ===================== CONFIGURATION VALIDATION =====================
if (process.env.STORAGE_DRIVER !== 'postgres') {
  console.error("FATAL: STORAGE_DRIVER environment variable must be set to 'postgres'.");
  process.exit(1);
}

if (!process.env.AGENT_TOKEN_KEY || process.env.AGENT_TOKEN_KEY.length !== 64) {
  console.error("FATAL: AGENT_TOKEN_KEY environment variable is missing or is not a 64-character (32-byte) hex key.");
  process.exit(1);
}
console.log("✅ Configuration validated.");
// ====================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { ActivityType, Client, Collection, GatewayIntentBits, Events, Partials } from "discord.js";
import { AgentManager } from "./agents/agentManager.js";
import { handleButton as handleAgentsButton, handleSelect as handleAgentsSelect } from "./commands/agents.js";
import {
  handleButton as handleMusicButton,
  handleSelect as handleMusicSelect,
  maybeHandleAudioDropMessage,
  maybeHandlePlaylistIngestMessage,
  handleModal as handleMusicModal
} from "./commands/music.js";
import { handleButton as handleAssistantButton } from "./commands/assistant.js";
import { handleButton as handleCommandsButton, handleSelect as handleCommandsSelect } from "./commands/commands.js";
import { handleButton as handlePoolsButton, handleSelect as handlePoolsSelect } from "./commands/pools.js";
import {
  handleButton as handleVoiceButton,
  handleSelect as handleVoiceSelect,
  handleModal as handleVoiceModal
} from "./commands/voice.js";
import { handleSelect as handleHelpSelect } from "./commands/help.js";
import { handleModal as handleModelModal } from "./commands/model.js";
import { handleAiModal } from "./commands/ai.js";
import { registerAllCommands } from "../scripts/registerAllCommands.js";
import { handleButton as handlePurgeButton } from "./commands/purge.js";
import { handleButton as handleGameButton, handleSelect as handleGameSelect } from "./commands/game.js";
import { handleButton as handleQuestsButton } from "./commands/quests.js";
import { handleButton as handleCraftButton, handleSelect as handleCraftSelect } from "./commands/craft.js";
import { handleButton as handleTriviaButton, handleSelect as handleTriviaSelect } from "./commands/trivia.js";
import { handleButton as handleSetupButton, handleSelect as handleSetupSelect } from "./commands/setup.js";
import { handleButton as handleTicketsButton, handleSelect as handleTicketsSelect } from "./commands/tickets.js";
import { handleButton as handleTutorialsButton, handleSelect as handleTutorialsSelect } from "./commands/tutorials.js";
import {
  startHealthServer,
  getAndResetCommandDeltas
} from "./utils/healthServer.js";
import { flushCommandStats, flushCommandStatsDaily } from "./utils/audit.js";
import { checkRateLimit } from "./utils/ratelimit.js";
import { getRateLimitForCommand } from "./utils/rateLimitConfig.js";
import { canRunCommand, canRunPrefixCommand } from "./utils/permissions.js";
import { getPrefixCommands } from "./prefix/registry.js";
import { checkMetaPerms } from "./prefix/applyMetaPerms.js";
import { parsePrefixArgs, resolveAliasedCommand, suggestCommandNames } from "./prefix/hardening.js";
import { loadGuildData } from "./utils/storage.js";
import { addCommandLog } from "./utils/commandlog.js";
import { botLogger } from "./utils/modernLogger.js";
import { trackCommand, trackRateLimit } from "./utils/metrics.js";
import { buildErrorEmbed, replyInteraction, replyInteractionIfFresh } from "./utils/interactionReply.js";
import { patchInteractionUiMethods } from "./utils/interactionUiPatch.js";
import { generateCorrelationId } from "./utils/logger.js";
import { claimIdempotencyKey } from "./utils/idempotency.js";
import { installProcessSafety } from "./utils/processSafety.js";
import { recordUserCommandStat } from "./profile/usage.js";
import { runGuildEventAutomations } from "./utils/automations.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===================== CLIENT ===================== */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildIntegrations
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User]
});

installProcessSafety("chopsticks-bot", botLogger);

global.client = client;
client.commands = new Collection();

/* ===================== AGENTS ===================== */

global.agentManager = null;

/* ===================== HEALTH/METRICS ===================== */

const healthServer = startHealthServer();

/* ===================== COMMAND LOADER ===================== */

const commandsPath = path.join(__dirname, "commands");

if (fs.existsSync(commandsPath)) {
  const files = fs
    .readdirSync(commandsPath, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith(".js"))
    .map(d => d.name)
    .sort();

  for (const file of files) {
    const filePath = path.join(commandsPath, file);

    let mod;
    try {
      mod = await import(pathToFileURL(filePath).href);
    } catch (err) {
      console.error(`[command:load] ${file} failed`, err);
      continue;
    }

    let cmd =
      mod.default ??
      (mod.data && mod.execute
        ? { data: mod.data, execute: mod.execute, meta: mod.meta, autocomplete: mod.autocomplete }
        : null);

    if (cmd && !cmd.autocomplete && typeof mod.autocomplete === "function") {
      cmd = { ...cmd, autocomplete: mod.autocomplete };
    }

    if (!cmd?.data?.name || typeof cmd.execute !== "function") continue;

    client.commands.set(cmd.data.name, cmd);
  }
}

/* ===================== EVENT LOADER ===================== */

const eventsPath = path.join(__dirname, "events");

if (fs.existsSync(eventsPath)) {
  const files = fs
    .readdirSync(eventsPath, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith(".js"))
    .map(d => d.name)
    .sort();

  for (const file of files) {
    const filePath = path.join(eventsPath, file);

    let mod;
    try {
      mod = await import(pathToFileURL(filePath).href);
    } catch (err) {
      console.error(`[event:load] ${file} failed`, err);
      continue;
    }

    const event = mod.default;
    if (!event?.name || typeof event.execute !== "function") continue;

    client.on(event.name, async (...args) => {
      try {
        await event.execute(...args);
      } catch (err) {
        console.error(`[event:${event.name}]`, err);
      }
    });
  }
}

// Dev API Imports
import express from 'express';
import { updateAgentBotStatus, ensureSchema, ensureEconomySchema } from "./utils/storage.js";
import { runMigrations } from "./utils/migrations/runner.js";

/* ===================== DEV API SERVER ===================== */
const devApiApp = express();
const DEV_API_PORT = process.env.DEV_API_PORT || 3002;
const DEV_API_USERNAME = process.env.DEV_API_USERNAME;
const DEV_API_PASSWORD = process.env.DEV_API_PASSWORD;
const DEV_API_ENABLED = String(process.env.DEV_API_ENABLED ?? "true").toLowerCase() !== "false";
const DEV_API_ALLOW_INSECURE =
  String(process.env.DEV_API_ALLOW_INSECURE ?? "false").toLowerCase() === "true";
const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

// Basic Authentication Middleware for Dev API
function authenticateDevApi(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic');
    return res.status(401).send('Authentication required for Dev API.');
  }

  const parts = authHeader.split(" ");
  const type = parts[0];
  const credentials = parts.slice(1).join(" ");
  if (type !== 'Basic' || !credentials) {
    return res.status(401).send('Unsupported authentication type for Dev API.');
  }

  let decoded = "";
  try {
    decoded = Buffer.from(credentials, "base64").toString("utf8");
  } catch {
    return res.status(401).send("Invalid authentication header.");
  }
  const idx = decoded.indexOf(":");
  const username = idx >= 0 ? decoded.slice(0, idx) : decoded;
  const password = idx >= 0 ? decoded.slice(idx + 1) : "";

  // Timing-safe compare (best effort) to reduce oracle-style leaks.
  const uOk =
    typeof DEV_API_USERNAME === "string" &&
    Buffer.byteLength(username) === Buffer.byteLength(DEV_API_USERNAME) &&
    timingSafeEqual(Buffer.from(username), Buffer.from(DEV_API_USERNAME));
  const pOk =
    typeof DEV_API_PASSWORD === "string" &&
    Buffer.byteLength(password) === Buffer.byteLength(DEV_API_PASSWORD) &&
    timingSafeEqual(Buffer.from(password), Buffer.from(DEV_API_PASSWORD));

  if (uOk && pOk) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic');
    res.status(401).send('Invalid Dev API credentials.');
  }
}

devApiApp.disable("x-powered-by");
devApiApp.use(express.json({ limit: "200kb" }));
devApiApp.use((req, res, next) => {
  const requestId = String(req.headers["x-correlation-id"] || generateCorrelationId());
  const startedAt = Date.now();
  req.requestId = requestId;
  res.setHeader("x-correlation-id", requestId);
  botLogger.info({ requestId, method: req.method, path: req.path }, "Dev API request");
  res.on("finish", () => {
    botLogger.info(
      {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt
      },
      "Dev API response"
    );
  });
  next();
});

const devApiHasCreds = Boolean(DEV_API_USERNAME && DEV_API_PASSWORD);
if (devApiHasCreds) {
  devApiApp.use(authenticateDevApi);
} else {
  const msg =
    "DEV_API_USERNAME / DEV_API_PASSWORD not set. Dev API is disabled unless DEV_API_ALLOW_INSECURE=true (non-production).";
  if (isProd) botLogger.error(msg);
  else botLogger.warn(msg);
}

// Dev API Endpoints
devApiApp.get('/dev-api/status', async (req, res) => {
  const mgr = global.agentManager;
  if (!mgr) {
    return res.status(503).json({ error: 'AgentManager not initialized.' });
  }

  try {
    const agents = await mgr.listAgents(); // All agent info, including registered and active
    res.json({
      botStatus: client.isReady() ? 'online' : 'offline',
      uptime: process.uptime(),
      agents: agents,
      sessions: mgr.listSessions(),
      assistantSessions: mgr.listAssistantSessions(),
    });
  } catch (error) {
    console.error("Error fetching dev API status:", error);
    res.status(500).json({ error: error.message });
  }
});

devApiApp.post('/dev-api/agents/refresh-tokens', async (req, res) => {
  const mgr = global.agentManager;
  if (!mgr) {
    return res.status(503).json({ error: 'AgentManager not initialized.' });
  }
  try {
    await mgr.loadRegisteredAgentsFromDb();
    res.json({ message: 'Agent tokens refreshed from database.' });
  } catch (error) {
    console.error("Error refreshing agent tokens:", error);
    res.status(500).json({ error: error.message });
  }
});

devApiApp.post('/dev-api/agents/restart/:agentId', async (req, res) => {
  const agentId = req.params.agentId;
  const mgr = global.agentManager;
  if (!mgr) {
    return res.status(503).json({ error: 'AgentManager not initialized.' });
  }
  const agent = mgr.activeAgents.get(agentId);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found or not active.' });
  }

  try {
    // Send stop_agent to the runner
    await mgr.sendRunnerCommand(agent.runnerWs, "stop_agent", { agentId });
    // After stopping, AgentManager's ensureSessionAgent will pick it up and restart if needed
    res.json({ message: `Restart signal sent to agent ${agentId}.` });
  } catch (error) {
    console.error(`Error restarting agent ${agentId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

devApiApp.post('/dev-api/agents/stop/:agentId', async (req, res) => {
  const agentId = req.params.agentId;
  const mgr = global.agentManager;
  if (!mgr) {
    return res.status(503).json({ error: 'AgentManager not initialized.' });
  }
  const agent = mgr.activeAgents.get(agentId);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found or not active.' });
  }

  try {
    // Send stop_agent to the runner
    await mgr.sendRunnerCommand(agent.runnerWs, "stop_agent", { agentId });
    // Also mark as inactive in DB to prevent automatic restart by AgentManager
    await updateAgentBotStatus(agentId, 'inactive');
    res.json({ message: `Agent ${agentId} stopped and marked inactive.` });
  } catch (error) {
    console.error(`Error stopping agent ${agentId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

devApiApp.post('/dev-api/agents/start/:agentId', async (req, res) => {
  const agentId = req.params.agentId;
  const mgr = global.agentManager;
  if (!mgr) {
    return res.status(503).json({ error: 'AgentManager not initialized.' });
  }

  try {
    // Mark as active in DB
    await updateAgentBotStatus(agentId, 'active');
    // Force AgentManager to refresh its registered agents
    await mgr.loadRegisteredAgentsFromDb();
    // AgentManager's ensureSessionAgent logic will pick up and start it if needed
    res.json({ message: `Agent ${agentId} marked active. AgentManager will attempt to start it.` });
  } catch (error) {
    console.error(`Error starting agent ${agentId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

if (DEV_API_ENABLED) {
  if (devApiHasCreds || (!isProd && DEV_API_ALLOW_INSECURE)) {
    const bindHost =
      !devApiHasCreds && !isProd && DEV_API_ALLOW_INSECURE ? "127.0.0.1" : undefined;
    devApiApp.listen(DEV_API_PORT, bindHost, () => {
      const hostLabel = bindHost ? `${bindHost}:${DEV_API_PORT}` : `:${DEV_API_PORT}`;
      console.log(`[dev-api] listening on ${hostLabel} (auth=${devApiHasCreds ? "basic" : "open-local"})`);
    });
  } else {
    botLogger.warn({ port: DEV_API_PORT }, "Dev API not started (missing credentials).");
  }
} else {
  botLogger.info("DEV_API_ENABLED=false - Dev API disabled.");
}
/* ===================== END DEV API SERVER ===================== */

/* ===================== INTERACTIONS ===================== */

client.once(Events.ClientReady, async () => {
  console.log(`✅ Ready as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} guilds`);
  
  // Auto-register all commands in help registry
  try {
    await registerAllCommands();
    console.log(`📚 Help registry initialized with ${client.commands.size} commands`);
  } catch (err) {
    console.warn(`⚠️  Help registry initialization failed: ${err.message}`);
  }

  // Presence is a UX hint, not a control plane. Keep it best-effort and non-fatal.
  try {
    const enabled = String(process.env.BOT_PRESENCE_ENABLED ?? "true").toLowerCase() !== "false";
    if (enabled && client.user) {
      const text = String(process.env.BOT_PRESENCE_TEXT || "/tutorials").trim() || "/tutorials";
      client.user.setPresence({
        activities: [{ name: text.slice(0, 128), type: ActivityType.Watching }],
        status: String(process.env.BOT_PRESENCE_STATUS || "online")
      });
    }
  } catch {}

  const mgr = new AgentManager({
    host: process.env.AGENT_CONTROL_HOST,
    port: process.env.AGENT_CONTROL_PORT
  });

  global.agentManager = mgr;

  try {
    await mgr.start();
    console.log(`🧩 Agent control listening on ws://${mgr.host}:${mgr.port}`);
    
    // Update health server with agent manager for debug dashboard
    startHealthServer(mgr);
  } catch (err) {
    console.error("❌ Agent control startup failed:", err?.message ?? err);
    return;
  }

  // Ensure database schema is up-to-date
  try {
    await ensureSchema();
    console.log("✅ Database schema ensured.");
    await ensureEconomySchema();
    console.log("✅ Economy schema ensured.");
    
    // Run database migrations (Level 1: Invariants Locked)
    await runMigrations();
    console.log("✅ Database migrations completed.");
  } catch (err) {
    console.error("❌ Database schema assurance failed:", err?.message ?? err);
    return;
  }


  // Agent spawning and scaling are now handled by agentRunner processes
  // which poll the database for agent configurations.
  // The global.__agentsChild and agentTimer logic has been removed from here.

  const flushMs = Math.max(5_000, Math.trunc(Number(process.env.ANALYTICS_FLUSH_MS || 15000)));
  const flushTimer = setInterval(() => {
    const deltas = getAndResetCommandDeltas();
    const rows = [];
    for (const r of deltas.global) {
      rows.push({ guildId: null, ...r });
    }
    for (const r of deltas.perGuild) {
      rows.push({ guildId: r.guildId, command: r.command, ok: r.ok, err: r.err, totalMs: r.totalMs, count: r.count });
    }
    if (rows.length) {
      flushCommandStats(rows).catch(() => {});
      flushCommandStatsDaily(rows).catch(() => {});
    }
  }, flushMs);

  const shutdown = async () => {
    clearInterval(flushTimer);

    try {
      const deltas = getAndResetCommandDeltas();
      const rows = [];
      for (const r of deltas.global) rows.push({ guildId: null, ...r });
      for (const r of deltas.perGuild) {
        rows.push({ guildId: r.guildId, command: r.command, ok: r.ok, err: r.err, totalMs: r.totalMs, count: r.count });
      }
      if (rows.length) {
        await flushCommandStats(rows);
        await flushCommandStatsDaily(rows);
      }
    } catch {}

    // global.__agentsChild removed as PM2 manages agentRunner processes
    // (Old code for killing child process removed from here)

    try {
      await client.destroy();
    } catch {}

    try {
      healthServer?.close?.();
    } catch {}

    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  /* ===================== TRACK BOT REMOVALS ===================== */
  // When any bot (including agents) leaves a guild, update agent tracking
  client.on(Events.GuildDelete, async guild => {
    try {
      console.log(`[GUILD_DELETE] Main bot removed from guild ${guild.id} (${guild.name})`);
      
      // Check if any agent was in this guild and remove it
      let removedCount = 0;
      for (const agent of mgr.liveAgents.values()) {
        if (agent.guildIds?.has?.(guild.id)) {
          agent.guildIds.delete(guild.id);
          removedCount++;
          console.log(`[GUILD_DELETE] Removed agent ${agent.agentId} from guild ${guild.id}`);
        }
      }
      
      if (removedCount > 0) {
        console.log(`[GUILD_DELETE] Cleaned up ${removedCount} agent(s) from guild ${guild.id}`);
      }
    } catch (err) {
      console.error("[GUILD_DELETE] Error:", err.message);
    }
  });

  // Also verify agent guild membership when deploy is called
  const originalBuildDeployPlan = mgr.buildDeployPlan.bind(mgr);
  mgr.buildDeployPlan = async function(guildId, desiredCount, poolId = null) {
    try {
      // Get the guild to verify all agents' membership
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (guild) {
        console.log(`[DEPLOY_VERIFY] Checking ${this.liveAgents.size} agents for guild ${guildId}`);
        
        // Collect all bot user IDs to check
        const agentsToCheck = [];
        for (const agent of this.liveAgents.values()) {
          if (agent.guildIds?.has?.(guildId) && agent.botUserId) {
            agentsToCheck.push(agent);
          }
        }

        console.log(`[DEPLOY_VERIFY] Found ${agentsToCheck.length} agents claiming to be in guild ${guildId}`);

        if (agentsToCheck.length > 0) {
          // Fetch all members at once (more efficient than one-by-one)
          const members = await guild.members.fetch({ 
            user: agentsToCheck.map(a => a.botUserId),
            force: true // Force cache refresh to ensure accuracy
          }).catch(err => {
            console.error(`[DEPLOY_VERIFY] Failed to fetch members:`, err.message);
            return new Map();
          });
          
          console.log(`[DEPLOY_VERIFY] Discord API returned ${members.size} members`);
          
          // Check which agents are missing
          let removedCount = 0;
          for (const agent of agentsToCheck) {
            if (!members.has(agent.botUserId)) {
              // Bot was kicked but we didn't know
              agent.guildIds.delete(guildId);
              removedCount++;
              console.log(`[DEPLOY_VERIFY] Agent ${agent.agentId} (${agent.botUserId}) removed from guild ${guildId} - not found in member list`);
            } else {
              console.log(`[DEPLOY_VERIFY] Agent ${agent.agentId} (${agent.botUserId}) confirmed in guild ${guildId}`);
            }
          }
          
          if (removedCount > 0) {
            console.log(`[DEPLOY_VERIFY] Removed ${removedCount} stale agent(s) from guild ${guildId} cache`);
          }
        }
      } else {
        console.warn(`[DEPLOY_VERIFY] Could not fetch guild ${guildId} - bot may not be in this guild`);
      }
    } catch (err) {
      console.error("[DEPLOY_VERIFY] Error verifying agent membership:", err.message);
    }
    
    // Call original method with all parameters
    return originalBuildDeployPlan(guildId, desiredCount, poolId);
  };
});

/* ===================== PREFIX COMMANDS ===================== */

const prefixCommands = await getPrefixCommands();
const MUTATION_COMMANDS = new Set([
  "daily",
  "work",
  "pay",
  "bank",
  "gather",
  "use",
  "warn",
  "timeout",
  "ban",
  "kick",
  "purge",
  "pools",
  "agents"
]);

client.on(Events.MessageCreate, async message => {
  if (message.author?.bot) return;

  if (message.guildId) {
    void runGuildEventAutomations({
      guild: message.guild,
      eventKey: "message_create",
      channel: message.channel,
      user: message.author,
      message
    }).catch(() => {});
  }

  let prefix = "!";
  let aliases = {};
  let guildData = null;
  if (message.guildId) {
    try {
      guildData = await loadGuildData(message.guildId);
      prefix = guildData?.prefix?.value || "!";
      aliases = guildData?.prefix?.aliases || {};
    } catch {}
  }

  // Music "Audio Drops": if enabled for this channel, show a button-driven panel
  // to play uploaded audio attachments in voice via agents.
  if (message.guildId && guildData) {
    void maybeHandleAudioDropMessage(message, guildData).catch(() => {});
    void maybeHandlePlaylistIngestMessage(message, guildData).catch(() => {});
  }

  if (!message.content?.startsWith(prefix)) return;

  const raw = message.content.slice(prefix.length).trim();
  if (!raw) return;

  const parts = parsePrefixArgs(raw);
  if (!parts.length) return;
  const requestedName = String(parts.shift() || "").toLowerCase();
  const aliasResolution = resolveAliasedCommand(requestedName, aliases, 20);
  if (!aliasResolution.ok) {
    if (aliasResolution.error === "cycle" || aliasResolution.error === "depth" || aliasResolution.error === "invalid-target") {
      try {
        const hintRate = await checkRateLimit(`pfx:aliaswarn:${message.author.id}`, 1, 15);
        if (hintRate.ok) {
          await message.reply("Alias configuration error detected. Run `/alias list` and fix alias chains.");
        }
      } catch {}
    }
    return;
  }
  const name = aliasResolution.commandName;

  // prefix rate limit
  try {
    const rl = await checkRateLimit(`pfx:${message.author.id}:${name}`, 5, 10);
    if (!rl.ok) return;
  } catch {}

  let cmd = prefixCommands.get(name);
  if (!cmd && message.guildId && guildData) {
    try {
      const custom = guildData.customCommands?.[name];
      if (custom?.response) {
        const rendered = custom.response
          .replace("{user}", `<@${message.author.id}>`)
          .replace("{user.tag}", message.author.tag)
          .replace("{guild}", message.guild?.name || "")
          .replace("{channel}", message.channel?.name || "");
        await message.reply(rendered);
        return;
      }
      const macro = guildData.macros?.[name];
      if (Array.isArray(macro) && macro.length) {
        let count = 0;
        for (const step of macro) {
          if (count++ >= 10) break;
          const target = prefixCommands.get(step.name);
          if (!target) continue;
          const gate2 = await canRunPrefixCommand(message, step.name, target);
          if (!gate2.ok) continue;
          await target.execute(message, step.args || [], { prefix, commands: prefixCommands });
        }
        return;
      }
    } catch {}
  }
  if (!cmd) {
    const candidates = [
      ...prefixCommands.keys(),
      ...Object.keys(aliases || {}),
      ...Object.keys(guildData?.customCommands || {}),
      ...Object.keys(guildData?.macros || {})
    ];
    const suggestions = suggestCommandNames(name, candidates, 3);
    if (suggestions.length) {
      try {
        const hintRate = await checkRateLimit(`pfx:unknown:${message.author.id}`, 1, 15);
        if (hintRate.ok) {
          const line = suggestions.map(s => `\`${prefix}${s}\``).join(", ");
          await message.reply(`Unknown command \`${name}\`. Try: ${line}`);
        }
      } catch {}
    }
    return;
  }

  const gate = await canRunPrefixCommand(message, cmd.name, cmd);
  if (!gate.ok) return;

  // Enforce slash-command meta.userPerms for prefix path
  const permCheck = await checkMetaPerms(message, name);
  if (!permCheck.ok) {
    await message.reply({ content: `❌ ${permCheck.reason}` });
    return;
  }

  const prefixStartedAt = Date.now();
  try {
    await cmd.execute(message, parts, { prefix, commands: prefixCommands });
    const duration = Date.now() - prefixStartedAt;
    void recordUserCommandStat({
      userId: message.author.id,
      command: cmd.name,
      ok: true,
      durationMs: duration,
      source: "prefix"
    }).catch(() => {});
    if (message.guildId) {
      await addCommandLog(message.guildId, {
        name: cmd.name,
        userId: message.author.id,
        at: Date.now(),
        ok: true,
        source: "prefix"
      });
    }
  } catch (err) {
    console.error(`[prefix:${cmd.name}]`, err);
    const duration = Date.now() - prefixStartedAt;
    void recordUserCommandStat({
      userId: message.author.id,
      command: cmd.name,
      ok: false,
      durationMs: duration,
      source: "prefix"
    }).catch(() => {});
    if (message.guildId) {
      await addCommandLog(message.guildId, {
        name: cmd.name,
        userId: message.author.id,
        at: Date.now(),
        ok: false,
        source: "prefix"
      });
    }
    try { await message.reply("Command failed."); } catch {}
  }
});

/* ===================== INTERACTIONS ===================== */

client.on(Events.InteractionCreate, async interaction => {
  patchInteractionUiMethods(interaction);

  if (
    interaction.isStringSelectMenu?.() ||
    interaction.isRoleSelectMenu?.() ||
    interaction.isUserSelectMenu?.()
  ) {
    try {
      if (await handleAgentsSelect(interaction)) return;
      if (await handlePoolsSelect(interaction)) return;
      if (await handleTicketsSelect(interaction)) return;
      if (await handleSetupSelect(interaction)) return;
      if (await handleTriviaSelect(interaction)) return;
      if (await handleGameSelect(interaction)) return;
      if (await handleCraftSelect(interaction)) return;
      if (await handleTutorialsSelect(interaction)) return;
      if (await handleHelpSelect(interaction)) return;
      if (await handleMusicSelect(interaction)) return;
      if (await handleCommandsSelect(interaction)) return;
      if (await handleVoiceSelect(interaction)) return;
    } catch (err) {
      console.error("[select]", err?.stack ?? err?.message ?? err);
      try {
        await replyInteractionIfFresh(interaction, {
          embeds: [buildErrorEmbed("Selection failed.")]
        });
      } catch {}
    }
  }

  if (interaction.isButton?.()) {
    try {
      if (await handleAgentsButton(interaction)) return;
      if (await handlePoolsButton(interaction)) return;
      if (await handleTicketsButton(interaction)) return;
      if (await handleSetupButton(interaction)) return;
      if (await handleTriviaButton(interaction)) return;
      if (await handleGameButton(interaction)) return;
      if (await handleQuestsButton(interaction)) return;
      if (await handleCraftButton(interaction)) return;
      if (await handleMusicButton(interaction)) return;
      if (await handleAssistantButton(interaction)) return;
      if (await handleCommandsButton(interaction)) return;
      if (await handleVoiceButton(interaction)) return;
      if (await handlePurgeButton(interaction)) return;
      if (await handleTutorialsButton(interaction)) return;
    } catch (err) {
      console.error("[button]", err?.stack ?? err?.message ?? err);
      try {
        await replyInteractionIfFresh(interaction, {
          embeds: [buildErrorEmbed("Button action failed.")]
        });
      } catch {}
    }
  }

  if (interaction.isModalSubmit?.()) {
    try {
      if (await handleMusicModal(interaction)) return;
      if (await handleVoiceModal(interaction)) return;
      if (await handleModelModal(interaction)) return;
      if (await handleAiModal(interaction)) return;
    } catch (err) {
      console.error("[modal]", err?.stack ?? err?.message ?? err);
      try {
        await replyInteractionIfFresh(interaction, {
          embeds: [buildErrorEmbed("Form submit failed.")]
        });
      } catch {}
    }
  }

  if (interaction.isAutocomplete?.()) {
    const command = client.commands.get(interaction.commandName);
    if (!command?.autocomplete) {
      try { await interaction.respond([]); } catch {}
      return;
    }
    try {
      await command.autocomplete(interaction);
    } catch (err) {
      console.error("[autocomplete]", err?.stack ?? err?.message ?? err);
      try {
        await interaction.respond([]);
      } catch {}
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const commandName = interaction.commandName;
  const startTime = Date.now();
  const requestId = interaction.id || generateCorrelationId();
  const commandLog = botLogger.child({
    requestId,
    commandName,
    userId: interaction.user.id,
    guildId: interaction.guildId
  });
  commandLog.info("Command received");

  const command = client.commands.get(commandName);

  if (!command) {
    commandLog.warn("No matching command found");
    return;
  }

  try {
    const { limit: rlLimit, windowSec: rlWindow } = getRateLimitForCommand(
      commandName,
      command.meta?.category
    );
    const rl = await checkRateLimit(
      `slash:${interaction.user.id}:${commandName}`,
      rlLimit,
      rlWindow
    );
    if (!rl.ok) {
      trackRateLimit("command");
      await replyInteraction(interaction, {
        content: `Rate limited. Try again in about ${rl.resetIn}s.`
      });
      commandLog.warn({ resetInSec: rl.resetIn, category: command.meta?.category }, "Slash command rate limited");
      return;
    }
  } catch (error) {
    commandLog.warn({ error: error?.message ?? String(error) }, "Rate limiter backend error; continuing");
  }

  if (MUTATION_COMMANDS.has(commandName)) {
    try {
      const first = await claimIdempotencyKey(`interaction:${interaction.id}`, 300);
      if (!first) {
        commandLog.warn("Duplicate mutation interaction ignored by idempotency guard");
        await replyInteractionIfFresh(interaction, {
          content: "Duplicate request ignored."
        });
        return;
      }
    } catch (error) {
      commandLog.warn({ error: error?.message ?? String(error) }, "Idempotency backend error; continuing");
    }
  }

  const gate = await canRunCommand(interaction, commandName, command.meta || {});
  if (!gate.ok) {
    const reason = gate.reason || "unknown";
    let msg = "You cannot run this command.";
    if (reason === "disabled") msg = "This command is disabled in this server.";
    else if (reason === "disabled-category") msg = "This command category is disabled in this server.";
    else if (reason === "no-perms" || reason === "missing-perms" || reason === "missing-role") msg = "You do not have permission to run this command.";

    try {
      await replyInteraction(interaction, { content: msg });
    } catch {}
    return;
  }

  try {
    await command.execute(interaction);
    
    // Track successful command execution
    const duration = Date.now() - startTime;
    trackCommand(commandName, duration, "success");
    void recordUserCommandStat({
      userId: interaction.user.id,
      command: commandName,
      ok: true,
      durationMs: duration,
      source: "slash"
    }).catch(() => {});
    commandLog.info({ duration }, "Command executed successfully");
    
  } catch (error) {
    const duration = Date.now() - startTime;
    trackCommand(commandName, duration, "error");
    void recordUserCommandStat({
      userId: interaction.user.id,
      command: commandName,
      ok: false,
      durationMs: duration,
      source: "slash"
    }).catch(() => {});
    
    commandLog.error({
      error: error.message, 
      stack: error.stack,
    }, "Command execution failed");
    
    const errorMsg = process.env.NODE_ENV === 'development' 
      ? `Command failed: ${error?.message ?? String(error)}`
      : "Command failed.";
    
    try {
      await replyInteraction(interaction, {
        embeds: [buildErrorEmbed(errorMsg)]
      });
    } catch (replyError) {
      commandLog.error({ error: replyError.message }, "Failed to send error response");
    }
  }
});

/* ===================== LOGIN ===================== */

const skipDiscordLogin = String(process.env.CI_SKIP_DISCORD_LOGIN || "false").toLowerCase() === "true";
if (skipDiscordLogin) {
  botLogger.warn("CI_SKIP_DISCORD_LOGIN=true - starting control plane without Discord gateway login");
} else {
  if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN missing");
  await client.login(process.env.DISCORD_TOKEN);
}
