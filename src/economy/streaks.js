// src/economy/streaks.js
// Streak management for daily rewards

import { getPool } from "../utils/storage_pg.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export async function getStreak(userId) {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO user_streaks (user_id, daily_streak, weekly_streak, last_daily, last_weekly, longest_daily, longest_weekly, streak_multiplier)
     VALUES ($1, 0, 0, NULL, NULL, 0, 0, 1.00)
     ON CONFLICT (user_id) DO UPDATE SET user_id = $1
     RETURNING *`,
    [userId]
  );
  
  return result.rows[0];
}

export async function claimDaily(userId) {
  const pool = getPool();
  const now = Date.now();
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO user_streaks (user_id, daily_streak, weekly_streak, last_daily, last_weekly, longest_daily, longest_weekly, streak_multiplier)
       VALUES ($1, 0, 0, NULL, NULL, 0, 0, 1.00)
       ON CONFLICT (user_id) DO UPDATE SET user_id = $1
       RETURNING *`,
      [userId]
    );
    const streak = result.rows[0];
    const lastDaily = streak.last_daily ?? 0;
    const timeSince = now - lastDaily;
    
    let newStreak = streak.daily_streak;
    let multiplier = streak.streak_multiplier;
    
    // Check if streak continues or breaks
    if (timeSince < DAY_MS) {
      // Already claimed today
      await client.query("ROLLBACK");
      return { ok: false, reason: "already-claimed", nextClaim: lastDaily + DAY_MS };
    } else if (timeSince < 2 * DAY_MS) {
      // Streak continues
      newStreak += 1;
    } else {
      // Streak broken
      newStreak = 1;
    }
    
    // Calculate multiplier (1.0x to 3.0x based on streak)
    // 7 days = 1.5x, 14 days = 2.0x, 30 days = 3.0x
    if (newStreak >= 30) multiplier = 3.00;
    else if (newStreak >= 14) multiplier = 2.00;
    else if (newStreak >= 7) multiplier = 1.50;
    else multiplier = 1.00;
    
    const longestDaily = Math.max(streak.longest_daily, newStreak);
    
    // Update streak
    await client.query(
      `UPDATE user_streaks 
       SET daily_streak = $1, last_daily = $2, longest_daily = $3, streak_multiplier = $4
       WHERE user_id = $5`,
      [newStreak, now, longestDaily, multiplier, userId]
    );
    
    await client.query("COMMIT");
    
    return {
      ok: true,
      streak: newStreak,
      multiplier,
      baseReward: 1000,
      bonusReward: Math.floor(1000 * (multiplier - 1)),
      totalReward: Math.floor(1000 * multiplier)
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}
