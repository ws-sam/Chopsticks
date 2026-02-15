import { getPool } from "../utils/storage_pg.js";

// Rarity drop rates (must sum to 100)
const RARITY_WEIGHTS = {
  common: 60,
  rare: 25,
  epic: 10,
  legendary: 4,
  mythic: 1
};

// Gathering loot tables
const LOOT_TABLES = {
  common: [
    { id: "data_fragment", weight: 50 },
    { id: "neural_chip", weight: 30 },
    { id: "corrupted_file", weight: 20 }
  ],
  rare: [
    { id: "corrupted_file", weight: 40 },
    { id: "neural_chip", weight: 35 },
    { id: "encryption_key", weight: 25 }
  ],
  epic: [
    { id: "encryption_key", weight: 50 },
    { id: "hologram_badge", weight: 30 },
    { id: "quantum_core", weight: 20 }
  ],
  legendary: [
    { id: "quantum_core", weight: 60 },
    { id: "ancient_code", weight: 40 }
  ],
  mythic: [
    { id: "singularity_shard", weight: 100 }
  ]
};

// Zone focus tables. These do NOT remove rarities; they bias which items you roll within a rarity tier.
const ZONE_ALIASES = {
  any: "any",
  // legacy option values kept for compatibility
  characters: "loot",
  monsters: "misc",
  loot: "loot",
  food: "food",
  skills: "skills",
  misc: "misc"
};

const ZONE_TABLES = {
  any: LOOT_TABLES,
  loot: {
    common: [
      { id: "data_fragment", weight: 55 },
      { id: "neural_chip", weight: 25 },
      { id: "corrupted_file", weight: 20 }
    ],
    rare: [
      { id: "corrupted_file", weight: 35 },
      { id: "neural_chip", weight: 35 },
      { id: "encryption_key", weight: 20 },
      { id: "hologram_badge", weight: 10 }
    ],
    epic: [
      { id: "encryption_key", weight: 45 },
      { id: "hologram_badge", weight: 35 },
      { id: "xp_booster", weight: 20 }
    ],
    legendary: [
      { id: "quantum_core", weight: 55 },
      { id: "ancient_code", weight: 45 }
    ],
    mythic: [
      { id: "singularity_shard", weight: 100 }
    ]
  },
  food: {
    common: [
      { id: "energy_drink", weight: 55 },
      { id: "companion_treat", weight: 45 }
    ],
    rare: [
      { id: "luck_charm", weight: 100 }
    ],
    epic: [
      { id: "xp_booster", weight: 100 }
    ],
    legendary: [
      { id: "master_key", weight: 100 }
    ],
    mythic: [
      { id: "master_key", weight: 100 }
    ]
  },
  skills: {
    common: [
      { id: "basic_scanner", weight: 50 },
      { id: "basic_net", weight: 50 }
    ],
    rare: [
      { id: "advanced_scanner", weight: 80 },
      { id: "luck_charm", weight: 20 }
    ],
    epic: [
      { id: "reinforced_net", weight: 70 },
      { id: "xp_booster", weight: 30 }
    ],
    legendary: [
      { id: "quantum_scanner", weight: 100 }
    ],
    mythic: [
      { id: "quantum_scanner", weight: 100 }
    ]
  },
  misc: {
    common: [
      { id: "data_fragment", weight: 45 },
      { id: "energy_drink", weight: 20 },
      { id: "companion_treat", weight: 15 },
      { id: "neural_chip", weight: 20 }
    ],
    rare: [
      { id: "corrupted_file", weight: 40 },
      { id: "luck_charm", weight: 35 },
      { id: "neural_chip", weight: 25 }
    ],
    epic: [
      { id: "encryption_key", weight: 40 },
      { id: "hologram_badge", weight: 30 },
      { id: "xp_booster", weight: 30 }
    ],
    legendary: [
      { id: "quantum_core", weight: 65 },
      { id: "ancient_code", weight: 35 }
    ],
    mythic: [
      { id: "singularity_shard", weight: 100 }
    ]
  }
};

/**
 * Roll for a random rarity tier
 */
function rollRarity(luckBoost = 0) {
  const roll = Math.random() * 100;
  let cumulative = 0;

  // Apply luck boost (shifts odds toward higher rarities)
  const adjustedWeights = { ...RARITY_WEIGHTS };
  if (luckBoost > 0) {
    adjustedWeights.mythic += luckBoost * 0.5;
    adjustedWeights.legendary += luckBoost * 2;
    adjustedWeights.epic += luckBoost * 3;
    adjustedWeights.rare += luckBoost * 2;
    adjustedWeights.common -= luckBoost * 7.5;
  }
  // Fail-safe: never allow negative weights
  for (const k of Object.keys(adjustedWeights)) {
    if (adjustedWeights[k] < 1) adjustedWeights[k] = 1;
  }

  for (const [rarity, weight] of Object.entries(adjustedWeights)) {
    cumulative += weight;
    if (roll <= cumulative) {
      return rarity;
    }
  }

  return "common"; // Fallback
}

/**
 * Roll for a specific item from a rarity tier
 */
function rollItem(rarity) {
  const table = LOOT_TABLES[rarity];
  if (!table || table.length === 0) return null;

  const totalWeight = table.reduce((sum, item) => sum + item.weight, 0);
  const roll = Math.random() * totalWeight;
  let cumulative = 0;

  for (const entry of table) {
    cumulative += entry.weight;
    if (roll <= cumulative) {
      return entry.id;
    }
  }

  return table[0].id; // Fallback
}

function resolveZone(zone) {
  const z = String(zone || "any").toLowerCase();
  return ZONE_ALIASES[z] || "any";
}

function zoneTable(zone, rarity) {
  const z = resolveZone(zone);
  const tables = ZONE_TABLES[z] || LOOT_TABLES;
  return tables[rarity] || LOOT_TABLES[rarity] || null;
}

/**
 * Perform a gather action with tool bonuses
 */
export function performGather(toolBonus = 0, luckBoost = 0, zone = "any") {
  const results = [];
  
  // Base gather yields 1-2 items
  let gatherCount = 1 + Math.floor(Math.random() * 2);
  
  // Tool bonus increases yield (e.g., 25% bonus = 25% chance of +1 item)
  if (toolBonus > 0 && Math.random() * 100 < toolBonus) {
    gatherCount++;
  }

  for (let i = 0; i < gatherCount; i++) {
    const rarity = rollRarity(luckBoost);
    const table = zoneTable(zone, rarity);
    const itemId = table ? rollItemFromTable(table) : rollItem(rarity);
    
    if (itemId) {
      results.push({ itemId, rarity });
    }
  }

  return results;
}

function rollItemFromTable(table) {
  if (!Array.isArray(table) || table.length === 0) return null;
  const totalWeight = table.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  if (totalWeight <= 0) return table[0]?.id || null;
  const roll = Math.random() * totalWeight;
  let cumulative = 0;
  for (const entry of table) {
    cumulative += Number(entry.weight || 0);
    if (roll <= cumulative) return entry.id;
  }
  return table[0]?.id || null;
}

/**
 * Add item to user's collection (tracked separately from inventory)
 */
export async function addToCollection(userId, category, itemId, rarity, size = null) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT count, best_size FROM user_collections WHERE user_id = $1 AND category = $2 AND item_id = $3`,
      [userId, category, itemId]
    );

    if (existing.rows.length > 0) {
      // Update count and best size
      const updateSize = size && (!existing.rows[0].best_size || size > parseFloat(existing.rows[0].best_size));
      
      if (updateSize) {
        await client.query(
          `UPDATE user_collections SET count = count + 1, last_caught = $1, best_size = $2 WHERE user_id = $3 AND category = $4 AND item_id = $5`,
          [Date.now(), size, userId, category, itemId]
        );
      } else {
        await client.query(
          `UPDATE user_collections SET count = count + 1, last_caught = $1 WHERE user_id = $2 AND category = $3 AND item_id = $4`,
          [Date.now(), userId, category, itemId]
        );
      }
    } else {
      // Insert new collection entry
      await client.query(
        `INSERT INTO user_collections (user_id, category, item_id, rarity, count, first_caught, last_caught, best_size)
         VALUES ($1, $2, $3, $4, 1, $5, $5, $6)`,
        [userId, category, itemId, rarity, Date.now(), size]
      );
    }

    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get user's full collection
 */
export async function getCollection(userId, category = null) {
  const pool = getPool();
  
  let query = `SELECT * FROM user_collections WHERE user_id = $1`;
  const params = [userId];
  
  if (category) {
    query += ` AND category = $2`;
    params.push(category);
  }
  
  query += ` ORDER BY rarity DESC, count DESC`;
  
  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Get collection stats (total items, by rarity, etc.)
 */
export async function getCollectionStats(userId) {
  const pool = getPool();
  
  const result = await pool.query(
    `SELECT 
      COUNT(DISTINCT item_id) as unique_items,
      SUM(count) as total_caught,
      COUNT(CASE WHEN rarity = 'mythic' THEN 1 END) as mythic_count,
      COUNT(CASE WHEN rarity = 'legendary' THEN 1 END) as legendary_count,
      COUNT(CASE WHEN rarity = 'epic' THEN 1 END) as epic_count,
      COUNT(CASE WHEN rarity = 'rare' THEN 1 END) as rare_count,
      COUNT(CASE WHEN rarity = 'common' THEN 1 END) as common_count
    FROM user_collections WHERE user_id = $1`,
    [userId]
  );
  
  return result.rows[0] || {
    unique_items: 0,
    total_caught: 0,
    mythic_count: 0,
    legendary_count: 0,
    epic_count: 0,
    rare_count: 0,
    common_count: 0
  };
}
