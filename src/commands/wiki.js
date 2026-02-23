import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { httpRequest } from "../utils/httpFetch.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = { category: "fun", guildOnly: false };

export const data = new SlashCommandBuilder()
  .setName("wiki")
  .setDescription("Search Wikipedia and get a summary")
  .addStringOption(o =>
    o.setName("query").setDescription("What to search for").setRequired(true)
  );

export async function execute(interaction) {
  await interaction.deferReply();
  await withTimeout(interaction, async () => {
    const query = interaction.options.getString("query", true).trim();

    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
      const { statusCode, body } = await httpRequest("wikipedia", url, {
        headers: { "User-Agent": "Chopsticks-Discord-Bot/1.0" }
      });

      if (statusCode === 404) {
        return interaction.editReply({ content: `❌ No Wikipedia article found for **${query}**.` });
      }
      if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);

      const data = await body.json();
      const description = data.extract?.slice(0, 500) ?? "No summary available.";
      const embed = new EmbedBuilder()
        .setTitle(data.displaytitle ?? data.title)
        .setURL(data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`)
        .setDescription(description + (data.extract?.length > 500 ? "…" : ""))
        .setColor(0xffffff)
        .setThumbnail(data.thumbnail?.source ?? null)
        .setFooter({ text: "Wikipedia" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      botLogger.warn({ err }, "[wiki] fetch failed");
      await interaction.editReply({ content: "❌ Couldn't fetch Wikipedia data right now. Try again later." });
    }
  }, { label: "wiki" });
}
