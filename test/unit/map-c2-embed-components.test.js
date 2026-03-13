/**
 * MAP Cycle 2 — Embed Component Library Tests
 * Tests for src/utils/embedComponents.js
 */

import { describe, it } from "mocha";
import { strict as assert } from "assert";
import {
  progressBar,
  inventoryGrid,
  agentStatusPanel,
  economyCard,
  musicNowPlaying,
} from "../../src/utils/embedComponents.js";

// ── progressBar ───────────────────────────────────────────────────────────────

describe("MAP-C2 — progressBar()", function () {
  it("returns all filled at 100%", function () {
    const r = progressBar(100, 100, 10);
    assert.ok(r.startsWith("██████████"), `expected all filled, got: ${r}`);
    assert.ok(r.includes("100%"));
  });

  it("returns all empty at 0%", function () {
    const r = progressBar(0, 100, 10);
    assert.ok(r.startsWith("░░░░░░░░░░"), `expected all empty, got: ${r}`);
    assert.ok(r.includes("0%"));
  });

  it("returns ~half filled at 50%", function () {
    const r = progressBar(50, 100, 10);
    assert.ok(r.startsWith("█████░░░░░"), `expected half filled, got: ${r}`);
    assert.ok(r.includes("50%"));
  });

  it("clamps values above max", function () {
    const r = progressBar(200, 100, 10);
    assert.ok(r.includes("100%"), "should clamp to 100%");
  });

  it("clamps negative values to 0%", function () {
    const r = progressBar(-5, 100, 10);
    assert.ok(r.includes("0%"), "negative value should clamp to 0%");
  });

  it("handles max=0 gracefully", function () {
    const r = progressBar(0, 0, 10);
    assert.ok(r.includes("0%"), "max=0 should return 0%");
  });

  it("respects custom width", function () {
    const r = progressBar(50, 100, 20);
    // 10 filled + 10 empty + " 50%"
    const barPart = r.split(" ")[0];
    assert.equal(barPart.length, 20, `expected width 20, got: ${barPart.length}`);
  });
});

// ── inventoryGrid ─────────────────────────────────────────────────────────────

describe("MAP-C2 — inventoryGrid()", function () {
  it("returns placeholder for empty array", function () {
    assert.equal(inventoryGrid([]), "_Nothing here._");
  });

  it("formats items with qty", function () {
    const r = inventoryGrid([{ name: "Sword", qty: 3 }], 1);
    assert.ok(r.includes("Sword"), "should include item name");
    assert.ok(r.includes("×3"), "should include quantity");
  });

  it("formats items with emoji", function () {
    const r = inventoryGrid([{ name: "Apple", qty: 1, emoji: "🍎" }], 1);
    assert.ok(r.includes("🍎"), "should include emoji");
    assert.ok(r.includes("Apple"), "should include name");
  });

  it("splits into cols columns", function () {
    const items = [
      { name: "A", qty: 1 },
      { name: "B", qty: 2 },
      { name: "C", qty: 3 },
      { name: "D", qty: 4 },
    ];
    const r = inventoryGrid(items, 2);
    const rows = r.split("\n");
    assert.equal(rows.length, 2, "should have 2 rows for 4 items in 2 cols");
    assert.ok(rows[0].includes("│"), "row should have separator");
  });

  it("works with single column", function () {
    const items = [{ name: "X", qty: 1 }, { name: "Y", qty: 2 }];
    const r = inventoryGrid(items, 1);
    const rows = r.split("\n");
    assert.equal(rows.length, 2);
    assert.ok(!rows[0].includes("│"), "single col should have no separator");
  });
});

// ── agentStatusPanel ──────────────────────────────────────────────────────────

describe("MAP-C2 — agentStatusPanel()", function () {
  const mockAgents = [
    { id: "agent-001-abcd", status: "active", podTag: "general" },
    { id: "agent-002-efgh", status: "busy",   podTag: "music" },
    { id: "agent-003-ijkl", status: "idle",   podTag: "general" },
  ];

  it("returns an EmbedBuilder", function () {
    const embed = agentStatusPanel(mockAgents);
    assert.ok(embed && typeof embed.toJSON === "function", "should return EmbedBuilder");
  });

  it("embed title contains 'Agent Pool Status'", function () {
    const json = agentStatusPanel(mockAgents).toJSON();
    assert.ok(json.title.includes("Agent Pool Status"));
  });

  it("footer shows slot usage", function () {
    const json = agentStatusPanel(mockAgents, 49).toJSON();
    assert.ok(json.footer.text.includes("3/49"), `expected '3/49' in footer: ${json.footer.text}`);
  });

  it("shows correct active/busy/idle counts in fields", function () {
    const json = agentStatusPanel(mockAgents).toJSON();
    const fields = json.fields;
    const activeField = fields.find(f => f.name === "Active");
    const busyField   = fields.find(f => f.name === "Busy");
    const idleField   = fields.find(f => f.name === "Idle");
    assert.equal(activeField?.value, "1");
    assert.equal(busyField?.value, "1");
    assert.equal(idleField?.value, "1");
  });

  it("handles empty agent list", function () {
    const json = agentStatusPanel([]).toJSON();
    assert.ok(json.description.includes("No agents"), "empty description expected");
  });

  it("truncates to 10 visible agents with overflow note", function () {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `agent-${i.toString().padStart(3, "0")}-xxxx`,
      status: "idle",
    }));
    const json = agentStatusPanel(many).toJSON();
    const lines = json.description.split("\n");
    // 10 agent lines + 1 overflow line
    assert.equal(lines.length, 11, `expected 11 lines, got ${lines.length}`);
    assert.ok(lines[10].includes("5 more"), "should show overflow count");
  });
});

// ── economyCard ───────────────────────────────────────────────────────────────

describe("MAP-C2 — economyCard()", function () {
  it("returns an EmbedBuilder", function () {
    const embed = economyCard({ wallet: 500, bank: 1000 });
    assert.ok(embed && typeof embed.toJSON === "function");
  });

  it("includes wallet and bank in fields", function () {
    const json = economyCard({ wallet: 500, bank: 1000 }).toJSON();
    const walletField = json.fields.find(f => f.name.includes("Wallet"));
    const bankField   = json.fields.find(f => f.name.includes("Bank"));
    assert.ok(walletField?.value.includes("500"));
    assert.ok(bankField?.value.includes("1,000"));
  });

  it("calculates net worth", function () {
    const json = economyCard({ wallet: 500, bank: 1000 }).toJSON();
    const netField = json.fields.find(f => f.name.includes("Net Worth"));
    assert.ok(netField?.value.includes("1,500"), `expected 1,500 in: ${netField?.value}`);
  });

  it("shows username in title when provided", function () {
    const json = economyCard({ wallet: 0, bank: 0, username: "TestUser" }).toJSON();
    assert.ok(json.title.includes("TestUser"));
  });

  it("shows XP bar when xp > 0", function () {
    const json = economyCard({ wallet: 0, bank: 0, xp: 500 }).toJSON();
    const xpField = json.fields.find(f => f.name.includes("XP") || f.name.includes("Level"));
    assert.ok(xpField, "should have XP field");
    assert.ok(xpField.value.includes("500"));
  });

  it("shows level in XP field name when provided", function () {
    const json = economyCard({ wallet: 0, bank: 0, xp: 100, level: 5 }).toJSON();
    const xpField = json.fields.find(f => f.name.includes("Level 5"));
    assert.ok(xpField, "should have 'Level 5' in field name");
  });

  it("handles defaults gracefully", function () {
    const json = economyCard().toJSON();
    assert.ok(json.title.includes("Economy"));
  });
});

// ── musicNowPlaying ───────────────────────────────────────────────────────────

describe("MAP-C2 — musicNowPlaying()", function () {
  it("returns an EmbedBuilder", function () {
    const embed = musicNowPlaying({ title: "Test Song" });
    assert.ok(embed && typeof embed.toJSON === "function");
  });

  it("title is 'Now Playing'", function () {
    const json = musicNowPlaying({ title: "Test Song" }).toJSON();
    assert.equal(json.title, "🎵 Now Playing");
  });

  it("description contains track title", function () {
    const json = musicNowPlaying({ title: "Never Gonna Give You Up" }).toJSON();
    assert.ok(json.description.includes("Never Gonna Give You Up"));
  });

  it("makes title a hyperlink when url is provided", function () {
    const json = musicNowPlaying({ title: "Song", url: "https://example.com" }).toJSON();
    assert.ok(json.description.includes("https://example.com"));
  });

  it("shows duration as formatted time", function () {
    const json = musicNowPlaying({ title: "Song", duration: 180000, position: 60000 }).toJSON();
    const durationField = json.fields.find(f => f.name === "Duration");
    assert.ok(durationField, "should have Duration field");
    assert.ok(durationField.value.includes("1:00"), "should show position 1:00");
    assert.ok(durationField.value.includes("3:00"), "should show duration 3:00");
  });

  it("shows requestedBy in footer", function () {
    const json = musicNowPlaying({ title: "Song", requestedBy: "WokSpec" }).toJSON();
    assert.ok(json.footer?.text.includes("WokSpec"));
  });

  it("handles missing fields gracefully", function () {
    const json = musicNowPlaying().toJSON();
    assert.ok(json.title);
  });
});
