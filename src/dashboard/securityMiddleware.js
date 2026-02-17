import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import hpp from "hpp";
import { createApiRateLimiter } from "../utils/modernRateLimiter.js";
import { dashboardLogger } from "../utils/modernLogger.js";

function parseOrigins(raw) {
  const list = String(raw || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return list;
}

const SENSITIVE_KEY_RE =
  /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|private|key)$/i;

function truncateString(s, max = 512) {
  const t = String(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…(truncated)`;
}

export function sanitizeAuditPayload(input, opts = {}) {
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 6;
  const maxArray = Number.isFinite(opts.maxArray) ? opts.maxArray : 50;
  const maxString = Number.isFinite(opts.maxString) ? opts.maxString : 512;

  const seen = new WeakSet();

  function walk(value, depth) {
    if (value == null) return value;
    if (typeof value === "string") return truncateString(value, maxString);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return String(value);
    if (typeof value === "function") return "[Function]";
    if (typeof value !== "object") return String(value);

    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (depth >= maxDepth) return "[MaxDepth]";

    if (Array.isArray(value)) {
      const out = [];
      const n = Math.min(value.length, maxArray);
      for (let i = 0; i < n; i += 1) out.push(walk(value[i], depth + 1));
      if (value.length > n) out.push(`[TruncatedArray:${value.length - n}]`);
      return out;
    }

    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = walk(v, depth + 1);
      }
    }
    return out;
  }

  return walk(input, 0);
}

// Corporate-grade Express security middleware stack
export function applySecurityMiddleware(app) {
  app.disable("x-powered-by");

  // 1. Helmet - Secure HTTP headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "https://cdn.discordapp.com"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: {
      action: "deny",
    },
    referrerPolicy: {
      policy: "strict-origin-when-cross-origin",
    },
  }));

  // 2. CORS - Controlled cross-origin requests
  const envOrigins = parseOrigins(process.env.ALLOWED_ORIGINS);
  let defaultOrigins = ["http://localhost:3000"];
  const base = String(process.env.DASHBOARD_BASE_URL || "").trim();
  if (base) {
    try {
      defaultOrigins = [new URL(base).origin];
    } catch {}
  }

  const corsOptions = {
    origin: envOrigins.length ? envOrigins : defaultOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 86400, // 24 hours
  };
  app.use(cors(corsOptions));

  // 3. HPP - HTTP Parameter Pollution prevention
  app.use(hpp());

  // 4. Compression - Brotli/Gzip response compression
  app.use(compression({
    level: 6,
    threshold: 1024, // Only compress responses > 1KB
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) {
        return false;
      }
      return compression.filter(req, res);
    },
  }));

  // 5. Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    
    res.on("finish", () => {
      const duration = Date.now() - start;
      dashboardLogger.info({
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      }, "HTTP Request");
    });
    
    next();
  });

  // 6. Rate limiting (10 req/sec per IP)
  app.use("/api", createApiRateLimiter({
    keyPrefix: "rl:dashboard:",
    points: 100,
    duration: 60,
    blockDuration: 300,
    keyGenerator: (req) => req.ip || req.connection.remoteAddress,
  }));

  // 7. Sensitive endpoints get stricter rate limits
  app.use("/api/admin", createApiRateLimiter({
    keyPrefix: "rl:admin:",
    points: 20,
    duration: 60,
    blockDuration: 600,
  }));

  // 8. JSON body size limit
  app.use((req, res, next) => {
    const cl = Number(req.get("content-length") || 0);
    if (req.is("json") && Number.isFinite(cl) && cl > 1048576) { // 1MB limit
      return res.status(413).json({ error: "Payload too large" });
    }
    next();
  });

  // 9. Security headers for all responses
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });

  dashboardLogger.info("Security middleware stack applied");
}

// Enhanced admin authentication middleware
export function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    dashboardLogger.warn({ ip: req.ip, url: req.url }, "Unauthorized admin access attempt");
    return res.status(401).json({ error: "Unauthorized - Please login" });
  }

  const adminIds = (process.env.DASHBOARD_ADMIN_IDS || "").split(",").map(id => id.trim());
  
  if (!adminIds.includes(req.session.user.id)) {
    dashboardLogger.error(
      { userId: req.session.user.id, ip: req.ip, url: req.url },
      "Non-admin user attempted admin action"
    );
    return res.status(403).json({ error: "Forbidden - Admin access required" });
  }

  next();
}

// Audit log middleware for sensitive actions
export function auditLog(action) {
  return (req, res, next) => {
    dashboardLogger.info({
      action,
      userId: req.session?.user?.id,
      ip: req.ip,
      body: sanitizeAuditPayload(req.body),
      params: req.params,
      timestamp: new Date().toISOString(),
    }, "Audit Log");
    
    next();
  };
}

export default { applySecurityMiddleware, requireAdmin, auditLog };
