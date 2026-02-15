import { getPool } from "../utils/storage_pg.js";
import itemsData from "./items.json" with { type: "json" };
import { isLegacyItemId, describeLegacyItem } from "./legacyItems.js";

// Flatten items registry for easy lookup
const ITEMS = {};
for (const category in itemsData) {
  for (const itemId in itemsData[category]) {
    ITEMS[itemId] = itemsData[category][itemId];
  }
}

/**
 * Get user's full inventory
 */
export async function getInventory(userId) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT item_id, quantity, metadata, acquired_at FROM user_inventory WHERE user_id = $1 ORDER BY acquired_at DESC`,
    [userId]
  );
  return result.rows.map(row => ({
    ...row,
    metadata: normalizeMetadata(row.metadata),
    itemData: resolveItemData(row.item_id, normalizeMetadata(row.metadata)) || { name: "Unknown Item", emoji: "❓", category: "unknown", sellPrice: 0, rarity: "common" }
  }));
}

/**
 * Add item to user's inventory
 */
export async function addItem(userId, itemId, quantity = 1, metadata = null) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");
    
    // NOTE: Schema enforces UNIQUE(user_id, item_id). Metadata is descriptive only (not part of key).
    const existing = await client.query(
      `SELECT id, quantity, metadata FROM user_inventory WHERE user_id = $1 AND item_id = $2`,
      [userId, itemId]
    );
    
    if (existing.rows.length > 0) {
      // Update quantity (and merge metadata if provided)
      const prevMeta = normalizeMetadata(existing.rows[0].metadata) || {};
      const nextMeta = metadata && typeof metadata === "object"
        ? { ...prevMeta, ...metadata }
        : prevMeta;
      await client.query(
        `UPDATE user_inventory SET quantity = quantity + $1, metadata = $2 WHERE id = $3`,
        [quantity, JSON.stringify(nextMeta), existing.rows[0].id]
      );
    } else {
      // Insert new item
      const meta = metadata && typeof metadata === "object" ? metadata : {};
      await client.query(
        `INSERT INTO user_inventory (user_id, item_id, quantity, metadata, acquired_at) VALUES ($1, $2, $3, $4, $5)`,
        [userId, itemId, quantity, JSON.stringify(meta), Date.now()]
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
 * Remove item from user's inventory
 */
export async function removeItem(userId, itemId, quantity = 1, metadata = null) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");
    
    const existing = await client.query(
      `SELECT id, quantity FROM user_inventory WHERE user_id = $1 AND item_id = $2`,
      [userId, itemId]
    );
    
    if (existing.rows.length === 0) {
      throw new Error("Item not found in inventory");
    }
    
    const currentQty = existing.rows[0].quantity;
    if (currentQty < quantity) {
      throw new Error(`Insufficient quantity (have ${currentQty}, need ${quantity})`);
    }
    
    if (currentQty === quantity) {
      // Remove entire stack
      await client.query(`DELETE FROM user_inventory WHERE id = $1`, [existing.rows[0].id]);
    } else {
      // Decrease quantity
      await client.query(
        `UPDATE user_inventory SET quantity = quantity - $1 WHERE id = $2`,
        [quantity, existing.rows[0].id]
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
 * Check if user has item
 */
export async function hasItem(userId, itemId, quantity = 1, metadata = null) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT quantity FROM user_inventory WHERE user_id = $1 AND item_id = $2`,
    [userId, itemId]
  );
  
  if (result.rows.length === 0) return false;
  return result.rows[0].quantity >= quantity;
}

/**
 * Get item definition by ID
 */
export function getItemData(itemId, metadata = null) {
  return resolveItemData(itemId, normalizeMetadata(metadata));
}

/**
 * Get all items by category
 */
export function getItemsByCategory(category) {
  return itemsData[category] || {};
}

/**
 * Search items by name
 */
export function searchItems(query) {
  const results = [];
  const lowerQuery = query.toLowerCase();
  
  for (const itemId in ITEMS) {
    const item = ITEMS[itemId];
    if (item.name.toLowerCase().includes(lowerQuery) || item.description.toLowerCase().includes(lowerQuery)) {
      results.push(item);
    }
  }
  
  return results;
}

function normalizeMetadata(metadata) {
  if (!metadata) return null;
  if (typeof metadata === "object") return metadata;
  try {
    return JSON.parse(String(metadata));
  } catch {
    return null;
  }
}

function resolveItemData(itemId, metadata) {
  const known = ITEMS[itemId];
  if (known) return known;

  if (isLegacyItemId(itemId)) {
    const rarity = metadata?.rarity || metadata?.itemRarity || "common";
    const sellPrice = Number(metadata?.sellPrice);
    const base = describeLegacyItem(itemId, rarity);
    if (Number.isFinite(sellPrice) && sellPrice > 0) return { ...base, sellPrice };
    return base;
  }

  return null;
}
