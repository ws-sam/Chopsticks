import { SlashCommandBuilder } from "discord.js";
import { fetch } from "undici";
import { cacheGet, cacheSet } from "../utils/cache.js";

export const meta = {
  guildOnly: false,
  userPerms: [],
  category: "tools"
};

export const data = new SlashCommandBuilder()
  .setName("convert")
  .setDescription("Convert units or currencies")
  .addSubcommand(sub =>
    sub
      .setName("unit")
      .setDescription("Convert between units of measurement")
      .addNumberOption(o => o.setName("value").setDescription("Value to convert").setRequired(true))
      .addStringOption(o => o.setName("from").setDescription("Source unit (e.g. km, lb, c)").setRequired(true))
      .addStringOption(o => o.setName("to").setDescription("Target unit (e.g. m, kg, f)").setRequired(true))
  )
  .addSubcommand(sub =>
    sub
      .setName("currency")
      .setDescription("Convert between currencies")
      .addNumberOption(o => o.setName("amount").setDescription("Amount to convert").setRequired(true))
      .addStringOption(o => o.setName("from").setDescription("Source currency (e.g. USD)").setRequired(true))
      .addStringOption(o => o.setName("to").setDescription("Target currency (e.g. EUR)").setRequired(true))
  );

// ---- Unit conversion tables ----
// All units convert to/from a base unit via: toBase(value) and fromBase(value)

const LENGTH_BASE = "m";
const LENGTH = {
  mm: { toBase: v => v / 1000, fromBase: v => v * 1000 },
  cm: { toBase: v => v / 100, fromBase: v => v * 100 },
  m:  { toBase: v => v,       fromBase: v => v },
  km: { toBase: v => v * 1000, fromBase: v => v / 1000 },
  in: { toBase: v => v * 0.0254, fromBase: v => v / 0.0254 },
  ft: { toBase: v => v * 0.3048, fromBase: v => v / 0.3048 },
  yd: { toBase: v => v * 0.9144, fromBase: v => v / 0.9144 },
  mi: { toBase: v => v * 1609.344, fromBase: v => v / 1609.344 }
};

const WEIGHT_BASE = "g";
const WEIGHT = {
  mg: { toBase: v => v / 1000, fromBase: v => v * 1000 },
  g:  { toBase: v => v,        fromBase: v => v },
  kg: { toBase: v => v * 1000, fromBase: v => v / 1000 },
  lb: { toBase: v => v * 453.59237, fromBase: v => v / 453.59237 },
  oz: { toBase: v => v * 28.349523125, fromBase: v => v / 28.349523125 }
};

const SPEED_BASE = "ms";
const SPEED = {
  mph: { toBase: v => v * 0.44704, fromBase: v => v / 0.44704 },
  kph: { toBase: v => v / 3.6,    fromBase: v => v * 3.6 },
  ms:  { toBase: v => v,           fromBase: v => v }
};

const VOLUME_BASE = "ml";
const VOLUME = {
  ml:     { toBase: v => v,           fromBase: v => v },
  l:      { toBase: v => v * 1000,    fromBase: v => v / 1000 },
  fl_oz:  { toBase: v => v * 29.5735, fromBase: v => v / 29.5735 },
  cup:    { toBase: v => v * 236.588, fromBase: v => v / 236.588 },
  gal:    { toBase: v => v * 3785.41, fromBase: v => v / 3785.41 }
};

const UNIT_GROUPS = [LENGTH, WEIGHT, SPEED, VOLUME];

function convertUnit(value, from, to) {
  const f = from.toLowerCase();
  const t = to.toLowerCase();

  // Temperature handled separately (non-linear)
  if (["c", "f", "k"].includes(f) || ["c", "f", "k"].includes(t)) {
    return convertTemp(value, f, t);
  }

  for (const group of UNIT_GROUPS) {
    if (group[f] && group[t]) {
      return group[t].fromBase(group[f].toBase(value));
    }
  }
  return null;
}

function convertTemp(value, from, to) {
  if (from === to) return value;
  // Convert to Celsius first
  let c;
  if (from === "c") c = value;
  else if (from === "f") c = (value - 32) * 5 / 9;
  else if (from === "k") c = value - 273.15;
  else return null;

  if (to === "c") return c;
  if (to === "f") return c * 9 / 5 + 32;
  if (to === "k") return c + 273.15;
  return null;
}

const CURRENCY_CACHE_TTL = 300; // 5 minutes

async function getCurrencyRate(from, to) {
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();
  const cacheKey = `fx:${fromUpper}`;

  let rates = await cacheGet(cacheKey);
  if (!rates) {
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${fromUpper}`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) return null;
      const json = await res.json();
      if (json.result !== "success" || !json.rates) return null;
      rates = json.rates;
      await cacheSet(cacheKey, rates, CURRENCY_CACHE_TTL);
    } catch {
      return null;
    }
  }

  return rates[toUpper] ?? null;
}

function formatNumber(n) {
  if (!Number.isFinite(n)) return String(n);
  // Show up to 6 significant figures
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs >= 0.001 && abs < 1e9) {
    const str = parseFloat(n.toPrecision(6)).toString();
    return str;
  }
  return n.toExponential(4);
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "unit") {
    const value = interaction.options.getNumber("value", true);
    const from = interaction.options.getString("from", true);
    const to = interaction.options.getString("to", true);

    const result = convertUnit(value, from, to);
    if (result === null) {
      await interaction.reply({
        content: "❌ Unknown unit or conversion not supported.",
        flags: 64
      });
      return;
    }

    await interaction.reply({
      content: `📐 ${formatNumber(value)} **${from}** = **${formatNumber(result)} ${to}**`
    });
  } else if (sub === "currency") {
    const amount = interaction.options.getNumber("amount", true);
    const from = interaction.options.getString("from", true).toUpperCase();
    const to = interaction.options.getString("to", true).toUpperCase();

    const rate = await getCurrencyRate(from, to);
    if (rate === null) {
      await interaction.reply({
        content: "❌ Unknown currency or conversion not supported.",
        flags: 64
      });
      return;
    }

    const result = amount * rate;
    await interaction.reply({
      content: `📐 ${formatNumber(amount)} **${from}** = **${formatNumber(result)} ${to}**`
    });
  }
}

export { convertUnit };
