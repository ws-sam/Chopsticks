import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { httpRequest } from "../utils/httpFetch.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = { category: "fun", guildOnly: false };

export const data = new SlashCommandBuilder()
  .setName("urban")
  .setDescription("Look up a word or phrase on Urban Dictionary")
  .addStringOption(o =>
    o.setName("term").setDescription("Term to look up").setRequired(true)
  );

export async function execute(interaction) {
  await interaction.deferReply();
  await withTimeout(interaction, async () => {
    const term = interaction.options.getString("term", true).trim();

    try {
      const url = `https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`;
      const { statusCode, body } = await httpRequest("urbandictionary", url, {
        headers: { "User-Agent": "Chopsticks-Discord-Bot/1.0" }
      });
      if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);

      const data = await body.json();
      const result = data.list?.[0];

      if (!result) {
        return interaction.editReply({ content: `❌ No Urban Dictionary definition found for **${term}**.` });
      }

      // Truncate definition and example
      const def = result.definition.replace(/\[([^\]]+)\]/g, "$1").slice(0, 800);
      const ex = result.example?.replace(/\[([^\]]+)\]/g, "$1").slice(0, 300) ?? "";

      const embed = new EmbedBuilder()
        .setTitle(`📖 ${result.word}`)
        .setURL(result.permalink)
        .setDescription(def + (result.definition.length > 800 ? "…" : ""))
        .setColor(0x1d2951)
        .setFooter({ text: `👍 ${result.thumbs_up}  👎 ${result.thumbs_down} · Urban Dictionary` })
        .setTimestamp();

      if (ex) embed.addFields({ name: "Example", value: ex + (result.example?.length > 300 ? "…" : "") });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      botLogger.warn({ err }, "[urban] fetch failed");
      await interaction.editReply({ content: "❌ Couldn't fetch Urban Dictionary data right now." });
    }
  }, { label: "urban" });
}
