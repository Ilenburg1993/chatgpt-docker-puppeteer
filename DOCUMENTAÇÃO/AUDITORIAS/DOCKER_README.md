# 🐳 Docker Setup Guide

**Versão**: 2.0
**Data**: 21/01/2026

---

## 📋 Arquivos Docker

```
chatgpt-docker-puppeteer/
├── Dockerfile                  # Production (multi-stage, optimized)
├── Dockerfile.dev              # Development (hot-reload)
├── docker-compose.yml          # Default configuration
├── docker-compose.dev.yml      # Development setup
├── docker-compose.prod.yml     # Production setup
├── docker-compose.linux.yml    # Linux-specific (deprecated - use main files)
├── .dockerignore               # Build exclusions
├── .env.example                # Environment variables template
└── scripts/
    └── healthcheck.js          # Container health check
```

---

## 🚀 Quick Start

### 1. Setup Environment

```bash
# Copy template
cp .env.example .env

# Edit variables
nano .env
```

### 2. Choose Mode

**Development** (hot-reload, debugging):
```bash
docker-compose -f docker-compose.dev.yml up
```

**Production** (optimized):
```bash
docker-compose -f docker-compose.prod.yml up -d
```

**Default** (balanced):
```bash
docker-compose up -d
```

---

## 🛠️ Configurations

### docker-compose.yml (Default)

**Use case**: General purpose, development + light production

**Features**:
- Bind mounts (easy file access)
- Configurable via .env
- Resource limits (2 CPU, 1GB RAM)
- Health checks enabled

**Start**:
```bash
docker-compose up -d
docker-compose logs -f
```

---

### docker-compose.dev.yml (Development)

**Use case**: Local development with hot-reload

**Features**:
- ✅ **Hot-reload** (nodemon watches /app/src)
- ✅ **Node.js inspector** (port 9229 - Chrome DevTools)
- ✅ Source code mounted read-only (:ro)
- ✅ Isolated node_modules (named volume)
- ✅ Debug-friendly logging (LOG_LEVEL=debug)

**Start**:
```bash
# 1. Start external Chrome (optional, if using external mode)
google-chrome --remote-debugging-port=9222 &

# 2. Start container
docker-compose -f docker-compose.dev.yml up

# 3. Debug (Chrome DevTools)
# Open chrome://inspect → Connect to localhost:9229
```

**Volume Strategy**:
- Source code: Read-only bind mounts (./src → /app/src:ro)
- node_modules: Named volume (performance)
- Data dirs: Bind mounts (./fila, ./respostas, ./logs)

---

### docker-compose.prod.yml (Production)

**Use case**: Production deployment

**Features**:
- ✅ **Named volumes** (Docker-managed, isolated)
- ✅ **Resource limits** (2 CPU, 2GB RAM)
- ✅ **Security hardening** (no-new-privileges)
- ✅ **Optional monitoring** (Prometheus + Grafana)
- ✅ Environment variables from .env

**Start**:
```bash
# 1. Build image
docker-compose -f docker-compose.prod.yml build

# 2. Start services
docker-compose -f docker-compose.prod.yml up -d

# 3. Verify health
docker-compose -f docker-compose.prod.yml ps
curl http://localhost:3008/api/health
```

**Monitoring** (optional):
```bash
# Start with monitoring profile
docker-compose -f docker-compose.prod.yml --profile monitoring up -d

# Access dashboards:
# - Prometheus: http://localhost:9091
# - Grafana: http://localhost:3001 (admin/admin)
```

---

## 📦 Dockerfile Comparison

| Feature      | Dockerfile (prod) | Dockerfile.dev |
| ------------ | ----------------- | -------------- |
| Base image   | node:20-slim      | node:20        |
| Build stages | Multi-stage ✅     | Single stage   |
| Chromium     | Bundled ✅         | External only  |
| User         | Non-root (agente) | root           |
| Size         | ~400MB            | ~800MB         |
| CMD          | node index.js     | npm run dev    |

---

## 🔧 Common Operations

### Build

```bash
# Production
docker build -t chatgpt-agent:latest .

# Development
docker build -f Dockerfile.dev -t chatgpt-agent:dev .

# With args
docker build --build-arg NODE_ENV=production -t chatgpt-agent:v1.0 .
```

### Run

```bash
# Interactive (foreground)
docker-compose up

# Detached (background)
docker-compose up -d

# Specific service
docker-compose up agente-gpt
```

### Logs

```bash
# Follow logs
docker-compose logs -f

# Specific service
docker-compose logs -f agente-gpt

# Last 100 lines
docker-compose logs --tail=100
```

### Stop

```bash
# Stop containers
docker-compose stop

# Stop and remove
docker-compose down

# Remove volumes too
docker-compose down -v
```

### Restart

```bash
# Restart service
docker-compose restart agente-gpt

# Rebuild and restart
docker-compose up -d --build
```

---

## 🐛 Debugging

### Access Container Shell

```bash
# Bash
docker-compose exec agente-gpt bash

# If bash not available
docker-compose exec agente-gpt sh
```

### Check Health

```bash
# Via healthcheck script
docker-compose exec agente-gpt node /app/scripts/healthcheck.js

# Via API
curl http://localhost:3008/api/health
```

### Inspect Container

```bash
# Full inspect
docker inspect chatgpt-agent-prod

# Specific field
docker inspect -f '{{.State.Health.Status}}' chatgpt-agent-prod
```

### Node.js Debugging (dev mode)

```bash
# 1. Start dev container
docker-compose -f docker-compose.dev.yml up

# 2. Open Chrome DevTools
# chrome://inspect

# 3. Add connection: localhost:9229

# 4. Set breakpoints in /app/src/
```

---

## 🔒 Security Best Practices

### 1. Non-root User
```dockerfile
# Dockerfile already implements this
USER agente
```

### 2. Read-only Root FS (optional)
```yaml
# docker-compose.prod.yml
read_only: true
tmpfs:
  - /tmp:size=100M
```

### 3. Drop Capabilities
```yaml
cap_drop:
  - ALL
cap_add:
  - NET_BIND_SERVICE  # Only if needed
```

### 4. Secrets Management
```bash
# Use Docker secrets (Swarm mode)
docker secret create dashboard_password ./password.txt

# Or environment variables (less secure)
echo "DASHBOARD_PASSWORD=secret" >> .env
```

---

## 📊 Monitoring

### Prometheus Metrics

Endpoint: `http://localhost:3008/api/metrics`

Metrics exposed:
- Heap usage (P9.1)
- Cache hit rate (P9.6)
- Queue depth
- Task throughput
- NERV event counts

### Grafana Dashboards

1. **Agent Overview**: Tasks, throughput, success rate
2. **Performance**: CPU, memory, heap usage
3. **Queue Status**: Pending, running, failed tasks
4. **Browser Pool**: Healthy, degraded, crashed instances

---

## 🧪 Testing

### Test Build

```bash
# Production
docker build -t chatgpt-agent:test .

# Development
docker build -f Dockerfile.dev -t chatgpt-agent:dev-test .
```

### Test Run

```bash
# Start with test config
docker-compose -f docker-compose.yml -f docker-compose.test.yml up
```

### Integration Tests

```bash
# Run tests in container
docker-compose exec agente-gpt npm test

# Or mount tests directory
docker-compose run --rm -v ./tests:/app/tests agente-gpt npm test
```

---

## ❓ Troubleshooting

### Port Already in Use

```bash
# Find process
lsof -i :3008  # Linux/Mac
netstat -ano | findstr :3008  # Windows

# Kill process or change port in .env
PORT=3009 docker-compose up
```

### Volume Permission Errors

```bash
# Fix ownership (Linux)
sudo chown -R 1000:1000 fila/ respostas/ logs/

# Or use named volumes instead of bind mounts
```

### Container Exits Immediately

```bash
# Check logs
docker-compose logs agente-gpt

# Common issues:
# - Missing .env variables
# - Port conflict
# - Config validation error
```

### Cannot Connect to Chrome

```bash
# Verify Chrome is running
curl http://localhost:9222/json/version

# Check CHROME_WS_ENDPOINT in .env
# Windows/Mac Docker Desktop: ws://host.docker.internal:9222
# Linux: Add extra_hosts in docker-compose.yml

# Or use launcher mode
BROWSER_MODE=launcher docker-compose up
```

---

## 📚 References

- [Docker Compose docs](https://docs.docker.com/compose/)
- [Dockerfile best practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
- [DEPLOYMENT.md](DOCUMENTAÇÃO/DEPLOYMENT.md) - Full deployment guide
- [CONFIGURATION.md](DOCUMENTAÇÃO/CONFIGURATION.md) - Configuration parameters

---

*Última atualização: 21/01/2026 | Docker v2.0*
