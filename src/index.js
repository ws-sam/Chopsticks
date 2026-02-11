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
import { Client, Collection, GatewayIntentBits, Events } from "discord.js";
import { AgentManager } from "./agents/agentManager.js";
// import { spawnAgentsProcess } from "./agents/spawn.js"; // No longer directly spawning agents
import { handleButton as handleMusicButton, handleSelect as handleMusicSelect } from "./commands/music.js";
import { handleButton as handleAssistantButton } from "./commands/assistant.js";
import {
  startHealthServer,
  metricCommand,
  metricCommandError,
  metricCommandLatency,
  metricAgents,
  recordCommandStat,
  getAndResetCommandDeltas
} from "./utils/healthServer.js";
import { flushCommandStats, flushCommandStatsDaily } from "./utils/audit.js";
import { checkRateLimit } from "./utils/ratelimit.js";
import { canRunCommand } from "./utils/permissions.js";
import { getPrefixCommands } from "./prefix/registry.js";
import { canRunPrefixCommand } from "./utils/permissions.js";
import { loadGuildData } from "./utils/storage.js";
import { addCommandLog } from "./utils/commandlog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===================== CLIENT ===================== */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildIntegrations
  ]
});

global.client = client;
client.commands = new Collection();

/* ===================== AGENTS ===================== */

global.agentManager = null;
// global.__agentsChild = null; // No longer spawning child processes from main bot

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

    const cmd =
      mod.default ??
      (mod.data && mod.execute ? { data: mod.data, execute: mod.execute } : null);

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
import { updateAgentBotStatus, fetchAgentBots, fetchAgentRunners, insertAgentBot, deleteAgentBot, ensureSchema } from "./utils/storage.js";

/* ===================== DEV API SERVER ===================== */
const devApiApp = express();
const DEV_API_PORT = process.env.DEV_API_PORT || 3002;
const DEV_API_USERNAME = process.env.DEV_API_USERNAME;
const DEV_API_PASSWORD = process.env.DEV_API_PASSWORD;

// Basic Authentication Middleware for Dev API
function authenticateDevApi(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic');
    return res.status(401).send('Authentication required for Dev API.');
  }

  const [type, credentials] = authHeader.split(' ');
  if (type !== 'Basic') {
    return res.status(401).send('Unsupported authentication type for Dev API.');
  }

  const decoded = Buffer.from(credentials, 'base64').toString('utf8');
  const [username, password] = decoded.split(':');

  if (username === DEV_API_USERNAME && password === DEV_API_PASSWORD) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic');
    res.status(401).send('Invalid Dev API credentials.');
  }
}

devApiApp.use(express.json());

// Apply authentication only if credentials are set
if (!DEV_API_USERNAME || !DEV_API_PASSWORD) {
  console.warn('DEV_API_USERNAME or DEV_API_PASSWORD not set. Dev API will not start securely.');
} else {
  devApiApp.use(authenticateDevApi);
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
    await updateAgentTokenStatus(agentId, 'inactive');
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
    await updateAgentTokenStatus(agentId, 'active');
    // Force AgentManager to refresh its registered agents
    await mgr.loadRegisteredAgentsFromDb();
    // AgentManager's ensureSessionAgent logic will pick up and start it if needed
    res.json({ message: `Agent ${agentId} marked active. AgentManager will attempt to start it.` });
  } catch (error) {
    console.error(`Error starting agent ${agentId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

devApiApp.listen(DEV_API_PORT, () => {
  console.log(`Development API running on http://localhost:${DEV_API_PORT}`);
});
/* ===================== END DEV API SERVER ===================== */

/* ===================== INTERACTIONS ===================== */

client.once(Events.ClientReady, async () => {
  console.log(`✅ Ready as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} guilds`);

  const mgr = new AgentManager({
    host: process.env.AGENT_CONTROL_HOST,
    port: process.env.AGENT_CONTROL_PORT
  });

  global.agentManager = mgr;

  try {
    await mgr.start();
    console.log(`🧩 Agent control listening on ws://${mgr.host}:${mgr.port}`);
  } catch (err) {
    console.error("❌ Agent control startup failed:", err?.message ?? err);
    return;
  }

  // Ensure database schema is up-to-date
  try {
    await ensureSchema();
    console.log("✅ Database schema ensured.");
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
});

/* ===================== PREFIX COMMANDS ===================== */

const prefixCommands = await getPrefixCommands();

client.on(Events.MessageCreate, async message => {
  if (message.author?.bot) return;

  let prefix = "!";
  let aliases = {};
  if (message.guildId) {
    try {
      const data = await loadGuildData(message.guildId);
      prefix = data?.prefix?.value || "!";
      aliases = data?.prefix?.aliases || {};
    } catch {}
  }

  if (!message.content?.startsWith(prefix)) return;

  const raw = message.content.slice(prefix.length).trim();
  if (!raw) return;

  const parts = raw.split(/\s+/);
  let name = parts.shift().toLowerCase();
  if (aliases[name]) name = String(aliases[name]).toLowerCase();

  // prefix rate limit
  try {
    const rl = await checkRateLimit(`pfx:${message.author.id}:${name}`, 5, 10);
    if (!rl.ok) return;
  } catch {}
  let cmd = prefixCommands.get(name);
  if (!cmd && message.guildId) {
    try {
      const data = await loadGuildData(message.guildId);
      const custom = data.customCommands?.[name];
      if (custom?.response) {
        const rendered = custom.response
          .replace("{user}", `<@${message.author.id}>`)
          .replace("{user.tag}", message.author.tag)
          .replace("{guild}", message.guild?.name || "")
          .replace("{channel}", message.channel?.name || "");
        await message.reply(rendered);
        return;
      }
      const macro = data.macros?.[name];
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
  if (!cmd) return;
  if (!cmd) return;

  const gate = await canRunPrefixCommand(message, cmd.name, cmd);
  if (!gate.ok) return;

  try {
    await cmd.execute(message, parts, { prefix, commands: prefixCommands });
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
  if (interaction.isStringSelectMenu?.()) {
    try {
      if (await handleMusicSelect(interaction)) return;
    } catch (err) {
      console.error("[select]", err?.stack ?? err?.message ?? err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "Selection failed.", ephemeral: true });
        }
      } catch {}
    }
  }

  if (interaction.isButton?.()) {
    try {
      if (await handleMusicButton(interaction)) return;
      if (await handleAssistantButton(interaction)) return;
    } catch (err) {
      console.error("[button]", err?.stack ?? err?.message ?? err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "Button action failed.", ephemeral: true });
        }
      } catch {}
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const commandName = interaction.commandName;
  console.log(`[command:${commandName}] Received from user ${interaction.user.id} in guild ${interaction.guildId}`);

  const command = client.commands.get(commandName);

  if (!command) {
    console.error(`No command matching ${commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[command:${commandName}] Execution error:`, error?.stack ?? error?.message ?? error);
    const errorMsg = process.env.NODE_ENV === 'development' 
      ? `Command failed: ${error?.message ?? String(error)}`
      : 'There was an error while executing this command!';
    
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMsg, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMsg, ephemeral: true });
      }
    } catch (replyError) {
      console.error(`[command:${commandName}] Failed to send error response:`, replyError?.message);
    }
  }
});

/* ===================== LOGIN ===================== */

if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN missing");
await client.login(process.env.DISCORD_TOKEN);
