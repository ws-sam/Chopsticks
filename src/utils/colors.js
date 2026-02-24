/**
 * src/utils/colors.js
 * Canonical color palette — Phase G Cycle U2
 *
 * Usage:
 *   import COLORS from "../utils/colors.js";
 *   embed.setColor(COLORS.SUCCESS);
 */

const COLORS = Object.freeze({
  /** ✅ Positive outcome, level-up, success */
  SUCCESS:  0x57F287,
  /** ❌ Error, fail, rejection */
  ERROR:    0xED4245,
  /** ⚠️ Warning, caution */
  WARNING:  0xFEE75C,
  /** ℹ️ Info, help, neutral information */
  INFO:     0x5865F2,
  /** 💰 Economy — balance, credits, shop */
  ECONOMY:  0xF0B232,
  /** ⭐ XP, levels, game progression */
  XP:       0x7289DA,
  /** 🎉 Fun commands — games, jokes, reactions */
  FUN:      0xFF73FA,
  /** 🔨 Moderation actions */
  MOD:      0xEB459E,
  /** 📊 Neutral embed — statistics, info */
  NEUTRAL:  0x2F3136,
  /** 🎮 Minigames — fishing, mining, hunt */
  GAME:     0x00CED1,
  /** 🌿 Nature, animals */
  NATURE:   0x3CB371,
  /** 📚 Knowledge, definitions, data */
  KNOWLEDGE: 0x9B59B6,
});

export default COLORS;

/**
 * Stamp an embed with the current timestamp and a consistent footer.
 * Call as: stamp(embed) — returns the embed for chaining.
 */
export function stamp(embed, footerText = "Chopsticks") {
  return embed.setTimestamp().setFooter({ text: footerText });
}
