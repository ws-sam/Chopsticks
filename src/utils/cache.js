import { createClient } from "redis";

let client = null;
let connecting = null;

async function getClient() {
  if (client) return client;
  if (connecting) return connecting;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL missing");

  connecting = (async () => {
    const c = createClient({ url });
    c.on("error", () => {});
    await c.connect();
    client = c;
    return client;
  })();

  return connecting;
}

/**
 * Get a value from Redis cache. Returns `null` on miss or error.
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function cacheGet(key) {
  try {
    const c = await getClient();
    const raw = await c.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Set a value in Redis. Silently swallows errors (non-critical cache layer).
 * @param {string} key
 * @param {any} value  — will be JSON-serialised
 * @param {number} [ttlSec]  — positive integer seconds; omit for no expiry
 */
export async function cacheSet(key, value, ttlSec) {
  try {
    const c = await getClient();
    const payload = JSON.stringify(value);
    if (Number.isFinite(ttlSec) && ttlSec > 0) {
      await c.set(key, payload, { EX: Math.trunc(ttlSec) });
    } else {
      await c.set(key, payload);
    }
  } catch {}
}

/**
 * Atomically increment an integer counter. Sets TTL on first write.
 * @param {string} key
 * @param {number} [ttlSec]  — applied only when the key is first created
 * @returns {Promise<number|null>}  new counter value, or null on error
 */
export async function cacheIncr(key, ttlSec) {
  try {
    const c = await getClient();
    const count = await c.incr(key);
    if (count === 1 && Number.isFinite(ttlSec) && ttlSec > 0) {
      await c.expire(key, Math.trunc(ttlSec));
    }
    return count;
  } catch {
    return null;
  }
}

/**
 * Set a value only if the key does not already exist (NX semantics).
 * @param {string} key
 * @param {any} value
 * @param {number} [ttlSec]
 * @returns {Promise<boolean|null>}  `true` if set, `false` if key existed, `null` on error
 */
export async function cacheSetNx(key, value, ttlSec) {
  try {
    const c = await getClient();
    const payload = JSON.stringify(value);
    const opts = {};
    if (Number.isFinite(ttlSec) && ttlSec > 0) {
      opts.EX = Math.trunc(ttlSec);
    }
    const result = await c.set(key, payload, { NX: true, ...opts });
    return result === "OK";
  } catch {
    return null;
  }
}

/**
 * Return the raw Redis client instance (may be `null` before first connection).
 * Use for operations not covered by the helper functions above (e.g. `del`).
 * @returns {import('redis').RedisClientType|null}
 */
export function getRedis() {
  return client;
}

/**
 * Ping Redis to verify connectivity.
 * @returns {Promise<boolean>}
 */
export async function checkRedisHealth() {
  try {
    const c = await getClient();
    await c.ping();
    return true;
  } catch {
    return false;
  }
}
