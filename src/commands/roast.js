// src/commands/roast.js
// /roast @user — AI-powered roast

import { SlashCommandBuilder, EmbedBuilder, Colors } from 'discord.js';
import { generateText } from '../utils/textLlm.js';
import { checkRateLimit } from '../utils/ratelimit.js';
import { withTimeout } from "../utils/interactionTimeout.js";

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

const SYSTEM_PROMPTS = {
  playful: 'You are a witty comedian. Write a short, funny, PLAYFUL roast (2-3 sentences). Keep it light and fun, not genuinely mean. No slurs, no profanity.',
  hard: 'You are a savage comedian. Write a sharp, clever roast (2-3 sentences). Keep it creative and punchy. No slurs, no profanity.',
  nerdy: 'You are a nerdy comedian. Write a roast using science, tech, and pop culture references (2-3 sentences). Be witty and clever.',
  rap: 'You are a battle rapper. Write a short rap verse roasting the target (4 lines, rhyming). Keep it clever and fun, no slurs.',
};

// Fallback roasts when LLM is unavailable
const FALLBACK_ROASTS = [
  "Their WiFi password is 'password123' — and they're proud of it.",
  "They use Internet Explorer... unironically.",
  "Their GitHub is just a long list of 'initial commit' entries.",
  "The only thing they've ever committed to is a 60-day free trial that auto-renewed.",
  "They once opened a terminal and immediately googled 'how to close a terminal'.",
  "Their README just says 'TODO: write readme'.",
  "They reply to DMs with 'k' and think that's a full conversation.",
  "They muted the server notifications but still complain about missing announcements.",
  "Their code is so spaghetti that even Italian grandmothers are confused.",
  "They joined 47 servers and haven't talked in any of them.",
];

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
      // Fallback roast
      roastText = FALLBACK_ROASTS[Math.floor(Math.random() * FALLBACK_ROASTS.length)];
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
