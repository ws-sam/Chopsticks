import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from "discord.js";
import { createCanvas } from "@napi-rs/canvas";
import { botLogger } from "../utils/modernLogger.js";

export const meta = {
  category: "utility",
  guildOnly: false,
};

export const data = new SlashCommandBuilder()
  .setName("color")
  .setDescription("Preview a hex color with its RGB, HSL and name")
  .addStringOption(opt =>
    opt.setName("hex")
      .setDescription("Hex color code (e.g. #5865F2 or 5865F2)")
      .setRequired(true)
      .setMaxLength(7)
  );

function hexToRgb(hex) {
  const c = hex.replace("#", "");
  const n = parseInt(c.length === 3 ? c.split("").map(x => x + x).join("") : c, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

/** Perceived luminance — determines whether to use white or black text */
function luminance(r, g, b) {
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function makePreview(hex, r, g, b) {
  const W = 300, H = 120;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, W, H);

  // Text color based on perceived luminance
  ctx.fillStyle = luminance(r, g, b) > 0.179 ? "#111111" : "#eeeeee";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(hex.toUpperCase(), W / 2, H / 2);

  return canvas.toBuffer("image/png");
}

export async function execute(interaction) {
  const raw = interaction.options.getString("hex", true).trim();
  const hex = raw.startsWith("#") ? raw : `#${raw}`;

  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return interaction.reply({ content: "❌ Invalid hex color. Use format `#RRGGBB` (e.g. `#5865F2`).", ephemeral: true });
  }

  await interaction.deferReply();

  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const colorInt = parseInt(hex.slice(1), 16);

  let buffer = null;
  try {
    buffer = makePreview(hex, r, g, b);
  } catch (err) {
    botLogger.warn({ err }, "[color] canvas preview failed");
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎨 Color Preview: ${hex.toUpperCase()}`)
    .setColor(colorInt)
    .addFields(
      { name: "HEX", value: `\`${hex.toUpperCase()}\``, inline: true },
      { name: "RGB", value: `\`rgb(${r}, ${g}, ${b})\``, inline: true },
      { name: "HSL", value: `\`hsl(${h}°, ${s}%, ${l}%)\``, inline: true },
      { name: "Decimal", value: `\`${colorInt}\``, inline: true },
    )
    .setTimestamp();

  if (buffer) {
    const attachment = new AttachmentBuilder(buffer, { name: "color.png" });
    embed.setImage("attachment://color.png");
    return interaction.editReply({ embeds: [embed], files: [attachment] });
  }

  await interaction.editReply({ embeds: [embed] });
}
