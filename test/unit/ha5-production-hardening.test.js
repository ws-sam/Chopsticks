// test/unit/ha5-production-hardening.test.js
// HA-5: Production hardening audit — shutdown sequence order, session cookie flags

import { describe, it } from "mocha";
import { strict as assert } from "assert";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function src(relPath) {
  return readFileSync(resolve(__dirname, `../../${relPath}`), "utf8");
}

// ── Shutdown sequence ─────────────────────────────────────────────────────────

describe("HA-5: shutdown sequence — correct flush-before-close ordering", function () {
  const code = src("src/index.js");

  it("flushCommandStats is called during shutdown", function () {
    assert.ok(
      code.includes("flushCommandStats"),
      "flushCommandStats not called in shutdown"
    );
  });

  it("flushCommandStats is called before closeRedis", function () {
    const flushPos  = code.indexOf("flushCommandStats");
    const redisPos  = code.indexOf("closeRedis");
    assert.ok(flushPos > 0, "flushCommandStats not found");
    assert.ok(redisPos > 0, "closeRedis not found");
    assert.ok(flushPos < redisPos, "flushCommandStats must be called before closeRedis");
  });

  it("flushCommandStats is called before closeStoragePg", function () {
    const flushPos = code.indexOf("flushCommandStats");
    const pgPos    = code.indexOf("closeStoragePg");
    assert.ok(pgPos > 0, "closeStoragePg not found");
    assert.ok(flushPos < pgPos, "flushCommandStats must be called before closeStoragePg");
  });

  it("closeRedis is called before closeStoragePg", function () {
    const redisPos = code.indexOf("closeRedis");
    const pgPos    = code.indexOf("closeStoragePg");
    assert.ok(redisPos < pgPos, "Redis should close before PostgreSQL pool");
  });

  it("shutdown clears both flushTimer and presenceTimer before DB operations", function () {
    const shutdownBlock = code.slice(code.indexOf("shutdown = async"));
    const clearFlushPos    = shutdownBlock.indexOf("clearInterval(flushTimer)");
    const clearPresencePos = shutdownBlock.indexOf("clearInterval(presenceTimer)");
    const closeDbPos       = shutdownBlock.indexOf("closeStoragePg");
    assert.ok(clearFlushPos < closeDbPos, "flushTimer should be cleared before DB close");
    assert.ok(clearPresencePos < closeDbPos, "presenceTimer should be cleared before DB close");
  });

  it("force-exit timeout is set as fallback (prevents hang)", function () {
    assert.ok(
      code.includes("setTimeout") && code.includes("process.exit(0)"),
      "no force-exit fallback in shutdown"
    );
  });

  it("shutdown registers both SIGINT and SIGTERM handlers", function () {
    assert.ok(code.includes('"SIGINT"') || code.includes("'SIGINT'"), "no SIGINT handler");
    assert.ok(code.includes('"SIGTERM"') || code.includes("'SIGTERM'"), "no SIGTERM handler");
  });
});

// ── Session cookie security ───────────────────────────────────────────────────

describe("HA-5: session cookie flags — httpOnly, sameSite, secure", function () {
  const dashCode = src("src/dashboard/server.js");

  it("cookie.httpOnly is true", function () {
    assert.ok(
      dashCode.includes("httpOnly: true"),
      "session cookie httpOnly flag not set"
    );
  });

  it("cookie.sameSite is 'lax' or 'strict'", function () {
    assert.ok(
      dashCode.includes('sameSite: "lax"') ||
      dashCode.includes("sameSite: 'lax'") ||
      dashCode.includes('sameSite: "strict"') ||
      dashCode.includes("sameSite: 'strict'"),
      "cookie sameSite is not set to lax or strict"
    );
  });

  it("cookie.secure is configurable (not hard-coded false)", function () {
    const cookieBlock = dashCode.slice(dashCode.indexOf("cookie: {"), dashCode.indexOf("maxAge:") + 50);
    // secure should reference a variable, not be literal false
    assert.ok(
      cookieBlock.includes("cookieSecure") || cookieBlock.includes("process.env"),
      "cookie secure should be driven by env var, not hardcoded"
    );
  });

  it("cookie.secure env var defaults to false for non-HTTPS environments", function () {
    assert.ok(
      dashCode.includes("DASHBOARD_COOKIE_SECURE"),
      "DASHBOARD_COOKIE_SECURE env var not used"
    );
  });

  it("session has a maxAge (sessions expire)", function () {
    assert.ok(
      dashCode.includes("maxAge:"),
      "session cookie has no maxAge — sessions never expire"
    );
  });

  it("session secret is read from env var", function () {
    assert.ok(
      dashCode.includes("DASHBOARD_SESSION_SECRET"),
      "session secret is not configured via env var"
    );
  });

  it("CSRF token is generated for sessions", function () {
    assert.ok(
      dashCode.includes("csrfToken"),
      "no CSRF token in session management"
    );
  });
});

// ── .env validation ───────────────────────────────────────────────────────────

describe("HA-5: .env.example coverage", function () {
  it(".env.example exists and documents DASHBOARD_SESSION_SECRET", function () {
    let envExample;
    try {
      envExample = src(".env.example");
    } catch {
      // .env.example might not exist
      assert.fail(".env.example file not found — required for self-hosting docs");
    }
    assert.ok(
      envExample.includes("DASHBOARD_SESSION_SECRET"),
      ".env.example missing DASHBOARD_SESSION_SECRET"
    );
  });

  it(".env.example documents DASHBOARD_COOKIE_SECURE", function () {
    let envExample;
    try {
      envExample = src(".env.example");
    } catch {
      assert.fail(".env.example not found");
    }
    assert.ok(
      envExample.includes("DASHBOARD_COOKIE_SECURE"),
      ".env.example missing DASHBOARD_COOKIE_SECURE"
    );
  });
});
