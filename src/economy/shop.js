import itemsData from "./items.json" with { type: "json" };

function flatItems() {
  const out = [];
  for (const category of Object.keys(itemsData || {})) {
    const group = itemsData[category] || {};
    for (const [id, item] of Object.entries(group)) {
      out.push({ ...item, id, group: category });
    }
  }
  return out;
}

const ALL = flatItems();

export function listShopCategories() {
  // Only categories that have purchasable items.
  const set = new Set();
  for (const it of ALL) {
    if (Number(it.price) > 0) set.add(it.group);
  }
  return Array.from(set);
}

export function listShopItems(group) {
  const g = String(group || "").toLowerCase();
  return ALL
    .filter(it => Number(it.price) > 0)
    .filter(it => !g || String(it.group).toLowerCase() === g)
    .sort((a, b) => Number(a.price) - Number(b.price));
}

export function findShopItem(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  // Exact id match first
  const byId = ALL.find(it => String(it.id).toLowerCase() === q);
  if (byId) return byId;
  // Contains name match
  const byName = ALL.find(it => String(it.name || "").toLowerCase() === q);
  if (byName) return byName;
  // Fuzzy: first contains
  const fuzzy = ALL.find(it => String(it.name || "").toLowerCase().includes(q));
  return fuzzy || null;
}

export function searchShopItems(query, limit = 25) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return listShopItems("").slice(0, limit);
  const hits = ALL
    .filter(it => Number(it.price) > 0)
    .filter(it => String(it.id).toLowerCase().includes(q) || String(it.name || "").toLowerCase().includes(q))
    .slice(0, limit);
  return hits;
}

