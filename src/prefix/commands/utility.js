import { EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { reply } from "../helpers.js";
import COLORS from "../../utils/colors.js";

// ── Shared helper for category embeds (used by help command + button handler) ─
async function sendCategoryEmbed(target, cat, catMap, CAT_EMOJI, prefix, isEdit = false) {
  const cmds = catMap.get(cat) ?? [];
  const emoji = CAT_EMOJI[cat] || "📦";
  const lines = cmds.map(c => {
    const al = c.aliases?.length ? ` *(${c.aliases.slice(0, 3).map(a => `!${a}`).join(", ")})*` : "";
    return `\`${prefix}${c.name}\`${al} — ${c.description || "No description"}`;
  });
  const embed = new EmbedBuilder()
    .setTitle(`${emoji} ${cat} (${cmds.length} commands)`)
    .setDescription(lines.join("\n").slice(0, 4000) || "No commands yet.")
    .setColor(COLORS.INFO)
    .setFooter({ text: `${prefix}help for overview • Chopsticks` });
  if (isEdit) return target.edit({ embeds: [embed] }).catch(() => {});
  return target.reply({ embeds: [embed] });
}

export default [
  {
    name: "ping",
    aliases: ["latency", "ms"],
    description: "Show bot latency",
    rateLimit: 5000,
    async execute(message) {
      const latency = Math.round(message.client.ws.ping);
      const color = latency < 100 ? 0x57F287 : latency < 250 ? 0xFEE75C : 0xED4245;
      const embed = new EmbedBuilder()
        .setTitle("🏓 Pong!")
        .addFields({ name: "📡 API Latency", value: `${latency}ms`, inline: true })
        .setColor(color)
        .setFooter({ text: "Chopsticks • !ping" });
      await message.reply({ embeds: [embed] });
    }
  },
  {
    name: "uptime",
    aliases: ["up"],
    description: "Bot uptime",
    rateLimit: 5000,
    async execute(message) {
      const upSec = Math.floor(process.uptime());
      const d = Math.floor(upSec / 86400);
      const h = Math.floor((upSec % 86400) / 3600);
      const m = Math.floor((upSec % 3600) / 60);
      const s = upSec % 60;
      const parts = [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean);
      const embed = new EmbedBuilder()
        .setTitle("⏱️ Uptime")
        .setDescription(`**${parts.join(" ")}**`)
        .setColor(COLORS.INFO)
        .setFooter({ text: "Chopsticks • !uptime" });
      await message.reply({ embeds: [embed] });
    }
  },
  {
    name: "help",
    aliases: ["h", "commands", "cmds"],
    description: "List prefix commands — !help [category|command]",
    rateLimit: 3000,
    async execute(message, args, ctx) {
      const query = args[0]?.toLowerCase();
      const allCmds = Array.from(ctx.commands.values());

      const catMap = new Map();
      for (const cmd of allCmds) {
        const cat = cmd.category || "other";
        if (!catMap.has(cat)) catMap.set(cat, []);
        catMap.get(cat).push(cmd);
      }

      const CAT_EMOJI = {
        meta: "⚙️", music: "🎵", ai: "🤖", utility: "🔧", fun: "🎉",
        social: "💬", info: "ℹ️", mod: "🔨", server: "🏰", media: "🎬",
        economy: "💰", animals: "🐾", entertainment: "🎭", knowledge: "📚",
        minigames: "🎮", voice: "🔊", other: "📦",
      };

      // ── Command detail lookup ──────────────────────────────────────────────
      if (query) {
        let cmd = ctx.commands.get(query) ?? allCmds.find(c => c.aliases?.includes(query));
        if (cmd) {
          const embed = new EmbedBuilder()
            .setTitle(`${ctx.prefix}${cmd.name}`)
            .setDescription(cmd.description || "No description.")
            .setColor(COLORS.INFO);
          if (cmd.aliases?.length)
            embed.addFields({ name: "Aliases", value: cmd.aliases.map(a => `\`${ctx.prefix}${a}\``).join(", "), inline: true });
          if (cmd.rateLimit)
            embed.addFields({ name: "Cooldown", value: `${cmd.rateLimit / 1000}s`, inline: true });
          if (cmd.guildOnly)
            embed.addFields({ name: "Server Only", value: "Yes", inline: true });
          embed.setFooter({ text: `Category: ${cmd.category || "other"} • Chopsticks` });
          return message.reply({ embeds: [embed] });
        }

        // Category lookup with button nav
        if (catMap.has(query)) {
          return sendCategoryEmbed(message, query, catMap, CAT_EMOJI, ctx.prefix);
        }

        return reply(message, `❌ No command or category \`${query}\`. Try \`${ctx.prefix}help\`.`);
      }

      // ── Root help: overview with category buttons ──────────────────────────
      const cats = [...catMap.keys()];
      const lines = cats.map(cat => {
        const cmds = catMap.get(cat);
        const emoji = CAT_EMOJI[cat] || "📦";
        const sample = cmds.slice(0, 3).map(c => `\`${ctx.prefix}${c.name}\``).join(", ");
        return `${emoji} **${cat}** (${cmds.length}) — ${sample}${cmds.length > 3 ? ` +${cmds.length - 3} more` : ""}`;
      });

      const embed = new EmbedBuilder()
        .setTitle("📖 Chopsticks — Command Help")
        .setDescription([
          `**${allCmds.length} prefix commands** across **${cats.length} categories**`,
          `Use \`${ctx.prefix}help <category>\` or click a button below.`,
          `Use \`${ctx.prefix}help <command>\` for command details.`,
          "",
          ...lines,
        ].join("\n"))
        .setColor(COLORS.INFO)
        .setFooter({ text: "Chopsticks • Slash commands: /help" });

      // Build up to 5 buttons per row (max 25 total = 5 rows)
      const PRIORITY_CATS = ["music", "ai", "fun", "economy", "social", "minigames", "mod", "utility", "info", "animals", "entertainment", "knowledge", "voice", "server", "meta"];
      const orderedCats = [...new Set([...PRIORITY_CATS, ...cats])].filter(c => catMap.has(c));
      const rows = [];
      for (let i = 0; i < Math.min(orderedCats.length, 25); i += 5) {
        const row = new ActionRowBuilder();
        const slice = orderedCats.slice(i, i + 5);
        for (const cat of slice) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`help:cat:${cat}`)
              .setLabel(`${CAT_EMOJI[cat] ?? "📦"} ${cat}`)
              .setStyle(ButtonStyle.Secondary)
          );
        }
        rows.push(row);
      }

      const msg = await message.reply({ embeds: [embed], components: rows.slice(0, 5) });

      // Handle button clicks for 2 minutes
      const coll = msg.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id,
        time: 120_000,
      });
      coll.on("collect", async interaction => {
        const cat = interaction.customId.replace("help:cat:", "");
        await interaction.deferUpdate().catch(() => {});
        await sendCategoryEmbed(msg, cat, catMap, CAT_EMOJI, ctx.prefix, true);
      });
      coll.on("end", () => msg.edit({ components: [] }).catch(() => {}));
    },
  },
  {
    name: "echo",
    aliases: ["say"],
    description: "Echo text back",
    rateLimit: 2000,
    async execute(message, args) {
      const text = args.join(" ").trim();
      await reply(message, text || "(empty)");
    }
  },
  {
    name: "choose",
    aliases: ["pick", "decide"],
    description: "Pick one option — !choose a, b, c OR !choose a|b|c",
    rateLimit: 2000,
    async execute(message, args) {
      const raw = args.join(" ");
      const items = raw.includes("|")
        ? raw.split("|").map(s => s.trim()).filter(Boolean)
        : raw.split(",").map(s => s.trim()).filter(Boolean);
      if (items.length < 2) return reply(message, "❌ Provide at least 2 options separated by `,` or `|`.");
      const pick = items[Math.floor(Math.random() * items.length)];
      const embed = new EmbedBuilder()
        .setTitle("🎯 I choose...")
        .setDescription(`**${pick}**`)
        .setColor(COLORS.ECONOMY)
        .setFooter({ text: `From ${items.length} options • Chopsticks` });
      await message.reply({ embeds: [embed] });
    }
  },
  {
    name: "invite",
    aliases: ["addbot", "add"],
    description: "Get the bot invite link",
    rateLimit: 10000,
    async execute(message) {
      const perms = new PermissionsBitField([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.Connect,
        PermissionsBitField.Flags.Speak,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ManageGuild,
        PermissionsBitField.Flags.ModerateMembers
      ]);
      const url = `https://discord.com/api/oauth2/authorize?client_id=${message.client.user.id}&permissions=${perms.bitfield}&scope=bot%20applications.commands`;
      const embed = new EmbedBuilder()
        .setTitle("🔗 Invite Chopsticks")
        .setDescription(`[**Click here to add Chopsticks to your server**](${url})`)
        .setColor(COLORS.INFO)
        .setFooter({ text: "Chopsticks by WokSpec" });
      await message.reply({ embeds: [embed] });
    }
  },

  // ── Cycle P4: Prefix-exclusive text toys & quick games ────────────────────

  {
    name: "mock",
    aliases: ["sponge", "spongebob"],
    description: "mOcK tExT — !mock <text>",
    rateLimit: 2000,
    async execute(message, args) {
      const text = args.join(" ").trim();
      if (!text) return reply(message, "Usage: `!mock <text>`");
      const mocked = text.split("").map((c, i) => i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()).join("");
      await message.reply(`🐸 ${mocked}`);
    }
  },

  {
    name: "reverse",
    aliases: ["rev", "backwards"],
    description: "Reverse text — !reverse <text>",
    rateLimit: 2000,
    async execute(message, args) {
      const text = args.join(" ").trim();
      if (!text) return reply(message, "Usage: `!reverse <text>`");
      await message.reply(`🔄 ${[...text].reverse().join("")}`);
    }
  },

  {
    name: "clap",
    aliases: ["👏"],
    description: "Add 👏 between 👏 words — !clap <text>",
    rateLimit: 2000,
    async execute(message, args) {
      if (!args.length) return reply(message, "Usage: `!clap <text>`");
      await message.reply(args.join(" 👏 ") + " 👏");
    }
  },

  {
    name: "emojify",
    aliases: ["emoji", "letters"],
    description: "Turn text into letter emoji — !emojify <text>",
    rateLimit: 2000,
    async execute(message, args) {
      const text = args.join(" ").trim().toLowerCase();
      if (!text) return reply(message, "Usage: `!emojify <text>`");
      const out = text.split("").map(c => {
        if (c >= "a" && c <= "z") return `:regional_indicator_${c}:`;
        if (c === " ") return "   ";
        return c;
      }).join(" ");
      await message.reply(out.slice(0, 1990));
    }
  },

  {
    name: "rate",
    aliases: ["rateit", "howgood"],
    description: "Rate anything out of 10 — !rate <thing>",
    rateLimit: 2000,
    async execute(message, args) {
      const thing = args.join(" ").trim();
      if (!thing) return reply(message, "Usage: `!rate <thing>`");
      // Deterministic-ish: hash the input for a consistent rating
      let h = 0;
      for (const c of thing.toLowerCase()) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
      const score = h % 11; // 0–10
      const bar = "⭐".repeat(score) + "☆".repeat(10 - score);
      const embed = new EmbedBuilder()
        .setTitle("📊 Rating")
        .setDescription(`**${thing}**\n\n${bar}\n\n**${score}/10**`)
        .setColor(score >= 7 ? 0x57F287 : score >= 4 ? 0xFEE75C : 0xED4245)
        .setFooter({ text: "Scientifically accurate™ • Chopsticks !rate" });
      await message.reply({ embeds: [embed] });
    }
  },

  {
    name: "rps",
    aliases: ["rockpaperscissors", "roshambo"],
    description: "Rock paper scissors — !rps <rock|paper|scissors>",
    rateLimit: 2000,
    async execute(message, args) {
      const MOVES = ["rock", "paper", "scissors"];
      const EMOJI = { rock: "🪨", paper: "📄", scissors: "✂️" };
      const player = args[0]?.toLowerCase();
      if (!MOVES.includes(player)) return reply(message, "Usage: `!rps rock|paper|scissors`");
      const bot = MOVES[Math.floor(Math.random() * 3)];
      const result =
        player === bot ? "🤝 **Tie!**"
        : (player === "rock" && bot === "scissors") || (player === "paper" && bot === "rock") || (player === "scissors" && bot === "paper")
          ? "🏆 **You win!**"
          : "😈 **I win!**";
      const embed = new EmbedBuilder()
        .setTitle("✂️ Rock Paper Scissors")
        .setDescription(`You: ${EMOJI[player]} **${player}**\nMe: ${EMOJI[bot]} **${bot}**\n\n${result}`)
        .setColor(result.includes("You win") ? 0x57F287 : result.includes("Tie") ? 0xFEE75C : 0xED4245)
        .setFooter({ text: "Chopsticks !rps" });
      await message.reply({ embeds: [embed] });
    }
  },

  {
    name: "slots",
    aliases: ["slot", "jackpot"],
    description: "Spin the slots — !slots",
    rateLimit: 4000,
    async execute(message) {
      const REELS = ["🍒", "🍋", "🍊", "🍇", "⭐", "💎", "7️⃣"];
      const spin = () => REELS[Math.floor(Math.random() * REELS.length)];
      const [a, b, c] = [spin(), spin(), spin()];
      const jackpot = a === b && b === c;
      const two = a === b || b === c || a === c;
      const result = jackpot ? "🎉 **JACKPOT!**" : two ? "✨ **Almost!**" : "❌ **No match**";
      const embed = new EmbedBuilder()
        .setTitle("🎰 Slot Machine")
        .setDescription(`[ ${a} | ${b} | ${c} ]\n\n${result}`)
        .setColor(jackpot ? 0xF0B232 : two ? 0xFEE75C : 0x99AAB5)
        .setFooter({ text: "Chopsticks !slots" });
      await message.reply({ embeds: [embed] });
    }
  },

  {
    name: "pp",
    aliases: ["size", "howbig"],
    description: "Measure the pp — !pp [@user]",
    rateLimit: 3000,
    async execute(message) {
      const target = message.mentions.users.first() || message.author;
      let h = 0;
      for (const c of target.id) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
      const size = h % 21; // 0–20
      const bar = "8" + "=".repeat(size) + "D";
      const embed = new EmbedBuilder()
        .setTitle("📏 PP Meter")
        .setDescription(`**${target.username}'s** pp:\n\`${bar}\` (${size}cm)`)
        .setColor(0xFF73FA)
        .setFooter({ text: "100% scientific • Chopsticks !pp" });
      await message.reply({ embeds: [embed] });
    }
  },

  {
    name: "ascii",
    aliases: ["figlet", "big"],
    description: "Big ASCII banner — !ascii <text> (max 10 chars)",
    rateLimit: 3000,
    async execute(message, args) {
      const text = args.join(" ").trim().slice(0, 10);
      if (!text) return reply(message, "Usage: `!ascii <text>`");
      // Simple block letter map (A–Z, 0–9)
      const BLOCKS = {
        A:"▲", B:"B", C:"C", D:"D", E:"E", F:"F", G:"G", H:"H", I:"I",
        J:"J", K:"K", L:"L", M:"M", N:"N", O:"O", P:"P", Q:"Q", R:"R",
        S:"S", T:"T", U:"U", V:"V", W:"W", X:"X", Y:"Y", Z:"Z",
        " ":"  "
      };
      const big = text.toUpperCase().split("").map(c => {
        const b = BLOCKS[c] || c;
        return `**${b}**`;
      }).join(" ");
      await message.reply(`\`\`\`\n${text.toUpperCase()}\n\`\`\`\n${big}`);
    }
  },

  // ── Cycle P9: Utility power pack ─────────────────────────────────────────

  {
    name: "calc",
    aliases: ["math", "calculate", "="],
    description: "Evaluate a math expression — !calc <expr>",
    rateLimit: 2000,
    async execute(message, args) {
      const expr = args.join(" ").trim();
      if (!expr) return reply(message, "Usage: `!calc <expression>` — e.g. `!calc (3 + 4) * 2`");
      // Safe evaluation: only allow numbers and math operators
      if (!/^[\d\s+\-*/.%^()]+$/.test(expr)) {
        return reply(message, "❌ Only numbers and operators `+ - * / % ( )` allowed.");
      }
      try {
        // eslint-disable-next-line no-new-func
        const result = Function(`"use strict"; return (${expr})`)();
        if (!isFinite(result)) return reply(message, "❌ Result is not a finite number.");
        const embed = new EmbedBuilder()
          .setTitle("🔢 Calculator")
          .addFields(
            { name: "Expression", value: `\`${expr}\``, inline: true },
            { name: "Result", value: `\`${result}\``, inline: true },
          )
          .setColor(COLORS.INFO)
          .setFooter({ text: "Chopsticks !calc" });
        await message.reply({ embeds: [embed] });
      } catch {
        await reply(message, "❌ Invalid expression.");
      }
    }
  },

  {
    name: "timestamp",
    aliases: ["ts", "time", "epoch"],
    description: "Convert a date to Discord timestamps — !timestamp <date>",
    rateLimit: 2000,
    async execute(message, args) {
      const input = args.join(" ").trim() || "now";
      const d = input === "now" ? new Date() : new Date(input);
      if (isNaN(d.getTime())) return reply(message, "❌ Invalid date. Try `!timestamp 2024-12-25` or `!timestamp now`");
      const unix = Math.floor(d.getTime() / 1000);
      const embed = new EmbedBuilder()
        .setTitle("⏰ Discord Timestamps")
        .setDescription(`Unix epoch: \`${unix}\``)
        .addFields(
          { name: "Short Date",      value: `<t:${unix}:d>  →  \`<t:${unix}:d>\``,  inline: false },
          { name: "Short Date/Time", value: `<t:${unix}:f>  →  \`<t:${unix}:f>\``,  inline: false },
          { name: "Long Date/Time",  value: `<t:${unix}:F>  →  \`<t:${unix}:F>\``,  inline: false },
          { name: "Relative",        value: `<t:${unix}:R>  →  \`<t:${unix}:R>\``,  inline: false },
        )
        .setColor(COLORS.INFO)
        .setFooter({ text: "Copy the code into any Discord message • Chopsticks !timestamp" });
      await message.reply({ embeds: [embed] });
    }
  },

  {
    name: "encode",
    aliases: ["b64", "base64"],
    description: "Base64 encode — !encode <text>",
    rateLimit: 2000,
    async execute(message, args) {
      const text = args.join(" ").trim();
      if (!text) return reply(message, "Usage: `!encode <text>`");
      const encoded = Buffer.from(text).toString("base64");
      await message.reply(`🔒 \`${encoded.slice(0, 1900)}\``);
    }
  },

  {
    name: "decode",
    aliases: ["b64d", "base64d"],
    description: "Base64 decode — !decode <base64>",
    rateLimit: 2000,
    async execute(message, args) {
      const text = args.join(" ").trim();
      if (!text) return reply(message, "Usage: `!decode <base64 string>`");
      try {
        const decoded = Buffer.from(text, "base64").toString("utf8");
        await message.reply(`🔓 \`${decoded.slice(0, 1900)}\``);
      } catch {
        await reply(message, "❌ Invalid base64 string.");
      }
    }
  },

  {
    name: "hash",
    aliases: ["sha256", "checksum"],
    description: "SHA-256 hash of text — !hash <text>",
    rateLimit: 2000,
    async execute(message, args) {
      const text = args.join(" ").trim();
      if (!text) return reply(message, "Usage: `!hash <text>`");
      const { createHash } = await import("crypto");
      const h = createHash("sha256").update(text).digest("hex");
      const embed = new EmbedBuilder()
        .setTitle("🔐 SHA-256 Hash")
        .addFields(
          { name: "Input", value: `\`${text.slice(0, 200)}\`` },
          { name: "Hash", value: `\`${h}\`` },
        )
        .setColor(COLORS.INFO)
        .setFooter({ text: "Chopsticks !hash" });
      await message.reply({ embeds: [embed] });
    }
  },
];
