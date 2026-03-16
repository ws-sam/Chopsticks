# Chopsticks System Overview

> **Note for agents**: This file belongs in `~/chopsticks/SYSTEM_OVERVIEW.md`.
> Currently stored in `~/main/chopsticks-context/` because `~/chopsticks` is root-owned.

---

## One Line

Chopsticks is a production Discord bot maintained by goot27, serving the Egg Fried Rice community.

---

## What It Does

| Capability | Technology |
|------------|-----------|
| Music playback in Discord voice channels | Lavalink (Java audio server) |
| Reverse proxy / HTTPS | Caddy |
| Metrics collection | Prometheus |
| Observability dashboards | Grafana |
| Bot logic / commands | Maintained in goot27's source repo |

---

## Deployment Stack

```
Discord API
    ↓
Chopsticks Bot (source repo, goot27/github)
    ↓
Lavalink (audio server) ← ~/chopsticks/lavalink/
    ↓
Caddy (reverse proxy)   ← ~/chopsticks/Caddyfile
    ↓
Prometheus + Grafana    ← ~/chopsticks/monitoring/
```

---

## Ecosystem Position

```
WokSpec ecosystem
└── Chopsticks (contributor project — goot27)
    ├── Affiliated but independent
    ├── Not integrated with core infrastructure
    └── Maintained and owned by goot27
```

---

## Key Contacts

- **Maintainer**: goot27 (`github.com/goot27`)
- **Community**: Egg Fried Rice Discord (`discord.gg/B7Bhuherkn`)

---

## For Agents

- This is a **contributor project**. Treat it as independent.
- The `~/chopsticks` directory is **infrastructure config only**.
- Bot source code lives in goot27's GitHub repo.
- Do not modify deployment config without goot27's direction.
