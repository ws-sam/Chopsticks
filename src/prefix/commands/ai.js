// src/prefix/commands/ai.js
// Prefix AI commands — mirrors /ai slash depth.
// Uses the same resolveAiKey + textLlm pipeline as the slash command.

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { resolveAiKey, getGuildAiConfig } from "../../utils/aiConfig.js";
import { getRedisClient } from "../../utils/redis.js";
import COLORS from "../../utils/colors.js";

const CTX_TTL    = 1800;
const MAX_CTX    = 10;
const RATE_MS    = 4000;
const _cooldowns = new Map();

function cool(userId) {
  const now = Date.now();
  const last = _cooldowns.get(userId) ?? 0;
  if (now - last < RATE_MS) return Math.ceil((RATE_MS - (now - last)) / 1000);
  _cooldowns.set(userId, now);
  return 0;
}

async function callLlm({ prompt, system = "", provider, apiKey, ollamaUrl }) {
  const raw = String(process.env.TEXT_LLM_URL || process.env.VOICE_ASSIST_LLM_URL || "").trim();
  if (!raw) throw new Error("llm-not-configured");
  const url = raw.endsWith("/generate") ? raw : `${raw}/generate`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, ...(system && { system }), provider, ...(apiKey && { apiKey }), ...(ollamaUrl && { ollamaUrl }) }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`llm-failed:${res.status}`);
    const data = await res.json().catch(() => null);
    const text = String(data?.text || data?.response || "").trim();
    if (!text) throw new Error("llm-empty");
    return text;
  } finally {
    clearTimeout(t);
  }
}

function llmErr(err) {
  const m = String(err?.message ?? err);
  if (m.includes("llm-not-configured")) return "❌ No AI backend configured. Ask an admin to set `TEXT_LLM_URL`.";
  if (m.includes("llm-failed:"))        return `❌ AI request failed (${m.split(":")[1] ?? "err"}). Try again.`;
  if (m.includes("llm-empty"))          return "⚠️ AI returned empty. Try rephrasing.";
  if (m.includes("AbortError") || m.includes("aborted")) return "⏱️ AI timed out (20s). Try again.";
  return `❌ Error: \`${m.slice(0, 100)}\``;
}

async function resolveProvider(guildId, userId) {
  try { return await resolveAiKey(guildId, userId); }
  catch { return { provider: null }; }
}

async function loadCtx(key) {
  try {
    const redis = await getRedisClient();
    if (redis?.isOpen) { const r = await redis.get(key); if (r) return JSON.parse(r); }
  } catch {}
  return [];
}

async function saveCtx(key, ctx) {
  try {
    const redis = await getRedisClient();
    if (redis?.isOpen) await redis.setEx(key, CTX_TTL, JSON.stringify(ctx));
  } catch {}
}

async function doChat(message, userText) {
  const { guildId, author: { id: userId }, channelId } = message;
  const resolved = await resolveProvider(guildId, userId);
  if (!resolved?.provider) {
    return message.reply(
      "🤖 No AI provider configured.\n" +
      "An admin can run `/ai set-provider` or link their key with `/ai token link`."
    );
  }
  let guildConfig = { persona: null };
  try { guildConfig = await getGuildAiConfig(guildId); } catch {}

  const ctxKey = `ai:ctx:${guildId}:${userId}:${channelId}`;
  let ctx = await loadCtx(ctxKey);
  ctx.push({ role: "user", content: userText });
  if (ctx.length > MAX_CTX) ctx.splice(0, ctx.length - MAX_CTX);

  const history  = ctx.slice(0, -1);
  const persona  = guildConfig.persona ? `${guildConfig.persona}\n\n` : "";
  const histStr  = history.length ? "Conversation history:\n" + history.map(m => `${m.role}: ${m.content}`).join("\n") : "";
  const system   = [persona, histStr].filter(Boolean).join("\n\n");

  let reply;
  try {
    reply = await callLlm({ prompt: userText, system, provider: resolved.provider, apiKey: resolved.apiKey, ollamaUrl: resolved.ollamaUrl });
  } catch (err) {
    return message.reply(llmErr(err));
  }

  ctx.push({ role: "assistant", content: reply });
  if (ctx.length > MAX_CTX) ctx.splice(0, ctx.length - MAX_CTX);
  await saveCtx(ctxKey, ctx);

  const display = reply.length > 1900 ? reply.slice(0, 1897) + "…" : reply;
  const embed = new EmbedBuilder()
    .setDescription(display)
    .setColor(COLORS.AI ?? COLORS.INFO ?? 0x5865F2)
    .setFooter({ text: `${resolved.provider} · !ai reset to clear context · msg ${ctx.length / 2}/${MAX_CTX / 2}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ai:reset:${guildId}:${userId}:${channelId}`)
      .setLabel("🔄 New Topic")
      .setStyle(ButtonStyle.Secondary),
  );
  return message.reply({ embeds: [embed], components: [row], allowedMentions: { repliedUser: false } });
}

export default [
  // ── ask / chat ─────────────────────────────────────────────────────────────
  {
    name: "ask",
    aliases: ["ai", "chat", "gpt"],
    description: "Chat with AI (rolling context) — !ask <message>",
    rateLimit: RATE_MS,
    async execute(message, args) {
      const text = args.join(" ").trim();
      if (!text) {
        const embed = new EmbedBuilder()
          .setTitle("🤖 AI Chat")
          .setDescription(
            "**Usage:** `!ask <message>`\n\n" +
            "**Commands:**\n" +
            "`!ask <msg>` — chat (keeps rolling context per channel)\n" +
            "`!summarize <text>` — TL;DR a block of text\n" +
            "`!translate <lang> <text>` — translate text\n" +
            "`!roast @user` — roast someone\n" +
            "`!ai reset` — clear your conversation context"
          )
          .setColor(COLORS.AI ?? COLORS.INFO ?? 0x5865F2)
          .setFooter({ text: "Powered by your guild AI provider · /ai set-provider" });
        return message.reply({ embeds: [embed] });
      }
      if (text.toLowerCase() === "reset") {
        const ctxKey = `ai:ctx:${message.guildId}:${message.author.id}:${message.channelId}`;
        try {
          const redis = await getRedisClient();
          if (redis?.isOpen) await redis.del(ctxKey);
        } catch {}
        return message.reply("✅ AI context cleared. Fresh start!");
      }
      const wait = cool(message.author.id);
      if (wait) return message.reply(`⏳ Wait **${wait}s** before chatting again.`);
      const loading = await message.reply({ content: "🤖 Thinking…", allowedMentions: { repliedUser: false } });
      const result  = await doChat(message, text).catch(err => ({ _err: err }));
      if (result?._err) return loading.edit(llmErr(result._err));
      await loading.delete().catch(() => {});
    },
  },

  // ── summarize ──────────────────────────────────────────────────────────────
  {
    name: "summarize",
    aliases: ["tldr", "sum"],
    description: "Summarize a block of text — !summarize <text>",
    rateLimit: 6000,
    async execute(message, args) {
      const text = args.join(" ").trim();
      if (text.length < 20) return message.reply("Usage: `!summarize <text>` (at least 20 chars)");
      if (text.length > 4000) return message.reply("❌ Text too long (max 4000 chars).");
      const wait = cool(message.author.id);
      if (wait) return message.reply(`⏳ Wait **${wait}s**.`);
      const loading = await message.reply({ content: "📝 Summarizing…", allowedMentions: { repliedUser: false } });
      const resolved = await resolveProvider(message.guildId, message.author.id);
      if (!resolved?.provider) return loading.edit("🤖 No AI provider configured.");
      try {
        const reply = await callLlm({
          prompt: `Summarize the following in 3-5 bullet points:\n\n${text}`,
          system: "You are a concise summarizer. Output only bullet points, no preamble.",
          provider: resolved.provider, apiKey: resolved.apiKey, ollamaUrl: resolved.ollamaUrl,
        });
        const embed = new EmbedBuilder()
          .setTitle("📝 Summary")
          .setDescription(reply.slice(0, 2048))
          .setColor(COLORS.INFO ?? 0x5865F2)
          .setFooter({ text: `${resolved.provider} · Chopsticks` });
        return loading.edit({ content: null, embeds: [embed] });
      } catch (err) {
        return loading.edit(llmErr(err));
      }
    },
  },

  // ── translate ──────────────────────────────────────────────────────────────
  {
    name: "translate",
    aliases: ["tr", "tl"],
    description: "Translate text — !translate <language> <text>",
    rateLimit: 5000,
    async execute(message, args) {
      const lang = args[0];
      const text = args.slice(1).join(" ").trim();
      if (!lang || !text) return message.reply("Usage: `!translate <language> <text>`\nExample: `!translate Spanish Hello world`");
      const wait = cool(message.author.id);
      if (wait) return message.reply(`⏳ Wait **${wait}s**.`);
      const loading = await message.reply({ content: "🌐 Translating…", allowedMentions: { repliedUser: false } });
      const resolved = await resolveProvider(message.guildId, message.author.id);
      if (!resolved?.provider) return loading.edit("🤖 No AI provider configured.");
      try {
        const reply = await callLlm({
          prompt: `Translate the following text to ${lang}:\n\n${text}`,
          system: `You are a translator. Output only the translated text in ${lang}, nothing else.`,
          provider: resolved.provider, apiKey: resolved.apiKey, ollamaUrl: resolved.ollamaUrl,
        });
        const embed = new EmbedBuilder()
          .setTitle(`🌐 Translation → ${lang}`)
          .addFields(
            { name: "Original", value: text.slice(0, 512) },
            { name: "Translated", value: reply.slice(0, 1024) },
          )
          .setColor(COLORS.SUCCESS ?? 0x57F287)
          .setFooter({ text: `${resolved.provider} · Chopsticks` });
        return loading.edit({ content: null, embeds: [embed] });
      } catch (err) {
        return loading.edit(llmErr(err));
      }
    },
  },

  // ── aimodel ────────────────────────────────────────────────────────────────
  {
    name: "aimodel",
    aliases: ["aistatus", "aiinfo"],
    description: "Show your active AI provider — !aimodel",
    rateLimit: 5000,
    async execute(message) {
      const resolved = await resolveProvider(message.guildId, message.author.id);
      if (!resolved?.provider) {
        return message.reply("🤖 No AI provider active. Use `/ai set-provider` (admin) or `/ai token link` (personal).");
      }
      const embed = new EmbedBuilder()
        .setTitle("🤖 AI Provider")
        .addFields(
          { name: "Provider",  value: resolved.provider, inline: true },
          { name: "Key Source", value: resolved.source ?? "guild", inline: true },
        )
        .setColor(COLORS.AI ?? COLORS.INFO ?? 0x5865F2)
        .setFooter({ text: "Use /ai set-provider to change · Chopsticks" });
      return message.reply({ embeds: [embed] });
    },
  },
];
