#!/bin/bash
# Hetzner VPS Deployment Script for Chopsticks
# Run this script on a fresh Ubuntu 22.04 server

set -e

echo "==================================="
echo "Chopsticks Production Deployment"
echo "==================================="
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Please run as root (use: sudo bash deploy-hetzner.sh)${NC}"
  exit 1
fi

# Get non-root user
if [ -z "$SUDO_USER" ]; then
  echo -e "${YELLOW}Warning: SUDO_USER not set, using 'chopsticks' as deploy user${NC}"
  DEPLOY_USER="chopsticks"
else
  DEPLOY_USER="$SUDO_USER"
fi

echo -e "${GREEN}[1/10] Updating system packages...${NC}"
apt-get update
apt-get upgrade -y

echo -e "${GREEN}[2/10] Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
  rm get-docker.sh
  
  # Add user to docker group
  if id "$DEPLOY_USER" &>/dev/null; then
    usermod -aG docker "$DEPLOY_USER"
    echo -e "${YELLOW}Added $DEPLOY_USER to docker group (logout/login required)${NC}"
  fi
else
  echo "Docker already installed"
fi

echo -e "${GREEN}[3/10] Installing Docker Compose...${NC}"
if ! command -v docker compose &> /dev/null; then
  apt-get install -y docker-compose-plugin
else
  echo "Docker Compose already installed"
fi

echo -e "${GREEN}[4/10] Installing additional tools...${NC}"
apt-get install -y git curl wget htop nano

echo -e "${GREEN}[5/10] Setting up firewall...${NC}"
if command -v ufw &> /dev/null; then
  ufw --force enable
  ufw allow 22/tcp   # SSH
  ufw allow 80/tcp   # HTTP
  ufw allow 443/tcp  # HTTPS
  echo "Firewall configured"
else
  echo "UFW not available, skipping firewall setup"
fi

echo -e "${GREEN}[6/10] Creating directories...${NC}"
mkdir -p /opt/chopsticks
mkdir -p /opt/chopsticks/data
mkdir -p /opt/chopsticks/backups
mkdir -p /opt/chopsticks/lavalink

echo -e "${GREEN}[7/10] Setting up automatic backups...${NC}"
cat > /opt/chopsticks/backup.sh << 'EOF'
#!/bin/bash
# Automatic backup script for Chopsticks

BACKUP_DIR="/opt/chopsticks/backups"
DATE=$(date +%Y%m%d_%H%M%S)

echo "Starting backup at $DATE..."

# Backup PostgreSQL
docker exec chopsticks-postgres-1 pg_dump -U chopsticks chopsticks > "$BACKUP_DIR/db_$DATE.sql" 2>/dev/null || echo "PostgreSQL backup failed"

# Backup data directory
tar -czf "$BACKUP_DIR/data_$DATE.tar.gz" /opt/chopsticks/data 2>/dev/null || echo "Data backup failed"

# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "*.sql" -mtime +7 -delete
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_DIR"
EOF

chmod +x /opt/chopsticks/backup.sh

# Add to crontab (daily at 2 AM)
(crontab -l 2>/dev/null | grep -v "chopsticks/backup.sh"; echo "0 2 * * * /opt/chopsticks/backup.sh >> /opt/chopsticks/backups/backup.log 2>&1") | crontab -

echo -e "${GREEN}[8/10] Configuring system limits...${NC}"
# Increase file descriptor limits for Node.js
cat >> /etc/security/limits.conf << EOF
*               soft    nofile          65536
*               hard    nofile          65536
root            soft    nofile          65536
root            hard    nofile          65536
EOF

# Sysctl optimizations
cat >> /etc/sysctl.conf << EOF
# Chopsticks optimizations
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
vm.swappiness = 10
EOF

sysctl -p

echo -e "${GREEN}[9/10] Setting permissions...${NC}"
chown -R "$DEPLOY_USER":"$DEPLOY_USER" /opt/chopsticks 2>/dev/null || echo "Could not set ownership"

echo -e "${GREEN}[10/10] Installation complete!${NC}"
echo
echo "==================================="
echo "Next Steps:"
echo "==================================="
echo "1. Switch to deploy user: su - $DEPLOY_USER"
echo "2. Clone your repo:"
echo "   cd /opt/chopsticks"
echo "   git clone https://github.com/wokspecialists/chopsticks.git ."
echo
echo "3. Create .env file:"
echo "   cp .env.example .env"
echo "   nano .env  # Add your tokens and config"
echo
echo "4. Start the stack:"
echo "   docker compose -f docker-compose.stack.yml up -d"
echo
echo "5. Check logs:"
echo "   docker compose logs -f"
echo
echo "6. Monitor resources:"
echo "   docker stats"
echo
echo "Backup script installed: /opt/chopsticks/backup.sh"
echo "Backups run daily at 2 AM: /opt/chopsticks/backups/"
echo
echo "==================================="
