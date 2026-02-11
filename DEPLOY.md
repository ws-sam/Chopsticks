# Quick Deployment Guide for Hetzner

## Prerequisites
- Hetzner account (https://console.hetzner.cloud/)
- SSH key pair generated on your laptop
- Your bot tokens ready

## Step 1: Create Server (5 minutes)

1. **Sign up/Login** to Hetzner Cloud Console
2. **Create new project**: "chopsticks-production"
3. **Add SSH key**:
   ```bash
   # On your laptop/WSL
   ssh-keygen -t ed25519 -C "chopsticks-deploy"
   cat ~/.ssh/id_ed25519.pub  # Copy this
   ```
   - Paste into Hetzner console → SSH Keys → Add SSH Key

4. **Create server**:
   - Location: Ashburn, VA (if US) or Nuremberg (if EU)
   - Image: Ubuntu 22.04
   - Type: **CPX31** (4 vCPU, 8GB RAM) - $13/month
   - Volume: No
   - Network: Default
   - Firewall: Create new
     - Allow: SSH (22), HTTP (80), HTTPS (443)
   - Backups: Optional (+20% cost, recommended for production)
   - Name: chopsticks-bot

5. **Wait ~1 minute** for server to provision

## Step 2: Initial Server Setup (10 minutes)

```bash
# On your laptop - SSH into server
ssh root@<your-server-ip>

# Download deployment script
curl -fsSL https://raw.githubusercontent.com/wokspecialists/chopsticks/main/scripts/deploy-hetzner.sh -o deploy.sh

# Run deployment script
sudo bash deploy.sh
```

This script will:
- Install Docker & Docker Compose
- Configure firewall
- Set up automatic backups
- Optimize system settings
- Create directories

## Step 3: Deploy Chopsticks (10 minutes)

```bash
# Switch to deploy directory
cd /opt/chopsticks

# Clone your repository
git clone https://github.com/wokspecialists/chopsticks.git .

# Create environment file
cp .env.example .env
nano .env
```

**Critical .env variables to set:**
```env
# Discord Bot
DISCORD_TOKEN=your_main_bot_token_here
DISCORD_CLIENT_ID=your_client_id

# Agent Management
AGENT_TOKEN_KEY=your_64_char_hex_key_here  # Generate: openssl rand -hex 32
AGENT_CONTROL_HOST=0.0.0.0
AGENT_CONTROL_PORT=8787

# PostgreSQL
POSTGRES_USER=chopsticks
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=chopsticks
DATABASE_URL=postgresql://chopsticks:your_secure_password_here@postgres:5432/chopsticks

# Lavalink
LAVALINK_HOST=lavalink
LAVALINK_PORT=2333
LAVALINK_PASSWORD=your_lavalink_password_here

# Redis (Optional)
REDIS_HOST=redis
REDIS_PORT=6379

# Resource Limits
MAX_AGENTS_PER_RUNNER=10
AGENT_RUNNER_POLL_INTERVAL_MS=10000

# Dashboard (Optional)
DASHBOARD_PORT=3000
DASHBOARD_SESSION_SECRET=your_session_secret_here
```

**Save and exit** (Ctrl+X, Y, Enter)

## Step 4: Start the Bot

```bash
# Start core services
docker compose -f docker-compose.production.yml up -d

# Check status
docker compose ps

# View logs
docker compose logs -f bot

# View agent logs
docker compose logs -f agents
```

**Expected output:**
```
✅ Ready as YourBotName#1234
📊 Serving X guilds
🧩 Agent control listening on ws://0.0.0.0:8787
✅ Database schema ensured.
```

## Step 5: Invite Bot to Server

```bash
# Generate invite link (replace with your client ID)
echo "https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=3147776&scope=bot%20applications.commands"
```

Open link in browser and invite bot to your test server.

## Step 6: Deploy Commands

```bash
# Inside server
cd /opt/chopsticks

# Deploy to your test guild (recommended first)
docker compose exec bot npm run deploy:guild

# Or deploy globally (takes up to 1 hour to propagate)
# docker compose exec bot npm run deploy:global
```

## Step 7: Test Music

In Discord:
```
/music play never gonna give you up
```

If it works, you're done! 🎉

## Monitoring & Maintenance

### Check resources
```bash
cd /opt/chopsticks
bash scripts/monitor-resources.sh
```

### View logs
```bash
# All logs
docker compose logs -f

# Just bot
docker compose logs -f bot

# Just agents
docker compose logs -f agents

# Last 100 lines
docker compose logs --tail=100
```

### Restart services
```bash
# Restart everything
docker compose restart

# Restart just bot
docker compose restart bot

# Restart agents
docker compose restart agents
```

### Update bot
```bash
cd /opt/chopsticks
git pull
docker compose down
docker compose build
docker compose up -d
```

### Check agent status
```bash
# Via database
docker exec chopsticks-postgres psql -U chopsticks -c "SELECT agent_id, tag, status FROM agent_bots;"

# Via logs
docker compose logs agents | grep "hello"
```

## Troubleshooting

### Bot not connecting
```bash
# Check if token is correct
docker compose exec bot env | grep DISCORD_TOKEN

# Check logs for errors
docker compose logs bot | grep -i error
```

### Agents not starting
```bash
# Check database for agent tokens
docker exec chopsticks-postgres psql -U chopsticks -c "SELECT COUNT(*) FROM agent_bots WHERE status='active';"

# Check agent runner logs
docker compose logs agents

# Verify agent tokens in database
docker exec chopsticks-postgres psql -U chopsticks -c "SELECT agent_id, tag FROM agent_bots LIMIT 5;"
```

### Music not working
```bash
# Check if Lavalink is running
docker compose ps lavalink

# Check Lavalink logs
docker compose logs lavalink

# Test Lavalink connection
curl http://localhost:2333/version
```

### Out of memory
```bash
# Check memory usage
free -h
docker stats --no-stream

# If needed, restart services
docker compose restart
```

### Database issues
```bash
# Check if PostgreSQL is running
docker compose ps postgres

# Check database size
docker exec chopsticks-postgres psql -U chopsticks -c "SELECT pg_size_pretty(pg_database_size('chopsticks'));"

# Backup database
docker exec chopsticks-postgres pg_dump -U chopsticks chopsticks > backup.sql
```

## Backups

Automatic backups run daily at 2 AM. Check backups:
```bash
ls -lh /opt/chopsticks/backups/
```

Manual backup:
```bash
bash /opt/chopsticks/backup.sh
```

Restore from backup:
```bash
# Stop services
docker compose down

# Restore database
cat /opt/chopsticks/backups/db_YYYYMMDD.sql | docker compose exec -T postgres psql -U chopsticks

# Start services
docker compose up -d
```

## Cost Optimization

**Current cost: $13/month**

To reduce costs:
1. Use Oracle Cloud Free Tier (migrate after stabilizing)
2. Use Supabase free tier for database
3. Use Upstash free tier for Redis
4. Disable dashboard if not needed

**Potential: $0/month with free tiers**

## Scaling Up

When you need more capacity:

### Upgrade to CPX41 ($26/month)
```bash
# In Hetzner console
1. Power off server
2. Resize to CPX41 (8 vCPU, 16GB RAM)
3. Power on
4. Update docker-compose resource limits
```

### Add Second Server
Deploy agent runners on separate server:
```bash
# On new server
docker compose -f docker-compose.production.yml up -d agents
```

Update AGENT_CONTROL_HOST to point to main server's internal IP.

## Next Steps

- Set up domain name and SSL (optional)
- Configure monitoring dashboard (Grafana)
- Add more agents as needed
- Scale to multiple servers as you grow
- Set up CI/CD for automatic deployments

## Support

If something goes wrong:
1. Check logs first: `docker compose logs -f`
2. Check resource usage: `bash scripts/monitor-resources.sh`
3. Try restarting: `docker compose restart`
4. Check GitHub issues
5. Join Discord support server (if available)
