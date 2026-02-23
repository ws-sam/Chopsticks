// src/commands/riddle.js
// /riddle — Random riddle with spoiler-text answer reveal

import { SlashCommandBuilder, EmbedBuilder, Colors } from 'discord.js';
import { withTimeout } from '../utils/interactionTimeout.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const RIDDLES = require('../fun/riddles.json');

export const meta = {
  name: 'riddle',
  description: 'Get a random riddle',
  category: 'fun',
};

export const data = new SlashCommandBuilder()
  .setName('riddle')
  .setDescription('🧩 Get a random riddle — answer is hidden as a spoiler!')
  .addBooleanOption(o => o
    .setName('reveal')
    .setDescription('Show the answer immediately (default: hidden as spoiler)')
    .setRequired(false));

export async function execute(interaction) {
  await interaction.deferReply();
  await withTimeout(interaction, async () => {
    const reveal = interaction.options.getBoolean('reveal') ?? false;
    const riddle = RIDDLES[Math.floor(Math.random() * RIDDLES.length)];

    const answerText = reveal
      ? `**Answer:** ${riddle.a}`
      : `**Answer:** ||${riddle.a}||`;

    const embed = new EmbedBuilder()
      .setTitle('🧩 Riddle Me This…')
      .setColor(Colors.Purple)
      .setDescription([
        riddle.q,
        '',
        answerText,
      ].join('\n'))
      .setFooter({ text: reveal ? 'Answer revealed!' : 'Click the spoiler to reveal the answer 👆' });

    await interaction.editReply({ embeds: [embed] });
  }, { label: 'riddle' });
}
