import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { schedule } from "../utils/scheduler.js";
import { sanitizeString } from "../utils/validation.js";

export const meta = {
  deployGlobal: true,
  category: "utility",
  guildOnly: true,
};

export const data = new SlashCommandBuilder()
  .setName("remind")
  .setDescription("Set a reminder")
  .addIntegerOption(o =>
    o.setName("minutes").setDescription("Minutes from now").setRequired(true).setMinValue(1).setMaxValue(10080)
  )
  .addStringOption(o =>
    o.setName("text").setDescription("Reminder text").setRequired(true)
  );

export async function execute(interaction) {
  const minutes = interaction.options.getInteger("minutes", true);
  const text = sanitizeString(interaction.options.getString("text", true));
  const when = Date.now() + minutes * 60 * 1000;
  schedule(`remind:${interaction.user.id}:${when}`, minutes * 60 * 1000, async () => {
    try {
      await interaction.user.send(`Reminder: ${text}`);
    } catch {}
  });
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `Reminder scheduled in ${minutes} minutes.`
  });
}
