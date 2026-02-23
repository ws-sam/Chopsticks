import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { httpRequest } from "../utils/httpFetch.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = { category: "fun", guildOnly: false };

export const data = new SlashCommandBuilder()
  .setName("apod")
  .setDescription("NASA Astronomy Picture of the Day (requires NASA_API_KEY or uses DEMO_KEY)")
  .addStringOption(o =>
    o.setName("date")
      .setDescription("Specific date (YYYY-MM-DD). Defaults to today.")
  );

export async function execute(interaction) {
  await interaction.deferReply();
  await withTimeout(interaction, async () => {
    const apiKey = process.env.NASA_API_KEY || "DEMO_KEY";
    const date = interaction.options.getString("date") ?? "";

    const params = new URLSearchParams({ api_key: apiKey });
    if (date) params.set("date", date);

    try {
      const { statusCode, body } = await httpRequest("apod", `https://api.nasa.gov/planetary/apod?${params}`, {
        headers: { "User-Agent": "Chopsticks-Discord-Bot/1.0" }
      });
      if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);

      const data = await body.json();
      if (data.error) throw new Error(data.error.message ?? "API error");

      const description = data.explanation?.slice(0, 600) ?? "No description.";
      const embed = new EmbedBuilder()
        .setTitle(`🌌 ${data.title}`)
        .setDescription(description + (data.explanation?.length > 600 ? "…" : ""))
        .setColor(0x0d1b2a)
        .setFooter({ text: `NASA APOD · ${data.date}${data.copyright ? ` · © ${data.copyright}` : ""}` })
        .setTimestamp();

      if (data.media_type === "image") {
        embed.setImage(data.url);
      } else {
        embed.addFields({ name: "Video", value: data.url });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      botLogger.warn({ err }, "[apod] fetch failed");
      await interaction.editReply({ content: "❌ Couldn't fetch APOD right now. Try again later." });
    }
  }, { label: "apod" });
}
