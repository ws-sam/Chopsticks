import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { httpRequest } from "../utils/httpFetch.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = { category: "util", guildOnly: false };

export const data = new SlashCommandBuilder()
  .setName("book")
  .setDescription("Search books via Open Library (free, no API key needed)")
  .addStringOption(o =>
    o.setName("query").setDescription("Book title, author, or ISBN").setRequired(true)
  );

export async function execute(interaction) {
  await interaction.deferReply();
  await withTimeout(interaction, async () => {
    const query = interaction.options.getString("query", true).trim();

    try {
      const searchUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=1&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i,subject,language`;
      const { statusCode, body } = await httpRequest("openlibrary", searchUrl, {
        headers: { "User-Agent": "Chopsticks-Discord-Bot/1.0" }
      });
      if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);

      const data = await body.json();
      const book = data.docs?.[0];

      if (!book) {
        return interaction.editReply({ content: `❌ No books found for **${query}**.` });
      }

      const authors = book.author_name?.slice(0, 3).join(", ") ?? "Unknown";
      const coverUrl = book.cover_i
        ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg`
        : null;
      const subjects = book.subject?.slice(0, 5).join(", ") ?? "N/A";
      const workUrl = book.key ? `https://openlibrary.org${book.key}` : null;

      const embed = new EmbedBuilder()
        .setTitle(book.title)
        .setColor(0x8b5cf6)
        .addFields(
          { name: "✍️ Author(s)", value: authors, inline: true },
          { name: "📅 First Published", value: String(book.first_publish_year ?? "Unknown"), inline: true },
          { name: "📄 Pages", value: String(book.number_of_pages_median ?? "N/A"), inline: true },
          { name: "🏷️ Subjects", value: subjects, inline: false }
        )
        .setFooter({ text: "Powered by Open Library · openlibrary.org" })
        .setTimestamp();

      if (coverUrl) embed.setThumbnail(coverUrl);
      if (workUrl) embed.setURL(workUrl);

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      botLogger.warn({ err }, "[book] fetch failed");
      await interaction.editReply({ content: "❌ Couldn't fetch book data right now. Try again later." });
    }
  }, { label: "book" });
}
