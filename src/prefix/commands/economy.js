// src/prefix/commands/economy.js
// Prefix economy & social commands — mirrors slash-command logic

import { EmbedBuilder } from "discord.js";
import { getWallet } from "../../economy/wallet.js";
import { claimDaily } from "../../economy/streaks.js";
import { addCredits } from "../../economy/wallet.js";
import { getCooldown, setCooldown, formatCooldown } from "../../economy/cooldowns.js";
import { listShopCategories, listShopItems } from "../../economy/shop.js";
import { getInventory, searchItems } from "../../economy/inventory.js";
import { addItem, removeItem } from "../../economy/inventory.js";
import { openCrateRolls, crateTierFromItemId } from "../../game/crates.js";
import { getGameProfile, addGameXp } from "../../game/profile.js";
import { getDailyQuests } from "../../game/quests.js";
import { sanitizeString } from "../../utils/validation.js";
import { botLogger } from "../../utils/modernLogger.js";
import { generateText } from "../../utils/textLlm.js";
import { httpRequest } from "../../utils/httpFetch.js";
import COLORS from "../../utils/colors.js";

// G5: Prestige title helper
function getPrestigeTitle(prestige) {
  const TITLES = [
    "Apprentice", "Veteran", "Elite", "Champion", "Master",
    "Grandmaster", "Legend", "Mythic", "Eternal", "Transcendent",
  ];
  return TITLES[Math.min(prestige - 1, TITLES.length - 1)] || "Legend";
}

/** Resolve a target user from mention / bare ID / fallback to author */
async function resolveUser(message, args) {
  return (
    message.mentions.users.first() ||
    (args[0]?.match(/^\d{17,19}$/)
      ? await message.client.users.fetch(args[0]).catch(() => null)
      : null) ||
    message.author
  );
}

// ---------------------------------------------------------------------------
// 1. !balance
// ---------------------------------------------------------------------------
const balanceCmd = {
  name: "balance",
  aliases: ["bal", "credits"],
  rateLimit: 5000,
  guildOnly: true,
  async execute(message, args) {
    try {
      const targetUser = await resolveUser(message, args);
      const wallet = await getWallet(targetUser.id);
      const embed = new EmbedBuilder()
        .setTitle("💰 Balance")
        .setColor(0xFFD700)
        .setAuthor({ name: targetUser.username })
        .addFields(
          { name: "Wallet", value: String(wallet?.balance ?? 0), inline: true },
          { name: "Bank", value: String(wallet?.bank ?? 0), inline: true },
          { name: "Bank Cap", value: String(wallet?.bank_capacity ?? wallet?.bankCapacity ?? 5000), inline: true }
        );
      await message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      botLogger.warn({ err }, "prefix:balance error");
      await message.reply("Couldn't fetch balance right now.").catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// 2. !daily
// ---------------------------------------------------------------------------
const dailyCmd = {
  name: "daily",
  aliases: ["claim", "dr"],
  rateLimit: 5000,
  guildOnly: true,
  async execute(message) {
    try {
      const claim = await claimDaily(message.author.id);
      if (!claim.ok) {
        const remaining = (claim.nextClaim ?? Date.now()) - Date.now();
        const embed = new EmbedBuilder()
          .setTitle("⏰ Already Claimed!")
          .setColor(0xFF6B6B)
          .setDescription(`Come back in **${formatCooldown(remaining)}**`);
        return await message.reply({ embeds: [embed] }).catch(() => {});
      }
      await addCredits(message.author.id, claim.totalReward, "daily");
      await addGameXp(message.author.id, 50, { reason: "daily" }).catch(() => {});
      const embed = new EmbedBuilder()
        .setTitle("🎁 Daily Reward")
        .setColor(COLORS.SUCCESS)
        .setDescription(
          `You claimed **${claim.totalReward}** credits!\nStreak: **${claim.streak}** day${claim.streak === 1 ? "" : "s"}`
        );
      await message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      botLogger.warn({ err }, "prefix:daily error");
      await message.reply("Couldn't process your daily reward right now.").catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// 3. !work
// ---------------------------------------------------------------------------
const WORK_COOLDOWN_MS = 30 * 60 * 1000;
const WORK_REWARD_MIN = 150;
const WORK_REWARD_MAX = 300;
const JOB_TITLES = [
  "Software Dev", "Chef", "Pilot", "Artist",
  "Mechanic", "Doctor", "Teacher", "Chef",
];

const workCmd = {
  name: "work",
  aliases: ["job", "earn"],
  rateLimit: 5000,
  guildOnly: true,
  async execute(message) {
    try {
      const cd = await getCooldown(message.author.id, "work");
      if (!cd.ok) {
        return await message.reply(
          `⏰ You worked too recently! Wait **${formatCooldown(cd.remaining)}**`
        );
      }
      const amount =
        Math.floor(Math.random() * (WORK_REWARD_MAX - WORK_REWARD_MIN + 1)) + WORK_REWARD_MIN;
      await addCredits(message.author.id, amount, "work");
      await setCooldown(message.author.id, "work", WORK_COOLDOWN_MS);
      await addGameXp(message.author.id, 25, { reason: "work" }).catch(() => {});
      const job = JOB_TITLES[Math.floor(Math.random() * JOB_TITLES.length)];
      const embed = new EmbedBuilder()
        .setTitle("💼 Work Complete")
        .setColor(COLORS.SUCCESS)
        .setDescription(`You worked as a **${job}** and earned **${amount}** credits!`);
      await message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      botLogger.warn({ err }, "prefix:work error");
      await message.reply("Couldn't process work right now.").catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// 4. !shop [category]
// ---------------------------------------------------------------------------
const shopCmd = {
  name: "shop",
  aliases: ["store", "market"],
  rateLimit: 5000,
  guildOnly: true,
  async execute(message, args) {
    try {
      const { createRequire } = await import("module");
      const require = createRequire(import.meta.url);
      const itemsData = require("../../economy/items.json");

      const CATEGORY_EMOJIS = { tools: "🔧", consumables: "📦", collectibles: "💎" };
      const category = args[0]?.toLowerCase();
      const page = Math.max(1, parseInt(args[1], 10) || 1);
      const PAGE_SIZE = 8;

      // Root: list categories with counts
      if (!category || !Object.keys(itemsData).includes(category)) {
        const cats = Object.keys(itemsData);
        const lines = cats.map(c => {
          const count = Object.keys(itemsData[c]).length;
          const em = CATEGORY_EMOJIS[c] || "🛍️";
          const purchasable = Object.values(itemsData[c]).filter(i => (i.price ?? 0) > 0).length;
          return `${em} **${c}** — ${purchasable} purchasable items  \`!shop ${c}\``;
        }).join("\n");
        const embed = new EmbedBuilder()
          .setTitle("🏪 Chopsticks Shop")
          .setColor(COLORS.INFO)
          .setDescription(lines + "\n\n💡 Use `!buy <item name>` to purchase an item.")
          .setFooter({ text: "!shop <category> [page] to browse" });
        return await message.reply({ embeds: [embed] }).catch(() => {});
      }

      const items = Object.values(itemsData[category] || {});
      if (!items.length) return await message.reply("No items in that category.");

      const totalPages = Math.ceil(items.length / PAGE_SIZE);
      const slice = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const em = CATEGORY_EMOJIS[category] || "🛍️";

      const embed = new EmbedBuilder()
        .setTitle(`${em} Shop — ${category.charAt(0).toUpperCase() + category.slice(1)}`)
        .setColor(COLORS.INFO)
        .setDescription(
          slice.map(i => {
            const price = i.price > 0 ? `💰 ${i.price.toLocaleString()} cr` : "🎁 Non-purchasable";
            const rarity = i.rarity ? ` • *${i.rarity}*` : "";
            return `${i.emoji || "📦"} **${i.name}**${rarity}\n  ${i.description || ""}\n  ${price}`;
          }).join("\n\n")
        )
        .setFooter({ text: `Page ${page}/${totalPages} • !shop ${category} ${page + 1 <= totalPages ? page + 1 : 1} for more` });
      await message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      botLogger.warn({ err }, "prefix:shop error");
      await message.reply("Couldn't load the shop right now.").catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// 5. !inventory [@user]
// ---------------------------------------------------------------------------
const inventoryCmd = {
  name: "inventory",
  aliases: ["inv", "bag", "items"],
  rateLimit: 5000,
  guildOnly: true,
  async execute(message, args) {
    try {
      const { createRequire } = await import("module");
      const require = createRequire(import.meta.url);
      const itemsData = require("../../economy/items.json");
      // Build item lookup
      const ITEMS = {};
      for (const cat of Object.values(itemsData)) {
        for (const [id, item] of Object.entries(cat)) ITEMS[id] = item;
      }

      const targetUser = await resolveUser(message, args);
      const rows = await getInventory(targetUser.id);
      if (!rows || rows.length === 0) {
        return await message.reply(`📦 **${targetUser.username}**'s inventory is empty.`);
      }

      // Group by category
      const grouped = {};
      for (const row of rows) {
        const id = row.item_id ?? row.itemId ?? row.id ?? "unknown";
        const qty = row.quantity ?? 1;
        const meta = ITEMS[id] || { name: id, emoji: "📦", category: "misc" };
        const cat = meta.category || "misc";
        if (!grouped[cat]) grouped[cat] = [];
        const existing = grouped[cat].find(x => x.id === id);
        if (existing) existing.qty += qty;
        else grouped[cat].push({ id, name: meta.name, emoji: meta.emoji || "📦", qty, rarity: meta.rarity });
      }

      const CAT_EMOJIS = { tools: "🔧", consumables: "📦", collectibles: "💎", misc: "🗃️" };
      const sections = Object.entries(grouped).map(([cat, items]) => {
        const em = CAT_EMOJIS[cat] || "📦";
        const lines = items.slice(0, 8).map(i => `${i.emoji} **${i.name}** ×${i.qty}`).join("\n");
        return `${em} **${cat.charAt(0).toUpperCase() + cat.slice(1)}**\n${lines}`;
      }).join("\n\n");

      const totalItems = rows.reduce((s, r) => s + (r.quantity ?? 1), 0);
      const embed = new EmbedBuilder()
        .setTitle(`📦 ${targetUser.username}'s Inventory`)
        .setColor(COLORS.KNOWLEDGE)
        .setDescription(sections.slice(0, 3900) || "Empty")
        .setFooter({ text: `${totalItems} total item${totalItems !== 1 ? "s" : ""} • !use <item> to use` })
        .setThumbnail(targetUser.displayAvatarURL?.() ?? null);
      await message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      botLogger.warn({ err }, "prefix:inventory error");
      await message.reply("Couldn't fetch inventory right now.").catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// 6. !leaderboard
// ---------------------------------------------------------------------------
const leaderboardCmd = {
  name: "leaderboard",
  aliases: ["lb", "top"],
  rateLimit: 10000,
  guildOnly: true,
  async execute(message) {
    // No getTopWallets utility exists; redirect gracefully.
    await message.reply("📊 Leaderboard is available via `/leaderboard`").catch(() => {});
  },
};

// ---------------------------------------------------------------------------
// 7. !profile [@user]
// ---------------------------------------------------------------------------
const profileCmd = {
  name: "profile",
  aliases: ["p"],
  rateLimit: 5000,
  guildOnly: true,
  async execute(message, args) {
    try {
      const targetUser = await resolveUser(message, args);
      const [profile, wallet] = await Promise.all([
        getGameProfile(targetUser.id),
        getWallet(targetUser.id),
      ]);
      const embed = new EmbedBuilder()
        .setTitle(`${targetUser.username}'s Profile`)
        .setColor(COLORS.INFO)
        .setThumbnail(targetUser.displayAvatarURL({ size: 64 }))
        .addFields(
          { name: "Level", value: String(profile?.level ?? 1), inline: true },
          { name: "XP", value: String(profile?.xp ?? 0), inline: true },
          { name: "Credits", value: String(wallet?.balance ?? 0), inline: true },
          { name: "Bank", value: String(wallet?.bank ?? 0), inline: true }
        );
      await message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      botLogger.warn({ err }, "prefix:profile error");
      await message.reply("Couldn't fetch profile right now.").catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// 8. !xp [@user]
// ---------------------------------------------------------------------------
const xpCmd = {
  name: "xp",
  aliases: ["exp", "level", "lvl", "rank"],
  rateLimit: 5000,
  guildOnly: true,
  async execute(message, args) {
    try {
      const targetUser = await resolveUser(message, args);
      const profile = await getGameProfile(targetUser.id);
      if (!profile) {
        return await message.reply("No XP data found for that user.");
      }
      const xp = profile.xp ?? 0;
      const filled = Math.floor((xp % 1000) / 100);
      const progress = "█".repeat(filled) + "░".repeat(10 - filled);
      const embed = new EmbedBuilder()
        .setTitle("⭐ XP Progress")
        .setColor(0xF39C12)
        .setAuthor({ name: targetUser.username })
        .addFields(
          { name: "Level", value: String(profile.level ?? 1), inline: true },
          { name: "XP", value: String(xp), inline: true },
          { name: "Title", value: profile.title ?? "Member", inline: true },
          { name: "Progress", value: progress, inline: false }
        );
      await message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      botLogger.warn({ err }, "prefix:xp error");
      await message.reply("Couldn't fetch XP data right now.").catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// 9. !quests
// ---------------------------------------------------------------------------
const questsCmd = {
  name: "quests",
  rateLimit: 10000,
  guildOnly: true,
  async execute(message) {
    try {
      const quests = await getDailyQuests(message.author.id).catch(() => null);
      if (!quests || quests.length === 0) {
        return await message.reply(
          "📋 No active quests. Use `/quests` to see available quests."
        );
      }
      const embed = new EmbedBuilder()
        .setTitle("📋 Active Quests")
        .setColor(0xE74C3C)
        .addFields(
          quests.slice(0, 10).map(q => ({
            name: q.name ?? q.quest_id ?? "Quest",
            value: q.description ?? `Progress: ${q.progress ?? 0}/${q.goal ?? "?"}`,
            inline: false,
          }))
        );
      await message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      botLogger.warn({ err }, "prefix:quests error");
      await message.reply("Use `/quests` for your quest overview.").catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// 10. !compliment [@user]
// ---------------------------------------------------------------------------
const FALLBACK_COMPLIMENTS = [
  "Their code is so clean you could eat off it.",
  "They're the kind of person who writes comments in their code — and good ones.",
  "They reply to messages within 24 hours, which puts them in the top 1%.",
  "Their commits actually have meaningful messages.",
  "They test their code before pushing to main.",
  "They're the reason the server's uptime is good.",
  "They read the docs AND the source code.",
  "They're so reliable, GitHub Actions send them thank-you notes.",
  "Their error handling is genuinely thoughtful.",
  "They close issues they open.",
];

const complimentCmd = {
  name: "compliment",
  rateLimit: 30000,
  async execute(message, args) {
    try {
      const targetUser = await resolveUser(message, args);
      const guildId = message.guildId;
      const prompt = `Give a short, genuine compliment for a Discord user named ${targetUser.username} (2 sentences max, positive only)`;
      let complimentText = await generateText({ guildId, prompt }).catch(() => "");
      if (!complimentText) {
        complimentText =
          FALLBACK_COMPLIMENTS[Math.floor(Math.random() * FALLBACK_COMPLIMENTS.length)];
      }
      const embed = new EmbedBuilder()
        .setTitle("✨ Compliment")
        .setColor(COLORS.SUCCESS)
        .setAuthor({ name: `${message.author.username} compliments ${targetUser.username}` })
        .setDescription(complimentText)
        .setThumbnail(targetUser.displayAvatarURL({ size: 64 }));
      await message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      botLogger.warn({ err }, "prefix:compliment error");
      const fallback =
        FALLBACK_COMPLIMENTS[Math.floor(Math.random() * FALLBACK_COMPLIMENTS.length)];
      await message
        .reply({ embeds: [new EmbedBuilder().setTitle("✨ Compliment").setColor(COLORS.SUCCESS).setDescription(fallback)] })
        .catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// 11. !trivia
// ---------------------------------------------------------------------------
const TRIVIA_FALLBACK =
  "What is 2+2?\n**A:** 3  **B:** 4  **C:** 5  **D:** 6\n*(Answer: B)*";

const triviaCmd = {
  name: "trivia",
  rateLimit: 10000,
  async execute(message) {
    try {
      const { statusCode, body } = await httpRequest(
        "opentdb",
        "https://opentdb.com/api.php?amount=1&type=multiple&encode=base64",
        { method: "GET" }
      );
      if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);
      const json = await body.json();
      const q = json?.results?.[0];
      if (!q) throw new Error("No question returned");

      const question = Buffer.from(q.question, "base64").toString("utf8");
      const correct = Buffer.from(q.correct_answer, "base64").toString("utf8");
      const incorrect = q.incorrect_answers.map(a =>
        Buffer.from(a, "base64").toString("utf8")
      );
      const choices = [...incorrect, correct].sort(() => Math.random() - 0.5);
      const labels = ["A", "B", "C", "D"];
      const fields = choices.map((c, i) => ({
        name: labels[i],
        value: c,
        inline: true,
      }));

      const embed = new EmbedBuilder()
        .setTitle("🎯 Trivia")
        .setColor(COLORS.KNOWLEDGE)
        .setDescription(question)
        .addFields(fields)
        .setFooter({ text: "Type A, B, C, or D to answer" });
      await message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      botLogger.warn({ err }, "prefix:trivia error");
      await message.reply(`🎯 **Trivia**\n${TRIVIA_FALLBACK}`).catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// 12. !riddle
// ---------------------------------------------------------------------------
const RIDDLES = [
  { q: "I speak without a mouth and hear without ears. What am I?", a: "An echo" },
  { q: "The more you take, the more you leave behind. What am I?", a: "Footsteps" },
  { q: "I have cities, but no houses live there. I have mountains but no trees. What am I?", a: "A map" },
  { q: "What has keys but no locks, space but no room, and you can enter but can't go inside?", a: "A keyboard" },
  { q: "The more you remove, the bigger I become. What am I?", a: "A hole" },
  { q: "What comes once in a minute, twice in a moment, but never in a thousand years?", a: "The letter M" },
  { q: "I'm tall when I'm young, and I'm short when I'm old. What am I?", a: "A candle" },
  { q: "What has hands but can't clap?", a: "A clock" },
];

const riddleCmd = {
  name: "riddle",
  rateLimit: 15000,
  async execute(message) {
    try {
      const riddle = RIDDLES[Math.floor(Math.random() * RIDDLES.length)];
      const embed = new EmbedBuilder()
        .setTitle("🧩 Riddle")
        .setColor(0xE67E22)
        .setDescription(riddle.q)
        .addFields({ name: "Answer (click to reveal)", value: `||${riddle.a}||`, inline: false });
      await message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      botLogger.warn({ err }, "prefix:riddle error");
      await message.reply("Couldn't load a riddle right now.").catch(() => {});
    }
  },
};

// ---------------------------------------------------------------------------
// 13. !craft <item>
// ---------------------------------------------------------------------------
const craftCmd = {
  name: "craft",
  rateLimit: 5000,
  guildOnly: true,
  async execute(message, args) {
    try {
      const itemName = sanitizeString(args.join(" "));
      if (!itemName) {
        return await message.reply("Usage: `!craft <item name>`");
      }
      const items = searchItems(itemName);
      if (!items || items.length === 0) {
        return await message.reply(
          `❌ Item **${itemName}** not found. Use \`!shop\` to browse items.`
        );
      }
      await message.reply(
        `⚒️ To craft **${items[0].name}**, use: \`/craft ${items[0].name}\``
      );
    } catch (err) {
      botLogger.warn({ err }, "prefix:craft error");
      await message.reply("Couldn't process craft right now.").catch(() => {});
    }
  },
};

export default [
  balanceCmd,
  dailyCmd,
  workCmd,
  shopCmd,
  inventoryCmd,
  leaderboardCmd,
  profileCmd,
  xpCmd,
  questsCmd,
  complimentCmd,
  triviaCmd,
  riddleCmd,
  craftCmd,

  // ── Cycle G2: Crate Opening — !open / !unbox ─────────────────────────────
  {
    name: "open",
    aliases: ["unbox", "openbox", "opencrate"],
    description: "Open a loot crate from your inventory — !open [crate name]",
    guildOnly: true,
    rateLimit: 3000,
    async execute(message, args) {
      const { createRequire } = await import("module");
      const require = createRequire(import.meta.url);
      const itemsData = require("../../economy/items.json");

      // Find crates in inventory
      const rows = await getInventory(message.author.id).catch(() => []);
      const crateIds = ["loot_crate_mythic", "loot_crate_legendary", "loot_crate_epic", "loot_crate_rare", "loot_crate_common"];
      const ownedCrates = rows.filter(r => crateIds.includes(r.item_id ?? r.itemId));

      if (!ownedCrates.length) {
        return message.reply("📦 You don't have any crates! Earn them by leveling up or completing quests.");
      }

      // Pick crate: args specify tier, default to best owned
      let target = null;
      if (args.length > 0) {
        const query = args.join(" ").toLowerCase();
        target = ownedCrates.find(r => {
          const id = r.item_id ?? r.itemId ?? "";
          return id.includes(query) || id.replace("loot_crate_", "").startsWith(query);
        });
        if (!target) return message.reply(`❌ You don't have a **${args.join(" ")}** crate. Use \`!inventory\` to see what you own.`);
      } else {
        // Auto-pick best tier
        for (const cid of crateIds) {
          const found = ownedCrates.find(r => (r.item_id ?? r.itemId) === cid);
          if (found) { target = found; break; }
        }
      }

      const crateId = target.item_id ?? target.itemId;
      const crateMeta = itemsData.consumables?.[crateId] || { name: crateId, emoji: "📦", rarity: "common" };
      const tier = crateTierFromItemId(crateId) || "common";

      const TIER_COLORS = { common: 0x94A3B8, rare: 0x22C55E, epic: 0x3B82F6, legendary: 0xF59E0B, mythic: 0xA855F7 };
      const TIER_EMOJIS = { common: "📦", rare: "🎁", epic: "🧠", legendary: "⚡", mythic: "🌌" };
      const color = TIER_COLORS[tier] || 0x94A3B8;
      const crateEmoji = TIER_EMOJIS[tier] || "📦";

      // Stage 1: Sealed embed
      const stage1 = new EmbedBuilder()
        .setTitle(`${crateEmoji} Opening ${crateMeta.name}...`)
        .setDescription("*The crate pulses with energy...*\n\n🔒 **Sealed**")
        .setColor(color);
      const msg = await message.reply({ embeds: [stage1] });

      await new Promise(r => setTimeout(r, 900));

      // Stage 2: Cracking
      const stage2 = new EmbedBuilder()
        .setTitle(`${crateEmoji} ${crateMeta.name} is opening...`)
        .setDescription("*Cracks appear on the surface...*\n\n🔓 **Breaking open...**")
        .setColor(color);
      await msg.edit({ embeds: [stage2] }).catch(() => {});

      // Roll loot FIRST (pure, no DB) so nothing is lost if addItem errors
      const { drops } = openCrateRolls(crateId, tier === "mythic" ? 3 : tier === "legendary" ? 2 : 1);
      const countBy = new Map();
      for (const d of drops) countBy.set(d, (countBy.get(d) || 0) + 1);

      // Grant items before removing the crate (atomic order: give first, deduct last)
      for (const [id, qty] of countBy.entries()) {
        await addItem(message.author.id, id, qty).catch(() => {});
      }

      // Remove crate from inventory only after loot is safely granted
      await removeItem(message.author.id, crateId, 1).catch(() => {});

      await new Promise(r => setTimeout(r, 900));

      // Stage 3: Reveal
      const ITEMS = {};
      for (const cat of Object.values(itemsData)) for (const [id, item] of Object.entries(cat)) ITEMS[id] = item;

      const revealLines = Array.from(countBy.entries()).map(([id, qty]) => {
        const meta = ITEMS[id] || { name: id, emoji: "📦", rarity: "common" };
        const RARITY_EMOJIS = { mythic: "🌌", legendary: "⚡", epic: "💎", rare: "🌟", common: "⬜" };
        const re = RARITY_EMOJIS[meta.rarity] || "⬜";
        return `${re} ${meta.emoji || "📦"} **${meta.name}**${qty > 1 ? ` ×${qty}` : ""}`;
      }).join("\n");

      const special = tier === "mythic" ? "\n\n✨ **MYTHIC CRATE OPENED!** Incredible pull!" :
                      tier === "legendary" ? "\n\n⚡ **LEGENDARY CRATE!** Outstanding!" : "";

      const stage3 = new EmbedBuilder()
        .setTitle(`${crateEmoji} ${crateMeta.name} Opened!`)
        .setDescription(`**You received:**\n\n${revealLines}${special}`)
        .setColor(color)
        .setFooter({ text: `${tier.toUpperCase()} tier • Check !inventory for your items` });
      await msg.edit({ embeds: [stage3] }).catch(() => {});

      // Fire event bus
      const { eventBus, Events } = await import("../../utils/eventBus.js");
      for (const [id] of countBy.entries()) {
        const meta = ITEMS[id] || {};
        eventBus.fire(Events.CRATE_OPENED, { userId: message.author.id, guildId: message.guildId, crateType: tier, item: id });
      }
    },
  },

  // ── Cycle G5: Prestige command ────────────────────────────────────────────
  {
    name: "prestige",
    aliases: ["ascend", "reset"],
    description: "Prestige — reset to level 1 for exclusive perks — !prestige",
    guildOnly: true,
    rateLimit: 10000,
    async execute(message) {
      const { getGameProfile, addGameXp } = await import("../../game/profile.js");
      const { getWallet, addCredits } = await import("../../economy/wallet.js");
      const { EmbedBuilder } = await import("discord.js");
      const PRESTIGE_LEVEL_REQ = 50;

      const profile = await getGameProfile(message.author.id).catch(() => null);
      if (!profile) return message.reply("❌ Couldn't load your profile. Try again!");

      const level = profile.level || 1;
      if (level < PRESTIGE_LEVEL_REQ) {
        const embed = new EmbedBuilder()
          .setTitle("✨ Prestige System")
          .setDescription([
            `You need to be **Level ${PRESTIGE_LEVEL_REQ}** to prestige.`,
            `You are currently **Level ${level}**.`,
            "",
            `**Prestige Rewards:**`,
            `• ⭐ Prestige badge next to your name`,
            `• 💰 **5,000 credits** bonus`,
            `• 🏆 Exclusive **Prestige** title`,
            `• 🎁 Legendary crate`,
            "",
            `Keep grinding! ${PRESTIGE_LEVEL_REQ - level} more levels to go.`,
          ].join("\n"))
          .setColor(COLORS.ECONOMY)
          .setFooter({ text: "Chopsticks !prestige" });
        return message.reply({ embeds: [embed] });
      }

      // Get current prestige count from profile title
      const currentPrestige = profile.prestige || 0;
      const newPrestige = currentPrestige + 1;

      // Reset XP to 0 (prestige wipe)
      try {
        const { getPool } = await import("../../utils/storage_pg.js");
        const pool = getPool();
        await pool.query(
          `UPDATE user_game_profiles SET xp = 0, level = 1, prestige = $1, updated_at = $2 WHERE user_id = $3`,
          [newPrestige, Date.now(), message.author.id]
        );
      } catch {
        return message.reply("❌ Prestige failed — database error. Try again!");
      }

      // Award prestige bonus credits
      await addCredits(message.author.id, 5000 * newPrestige, "prestige_bonus").catch(() => {});

      const PRESTIGE_STARS = ["⭐", "🌟", "💫", "✨", "🔥", "👑", "🌈", "💎", "🌙", "☀️"];
      const star = PRESTIGE_STARS[Math.min(newPrestige - 1, PRESTIGE_STARS.length - 1)];

      const embed = new EmbedBuilder()
        .setTitle(`${star} PRESTIGE ${newPrestige} — ${message.author.username}!`)
        .setDescription([
          `You have reached **Prestige ${newPrestige}**! Your journey starts anew.`,
          "",
          `**Rewards:**`,
          `• 💰 **${(5000 * newPrestige).toLocaleString()} credits** added to your wallet`,
          `• 🎖️ Prestige **${newPrestige}** badge`,
          `• 🏆 Title: **${getPrestigeTitle(newPrestige)}**`,
          "",
          `Your XP and level have been reset. Time to grind again! 💪`,
        ].join("\n"))
        .setColor(COLORS.ECONOMY)
        .setThumbnail(message.author.displayAvatarURL())
        .setFooter({ text: `Prestige ${newPrestige} • Chopsticks !prestige` });
      await message.reply({ embeds: [embed] }).catch(() => {});
    }
  },
];
