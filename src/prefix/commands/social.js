// src/prefix/commands/social.js
// Prefix social commands: !battle, !fight, !compliment
// Reaction GIFs (hug, pat, slap, etc.) live in Cycle P6 (animals.js)

import { EmbedBuilder, Colors } from "discord.js";
import { getGameProfile } from "../../game/profile.js";
import { getWallet, addCredits, removeCredits } from "../../economy/wallet.js";
import { addGameXp } from "../../game/profile.js";
import { recordQuestEvent } from "../../game/quests.js";
import { checkRateLimit } from "../../utils/ratelimit.js";

const BATTLE_COOLDOWN_S = 5 * 60;

const ATTACK_MOVES = [
  "lands a devastating combo",
  "unleashes a critical strike",
  "executes a perfect counter",
  "pulls off an impossible dodge and ripostes",
  "activates a power surge",
  "deploys a tactical flanking maneuver",
  "channels raw determination",
  "drops a legendary finisher",
];
const FLAVOR_WIN = [
  "steps away victorious, brushing dust off their shoulders.",
  "raises their fist in triumph as the crowd goes wild.",
  "delivers the final blow with surgical precision.",
  "ends the battle with style — and not a scratch.",
];
const FLAVOR_LOSS = [
  "is left staring at the sky, wondering what just happened.",
  "retreats with dignity (mostly) intact.",
  "vows to train harder and return stronger.",
  "tips their hat — they fought well, just not well enough.",
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function calcWinChance(cLevel, oLevel) {
  const swing = Math.min(30, Math.max(-30, (cLevel - oLevel) * 3));
  return (50 + swing) / 100;
}

export default [
  {
    name: "battle",
    aliases: ["fight", "duel", "pvp"],
    description: "PvP battle — !battle @user [wager]",
    guildOnly: true,
    rateLimit: 5000,
    async execute(message, args) {
      const opponent = message.mentions.users.first();
      if (!opponent) return message.reply("⚔️ Mention someone to battle: `!battle @user [wager]`");
      if (opponent.id === message.author.id) return message.reply("⚔️ You can't battle yourself!");
      if (opponent.bot) return message.reply("🤖 Bots don't accept battle challenges.");

      const wager = parseInt(args.find(a => /^\d+$/.test(a)) || "0", 10) || 0;

      // Rate limit
      const rl = await checkRateLimit(`battle:${message.author.id}`, 1, BATTLE_COOLDOWN_S).catch(() => ({ ok: true }));
      if (!rl.ok) {
        const rem = Math.ceil(rl.retryAfter || BATTLE_COOLDOWN_S);
        return message.reply(`⏳ Still recovering from your last battle. Try again in **${rem}s**.`);
      }

      const [cProfile, oProfile] = await Promise.all([
        getGameProfile(message.author.id).catch(() => ({ level: 1 })),
        getGameProfile(opponent.id).catch(() => ({ level: 1 })),
      ]);
      const cLevel = cProfile?.level || 1;
      const oLevel = oProfile?.level || 1;

      if (wager > 0) {
        const [cW, oW] = await Promise.all([
          getWallet(message.author.id).catch(() => ({ balance: 0 })),
          getWallet(opponent.id).catch(() => ({ balance: 0 })),
        ]);
        if ((cW?.balance || 0) < wager)
          return message.reply(`💸 You don't have **${wager}** credits to wager.`);
        if ((oW?.balance || 0) < wager)
          return message.reply(`💸 **${opponent.username}** doesn't have enough credits to match **${wager}**.`);
      }

      const winChance = calcWinChance(cLevel, oLevel);
      const challengerWon = Math.random() < winChance;
      const winner = challengerWon ? message.author : opponent;
      const loser = challengerWon ? opponent : message.author;

      const rounds = [];
      for (let i = 0; i < 3; i++) {
        const attacker = i % 2 === 0 ? message.author : opponent;
        rounds.push(`> **${attacker.username}** ${pick(ATTACK_MOVES)}!`);
      }

      if (wager > 0) {
        await Promise.all([
          removeCredits(loser.id, wager, `battle_loss:vs_${winner.id}`).catch(() => {}),
          addCredits(winner.id, wager, `battle_win:vs_${loser.id}`).catch(() => {}),
        ]);
      }

      const winnerXp = 80 + Math.floor(Math.random() * 40);
      const loserXp = 30 + Math.floor(Math.random() * 20);
      await Promise.all([
        addGameXp(winner.id, winnerXp, "battle_win").catch(() => {}),
        addGameXp(loser.id, loserXp, "battle_loss").catch(() => {}),
        recordQuestEvent(winner.id, "battle_win").catch(() => {}),
      ]);

      const embed = new EmbedBuilder()
        .setTitle(`⚔️ ${message.author.username} vs ${opponent.username}`)
        .setColor(challengerWon ? Colors.Green : Colors.Red)
        .setDescription([
          `**Lv.${cLevel}** ${message.author.username} vs **Lv.${oLevel}** ${opponent.username}`,
          "",
          "**⚡ Battle Log:**",
          rounds.join("\n"),
          "",
          `🏆 **${winner.username}** ${pick(FLAVOR_WIN)}`,
          `😓 **${loser.username}** ${pick(FLAVOR_LOSS)}`,
          "",
          wager > 0
            ? `💰 **${winner.username}** wins **${wager * 2}** credits!`
            : `✨ **${winner.username}** +${winnerXp} XP | **${loser.username}** +${loserXp} XP`,
        ].join("\n"))
        .setFooter({ text: `${Math.round(winChance * 100)}% win chance for ${message.author.username} • Chopsticks !battle` });

      await message.reply({ embeds: [embed] });
    }
  },

  {
    name: "compliment",
    aliases: ["comp", "nice"],
    description: "Compliment a user — !compliment [@user]",
    rateLimit: 3000,
    async execute(message) {
      const { execute: slashExec } = await import("../../commands/compliment.js");
      // Build a minimal fake interaction to reuse slash logic
      const target = message.mentions.users.first() || message.author;
      const COMPLIMENTS = [
        "You have an incredible sense of humor!",
        "Your energy lights up every room you enter.",
        "You're one of the kindest people I know.",
        "You make difficult things look easy.",
        "The world is a better place with you in it.",
        "You have a genuine gift for making people feel valued.",
        "Your creativity is absolutely inspiring.",
        "You're braver than you give yourself credit for.",
        "You have excellent taste — in bots, clearly.",
        "Everyone is lucky to have you around.",
      ];
      const text = COMPLIMENTS[Math.floor(Math.random() * COMPLIMENTS.length)];
      const embed = new EmbedBuilder()
        .setTitle("💌 Compliment")
        .setDescription(`**${target.username}** — ${text}`)
        .setColor(0xFF73FA)
        .setThumbnail(target.displayAvatarURL())
        .setFooter({ text: "Chopsticks !compliment" });
      await message.reply({ embeds: [embed] });
    }
  },
,
// ── marry ───────────────────────────────────────────────────────────────────
  {
    name: "marry",
    aliases: ["propose", "wed"],
    description: "Propose marriage to a user — !marry @user",
    guildOnly: true,
    rateLimit: 5000,
    async execute(message) {
      const { loadGuildData, saveGuildData } = await import("../../utils/storage.js");
      const target = message.mentions.users.first();
      if (!target) return message.reply("💍 Mention someone to propose to: `!marry @user`");
      if (target.id === message.author.id) return message.reply("💍 You can't marry yourself!");
      if (target.bot) return message.reply("🤖 Bots don't accept proposals.");

      const data = await loadGuildData(message.guildId);
      data.marriages ??= {};
      const existing = data.marriages[message.author.id];
      if (existing) {
        const spouse = await message.client.users.fetch(existing).catch(() => null);
        return message.reply(`💍 You're already married to **${spouse?.username ?? "someone"}**! Use \`!divorce\` first.`);
      }
      if (data.marriages[target.id]) {
        return message.reply(`💍 **${target.username}** is already married!`);
      }

      const embed = new EmbedBuilder()
        .setTitle("💍 Marriage Proposal!")
        .setDescription(
          `**${message.author.username}** is proposing to **${target.username}**!\n\n` +
          `${target}, will you accept? React with 💍 to accept or ❌ to decline.`
        )
        .setColor(0xFF73FA)
        .setThumbnail(target.displayAvatarURL())
        .setFooter({ text: "You have 60 seconds to respond." });

      const msg = await message.reply({ embeds: [embed] });
      await msg.react("💍");
      await msg.react("❌");

      const filter = (r, u) => u.id === target.id && ["💍", "❌"].includes(r.emoji.name);
      try {
        const collected = await msg.awaitReactions({ filter, max: 1, time: 60_000, errors: ["time"] });
        const reaction = collected.first();
        if (reaction.emoji.name === "💍") {
          data.marriages[message.author.id] = target.id;
          data.marriages[target.id] = message.author.id;
          await saveGuildData(message.guildId, data);
          const embed2 = new EmbedBuilder()
            .setTitle("💒 Married!")
            .setDescription(`🎉 **${message.author.username}** and **${target.username}** are now married!\n\n💕 Congratulations!`)
            .setColor(0xFF73FA)
            .setFooter({ text: "Chopsticks !marry" });
          return msg.edit({ embeds: [embed2], components: [] });
        } else {
          const embed2 = new EmbedBuilder()
            .setTitle("💔 Proposal Declined")
            .setDescription(`**${target.username}** declined the proposal. Better luck next time!`)
            .setColor(0xED4245);
          return msg.edit({ embeds: [embed2], components: [] });
        }
      } catch {
        return msg.edit({ content: "💍 Proposal timed out.", embeds: [], components: [] });
      }
    },
  },

  // ── divorce ─────────────────────────────────────────────────────────────────
  {
    name: "divorce",
    aliases: ["unmarry", "splitup"],
    description: "End your marriage — !divorce",
    guildOnly: true,
    rateLimit: 10000,
    async execute(message) {
      const { loadGuildData, saveGuildData } = await import("../../utils/storage.js");
      const data = await loadGuildData(message.guildId);
      data.marriages ??= {};
      const spouseId = data.marriages[message.author.id];
      if (!spouseId) return message.reply("💔 You're not married.");
      const spouse = await message.client.users.fetch(spouseId).catch(() => null);
      delete data.marriages[message.author.id];
      delete data.marriages[spouseId];
      await saveGuildData(message.guildId, data);
      const embed = new EmbedBuilder()
        .setTitle("💔 Divorced")
        .setDescription(`**${message.author.username}** and **${spouse?.username ?? "their spouse"}** are now divorced.`)
        .setColor(0xED4245)
        .setFooter({ text: "Chopsticks !divorce" });
      return message.reply({ embeds: [embed] });
    },
  },

  // ── spouse ──────────────────────────────────────────────────────────────────
  {
    name: "spouse",
    aliases: ["married", "partner"],
    description: "See who you're married to — !spouse",
    guildOnly: true,
    rateLimit: 3000,
    async execute(message) {
      const { loadGuildData } = await import("../../utils/storage.js");
      const target = message.mentions.users.first() || message.author;
      const data = await loadGuildData(message.guildId);
      data.marriages ??= {};
      const spouseId = data.marriages[target.id];
      if (!spouseId) return message.reply(`💔 **${target.username}** is not married.`);
      const spouse = await message.client.users.fetch(spouseId).catch(() => null);
      const embed = new EmbedBuilder()
        .setTitle("💍 Married")
        .setDescription(`**${target.username}** is married to **${spouse?.username ?? "unknown"}**!`)
        .setColor(0xFF73FA)
        .setFooter({ text: "Chopsticks !spouse" });
      return message.reply({ embeds: [embed] });
    },
  },

  // ── rep ─────────────────────────────────────────────────────────────────────
  {
    name: "rep",
    aliases: ["reputation", "+rep"],
    description: "Give reputation to someone — !rep @user",
    guildOnly: true,
    rateLimit: 3000,
    async execute(message) {
      const { loadGuildData, saveGuildData } = await import("../../utils/storage.js");
      const target = message.mentions.users.first();
      if (!target) return message.reply("⭐ Mention someone to give rep: `!rep @user`");
      if (target.id === message.author.id) return message.reply("⭐ You can't rep yourself!");
      if (target.bot) return message.reply("🤖 Bots don't need rep.");

      const data = await loadGuildData(message.guildId);
      data.rep ??= {};
      data.repGiven ??= {};

      const lastGiven = data.repGiven[message.author.id] ?? 0;
      const hoursSince = (Date.now() - lastGiven) / 3_600_000;
      if (hoursSince < 24) {
        const hoursLeft = Math.ceil(24 - hoursSince);
        return message.reply(`⭐ You've already given rep today. Try again in **${hoursLeft}h**.`);
      }

      data.rep[target.id] = (data.rep[target.id] ?? 0) + 1;
      data.repGiven[message.author.id] = Date.now();
      await saveGuildData(message.guildId, data);

      const embed = new EmbedBuilder()
        .setTitle("⭐ Rep Given!")
        .setDescription(`**${message.author.username}** gave **+1 rep** to **${target.username}**!\n⭐ They now have **${data.rep[target.id]}** rep.`)
        .setThumbnail(target.displayAvatarURL())
        .setColor(0xF0B232)
        .setFooter({ text: "Rep resets every 24h • Chopsticks !rep" });
      return message.reply({ embeds: [embed] });
    },
  },

  // ── checkrep ────────────────────────────────────────────────────────────────
  {
    name: "checkrep",
    aliases: ["getrep", "myreq"],
    description: "Check someone's rep score — !checkrep [@user]",
    guildOnly: true,
    rateLimit: 3000,
    async execute(message) {
      const { loadGuildData } = await import("../../utils/storage.js");
      const target = message.mentions.users.first() || message.author;
      const data = await loadGuildData(message.guildId);
      data.rep ??= {};
      const rep = data.rep[target.id] ?? 0;
      const embed = new EmbedBuilder()
        .setTitle("⭐ Reputation")
        .setDescription(`**${target.username}** has **${rep}** rep.`)
        .setThumbnail(target.displayAvatarURL())
        .setColor(0xF0B232)
        .setFooter({ text: "Chopsticks !rep @user to give rep" });
      return message.reply({ embeds: [embed] });
    },
  },

  // ── bio ──────────────────────────────────────────────────────────────────────
  {
    name: "bio",
    aliases: ["setbio", "about"],
    description: "Set or view your bio — !bio [text] or !bio @user",
    guildOnly: true,
    rateLimit: 3000,
    async execute(message, args) {
      const { loadGuildData, saveGuildData } = await import("../../utils/storage.js");
      const mentionTarget = message.mentions.users.first();
      // View mode: !bio @user or !bio with no args
      if (mentionTarget || args.length === 0) {
        const target = mentionTarget || message.author;
        const data = await loadGuildData(message.guildId);
        data.bios ??= {};
        const bio = data.bios[target.id] || "_No bio set. Use `!bio <text>` to set yours._";
        const embed = new EmbedBuilder()
          .setTitle(`📝 ${target.username}'s Bio`)
          .setDescription(bio)
          .setThumbnail(target.displayAvatarURL())
          .setColor(0x5865F2)
          .setFooter({ text: "Chopsticks !bio <text> to set yours" });
        return message.reply({ embeds: [embed] });
      }
      // Set mode
      const bio = args.join(" ").slice(0, 300);
      const data = await loadGuildData(message.guildId);
      data.bios ??= {};
      data.bios[message.author.id] = bio;
      await saveGuildData(message.guildId, data);
      return message.reply(`✅ Bio updated! (${bio.length}/300 chars)`);
    },
  },

  // ── socialprofile ────────────────────────────────────────────────────────────
  {
    name: "socialprofile",
    aliases: ["sp", "card"],
    description: "View your social profile card — !socialprofile [@user]",
    guildOnly: true,
    rateLimit: 4000,
    async execute(message) {
      const { loadGuildData } = await import("../../utils/storage.js");
      const target = message.mentions.users.first() || message.author;
      const data = await loadGuildData(message.guildId);
      data.rep ??= {};
      data.bios ??= {};
      data.marriages ??= {};
      const rep = data.rep[target.id] ?? 0;
      const bio = data.bios[target.id] || "No bio set.";
      const spouseId = data.marriages[target.id];
      const spouse = spouseId ? await message.client.users.fetch(spouseId).catch(() => null) : null;
      const embed = new EmbedBuilder()
        .setTitle(`👤 ${target.username}`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: "📝 Bio",        value: bio.slice(0, 300),                  inline: false },
          { name: "⭐ Rep",         value: String(rep),                        inline: true  },
          { name: "💍 Married To", value: spouse?.username ?? "Single",       inline: true  },
        )
        .setColor(0x5865F2)
        .setFooter({ text: "Chopsticks !bio | !rep | !marry" });
      return message.reply({ embeds: [embed] });
    },
  },
];
