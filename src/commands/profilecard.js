import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } from "discord.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getWallet } from "../economy/wallet.js";
import { getGameProfile } from "../game/profile.js";
import { progressToNextLevel } from "../game/progression.js";
import { getUserAchievements } from "../utils/storage_pg.js";
import { getCollectionStats } from "../economy/collections.js";
import { botLogger } from "../utils/modernLogger.js";
import { Colors } from "../utils/discordOutput.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  category: "profile",
  guildOnly: false,
};

export const data = new SlashCommandBuilder()
  .setName("profilecard")
  .setDescription("Generate a rich image profile card")
  .addUserOption(opt =>
    opt.setName("user")
      .setDescription("User to view (defaults to yourself)")
      .setRequired(false)
  );

// ── helpers ─────────────────────────────────────────────────────────────────

const W = 680, H = 340;
const ACCENT = "#5865F2";
const BG = "#1e2124";
const BG2 = "#2c2f33";
const TEXT = "#ffffff";
const MUTED = "#99aab5";
const BAR_TRACK = "#36393f";

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawProgressBar(ctx, x, y, w, h, pct, color = ACCENT) {
  // track
  ctx.fillStyle = BAR_TRACK;
  drawRoundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  // fill
  const fillW = Math.max(h, Math.floor(w * Math.min(1, Math.max(0, pct))));
  ctx.fillStyle = color;
  drawRoundRect(ctx, x, y, fillW, h, h / 2);
  ctx.fill();
}

async function buildCard(user, profile, wallet, collection, achievements) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // ── background ─────────────────────────────────────────────────────────
  ctx.fillStyle = BG;
  drawRoundRect(ctx, 0, 0, W, H, 16);
  ctx.fill();

  // left panel tint
  ctx.fillStyle = BG2;
  drawRoundRect(ctx, 12, 12, 180, H - 24, 12);
  ctx.fill();

  // ── avatar ─────────────────────────────────────────────────────────────
  const avatarUrl = user.displayAvatarURL({ size: 128, extension: "png" });
  let avatarImg = null;
  try {
    avatarImg = await loadImage(avatarUrl);
  } catch {
    // skip avatar on failure
  }

  const avX = 102, avY = 50, avR = 48;
  if (avatarImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(avX, avY, avR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatarImg, avX - avR, avY - avR, avR * 2, avR * 2);
    ctx.restore();
  }

  // avatar ring
  ctx.beginPath();
  ctx.arc(avX, avY, avR + 3, 0, Math.PI * 2);
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 3;
  ctx.stroke();

  // username
  ctx.fillStyle = TEXT;
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(user.username, avX, avY + avR + 18, 160);

  // discriminator / tag
  ctx.fillStyle = MUTED;
  ctx.font = "12px sans-serif";
  ctx.fillText(`#${user.discriminator !== "0" ? user.discriminator : "0000"}`, avX, avY + avR + 34, 160);

  // ── level & xp ────────────────────────────────────────────────────────
  const prog = progressToNextLevel(profile.xp);
  const level = prog.level;
  const pct = prog.pct;
  const xpNeeded = Math.max(0, Math.trunc(prog.next - profile.xp));

  ctx.fillStyle = MUTED;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("LEVEL", avX, avY + avR + 58);

  ctx.fillStyle = TEXT;
  ctx.font = "bold 26px sans-serif";
  ctx.fillText(String(level), avX, avY + avR + 80);

  drawProgressBar(ctx, 22, H - 54, 156, 10, pct, ACCENT);
  ctx.fillStyle = MUTED;
  ctx.font = "10px sans-serif";
  ctx.fillText(`${profile.xp.toLocaleString()} XP  (${Math.round(pct * 100)}%)`, avX, H - 34);
  ctx.fillText(`next: ${xpNeeded.toLocaleString()} XP`, avX, H - 20);

  // ── right content area ────────────────────────────────────────────────
  const RX = 208; // right area start x
  const RW = W - RX - 16;

  // ── economy row ────────────────────────────────────────────────────────
  ctx.fillStyle = MUTED;
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("ECONOMY", RX, 36);

  // wallet & bank boxes
  const boxH = 46, boxW = (RW - 8) / 2;
  [[wallet.balance, "💰 Wallet"], [wallet.bank, "🏦 Bank"]].forEach(([val, label], i) => {
    const bx = RX + i * (boxW + 8);
    ctx.fillStyle = BG2;
    drawRoundRect(ctx, bx, 44, boxW, boxH, 8);
    ctx.fill();
    ctx.fillStyle = MUTED;
    ctx.font = "11px sans-serif";
    ctx.fillText(label, bx + 10, 60);
    ctx.fillStyle = TEXT;
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(Number(val).toLocaleString(), bx + 10, 78);
  });

  // ── rarity breakdown ────────────────────────────────────────────────────
  const rarityY = 112;
  ctx.fillStyle = MUTED;
  ctx.font = "bold 11px sans-serif";
  ctx.fillText("COLLECTION RARITIES", RX, rarityY);

  const rarities = [
    { label: "✨ Mythic",    count: Number(collection.mythic_count    || 0), color: "#ff73fa" },
    { label: "💎 Legendary", count: Number(collection.legendary_count || 0), color: "#ffd700" },
    { label: "🔮 Epic",      count: Number(collection.epic_count      || 0), color: "#a855f7" },
    { label: "💠 Rare",      count: Number(collection.rare_count      || 0), color: "#3b82f6" },
    { label: "⚪ Common",    count: Number(collection.common_count    || 0), color: "#6b7280" },
  ];
  const totalCaught = rarities.reduce((s, r) => s + r.count, 0) || 1;
  const rarCols = 2;
  const rarCellW = Math.floor(RW / rarCols);

  rarities.forEach((r, i) => {
    const col = i % rarCols;
    const row = Math.floor(i / rarCols);
    const rx2 = RX + col * rarCellW;
    const ry = rarityY + 12 + row * 32;
    ctx.fillStyle = MUTED;
    ctx.font = "11px sans-serif";
    ctx.fillText(`${r.label}: ${r.count}`, rx2, ry + 12);
    drawProgressBar(ctx, rx2, ry + 14, rarCellW - 8, 6, r.count / totalCaught, r.color);
  });

  // ── achievements ────────────────────────────────────────────────────────
  const achY = 232;
  ctx.fillStyle = MUTED;
  ctx.font = "bold 11px sans-serif";
  ctx.fillText(`ACHIEVEMENTS (${achievements.length})`, RX, achY);

  if (achievements.length === 0) {
    ctx.fillStyle = MUTED;
    ctx.font = "12px sans-serif";
    ctx.fillText("None unlocked yet", RX, achY + 18);
  } else {
    const shown = achievements.slice(0, 10);
    const emojiStr = shown.map(a => a.emoji || "🏅").join("  ");
    ctx.fillStyle = TEXT;
    ctx.font = "18px sans-serif";
    ctx.fillText(emojiStr, RX, achY + 22, RW);
    if (achievements.length > 10) {
      ctx.fillStyle = MUTED;
      ctx.font = "11px sans-serif";
      ctx.fillText(`+${achievements.length - 10} more`, RX, achY + 40);
    }
  }

  // ── footer bar ────────────────────────────────────────────────────────
  ctx.fillStyle = ACCENT;
  drawRoundRect(ctx, RX, H - 30, RW, 18, 4);
  ctx.fill();
  ctx.fillStyle = TEXT;
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("🥢 Chopsticks", RX + RW / 2, H - 17);

  return canvas.toBuffer("image/png");
}

// ── command ──────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  const targetUser = interaction.options.getUser("user") ?? interaction.user;
  await interaction.deferReply();

  await withTimeout(interaction, async () => {
    try {
      const [profile, wallet, collection, achievements] = await Promise.all([
        getGameProfile(targetUser.id),
        getWallet(targetUser.id),
        getCollectionStats(targetUser.id),
        interaction.guildId
          ? getUserAchievements(targetUser.id, interaction.guildId).catch(() => [])
          : Promise.resolve([]),
      ]);

      let buffer = null;
      try {
        buffer = await buildCard(targetUser, profile, wallet, collection, achievements);
      } catch (canvasErr) {
        botLogger.warn({ err: canvasErr }, "[profilecard] canvas render failed");
      }

      if (!buffer) {
        return interaction.editReply({ content: "⚠️ Could not render profile card right now." });
      }

      const attachment = new AttachmentBuilder(buffer, { name: "profilecard.png" });
      const prog = progressToNextLevel(profile.xp);
      const embed = new EmbedBuilder()
        .setColor(Colors.PRIMARY)
        .setTitle(`${targetUser.username}'s Profile Card`)
        .setImage("attachment://profilecard.png")
        .addFields(
          { name: "Level", value: `**${prog.level}**`, inline: true },
          { name: "XP", value: `${profile.xp.toLocaleString()}`, inline: true },
          { name: "Wallet", value: `${wallet.balance.toLocaleString()} cr`, inline: true },
        )
        .setFooter({ text: "Use /profile for full stats • /profilecard for the image" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (err) {
      botLogger.error({ err }, "[profilecard] error");
      await interaction.editReply({ content: "❌ Failed to generate profile card.", flags: MessageFlags.Ephemeral });
    }
  }, { label: "profilecard" });
}
