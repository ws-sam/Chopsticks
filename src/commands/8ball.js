import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { Colors } from "../utils/discordOutput.js";
import { sanitizeString } from "../utils/validation.js";

const ANSWERS = {
  positive: [
    "🟢 It is certain.",
    "🟢 It is decidedly so.",
    "🟢 Without a doubt.",
    "🟢 Yes, definitely.",
    "🟢 You may rely on it.",
    "🟢 As I see it, yes.",
    "🟢 Most likely.",
    "🟢 Outlook good.",
    "🟢 Yes.",
    "🟢 Signs point to yes.",
  ],
  neutral: [
    "🟡 Reply hazy, try again.",
    "🟡 Ask again later.",
    "🟡 Better not tell you now.",
    "🟡 Cannot predict now.",
    "🟡 Concentrate and ask again.",
  ],
  negative: [
    "🔴 Don't count on it.",
    "🔴 My reply is no.",
    "🔴 My sources say no.",
    "🔴 Outlook not so good.",
    "🔴 Very doubtful.",
  ],
};

const ALL_ANSWERS = [...ANSWERS.positive, ...ANSWERS.neutral, ...ANSWERS.negative];
const COLOR_MAP = { positive: Colors.Green, neutral: Colors.Yellow, negative: Colors.Red };

function pickAnswer() {
  const r = Math.random();
  if (r < 0.5) return { text: ANSWERS.positive[Math.floor(Math.random() * ANSWERS.positive.length)], type: "positive" };
  if (r < 0.75) return { text: ANSWERS.neutral[Math.floor(Math.random() * ANSWERS.neutral.length)], type: "neutral" };
  return { text: ANSWERS.negative[Math.floor(Math.random() * ANSWERS.negative.length)], type: "negative" };
}

export const meta = {
  category: "fun",
  guildOnly: false,
};

export const data = new SlashCommandBuilder()
  .setName("8ball")
  .setDescription("🎱 Ask the magic 8-ball a yes/no question")
  .addStringOption(o => o
    .setName("question")
    .setDescription("Your yes/no question")
    .setRequired(true)
    .setMaxLength(200));

export async function execute(interaction) {
  const question = sanitizeString(interaction.options.getString("question", true));
  const { text, type } = pickAnswer();

  const embed = new EmbedBuilder()
    .setTitle("🎱 Magic 8-Ball")
    .setDescription(`**Q:** ${question}\n\n${text}`)
    .setColor(COLOR_MAP[type])
    .setFooter({ text: "The 8-ball has spoken." });

  await interaction.reply({ embeds: [embed] });
}

