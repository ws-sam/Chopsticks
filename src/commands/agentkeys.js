// src/commands/agentkeys.js
// /agentkeys — link your own API keys to your guild's agents (BYOK).
// Guild admins can bring their own OpenAI, Groq, Anthropic, or ElevenLabs
// keys to unlock richer agent customization beyond shared pool defaults.

import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from "discord.js";
import {
  setGuildServiceKey,
  removeGuildServiceKey,
  listGuildServiceKeyStatus,
  SERVICE_KEYS,
} from "../utils/aiConfig.js";
import { sanitizeString } from "../utils/validation.js";
import { logger } from "../utils/logger.js";

export const meta = { category: "ai", deployGlobal: false, guildOnly: true, userPerms: [PermissionFlagsBits.ManageGuild] };

export const data = new SlashCommandBuilder()
  .setName("agentkeys")
  .setDescription("Link your own API keys to your guild's agents for richer customization")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(s => s
    .setName("link")
    .setDescription("Link an API key for a service to your agents")
    .addStringOption(o => o
      .setName("service")
      .setDescription("Service to link")
      .setRequired(true)
      .addChoices(
        { name: "OpenAI", value: "openai" },
        { name: "Groq", value: "groq" },
        { name: "Anthropic", value: "anthropic" },
        { name: "ElevenLabs", value: "elevenlabs" },
      ))
    .addStringOption(o => o
      .setName("key")
      .setDescription("Your API key (stored encrypted, never shown again)")
      .setRequired(true)))
  .addSubcommand(s => s
    .setName("unlink")
    .setDescription("Remove a linked API key for a service")
    .addStringOption(o => o
      .setName("service")
      .setDescription("Service to unlink")
      .setRequired(true)
      .addChoices(
        { name: "OpenAI", value: "openai" },
        { name: "Groq", value: "groq" },
        { name: "Anthropic", value: "anthropic" },
        { name: "ElevenLabs", value: "elevenlabs" },
      )))
  .addSubcommand(s => s
    .setName("status")
    .setDescription("Show which services have linked keys for this server"));

export async function execute(interaction) {
  try {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === "link") {
      const service = interaction.options.getString("service", true);
      const rawKey = sanitizeString(interaction.options.getString("key", true)).slice(0, 300);
      if (!rawKey) {
        return interaction.reply({ content: "❌ Key cannot be empty.", ephemeral: true });
      }

      await setGuildServiceKey(guildId, service, rawKey);
      logger.info({ guildId, service, userId: interaction.user.id }, "agentkeys: key linked");
      return interaction.reply({
        content: `✅ **${service}** key linked to this server's agents.\n> Stored encrypted. Use \`/agentkeys status\` to verify. Use \`/agentkeys unlink\` to remove it.`,
        ephemeral: true,
      });
    }

    if (sub === "unlink") {
      const service = interaction.options.getString("service", true);
      await removeGuildServiceKey(guildId, service);
      logger.info({ guildId, service, userId: interaction.user.id }, "agentkeys: key removed");
      return interaction.reply({
        content: `🗑️ **${service}** key removed. Agents will fall back to pool defaults.`,
        ephemeral: true,
      });
    }

    if (sub === "status") {
      const statuses = await listGuildServiceKeyStatus(guildId);
      const lines = SERVICE_KEYS.map(s =>
        `${statuses[s] ? "✅" : "○"} **${s}** — ${statuses[s] ? "key linked" : "not linked"}`
      );
      const embed = new EmbedBuilder()
        .setTitle("Agent API Keys — " + (interaction.guild?.name ?? guildId))
        .setDescription(lines.join("\n"))
        .setColor(0x38bdf8)
        .setFooter({ text: "Linked keys take precedence over shared pool defaults." });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (err) {
    logger.error({ err }, "agentkeys error");
    return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
  }
}
