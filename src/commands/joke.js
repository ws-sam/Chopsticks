import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { httpRequest } from "../utils/httpFetch.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = { category: "fun", guildOnly: false };

export const data = new SlashCommandBuilder()
  .setName("joke")
  .setDescription("Get a random joke")
  .addStringOption(o =>
    o.setName("category")
      .setDescription("Joke category")
      .addChoices(
        { name: "Any", value: "Any" },
        { name: "Programming", value: "Programming" },
        { name: "Misc", value: "Misc" },
        { name: "Dark", value: "Dark" },
        { name: "Pun", value: "Pun" },
        { name: "Spooky", value: "Spooky" },
        { name: "Christmas", value: "Christmas" }
      )
  );

export async function execute(interaction) {
  await interaction.deferReply();
  await withTimeout(interaction, async () => {
    const category = interaction.options.getString("category") ?? "Any";

    try {
      const url = `https://v2.jokeapi.dev/joke/${category}?blacklistFlags=racist,sexist&format=json`;
      const { statusCode, body } = await httpRequest("jokeapi", url, {
        headers: { "User-Agent": "Chopsticks-Discord-Bot/1.0" }
      });
      if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);

      const data = await body.json();
      if (data.error) throw new Error(data.message ?? "API error");

      let text;
      if (data.type === "twopart") {
        text = `${data.setup}\n\n||${data.delivery}||`;
      } else {
        text = data.joke;
      }

      const embed = new EmbedBuilder()
        .setTitle("😂 Joke")
        .setDescription(text)
        .setColor(0xfee75c)
        .setFooter({ text: `${data.category} · JokeAPI v2` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      botLogger.warn({ err }, "[joke] fetch failed");
      await interaction.editReply({ content: "❌ Couldn't fetch a joke right now. Try again later." });
    }
  }, { label: "joke" });
}
