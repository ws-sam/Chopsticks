import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { Colors } from "../utils/discordOutput.js";

export const meta = {
  guildOnly: true,
  userPerms: [],
  category: "tools"
};

export const data = new SlashCommandBuilder()
  .setName("birthday")
  .setDescription("Manage birthday entries")
  .addSubcommand(sub =>
    sub
      .setName("set")
      .setDescription("Set your birthday")
      .addIntegerOption(o =>
        o.setName("month").setDescription("Month (1-12)").setRequired(true).setMinValue(1).setMaxValue(12)
      )
      .addIntegerOption(o =>
        o.setName("day").setDescription("Day (1-31)").setRequired(true).setMinValue(1).setMaxValue(31)
      )
  )
  .addSubcommand(sub =>
    sub.setName("list").setDescription("List all birthdays this month")
  )
  .addSubcommand(sub =>
    sub.setName("remove").setDescription("Remove your birthday entry")
  );

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function isValidDate(month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Use a non-leap year for validation so Feb 29 is excluded unless truly valid
  // Using year 2001 (non-leap)
  const d = new Date(2001, month - 1, day);
  return d.getMonth() === month - 1 && d.getDate() === day;
}

function getBirthdays(guildData) {
  if (typeof guildData.birthdays !== "object" || guildData.birthdays === null || Array.isArray(guildData.birthdays)) {
    guildData.birthdays = {};
  }
  return guildData.birthdays;
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildData = await loadGuildData(interaction.guildId);
  const birthdays = getBirthdays(guildData);

  if (sub === "set") {
    const month = interaction.options.getInteger("month", true);
    const day = interaction.options.getInteger("day", true);

    if (!isValidDate(month, day)) {
      await interaction.reply({
        content: `❌ \`${month}/${day}\` is not a valid date.`,
        flags: 64
      });
      return;
    }

    birthdays[interaction.user.id] = { month, day };
    await saveGuildData(interaction.guildId, guildData);

    await interaction.reply({
      content: `🎂 Birthday set for **${MONTH_NAMES[month - 1]} ${day}**!`,
      flags: 64
    });
  } else if (sub === "list") {
    const currentMonth = new Date().getMonth() + 1;

    const thisMonth = Object.entries(birthdays)
      .filter(([, v]) => v.month === currentMonth)
      .sort((a, b) => a[1].day - b[1].day);

    if (thisMonth.length === 0) {
      await interaction.reply({ content: "No birthdays this month." });
      return;
    }

    const lines = thisMonth.map(([id, v]) => `<@${id}> — ${MONTH_NAMES[v.month - 1]} ${v.day}`);
    const embed = new EmbedBuilder()
      .setTitle(`🎂 Birthdays in ${MONTH_NAMES[currentMonth - 1]}`)
      .setDescription(lines.join("\n"))
      .setColor(Colors.PRIMARY);

    await interaction.reply({ embeds: [embed] });
  } else if (sub === "remove") {
    if (!birthdays[interaction.user.id]) {
      await interaction.reply({ content: "❌ You have no birthday set.", flags: 64 });
      return;
    }
    delete birthdays[interaction.user.id];
    await saveGuildData(interaction.guildId, guildData);
    await interaction.reply({ content: "✅ Birthday removed.", flags: 64 });
  }
}

// TODO: Future enhancement — add a scheduled job (cron/scheduler) to announce
// birthdays automatically at midnight each day.
