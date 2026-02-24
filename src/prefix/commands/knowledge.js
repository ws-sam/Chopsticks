// src/prefix/commands/knowledge.js
// Cycle P8 — Knowledge & Utility Pack (all free/no-key APIs)

import { EmbedBuilder } from "discord.js";
import { httpFetch } from "../../utils/httpFetch.js";
import COLORS from "../../utils/colors.js";

const USER_AGENT = "Chopsticks-Discord-Bot/2.0";

async function fetchJson(service, url) {
  const res = await httpFetch(service, url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(service, url) {
  const res = await httpFetch(service, url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export default [
  {
    name: "define",
    aliases: ["def", "dictionary", "word"],
    description: "Dictionary definition — !define <word>",
    rateLimit: 4000,
    async execute(message, args) {
      const word = args[0]?.trim();
      if (!word) return message.reply("Usage: `!define <word>` — e.g. `!define serendipity`");
      try {
        const d = await fetchJson("dictionaryapi", `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
        const entry = d[0];
        const phonetic = entry.phonetics?.find(p => p.text)?.text || "";
        const meanings = entry.meanings?.slice(0, 2) || [];
        const embed = new EmbedBuilder()
          .setTitle(`📖 ${entry.word}${phonetic ? `  *${phonetic}*` : ""}`)
          .setColor(COLORS.INFO);
        for (const m of meanings) {
          const defs = m.definitions.slice(0, 2).map((d, i) => {
            let line = `${i + 1}. ${d.definition}`;
            if (d.example) line += `\n*"${d.example}"*`;
            return line;
          }).join("\n\n");
          embed.addFields({ name: m.partOfSpeech, value: defs.slice(0, 1020) });
        }
        embed.setFooter({ text: "dictionaryapi.dev • Chopsticks !define" });
        await message.reply({ embeds: [embed] });
      } catch {
        await message.reply(`❌ No definition found for \`${word}\`. Check spelling!`);
      }
    }
  },

  {
    name: "advice",
    aliases: ["tip", "wisdom"],
    description: "Random advice — !advice",
    rateLimit: 3000,
    async execute(message) {
      try {
        const d = await fetchJson("adviceslip", "https://api.adviceslip.com/advice");
        const embed = new EmbedBuilder()
          .setTitle("💡 Advice")
          .setDescription(`*"${d.slip.advice}"*`)
          .setColor(COLORS.ECONOMY)
          .setFooter({ text: "adviceslip.com • Chopsticks !advice" });
        await message.reply({ embeds: [embed] });
      } catch {
        await message.reply("❌ No advice available right now. Trust your gut!");
      }
    }
  },

  {
    name: "number",
    aliases: ["numfact", "nfact"],
    description: "Interesting fact about a number — !number <n>",
    rateLimit: 3000,
    async execute(message, args) {
      const n = parseInt(args[0] || "") || Math.floor(Math.random() * 1000);
      try {
        const text = await fetchText("numbersapi", `http://numbersapi.com/${n}/trivia`);
        const embed = new EmbedBuilder()
          .setTitle(`🔢 Number ${n}`)
          .setDescription(text)
          .setColor(COLORS.INFO)
          .setFooter({ text: "numbersapi.com • Chopsticks !number" });
        await message.reply({ embeds: [embed] });
      } catch {
        await message.reply("❌ Couldn't fetch a number fact right now.");
      }
    }
  },

  {
    name: "country",
    aliases: ["nation", "flag"],
    description: "Country info — !country <name>",
    rateLimit: 4000,
    async execute(message, args) {
      const query = args.join(" ").trim();
      if (!query) return message.reply("Usage: `!country <name>` — e.g. `!country Japan`");
      try {
        const d = await fetchJson("restcountries", `https://restcountries.com/v3.1/name/${encodeURIComponent(query)}?fields=name,capital,population,region,subregion,flags,currencies,languages`);
        const c = d[0];
        const flag = c.flags?.png || c.flags?.svg || "";
        const capital = c.capital?.[0] || "N/A";
        const currencies = Object.values(c.currencies || {}).map(cu => cu.name).join(", ") || "N/A";
        const langs = Object.values(c.languages || {}).join(", ") || "N/A";
        const pop = c.population?.toLocaleString() || "N/A";
        const embed = new EmbedBuilder()
          .setTitle(`${c.name.common} — ${c.name.official}`)
          .setColor(COLORS.SUCCESS)
          .addFields(
            { name: "Capital", value: capital, inline: true },
            { name: "Region", value: `${c.region} / ${c.subregion || "N/A"}`, inline: true },
            { name: "Population", value: pop, inline: true },
            { name: "Currency", value: currencies, inline: true },
            { name: "Languages", value: langs, inline: true },
          )
          .setFooter({ text: "restcountries.com • Chopsticks !country" });
        if (flag) embed.setThumbnail(flag);
        await message.reply({ embeds: [embed] });
      } catch {
        await message.reply(`❌ Country \`${query}\` not found. Try the full name!`);
      }
    }
  },

  {
    name: "iss",
    aliases: ["space", "station"],
    description: "ISS current location — !iss",
    rateLimit: 5000,
    async execute(message) {
      try {
        const d = await fetchJson("openNotify", "http://api.open-notify.org/iss-now.json");
        const { latitude, longitude } = d.iss_position;
        const embed = new EmbedBuilder()
          .setTitle("🛸 ISS Current Location")
          .setDescription(`The International Space Station is currently over:\n**Lat:** ${parseFloat(latitude).toFixed(4)}° | **Lon:** ${parseFloat(longitude).toFixed(4)}°`)
          .setColor(COLORS.INFO)
          .setURL(`https://www.google.com/maps?q=${latitude},${longitude}`)
          .addFields(
            { name: "Altitude", value: "~408 km above Earth", inline: true },
            { name: "Speed", value: "~27,600 km/h (7.7 km/s)", inline: true },
          )
          .setFooter({ text: "open-notify.org • Chopsticks !iss" });
        await message.reply({ embeds: [embed] });
      } catch {
        await message.reply("❌ Couldn't fetch ISS location right now.");
      }
    }
  },

  {
    name: "spacex",
    aliases: ["launch", "rocket"],
    description: "Latest SpaceX launch info — !spacex",
    rateLimit: 10000,
    async execute(message) {
      try {
        const d = await fetchJson("spacexdata", "https://api.spacexdata.com/v4/launches/latest");
        const date = d.date_utc ? new Date(d.date_utc).toUTCString() : "Unknown";
        const embed = new EmbedBuilder()
          .setTitle(`🚀 SpaceX — ${d.name}`)
          .setColor(d.success ? 0x57F287 : 0xED4245)
          .addFields(
            { name: "Date", value: date, inline: true },
            { name: "Flight #", value: String(d.flight_number), inline: true },
            { name: "Success", value: d.success ? "✅ Yes" : d.success === false ? "❌ No" : "TBD", inline: true },
            { name: "Details", value: d.details?.slice(0, 500) || "No details available." },
          );
        if (d.links?.patch?.small) embed.setThumbnail(d.links.patch.small);
        if (d.links?.webcast) embed.setURL(d.links.webcast);
        embed.setFooter({ text: "spacexdata.com • Chopsticks !spacex" });
        await message.reply({ embeds: [embed] });
      } catch {
        await message.reply("❌ Couldn't fetch SpaceX launch data right now.");
      }
    }
  },

  {
    name: "bible",
    aliases: ["verse", "scripture"],
    description: "Bible verse lookup — !bible <book chapter:verse>",
    rateLimit: 4000,
    async execute(message, args) {
      const query = args.join(" ").trim();
      if (!query) return message.reply("Usage: `!bible <book chapter:verse>` — e.g. `!bible John 3:16`");
      try {
        const d = await fetchJson("bibleApi", `https://bible-api.com/${encodeURIComponent(query)}`);
        if (d.error) return message.reply(`❌ ${d.error}`);
        const embed = new EmbedBuilder()
          .setTitle(`📖 ${d.reference}`)
          .setDescription(d.text?.trim().slice(0, 2000) || "No text found.")
          .setColor(COLORS.ECONOMY)
          .setFooter({ text: `${d.translation_name || "WEB"} • Chopsticks !bible` });
        await message.reply({ embeds: [embed] });
      } catch {
        await message.reply("❌ Couldn't fetch that verse. Check the reference format: `!bible John 3:16`");
      }
    }
  },

  {
    name: "qr",
    aliases: ["qrcode"],
    description: "Generate a QR code — !qr <url or text>",
    rateLimit: 5000,
    async execute(message, args) {
      const text = args.join(" ").trim();
      if (!text) return message.reply("Usage: `!qr <url or text>` — e.g. `!qr https://discord.com`");
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(text)}`;
      const embed = new EmbedBuilder()
        .setTitle("📱 QR Code")
        .setDescription(`\`${text.slice(0, 100)}\``)
        .setImage(url)
        .setColor(COLORS.INFO)
        .setFooter({ text: "qrserver.com • Chopsticks !qr" });
      await message.reply({ embeds: [embed] });
    }
  },

  {
    name: "shorten",
    aliases: ["short", "url"],
    description: "Shorten a URL — !shorten <url>",
    rateLimit: 5000,
    async execute(message, args) {
      const url = args[0]?.trim();
      if (!url || !url.startsWith("http")) return message.reply("Usage: `!shorten <url>` — e.g. `!shorten https://example.com/long-path`");
      try {
        const d = await fetchJson("isGd", `https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`);
        if (!d.shorturl) throw new Error("no url");
        const embed = new EmbedBuilder()
          .setTitle("🔗 Shortened URL")
          .setDescription(`[${d.shorturl}](${d.shorturl})`)
          .setColor(COLORS.INFO)
          .addFields({ name: "Original", value: url.slice(0, 200) })
          .setFooter({ text: "is.gd • Chopsticks !shorten" });
        await message.reply({ embeds: [embed] });
      } catch {
        await message.reply("❌ Couldn't shorten that URL. Make sure it's a valid HTTP/HTTPS URL.");
      }
    }
  },
];
