import assert from "node:assert/strict";
import { sanitizeAuditPayload } from "../../src/dashboard/securityMiddleware.js";

describe("Dashboard Audit Redaction", () => {
  it("redacts common secret keys (nested)", () => {
    const input = {
      password: "p",
      DISCORD_CLIENT_SECRET: "s",
      nested: { apiKey: "k", token: "t" },
      ok: true
    };
    const out = sanitizeAuditPayload(input);
    assert.equal(out.password, "[REDACTED]");
    assert.equal(out.DISCORD_CLIENT_SECRET, "[REDACTED]");
    assert.equal(out.nested.apiKey, "[REDACTED]");
    assert.equal(out.nested.token, "[REDACTED]");
    assert.equal(out.ok, true);
  });

  it("truncates long strings", () => {
    const input = { note: "x".repeat(2000) };
    const out = sanitizeAuditPayload(input, { maxString: 100 });
    assert.ok(String(out.note).length < 2000);
    assert.ok(String(out.note).includes("truncated"));
  });

  it("handles circular input", () => {
    const a = { name: "a" };
    a.self = a;
    const out = sanitizeAuditPayload(a);
    assert.equal(out.self, "[Circular]");
  });
});

