import { describe, it } from "mocha";
import { strict as assert } from "assert";
import {
  getFunCatalog,
  getFunRuntimeConfig,
  randomFunFromRuntime,
  renderFunFromRuntime,
  resolveVariantId
} from "../../src/fun/runtime.js";

describe("Fun runtime", function () {
  it("parses runtime config", function () {
    const cfg = getFunRuntimeConfig({
      FUN_PROVIDER: "hub",
      FUNHUB_URL: "http://example:8790/",
      FUNHUB_TIMEOUT_MS: "2500",
      FUNHUB_INTERNAL_API_KEY: "my-key-1234567890"
    });

    assert.equal(cfg.provider, "hub");
    assert.equal(cfg.hubUrl, "http://example:8790");
    assert.equal(cfg.timeoutMs, 2500);
    assert.equal(cfg.apiKey, "my-key-1234567890");
  });

  it("resolves exact and fuzzy variant ids", function () {
    assert.equal(resolveVariantId("hype-burst"), "hype-burst");
    assert.equal(resolveVariantId("hype"), "hype-boss");
  });

  it("returns local catalog in forceLocal mode", async function () {
    const out = await getFunCatalog({ query: "hype", forceLocal: true, env: { FUN_PROVIDER: "hub" } });
    assert.equal(out.ok, true);
    assert.equal(out.source, "local");
    assert.ok(out.matches.length > 0);
  });

  it("renders local fun result in forceLocal mode", async function () {
    const out = await renderFunFromRuntime({
      variantId: "hype-burst",
      actorTag: "tester",
      target: "team",
      intensity: 4,
      forceLocal: true,
      env: { FUN_PROVIDER: "hub" }
    });

    assert.equal(out.ok, true);
    assert.equal(out.source, "local");
    assert.ok(out.text.length > 0);
  });

  it("renders random local fun result", async function () {
    const out = await randomFunFromRuntime({
      actorTag: "tester",
      target: "raid",
      intensity: 3,
      forceLocal: true,
      env: { FUN_PROVIDER: "hub" }
    });

    assert.equal(out.ok, true);
    assert.equal(out.source, "local");
  });
});
