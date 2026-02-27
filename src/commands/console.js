import { SlashCommandBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } from "discord.js";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { Colors } from "../utils/discordOutput.js";
import { progressBar } from "../utils/embedComponents.js";

const CONSOLE_TOKEN_TTL = 10 * 60; // 10 minutes

function safeSlug(v) { return /^[a-zA-Z0-9-]+$/.test(String(v || '')) ? v : null; }
function safeUrl(v) {
  try { const u = new URL(v); return (u.protocol === 'http:' || u.protocol === 'https:') ? u.origin : null; }
  catch { return null; }
}

function getDashboardUrl() {
  const explicit = String(process.env.DASHBOARD_BASE_URL || "").trim();
  if (explicit) return safeUrl(explicit) ?? explicit.replace(/\/+$/g, "");

  // Mirror the server-side auto-detection so the bot generates the right link
  const railway = safeSlug(process.env.RAILWAY_STATIC_URL);
  if (railway) return `https://${railway}`;
  const render = process.env.RENDER_EXTERNAL_URL && safeUrl(process.env.RENDER_EXTERNAL_URL);
  if (render) return render;
  const fly = safeSlug(process.env.FLY_APP_NAME);
  if (fly) return `https://${fly}.fly.dev`;
  const heroku = safeSlug(process.env.HEROKU_APP_NAME);
  if (heroku) return `https://${heroku}.herokuapp.com`;
  const koyeb = safeSlug(process.env.KOYEB_PUBLIC_DOMAIN);
  if (koyeb) return `https://${koyeb}`;
  const pub = process.env.PUBLIC_URL && safeUrl(process.env.PUBLIC_URL);
  if (pub) return pub;

  const port = process.env.DASHBOARD_PORT || 8788;
  return `http://localhost:${port}`;
}

function getJwtSecret() {
  const explicit = String(process.env.DASHBOARD_SECRET || "").trim();
  if (explicit) return explicit;

  const botToken = String(process.env.DISCORD_TOKEN || "").trim();
  if (botToken) {
    return createHash("sha256").update(botToken + "chopsticks-console-v1").digest("hex").slice(0, 64);
  }
  throw new Error("DISCORD_TOKEN is not set — cannot derive console secret.");
}

/**
 * Builds the live server health snapshot for the dashboard reply.
 * Gathers agent pool stats and uptime info without blocking.
 */
function buildHealthSnapshot(guildId) {
  const mgr = global.agentManager;
  if (!mgr) return null;

  const allAgents = Array.from(mgr.liveAgents?.values?.() ?? []);
  const guildAgents = allAgents.filter(a => a.guildIds?.has?.(guildId));
  const active  = guildAgents.filter(a => a.ready && !a.busyKey).length;
  const busy    = guildAgents.filter(a => a.busyKey).length;
  const total   = guildAgents.length;
  const capacity = 49;

  const warmStatus = mgr.getWarmStatus ? mgr.getWarmStatus(guildId) : null;

  return { total, active, busy, capacity, warmStatus };
}

export const meta = { category: "admin", deployGlobal: false };

export const data = new SlashCommandBuilder()
  .setName("console")
  .setDescription("Open your server's Chopsticks web dashboard — ephemeral single-use link")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const baseUrl = getDashboardUrl();

  let secret;
  try {
    secret = getJwtSecret();
  } catch (err) {
    return interaction.reply({
      content: `❌ ${err.message}`,
      ephemeral: true,
    });
  }

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const guildName = interaction.guild?.name ?? "this server";
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
    { expiresIn: `${CONSOLE_TOKEN_TTL}s`, algorithm: "HS256" }
  );

  const consoleUrl = `${baseUrl}/console-auth?token=${encodeURIComponent(token)}`;

  // Build rich embed
  const embed = new EmbedBuilder()
    .setTitle("📊 Chopsticks Dashboard")
    .setDescription(`Your management dashboard for **${guildName}** is ready.\nClick the button below to open it in your browser.`)
    .setColor(Colors.Info)
    .addFields(
      { name: "🔒 Session", value: `Expires in **10 minutes** · Single-use · Only you`, inline: false },
    );

  // Add live agent pool stats if available
  const health = buildHealthSnapshot(guildId);
  if (health) {
    const bar = progressBar(health.total, health.capacity);
    const statusLine = health.total === 0
      ? "_No agents in this server_"
      : `🟢 Active: **${health.active}**  🔴 Busy: **${health.busy}**  Total: **${health.total}**\n${bar}`;
    embed.addFields({ name: "🤖 Agent Pool", value: statusLine, inline: false });
    if (health.warmStatus?.needsWarmup) {
      embed.addFields({
        name: "⚡ Warm-pool",
        value: `Only **${health.warmStatus.idleAgents}** idle agents (target: **${health.warmStatus.warmCount}**). Consider deploying more.`,
        inline: false,
      });
    }
  }

  embed.setFooter({ text: `${interaction.user.username} · ${new Date().toUTCString()}` });

  const button = new ButtonBuilder()
    .setLabel("Open Dashboard")
    .setStyle(ButtonStyle.Link)
    .setURL(consoleUrl)
    .setEmoji("📊");

  const row = new ActionRowBuilder().addComponents(button);

  return interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });
}

