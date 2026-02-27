// src/prefix/commands/minigames.js
// Cycle G4 — Fishing + Mining mini-games (prefix-exclusive)
// All game state is local-session (cooldown enforced). Rewards via wallet + XP.

import { EmbedBuilder, Colors } from "discord.js";
import { addCredits } from "../../economy/wallet.js";
import { addGameXp } from "../../game/profile.js";
import { recordQuestEvent } from "../../game/quests.js";
import { eventBus, Events } from "../../utils/eventBus.js";
import COLORS from "../../utils/colors.js";

const FISH_COOLDOWN_MS = 45_000;  // 45 seconds
const MINE_COOLDOWN_MS = 60_000;  // 60 seconds
const fishCooldowns = new Map(); // userId → timestamp
const mineCooldowns = new Map();

// Auto-purge cooldown entries after 24h to prevent memory leaks
const MAP_TTL_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of fishCooldowns) if (now - ts > MAP_TTL_MS) fishCooldowns.delete(k);
  for (const [k, ts] of mineCooldowns) if (now - ts > MAP_TTL_MS) mineCooldowns.delete(k);
}, MAP_TTL_MS).unref?.();

function cooldownRemaining(map, userId, ms) {
  const last = map.get(userId) || 0;
  const rem = ms - (Date.now() - last);
  return rem > 0 ? Math.ceil(rem / 1000) : 0;
}

// ── Fishing tables ─────────────────────────────────────────────────────────────
const FISH = [
  { name: "🐟 Common Fish",    emoji: "🐟", weight: 40, credits: [15, 35],  xp: 10, rarity: "Common"    },
  { name: "🐠 Tropical Fish",  emoji: "🐠", weight: 25, credits: [35, 65],  xp: 20, rarity: "Uncommon"  },
  { name: "🐡 Pufferfish",     emoji: "🐡", weight: 15, credits: [50, 90],  xp: 30, rarity: "Rare"      },
  { name: "🦈 Baby Shark",     emoji: "🦈", weight: 8,  credits: [80, 150], xp: 50, rarity: "Epic"      },
  { name: "🐙 Octopus",        emoji: "🐙", weight: 7,  credits: [70, 130], xp: 45, rarity: "Epic"      },
  { name: "🦑 Giant Squid",    emoji: "🦑", weight: 3,  credits: [150, 300],xp: 100,rarity: "Legendary" },
  { name: "🐉 Sea Dragon",     emoji: "🐉", weight: 2,  credits: [250, 500],xp: 200,rarity: "Mythic"    },
  // Junk (no credits)
  { name: "🥾 Old Boot",       emoji: "🥾", weight: 15, credits: [0, 0],    xp: 2,  rarity: "Junk"      },
  { name: "🗑️ Trash",          emoji: "🗑️", weight: 10, credits: [0, 5],    xp: 3,  rarity: "Junk"      },
];

// ── Mining tables ──────────────────────────────────────────────────────────────
const ORES = [
  { name: "🪨 Stone",          emoji: "🪨", weight: 35, credits: [5, 15],   xp: 5,  rarity: "Common"    },
  { name: "🔩 Iron Ore",       emoji: "🔩", weight: 25, credits: [20, 40],  xp: 15, rarity: "Uncommon"  },
  { name: "🥈 Silver Ore",     emoji: "🥈", weight: 15, credits: [40, 80],  xp: 25, rarity: "Rare"      },
  { name: "🥇 Gold Ore",       emoji: "🥇", weight: 10, credits: [70, 140], xp: 40, rarity: "Epic"      },
  { name: "💎 Diamond",        emoji: "💎", weight: 6,  credits: [150, 300],xp: 80, rarity: "Legendary" },
  { name: "🔮 Enchanted Crystal",emoji:"🔮",weight: 4, credits: [250, 450],xp: 130,rarity: "Legendary" },
  { name: "⭐ Star Fragment",   emoji: "⭐", weight: 2,  credits: [400, 750],xp: 200,rarity: "Mythic"    },
  { name: "🪨 Nothing",         emoji: "🪨", weight: 10, credits: [0, 0],    xp: 2,  rarity: "Empty"     },
  { name: "💣 Dynamite Dud",   emoji: "💣", weight: 5,  credits: [0, 0],    xp: 1,  rarity: "Hazard"    },
];

const RARITY_COLORS = {
  Common: 0x99AAB5, Uncommon: 0x57F287, Rare: 0x5865F2,
  Epic: 0x9B59B6, Legendary: 0xF0B232, Mythic: 0xED4245,
  Junk: 0x808080, Empty: 0x606060, Hazard: 0xFF6B35,
};

function weightedRandom(table) {
  const total = table.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const item of table) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return table[0];
}

function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const FISH_INTROS = [
  "🎣 You cast your line into the water...",
  "🎣 You find a quiet spot and drop your hook...",
  "🎣 The water ripples as your bait hits the surface...",
  "🎣 You settle in and wait patiently...",
];
const MINE_INTROS = [
  "⛏️ You swing your pickaxe at the rock face...",
  "⛏️ You dig deep into the earth...",
  "⛏️ You blast through a boulder...",
  "⛏️ You follow a promising vein of ore...",
];

const FISH_WAIT_LINES = [
  "A tug on the line! 🎣", "Something's biting! 🐠", "The float bobs wildly! 🌊",
];
const MINE_WAIT_LINES = [
  "You hear a crack! ⛏️", "Something shimmers in the dark! 💫", "Your pickaxe rings off metal! 🔔",
];

export default [
  {
    name: "fish",
    aliases: ["fishing", "cast"],
    description: "Go fishing — !fish",
    guildOnly: true,
    rateLimit: 1000,
    async execute(message) {
      const wait = cooldownRemaining(fishCooldowns, message.author.id, FISH_COOLDOWN_MS);
      if (wait) {
        return message.reply(`🎣 Your rod is still cooling down! Try again in **${wait}s**.`);
      }
      fishCooldowns.set(message.author.id, Date.now());

      const item = weightedRandom(FISH);
      const isJunk = item.rarity === "Junk";
      const credits = randBetween(item.credits[0], item.credits[1]);
      const intro = FISH_INTROS[Math.floor(Math.random() * FISH_INTROS.length)];
      const hook = FISH_WAIT_LINES[Math.floor(Math.random() * FISH_WAIT_LINES.length)];

      // Award credits and XP
      if (credits > 0) {
        await addCredits(message.author.id, credits, "fishing").catch(() => {});
      }
      const xpResult = await addGameXp(message.author.id, item.xp, { reason: "fishing" }).catch(() => null);
      eventBus.fire(Events.FISH_CAUGHT, { userId: message.author.id, guildId: message.guildId, item: item.id, rarity: item.rarity });
      await recordQuestEvent(message.author.id, "fish_caught", 1).catch(() => {});

      const embed = new EmbedBuilder()
        .setTitle(isJunk ? `😅 ${item.name}` : `🎉 You caught a ${item.name}!`)
        .setDescription([
          `*${intro}*`,
          `*${hook}*`,
          "",
          isJunk
            ? `You fished up **${item.name}**. Better luck next time!`
            : `**${item.emoji} ${item.name}** — ${item.rarity}`,
          "",
          credits > 0 ? `💰 +**${credits}** credits` : `No credits — it's junk!`,
          `✨ +**${item.xp}** XP`,
          xpResult?.leveledUp ? `\n🎉 **LEVEL UP!** You're now level **${xpResult.toLevel}**!` : "",
        ].join("\n").trim())
        .setColor(RARITY_COLORS[item.rarity] || 0x5865F2)
        .setFooter({ text: `Cooldown: 45s • Chopsticks !fish` });
      await message.reply({ embeds: [embed] });
    }
  },

  {
    name: "mine",
    aliases: ["mining", "dig"],
    description: "Mine for ore and gems — !mine",
    guildOnly: true,
    rateLimit: 1000,
    async execute(message) {
      const wait = cooldownRemaining(mineCooldowns, message.author.id, MINE_COOLDOWN_MS);
      if (wait) {
        return message.reply(`⛏️ Your pickaxe is recovering! Try again in **${wait}s**.`);
      }
      mineCooldowns.set(message.author.id, Date.now());

      const item = weightedRandom(ORES);
      const isEmpty = item.rarity === "Empty" || item.rarity === "Hazard";
      const credits = randBetween(item.credits[0], item.credits[1]);
      const intro = MINE_INTROS[Math.floor(Math.random() * MINE_INTROS.length)];
      const hook = MINE_WAIT_LINES[Math.floor(Math.random() * MINE_WAIT_LINES.length)];

      if (credits > 0) {
        await addCredits(message.author.id, credits, "mining").catch(() => {});
      }
      const xpResult = await addGameXp(message.author.id, item.xp, { reason: "mining" }).catch(() => null);
      eventBus.fire(Events.ORE_MINED, { userId: message.author.id, guildId: message.guildId, ore: item.id, rarity: item.rarity });
      await recordQuestEvent(message.author.id, "ore_mined", 1).catch(() => {});

      const isHazard = item.rarity === "Hazard";
      const embed = new EmbedBuilder()
        .setTitle(isEmpty
          ? (isHazard ? `💣 Dud! Nothing useful.` : `🪨 Just dirt and rubble.`)
          : `⛏️ You found **${item.name}**!`)
        .setDescription([
          `*${intro}*`,
          `*${hook}*`,
          "",
          isEmpty
            ? (isHazard ? "A dud dynamite! Thankfully it didn't blow." : "Nothing valuable here. Keep digging!")
            : `**${item.emoji} ${item.name}** — ${item.rarity}`,
          "",
          credits > 0 ? `💰 +**${credits}** credits` : "No credits this time.",
          `✨ +**${item.xp}** XP`,
          xpResult?.leveledUp ? `\n🎉 **LEVEL UP!** You're now level **${xpResult.toLevel}**!` : "",
        ].join("\n").trim())
        .setColor(RARITY_COLORS[item.rarity] || 0x5865F2)
        .setFooter({ text: `Cooldown: 60s • Chopsticks !mine` });
      await message.reply({ embeds: [embed] });
    }
  },

  {
    name: "hunt",
    aliases: ["forage", "scavenge"],
    description: "Hunt for bounties — !hunt",
    guildOnly: true,
    rateLimit: 1000,
    async execute(message) {
      const HUNT_COOLDOWN_MS = 90_000;
      const key = `hunt:${message.author.id}`;
      // Use fish cooldowns map with a prefixed key
      const wait = cooldownRemaining(fishCooldowns, key, HUNT_COOLDOWN_MS);
      if (wait) {
        return message.reply(`🏹 You're still tired from the last hunt! Wait **${wait}s**.`);
      }
      fishCooldowns.set(key, Date.now());

      const PREY = [
        { name: "🐇 Rabbit",     w: 35, credits: [20, 50],  xp: 15 },
        { name: "🦌 Deer",       w: 25, credits: [50, 100], xp: 30 },
        { name: "🐗 Wild Boar",  w: 15, credits: [80, 160], xp: 50 },
        { name: "🦁 Lion",       w: 8,  credits: [150, 300],xp: 100 },
        { name: "🐉 Dragon",     w: 2,  credits: [500, 1000],xp:250 },
        { name: "🌿 Nothing",    w: 15, credits: [0, 0],    xp: 5  },
      ];
      const prey = weightedRandom(PREY);
      const credits = randBetween(prey.credits[0], prey.credits[1]);
      const xpResult = await addGameXp(message.author.id, prey.xp, { reason: "hunting" }).catch(() => null);
      if (credits > 0) await addCredits(message.author.id, credits, "hunting").catch(() => {});

      const embed = new EmbedBuilder()
        .setTitle(credits > 0 ? `🏹 Successful Hunt!` : `🌿 Nothing out there today.`)
        .setDescription([
          credits > 0 ? `You hunted a **${prey.name}**!` : `You searched but found nothing.`,
          "",
          credits > 0 ? `💰 +**${credits}** credits` : "Empty-handed this time.",
          `✨ +**${prey.xp}** XP`,
          xpResult?.leveledUp ? `\n🎉 **LEVEL UP!** You're now level **${xpResult.toLevel}**!` : "",
        ].join("\n").trim())
        .setColor(credits > 0 ? 0x57F287 : 0x99AAB5)
        .setFooter({ text: "Cooldown: 90s • Chopsticks !hunt" });
      await message.reply({ embeds: [embed] });
    }
  },

  // ── guess (higher/lower) ──────────────────────────────────────────────────
  {
    name: "guess",
    aliases: ["highlow", "number"],
    description: "Guess a number 1–100 — !guess",
    rateLimit: 3000,
    async execute(message) {
      const secret = Math.floor(Math.random() * 100) + 1;
      let attempts = 0;
      const MAX_ATTEMPTS = 7;
      const { EmbedBuilder } = await import("discord.js");
      const mkEmbed = (desc, color = 0x5865F2) => new EmbedBuilder().setTitle("🎲 Guess the Number").setDescription(desc).setColor(color).setFooter({ text: "Type a number between 1-100!" });
      const msg = await message.reply({ embeds: [mkEmbed(`I'm thinking of a number between **1 and 100**.\nYou have **${MAX_ATTEMPTS}** guesses!`)] });
      const filter = m => m.author.id === message.author.id && /^\d+$/.test(m.content.trim());
      const coll = message.channel.createMessageCollector({ filter, time: 60_000, max: MAX_ATTEMPTS });
      coll.on("collect", async m => {
        attempts++;
        const guess = parseInt(m.content.trim());
        if (guess === secret) { coll.stop("win"); return msg.edit({ embeds: [mkEmbed(`🎉 Correct! The number was **${secret}** — guessed in **${attempts}** attempt${attempts !== 1 ? "s" : ""}!`, 0x57F287)] }); }
        if (attempts >= MAX_ATTEMPTS) { coll.stop(); return msg.edit({ embeds: [mkEmbed(`😢 Out of guesses! The number was **${secret}**.`, 0xED4245)] }); }
        const hint = guess < secret ? "📈 Too low!" : "📉 Too high!";
        await msg.edit({ embeds: [mkEmbed(`${hint} Guesses left: **${MAX_ATTEMPTS - attempts}**`, 0xFEE75C)] });
      });
      coll.on("end", (_, r) => { if (r !== "win" && r !== "max") msg.edit({ embeds: [new EmbedBuilder().setTitle("😢 Time's up!").setDescription(`The number was **${secret}**.`).setColor(0xED4245)] }).catch(() => {}); });
    },
  },

  // ── blackjack ─────────────────────────────────────────────────────────────
  {
    name: "blackjack",
    aliases: ["bj", "21"],
    description: "Blackjack for credits — !blackjack [bet]",
    guildOnly: true,
    rateLimit: 5000,
    async execute(message, args) {
      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");
      const { getWallet, removeCredits, addCredits } = await import("../../economy/wallet.js");
      const bet = Math.max(10, Math.min(1000, parseInt(args[0]) || 50));
      const wallet = await getWallet(message.author.id).catch(() => ({ balance: 0 }));
      if ((wallet.balance ?? 0) < bet) return message.reply(`💸 You need **${bet}** credits (have **${wallet.balance ?? 0}**).`);
      await removeCredits(message.author.id, bet, "blackjack_bet").catch(() => {});
      const suits = ["♠","♥","♦","♣"], vals = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
      const deck = suits.flatMap(s => vals.map(v => `${v}${s}`)).sort(() => Math.random() - 0.5);
      let i = 0; const draw = () => deck[i++];
      function hv(hand) { let v = 0, a = 0; for (const c of hand) { const f = c.slice(0,-1); if (f==="A"){v+=11;a++;}else if(["J","Q","K"].includes(f))v+=10;else v+=+f; } while(v>21&&a>0){v-=10;a--;} return v; }
      let player = [draw(),draw()], dealer = [draw(),draw()];
      const emb = (showD=false, res=null) => new EmbedBuilder().setTitle("🃏 Blackjack").setColor(res==="win"?0x57F287:res==="lose"?0xED4245:res==="push"?0xFEE75C:0x5865F2)
        .addFields({name:`Your Hand (${hv(player)})`,value:player.join(" "),inline:true},{name:`Dealer (${showD?hv(dealer):"?"})`,value:showD?dealer.join(" "):`${dealer[0]} ??`,inline:true})
        .setDescription(res==="win"?`🎉 You win **${bet*2}** credits!`:res==="lose"?`😢 Lost **${bet}** credits.`:res==="push"?`🤝 Push! Bet returned.`:res==="bj"?`🃏 **BLACKJACK!** +**${Math.floor(bet*2.5)}** credits!`:`Bet: **${bet}** credits`)
        .setFooter({text:"Chopsticks !blackjack"});
      const btns = () => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("bj:hit").setLabel("Hit").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId("bj:stand").setLabel("Stand").setStyle(ButtonStyle.Danger));
      if (hv(player)===21) { await addCredits(message.author.id,Math.floor(bet*2.5),"blackjack_bj").catch(()=>{}); return message.reply({embeds:[emb(true,"bj")]}); }
      const msg = await message.reply({embeds:[emb()],components:[btns()]});
      const coll = msg.createMessageComponentCollector({filter:x=>x.user.id===message.author.id,time:60_000});
      coll.on("collect", async x => {
        await x.deferUpdate().catch(()=>{});
        if (x.customId==="bj:hit") { player.push(draw()); const v=hv(player); if(v>21){coll.stop();return msg.edit({embeds:[emb(true,"lose")],components:[]});} if(v===21)coll.stop("stand"); else msg.edit({embeds:[emb()],components:[btns()]}); }
        if (x.customId==="bj:stand") coll.stop("stand");
      });
      coll.on("end", async(_,r) => {
        if(r!=="stand")return;
        let dv=hv(dealer); while(dv<17){dealer.push(draw());dv=hv(dealer);}
        const pv=hv(player); let res,pay=0;
        if(dv>21||pv>dv){res="win";pay=bet*2;}else if(pv===dv){res="push";pay=bet;}else res="lose";
        if(pay>0)await addCredits(message.author.id,pay,`bj_${res}`).catch(()=>{});
        await msg.edit({embeds:[emb(true,res)],components:[]});
      });
    },
  },

  // ── hangman ───────────────────────────────────────────────────────────────
  {
    name: "hangman",
    aliases: ["hm"],
    description: "Play hangman — !hangman",
    rateLimit: 5000,
    async execute(message) {
      const { EmbedBuilder } = await import("discord.js");
      const WORDS = ["javascript","discord","chopsticks","gaming","music","developer","server","channel","economy","community","minecraft","streaming","playlist","leaderboard","tournament"];
      const word = WORDS[Math.floor(Math.random()*WORDS.length)];
      const MAX_WRONG = 7;
      let guessed = new Set(), wrong = 0;
      const STAGE = ["  ___\n |   |\n |\n |\n |\n |_____","  ___\n |   |\n |   O\n |\n |\n |_____","  ___\n |   |\n |   O\n |   |\n |\n |_____","  ___\n |   |\n |   O\n |  /|\n |\n |_____","  ___\n |   |\n |   O\n |  /|\\\n |\n |_____","  ___\n |   |\n |   O\n |  /|\\\n |  /\n |_____","  ___\n |   |\n |   O\n |  /|\\\n |  / \\\n |_____"];
      const disp = () => {
        const letters = word.split("").map(l=>guessed.has(l)?l:"_").join(" ");
        const wr = [...guessed].filter(l=>!word.includes(l));
        return new EmbedBuilder().setTitle("🎮 Hangman")
          .setDescription(`\`\`\`\n${STAGE[Math.min(wrong,6)]}\n\`\`\`\n**Word:** \`${letters}\`\n**Wrong:** ${wr.length?wr.join(", "):"none"}\n**Lives:** ${"❤️".repeat(MAX_WRONG-wrong)}${"🖤".repeat(wrong)}`)
          .setColor(wrong>=MAX_WRONG?0xED4245:wrong>=4?0xFEE75C:0x57F287).setFooter({text:"Type a letter or the whole word!"});
      };
      const msg = await message.reply({embeds:[disp()]});
      const coll = message.channel.createMessageCollector({filter:m=>m.author.id===message.author.id&&/^[a-zA-Z]+$/.test(m.content.trim()),time:120_000});
      coll.on("collect", async m => {
        const g = m.content.trim().toLowerCase();
        if(g.length>1){if(g===word)return coll.stop("win");wrong++;if(wrong>=MAX_WRONG)return coll.stop("lose");}
        else{if(guessed.has(g))return;guessed.add(g);if(!word.includes(g))wrong++;}
        if(word.split("").every(l=>guessed.has(l)))return coll.stop("win");
        if(wrong>=MAX_WRONG)return coll.stop("lose");
        await msg.edit({embeds:[disp()]});
      });
      coll.on("end", async(_,r) => {
        if(r==="win") await msg.edit({embeds:[new EmbedBuilder().setTitle("🎉 You Win!").setDescription(`The word was **${word}**!`).setColor(0x57F287)]});
        else await msg.edit({embeds:[new EmbedBuilder().setTitle("💀 Game Over").setDescription(`The word was **${word}**.`).setColor(0xED4245)]});
      });
    },
  },
];
