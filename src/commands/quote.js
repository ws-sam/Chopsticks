// src/commands/quote.js
// /quote — Random inspirational, funny, or programming quote

import { SlashCommandBuilder, EmbedBuilder, Colors } from 'discord.js';
import { withTimeout } from '../utils/interactionTimeout.js';
import { httpRequest } from '../utils/httpFetch.js';

export const meta = {
  name: 'quote',
  description: 'Random quote',
  category: 'fun',
};

export const data = new SlashCommandBuilder()
  .setName('quote')
  .setDescription('💬 Get a random quote')
  .addStringOption(o => o
    .setName('type')
    .setDescription('Quote category (default: inspirational)')
    .setRequired(false)
    .addChoices(
      { name: '✨ Inspirational', value: 'inspire' },
      { name: '😂 Funny', value: 'funny' },
      { name: '💻 Programming', value: 'programming' },
      { name: '🎲 Random', value: 'random' },
    ));

const FALLBACK = {
  inspire: [
    { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
    { text: "In the middle of every difficulty lies opportunity.", author: "Albert Einstein" },
    { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
    { text: "Success is not final, failure is not fatal — it is the courage to continue that counts.", author: "Winston Churchill" },
    { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
    { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
    { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
    { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
    { text: "Dream big and dare to fail.", author: "Norman Vaughan" },
    { text: "Act as if what you do makes a difference. It does.", author: "William James" },
  ],
  funny: [
    { text: "I told my wife she was drawing her eyebrows too high. She looked surprised.", author: "Anonymous" },
    { text: "Why do programmers prefer dark mode? Because light attracts bugs.", author: "Anonymous" },
    { text: "I'm reading a book about anti-gravity. It's impossible to put down.", author: "Anonymous" },
    { text: "The trouble with having an open mind, of course, is that people will insist on coming along and trying to put things in it.", author: "Terry Pratchett" },
    { text: "If at first you don't succeed, we have a lot in common.", author: "Anonymous" },
    { text: "Age is merely the number of years the world has been enjoying you.", author: "Anonymous" },
    { text: "I used to think I was indecisive, but now I'm not so sure.", author: "Anonymous" },
    { text: "Life is short. Smile while you still have teeth.", author: "Anonymous" },
    { text: "I'm not lazy. I'm in energy-saving mode.", author: "Anonymous" },
    { text: "My bed is a magical place where I suddenly remember everything I forgot to do.", author: "Anonymous" },
  ],
  programming: [
    { text: "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.", author: "Martin Fowler" },
    { text: "First, solve the problem. Then, write the code.", author: "John Johnson" },
    { text: "Experience is the name everyone gives to their mistakes.", author: "Oscar Wilde" },
    { text: "It's not a bug — it's an undocumented feature.", author: "Anonymous" },
    { text: "The best error message is the one that never shows up.", author: "Thomas Fuchs" },
    { text: "Debugging is twice as hard as writing the code in the first place. Therefore, if you write the code as cleverly as possible, you are, by definition, not smart enough to debug it.", author: "Brian Kernighan" },
    { text: "Walking on water and developing software from a specification are easy if both are frozen.", author: "Edward V. Berard" },
    { text: "The most important property of a program is whether it accomplishes the intention of its user.", author: "C.A.R. Hoare" },
    { text: "Code is like humor. When you have to explain it, it's bad.", author: "Cory House" },
    { text: "Programs must be written for people to read, and only incidentally for machines to execute.", author: "Harold Abelson" },
  ],
};

const COLOR = {
  inspire: Colors.Gold,
  funny: Colors.Purple,
  programming: Colors.Blurple,
  random: Colors.Aqua,
};

export async function execute(interaction) {
  let type = interaction.options.getString('type') || 'inspire';
  if (type === 'random') {
    type = ['inspire', 'funny', 'programming'][Math.floor(Math.random() * 3)];
  }

  await interaction.deferReply();
  await withTimeout(interaction, async () => {
    let quoteText = null;
    let author = null;

    // Try live API for inspirational quotes
    if (type === 'inspire') {
      try {
        const data = await httpRequest('quote', 'https://zenquotes.io/api/random', {
          method: 'GET',
          headers: { 'User-Agent': 'Chopsticks-Discord-Bot/1.5' },
        });
        if (Array.isArray(data) && data[0]?.q) {
          quoteText = data[0].q;
          author = data[0].a;
        }
      } catch {}
    }

    // Fallback to local bank
    if (!quoteText) {
      const pool = FALLBACK[type] || FALLBACK.inspire;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      quoteText = pick.text;
      author = pick.author;
    }

    const typeLabel = type === 'inspire' ? '✨ Inspirational' : type === 'funny' ? '😂 Funny' : '💻 Programming';

    const embed = new EmbedBuilder()
      .setTitle(`${typeLabel} Quote`)
      .setDescription(`*"${quoteText}"*`)
      .setColor(COLOR[type] || Colors.Aqua)
      .setFooter({ text: `— ${author || 'Unknown'}` });

    await interaction.editReply({ embeds: [embed] });
  }, { label: 'quote' });
}
