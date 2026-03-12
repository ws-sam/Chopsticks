#!/usr/bin/env node
/**
 * scripts/verify-setup.js
 * Verification script for Chopsticks self-hosters.
 * Checks environment, DB connection, Redis, and Lavalink.
 */

import "dotenv/config";
import pg from "pg";
import Redis from "ioredis";
import http from "http";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m"
};

const print = (msg) => console.log(msg);
const success = (msg) => console.log(`${colors.green}✓ ${msg}${colors.reset}`);
const warn = (msg) => console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`);
const error = (msg) => console.log(`${colors.red}✗ ${msg}${colors.reset}`);
const info = (msg) => console.log(`${colors.blue}ℹ ${msg}${colors.reset}`);

async function main() {
  print(`\n${colors.bold}${colors.cyan}Chopsticks Verification Tool${colors.reset}\n`);

  // 1. Node.js version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0]);
  if (major >= 20) {
    success(`Node.js version: ${nodeVersion}`);
  } else {
    error(`Node.js version too low: ${nodeVersion}. Required: 20+ (LTS 22 recommended)`);
  }

  // 2. .env check
  if (existsSync(".env")) {
    success(".env file found");
  } else {
    error(".env file missing. Copy .env.example to .env and fill in values.");
  }

  // 3. Required environment variables
  const requiredVars = ["DISCORD_TOKEN", "CLIENT_ID", "POSTGRES_URL", "REDIS_URL"];
  let allVars = true;
  for (const v of requiredVars) {
    if (process.env[v]) {
      // mask token
      const val = v.includes("TOKEN") || v.includes("URL") ? "***" : process.env[v];
      // success(`${v} is set`);
    } else {
      error(`${v} is missing in .env`);
      allVars = false;
    }
  }
  if (allVars) success("Required environment variables are set");

  // 4. PostgreSQL connection
  if (process.env.POSTGRES_URL) {
    const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
    try {
      const start = Date.now();
      await pool.query("SELECT 1");
      success(`PostgreSQL connection successful (${Date.now() - start}ms)`);
    } catch (e) {
      error(`PostgreSQL connection failed: ${e.message}`);
    } finally {
      await pool.end();
    }
  }

  // 5. Redis connection
  if (process.env.REDIS_URL) {
    const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 3000 });
    try {
      const start = Date.now();
      await redis.connect();
      success(`Redis connection successful (${Date.now() - start}ms)`);
    } catch (e) {
      error(`Redis connection failed: ${e.message}`);
    } finally {
      redis.disconnect();
    }
  }

  // 6. Lavalink check (basic HTTP check)
  const host = process.env.LAVALINK_HOST || "localhost";
  const port = process.env.LAVALINK_PORT || 2333;
  const pass = process.env.LAVALINK_PASSWORD || "youshallnotpass";
  
  info(`Checking Lavalink at http://${host}:${port}...`);
  try {
    const options = {
      hostname: host,
      port: port,
      path: "/version",
      method: "GET",
      headers: { "Authorization": pass },
      timeout: 3000
    };

    const req = http.request(options, (res) => {
      if (res.statusCode === 200) {
        success("Lavalink is reachable and authenticated");
      } else {
        warn(`Lavalink returned status ${res.statusCode}. Check password?`);
      }
    });

    req.on("error", (e) => {
      warn(`Lavalink connection failed: ${e.message}. This is expected if using Docker without exposing ports to host.`);
    });
    
    req.on("timeout", () => {
      req.destroy();
      warn("Lavalink connection timed out.");
    });

    req.end();
  } catch (e) {
    warn(`Lavalink check skipped or failed: ${e.message}`);
  }

  // 7. Command registry check
  try {
    const files = (await import("fs")).readdirSync("src/commands").filter(f => f.endsWith(".js"));
    success(`Command surface: ${files.length} command groups found in src/commands/`);
  } catch (e) {
    error(`Failed to read src/commands: ${e.message}`);
  }

  print(`\n${colors.bold}${colors.cyan}Verification complete.${colors.reset}\n`);
  print(`Next steps:`);
  print(`1. Deploy slash commands:  ${colors.blue}npm run deploy${colors.reset}`);
  print(`2. Start the bot:          ${colors.blue}npm start${colors.reset}`);
  print("");
}

main().catch(e => {
  error(`Unexpected error: ${e.message}`);
  process.exit(1);
});
