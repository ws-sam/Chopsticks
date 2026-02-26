import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { loadGuildData, saveGuildData } from "../utils/storage.js";
import { normalizePrefixValue } from "../prefix/hardening.js";

export const meta = {
  category: "admin",
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
  deployGlobal: true
};

export const data = new SlashCommandBuilder()
  .setName("prefix")
  .setDescription("View or set the prefix")
  .addStringOption(o =>
    o.setName("value").setDescription("New prefix (1-4 chars)").setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const data = await loadGuildData(interaction.guildId);
  data.prefix ??= { value: "!" };
  const value = interaction.options.getString("value");
  if (!value) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `Current prefix: ${data.prefix.value || "!"}`
    });
    return;
  }
  const normalized = normalizePrefixValue(value);
  if (!normalized.ok) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: normalized.error
    });
    return;
  }
  data.prefix.value = normalized.value;
  await saveGuildData(interaction.guildId, data);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `Prefix set to ${data.prefix.value}`
  });
}
