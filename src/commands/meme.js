// src/commands/meme.js
// /meme — Fetch a random meme from Reddit via meme-api.com

import { SlashCommandBuilder, EmbedBuilder, Colors } from 'discord.js';
import { withTimeout } from '../utils/interactionTimeout.js';
import { checkRateLimit } from '../utils/ratelimit.js';

export const meta = {
  name: 'meme',
  description: 'Random meme',
  category: 'fun',
};

export const data = new SlashCommandBuilder()
  .setName('meme')
  .setDescription('😂 Get a random meme from Reddit')
  .addStringOption(o => o
    .setName('subreddit')
    .setDescription('Subreddit to pull from (default: random popular meme sub)')
    .setRequired(false)
    .addChoices(
      { name: '🎲 Random', value: 'random' },
      { name: '🐸 me_irl', value: 'me_irl' },
      { name: '🧠 dankmemes', value: 'dankmemes' },
      { name: '💻 ProgrammerHumor', value: 'ProgrammerHumor' },
      { name: '🎮 gaming', value: 'gaming' },
      { name: '🌍 worldnews memes', value: 'AdviceAnimals' },
    ));

// Per-channel rate limit: max 3 memes per 30 seconds to avoid spam
const CHANNEL_RATE_MS = 30_000;
const channelLastUsed = new Map();

const MEME_SUBS = ['dankmemes', 'me_irl', 'ProgrammerHumor', 'memes', 'funny'];

// Fallback meme bank (static images) for when API is unavailable
const FALLBACK_MEMES = [
  {
    title: "This is fine 🔥",
    url: "https://i.imgur.com/c4jt321.png",
    sub: "r/me_irl",
  },
  {
    title: "Expanding Brain",
    url: "https://i.imgur.com/nlme6QT.png",
    sub: "r/dankmemes",
  },
  {
    title: "Distracted Boyfriend",
    url: "https://i.imgur.com/Oi5ZPAP.jpg",
    sub: "r/memes",
  },
  {
    title: "Woman Yelling at Cat",
    url: "https://i.imgur.com/sq5NIpJ.png",
    sub: "r/memes",
  },
  {
    title: "Surprised Pikachu",
    url: "https://i.imgur.com/0tWugmM.png",
    sub: "r/me_irl",
  },
];

export async function execute(interaction) {
  const subOption = interaction.options.getString('subreddit') || 'random';
  const sub = subOption === 'random'
    ? MEME_SUBS[Math.floor(Math.random() * MEME_SUBS.length)]
    : subOption;

  // Per-channel rate limit
  const channelKey = interaction.channelId || 'dm';
  const lastUsed = channelLastUsed.get(channelKey) || 0;
  if (Date.now() - lastUsed < CHANNEL_RATE_MS) {
    const remaining = Math.ceil((CHANNEL_RATE_MS - (Date.now() - lastUsed)) / 1000);
    await interaction.reply({ content: `⏳ Slow down! Wait **${remaining}s** before requesting another meme in this channel.`, ephemeral: true });
    return;
  }
  channelLastUsed.set(channelKey, Date.now());

  await interaction.deferReply();
  await withTimeout(interaction, async () => {
    let title = null;
    let imageUrl = null;
    let postUrl = null;
    let subName = sub;

    try {
      const res = await fetch(`https://meme-api.com/gimme/${encodeURIComponent(sub)}`, {
        headers: { 'User-Agent': 'Chopsticks-Discord-Bot/1.5' },
        signal: AbortSignal.timeout(8_000),
      });

      if (res.ok) {
        const data = await res.json();
        // Filter NSFW
        if (data.nsfw) {
          await interaction.editReply({ content: '🔞 Fetched an NSFW meme — skipping. Try again!' });
          return;
        }
        if (data.url && data.title) {
          title = data.title;
          imageUrl = data.url;
          postUrl = data.postLink;
          subName = data.subreddit ? `r/${data.subreddit}` : `r/${sub}`;
        }
      }
    } catch {}

    // Use fallback if API failed
    if (!imageUrl) {
      const fb = FALLBACK_MEMES[Math.floor(Math.random() * FALLBACK_MEMES.length)];
      title = fb.title;
      imageUrl = fb.url;
      subName = fb.sub;
    }

    const embed = new EmbedBuilder()
      .setTitle(title || 'Random Meme')
      .setImage(imageUrl)
      .setColor(Colors.Yellow)
      .setFooter({ text: `${subName}${postUrl ? ' • Click title for original post' : ''}` });

    if (postUrl) embed.setURL(postUrl);

    await interaction.editReply({ embeds: [embed] });
  }, { label: 'meme' });
}
