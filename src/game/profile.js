// src/game/profile.js
// DB-backed game profile (XP + level).

import { getPool } from "../utils/storage_pg.js";
import { levelFromXp } from "./progression.js";

export async function getGameProfile(userId) {
  const p = getPool();
  const now = Date.now();
  const res = await p.query(
    `INSERT INTO user_game_profiles (user_id, xp, level, created_at, updated_at)
     VALUES ($1, 0, 1, $2, $2)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = $2
     RETURNING user_id, xp, level, created_at, updated_at`,
    [userId, now]
  );
  const row = res.rows[0] || { user_id: userId, xp: 0, level: 1 };
  // Keep level consistent even if older rows were written with different formulas.
  const xp = Math.max(0, Number(row.xp) || 0);
  const computedLevel = levelFromXp(xp);
  if (Number(row.level) !== computedLevel) {
    try {
      await p.query(
        `UPDATE user_game_profiles SET level = $1, updated_at = $2 WHERE user_id = $3`,
        [computedLevel, now, userId]
      );
      row.level = computedLevel;
    } catch {}
  }
  row.xp = xp;
  row.level = computedLevel;
  return row;
}

export async function addGameXp(userId, baseAmount, { reason = "unknown", multiplier = 1 } = {}) {
  const p = getPool();
  const now = Date.now();
  const amt = Math.max(0, Math.trunc(Number(baseAmount) || 0));
  const mult = Number(multiplier);
  const applied = Math.max(0, Math.trunc(amt * (Number.isFinite(mult) ? mult : 1)));
  if (applied <= 0) {
    const cur = await getGameProfile(userId);
    return { ok: true, applied: 0, profile: cur, leveledUp: false, reason };
  }

  await p.query("BEGIN");
  try {
    const before = await getGameProfile(userId);
    const nextXp = Math.max(0, Math.trunc(Number(before.xp) || 0) + applied);
    const nextLevel = levelFromXp(nextXp);

    const res = await p.query(
      `UPDATE user_game_profiles
       SET xp = $1, level = $2, updated_at = $3
       WHERE user_id = $4
       RETURNING user_id, xp, level, created_at, updated_at`,
      [nextXp, nextLevel, now, userId]
    );

    await p.query("COMMIT");
    const after = res.rows[0] || { user_id: userId, xp: nextXp, level: nextLevel };
    return {
      ok: true,
      applied,
      leveledUp: nextLevel > Number(before.level || 1),
      fromLevel: Number(before.level || 1),
      toLevel: nextLevel,
      profile: { ...after, xp: nextXp, level: nextLevel },
      reason
    };
  } catch (err) {
    await p.query("ROLLBACK");
    throw err;
  }
}

