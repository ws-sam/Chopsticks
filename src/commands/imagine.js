// src/commands/imagine.js
// /imagine — free AI image generation via HuggingFace FLUX.1-schnell

import { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder, Colors } from 'discord.js';
import { withTimeout } from '../utils/interactionTimeout.js';

export const meta = {
  name: 'imagine',
  description: 'Generate AI images for free using HuggingFace',
  category: 'fun',
};

export const data = new SlashCommandBuilder()
  .setName('imagine')
  .setDescription('🎨 Generate an AI image from a text prompt (free, no API key required for basic use)')
  .addStringOption(o => o
    .setName('prompt')
    .setDescription('Describe what you want to see')
    .setRequired(true)
    .setMaxLength(500))
  .addStringOption(o => o
    .setName('style')
    .setDescription('Visual style (optional)')
    .setRequired(false)
    .addChoices(
      { name: 'Default', value: 'default' },
      { name: '🎨 Artistic', value: 'artistic' },
      { name: '📸 Photorealistic', value: 'photorealistic' },
      { name: '🌌 Fantasy', value: 'fantasy' },
      { name: '🤖 Cyberpunk', value: 'cyberpunk' },
      { name: '🎭 Anime', value: 'anime' },
    ));

// Per-user per-guild rate limiting (in-memory, resets on restart)
const rateLimits = new Map();
const RATE_LIMIT_MS = 30_000;

// Models to try in order (all free on HF Inference API)
const MODELS = [
  'black-forest-labs/FLUX.1-schnell',
  'stabilityai/stable-diffusion-xl-base-1.0',
  'runwayml/stable-diffusion-v1-5',
];

const STYLE_SUFFIXES = {
  artistic:       ', digital art, vibrant colors, artistic',
  photorealistic: ', photorealistic, 8k uhd, DSLR photo, sharp focus',
  fantasy:        ', fantasy art, magical, ethereal, detailed illustration',
  cyberpunk:      ', cyberpunk, neon lights, dark futuristic, ultra-detailed',
  anime:          ', anime style, Studio Ghibli, detailed anime art',
  default:        '',
};

// Banned keywords (basic safety filter)
const BANNED = /\b(nude|naked|nsfw|porn|sexual|sex|gore|violent|blood|weapon|terrorist|bomb)\b/i;

export async function execute(interaction) {
  const prompt = interaction.options.getString('prompt');
  const style = interaction.options.getString('style') || 'default';

  // Safety filter
  if (BANNED.test(prompt)) {
    await interaction.reply({ content: '❌ Your prompt contains disallowed content.', ephemeral: true });
    return;
  }

  // Rate limit per user per guild
  const rlKey = `${interaction.guildId || 'dm'}:${interaction.user.id}`;
  const lastUsed = rateLimits.get(rlKey) || 0;
  if (Date.now() - lastUsed < RATE_LIMIT_MS) {
    const remaining = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastUsed)) / 1000);
    await interaction.reply({ content: `⏳ Please wait **${remaining}s** before generating another image.`, ephemeral: true });
    return;
  }
  rateLimits.set(rlKey, Date.now());

  await interaction.deferReply();

  await withTimeout(interaction, async () => {
    const fullPrompt = prompt + (STYLE_SUFFIXES[style] || '');
    const hfKey = process.env.HUGGINGFACE_API_KEY;

    if (!hfKey) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('🎨 /imagine — Setup Required')
          .setColor(Colors.Orange)
          .setDescription([
            'Image generation requires a free HuggingFace API key.',
            '',
            '**To enable:**',
            '1. Visit [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)',
            '2. Create a free **Read** token',
            '3. Add `HUGGINGFACE_API_KEY=hf_your_token` to your `.env`',
            '4. Restart the bot',
            '',
            'This uses **FLUX.1-schnell**, a state-of-the-art free model. No credit card required.',
          ].join('\n'))
        ]
      });
      return;
    }

    let imageBuffer = null;
    let usedModel = null;
    let lastError = null;

    for (const model of MODELS) {
      try {
        const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${hfKey}`,
            'Content-Type': 'application/json',
            'X-Use-Cache': 'false',
          },
          body: JSON.stringify({ inputs: fullPrompt, parameters: { num_inference_steps: 4 } }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => '');
          if (res.status === 503) {
            // Model loading — try next
            lastError = `Model ${model} is loading, please try again in a moment.`;
            continue;
          }
          lastError = `Model ${model} returned ${res.status}: ${errorText.slice(0, 100)}`;
          continue;
        }

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
          lastError = `Unexpected response type: ${contentType}`;
          continue;
        }

        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 1000) {
          lastError = 'Received empty image response';
          continue;
        }

        imageBuffer = buf;
        usedModel = model;
        break;
      } catch (err) {
        lastError = err.message;
        continue;
      }
    }

    if (!imageBuffer) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Image Generation Failed')
          .setColor(Colors.Red)
          .setDescription(`Could not generate image. ${lastError || 'Please try again in a moment.'}\n\nTip: HuggingFace free tier models sometimes need a warm-up — try again in 30 seconds.`)
        ]
      });
      return;
    }

    const ext = usedModel?.includes('FLUX') ? 'png' : 'png';
    const att = new AttachmentBuilder(imageBuffer, { name: `imagine.${ext}` });
    const embed = new EmbedBuilder()
      .setTitle('🎨 AI Image Generated')
      .setDescription(`**Prompt:** ${prompt}${style !== 'default' ? `\n**Style:** ${style}` : ''}`)
      .setImage(`attachment://imagine.${ext}`)
      .setColor(Colors.Blurple)
      .setFooter({ text: `Model: ${usedModel?.split('/')[1] || usedModel} • Powered by HuggingFace` });

    await interaction.editReply({ embeds: [embed], files: [att] });
  }, { label: "imagine" });
}
