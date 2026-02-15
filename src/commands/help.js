import {
  ActionRowBuilder,
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  StringSelectMenuBuilder
} from "discord.js";
import { loadGuildData } from "../utils/storage.js";

const HELP_UI_PREFIX = "helpui";
const MAIN_VALUE = "__main__";

const BROAD_CATEGORIES = [
  {
    key: "core",
    label: "Core",
    description: "General bot usage, discovery, and status."
  },
  {
    key: "voice_audio",
    label: "Voice + Audio",
    description: "Music, VoiceMaster, assistant, agents, and pools."
  },
  {
    key: "moderation",
    label: "Moderation",
    description: "Safety, enforcement, and server member controls."
  },
  {
    key: "economy_fun",
    label: "Economy + Fun",
    description: "Economy progression, inventory, games, and casual tools."
  },
  {
    key: "admin_setup",
    label: "Admin + Setup",
    description: "Configuration, automation, logging, and governance."
  }
];

const CATEGORY_BY_KEY = new Map(BROAD_CATEGORIES.map(c => [c.key, c]));
const KNOWN_COMMAND_GROUPS = {
  core: new Set([
    "help", "commands", "ping", "uptime", "botinfo", "invite",
    "serverinfo", "userinfo", "avatar", "echo", "roleinfo", "remind"
  ]),
  voice_audio: new Set(["music", "voice", "assistant", "agents", "pools"]),
  moderation: new Set([
    "ban", "unban", "kick", "timeout", "warn", "warnings", "clearwarns",
    "purge", "slowmode", "lock", "unlock", "nick", "softban", "role"
  ]),
  economy_fun: new Set([
    "balance", "bank", "daily", "work", "pay", "inventory", "vault",
    "collection", "gather", "use", "fight", "game", "profile", "shop", "8ball", "coinflip", "roll", "choose",
    "poll", "giveaway", "fun"
  ]),
  admin_setup: new Set(["config", "prefix", "alias", "macro", "custom", "logs", "welcome", "autorole"])
};

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show the Chopsticks help center");

function parseHelpUiId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length < 3 || parts[0] !== HELP_UI_PREFIX) return null;
  return { kind: parts[1], userId: parts[2] };
}

function extractVariants(options = [], prefix = "") {
  const variants = [];
  const opts = Array.isArray(options) ? options : [];

  for (const opt of opts) {
    const type = Number(opt?.type);
    const name = String(opt?.name || "").trim();
    if (!name) continue;

    if (type === 2) {
      variants.push(...extractVariants(opt.options || [], prefix ? `${prefix} ${name}` : name));
      continue;
    }

    if (type === 1) {
      variants.push(prefix ? `${prefix} ${name}` : name);
    }
  }

  return variants;
}

function formatVariantSummary({ variants, args }) {
  if (variants.length > 0) {
    const shown = variants.slice(0, 6);
    const suffix = variants.length > shown.length ? ` +${variants.length - shown.length} more` : "";
    return `${shown.join(", ")}${suffix}`;
  }

  if (args.length > 0) {
    const argNames = args.slice(0, 5).map(a => a.name).filter(Boolean);
    const suffix = args.length > argNames.length ? ` +${args.length - argNames.length} more` : "";
    return `options: ${argNames.join(", ")}${suffix}`;
  }

  return "base command";
}

function inferBroadCategory(commandName, explicitCategory = "") {
  const name = String(commandName || "");
  const explicit = String(explicitCategory || "").toLowerCase();

  if (explicit === "music" || explicit === "assistant" || explicit === "pools") return "voice_audio";
  if (explicit === "admin") return "admin_setup";

  for (const [category, names] of Object.entries(KNOWN_COMMAND_GROUPS)) {
    if (names.has(name)) return category;
  }
  return "core";
}

function commandRecord(command) {
  const json = command?.data?.toJSON?.() ?? command?.data ?? {};
  const name = String(json.name || command?.data?.name || "").trim();
  const description = String(json.description || command?.data?.description || "No description.");
  const options = Array.isArray(json.options) ? json.options : [];
  const variants = extractVariants(options);
  const args = options.filter(o => {
    const t = Number(o?.type);
    return t !== 1 && t !== 2;
  });

  return {
    name,
    description,
    category: inferBroadCategory(name, command?.meta?.category),
    variants,
    args,
    variantSummary: formatVariantSummary({ variants, args })
  };
}

function buildCategoryData(client) {
  const records = Array.from(client.commands.values())
    .map(commandRecord)
    .filter(r => r.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  const byCategory = new Map(BROAD_CATEGORIES.map(c => [c.key, []]));
  for (const rec of records) {
    const list = byCategory.get(rec.category) || [];
    list.push(rec);
    byCategory.set(rec.category, list);
  }
  return { records, byCategory, categories: BROAD_CATEGORIES };
}

function summarizeCategories(categories, byCategory) {
  return categories
    .map(c => {
      const count = byCategory.get(c.key)?.length ?? 0;
      return `\`${c.label}\` (${count})`;
    })
    .join("  ");
}

function formatCategoryCommands(list, maxLen = 980) {
  const lines = [];
  let used = 0;

  for (let i = 0; i < list.length; i += 1) {
    const rec = list[i];
    const line = `- /${rec.name} -> ${rec.variantSummary}`;
    const next = used === 0 ? line.length : used + 1 + line.length;
    if (next > maxLen) {
      const remaining = list.length - i;
      if (remaining > 0) lines.push(`...and ${remaining} more.`);
      break;
    }
    lines.push(line);
    used = next;
  }

  return lines.length ? lines.join("\n") : "No commands in this category.";
}

function buildMainEmbed({ prefix, commandCount, categories, byCategory }) {
  return new EmbedBuilder()
    .setTitle("Chopsticks Help Center")
    .setColor(0x00a86b)
    .setDescription(
      "Select a broad category from the dropdown below. This panel updates in place with commands and command variants."
    )
    .addFields(
      {
        name: "Quick Start",
        value:
          "1. Deploy agents: `/agents deploy desired_total:10`\n" +
          "2. Start music: `/music play query:<song>`\n" +
          "3. Configure VoiceMaster: `/voice setup` then `/voice console`\n" +
          "4. Open command center: `/commands ui`"
      },
      {
        name: "How To Read Category Output",
        value:
          "- Each line shows `/command -> variants`\n" +
          "- Variants are subcommands or grouped subcommands\n" +
          "- If no subcommands exist, options are shown instead"
      },
      {
        name: "Usage",
        value:
          `- Slash commands: \`/command\`\n` +
          `- Prefix fallback: \`${prefix}command\`\n` +
          "- Use dropdown for category-specific help"
      },
      {
        name: "Categories",
        value: summarizeCategories(categories, byCategory) || "No categories detected."
      }
    )
    .setFooter({ text: `Chopsticks • ${commandCount} command(s)` })
    .setTimestamp();
}

function buildCategoryEmbed({ categoryKey, list, prefix }) {
  const meta = CATEGORY_BY_KEY.get(categoryKey) || { label: categoryKey, description: "Command category." };

  return new EmbedBuilder()
    .setTitle(`Help • ${meta.label}`)
    .setColor(0x2b2d31)
    .setDescription(meta.description)
    .addFields(
      {
        name: "Commands and Variants",
        value: formatCategoryCommands(list)
      },
      {
        name: "Usage",
        value:
          "Run slash commands directly from Discord's `/` menu.\n" +
          `Prefix fallback: \`${prefix}command\``
      }
    )
    .setTimestamp();
}

function buildHelpComponents({ userId, categories, byCategory, selected = MAIN_VALUE }) {
  const options = [
    {
      label: "Main Help Center",
      value: MAIN_VALUE,
      description: "Overview and quick-start guidance",
      default: selected === MAIN_VALUE
    }
  ];

  for (const category of categories) {
    const count = byCategory.get(category.key)?.length ?? 0;
    options.push({
      label: category.label,
      value: category.key,
      description: `${count} command(s)`,
      default: selected === category.key
    });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${HELP_UI_PREFIX}:category:${userId}`)
    .setPlaceholder("Choose a help category")
    .addOptions(options.slice(0, 25))
    .setMinValues(1)
    .setMaxValues(1);

  return [new ActionRowBuilder().addComponents(select)];
}

async function resolvePrefix(interaction) {
  let prefix = "!";
  if (!interaction.inGuild()) return prefix;
  try {
    const data = await loadGuildData(interaction.guildId);
    prefix = data?.prefix?.value || "!";
  } catch {}
  return prefix;
}

function buildPanelPayload(interaction, selected) {
  const { records, byCategory, categories } = buildCategoryData(interaction.client);
  const prefix = interaction.__helpPrefix || "!";

  const embed = selected === MAIN_VALUE
    ? buildMainEmbed({ prefix, commandCount: records.length, categories, byCategory })
    : buildCategoryEmbed({ categoryKey: selected, list: byCategory.get(selected) || [], prefix });

  const components = buildHelpComponents({
    userId: interaction.user.id,
    categories,
    byCategory,
    selected
  });

  return { embeds: [embed], components };
}

export async function execute(interaction) {
  interaction.__helpPrefix = await resolvePrefix(interaction);
  const payload = buildPanelPayload(interaction, MAIN_VALUE);

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...payload
  });
}

export async function handleSelect(interaction) {
  if (!interaction.isStringSelectMenu?.()) return false;
  const parsed = parseHelpUiId(interaction.customId);
  if (!parsed || parsed.kind !== "category") return false;

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({ content: "This help panel belongs to another user.", ephemeral: true });
    return true;
  }

  interaction.__helpPrefix = await resolvePrefix(interaction);
  const selected = String(interaction.values?.[0] || MAIN_VALUE);
  const payload = buildPanelPayload(interaction, selected);
  await interaction.update(payload);
  return true;
}
