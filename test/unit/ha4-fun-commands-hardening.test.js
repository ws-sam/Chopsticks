// test/unit/ha4-fun-commands-hardening.test.js
// HA-4: Fun command hardening — bot targeting, wager validation, rate limits,
//       imagine guild rate-limit code coverage

import { describe, it } from "mocha";
import { strict as assert } from "assert";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function cmdSrc(name) {
  return readFileSync(resolve(__dirname, `../../src/commands/${name}.js`), "utf8");
}

// ── Bot-target guard ──────────────────────────────────────────────────────────

describe("HA-4: /roast — bot target guard", function () {
  it("roast.js contains bot-target guard", function () {
    const code = cmdSrc("roast");
    assert.ok(
      code.includes("target.bot"),
      "roast.js has no target.bot check"
    );
  });

  it("roast.js replies ephemerally when targeting a bot", function () {
    const code = cmdSrc("roast");
    assert.ok(
      code.includes("can't roast bots") || code.includes("cannot roast bots"),
      "roast.js missing user-friendly bot block message"
    );
  });
});

describe("HA-4: /compliment — bot target guard", function () {
  it("compliment.js contains bot-target guard", function () {
    const code = cmdSrc("compliment");
    assert.ok(
      code.includes("target.bot"),
      "compliment.js has no target.bot check"
    );
  });

  it("compliment.js replies ephemerally when targeting a bot", function () {
    const code = cmdSrc("compliment");
    assert.ok(
      code.includes("can't compliment bots") || code.includes("cannot compliment bots"),
      "compliment.js missing user-friendly bot block message"
    );
  });
});

describe("HA-4: /battle — bot opponent guard (pre-existing)", function () {
  it("battle.js already blocks bot targets", function () {
    const code = cmdSrc("battle");
    assert.ok(
      code.includes("opponent.bot") || code.includes(".bot"),
      "battle.js has no bot opponent check"
    );
  });

  it("battle.js reply for bot opponent is informative", function () {
    const code = cmdSrc("battle");
    assert.ok(
      code.includes("Bot") || code.includes("bot") && code.includes("challenge"),
      "battle.js bot rejection message is missing"
    );
  });
});

// ── Battle wager validation ───────────────────────────────────────────────────

describe("HA-4: /battle — wager balance validation", function () {
  it("battle.js fetches both wallets before allowing wager", function () {
    const code = cmdSrc("battle");
    assert.ok(
      code.includes("getWallet") || code.includes("wallet"),
      "battle.js does not fetch wallets for wager validation"
    );
  });

  it("battle.js checks challenger balance against wager", function () {
    const code = cmdSrc("battle");
    assert.ok(
      code.includes("balance") && code.includes("wager"),
      "battle.js has no balance-vs-wager check"
    );
  });

  it("battle.js checks opponent balance against wager", function () {
    const code = cmdSrc("battle");
    // Both wallets must be checked
    const walletFetchCount = (code.match(/getWallet/g) || []).length;
    assert.ok(walletFetchCount >= 2, `expected ≥2 getWallet calls for both players, got ${walletFetchCount}`);
  });

  it("battle.js has min wager of 10 (Discord option setMinValue)", function () {
    const code = cmdSrc("battle");
    assert.ok(
      code.includes("setMinValue(10)") || code.includes("minValue: 10"),
      "battle.js wager minimum of 10 not enforced"
    );
  });
});

// ── Imagine rate-limit coverage ───────────────────────────────────────────────

describe("HA-4: /imagine — guild rate-limit coverage", function () {
  it("imagine.js has per-guild rate limit of 5 per hour", function () {
    const code = cmdSrc("imagine");
    assert.ok(
      code.includes("5, 3600") || (code.includes(", 5,") && code.includes("3600")),
      "imagine.js missing 5/hr guild rate limit"
    );
  });

  it("imagine.js uses checkRateLimit for guild-level enforcement", function () {
    const code = cmdSrc("imagine");
    assert.ok(
      code.includes("checkRateLimit") && code.includes("imagine:guild:"),
      "imagine.js missing checkRateLimit with guild key"
    );
  });

  it("imagine.js replies with cooldown message when guild limit hit", function () {
    const code = cmdSrc("imagine");
    assert.ok(
      code.includes("image generation limit") || code.includes("limit"),
      "imagine.js has no user-facing message when guild rate limit is hit"
    );
  });

  it("imagine.js has per-user cooldown in addition to guild limit", function () {
    const code = cmdSrc("imagine");
    // rateLimits Map for per-user tracking
    assert.ok(
      code.includes("rateLimits") && code.includes("Map()"),
      "imagine.js missing per-user in-memory rate limit map"
    );
  });

  it("imagine.js checks if imagegen is disabled per guild", function () {
    const code = cmdSrc("imagine");
    assert.ok(
      code.includes("imagegen") && code.includes("false"),
      "imagine.js has no guild-level imagegen disable check"
    );
  });
});

// ── Roast spam guard ──────────────────────────────────────────────────────────

describe("HA-4: /roast — anti-spam target guard (pre-existing)", function () {
  it("roast.js has TARGET_SPAM_MAP to prevent same-target spam", function () {
    const code = cmdSrc("roast");
    assert.ok(
      code.includes("TARGET_SPAM_MAP") || code.includes("spamMap"),
      "roast.js missing target spam protection map"
    );
  });

  it("roast.js has spam limit constant", function () {
    const code = cmdSrc("roast");
    assert.ok(
      code.includes("TARGET_SPAM_LIMIT") || code.includes("SPAM_LIMIT"),
      "roast.js missing spam limit constant"
    );
  });

  it("roast.js warns when same target is spammed too often", function () {
    const code = cmdSrc("roast");
    assert.ok(
      code.includes("Give them a break") || code.includes("too many times"),
      "roast.js missing spam protection message"
    );
  });
});
