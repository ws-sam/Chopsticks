// src/economy/wallet.js
// Wallet management for user economy

import { getPool } from "../utils/storage_pg.js";

export async function getWallet(userId) {
  const pool = getPool();
  const now = Date.now();
  
  const result = await pool.query(
    `INSERT INTO user_wallets (user_id, balance, bank, bank_capacity, total_earned, total_spent, created_at, updated_at)
     VALUES ($1, 0, 0, 10000, 0, 0, $2, $2)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = $2
     RETURNING *`,
    [userId, now]
  );
  
  return result.rows[0];
}

export async function addCredits(userId, amount, reason = "unknown") {
  if (amount <= 0) throw new Error("Amount must be positive");
  
  const pool = getPool();
  const now = Date.now();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO user_wallets (user_id, balance, bank, bank_capacity, total_earned, total_spent, created_at, updated_at)
       VALUES ($1, $2, 0, 10000, $2, 0, $3, $3)
       ON CONFLICT (user_id) DO UPDATE
       SET balance = user_wallets.balance + $2,
           total_earned = user_wallets.total_earned + $2,
           updated_at = $3
       RETURNING *`,
      [userId, amount, now]
    );

    await client.query(
      `INSERT INTO transaction_log (from_user, to_user, amount, reason, metadata, timestamp)
       VALUES (NULL, $1, $2, $3, '{}', $4)`,
      [userId, amount, reason, now]
    );

    await client.query("COMMIT");
    return { ok: true, newBalance: result.rows[0]?.balance ?? amount };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function removeCredits(userId, amount, reason = "unknown") {
  if (amount <= 0) throw new Error("Amount must be positive");
  
  const pool = getPool();
  const now = Date.now();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Atomic debit (fails closed if wallet missing or insufficient)
    const result = await client.query(
      `UPDATE user_wallets
       SET balance = balance - $1,
           total_spent = total_spent + $1,
           updated_at = $2
       WHERE user_id = $3 AND balance >= $1
       RETURNING *`,
      [amount, now, userId]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "insufficient" };
    }

    await client.query(
      `INSERT INTO transaction_log (from_user, to_user, amount, reason, metadata, timestamp)
       VALUES ($1, NULL, $2, $3, '{}', $4)`,
      [userId, amount, reason, now]
    );

    await client.query("COMMIT");
    return { ok: true, newBalance: result.rows[0].balance };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function transferCredits(fromUserId, toUserId, amount, reason = "transfer") {
  if (amount <= 0) throw new Error("Amount must be positive");
  if (fromUserId === toUserId) throw new Error("Cannot transfer to self");
  
  const pool = getPool();
  const now = Date.now();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const debit = await client.query(
      `UPDATE user_wallets
       SET balance = balance - $1,
           total_spent = total_spent + $1,
           updated_at = $2
       WHERE user_id = $3 AND balance >= $1
       RETURNING user_id`,
      [amount, now, fromUserId]
    );
    if (debit.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "insufficient" };
    }

    await client.query(
      `INSERT INTO user_wallets (user_id, balance, bank, bank_capacity, total_earned, total_spent, created_at, updated_at)
       VALUES ($1, $2, 0, 10000, $2, 0, $3, $3)
       ON CONFLICT (user_id) DO UPDATE
       SET balance = user_wallets.balance + $2,
           total_earned = user_wallets.total_earned + $2,
           updated_at = $3`,
      [toUserId, amount, now]
    );

    await client.query(
      `INSERT INTO transaction_log (from_user, to_user, amount, reason, metadata, timestamp)
       VALUES ($1, $2, $3, $4, '{}', $5)`,
      [fromUserId, toUserId, amount, reason, now]
    );

    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function depositToBank(userId, amount) {
  if (amount <= 0) throw new Error("Amount must be positive");
  
  const pool = getPool();
  const now = Date.now();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const walletRes = await client.query(
      `SELECT balance, bank, bank_capacity FROM user_wallets WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    const wallet = walletRes.rows[0];
    if (!wallet || Number(wallet.balance) < amount) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "insufficient" };
    }

    const newBank = Number(wallet.bank) + amount;
    if (newBank > Number(wallet.bank_capacity)) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "capacity" };
    }

    await client.query(
      `UPDATE user_wallets
       SET balance = balance - $1, bank = bank + $1, updated_at = $2
       WHERE user_id = $3`,
      [amount, now, userId]
    );

    await client.query("COMMIT");
    return { ok: true, newBank };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function withdrawFromBank(userId, amount) {
  if (amount <= 0) throw new Error("Amount must be positive");
  
  const pool = getPool();
  const now = Date.now();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE user_wallets
       SET balance = balance + $1, bank = bank - $1, updated_at = $2
       WHERE user_id = $3 AND bank >= $1
       RETURNING balance`,
      [amount, now, userId]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "insufficient" };
    }

    await client.query("COMMIT");
    return { ok: true, newBalance: result.rows[0].balance };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function upgradeBankCapacity(userId, levels = 1) {
  const pool = getPool();
  const now = Date.now();
  const count = Math.max(1, Math.min(20, Math.trunc(Number(levels) || 1)));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Ensure wallet exists, then lock for update
    await client.query(
      `INSERT INTO user_wallets (user_id, balance, bank, bank_capacity, total_earned, total_spent, created_at, updated_at)
       VALUES ($1, 0, 0, 10000, 0, 0, $2, $2)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = $2`,
      [userId, now]
    );
    const wRes = await client.query(
      `SELECT * FROM user_wallets WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    let wallet = wRes.rows[0];

    let totalCost = 0;
    let applied = 0;
    for (let i = 0; i < count; i += 1) {
      const cap = Number(wallet.bank_capacity) || 10000;
      const tier = Math.max(0, Math.floor((cap - 10000) / 5000));
      const cost = 4000 * (tier + 1);
      if (Number(wallet.balance) < cost) break;
      totalCost += cost;
      applied += 1;
      wallet = {
        ...wallet,
        balance: Number(wallet.balance) - cost,
        bank_capacity: cap + 5000,
        total_spent: Number(wallet.total_spent) + cost
      };
    }

    if (applied === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "insufficient" };
    }

    const up = await client.query(
      `UPDATE user_wallets
       SET balance = $1, bank_capacity = $2, total_spent = $3, updated_at = $4
       WHERE user_id = $5
       RETURNING *`,
      [wallet.balance, wallet.bank_capacity, wallet.total_spent, now, userId]
    );

    await client.query(
      `INSERT INTO transaction_log (from_user, to_user, amount, reason, metadata, timestamp)
       VALUES ($1, NULL, $2, $3, $4, $5)`,
      [userId, totalCost, "bank_upgrade", JSON.stringify({ levels: applied }), now]
    );

    await client.query("COMMIT");
    return { ok: true, applied, totalCost, wallet: up.rows[0] };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}
