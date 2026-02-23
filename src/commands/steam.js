import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { request } from "undici";
import { botLogger } from "../utils/modernLogger.js";

export const meta = {
  category: "info",
  guildOnly: false,
};

export const data = new SlashCommandBuilder()
  .setName("steam")
  .setDescription("Look up a Steam community profile")
  .addStringOption(opt =>
    opt.setName("profile")
      .setDescription("Steam vanity URL (e.g. 'gaben') or full profile URL")
      .setRequired(true)
      .setMaxLength(100)
  );

/** Extract the identifiable part from a steam URL or plain vanity/id */
function resolveIdentifier(input) {
  const clean = input.trim().replace(/\/$/, "");
  // https://steamcommunity.com/id/<vanity>  or  /profiles/<steamid>
  const m = clean.match(/steamcommunity\.com\/(id|profiles)\/([^/?#]+)/i);
  if (m) return { type: m[1] === "profiles" ? "profiles" : "id", value: m[2] };
  // Plain numeric = 64-bit SteamID
  if (/^\d{17,}$/.test(clean)) return { type: "profiles", value: clean };
  return { type: "id", value: clean };
}

function xmlText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"))
    || xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

const STATE_MAP = { 0: "Offline", 1: "Online", 2: "Busy", 3: "Away", 4: "Snooze", 5: "Looking to Trade", 6: "Looking to Play" };
const COLORS = { 0: 0x7289da, 1: 0x57f287, 2: 0xed4245, 3: 0xfee75c };

export async function execute(interaction) {
  await interaction.deferReply();

  const input = interaction.options.getString("profile", true);
  const { type, value } = resolveIdentifier(input);
  const url = `https://steamcommunity.com/${type}/${encodeURIComponent(value)}?xml=1`;

  let xml = "";
  try {
    const { statusCode, body } = await request(url, {
      headers: { "User-Agent": "Chopsticks-Discord-Bot/1.0" },
      bodyTimeout: 8000,
      headersTimeout: 8000,
    });
    if (statusCode !== 200) {
      return interaction.editReply({ content: "❌ Steam profile not found or unavailable." });
    }
    xml = await body.text();
  } catch (err) {
    botLogger.warn({ err }, "[steam] fetch failed");
    return interaction.editReply({ content: "❌ Could not reach Steam. Try again later." });
  }

  if (xml.includes("<error>")) {
    return interaction.editReply({ content: "❌ Steam profile not found. Check the vanity URL." });
  }

  const name = xmlText(xml, "steamID");
  const realName = xmlText(xml, "realname");
  const stateCode = parseInt(xmlText(xml, "onlineState") || "0", 10) || 0;
  const stateName = STATE_MAP[stateCode] ?? "Offline";
  const avatar = xmlText(xml, "avatarFull");
  const location = xmlText(xml, "location");
  const summary = xmlText(xml, "summary");
  const memberSince = xmlText(xml, "memberSince");
  const steamId64 = xmlText(xml, "steamID64");
  const profileUrl = xmlText(xml, "customURL")
    ? `https://steamcommunity.com/id/${xmlText(xml, "customURL")}`
    : `https://steamcommunity.com/profiles/${steamId64}`;

  const color = stateCode === 1 ? COLORS[1] : stateCode >= 2 && stateCode <= 4 ? COLORS[3] : COLORS[0];

  const embed = new EmbedBuilder()
    .setTitle(`🎮 ${name || "Steam Profile"}`)
    .setURL(profileUrl)
    .setColor(color)
    .setThumbnail(avatar || null);

  if (realName) embed.addFields({ name: "Real Name", value: realName, inline: true });
  embed.addFields({ name: "Status", value: stateName, inline: true });
  if (location) embed.addFields({ name: "Location", value: location, inline: true });
  if (memberSince) embed.addFields({ name: "Member Since", value: memberSince, inline: true });
  if (steamId64) embed.addFields({ name: "Steam ID", value: `\`${steamId64}\``, inline: true });
  if (summary && summary.length > 0) {
    embed.setDescription(summary.replace(/<[^>]+>/g, "").slice(0, 300) + (summary.length > 300 ? "…" : ""));
  }

  embed.setFooter({ text: "Data from Steam Community" }).setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
