import { PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { reply, parseIntSafe } from "../helpers.js";
import { loadGuildData, saveGuildData } from "../../utils/storage.js";
import { readAgentTokensFromEnv } from "../../agents/env.js";
import { request } from "undici";
import {
  isValidAliasName,
  normalizeAliasName,
  resolveAliasedCommand
} from "../hardening.js";

const BUILTIN_COMMAND_NAMES = new Set([
  "aliases", "agents",
  "ping", "uptime", "help", "echo", "choose", "invite",
  "roll", "coinflip", "8ball", "fun",
  "serverinfo", "userinfo", "avatar", "roleinfo", "botinfo",
  "purge", "slowmode", "kick", "ban", "unban", "timeout",
  "warn", "warnings", "clearwarns", "lock", "unlock", "nick", "softban", "role",
  "poll", "giveaway", "remind", "welcome", "autorole", "prefix"
]);

function buildInvite(clientId) {
  const perms = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.Connect,
    PermissionsBitField.Flags.Speak,
    PermissionsBitField.Flags.ReadMessageHistory
  ]);
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${perms.bitfield}&scope=bot%20applications.commands`;
}

async function getBotIdentity(token) {
  const res = await request("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bot ${token}` }
  });
  if (res.statusCode >= 400) return null;
  return res.body.json();
}

export default [
  {
    name: "aliases",
    guildOnly: true,
    rateLimit: 3000,
    userPerms: [PermissionsBitField.Flags.ManageGuild],
    async execute(message, args) {
      const sub = args[0];
      const data = await loadGuildData(message.guildId);
      data.prefix ??= { aliases: {} };
      data.prefix.aliases ??= {};

      if (sub === "list") {
        const entries = Object.entries(data.prefix.aliases).sort((a, b) => a[0].localeCompare(b[0]));
        if (!entries.length) return reply(message, "No aliases.");
        const text = entries.map(([a, c]) => `${a} -> ${c}`).join("\n");
        return reply(message, text.slice(0, 1900));
      }

      if (sub === "set") {
        const alias = normalizeAliasName(args[1]);
        const target = normalizeAliasName(args[2]);
        if (!alias || !target) return reply(message, "Usage: aliases set <alias> <command|alias>");
        if (!isValidAliasName(alias)) {
          return reply(message, "Alias must be 1-24 chars: letters, numbers, '_' or '-'.");
        }
        if (BUILTIN_COMMAND_NAMES.has(alias)) {
          return reply(message, `Alias '${alias}' is reserved by a built-in prefix command.`);
        }

        const customNames = new Set([
          ...Object.keys(data.customCommands ?? {}).map(normalizeAliasName),
          ...Object.keys(data.macros ?? {}).map(normalizeAliasName)
        ]);
        const targetExists = BUILTIN_COMMAND_NAMES.has(target) || customNames.has(target) || Object.prototype.hasOwnProperty.call(data.prefix.aliases, target);
        if (!targetExists) {
          return reply(message, `Target '${target}' not found in prefix commands, custom commands, macros, or aliases.`);
        }

        const projected = { ...data.prefix.aliases, [alias]: target };
        const resolved = resolveAliasedCommand(alias, projected, 20);
        if (!resolved.ok && resolved.error === "cycle") {
          return reply(message, "Alias rejected: this creates an alias cycle.");
        }
        if (!resolved.ok && resolved.error === "depth") {
          return reply(message, "Alias rejected: chain too deep.");
        }

        data.prefix.aliases[alias] = target;
        await saveGuildData(message.guildId, data);
        const finalTarget = resolved.ok ? resolved.commandName : target;
        return reply(message, `Alias set: ${alias} -> ${target} (resolves to ${finalTarget})`);
      }

      if (sub === "clear") {
        const alias = normalizeAliasName(args[1]);
        if (!alias) return reply(message, "Usage: aliases clear <alias>");
        delete data.prefix.aliases[alias];
        await saveGuildData(message.guildId, data);
        return reply(message, `Alias cleared: ${alias}`);
      }

      return reply(message, "Usage: aliases <list|set|clear>");
    }
  },
  {
    name: "agents",
    guildOnly: true,
    rateLimit: 5000,
    userPerms: [PermissionsBitField.Flags.ManageGuild],
    async execute(message, args) {
      const sub = (args[0] || "status").toLowerCase();
      const mgr = global.agentManager;

      if (sub === "status") {
        const list = mgr?.listAgents?.() ?? [];
        const guildId = message.guildId;
        const inGuild = list.filter(a => a.guildIds?.includes?.(guildId));
        const idle = inGuild.filter(a => a.ready && !a.busyKey);
        const busy = inGuild.filter(a => a.ready && a.busyKey);

        const statusLines = inGuild.length
          ? inGuild.sort((a, b) => String(a.agentId).localeCompare(String(b.agentId)))
              .map(a => {
                const icon = !a.ready ? "🔴" : a.busyKey ? "⚡" : "🟢";
                const note = a.busyKey ? ` (${a.busyKind || "busy"})` : "";
                const tag = a.tag ? ` — ${a.tag}` : "";
                return `${icon} \`${a.agentId}\`${tag}${note}`;
              })
          : ["No agents in this server. Use `/agents deploy` or `agents invite`."];

        const embed = new EmbedBuilder()
          .setTitle("🤖 Agent Status")
          .setColor(inGuild.length > 0 ? 0x57F287 : list.length > 0 ? 0xFEE75C : 0x5865F2)
          .setTimestamp()
          .addFields(
            { name: "Network", value: `🟢 Online: **${list.length}**  ·  🔵 In server: **${inGuild.length}**`, inline: false },
            { name: "Activity", value: `🎵 Idle: **${idle.length}**  ·  ⚡ Busy: **${busy.length}**`, inline: false },
            { name: `Agents (${inGuild.length})`, value: statusLines.join("\n").slice(0, 1024), inline: false }
          )
          .setFooter({ text: "Use /agents status for the full interactive panel" });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`agentssessions:${guildId}`)
            .setLabel("📋 Sessions")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`agentssetup:music:${guildId}`)
            .setLabel("🎵 Music Setup")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`agentssetup:ai:${guildId}`)
            .setLabel("🤖 AI Setup")
            .setStyle(ButtonStyle.Success)
        );

        return message.reply({ embeds: [embed], components: [row] });
      }

      if (sub === "sessions") {
        const sessions = mgr?.listSessions?.() ?? [];
        const assistantSessions = mgr?.listAssistantSessions?.() ?? [];
        const guildId = message.guildId;
        const lines = [
          ...sessions.filter(s => s.guildId === guildId).map(s => `🎵 music  <#${s.voiceChannelId}>  →  \`${s.agentId}\``),
          ...assistantSessions.filter(s => s.guildId === guildId).map(s => `🤖 assistant  <#${s.voiceChannelId}>  →  \`${s.agentId}\``)
        ];
        const embed = new EmbedBuilder()
          .setTitle("📋 Active Agent Sessions")
          .setColor(lines.length ? 0x5865F2 : 0x57F287)
          .setDescription(lines.length ? lines.map(l => `• ${l}`).join("\n").slice(0, 4096) : "No active sessions in this server.")
          .setTimestamp();
        return message.reply({ embeds: [embed] });
      }

      if (sub === "assign") {
        const voiceChannelId = args[1];
        const agentId = args[2];
        const kind = (args[3] || "music").toLowerCase();
        if (!voiceChannelId || !agentId) return reply(message, "Usage: agents assign <voiceChannelId> <agentId> [music|assistant]");
        if (!mgr) return reply(message, "Agents not ready.");
        const agent = mgr.agents.get(agentId);
        if (!agent?.ready) return reply(message, "Agent not ready.");
        if (kind === "assistant") mgr.setPreferredAssistant(message.guildId, voiceChannelId, agentId, 300_000);
        else mgr.setPreferredAgent(message.guildId, voiceChannelId, agentId, 300_000);
        return reply(message, `Pinned ${agentId} to ${voiceChannelId} (${kind}).`);
      }

      if (sub === "release") {
        const voiceChannelId = args[1];
        const kind = (args[2] || "music").toLowerCase();
        if (!voiceChannelId) return reply(message, "Usage: agents release <voiceChannelId> [music|assistant]");
        if (!mgr) return reply(message, "Agents not ready.");
        if (kind === "assistant") {
          const sess = mgr.getAssistantSessionAgent(message.guildId, voiceChannelId);
          if (sess.ok) {
            try {
              await mgr.request(sess.agent, "assistantLeave", {
                guildId: message.guildId,
                voiceChannelId,
                actorUserId: message.author.id
              });
            } catch {}
            mgr.releaseAssistantSession(message.guildId, voiceChannelId);
          }
        } else {
          const sess = mgr.getSessionAgent(message.guildId, voiceChannelId);
          if (sess.ok) {
            try {
              await mgr.request(sess.agent, "stop", {
                guildId: message.guildId,
                voiceChannelId,
                actorUserId: message.author.id
              });
            } catch {}
            mgr.releaseSession(message.guildId, voiceChannelId);
          }
        }
        return reply(message, `Released ${kind} session for ${voiceChannelId}.`);
      }

      if (sub === "scale") {
        const count = parseIntSafe(args[1], 1, 200);
        if (!count) return reply(message, "Usage: agents scale <count>");
        if (!mgr) return reply(message, "Agents not ready.");
        const scaleToken = String(process.env.AGENT_SCALE_TOKEN || "").trim();
        if (!scaleToken) return reply(message, "Scale token not configured.");
        const agent = mgr.listAgents().find(a => a.ready);
        if (!agent) return reply(message, "No ready agent available.");
        const agentObj = mgr.agents.get(agent.agentId);
        try {
          const res = await mgr.request(agentObj, "scale", { desiredActive: count, scaleToken });
          return reply(message, `Scale result: ${res?.action ?? "ok"} (active: ${res?.active ?? "?"})`);
        } catch (err) {
          return reply(message, `Scale failed: ${err?.message ?? err}`);
        }
      }

      if (sub === "restart") {
        const agentId = args[1];
        if (!agentId) return reply(message, "Usage: agents restart <agentId>");
        if (!mgr) return reply(message, "Agents not ready.");
        const agent = mgr?.agents?.get?.(agentId) ?? null;
        if (!agent?.ws) return reply(message, "Agent not found.");
        try { agent.ws.terminate(); } catch {}
        return reply(message, `Restart signal sent to ${agentId}.`);
      }

      if (sub === "invite") {
        const tokens = readAgentTokensFromEnv(process.env);
        if (!tokens.length) return reply(message, "No agent tokens configured.");
        const out = [];
        for (const token of tokens) {
          const bot = await getBotIdentity(token);
          if (!bot?.id) continue;
          out.push(`${bot.username}#${bot.discriminator} — ${buildInvite(bot.id)}`);
        }
        return reply(message, out.length ? out.join("\n") : "Unable to fetch agent identities.");
      }

      return reply(message, "Usage: agents <status|sessions|assign|release|scale|restart|invite>");
    }
  }
];
