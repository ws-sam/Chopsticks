import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { replyEmbed } from "../utils/discordOutput.js";

export const meta = {
  category: "util",
  guildOnly: true,
  deployGlobal: false,
};

export const data = new SlashCommandBuilder()
  .setName("echo")
  .setDescription("Echo text")
  .addStringOption(o => o.setName("text").setDescription("Text").setRequired(true));

export async function execute(interaction) {
  const text = interaction.options.getString("text", true);
  await replyEmbed(interaction, "Echo", text, true);
}
