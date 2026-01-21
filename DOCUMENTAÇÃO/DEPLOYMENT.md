# 🚀 Guia de Deploy

**Versão**: 1.0
**Última Atualização**: 21/01/2026
**Público-Alvo**: DevOps, SRE
**Tempo de Leitura**: ~25 min

---

## 📖 Visão Geral

Este documento detalha **estratégias de deployment** do sistema `chatgpt-docker-puppeteer`: Docker, PM2, HTTPS/TLS, reverse proxy, scaling horizontal, monitoring e backup.

---

## 🐳 Docker Setup

### 1. Dockerfile (Production)

**Localização**: `Dockerfile` (root)

```dockerfile
FROM node:20-slim

# Install Chromium dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Create directories
RUN mkdir -p logs fila respostas tmp profile backups

# Expose port
EXPOSE 3008

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3008/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); });"

# Start
CMD ["npm", "run", "daemon:start"]
```

---

### 2. docker-compose.yml (Production)

```yaml
version: '3.8'

services:
  agente-gpt:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: agente-gpt-prod
    restart: unless-stopped
    ports:
      - "3008:3008"
    environment:
      - NODE_ENV=production
      - MAX_WORKERS=10
      - LOG_LEVEL=WARN
      - DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}
      - BROWSER_MODE=launcher
    volumes:
      - ./fila:/app/fila
      - ./respostas:/app/respostas
      - ./logs:/app/logs
      - ./profile:/app/profile
      - ./backups:/app/backups
    mem_limit: 1g
    mem_reservation: 512m
    cpus: 2
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3008/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

networks:
  default:
    name: agente-network
```

---

### 3. docker-compose.dev.yml (Development)

```yaml
version: '3.8'

services:
  agente-gpt-dev:
    build:
      context: .
      dockerfile: Dockerfile.dev
    container_name: agente-gpt-dev
    restart: unless-stopped
    ports:
      - "3008:3008"
      - "9222:9222"  # Chrome DevTools
    environment:
      - NODE_ENV=development
      - MAX_WORKERS=1
      - LOG_LEVEL=DEBUG
      - BROWSER_MODE=external
    volumes:
      - .:/app
      - /app/node_modules
    command: npm run dev
```

---

### Comandos Docker

```bash
# Build
docker-compose -f docker-compose.yml build

# Start
docker-compose -f docker-compose.yml up -d

# Logs
docker-compose -f docker-compose.yml logs -f agente-gpt

# Stop
docker-compose -f docker-compose.yml down

# Restart
docker-compose -f docker-compose.yml restart agente-gpt

# Stats
docker stats agente-gpt-prod

# Health
docker inspect --format='{{.State.Health.Status}}' agente-gpt-prod
```

---

## 🔄 PM2 Setup (Bare Metal)

### 1. Instalação PM2

```bash
# Global install
npm install -g pm2

# Verify
pm2 --version  # 5.3.0
```

---

### 2. Start com PM2

```bash
# Start
pm2 start ecosystem.config.js

# Status
pm2 status

# Logs
pm2 logs agente-gpt --lines 100

# Monitoring
pm2 monit

# Stop
pm2 stop agente-gpt

# Restart
pm2 restart agente-gpt

# Reload (zero-downtime)
pm2 reload agente-gpt

# Delete
pm2 delete agente-gpt
```

---

### 3. PM2 Startup (Auto-start no Boot)

```bash
# Generate startup script
pm2 startup

# Save current processes
pm2 save

# Unstartup (remove)
pm2 unstartup systemd
```

---

### 4. PM2 Plus (Monitoring Cloud)

```bash
# Link to PM2 Plus
pm2 link <secret_key> <public_key>

# Dashboard: https://app.pm2.io
```

---

## 🔐 HTTPS/TLS Setup

### 1. Nginx Reverse Proxy

**Install Nginx**:
```bash
sudo apt update
sudo apt install nginx
```

**Config**: `/etc/nginx/sites-available/agente-gpt`

```nginx
server {
    listen 80;
    server_name agente.example.com;

    # Redirect to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name agente.example.com;

    # SSL certificates (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/agente.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/agente.example.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy to Node.js
    location / {
        proxy_pass http://localhost:3008;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 300s;  # 5min for long tasks
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://localhost:3008;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://localhost:3008;
    }
}
```

**Enable site**:
```bash
sudo ln -s /etc/nginx/sites-available/agente-gpt /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

### 2. Let's Encrypt (Certbot)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d agente.example.com

# Auto-renewal (cron)
sudo certbot renew --dry-run

# Check expiry
sudo certbot certificates
```

---

## 📈 Scaling Horizontal

### Estratégia: Load Balancer + Múltiplas Instâncias

**Arquitetura**:
```
         ┌─────────────┐
         │ Load Balancer│ (Nginx/HAProxy)
         └──────┬───────┘
                │
      ┌─────────┼─────────┐
      │         │         │
   ┌──▼──┐   ┌──▼──┐   ┌──▼──┐
   │ PM2 │   │ PM2 │   │ PM2 │
   │ Inst│   │ Inst│   │ Inst│
   │  1  │   │  2  │   │  3  │
   └─────┘   └─────┘   └─────┘
      │         │         │
      └─────────┼─────────┘
                │
         ┌──────▼───────┐
         │ Shared Queue │ (NFS/S3)
         │ Shared Data  │
         └──────────────┘
```

---

### Nginx Load Balancer

```nginx
upstream agente_backend {
    least_conn;  # Least connections algorithm

    server 192.168.1.10:3008 max_fails=3 fail_timeout=30s;
    server 192.168.1.11:3008 max_fails=3 fail_timeout=30s;
    server 192.168.1.12:3008 max_fails=3 fail_timeout=30s;
}

server {
    listen 443 ssl http2;
    server_name agente.example.com;

    location / {
        proxy_pass http://agente_backend;
        # ... headers
    }
}
```

---

### Shared Storage (NFS)

**Server** (192.168.1.100):
```bash
# Install NFS
sudo apt install nfs-kernel-server

# Export directory
echo "/mnt/agente-data 192.168.1.0/24(rw,sync,no_subtree_check)" | sudo tee -a /etc/exports

# Restart NFS
sudo exportfs -a
sudo systemctl restart nfs-kernel-server
```

**Clients** (PM2 instances):
```bash
# Install NFS client
sudo apt install nfs-common

# Mount
sudo mount 192.168.1.100:/mnt/agente-data /app/data

# Auto-mount (fstab)
echo "192.168.1.100:/mnt/agente-data /app/data nfs defaults 0 0" | sudo tee -a /etc/fstab
```

---

### Lock Coordination (Redis)

```bash
# Install Redis
sudo apt install redis-server

# Configure
sudo nano /etc/redis/redis.conf
# Set: bind 0.0.0.0
# Set: requirepass YOUR_PASSWORD

# Restart
sudo systemctl restart redis
```

**Node.js Integration**:
```javascript
const Redis = require('ioredis');
const redis = new Redis({
    host: '192.168.1.100',
    port: 6379,
    password: 'YOUR_PASSWORD'
});

// Distributed lock
async function acquireDistributedLock(taskId) {
    const lockKey = `lock:${taskId}`;
    const lockValue = `${agentDNA}:${process.pid}`;

    const result = await redis.set(
        lockKey,
        lockValue,
        'NX',  // Only if not exists
        'EX',  // Expiry
        60     // 60 seconds
    );

    return result === 'OK';
}
```

---

## 📊 Monitoring

### 1. PM2 Monitoring

```bash
# Built-in monitoring
pm2 monit

# Logs
pm2 logs agente-gpt --lines 100 --timestamp

# Flush logs
pm2 flush
```

---

### 2. Health Check Script

```bash
#!/bin/bash
# health-check.sh

URL="http://localhost:3008/api/health"
THRESHOLD_RESPONSE_TIME=2000  # 2s

RESPONSE=$(curl -s -w "\n%{http_code}\n%{time_total}" "$URL")
STATUS_CODE=$(echo "$RESPONSE" | tail -2 | head -1)
RESPONSE_TIME=$(echo "$RESPONSE" | tail -1 | awk '{print int($1*1000)}')

if [ "$STATUS_CODE" -ne 200 ]; then
    echo "UNHEALTHY: Status $STATUS_CODE"
    exit 1
elif [ "$RESPONSE_TIME" -gt "$THRESHOLD_RESPONSE_TIME" ]; then
    echo "DEGRADED: Response time ${RESPONSE_TIME}ms"
    exit 2
else
    echo "HEALTHY: ${RESPONSE_TIME}ms"
    exit 0
fi
```

**Cron** (every 5 min):
```bash
*/5 * * * * /usr/local/bin/health-check.sh >> /var/log/agente-health.log 2>&1
```

---

### 3. Alerting (Email)

```bash
#!/bin/bash
# alert-on-failure.sh

if ! /usr/local/bin/health-check.sh; then
    echo "Agente GPT is DOWN!" | mail -s "ALERT: Agente GPT Down" admin@example.com
fi
```

---

## 💾 Backup Strategy

### 1. Backup Script

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backups/agente-$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

# Backup data
cp -r /app/fila "$BACKUP_DIR/"
cp -r /app/respostas "$BACKUP_DIR/"
cp /app/config.json "$BACKUP_DIR/"
cp /app/controle.json "$BACKUP_DIR/"
cp /app/.env "$BACKUP_DIR/"

# Compress
tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR"
rm -rf "$BACKUP_DIR"

echo "Backup created: $BACKUP_DIR.tar.gz"

# Retention (keep last 7 days)
find /backups -name "agente-*.tar.gz" -mtime +7 -delete
```

**Cron** (daily at 2am):
```bash
0 2 * * * /usr/local/bin/backup.sh >> /var/log/agente-backup.log 2>&1
```

---

### 2. Restore

```bash
#!/bin/bash
# restore.sh

BACKUP_FILE=$1

if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: restore.sh <backup.tar.gz>"
    exit 1
fi

# Stop service
pm2 stop agente-gpt

# Extract
tar -xzf "$BACKUP_FILE" -C /tmp/

# Restore
cp -r /tmp/agente-*/fila /app/
cp -r /tmp/agente-*/respostas /app/
cp /tmp/agente-*/config.json /app/
cp /tmp/agente-*/controle.json /app/

# Cleanup
rm -rf /tmp/agente-*

# Start service
pm2 start agente-gpt

echo "Restore completed"
```

---

## 🔄 Zero-Downtime Deployment

### Strategy: PM2 Reload

```bash
# Deploy new version
git pull origin main
npm ci --only=production

# Reload (zero-downtime)
pm2 reload agente-gpt --update-env

# Verify
pm2 logs agente-gpt --lines 50
curl http://localhost:3008/api/health
```

---

### Blue-Green Deployment

```bash
# Start blue (current)
pm2 start ecosystem.config.js --name agente-gpt-blue --env production

# Start green (new version)
pm2 start ecosystem.config.js --name agente-gpt-green --env production --update-env PORT=3009

# Test green
curl http://localhost:3009/api/health

# Switch Nginx to green
sudo nano /etc/nginx/sites-available/agente-gpt
# Change: proxy_pass http://localhost:3009;
sudo nginx -t && sudo systemctl reload nginx

# Stop blue
pm2 stop agente-gpt-blue
pm2 delete agente-gpt-blue

# Rename green to blue
pm2 restart agente-gpt-green --name agente-gpt-blue
```

---

## 📋 Deployment Checklist

### Pre-Deployment

- [ ] Code testado (make test-all)
- [ ] Lint passando (make lint)
- [ ] Dependências atualizadas (npm audit fix)
- [ ] Config validado (schema Zod)
- [ ] Variáveis .env configuradas
- [ ] Backup criado (make backup)
- [ ] Health checks configurados
- [ ] SSL certificates válidos (>30 dias)

### Post-Deployment

- [ ] PM2/Docker status OK
- [ ] Health checks passando (200 OK)
- [ ] Logs sem erros críticos
- [ ] Dashboard acessível
- [ ] Tasks executando (adicionar test task)
- [ ] WebSocket conectando
- [ ] Métricas normais (CPU <30%, Memory <600MB)
- [ ] HTTPS funcionando
- [ ] Rate limiting ativo

---

## 🐛 Troubleshooting Deploy

### Problema: Container não inicia

**Logs**:
```bash
docker logs agente-gpt-prod
```

**Causas comuns**:
- Porta 3008 ocupada
- Volume mounts incorretos
- Variáveis de ambiente faltando

---

### Problema: PM2 restart loop

**Debug**:
```bash
pm2 logs agente-gpt --err --lines 100
```

**Causas**:
- Error no boot (syntax, missing files)
- Port already in use
- max_restarts atingido

**Solução**:
```bash
pm2 reset agente-gpt  # Reset restart counter
```

---

### Problema: High memory usage

**Monitor**:
```bash
pm2 monit
```

**Solução**:
```javascript
// ecosystem.config.js
max_memory_restart: '600M',  // Auto-restart on high memory
node_args: '--max-old-space-size=512'
```

---

## 📚 Referências

- [CONFIGURATION.md](CONFIGURATION.md) - Configuração detalhada
- [API_REFERENCE.md](API_REFERENCE.md) - Endpoints
- [DEVELOPMENT.md](DEVELOPMENT.md) - Desenvolvimento local

---

*Última revisão: 21/01/2026 | Contribuidores: AI Architect, DevOps Team*
