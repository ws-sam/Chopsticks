import { SlashCommandBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import jwt from "jsonwebtoken";
import { createClient } from "redis";

const CONSOLE_TOKEN_TTL = 10 * 60; // 10 minutes

function getDashboardUrl() {
  return String(process.env.DASHBOARD_BASE_URL || "").replace(/\/$/, "");
}

function getJwtSecret() {
  const secret = String(
    process.env.DASHBOARD_SECRET || process.env.DASHBOARD_SESSION_SECRET || ""
  ).trim();
  if (!secret) throw new Error("DASHBOARD_SECRET is not configured.");
  return secret;
}

async function markTokenUsed(tokenId) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return; // no Redis? skip one-time-use enforcement
  const client = createClient({ url: redisUrl });
  await client.connect().catch(() => null);
  await client.set(`console_token:${tokenId}`, "1", { EX: CONSOLE_TOKEN_TTL }).catch(() => null);
  await client.quit().catch(() => null);
}

export async function isTokenConsumed(tokenId) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return false;
  const client = createClient({ url: redisUrl });
  await client.connect().catch(() => null);
  const val = await client.get(`console_token:${tokenId}`).catch(() => null);
  await client.quit().catch(() => null);
  return val === "used";
}

export async function consumeToken(tokenId) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return true; // allow if no Redis
  const client = createClient({ url: redisUrl });
  await client.connect().catch(() => null);
  // nx = set only if not exists; returns null if already set
  const set = await client.set(`console_token:${tokenId}`, "used", { EX: CONSOLE_TOKEN_TTL, NX: true }).catch(() => null);
  await client.quit().catch(() => null);
  return set !== null; // true = first time (ok), false = already consumed
}

export const meta = { category: "utility" };

export const data = new SlashCommandBuilder()
  .setName("console")
  .setDescription("Open your server's Chopsticks control panel in a browser")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const baseUrl = getDashboardUrl();
  if (!baseUrl) {
    return interaction.reply({
      content:
        "❌ The dashboard URL is not configured. Set `DASHBOARD_BASE_URL` in the bot's environment.",
      ephemeral: true,
    });
  }

  let secret;
  try {
    secret = getJwtSecret();
  } catch {
    return interaction.reply({
      content:
        "❌ Dashboard secret is not configured. Set `DASHBOARD_SECRET` in the bot's environment.",
      ephemeral: true,
    });
  }

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const tokenId = `${userId}-${guildId}-${Date.now()}`;

  const token = jwt.sign(
    {
      jti: tokenId,
      userId,
      guildId,
      username: interaction.user.username,
      avatarHash: interaction.user.avatar,
    },
    secret,
    { expiresIn: `${CONSOLE_TOKEN_TTL}s` }
  );

  await markTokenUsed(tokenId).catch(() => null);

  const consoleUrl = `${baseUrl}/console-auth?token=${encodeURIComponent(token)}`;

  const button = new ButtonBuilder()
    .setLabel("Open Console")
    .setStyle(ButtonStyle.Link)
    .setURL(consoleUrl)
    .setEmoji("🖥️");

  const row = new ActionRowBuilder().addComponents(button);

  return interaction.reply({
    content:
      `### 🖥️ Chopsticks Console\nYour personalized control panel for **${interaction.guild?.name ?? "this server"}** is ready.\n` +
      `> ⏱️ This link expires in **10 minutes** and can only be used once.\n` +
      `> 🔒 Only you can access this session.`,
    components: [row],
    ephemeral: true,
  });
}
