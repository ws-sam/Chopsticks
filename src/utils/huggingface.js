// src/utils/huggingface.js
// HuggingFace Inference API client — free tier, no credit card required.
// Get a free key at: https://huggingface.co/settings/tokens
// Powers: vibe/sentiment classification from server chat messages.

import { logger } from "./logger.js";

const HF_BASE = "https://api-inference.huggingface.co/models";

// Free sentiment model — runs well on HF free tier
const SENTIMENT_MODEL = "cardiffnlp/twitter-roberta-base-sentiment-latest";

// Simple keyword-based fallback when HF is unavailable
const VIBE_KEYWORDS = {
  energetic: ["hype", "lit", "banger", "fire", "go", "poggers", "lets go", "W", "bussin", "slaps", "🔥", "💯", "🎉", "🚀"],
  hype:      ["hype", "cracked", "insane", "GOAT", "god", "amazing", "crazy", "pogchamp", "W"],
  chill:     ["chill", "vibes", "lowkey", "relax", "comfy", "cozy", "calm", "smooth", "nice", "💤", "😌"],
  melancholy:["sad", "miss", "lonely", "hurt", "cry", "hard", "tough", "rip", "💔", "😭", "😔"],
  focus:     ["grind", "work", "study", "focus", "productive", "hustle", "code", "gaming", "chess"],
};

/**
 * Classify vibe from an array of text messages using keyword heuristics.
 * @param {string[]} texts
 * @returns {string} energetic | hype | chill | focus | melancholy | neutral
 */
export function classifyVibeKeywords(texts) {
  const combined = texts.join(" ").toLowerCase();
  const scores = { energetic: 0, hype: 0, chill: 0, melancholy: 0, focus: 0 };

  for (const [vibe, keywords] of Object.entries(VIBE_KEYWORDS)) {
    for (const kw of keywords) {
      if (combined.includes(kw.toLowerCase())) scores[vibe]++;
    }
  }

  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (top[1] === 0) return "neutral";
  return top[0];
}

/**
 * Classify sentiment/vibe from messages using HuggingFace inference API.
 * Falls back to keyword heuristics if HF unavailable.
 * @param {string[]} texts - Array of messages
 * @returns {Promise<string>} energetic | hype | chill | focus | melancholy | neutral
 */
export async function classifyVibe(texts) {
  if (!texts?.length) return "neutral";

  const key = process.env.HUGGINGFACE_API_KEY;
  if (!key) {
    return classifyVibeKeywords(texts);
  }

  const combined = texts.slice(0, 20).join(". ").slice(0, 512);

  try {
    const res = await fetch(`${HF_BASE}/${SENTIMENT_MODEL}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: combined }),
      signal: AbortSignal.timeout(8_000)
    });

    if (!res.ok) {
      // HF model loading (503) or rate limit — fall back to keywords
      return classifyVibeKeywords(texts);
    }

    const result = await res.json();
    const scores = Array.isArray(result?.[0]) ? result[0] : [];

    // HF sentiment: LABEL_0=negative, LABEL_1=neutral, LABEL_2=positive
    const sorted = [...scores].sort((a, b) => b.score - a.score);
    const top = sorted[0]?.label?.toLowerCase() ?? "neutral";

    if (top.includes("positive") || top === "label_2") {
      // Positive sentiment — check energy level from keywords
      const kwVibe = classifyVibeKeywords(texts);
      return kwVibe === "neutral" ? "energetic" : kwVibe;
    }
    if (top.includes("negative") || top === "label_0") return "melancholy";
    return classifyVibeKeywords(texts); // neutral → use keywords for sub-classification
  } catch (err) {
    logger.warn("[huggingface] Classification failed, using keyword fallback:", err?.message ?? err);
    return classifyVibeKeywords(texts);
  }
}
