// src/utils/groq.js
// Lightweight Groq API client — free LLM inference (llama-3.3-70b, no credit card).
// API key: https://console.groq.com/keys
// Rate limit: ~6K tokens/min on free tier. All responses cached in Redis to minimize usage.

import { createClient } from "redis";
import { logger } from "./logger.js";

const GROQ_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const CACHE_PREFIX = "groq:cache:";
const CACHE_TTL_SEC = 300; // 5 minutes

let redisClient = null;

async function getRedis() {
  if (redisClient?.isOpen) return redisClient;
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  redisClient = createClient({ url });
  redisClient.on("error", () => {}); // silent — cache is best-effort
  await redisClient.connect().catch(() => {});
  return redisClient;
}

function cacheKey(messages, model, maxTokens) {
  const payload = JSON.stringify({ messages, model, maxTokens });
  // Simple hash-ish key using content length + first/last chars
  const hash = payload.length + ":" + payload.slice(0, 40).replace(/\s+/g, "");
  return CACHE_PREFIX + hash;
}

/**
 * Send a chat completion request to Groq.
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} [opts]
 * @param {string} [opts.model] - Groq model name (default: llama-3.3-70b-versatile)
 * @param {number} [opts.maxTokens] - Max tokens to generate (default: 150)
 * @param {number} [opts.temperature] - Temperature (default: 0.8)
 * @param {boolean} [opts.cache] - Whether to cache the response (default: true)
 * @param {string} [opts.apiKey] - Override API key
 * @returns {Promise<string|null>} The generated text, or null on failure
 */
export async function groqChat(messages, {
  model = DEFAULT_MODEL,
  maxTokens = 150,
  temperature = 0.8,
  cache = true,
  apiKey
} = {}) {
  const key = apiKey || process.env.GROQ_API_KEY;
  if (!key) return null;

  // Check cache
  if (cache) {
    try {
      const redis = await getRedis();
      const cached = await redis.get(cacheKey(messages, model, maxTokens));
      if (cached) return cached;
    } catch {}
  }

  let retries = 2;
  let delay = 1000;

  while (retries >= 0) {
    try {
      const res = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature
        }),
        signal: AbortSignal.timeout(15_000)
      });

      if (res.status === 429) {
        // Rate limited — back off
        if (retries > 0) {
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
          retries--;
          continue;
        }
        return null;
      }

      if (!res.ok) {
        logger.warn(`[groq] API error ${res.status}`);
        return null;
      }

      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content?.trim() ?? null;

      // Cache the result
      if (cache && text) {
        try {
          const redis = await getRedis();
          await redis.setEx(cacheKey(messages, model, maxTokens), CACHE_TTL_SEC, text);
        } catch {}
      }

      return text;
    } catch (err) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        retries--;
      } else {
        logger.warn("[groq] Request failed:", err?.message ?? err);
        return null;
      }
    }
  }

  return null;
}

/**
 * Quick single-message completion (user prompt only).
 */
export async function groqComplete(prompt, opts = {}) {
  return groqChat([{ role: "user", content: prompt }], opts);
}
