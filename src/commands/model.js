// src/commands/model.js
// /model — per-guild voice LLM provider configuration (admin only).
// Supports: get | set <provider> | link [<provider>] | unset
// API keys are entered via ephemeral modal to avoid appearing in chat history.

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from "discord.js";
import {
  getGuildVoiceConfig,
  setGuildVoiceProvider,
  setGuildVoiceApiKey,
  setGuildOllamaUrl,
  clearGuildVoiceConfig,
  ALLOWED_PROVIDERS,
} from "../utils/voiceConfig.js";
import { validateProviderKey } from "../utils/voiceValidation.js";
import { withTimeout } from "../utils/interactionTimeout.js";

export const meta = {
  guildOnly: true,
  userPerms: [PermissionFlagsBits.ManageGuild],
  category: "admin",
  description: "Configure the voice AI model provider for this server.",
  keywords: ["voice", "ai", "model", "llm", "provider", "api key", "anthropic", "openai", "ollama"],
  deployGlobal: false
};

const PROVIDER_LABELS = {
  none:      "🚫 None (voice AI disabled)",
  ollama:    "🦙 Ollama (self-hosted, free)",
  anthropic: "🤖 Anthropic / Claude (your API key)",
  openai:    "🔵 OpenAI / GPT (your API key)",
};

export const data = new SlashCommandBuilder()
  .setName("model")
  .setDescription("Configure the voice AI model provider for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub =>
    sub.setName("get")
      .setDescription("Show current voice AI provider configuration")
  )
  .addSubcommand(sub =>
    sub.setName("set")
      .setDescription("Choose which AI provider powers voice (requires /model link for paid providers)")
      .addStringOption(o =>
        o.setName("provider")
          .setDescription("Provider to use")
          .setRequired(true)
          .addChoices(
            { name: "None — disable voice AI (free, default)", value: "none" },
            { name: "Ollama — self-hosted local model (free)", value: "ollama" },
            { name: "Anthropic / Claude — your API key", value: "anthropic" },
            { name: "OpenAI / GPT — your API key", value: "openai" },
          )
      )
  )
  .addSubcommand(sub =>
    sub.setName("link")
      .setDescription("Securely link your API key for the current provider (opens private form)")
      .addStringOption(o =>
        o.setName("provider")
          .setDescription("Provider to link key for (defaults to current setting)")
          .setRequired(false)
          .addChoices(
            { name: "Anthropic / Claude", value: "anthropic" },
            { name: "OpenAI / GPT", value: "openai" },
            { name: "Ollama — set custom URL", value: "ollama" },
          )
      )
  )
  .addSubcommand(sub =>
    sub.setName("unset")
      .setDescription("Remove API key and disable voice AI for this server")
  );

// ── Execute ─────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "This command must be used in a server.", ephemeral: true });
  }
  const sub = interaction.options.getSubcommand();

  if (sub === "get")   return handleGet(interaction);
  if (sub === "set")   return handleSet(interaction);
  if (sub === "link")  return handleLink(interaction);
  if (sub === "unset") return handleUnset(interaction);
}

// ── /model get ───────────────────────────────────────────────────────────────

async function handleGet(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await withTimeout(interaction, async () => {
    const cfg = await getGuildVoiceConfig(interaction.guildId);

    const embed = new EmbedBuilder()
      .setTitle("🎙️ Voice AI Provider")
      .setColor(cfg.provider === "none" ? 0x888888 : 0x00b4d8)
      .addFields(
        { name: "Provider", value: PROVIDER_LABELS[cfg.provider] ?? cfg.provider, inline: true },
        { name: "API Key", value: cfg.hasApiKey ? "🔐 Linked" : "❌ Not linked", inline: true },
      )
      .setFooter({ text: "Use /model set to change provider • /model link to add your key" });

    if (cfg.provider === "ollama" && cfg.ollamaUrl) {
      embed.addFields({ name: "Ollama URL", value: cfg.ollamaUrl, inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
  }, { label: "model" });
}

// ── /model set ───────────────────────────────────────────────────────────────

async function handleSet(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await withTimeout(interaction, async () => {
    const provider = interaction.options.getString("provider", true);

    await setGuildVoiceProvider(interaction.guildId, provider);

    const embed = new EmbedBuilder()
      .setColor(0x00b4d8)
      .setTitle("✅ Provider Updated")
      .setDescription(`Voice AI provider set to **${PROVIDER_LABELS[provider] ?? provider}**`);

    const needsKey = provider === "anthropic" || provider === "openai";
    if (needsKey) {
      embed.addFields({
        name: "⚠️ Next Step",
        value: "Run `/model link` to connect your API key — voice AI won't work without it.",
      });
    } else if (provider === "ollama") {
      embed.addFields({
        name: "⚠️ Next Step",
        value: "Run `/model link` with `ollama` selected to set your Ollama server URL.",
      });
    }

    await interaction.editReply({ embeds: [embed] });
  }, { label: "model" });
}

// ── /model link ──────────────────────────────────────────────────────────────

async function handleLink(interaction) {
  // Determine provider: from option or current setting
  let provider = interaction.options.getString("provider");
  if (!provider) {
    const cfg = await getGuildVoiceConfig(interaction.guildId);
    provider = cfg.provider;
  }

  if (provider === "none") {
    return interaction.reply({
      content: "❌ Set a provider first with `/model set` before linking a key.",
      ephemeral: true,
    });
  }

  const isOllama = provider === "ollama";
  const modal = new ModalBuilder()
    .setCustomId(`model_link_${interaction.guildId}_${provider}`)
    .setTitle(isOllama ? "Set Ollama Server URL" : `Link ${provider[0].toUpperCase() + provider.slice(1)} API Key`);

  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel(isOllama ? "Ollama Server URL" : "API Key")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(isOllama ? "http://your-server:11434" : "sk-...")
    .setRequired(true)
    .setMinLength(isOllama ? 7 : 10)
    .setMaxLength(isOllama ? 200 : 250);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

// ── /model unset ─────────────────────────────────────────────────────────────

async function handleUnset(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await withTimeout(interaction, async () => {
    await clearGuildVoiceConfig(interaction.guildId);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf03e3e)
          .setTitle("🗑️ Voice AI Disabled")
          .setDescription("Provider and API key removed. Voice AI will return empty responses."),
      ],
    });
  }, { label: "model" });
}

// ── Modal handler (registered in index.js) ────────────────────────────────────

export async function handleModal(interaction) {
  if (!interaction.customId?.startsWith("model_link_")) return false;

  // customId: model_link_<guildId>_<provider>
  const parts = interaction.customId.split("_");
  // format: model_link_<guildId>_<provider>
  // guildId can contain underscores? No — Discord snowflakes are numeric only.
  if (parts.length < 4) return false;
  const provider = parts[parts.length - 1];
  const guildId  = parts.slice(2, -1).join("_");

  await interaction.deferReply({ ephemeral: true });

  const value = interaction.fields.getTextInputValue("value")?.trim();
  if (!value) {
    await interaction.editReply({ content: "❌ No value provided." });
    return true;
  }

  const isOllama = provider === "ollama";

  // Validate before storing
  const check = await validateProviderKey(
    provider,
    isOllama ? null : value,
    isOllama ? value : null
  );

  if (!check.ok) {
    const errMap = {
      invalid_api_key: "❌ Invalid API key — check it and try again.",
      api_key_required: "❌ API key is required.",
      ollama_unreachable: "❌ Ollama server unreachable — ensure it's running and accessible.",
    };
    const msg = errMap[check.error] ?? `❌ Validation failed: \`${check.error}\``;
    await interaction.editReply({ content: msg });
    return true;
  }

  // Persist
  try {
    if (isOllama) {
      await setGuildOllamaUrl(guildId, value);
      await setGuildVoiceProvider(guildId, "ollama");
    } else {
      await setGuildVoiceApiKey(guildId, value);
    }
  } catch (err) {
    await interaction.editReply({ content: `❌ Failed to save: \`${err?.message}\`` });
    return true;
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00b97d)
        .setTitle("✅ Linked Successfully")
        .setDescription(
          isOllama
            ? `Ollama URL saved. Use \`/model set ollama\` if not already set.`
            : `Your **${provider}** API key was validated and securely stored.\nVoice AI is now active.`
        ),
    ],
  });
  return true;
}
