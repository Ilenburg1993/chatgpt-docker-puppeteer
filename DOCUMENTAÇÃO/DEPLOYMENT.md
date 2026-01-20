# Deployment Guide

## Overview

This guide covers deploying chatgpt-docker-puppeteer in various environments.

---

## Prerequisites

- **Chrome**: Installed and accessible on host system
- **Docker** (optional): For containerized deployment
- **Node.js**: ≥20.0.0 (if running natively)
- **Network**: Access to LLM websites (ChatGPT, Gemini)

---

## Deployment Options

### 1. Native Deployment (Windows/Linux/macOS)

**Advantages:**

- Direct access to system Chrome
- Simpler debugging
- Lower resource overhead

**Steps:**

1. **Install Dependencies**

```bash
npm install --production
```

2. **Configure Environment**

```bash
cp .env.example .env
# Edit .env with your settings
```

3. **Start Chrome**

```bash
# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-automation-profile"

# Linux/macOS
google-chrome --remote-debugging-port=9222 --user-data-dir="~/chrome-automation-profile"
```

4. **Run with PM2**

```bash
npm install -g pm2
npm run daemon:start

# Check status
pm2 status

# View logs
pm2 logs chatgpt-agent
```

---

### 2. Docker Deployment (Recommended)

**Advantages:**

- Isolated environment
- Easy scaling
- Consistent across systems

**Steps:**

1. **Start Chrome on Host**

```bash
# See DOCKER_SETUP.md for OS-specific commands
chrome --remote-debugging-port=9222
```

2. **Configure Environment**

```bash
# docker-compose.yml already configured for host.docker.internal
# No changes needed for standard setup
```

3. **Build and Run**

```bash
make build
make start

# Or using docker-compose directly
docker-compose up -d
```

4. **Verify Health**

```bash
make health
# or
curl http://localhost:3008/api/health
```

---

### 3. Production Server Deployment

**For VPS/dedicated servers:**

#### Setup Script

```bash
#!/bin/bash
# deploy.sh

set -e

echo "🚀 Deploying chatgpt-docker-puppeteer..."

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Chrome
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
sudo sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list'
sudo apt update
sudo apt install -y google-chrome-stable

# Clone repository
git clone https://github.com/Ilenburg1993/chatgpt-docker-puppeteer.git
cd chatgpt-docker-puppeteer

# Install dependencies
npm install --production

# Configure environment
cp .env.example .env
# Edit .env manually or use sed
sed -i 's/development/production/' .env
sed -i 's/debug/info/' .env

# Install PM2 globally
sudo npm install -g pm2

# Start Chrome service
cat << EOF | sudo tee /etc/systemd/system/chrome-automation.service
[Unit]
Description=Chrome Remote Debugging Service
After=network.target

[Service]
Type=simple
User=$USER
ExecStart=/usr/bin/google-chrome --remote-debugging-port=9222 --user-data-dir=/home/$USER/chrome-automation-profile --no-first-run --no-sandbox --disable-dev-shm-usage
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable chrome-automation
sudo systemctl start chrome-automation

# Start agent
npm run daemon:start

# Setup PM2 startup script
pm2 startup systemd
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER

echo "✅ Deployment complete!"
echo "Dashboard: http://localhost:3008"
echo "Status: pm2 status"
```

Make executable and run:

```bash
chmod +x deploy.sh
./deploy.sh
```

---

## Reverse Proxy Setup

### Nginx Configuration

```nginx
# /etc/nginx/sites-available/chatgpt-agent
upstream chatgpt_agent {
    server 127.0.0.1:3008;
}

server {
    listen 80;
    server_name agent.yourdomain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name agent.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/agent.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/agent.yourdomain.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req zone=api_limit burst=20 nodelay;

    location / {
        proxy_pass http://chatgpt_agent;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://chatgpt_agent;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

Enable and restart:

```bash
sudo ln -s /etc/nginx/sites-available/chatgpt-agent /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## SSL/TLS Setup

### Using Let's Encrypt (Certbot)

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d agent.yourdomain.com

# Auto-renewal (already configured by certbot)
sudo certbot renew --dry-run
```

---

## Monitoring Setup

### 1. PM2 Monitoring

```bash
# Enable PM2 monitoring (keymetrics.io)
pm2 register

# Link application
pm2 link <secret> <public>
```

### 2. Prometheus + Grafana

**Install Prometheus:**

```bash
# Add Prometheus repository
sudo apt install prometheus

# Configure scraping
cat << EOF | sudo tee -a /etc/prometheus/prometheus.yml
  - job_name: 'chatgpt-agent'
    static_configs:
      - targets: ['localhost:9090']
EOF

sudo systemctl restart prometheus
```

**Install Grafana:**

```bash
sudo apt install grafana
sudo systemctl enable grafana-server
sudo systemctl start grafana-server
```

Access Grafana: http://localhost:3000 (admin/admin)

---

## Backup Strategy

### Automated Backup Script

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backups/chatgpt-agent"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup queue
tar -czf "$BACKUP_DIR/fila_$DATE.tar.gz" fila/

# Backup responses
tar -czf "$BACKUP_DIR/respostas_$DATE.tar.gz" respostas/

# Backup logs
tar -czf "$BACKUP_DIR/logs_$DATE.tar.gz" logs/

# Backup configuration
tar -czf "$BACKUP_DIR/config_$DATE.tar.gz" config.json dynamic_rules.json .env

# Remove backups older than 30 days
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +30 -delete

echo "✅ Backup completed: $DATE"
```

Setup cron job:

```bash
crontab -e
# Add: 0 2 * * * /path/to/backup.sh
```

---

## Scaling

### Horizontal Scaling

**Option 1: Multiple PM2 Instances**

```javascript
// ecosystem.config.js
module.exports = {
    apps: [
        {
            name: 'chatgpt-agent',
            script: './index.js',
            instances: 4, // Number of instances
            exec_mode: 'cluster'
        }
    ]
};
```

**Option 2: Multiple Servers**

```
┌──────────────┐     ┌──────────────┐
│   Agent 1    │     │   Agent 2    │
│  (Server A)  │     │  (Server B)  │
└──────┬───────┘     └──────┬───────┘
       │                    │
       └──────────┬─────────┘
                  │
           ┌──────▼──────┐
           │  Redis Queue│
           │  (Shared)   │
           └─────────────┘
```

---

## Health Checks

### Systemd Health Check

```bash
# /etc/systemd/system/chatgpt-agent-health.service
[Unit]
Description=ChatGPT Agent Health Check
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/bin/curl -f http://localhost:3008/api/health || /usr/bin/systemctl restart chatgpt-agent

[Install]
WantedBy=multi-user.target
```

```bash
# /etc/systemd/system/chatgpt-agent-health.timer
[Unit]
Description=Run ChatGPT Agent Health Check every 5 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
```

Enable:

```bash
sudo systemctl enable chatgpt-agent-health.timer
sudo systemctl start chatgpt-agent-health.timer
```

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs chatgpt-docker-puppeteer-agent-1

# Check Chrome connection
docker exec -it chatgpt-docker-puppeteer-agent-1 curl http://host.docker.internal:9222/json/version
```

### High Memory Usage

```bash
# Check memory
docker stats

# Restart with lower memory limit
docker-compose down
# Edit docker-compose.yml: memory: 1g
docker-compose up -d
```

### Queue Not Processing

```bash
# Check queue status
npm run queue:status

# Clear locks
npm run clean

# Restart agent
pm2 restart chatgpt-agent
```

---

## Security Checklist

- [ ] Use strong passwords
- [ ] Enable firewall (allow only 22, 80, 443)
- [ ] Use SSL/TLS for dashboard
- [ ] Set API_KEY in .env
- [ ] Disable root SSH login
- [ ] Enable fail2ban
- [ ] Regular updates (apt update && apt upgrade)
- [ ] Backup sensitive data
- [ ] Monitor logs for suspicious activity
- [ ] Use non-root user for application

---

## Post-Deployment

1. **Verify Dashboard**: http://your-domain.com
2. **Test Task Creation**: Add test task
3. **Monitor Logs**: `pm2 logs` or `make logs`
4. **Setup Monitoring**: Configure alerts
5. **Schedule Backups**: Enable cron jobs
6. **Documentation**: Update with deployment specifics

---

## Support

- **Logs**: `pm2 logs chatgpt-agent`
- **Diagnostics**: `npm run diagnose`
- **Issues**: https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/issues
