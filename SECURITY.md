# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x (latest) | ✅ |
| < 1.0 | ❌ |

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

To report a vulnerability, contact the maintainers directly:

1. Open a [GitHub Security Advisory](https://github.com/wokspec/Chopsticks/security/advisories/new) (preferred — private by default)
2. Or contact the maintainers via the [Support Discord](https://discord.gg/YOUR_INVITE) in a private message

### What to include

- A clear description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept if possible)
- Affected version/commit and environment (Docker, bare metal, OS)
- Whether agents, pools, the dashboard, or the database are involved

### What to expect

- Acknowledgement within 48 hours
- A fix or mitigation within 7 days for critical issues
- Credit in the changelog if desired

---

## Credential Safety

If you accidentally expose any of the following, **treat them as compromised and rotate immediately**:

| Secret | Where to rotate |
|--------|----------------|
| `DISCORD_TOKEN` | [Discord Developer Portal](https://discord.com/developers/applications) → Bot → Reset Token |
| Agent bot tokens | `/agents revoke` in Discord, then reset in the Discord Developer Portal |
| `AGENT_TOKEN_KEY` | Rotate in `.env`, restart bot — existing tokens will re-encrypt lazily |
| `POSTGRES_PASSWORD` | Rotate in `.env` and database |
| Dashboard `SESSION_SECRET` | Rotate in `.env`, restart dashboard |

---

## Scope

The following are considered in-scope for security reports:

- Token extraction from the database or API responses
- Privilege escalation in the pool permission model (accessing another user's pool)
- SQL injection or authentication bypass
- Sensitive data exposure in Discord embeds or logs

The following are **out of scope**:

- Self-XSS
- Rate limit bypass on non-sensitive endpoints
- Issues requiring physical access to the host machine


