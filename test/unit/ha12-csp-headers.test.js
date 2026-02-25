// test/unit/ha12-csp-headers.test.js
// HA-12: CSP must include Google Fonts origins for dashboard guild.html

import { describe, it } from "mocha";
import { strict as assert } from "assert";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cspSrc = readFileSync(resolve(__dirname, "../../src/dashboard/securityMiddleware.js"), "utf8");

describe("HA-12: CSP directives — Google Fonts sources", function () {
  it("styleSrc includes fonts.googleapis.com", function () {
    const match = cspSrc.match(/styleSrc\s*:\s*\[([^\]]+)\]/);
    assert.ok(match, "styleSrc directive not found");
    assert.ok(match[1].includes("fonts.googleapis.com"), "styleSrc missing fonts.googleapis.com");
  });

  it("fontSrc includes fonts.gstatic.com", function () {
    const match = cspSrc.match(/fontSrc\s*:\s*\[([^\]]+)\]/);
    assert.ok(match, "fontSrc directive not found");
    assert.ok(match[1].includes("fonts.gstatic.com"), "fontSrc missing fonts.gstatic.com");
  });

  it("connectSrc includes fonts.googleapis.com for font metadata requests", function () {
    const match = cspSrc.match(/connectSrc\s*:\s*\[([^\]]+)\]/);
    assert.ok(match, "connectSrc directive not found");
    assert.ok(match[1].includes("fonts.googleapis.com"), "connectSrc missing fonts.googleapis.com");
  });

  it("objectSrc is 'none' (prevents plugin-based attacks)", function () {
    const match = cspSrc.match(/objectSrc\s*:\s*\[([^\]]+)\]/);
    assert.ok(match, "objectSrc directive not found");
    assert.ok(match[1].includes("'none'"), "objectSrc should be 'none'");
  });

  it("frameSrc is 'none' (prevents clickjacking via frame embedding)", function () {
    const match = cspSrc.match(/frameSrc\s*:\s*\[([^\]]+)\]/);
    assert.ok(match, "frameSrc directive not found");
    assert.ok(match[1].includes("'none'"), "frameSrc should be 'none'");
  });

  it("scriptSrc does NOT include 'unsafe-eval'", function () {
    const match = cspSrc.match(/scriptSrc\s*:\s*\[([^\]]+)\]/);
    assert.ok(match, "scriptSrc directive not found");
    assert.ok(!match[1].includes("unsafe-eval"), "scriptSrc must not include 'unsafe-eval'");
  });

  it("HSTS maxAge is at least 1 year (31536000)", function () {
    const match = cspSrc.match(/maxAge\s*:\s*(\d+)/);
    assert.ok(match, "HSTS maxAge not found");
    assert.ok(parseInt(match[1]) >= 31536000, `HSTS maxAge ${match[1]} is less than 1 year`);
  });

  it("HSTS includes includeSubDomains and preload", function () {
    assert.ok(cspSrc.includes("includeSubDomains"), "HSTS missing includeSubDomains");
    assert.ok(cspSrc.includes("preload"), "HSTS missing preload");
  });

  it("referrerPolicy is strict-origin-when-cross-origin", function () {
    assert.ok(
      cspSrc.includes("strict-origin-when-cross-origin"),
      "referrerPolicy missing strict-origin-when-cross-origin"
    );
  });

  it("guild.html links reference fonts.googleapis.com (matches CSP)", function () {
    const html = readFileSync(resolve(__dirname, "../../src/dashboard/public/guild.html"), "utf8");
    const hasGoogleFont = html.includes("fonts.googleapis.com");
    const cspCoversIt = cspSrc.includes("fonts.googleapis.com");
    if (hasGoogleFont) {
      assert.ok(cspCoversIt, "guild.html uses Google Fonts but CSP does not allow fonts.googleapis.com");
    }
    // If guild.html doesn't use google fonts, just pass
  });
});
