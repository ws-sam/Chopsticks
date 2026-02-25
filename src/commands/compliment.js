// src/commands/compliment.js
// /compliment @user — AI-powered compliment (positive counterpart to /roast)

import { SlashCommandBuilder, EmbedBuilder, Colors } from 'discord.js';
import { generateText } from '../utils/textLlm.js';
import { checkRateLimit } from '../utils/ratelimit.js';
import { withTimeout } from '../utils/interactionTimeout.js';

export const meta = {
  name: 'compliment',
  description: 'Compliment someone with AI',
  category: 'fun',
  deployGlobal: false, // merged into /social compliment
};

export const data = new SlashCommandBuilder()
  .setName('compliment')
  .setDescription('💐 Compliment someone with a heartfelt (or hilariously over-the-top) message')
  .addUserOption(o => o
    .setName('target')
    .setDescription('Who to compliment (default: yourself)')
    .setRequired(false))
  .addStringOption(o => o
    .setName('style')
    .setDescription('Compliment style')
    .setRequired(false)
    .addChoices(
      { name: '💛 Genuine', value: 'genuine' },
      { name: '🎭 Over-the-top', value: 'dramatic' },
      { name: '🤓 Nerdy', value: 'nerdy' },
      { name: '🎤 Rap style', value: 'rap' },
    ));

const FALLBACK_COMPLIMENTS = [
  "They have the energy of a perfectly brewed cup of coffee — warm, uplifting, and absolutely necessary.",
  "Their brain is so vast that libraries pay them royalties.",
  "They could make a Monday morning feel like a Friday evening.",
  "If kindness were a currency, they'd be running the global economy.",
  "They solve problems so elegantly that other solutions apologize for existing.",
  "Their laugh is the human equivalent of a system restore — everything just works better afterward.",
  "They're the kind of person your future self will thank you for knowing.",
  "Talking to them is like a free upgrade — you leave feeling 2x better than when you arrived.",
  "Their code is so clean that syntax highlighters blush.",
  "They're proof that some people just make the world genuinely better by existing in it.",
];

const SYSTEM_PROMPTS = {
  genuine: 'You are a thoughtful friend. Write a short, sincere, warm compliment (2-3 sentences). Make it feel personal and genuine. No slurs, no sarcasm.',
  dramatic: 'You are a Shakespearean herald. Write an absolutely over-the-top, hilariously dramatic compliment (2-3 sentences). Go big — celestial metaphors, hyperbole, the works.',
  nerdy: 'You are a nerdy admirer. Write a compliment using science, tech, and pop culture references (2-3 sentences). Be clever and witty.',
  rap: 'You are a hype rapper. Write a short rap verse hyping up the target (4 lines, rhyming). Make them feel legendary.',
};

export async function execute(interaction) {
  const target = interaction.options.getUser('target') || interaction.user;
  const style = interaction.options.getString('style') || 'genuine';
  const isSelf = target.id === interaction.user.id;

  if (target.bot && target.id !== interaction.user.id) {
    await interaction.reply({ content: "⚠️ You can't compliment bots.", ephemeral: true });
    return;
  }

  const rl = await checkRateLimit(`compliment:${interaction.user.id}`, 1, 30).catch(() => ({ ok: true }));
  if (!rl.ok) {
    const remaining = Math.ceil(rl.retryAfter || 30);
    await interaction.reply({ content: `⏳ You can compliment again in **${remaining}s**.`, ephemeral: true });
    return;
  }

  await interaction.deferReply();
  await withTimeout(interaction, async () => {
    const targetName = target.displayName || target.username;
    const prompt = `Write a ${style} compliment for a Discord user named "${targetName}". Keep it under 3 sentences.`;
    const system = SYSTEM_PROMPTS[style] || SYSTEM_PROMPTS.genuine;

    let text = '';
    try {
      text = await generateText({ prompt, system, guildId: interaction.guildId });
    } catch {}

    if (!text || text.trim().length < 10) {
      text = FALLBACK_COMPLIMENTS[Math.floor(Math.random() * FALLBACK_COMPLIMENTS.length)];
    }

    const embed = new EmbedBuilder()
      .setTitle(`💐 ${isSelf ? interaction.user.username + ' appreciated themselves' : interaction.user.username + ' complimented ' + targetName}`)
      .setDescription(text)
      .setColor(Colors.Gold)
      .setThumbnail(target.displayAvatarURL({ size: 64 }))
      .setFooter({ text: 'Spread good vibes 💛' });

    await interaction.editReply({ embeds: [embed] });
  }, { label: 'compliment' });
}
