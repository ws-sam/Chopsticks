// src/prefix/commands/animals.js
// Cycle P6 — Animal image pack + anime reaction GIFs (all free, no-key APIs)

import { EmbedBuilder } from "discord.js";
import { httpFetch } from "../../utils/httpFetch.js";
import COLORS from "../../utils/colors.js";

const USER_AGENT = "Chopsticks-Discord-Bot/2.0";
const RATE_MS = 3000;
const userCooldowns = new Map(); // userId → timestamp

function checkCool(userId) {
  const last = userCooldowns.get(userId) || 0;
  if (Date.now() - last < RATE_MS) return Math.ceil((RATE_MS - (Date.now() - last)) / 1000);
  userCooldowns.set(userId, Date.now());
  return 0;
}

async function fetchJson(service, url) {
  const res = await httpFetch(service, url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Animal endpoints ──────────────────────────────────────────────────────────

async function getCat()      { const d = await fetchJson("thecatapi", "https://api.thecatapi.com/v1/images/search"); return { url: d[0]?.url, source: "thecatapi.com" }; }
async function getDog()      { const d = await fetchJson("dogceo", "https://dog.ceo/api/breeds/image/random"); return { url: d.message, source: "dog.ceo" }; }
async function getFox()      { const d = await fetchJson("randomfox", "https://randomfox.ca/floof/"); return { url: d.image, source: "randomfox.ca" }; }
async function getDuck()     { const d = await fetchJson("randomduck", "https://random-d.uk/api/random"); return { url: d.url, source: "random-d.uk" }; }
async function getShibe()    { const d = await fetchJson("shibeOnline", "http://shibe.online/api/shibes?count=1"); return { url: d[0], source: "shibe.online" }; }
async function getBird()     { const d = await fetchJson("shibeOnline", "http://shibe.online/api/birds?count=1"); return { url: d[0], source: "shibe.online" }; }

// nekos.best — anime reaction GIFs
async function getNekos(type) {
  const d = await fetchJson("nekosBest", `https://nekos.best/api/v2/${type}`);
  return { url: d.results?.[0]?.url, anime_name: d.results?.[0]?.anime_name, source: "nekos.best" };
}

function animalEmbed(title, imageUrl, source) {
  return new EmbedBuilder()
    .setTitle(title)
    .setImage(imageUrl)
    .setColor(COLORS.SUCCESS)
    .setFooter({ text: `via ${source} • Chopsticks` });
}

function reactionEmbed(title, desc, imageUrl, source) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setImage(imageUrl)
    .setColor(COLORS.FUN)
    .setFooter({ text: `via ${source} • Chopsticks` });
}

function makeAnimalCmd(name, aliases, title, fetcher) {
  return {
    name,
    aliases,
    description: `${title} — !${name}`,
    rateLimit: RATE_MS,
    async execute(message) {
      const wait = checkCool(message.author.id);
      if (wait) return message.reply(`⏳ Wait **${wait}s** before requesting another animal image.`);
      try {
        const { url, source } = await fetcher();
        if (!url) throw new Error("no url");
        await message.reply({ embeds: [animalEmbed(title, url, source)] });
      } catch {
        await message.reply("❌ Couldn't fetch an image right now. Try again in a moment!");
      }
    }
  };
}

function makeReactionCmd(name, aliases, endpoint, title) {
  return {
    name,
    aliases,
    description: `${title} — !${name} [@user]`,
    rateLimit: RATE_MS,
    async execute(message) {
      const wait = checkCool(message.author.id);
      if (wait) return message.reply(`⏳ Wait **${wait}s** before using another reaction.`);
      const target = message.mentions.users.first();
      const desc = target
        ? `**${message.author.username}** ${name}s **${target.username}**! 💞`
        : `**${message.author.username}** ${name}s! 💞`;
      try {
        const { url, anime_name, source } = await getNekos(endpoint);
        if (!url) throw new Error("no url");
        const embed = reactionEmbed(title, desc, url, source);
        if (anime_name) embed.addFields({ name: "Anime", value: anime_name, inline: true });
        await message.reply({ embeds: [embed] });
      } catch {
        await message.reply(`${desc} *(image unavailable right now)*`);
      }
    }
  };
}

export default [
  // Animals
  makeAnimalCmd("cat",      ["kitty", "meow"],       "🐱 Random Cat",        getCat),
  makeAnimalCmd("dog",      ["doggo", "woof"],        "🐶 Random Dog",        getDog),
  makeAnimalCmd("fox",      ["foxo"],                 "🦊 Random Fox",        getFox),
  makeAnimalCmd("duck",     ["quack"],                "🦆 Random Duck",       getDuck),
  makeAnimalCmd("shibe",    ["shiba", "doge"],        "🐕 Random Shibe",      getShibe),
  makeAnimalCmd("bird",     ["birb", "tweet"],        "🐦 Random Bird",       getBird),

  // Anime reactions (nekos.best)
  makeReactionCmd("hug",    ["squeeze"],  "hug",    "🤗 Hug!"),
  makeReactionCmd("pat",    ["headpat"],  "pat",    "👋 Pat!"),
  makeReactionCmd("slap",   ["smack"],    "slap",   "👋 Slap!"),
  makeReactionCmd("kiss",   ["smooch"],   "kiss",   "💋 Kiss!"),
  makeReactionCmd("cuddle", ["snuggle"],  "cuddle", "🫂 Cuddle!"),
  makeReactionCmd("wave",   ["hi", "hey"],"wave",   "👋 Wave!"),
  makeReactionCmd("poke",   ["nudge"],    "poke",   "👉 Poke!"),
  makeReactionCmd("bite",   ["nibble"],   "bite",   "😬 Bite!"),
];
