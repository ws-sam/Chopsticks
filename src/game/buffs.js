// src/game/buffs.js
// Temporary player modifiers stored in Redis (TTL-backed).

import { getCache, setCache } from "../utils/redis.js";

function key(userId, buffId) {
  return `buff:${userId}:${buffId}`;
}

export async function setBuff(userId, buffId, value, ttlMs) {
  const ms = Math.max(1000, Math.trunc(Number(ttlMs) || 0));
  const ttlSec = Math.max(1, Math.ceil(ms / 1000));
  const payload = { value, expiresAt: Date.now() + ms };
  await setCache(key(userId, buffId), payload, ttlSec);
  return { ok: true, expiresAt: payload.expiresAt };
}

export async function getBuff(userId, buffId) {
  const data = await getCache(key(userId, buffId));
  if (!data) return null;
  const expiresAt = Number(data.expiresAt) || 0;
  if (expiresAt && expiresAt <= Date.now()) return null;
  return data.value ?? null;
}

export async function getMultiplier(userId, buffId, fallback = 1) {
  const v = await getBuff(userId, buffId);
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

