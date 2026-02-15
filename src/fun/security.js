import crypto from "node:crypto";

function toBool(value, fallback = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function toInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
}

export function readFunHubSecurityConfig(env = process.env) {
  const configured = parseList(env.FUNHUB_API_KEYS);
  const internal = String(env.FUNHUB_INTERNAL_API_KEY || env.FUNHUB_API_KEY || env.AGENT_TOKEN_KEY || "").trim();

  const keys = new Set();
  for (const key of configured) {
    if (key.length >= 16) keys.add(key);
  }
  if (internal.length >= 16) keys.add(internal);

  const requireApiKey = toBool(env.FUNHUB_REQUIRE_API_KEY, true);

  return {
    requireApiKey,
    keys,
    corsOrigins: new Set(parseList(env.FUNHUB_CORS_ORIGINS)),
    rateLimitMax: toInt(env.FUNHUB_RATE_LIMIT_MAX, 120, 5, 10000),
    rateLimitWindowMs: toInt(env.FUNHUB_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 3_600_000)
  };
}

export function extractApiKey(req) {
  const fromHeader = String(req.headers["x-api-key"] || "").trim();
  if (fromHeader) return fromHeader;

  const auth = String(req.headers.authorization || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (match?.[1]) return match[1].trim();

  const fromQuery = String(req.query?.api_key || "").trim();
  if (fromQuery) return fromQuery;

  return "";
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function validateApiKey(key, allowedKeys) {
  const probe = String(key || "").trim();
  if (!probe) return false;
  for (const allowed of allowedKeys || []) {
    if (timingSafeEqual(probe, allowed)) return true;
  }
  return false;
}

export function makeInMemoryRateLimiter({ max, windowMs }) {
  const buckets = new Map();

  function cleanup(now) {
    for (const [k, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) buckets.delete(k);
    }
  }

  return {
    check(key, now = Date.now()) {
      if (!key) {
        return { ok: false, remaining: 0, limit: max, resetMs: windowMs };
      }

      cleanup(now);
      const current = buckets.get(key);
      if (!current) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, remaining: max - 1, limit: max, resetMs: windowMs };
      }

      if (current.count >= max) {
        return { ok: false, remaining: 0, limit: max, resetMs: Math.max(1, current.resetAt - now) };
      }

      current.count += 1;
      return {
        ok: true,
        remaining: Math.max(0, max - current.count),
        limit: max,
        resetMs: Math.max(1, current.resetAt - now)
      };
    }
  };
}

export function normalizeOrigin(value) {
  return String(value || "").trim().toLowerCase();
}
