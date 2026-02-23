// src/commands/truthordare.js
// /truthordare — Random truth or dare prompt with solo or partner mode

import { SlashCommandBuilder, EmbedBuilder, Colors } from 'discord.js';
import { withTimeout } from '../utils/interactionTimeout.js';

export const meta = {
  name: 'truthordare',
  description: 'Truth or dare prompt',
  category: 'fun',
};

export const data = new SlashCommandBuilder()
  .setName('truthordare')
  .setDescription('🎭 Get a truth or dare prompt!')
  .addStringOption(o => o
    .setName('type')
    .setDescription('Truth, dare, or random (default: random)')
    .setRequired(false)
    .addChoices(
      { name: '🤔 Truth', value: 'truth' },
      { name: '💪 Dare', value: 'dare' },
      { name: '🎲 Random', value: 'random' },
    ))
  .addStringOption(o => o
    .setName('intensity')
    .setDescription('How intense? (default: mild)')
    .setRequired(false)
    .addChoices(
      { name: '😌 Mild', value: 'mild' },
      { name: '🌶️ Spicy', value: 'spicy' },
    ));

const PROMPTS = {
  truth: {
    mild: [
      "What's the most embarrassing song on your playlist?",
      "What's a weird habit you have that you don't tell people about?",
      "What's the last thing you Googled?",
      "What's the most childish thing you still do?",
      "Have you ever laughed so hard you snorted in public?",
      "What's a food you secretly hate but pretend to like?",
      "What's the most useless talent you have?",
      "What's the weirdest dream you've ever had?",
      "Have you ever talked to yourself in a mirror for more than 5 minutes?",
      "What's a movie everyone loves that you actually hate?",
      "What's the strangest thing you've ever eaten on a dare?",
      "What was the last lie you told?",
      "Have you ever pretended to be busy to avoid someone?",
      "What's your most embarrassing autocorrect fail?",
      "Do you sing in the shower? What songs?",
    ],
    spicy: [
      "What's the most awkward thing that's happened to you on a first date?",
      "What's the pettiest reason you've ever unfollowed someone?",
      "Have you ever ghosted someone? Tell the story.",
      "What's something you've done that you'd never admit in public?",
      "Who in this server do you think has the worst music taste?",
      "What's the most embarrassing thing in your camera roll right now?",
      "Have you ever blamed something on a pet that was actually your fault?",
      "What's a secret you've kept from your best friend?",
      "Have you ever stolen something? Even something small?",
      "What's the biggest lie you've ever gotten away with?",
    ],
  },
  dare: {
    mild: [
      "Type a message to the last person you texted using only emojis.",
      "Do your best impression of someone famous for 30 seconds.",
      "Say the alphabet backwards as fast as you can.",
      "Talk in a different accent for the next 3 messages.",
      "Come up with a rap about the person to your left (or above you in chat).",
      "Screenshot your most-used emoji and share it.",
      "Send a voice message saying something nice about everyone in the call.",
      "Do 10 push-ups right now.",
      "Change your Discord status to something embarrassing for 10 minutes.",
      "Use only questions for your next 5 messages.",
      "Call someone in your phone contacts and say 'I love you' then hang up.",
      "Send a GIF that describes your current mood.",
      "Describe your last dream using only emoji.",
      "Talk like a pirate for the next 2 minutes.",
      "Do the worm (or attempt to, and report back).",
    ],
    spicy: [
      "Post your most recent cringe text conversation (redact names if needed).",
      "DM someone in this server a random compliment right now.",
      "Let the group choose your profile picture for the next hour.",
      "Send a voice message singing the chorus of the last song you listened to.",
      "Share the last photo in your camera roll (no deletions beforehand).",
      "Change your nickname in this server to whatever the group decides — for 1 hour.",
      "Post a screenshot of your most-used apps.",
      "Let someone else type one message from your account.",
      "Do your most embarrassing impression and record it.",
      "Reveal your screen time from this week.",
    ],
  },
};

export async function execute(interaction) {
  const rawType = interaction.options.getString('type') || 'random';
  const intensity = interaction.options.getString('intensity') || 'mild';

  await interaction.deferReply();
  await withTimeout(interaction, async () => {
    const type = rawType === 'random' ? (Math.random() < 0.5 ? 'truth' : 'dare') : rawType;
    const pool = PROMPTS[type][intensity];
    const prompt = pool[Math.floor(Math.random() * pool.length)];

    const isTruth = type === 'truth';
    const embed = new EmbedBuilder()
      .setTitle(isTruth ? '🤔 TRUTH' : '💪 DARE')
      .setDescription(prompt)
      .setColor(isTruth ? Colors.Blue : Colors.Orange)
      .setFooter({ text: `Intensity: ${intensity} • /truthordare for another!` });

    await interaction.editReply({ embeds: [embed] });
  }, { label: 'truthordare' });
}
