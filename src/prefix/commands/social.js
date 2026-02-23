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
];
