import express from "express";
import {
  clampIntensity,
  findVariants,
  getVariantById,
  listVariantStats,
  randomVariantId,
  renderFunVariant,
  sampleVariantIds
} from "./variants.js";
import {
  extractApiKey,
  makeInMemoryRateLimiter,
  normalizeOrigin,
  readFunHubSecurityConfig,
  validateApiKey
} from "./security.js";

const app = express();
const port = Number(process.env.FUNHUB_PORT || 8790);
const security = readFunHubSecurityConfig(process.env);
const limiter = makeInMemoryRateLimiter({
  max: security.rateLimitMax,
  windowMs: security.rateLimitWindowMs
});

function sendJsonError(res, status, error, detail = "") {
  return res.status(status).json({ ok: false, error, detail });
}

function applyCors(req, res) {
  const origin = normalizeOrigin(req.headers.origin || "");
  if (!origin) return true;

  if (!security.corsOrigins.size) {
    return true;
  }

  if (!security.corsOrigins.has(origin)) {
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");
  return true;
}

function authAndRateLimit(req, res, next) {
  if (!applyCors(req, res)) {
    return sendJsonError(res, 403, "cors-denied", "Origin is not allowed.");
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (!security.requireApiKey) {
    const key = req.ip || "anon";
    const rl = limiter.check(key);
    res.setHeader("X-RateLimit-Limit", String(rl.limit));
    res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(rl.resetMs / 1000)));
    if (!rl.ok) return sendJsonError(res, 429, "rate-limited", "Too many requests.");
    return next();
  }

  if (!security.keys.size) {
    return sendJsonError(res, 503, "auth-not-configured", "FunHub has no valid API keys configured.");
  }

  const key = extractApiKey(req);
  if (!validateApiKey(key, security.keys)) {
    return sendJsonError(res, 401, "unauthorized", "Missing or invalid API key.");
  }

  const rl = limiter.check(`k:${key}`);
  res.setHeader("X-RateLimit-Limit", String(rl.limit));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(rl.resetMs / 1000)));
  if (!rl.ok) return sendJsonError(res, 429, "rate-limited", "Too many requests.");

  return next();
}

function safeText(value, max = 64, fallback = "") {
  const s = String(value || "").trim().slice(0, max);
  return s || fallback;
}

function safeInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

app.disable("x-powered-by");

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "funhub",
    stats: listVariantStats(),
    auth: security.requireApiKey ? "apikey" : "open",
    corsRestricted: security.corsOrigins.size > 0,
    rateLimit: {
      max: security.rateLimitMax,
      windowMs: security.rateLimitWindowMs
    }
  });
});

app.options("/api/fun/*", authAndRateLimit);
app.use("/api/fun", authAndRateLimit);

app.get("/api/fun/catalog", (req, res) => {
  const query = safeText(req.query.q, 64, "");
  const limit = safeInt(req.query.limit, 1, 25, 20);
  const stats = listVariantStats();
  const matches = findVariants(query, limit);
  return res.json({
    ok: true,
    source: "funhub",
    query,
    total: stats.total,
    stats,
    sample: sampleVariantIds(8),
    matches
  });
});

app.get("/api/fun/random", (req, res) => {
  const target = safeText(req.query.target, 64, "guest");
  const actor = safeText(req.query.actor, 64, "funhub");
  const intensity = clampIntensity(req.query.intensity || 3);
  const variantId = randomVariantId();
  const rendered = renderFunVariant({
    variantId,
    actorTag: actor,
    target,
    intensity
  });
  return res.json({ ok: rendered.ok, source: "funhub", variantId, ...rendered });
});

app.get("/api/fun/render", (req, res) => {
  const requested = safeText(req.query.variant, 64, "").toLowerCase();
  const resolved = getVariantById(requested) || findVariants(requested, 1)[0] || null;
  if (!resolved) {
    return sendJsonError(res, 404, "variant-not-found", "Use /api/fun/catalog to list valid variants.");
  }

  const target = safeText(req.query.target, 64, "guest");
  const actor = safeText(req.query.actor, 64, "funhub");
  const intensity = clampIntensity(req.query.intensity || 3);
  const rendered = renderFunVariant({
    variantId: resolved.id,
    actorTag: actor,
    target,
    intensity
  });
  return res.json({ ok: rendered.ok, source: "funhub", variantId: resolved.id, ...rendered });
});

app.get("/api/fun/pack", (req, res) => {
  const count = safeInt(req.query.count, 1, 10, 3);
  const target = safeText(req.query.target, 64, "guest");
  const actor = safeText(req.query.actor, 64, "funhub");
  const intensity = clampIntensity(req.query.intensity || 3);

  const items = [];
  for (let i = 0; i < count; i += 1) {
    const variantId = randomVariantId();
    const rendered = renderFunVariant({ variantId, actorTag: actor, target, intensity });
    if (rendered.ok) {
      items.push({
        variantId,
        intensity: rendered.intensity,
        text: rendered.text,
        metaLine: rendered.metaLine,
        variant: rendered.variant
      });
    }
  }

  return res.json({ ok: true, source: "funhub", count: items.length, items });
});

app.use((err, _req, res, _next) => {
  console.error("[funhub]", err?.stack || err?.message || err);
  return sendJsonError(res, 500, "internal-error", "Unexpected failure.");
});

app.listen(port, () => {
  console.log(
    `[funhub] listening on :${port} | auth=${security.requireApiKey ? "apikey" : "open"} | rate=${security.rateLimitMax}/${security.rateLimitWindowMs}ms`
  );
});
