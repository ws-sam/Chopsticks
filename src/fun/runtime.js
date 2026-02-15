import { request } from "undici";
import {
  clampIntensity,
  findVariants,
  getVariantById,
  listVariantStats,
  randomVariantId,
  renderFunVariant,
  sampleVariantIds
} from "./variants.js";

function cleanText(value, max = 80) {
  return String(value || "").trim().slice(0, max);
}

function toInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

function asProvider(value) {
  const mode = String(value || "auto").trim().toLowerCase();
  if (mode === "hub" || mode === "local" || mode === "auto") return mode;
  return "auto";
}

export function getFunRuntimeConfig(env = process.env) {
  const provider = asProvider(env.FUN_PROVIDER);
  const hubUrl = String(env.FUNHUB_URL || "http://funhub:8790").trim().replace(/\/$/, "");
  const apiKey = String(env.FUNHUB_INTERNAL_API_KEY || env.FUNHUB_API_KEY || env.AGENT_TOKEN_KEY || "").trim();
  const timeoutMs = toInt(env.FUNHUB_TIMEOUT_MS, 1800, 250, 10000);

  return {
    provider,
    hubUrl,
    apiKey,
    timeoutMs,
    canUseHub: Boolean(hubUrl)
  };
}

function shouldUseHub(config, forceLocal = false) {
  if (forceLocal) return false;
  if (!config.canUseHub) return false;
  if (config.provider === "local") return false;
  return true;
}

export function resolveVariantId(input) {
  const q = String(input || "").trim().toLowerCase();
  if (!q) return null;
  const direct = getVariantById(q);
  if (direct) return direct.id;
  const fuzzy = findVariants(q, 1)[0] || null;
  return fuzzy?.id || null;
}

async function hubGet(config, path, query = {}) {
  const url = new URL(`${config.hubUrl}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  const signal = AbortSignal.timeout(config.timeoutMs);
  const headers = {
    accept: "application/json"
  };
  if (config.apiKey) headers["x-api-key"] = config.apiKey;

  const res = await request(url, { method: "GET", headers, signal });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const body = await res.body.text().catch(() => "");
    throw new Error(`hub-${res.statusCode}${body ? `:${body.slice(0, 80)}` : ""}`);
  }
  return res.body.json();
}

function localCatalog(query, limit) {
  const stats = listVariantStats();
  const matches = findVariants(query, limit);
  return {
    ok: true,
    source: "local",
    query,
    total: stats.total,
    stats,
    sample: sampleVariantIds(8),
    matches
  };
}

function localRender({ variantId, actorTag, target, intensity }) {
  const resolved = resolveVariantId(variantId) || randomVariantId();
  const result = renderFunVariant({
    variantId: resolved,
    actorTag: cleanText(actorTag, 64) || "fun",
    target: cleanText(target, 64) || cleanText(actorTag, 64) || "crew",
    intensity: clampIntensity(intensity)
  });
  return {
    ...result,
    source: "local",
    variantId: resolved
  };
}

export async function getFunCatalog({ query = "", limit = 20, forceLocal = false, env = process.env } = {}) {
  const config = getFunRuntimeConfig(env);
  const safeQuery = cleanText(query, 64);
  const safeLimit = toInt(limit, 20, 1, 25);

  if (shouldUseHub(config, forceLocal)) {
    try {
      const json = await hubGet(config, "/api/fun/catalog", { q: safeQuery, limit: safeLimit });
      if (json?.ok) {
        return {
          ok: true,
          source: "funhub",
          query: safeQuery,
          total: Number(json.total || 0) || listVariantStats().total,
          stats: json.stats || listVariantStats(),
          sample: Array.isArray(json.sample) ? json.sample : sampleVariantIds(8),
          matches: Array.isArray(json.matches) ? json.matches : []
        };
      }
    } catch {}
  }

  return localCatalog(safeQuery, safeLimit);
}

export async function renderFunFromRuntime({ variantId, actorTag, target, intensity, forceLocal = false, env = process.env }) {
  const config = getFunRuntimeConfig(env);
  const safeIntensity = clampIntensity(intensity);
  const requestedVariant = resolveVariantId(variantId) || randomVariantId();
  const safeActor = cleanText(actorTag, 64) || "fun";
  const safeTarget = cleanText(target, 64) || safeActor;

  if (shouldUseHub(config, forceLocal)) {
    try {
      const json = await hubGet(config, "/api/fun/render", {
        variant: requestedVariant,
        actor: safeActor,
        target: safeTarget,
        intensity: safeIntensity
      });
      if (json?.ok) {
        return {
          ok: true,
          source: "funhub",
          variantId: String(json.variantId || requestedVariant),
          variant: json.variant,
          intensity: clampIntensity(json.intensity || safeIntensity),
          text: String(json.text || ""),
          metaLine: String(json.metaLine || `Variant: ${json.variantId || requestedVariant} | Actor: ${safeActor}`)
        };
      }
    } catch {}
  }

  return localRender({
    variantId: requestedVariant,
    actorTag: safeActor,
    target: safeTarget,
    intensity: safeIntensity
  });
}

export async function randomFunFromRuntime({ actorTag, target, intensity, forceLocal = false, env = process.env }) {
  return renderFunFromRuntime({
    variantId: randomVariantId(),
    actorTag,
    target,
    intensity,
    forceLocal,
    env
  });
}
