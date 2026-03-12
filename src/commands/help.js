import {
  ActionRowBuilder,
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  StringSelectMenuBuilder,
  PermissionFlagsBits
} from "discord.js";
import { loadGuildData } from "../utils/storage.js";
import { Colors } from "../utils/discordOutput.js";
import { searchCommands, getAutocompleteSuggestions } from "../utils/helpSearch.js";
import { getCommand, getCommands } from "../utils/helpRegistry.js";
import { CATEGORIES } from "../utils/commandCategories.js";
import { getPrefixCommands, CATEGORIES as PREFIX_CATEGORY_GROUPS } from "../prefix/registry.js";

const HELP_UI_PREFIX = "helpui";
const MAIN_VALUE = "__main__";

const BROAD_CATEGORIES = [
  {
    key: "core",
    label: "Core",
    description: "Slash commands, discoverability, bot status, and navigation.",
    emoji: "🤖",
    taxonomyKeys: [CATEGORIES.INFO, CATEGORIES.UTILITY],
  },
  {
    key: "voice_audio",
    label: "Voice + Audio",
    description: "Music, voice lobbies, AI assistant, agents, and pools.",
    emoji: "🎵",
    taxonomyKeys: [CATEGORIES.MUSIC, CATEGORIES.VOICE, CATEGORIES.AGENTS, CATEGORIES.AI],
  },
  {
    key: "moderation",
    label: "Moderation",
    description: "Safety, enforcement, server controls, and anti-abuse.",
    emoji: "🔨",
    taxonomyKeys: [CATEGORIES.MOD, CATEGORIES.SAFETY],
  },
  {
    key: "economy_fun",
    label: "Economy + Game",
    description: "Economy progression, inventory, crafting, and social features.",
    emoji: "💰",
    taxonomyKeys: [CATEGORIES.ECONOMY, CATEGORIES.GAME, CATEGORIES.SOCIAL, CATEGORIES.FUN, CATEGORIES.ENTERTAINMENT],
  },
  {
    key: "admin_setup",
    label: "Admin + Setup",
    description: "Bot config, automations, tools, and server governance.",
    emoji: "⚙️",
    taxonomyKeys: [CATEGORIES.ADMIN, CATEGORIES.TOOLS, CATEGORIES.COMMUNITY],
  }
];

const CATEGORY_BY_KEY = new Map(BROAD_CATEGORIES.map(c => [c.key, c]));
const CATEGORY_PLAYBOOK = {
  core: {
    useWhen: "You need discovery, quick diagnostics, or bot metadata.",
    workflow: [
      "Use `/tutorials` for guided setup and feature tour.",
      "Check availability with `/ping` and `/uptime`.",
      "Inspect capabilities with `/commands ui` or `/help` category drill-down.",
      "Grab server/user context with `/serverinfo` and `/userinfo`."
    ]
  },
  voice_audio: {
    useWhen: "You need music playback, VoiceMaster controls, or agent routing.",
    workflow: [
      "Verify agent capacity with `/agents status`.",
      "Start playback with `/music play`.",
      "Configure VC automation with `/voice setup` then `/voice console`."
    ]
  },
  moderation: {
    useWhen: "You need enforcement, cleanup, anti-abuse, or member control.",
    workflow: [
      "Use `/warn`, `/timeout`, `/ban` for escalation.",
      "Use `/purge` for scoped cleanup.",
      "Review warnings history before major actions."
    ]
  },
  economy_fun: {
    useWhen: "You want progression, inventory loops, or social/fun interactions.",
    workflow: [
      "Start economy loop: `/daily`, `/work`, `/gather`.",
      "Track progression with `/profile` and `/inventory`.",
      "Use `/game panel` for guided game actions."
    ]
  },
  admin_setup: {
    useWhen: "You are configuring server defaults, governance, or automations.",
    workflow: [
      "Set baseline with `/config` and `/prefix`.",
      "Manage automation with `/automations`, `/alias`, `/macro`, `/custom`.",
      "Enable onboarding/logging using `/welcome`, `/autorole`, `/starboard`, `/tickets`, `/modlogs`, `/logs`."
    ]
  }
};
const KNOWN_COMMAND_GROUPS = {
  core: new Set([
    "help", "commands", "ping", "uptime", "botinfo", "invite",
    "serverinfo", "userinfo", "avatar", "echo", "roleinfo", "remind", "tickets"
  ]),
  voice_audio: new Set(["music", "voice", "assistant", "agents", "pools"]),
  moderation: new Set([
    "ban", "unban", "kick", "timeout", "warn", "warnings", "clearwarns",
    "purge", "slowmode", "lock", "unlock", "nick", "softban", "role"
  ]),
  economy_fun: new Set([
    "balance", "bank", "daily", "work", "pay", "inventory", "vault",
    "collection", "gather", "use", "fight", "quests", "craft", "game", "profile", "shop", "8ball", "coinflip", "roll", "choose",
    "poll", "giveaway", "fun"
  ]),
  admin_setup: new Set(["config", "prefix", "alias", "macro", "custom", "logs", "modlogs", "welcome", "autorole", "reactionroles", "levels", "automations", "starboard", "setup"])
};

export const meta = {
  deployGlobal: true,
  category: "info",
  guildOnly: true,
};

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show the Chopsticks help center")
  .addSubcommand(sub =>
    sub
      .setName("browse")
      .setDescription("Browse commands by category (default view)")
  )
  .addSubcommand(sub =>
    sub
      .setName("search")
      .setDescription("Search for commands by name or keyword")
      .addStringOption(opt =>
        opt
          .setName("query")
          .setDescription("Search term (fuzzy matching supported)")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("command")
      .setDescription("Get detailed help for a specific command")
      .addStringOption(opt =>
        opt
          .setName("name")
          .setDescription("Command name")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("prefix")
      .setDescription("Browse prefix commands (!cmd) by category")
      .addStringOption(opt =>
        opt
          .setName("category")
          .setDescription("Prefix command category to browse")
          .setRequired(false)
      )
  );

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

// Taxonomy → broad category mapping (uses canonical CATEGORIES)
const TAXONOMY_TO_BROAD = {
  [CATEGORIES.INFO]:          "core",
  [CATEGORIES.UTILITY]:       "core",
  [CATEGORIES.MUSIC]:         "voice_audio",
  [CATEGORIES.VOICE]:         "voice_audio",
  [CATEGORIES.AGENTS]:        "voice_audio",
  [CATEGORIES.AI]:            "voice_audio",
  [CATEGORIES.MOD]:           "moderation",
  [CATEGORIES.SAFETY]:        "moderation",
  [CATEGORIES.ECONOMY]:       "economy_fun",
  [CATEGORIES.GAME]:          "economy_fun",
  [CATEGORIES.SOCIAL]:        "economy_fun",
  [CATEGORIES.FUN]:           "economy_fun",
  [CATEGORIES.ENTERTAINMENT]: "economy_fun",
  [CATEGORIES.ADMIN]:         "admin_setup",
  [CATEGORIES.TOOLS]:         "admin_setup",
  [CATEGORIES.COMMUNITY]:     "admin_setup",
  [CATEGORIES.MEDIA]:         "economy_fun",
  [CATEGORIES.INTERNAL]:      "core",
};

function inferBroadCategory(commandName, explicitCategory = "") {
  const explicit = String(explicitCategory || "").toLowerCase();
  if (TAXONOMY_TO_BROAD[explicit]) return TAXONOMY_TO_BROAD[explicit];

  // Legacy fallback
  if (explicit === "music" || explicit === "assistant" || explicit === "pools") return "voice_audio";
  if (explicit === "admin") return "admin_setup";

  for (const [category, names] of Object.entries(KNOWN_COMMAND_GROUPS)) {
    if (names.has(commandName)) return category;
  }
  return "core";
}

function commandRecord(command, memberPerms) {
  const json = command?.data?.toJSON?.() ?? command?.data ?? {};
  const name = String(json.name || command?.data?.name || "").trim();

  // Role-aware filtering: check if user has required permissions
  if (memberPerms) {
    const requiredPerms = json.default_member_permissions;
    if (requiredPerms && !memberPerms.has(BigInt(requiredPerms))) {
      return null;
    }
    // Also check meta.userPerms if present (custom field used in some commands)
    const metaPerms = command?.meta?.userPerms;
    if (metaPerms && Array.isArray(metaPerms)) {
      for (const perm of metaPerms) {
        if (!memberPerms.has(perm)) return null;
      }
    }
  }

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

function buildCategoryData(client, memberPerms) {
  const records = Array.from(client.commands.values())
    .map(c => commandRecord(c, memberPerms))
    .filter(r => r && r.name)
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

function clampText(value, max = 160) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, Math.max(0, max));
  return `${text.slice(0, max - 1)}...`;
}

function formatCategoryCards(categories, byCategory) {
  const lines = [];
  for (const c of categories) {
    const count = byCategory.get(c.key)?.length ?? 0;
    lines.push(`• **${c.label}** (${count})`);
    lines.push(clampText(c.description, 90));
    if (lines.join("\n").length > 900) break;
  }
  return lines.join("\n");
}

function formatCategoryCommands(list, maxLen = 980) {
  const lines = [];
  let used = 0;

  for (let i = 0; i < list.length; i += 1) {
    const rec = list[i];
    const line = `• /${rec.name} — ${clampText(rec.description, 80)} (${rec.variantSummary})`;
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
  const categoryOverview = formatCategoryCards(categories, byCategory);
  return new EmbedBuilder()
    .setTitle("Chopsticks Help Center")
    .setColor(Colors.Info)
    .setDescription(
      "Use the dropdown below to open focused help for each area. The panel updates in place with command guidance and variants."
    )
    .addFields(
      {
        name: "Start Here",
        value:
          "1. Deploy capacity with `/agents deploy desired_total:10`.\n" +
          "2. Check readiness using `/agents status`.\n" +
          "3. Launch a feature (`/music play`, `/voice setup`, `/game panel`).\n" +
          "4. Use category dropdown for deeper help."
      },
      {
        name: "Find The Right Category",
        value:
          categoryOverview || summarizeCategories(categories, byCategory) || "No categories detected."
      },
      {
        name: "How Category Pages Work",
        value:
          "• Each entry shows command purpose and variant summary.\n" +
          "• Variants include subcommands and grouped flows.\n" +
          "• Use `/commands ui` if you want searchable command browsing."
      },
      {
        name: "Usage Style",
        value:
          `• Slash: \`/command\`\n` +
          `• Prefix fallback: \`${prefix}command\`\n` +
          "• Admin actions require appropriate server permissions."
      }
    )
    .setFooter({ text: `Chopsticks • ${commandCount} command(s)` })
    .setTimestamp();
}

function buildCategoryEmbed({ categoryKey, list, prefix }) {
  const meta = CATEGORY_BY_KEY.get(categoryKey) || { label: categoryKey, description: "Command category." };
  const playbook = CATEGORY_PLAYBOOK[categoryKey] || {
    useWhen: "Use this category for related command workflows.",
    workflow: ["Select a command from this category and run it directly."]
  };

  return new EmbedBuilder()
    .setTitle(`Help • ${meta.label}`)
    .setColor(Colors.Info)
    .setDescription(meta.description || "Category details.")
    .addFields(
      {
        name: "Use This Category When",
        value: clampText(playbook.useWhen, 220)
      },
      {
        name: "Recommended Flow",
        value: playbook.workflow.map((step, idx) => `${idx + 1}. ${step}`).join("\n").slice(0, 1024)
      },
      {
        name: "Commands",
        value: formatCategoryCommands(list)
      },
      {
        name: "Command Format",
        value:
          `Slash: \`/command\`\n` +
          `Prefix fallback: \`${prefix}command\`\n` +
          "Use the dropdown to switch categories."
      }
    )
    .setFooter({ text: `${list.length} command(s) in ${meta.label}` })
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
  const memberPerms = interaction.inGuild() ? interaction.member.permissions : null;
  const { records, byCategory, categories } = buildCategoryData(interaction.client, memberPerms);
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
  
  const subcommand = interaction.options.getSubcommand(false);
  
  // Handle search subcommand
  if (subcommand === 'search') {
    const query = interaction.options.getString('query', true);
    const results = searchCommands(query, 10);
    
    if (results.length === 0) {
      await interaction.reply({
        content: `No commands found for "${query}". Try browsing categories with \`/help browse\``,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`Search Results: "${query}"`)
      .setColor(Colors.Info)
      .setDescription(
        results
          .map((r, idx) => `${idx + 1}. **/${r.name}** — ${r.metadata.description}`)
          .join('\n')
      )
      .setFooter({ text: `Found ${results.length} matching command(s)` });
    
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  
  // Handle command detail subcommand
  if (subcommand === 'command') {
    const commandName = interaction.options.getString('name', true);
    const metadata = getCommand(commandName);
    
    if (!metadata) {
      await interaction.reply({
        content: `Command "${commandName}" not found. Use \`/help search\` to find commands.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`/${metadata.name}`)
      .setColor(Colors.Info)
      .setDescription(metadata.description)
      .addFields(
        { name: 'Category', value: metadata.category, inline: true },
        { name: 'Context', value: metadata.context.join(', '), inline: true },
        { name: 'Usage', value: `\`${metadata.usage}\`` },
        { name: 'Examples', value: metadata.examples.map(ex => `\`${ex}\``).join('\n') }
      );
    
    if (metadata.permissions && metadata.permissions.length > 0) {
      embed.addFields({
        name: 'Required Permissions',
        value: metadata.permissions.join(', ')
      });
    }
    
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  
  // Handle prefix subcommand — discoverability hub for prefix commands
  if (subcommand === 'prefix') {
    const requestedCategory = interaction.options.getString('category')?.toLowerCase();
    let prefixCmds;
    try {
      prefixCmds = await getPrefixCommands();
    } catch {
      prefixCmds = new Map();
    }

    if (requestedCategory) {
      // Show commands for a specific category
      const cmds = [...prefixCmds.values()].filter(c => c.category === requestedCategory);
      if (!cmds.length) {
        await interaction.reply({
          content: `No prefix commands found in category \`${requestedCategory}\`. Use \`/help prefix\` (no category) to see all categories.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      const lines = cmds.slice(0, 30).map(c => `**!${c.name}**${c.aliases?.length ? ` *(${c.aliases.slice(0,2).join(', ')})*` : ''} — ${c.description || c.desc || 'No description'}`);
      const embed = new EmbedBuilder()
        .setTitle(`📋 Prefix Commands: ${requestedCategory}`)
        .setColor(Colors.PRIMARY)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${cmds.length} commands in this category · Use !help for inline help` });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    // Show category overview
    const categoryCount = new Map();
    for (const cmd of prefixCmds.values()) {
      const cat = cmd.category || 'other';
      categoryCount.set(cat, (categoryCount.get(cat) || 0) + 1);
    }
    const sortedCats = [...categoryCount.entries()].sort((a, b) => b[1] - a[1]);
    const fields = sortedCats.map(([cat, count]) => ({
      name: `📂 ${cat}`,
      value: `${count} commands · \`/help prefix category:${cat}\``,
      inline: true
    }));
    const embed = new EmbedBuilder()
      .setTitle('📋 Prefix Command Categories')
      .setColor(Colors.PRIMARY)
      .setDescription(`**${prefixCmds.size} prefix commands** across ${sortedCats.length} categories.\nUse your server's prefix (default: \`!\`) · Tab-complete: type \`!\` in chat\n\nBrowse a category: \`/help prefix category:<name>\``)
      .addFields(fields.slice(0, 18))
      .setFooter({ text: 'Prefix commands are the advanced power-user surface · No slash limits apply' });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // Default: browse mode
  const payload = buildPanelPayload(interaction, MAIN_VALUE);

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...payload
  });
}

// Autocomplete handler for search and command subcommands
export async function autocomplete(interaction) {
  const focusedOption = interaction.options.getFocused(true);
  const query = focusedOption.value || '';
  
  const suggestions = getAutocompleteSuggestions(query, 25);
  await interaction.respond(suggestions);
}

export async function handleSelect(interaction) {
  if (!interaction.isStringSelectMenu?.()) return false;
  const parsed = parseHelpUiId(interaction.customId);
  if (!parsed || parsed.kind !== "category") return false;

  if (parsed.userId !== interaction.user.id) {
    await interaction.reply({ content: "This help panel belongs to another user.", flags: MessageFlags.Ephemeral });
    return true;
  }

  interaction.__helpPrefix = await resolvePrefix(interaction);
  const selected = String(interaction.values?.[0] || MAIN_VALUE);
  const payload = buildPanelPayload(interaction, selected);
  await interaction.update(payload);
  return true;
}
