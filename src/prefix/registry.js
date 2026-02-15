import { PermissionsBitField } from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { addWarning, listWarnings, clearWarnings } from "../utils/moderation.js";
import { schedule } from "../utils/scheduler.js";
import { readAgentTokensFromEnv } from "../agents/env.js";
import { request } from "undici";
import {
  clampIntensity
} from "../fun/variants.js";
import {
  getFunCatalog,
  randomFunFromRuntime,
  renderFunFromRuntime,
  resolveVariantId
} from "../fun/runtime.js";
import {
  isValidAliasName,
  normalizeAliasName,
  normalizePrefixValue,
  resolveAliasedCommand
} from "./hardening.js";

function cmd(def) {
  return def;
}

function parseIntSafe(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  if (t < min || t > max) return null;
  return t;
}

async function reply(message, text) {
  return message.reply({ content: text });
}

async function dm(user, text) {
  try { await user.send(text); } catch {}
}

function parseFunIntensity(args) {
  let intensity = 3;
  const next = [];

  for (const token of args) {
    const match =
      /^--?intensity=(\d+)$/i.exec(token) ||
      /^-i=(\d+)$/i.exec(token) ||
      /^(\d)$/.exec(token);
    if (match) {
      intensity = clampIntensity(Number(match[1]));
      continue;
    }
    next.push(token);
  }

  return { intensity, args: next };
}

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

export async function getPrefixCommands() {
  const map = new Map();

  map.set("aliases", cmd({
    name: "aliases",
    guildOnly: true,
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
        if (map.has(alias)) {
          return reply(message, `Alias '${alias}' is reserved by a built-in prefix command.`);
        }

        const customNames = new Set([
          ...Object.keys(data.customCommands ?? {}).map(normalizeAliasName),
          ...Object.keys(data.macros ?? {}).map(normalizeAliasName)
        ]);
        const targetExists = map.has(target) || customNames.has(target) || Object.prototype.hasOwnProperty.call(data.prefix.aliases, target);
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
  }));

  map.set("agents", cmd({
    name: "agents",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ManageGuild],
    async execute(message, args) {
      const sub = (args[0] || "status").toLowerCase();
      const mgr = global.agentManager;

      if (sub === "status") {
        const list = mgr?.listAgents?.() ?? [];
        const guildId = message.guildId;
        const lines = list.map(a => {
          const inGuild = a.guildIds?.includes?.(guildId);
          const busy = a.busyKey ? "busy" : "idle";
          return `${a.agentId} ${a.ready ? "ready" : "down"} ${busy} ${inGuild ? "in-guild" : "not-in-guild"}`;
        });
        return reply(message, lines.length ? lines.join("\n") : "No agents connected.");
      }

      if (sub === "sessions") {
        const sessions = mgr?.listSessions?.() ?? [];
        const assistantSessions = mgr?.listAssistantSessions?.() ?? [];
        const guildId = message.guildId;
        const musicLines = sessions.filter(s => s.guildId === guildId).map(s => `music ${s.voiceChannelId} -> ${s.agentId}`);
        const assistantLines = assistantSessions.filter(s => s.guildId === guildId).map(s => `assistant ${s.voiceChannelId} -> ${s.agentId}`);
        const lines = [...musicLines, ...assistantLines];
        return reply(message, lines.length ? lines.join("\n") : "No sessions for this guild.");
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
  }));

  map.set("ping", cmd({
    name: "ping",
    description: "Ping",
    async execute(message) {
      await reply(message, `Pong! ${Math.round(message.client.ws.ping)}ms`);
    }
  }));

  map.set("uptime", cmd({
    name: "uptime",
    description: "Uptime",
    async execute(message) {
      await reply(message, `Uptime: ${Math.floor(process.uptime())}s`);
    }
  }));

  map.set("help", cmd({
    name: "help",
    description: "List prefix commands",
    async execute(message, _args, ctx) {
      const names = Array.from(ctx.commands.keys()).sort();
      await reply(message, names.map(n => ctx.prefix + n).join("\n").slice(0, 1900));
    }
  }));

  map.set("echo", cmd({
    name: "echo",
    description: "Echo text",
    async execute(message, args) {
      await reply(message, args.join(" ") || "(empty)");
    }
  }));

  map.set("choose", cmd({
    name: "choose",
    description: "Pick one",
    async execute(message, args) {
      const items = args.join(" ").split(",").map(s => s.trim()).filter(Boolean);
      if (!items.length) return reply(message, "No options.");
      const pick = items[Math.floor(Math.random() * items.length)];
      return reply(message, `I choose: **${pick}**`);
    }
  }));

  map.set("fun", cmd({
    name: "fun",
    description: "Run fun variants (220 total)",
    async execute(message, args) {
      const { intensity, args: normalizedArgs } = parseFunIntensity(args);
      const sub = (normalizedArgs[0] || "random").toLowerCase();

      if (sub === "list" || sub === "catalog") {
        const query = normalizedArgs.slice(1).join(" ");
        const payload = await getFunCatalog({ query, limit: 20 });
        const stats = payload?.stats || { total: payload?.total || 0, themes: "?", styles: "?" };
        const hits = Array.isArray(payload?.matches) ? payload.matches : [];
        const head = `Fun variants: ${stats.total} (${stats.themes} themes x ${stats.styles} styles)`;
        const source = payload?.source ? ` [${payload.source}]` : "";
        if (!hits.length) return reply(message, `${head}\nNo variants found for query: ${query || "(empty)"}`);
        const lines = hits.map(v => `${v.id} -> ${v.label}`);
        return reply(message, `${head}${source}\n${lines.join("\n")}`.slice(0, 1900));
      }

      let target = "";
      let result = null;
      if (sub === "random" || sub === "r") {
        target = normalizedArgs.slice(1).join(" ");
        result = await randomFunFromRuntime({
          actorTag: message.author.username,
          target: target || message.author.username,
          intensity
        });
      } else {
        const variantId = resolveVariantId(sub);
        if (!variantId) {
          return reply(message, "Unknown fun variant. Use `fun list` to browse ids.");
        }
        target = normalizedArgs.slice(1).join(" ");
        result = await renderFunFromRuntime({
          variantId,
          actorTag: message.author.username,
          target: target || message.author.username,
          intensity
        });
      }

      if (!result.ok) return reply(message, "Unable to render variant.");
      const source = result.source ? ` [${result.source}]` : "";
      return reply(message, `${result.text}\n${result.metaLine}${source}`);
    }
  }));

  map.set("roll", cmd({
    name: "roll",
    description: "Roll a die",
    async execute(message, args) {
      const sides = parseIntSafe(args[0] || "6", 2, 100) || 6;
      const roll = Math.floor(Math.random() * sides) + 1;
      await reply(message, `🎲 ${roll} (d${sides})`);
    }
  }));

  map.set("coinflip", cmd({
    name: "coinflip",
    description: "Flip a coin",
    async execute(message) {
      await reply(message, Math.random() < 0.5 ? "Heads" : "Tails");
    }
  }));

  map.set("8ball", cmd({
    name: "8ball",
    description: "Magic 8-ball",
    async execute(message) {
      const answers = ["Yes.", "No.", "Maybe.", "Ask again later.", "Definitely.", "Unlikely."];
      await reply(message, `🎱 ${answers[Math.floor(Math.random() * answers.length)]}`);
    }
  }));

  map.set("serverinfo", cmd({
    name: "serverinfo",
    guildOnly: true,
    async execute(message) {
      const g = message.guild;
      await reply(message, `**${g.name}** | Members: ${g.memberCount} | ID: ${g.id}`);
    }
  }));

  map.set("userinfo", cmd({
    name: "userinfo",
    async execute(message, args) {
      const id = args[0]?.replace(/[<@!>]/g, "") || message.author.id;
      const user = await message.client.users.fetch(id).catch(() => null);
      if (!user) return reply(message, "User not found.");
      await reply(message, `${user.tag} | ID: ${user.id}`);
    }
  }));

  map.set("avatar", cmd({
    name: "avatar",
    async execute(message, args) {
      const id = args[0]?.replace(/[<@!>]/g, "") || message.author.id;
      const user = await message.client.users.fetch(id).catch(() => null);
      if (!user) return reply(message, "User not found.");
      await reply(message, user.displayAvatarURL({ size: 512 }));
    }
  }));

  map.set("roleinfo", cmd({
    name: "roleinfo",
    guildOnly: true,
    async execute(message, args) {
      const id = args[0]?.replace(/[<@&>]/g, "");
      if (!id) return reply(message, "Role ID required.");
      const role = message.guild.roles.cache.get(id);
      if (!role) return reply(message, "Role not found.");
      await reply(message, `${role.name} | Members: ${role.members.size} | ID: ${role.id}`);
    }
  }));

  map.set("botinfo", cmd({
    name: "botinfo",
    async execute(message) {
      await reply(message, `Guilds: ${message.client.guilds.cache.size} | Users: ${message.client.users.cache.size}`);
    }
  }));

  map.set("invite", cmd({
    name: "invite",
    async execute(message) {
      const perms = new PermissionsBitField([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.Connect,
        PermissionsBitField.Flags.Speak,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ManageGuild,
        PermissionsBitField.Flags.ModerateMembers
      ]);
      const url = `https://discord.com/api/oauth2/authorize?client_id=${message.client.user.id}&permissions=${perms.bitfield}&scope=bot%20applications.commands`;
      await reply(message, url);
    }
  }));

  map.set("purge", cmd({
    name: "purge",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ManageMessages],
    async execute(message, args) {
      const count = parseIntSafe(args[0], 1, 100);
      if (!count) return reply(message, "Count 1-100.");
      const deleted = await message.channel.bulkDelete(count, true).catch(() => null);
      await reply(message, `Deleted ${deleted?.size ?? 0} messages.`);
    }
  }));

  map.set("slowmode", cmd({
    name: "slowmode",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ManageChannels],
    async execute(message, args) {
      const seconds = parseIntSafe(args[0], 0, 21600);
      if (seconds === null) return reply(message, "Seconds 0-21600.");
      await message.channel.setRateLimitPerUser(seconds);
      await reply(message, `Slowmode set to ${seconds}s.`);
    }
  }));

  map.set("kick", cmd({
    name: "kick",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.KickMembers],
    async execute(message, args) {
      const id = args[0]?.replace(/[<@!>]/g, "");
      if (!id) return reply(message, "User ID required.");
      const member = await message.guild.members.fetch(id).catch(() => null);
      if (!member) return reply(message, "User not found.");
      await member.kick(args.slice(1).join(" ") || "No reason").catch(() => null);
      await reply(message, `Kicked ${member.user.tag}`);
    }
  }));

  map.set("ban", cmd({
    name: "ban",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.BanMembers],
    async execute(message, args) {
      const id = args[0]?.replace(/[<@!>]/g, "");
      if (!id) return reply(message, "User ID required.");
      await message.guild.members.ban(id, { reason: args.slice(1).join(" ") || "No reason" }).catch(() => null);
      await reply(message, `Banned ${id}`);
    }
  }));

  map.set("unban", cmd({
    name: "unban",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.BanMembers],
    async execute(message, args) {
      const id = args[0];
      if (!id) return reply(message, "User ID required.");
      await message.guild.members.unban(id).catch(() => null);
      await reply(message, `Unbanned ${id}`);
    }
  }));

  map.set("timeout", cmd({
    name: "timeout",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ModerateMembers],
    async execute(message, args) {
      const id = args[0]?.replace(/[<@!>]/g, "");
      const minutes = parseIntSafe(args[1], 0, 10080);
      if (!id || minutes === null) return reply(message, "Usage: timeout <user> <minutes>");
      const member = await message.guild.members.fetch(id).catch(() => null);
      if (!member) return reply(message, "User not found.");
      const ms = minutes === 0 ? null : minutes * 60 * 1000;
      await member.timeout(ms).catch(() => null);
      await reply(message, minutes === 0 ? "Timeout cleared." : `Timed out for ${minutes}m`);
    }
  }));

  map.set("warn", cmd({
    name: "warn",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ModerateMembers],
    async execute(message, args) {
      const id = args[0]?.replace(/[<@!>]/g, "");
      if (!id) return reply(message, "User ID required.");
      const list = await addWarning(message.guildId, id, message.author.id, args.slice(1).join(" ") || "No reason");
      await reply(message, `Warned ${id}. Total: ${list.length}`);
    }
  }));

  map.set("warnings", cmd({
    name: "warnings",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ModerateMembers],
    async execute(message, args) {
      const id = args[0]?.replace(/[<@!>]/g, "");
      if (!id) return reply(message, "User ID required.");
      const list = await listWarnings(message.guildId, id);
      if (!list.length) return reply(message, "No warnings.");
      const lines = list.slice(0, 10).map((w, i) => `${i + 1}. ${w.reason} by <@${w.by}>`);
      await reply(message, lines.join("\n"));
    }
  }));

  map.set("clearwarns", cmd({
    name: "clearwarns",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ModerateMembers],
    async execute(message, args) {
      const id = args[0]?.replace(/[<@!>]/g, "");
      if (!id) return reply(message, "User ID required.");
      await clearWarnings(message.guildId, id);
      await reply(message, "Warnings cleared.");
    }
  }));

  map.set("lock", cmd({
    name: "lock",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ManageChannels],
    async execute(message) {
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
      await reply(message, "Channel locked.");
    }
  }));

  map.set("unlock", cmd({
    name: "unlock",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ManageChannels],
    async execute(message) {
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
      await reply(message, "Channel unlocked.");
    }
  }));

  map.set("nick", cmd({
    name: "nick",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ManageNicknames],
    async execute(message, args) {
      const id = args[0]?.replace(/[<@!>]/g, "");
      if (!id) return reply(message, "User ID required.");
      const member = await message.guild.members.fetch(id).catch(() => null);
      if (!member) return reply(message, "User not found.");
      const nick = args.slice(1).join(" ") || null;
      await member.setNickname(nick).catch(() => null);
      await reply(message, "Nickname updated.");
    }
  }));

  map.set("softban", cmd({
    name: "softban",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.BanMembers],
    async execute(message, args) {
      const id = args[0]?.replace(/[<@!>]/g, "");
      if (!id) return reply(message, "User ID required.");
      await message.guild.members.ban(id).catch(() => null);
      await message.guild.members.unban(id).catch(() => null);
      await reply(message, "Softban complete.");
    }
  }));

  map.set("role", cmd({
    name: "role",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ManageRoles],
    async execute(message, args) {
      const action = args[0];
      const userId = args[1]?.replace(/[<@!>]/g, "");
      const roleId = args[2]?.replace(/[<@&>]/g, "");
      if (!action || !userId || !roleId) return reply(message, "Usage: role <add|remove> <user> <role>");
      const member = await message.guild.members.fetch(userId).catch(() => null);
      const role = message.guild.roles.cache.get(roleId);
      if (!member || !role) return reply(message, "User/role not found.");
      if (action === "add") await member.roles.add(role).catch(() => null);
      if (action === "remove") await member.roles.remove(role).catch(() => null);
      await reply(message, "Role updated.");
    }
  }));

  map.set("poll", cmd({
    name: "poll",
    async execute(message, args) {
      const text = args.join(" ");
      const [q, opts] = text.split("|").map(s => s.trim());
      if (!q || !opts) return reply(message, "Usage: poll Question | opt1, opt2");
      const items = opts.split(",").map(s => s.trim()).filter(Boolean).slice(0, 10);
      if (items.length < 2) return reply(message, "Need at least 2 options.");
      const emoji = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
      const lines = items.map((o, i) => `${emoji[i]} ${o}`).join("\n");
      const msg = await message.channel.send(`**${q}**\n${lines}`);
      for (let i = 0; i < items.length; i++) await msg.react(emoji[i]).catch(() => {});
    }
  }));

  map.set("giveaway", cmd({
    name: "giveaway",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ManageGuild],
    async execute(message, args) {
      const mins = parseIntSafe(args[0], 1, 10080);
      const winners = parseIntSafe(args[1], 1, 10);
      const prize = args.slice(2).join(" ");
      if (!mins || !winners || !prize) return reply(message, "Usage: giveaway <minutes> <winners> <prize>");
      const msg = await message.channel.send(`🎉 **GIVEAWAY** 🎉\nPrize: **${prize}**\nEnds in ${mins}m`);
      await msg.react("🎉").catch(() => {});
      schedule(`giveaway:${msg.id}`, mins * 60 * 1000, async () => {
        const m = await message.channel.messages.fetch(msg.id).catch(() => null);
        if (!m) return;
        const reaction = m.reactions.cache.get("🎉");
        const users = await reaction.users.fetch();
        const pool = users.filter(u => !u.bot).map(u => u.id);
        const picked = [];
        while (pool.length && picked.length < winners) {
          picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        }
        const text = picked.length ? picked.map(id => `<@${id}>`).join(", ") : "No entries.";
        await m.reply(`🎉 Winner(s): ${text}`);
      });
    }
  }));

  map.set("remind", cmd({
    name: "remind",
    async execute(message, args) {
      const mins = parseIntSafe(args[0], 1, 10080);
      const text = args.slice(1).join(" ");
      if (!mins || !text) return reply(message, "Usage: remind <minutes> <text>");
      schedule(`remind:${message.author.id}:${Date.now()}`, mins * 60 * 1000, async () => {
        await dm(message.author, `⏰ Reminder: ${text}`);
      });
      await reply(message, `Okay, I will remind you in ${mins} minutes.`);
    }
  }));

  map.set("welcome", cmd({
    name: "welcome",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ManageGuild],
    async execute(message, args) {
      const sub = args[0];
      const data = await loadGuildData(message.guildId);
      data.welcome ??= { enabled: false, channelId: null, message: "Welcome {user}!" };
      if (sub === "set") {
        const channelId = args[1]?.replace(/[<#>]/g, "");
        if (!channelId) return reply(message, "Channel ID required.");
        data.welcome.channelId = channelId;
        data.welcome.enabled = true;
        await saveGuildData(message.guildId, data);
        return reply(message, "Welcome channel set.");
      }
      if (sub === "message") {
        const msg = args.slice(1).join(" ");
        data.welcome.message = msg;
        data.welcome.enabled = true;
        await saveGuildData(message.guildId, data);
        return reply(message, "Welcome message set.");
      }
      if (sub === "disable") {
        data.welcome.enabled = false;
        await saveGuildData(message.guildId, data);
        return reply(message, "Welcome disabled.");
      }
      return reply(message, "Usage: welcome <set|message|disable>");
    }
  }));

  map.set("autorole", cmd({
    name: "autorole",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ManageGuild],
    async execute(message, args) {
      const sub = args[0];
      const data = await loadGuildData(message.guildId);
      data.autorole ??= { enabled: false, roleId: null };
      if (sub === "set") {
        const roleId = args[1]?.replace(/[<@&>]/g, "");
        if (!roleId) return reply(message, "Role ID required.");
        data.autorole.roleId = roleId;
        data.autorole.enabled = true;
        await saveGuildData(message.guildId, data);
        return reply(message, "Auto-role set.");
      }
      if (sub === "disable") {
        data.autorole.enabled = false;
        await saveGuildData(message.guildId, data);
        return reply(message, "Auto-role disabled.");
      }
      return reply(message, "Usage: autorole <set|disable>");
    }
  }));

  map.set("prefix", cmd({
    name: "prefix",
    guildOnly: true,
    userPerms: [PermissionsBitField.Flags.ManageGuild],
    async execute(message, args) {
      const sub = args[0];
      const data = await loadGuildData(message.guildId);
      if (sub === "set") {
        const p = args[1];
        if (!p) return reply(message, "Usage: prefix set <value>");
        const normalized = normalizePrefixValue(p);
        if (!normalized.ok) return reply(message, normalized.error);
        data.prefix.value = normalized.value;
        await saveGuildData(message.guildId, data);
        return reply(message, `Prefix set to ${data.prefix.value}`);
      }
      if (sub === "reset") {
        data.prefix.value = "!";
        await saveGuildData(message.guildId, data);
        return reply(message, "Prefix reset.");
      }
      return reply(message, `Prefix: ${data.prefix.value || "!"}`);
    }
  }));

  return map;
}
