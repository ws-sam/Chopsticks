// src/commands/roast.js
// /roast @user — AI-powered roast

import { SlashCommandBuilder, EmbedBuilder, Colors } from 'discord.js';
import { generateText } from '../utils/textLlm.js';
import { checkRateLimit } from '../utils/ratelimit.js';
import { withTimeout } from "../utils/interactionTimeout.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const FALLBACK_ROASTS = require('../fun/roasts.json');

export const meta = {
  name: 'roast',
  description: 'Roast someone with AI',
  category: 'fun',
};

export const data = new SlashCommandBuilder()
  .setName('roast')
  .setDescription('🔥 Roast someone with AI (keep it fun, not mean!)')
  .addUserOption(o => o
    .setName('target')
    .setDescription('Who to roast (default: yourself)')
    .setRequired(false))
  .addStringOption(o => o
    .setName('vibe')
    .setDescription('Roast style')
    .setRequired(false)
    .addChoices(
      { name: '😂 Playful', value: 'playful' },
      { name: '🥊 Hard', value: 'hard' },
      { name: '🤓 Nerdy', value: 'nerdy' },
      { name: '🎤 Rap battle style', value: 'rap' },
    ));

const RATE_LIMIT_KEY = 'roast';
const RATE_LIMIT_WINDOW = 60; // seconds

// Track recently roasted targets per invoker to prevent spam-targeting the same user
// Map<invokerId, { targetId, count, firstAt }>
const TARGET_SPAM_MAP = new Map();
const TARGET_SPAM_WINDOW = 5 * 60 * 1000; // 5 minutes
const TARGET_SPAM_LIMIT = 3;

const SYSTEM_PROMPTS = {
  playful: 'You are a witty comedian. Write a short, funny, PLAYFUL roast (2-3 sentences). Keep it light and fun, not genuinely mean. No slurs, no profanity.',
  hard: 'You are a savage comedian. Write a sharp, clever roast (2-3 sentences). Keep it creative and punchy. No slurs, no profanity.',
  nerdy: 'You are a nerdy comedian. Write a roast using science, tech, and pop culture references (2-3 sentences). Be witty and clever.',
  rap: 'You are a battle rapper. Write a short rap verse roasting the target (4 lines, rhyming). Keep it clever and fun, no slurs.',
};

/** Picks a random fallback roast, avoiding the last N seen (no-repeat window). */
const _lastPicked = new Map(); // userId → Set of recently used indices
function pickFallbackRoast(userId) {
  const seen = _lastPicked.get(userId) || new Set();
  const available = FALLBACK_ROASTS.map((_, i) => i).filter(i => !seen.has(i));
  const pool = available.length > 0 ? available : Array.from({ length: FALLBACK_ROASTS.length }, (_, i) => i);
  const idx = pool[Math.floor(Math.random() * pool.length)];
  if (seen.size >= 20) seen.clear(); // Reset after 20 uses
  seen.add(idx);
  _lastPicked.set(userId, seen);
  return FALLBACK_ROASTS[idx];
}

export async function execute(interaction) {
  const target = interaction.options.getUser('target') || interaction.user;
  const vibe = interaction.options.getString('vibe') || 'playful';
  const isSelf = target.id === interaction.user.id;

  // Rate limit per user
  const rl = await checkRateLimit(`${RATE_LIMIT_KEY}:${interaction.user.id}`, 1, RATE_LIMIT_WINDOW).catch(() => ({ ok: true }));
  if (!rl.ok) {
    const remaining = Math.ceil(rl.retryAfter || RATE_LIMIT_WINDOW);
    await interaction.reply({ content: `⏳ You can roast again in **${remaining}s**.`, ephemeral: true });
    return;
  }

  // Anti-spam: block spamming the same target repeatedly
  if (!isSelf) {
    const spamKey = interaction.user.id;
    const spamEntry = TARGET_SPAM_MAP.get(spamKey);
    const now = Date.now();
    if (spamEntry && spamEntry.targetId === target.id && (now - spamEntry.firstAt) < TARGET_SPAM_WINDOW) {
      if (spamEntry.count >= TARGET_SPAM_LIMIT) {
        await interaction.reply({ content: `⚠️ Give them a break! You've roasted **${target.username}** too many times recently. Try a different target.`, ephemeral: true });
        return;
      }
      spamEntry.count++;
    } else {
      TARGET_SPAM_MAP.set(spamKey, { targetId: target.id, count: 1, firstAt: now });
    }
  }

  await interaction.deferReply();
  await withTimeout(interaction, async () => {
    const targetName = target.displayName || target.username;
    const prompt = `Write a ${vibe} roast for a Discord user named "${targetName}". Keep it under 3 sentences.`;
    const system = SYSTEM_PROMPTS[vibe] || SYSTEM_PROMPTS.playful;

    let roastText = '';
    try {
      roastText = await generateText({ prompt, system, guildId: interaction.guildId });
    } catch {}

    if (!roastText || roastText.trim().length < 10) {
      roastText = pickFallbackRoast(interaction.user.id);
    }

    const embed = new EmbedBuilder()
      .setTitle(`🔥 ${isSelf ? interaction.user.username + ' roasted themselves' : interaction.user.username + ' roasted ' + targetName}`)
      .setDescription(roastText)
      .setColor(Colors.Orange)
      .setThumbnail(target.displayAvatarURL({ size: 64 }))
      .setFooter({ text: 'Keep it fun, not mean 😄' });

    await interaction.editReply({ embeds: [embed] });
  }, { label: "roast" });
}
