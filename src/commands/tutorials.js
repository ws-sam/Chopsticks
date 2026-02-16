import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder
} from "discord.js";

import { Colors } from "../utils/discordOutput.js";
import { openDeployUiHandoff, openAdvisorUiHandoff } from "./agents.js";
import { execute as poolsExecute } from "./pools.js";
import { showVoiceConsole } from "../tools/voice/ui.js";

export const meta = {
  guildOnly: false,
  userPerms: [],
  category: "core"
};

const TUTORIAL_UI_PREFIX = "tutorialsui";

const TOPICS = [
  {
    key: "start",
    label: "Start Here",
    description: "What Chopsticks is and what to do first."
  },
  {
    key: "pools",
    label: "Agent Pools",
    description: "Create pools, add agents, deploy, and scale."
  },
  {
    key: "voice",
    label: "VoiceMaster",
    description: "Custom VC creation, ownership, and dashboards."
  },
  {
    key: "music",
    label: "Music",
    description: "Playback, agent capacity, and troubleshooting."
  },
  {
    key: "moderation",
    label: "Moderation",
    description: "Purge, safety, and server controls."
  }
];

function uiId(kind, userId, topicKey) {
  const k = String(topicKey || "start");
  return `${TUTORIAL_UI_PREFIX}:${kind}:${userId}:${encodeURIComponent(k)}`;
}

function parseUiId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length < 4) return null;
  if (parts[0] !== TUTORIAL_UI_PREFIX) return null;
  let topicKey = "start";
  try {
    topicKey = decodeURIComponent(parts.slice(3).join(":"));
  } catch {}
  return { kind: parts[1], userId: parts[2], topicKey };
}

function buildBaseEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(String(description || "").slice(0, 4096))
    .setColor(Colors.INFO)
    .setTimestamp();
}

function topicContent(topicKey) {
  const inGuildNote = "Tip: run this inside a server for the full UI (deploy planning, invite links, guild defaults).";

  if (topicKey === "pools") {
    return {
      title: "Tutorial: Agent Pools",
      body: [
        "Chopsticks uses **pools** to manage multiple bot identities (agents) safely at scale.",
        "",
        "**Typical flow:**",
        "1) Create/select a pool (`/pools setup` or `/pools ui`).",
        "2) Register identities into a pool (`/agents add_token`).",
        "3) Mark identities active (`/agents update_token_status`).",
        "4) Deploy to a server (`/agents deploy` or Deploy UI).",
        "",
        inGuildNote
      ].join("\n")
    };
  }

  if (topicKey === "voice") {
    return {
      title: "Tutorial: VoiceMaster",
      body: [
        "VoiceMaster creates **temporary voice rooms** from a lobby and gives owners controls via dashboards.",
        "",
        "**Typical flow:**",
        "1) Configure lobbies (`/voice setup`).",
        "2) Join the lobby VC to spawn a room.",
        "3) Use the **Voice Console** for control buttons and delivery preferences.",
        "",
        "If spawning fails, use `/voice status` then **Spawn Diagnostics**."
      ].join("\n")
    };
  }

  if (topicKey === "music") {
    return {
      title: "Tutorial: Music",
      body: [
        "Music runs through pooled agents (voice workers).",
        "",
        "**Quick checks:**",
        "1) `/agents status` (are there agents in your server?)",
        "2) `/music play <query>`",
        "3) If it says all busy: deploy more agents or wait for idle release.",
        "",
        "**Playlists (drop channels):**",
        "1) Admins: `/music playlist panel` -> Create -> Bind Drop Channel -> (optional) Panel Message",
        "2) Admins: post a single **Playlist Hub** message so users can self-serve (`/music playlist panel` -> Hub Message)",
        "2) Users: drop audio files or links in the drop channel to add tracks",
        "   Tip: type `q: keywords` to add a search query item",
        "3) In VC: `/music queue` -> press **Playlists** -> queue a track from dropdowns",
        "",
        "Use Pools UI to see invite availability and the reason for gaps."
      ].join("\n")
    };
  }

  if (topicKey === "moderation") {
    return {
      title: "Tutorial: Moderation",
      body: [
        "**Core tools:** purge, warn, timeout, ban, locks/slowmode.",
        "",
        "**Recommended flow:**",
        "1) Use `/purge` for cleanup (buttons where available).",
        "2) Use `/warn` and `/timeout` for escalation.",
        "3) Use `/modlogs` + `/logs` for visibility and auditability."
      ].join("\n")
    };
  }

  return {
    title: "Chopsticks Tutorials",
    body: [
      "Chopsticks is a **controller bot** + **deployable agent fleet** platform.",
      "You can scale voice/music/game workloads without collapsing everything into one bot identity.",
      "",
      "**Start with this sequence:**",
      "1) Open **Pools UI** and pick a pool.",
      "2) Open **Deploy UI** and generate invite links.",
      "3) Join a VoiceMaster lobby to spawn a room, then open Voice Console.",
      "",
      "Use the dropdown below to drill into a topic."
    ].join("\n")
  };
}

function buildTutorialEmbed(topicKey, interaction) {
  const topic = topicContent(topicKey);
  const embed = buildBaseEmbed(topic.title, topic.body);
  if (!interaction.inGuild()) {
    embed.addFields({
      name: "Server Context",
      value: "Some controls require a server context (deploy planning, guild defaults, voice console).",
      inline: false
    });
  }
  return embed;
}

function buildTutorialComponents(interaction, userId, topicKey) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(uiId("select", userId, topicKey))
    .setPlaceholder("Pick a tutorial topic")
    .addOptions(
      TOPICS.map(t => ({
        label: t.label,
        value: t.key,
        description: t.description,
        default: t.key === topicKey
      }))
    );

  const row1 = new ActionRowBuilder().addComponents(select);

  const inGuild = interaction.inGuild();
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(uiId("open_pools", userId, topicKey))
      .setLabel("Open Pools UI")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!inGuild),
    new ButtonBuilder()
      .setCustomId(uiId("open_deploy", userId, topicKey))
      .setLabel("Open Deploy UI")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!inGuild),
    new ButtonBuilder()
      .setCustomId(uiId("open_advisor", userId, topicKey))
      .setLabel("Open Advisor UI")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!inGuild),
    new ButtonBuilder()
      .setCustomId(uiId("open_voice_console", userId, topicKey))
      .setLabel("Voice Console")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!inGuild)
  );

  return [row1, row2];
}

async function renderTutorial(interaction, { update = false, topicKey = "start" } = {}) {
  const embed = buildTutorialEmbed(topicKey, interaction);
  const components = buildTutorialComponents(interaction, interaction.user.id, topicKey);
  const payload = { embeds: [embed], components, flags: MessageFlags.Ephemeral };

  if (update) return interaction.update(payload);
  return interaction.reply(payload);
}

export const data = new SlashCommandBuilder()
  .setName("tutorials")
  .setDescription("Interactive tutorials and quick-start control center");

export async function execute(interaction) {
  await renderTutorial(interaction, { update: false, topicKey: "start" });
}

export async function handleSelect(interaction) {
  if (!interaction.isStringSelectMenu?.()) return false;
  const parsed = parseUiId(interaction.customId);
  if (!parsed || parsed.kind !== "select") return false;

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({
      embeds: [buildBaseEmbed("Panel Locked", "This tutorial panel belongs to another user.").setColor(Colors.ERROR)],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const value = interaction.values?.[0];
  const topicKey = TOPICS.some(t => t.key === value) ? value : "start";
  await renderTutorial(interaction, { update: true, topicKey });
  return true;
}

export async function handleButton(interaction) {
  if (!interaction.isButton?.()) return false;
  const parsed = parseUiId(interaction.customId);
  if (!parsed) return false;

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({
      embeds: [buildBaseEmbed("Panel Locked", "This tutorial panel belongs to another user.").setColor(Colors.ERROR)],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      embeds: [buildBaseEmbed("Guild Only", "This action needs a server context.").setColor(Colors.ERROR)],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (parsed.kind === "open_pools") {
    // Reuse /pools ui behavior without forcing users to type.
    // poolsExecute expects options.getSubcommand(); supply minimal shim.
    interaction.options = interaction.options || {};
    interaction.options.getSubcommand = () => "ui";
    await poolsExecute(interaction);
    return true;
  }

  if (parsed.kind === "open_deploy") {
    await openDeployUiHandoff(interaction, {});
    return true;
  }

  if (parsed.kind === "open_advisor") {
    await openAdvisorUiHandoff(interaction, {});
    return true;
  }

  if (parsed.kind === "open_voice_console") {
    await showVoiceConsole(interaction);
    return true;
  }

  return false;
}
