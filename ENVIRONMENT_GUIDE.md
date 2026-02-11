# Chopsticks Environment Configuration Guide

## Quick Start

Your `.env` file has been configured with comprehensive settings. Here's what you need to know:

## ✅ Already Configured

These are ready to use:
- ✅ Discord bot credentials
- ✅ Database (PostgreSQL)
- ✅ Redis
- ✅ Lavalink (music service)
- ✅ Agent pooling system
- ✅ Voice services (STT/TTS/LLM)
- ✅ Secure session secrets (auto-generated)

## ⚠️ Needs Your Action

Update these values in `.env`:

### 1. Discord OAuth (for dashboard login)
```env
DISCORD_CLIENT_SECRET=your_client_secret_here
```
Get from: https://discord.com/developers/applications/1466382874587431036/oauth2

### 2. Redirect URI (when deploying to production)
```env
DISCORD_REDIRECT_URI=https://yourdomain.com/auth/callback
DASHBOARD_BASE_URL=https://yourdomain.com
```

### 3. API Passwords
```env
DEV_API_PASSWORD=changeme123        # Change this!
DEV_DASHBOARD_PASSWORD=changeme456  # Change this!
```

## 🔑 Security Tokens Generated

These were auto-generated securely:
- **Dashboard admin token**: `500eb557c871ccbc4bf7652fd8ec58c4c923eaf40737df071c456364d28bf4dc`
- **Session secret**: `79ec1e41d101b6941fc81db6f71bceab6ad0e1cf2b826b0c6110dbb3c3eba7a3`

## 📊 Key Features Configured

### Agent Pooling
- Control plane: `ws://main-bot:8787`
- Polling interval: 10s
- Stale agent timeout: 45s
- Session TTL: 1 hour (3600000ms)

### Music System
- Lavalink: `lavalink:2333` (password: `youshallnotpass`)
- Max queue: 100 songs
- Max track length: 60 minutes
- Default volume: 50%

### Voice Features
- STT: Whisper `small` model (CPU)
- LLM: Ollama `llama3.1:8b`
- TTS: Multiple presets available
- Channel creation cooldown: 3s

### Rate Limiting
- Per user: 30 commands/minute
- Per guild: 100 commands/minute
- Dashboard API: 100 requests/60s

## 🚀 Deployment Modes

### Development (Current)
```env
DEPLOY_MODE=development
NODE_ENV=development
DEBUG=false
LOG_LEVEL=info
```

### Production (Recommended)
```env
DEPLOY_MODE=production
NODE_ENV=production
DEBUG=false
LOG_LEVEL=warn
DASHBOARD_COOKIE_SECURE=true
```

## 🔧 Advanced Configuration

### Scaling Agents
```env
AGENT_RUNNER_POLL_INTERVAL_MS=10000    # How often to check for new agents
AGENT_RECONCILE_EVERY_MS=300000        # How often to sync agent state
AGENT_STALE_MS=45000                   # When to consider agent disconnected
```

### Database Tuning
```env
GUILD_CACHE_TTL_SEC=300    # Cache guild data for 5 minutes
VERBOSE_SQL=false          # Set true to debug SQL queries
```

### Voice Model Storage
```env
VOICE_MODEL_STORAGE_PATH=/app/data/voice-models
VOICE_MODEL_MAX_SIZE_MB=500
```

## 🛡️ Security Best Practices

1. **Never commit `.env` to git** - Already in `.gitignore`
2. **Rotate secrets regularly** - Especially `AGENT_TOKEN_KEY` and session secrets
3. **Use strong passwords** - Change default `DEV_API_PASSWORD`
4. **Enable HTTPS in production** - Set `DASHBOARD_COOKIE_SECURE=true`
5. **Restrict bot owner IDs** - Only trusted users in `BOT_OWNER_IDS`

## 📦 Service Dependencies

Your Docker stack requires these services:

| Service | Purpose | Port |
|---------|---------|------|
| main-bot | Discord bot + control plane | 8080, 3002, 8787 |
| agent-runner | Agent pool manager | - |
| postgres | Database | 5432 |
| redis | Caching | 6379 |
| lavalink | Music playback | 2333 |
| voice-stt | Speech-to-text | 9000 |
| voice-llm | AI conversation | 9001 |
| voice-tts | Text-to-speech | 9002 |
| ollama | LLM backend | 11434 |
| grafana | Monitoring dashboard | 3000 |
| prometheus | Metrics collection | 9090 |
| caddy | Reverse proxy | 80, 443 |

## 🔄 Apply Configuration

After editing `.env`:

```bash
# Rebuild images (if code changed)
docker compose -f docker-compose.stack.yml -f docker-compose.voice.yml -f docker-compose.override.yml build

# Restart services
docker compose -f docker-compose.stack.yml -f docker-compose.voice.yml -f docker-compose.override.yml up -d

# Verify
docker ps
docker logs chopsticks-main-bot --tail 50
```

## 🐛 Troubleshooting

### Agents not connecting?
Check: `AGENT_CONTROL_URL=ws://main-bot:8787`

### Music not working?
Check: `LAVALINK_HOST=lavalink` and `LAVALINK_PORT=2333`

### Voice features failing?
Check: Voice service URLs (`VOICE_ASSIST_*_URL`)

### Database errors?
Check: `DATABASE_URL` and ensure postgres container is running

## 📝 Environment Variables Reference

**Total configured**: 80+ variables
**Categories**:
- Discord Core (6)
- Database (5)
- Agent System (10)
- Voice Services (12)
- Security (8)
- Monitoring (6)
- Rate Limiting (4)
- Feature Flags (5)
- Logging (4)
- External APIs (4)
- Production (10+)

See `.env` for complete list with descriptions.
