import { describe, it } from "mocha";
import { strict as assert } from "assert";
import {
  makeInMemoryRateLimiter,
  readFunHubSecurityConfig,
  validateApiKey
} from "../../src/fun/security.js";

describe("FunHub security", function () {
  it("builds key set from env", function () {
    const config = readFunHubSecurityConfig({
      FUNHUB_REQUIRE_API_KEY: "true",
      FUNHUB_API_KEYS: "alphaalphaalphaalpha,betabetabetabeta",
      AGENT_TOKEN_KEY: ""
    });
    assert.equal(config.requireApiKey, true);
    assert.ok(config.keys.has("alphaalphaalphaalpha"));
    assert.ok(config.keys.has("betabetabetabeta"));
  });

  it("falls back to internal key from AGENT_TOKEN_KEY", function () {
    const key = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const config = readFunHubSecurityConfig({
      FUNHUB_REQUIRE_API_KEY: "true",
      FUNHUB_API_KEYS: "",
      AGENT_TOKEN_KEY: key
    });
    assert.ok(config.keys.has(key));
  });

  it("validates api keys", function () {
    const allowed = new Set(["very-secret-api-key"]);
    assert.equal(validateApiKey("very-secret-api-key", allowed), true);
    assert.equal(validateApiKey("wrong-key", allowed), false);
  });

  it("rate limiter enforces cap", function () {
    const limiter = makeInMemoryRateLimiter({ max: 2, windowMs: 1000 });
    const t0 = 10000;
    assert.equal(limiter.check("k", t0).ok, true);
    assert.equal(limiter.check("k", t0 + 10).ok, true);
    assert.equal(limiter.check("k", t0 + 20).ok, false);
    assert.equal(limiter.check("k", t0 + 1001).ok, true);
  });
});
