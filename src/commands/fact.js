import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { httpRequest } from "../utils/httpFetch.js";
import { botLogger } from "../utils/modernLogger.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  category: "fun",
  guildOnly: false,
};

export const data = new SlashCommandBuilder()
  .setName("fact")
  .setDescription("Get a random interesting fact");

export async function execute(interaction) {
  await interaction.deferReply();
  await withTimeout(interaction, async () => {
    let fact = "Did you know? The world is full of fascinating facts — try again in a moment!";

    try {
      const { statusCode, body } = await httpRequest("uselessfacts", "https://uselessfacts.jsph.pl/api/v2/facts/random?language=en", {
        headers: {
          "User-Agent": "Chopsticks-Discord-Bot/1.0",
          "Accept": "application/json"
        }
      });
      if (statusCode === 200) {
        const data = await body.json();
        if (data?.text) fact = data.text;
      }
    } catch (err) {
      botLogger.warn({ err }, "[fact] uselessfacts fetch failed — using fallback");
    }

    const embed = new EmbedBuilder()
      .setTitle("🔬 Did You Know?")
      .setDescription(fact)
      .setColor(0xf0b232)
      .setFooter({ text: "Powered by uselessfacts.jsph.pl" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }, { label: "fact" });
}
