# Configuration Guide

## Configuration Files

### 1. `config.json` (Main Configuration)
Primary application settings.

```json
{
  "target": "chatgpt",
  "maxRetries": 3,
  "timeout": 30000,
  "logLevel": "info",
  "chrome": {
    "endpoint": "ws://host.docker.internal:9222"
  },
  "queue": {
    "scanInterval": 5000,
    "maxConcurrent": 3
  }
}
```

**Fields:**
- `target`: Default LLM target (chatgpt|gemini)
- `maxRetries`: Max retry attempts per task
- `timeout`: Task timeout in milliseconds
- `logLevel`: Logging verbosity (debug|info|warn|error)
- `chrome.endpoint`: Chrome WebSocket URL
- `queue.scanInterval`: Queue polling interval (ms)
- `queue.maxConcurrent`: Max parallel tasks

---

### 2. `dynamic_rules.json` (Runtime Rules)
Hot-reloadable validation and processing rules.

```json
{
  "validation": {
    "defaultMinLength": 50,
    "defaultMaxLength": 10000,
    "globalForbiddenTerms": []
  },
  "processing": {
    "incrementalCollection": true,
    "responseChunkSize": 100,
    "stabilityTimeout": 2000
  },
  "backoff": {
    "initialDelay": 1000,
    "maxDelay": 60000,
    "multiplier": 2,
    "jitter": 0.1
  }
}
```

**Features:**
- Changes applied without restart
- File-watch based reload
- Schema validation on load

---

### 3. `.env` (Environment Variables)
Sensitive and environment-specific settings.

```bash
# Application
NODE_ENV=production
PORT=3008
LOG_LEVEL=info

# Chrome
CHROME_WS_ENDPOINT=ws://host.docker.internal:9222
CHROME_REMOTE_DEBUGGING_PORT=9222

# Paths
QUEUE_DIR=./fila
RESPONSE_DIR=./respostas
LOG_DIR=./logs
PROFILE_DIR=./profile

# Performance
MAX_WORKERS=3
MEMORY_LIMIT=2048
GC_INTERVAL=300000

# Security
API_KEY=
CORS_ORIGIN=http://localhost:3008

# Monitoring
ENABLE_TELEMETRY=false
SENTRY_DSN=
```

---

### 4. `ecosystem.config.js` (PM2 Configuration)
Process management settings.

```javascript
module.exports = {
  apps: [
    {
      name: 'chatgpt-agent',
      script: './index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
```

---

## Environment Variables Reference

### Application Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Environment mode |
| `PORT` | 3008 | Dashboard port |
| `LOG_LEVEL` | info | Logging verbosity |

### Chrome Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROME_WS_ENDPOINT` | ws://host.docker.internal:9222 | Chrome WebSocket URL |
| `CHROME_REMOTE_DEBUGGING_PORT` | 9222 | Remote debugging port |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | true | Skip Chromium download |

### Path Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `QUEUE_DIR` | ./fila | Task queue directory |
| `RESPONSE_DIR` | ./respostas | Response output directory |
| `LOG_DIR` | ./logs | Log files directory |
| `PROFILE_DIR` | ./profile | Browser profile directory |

### Performance Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_WORKERS` | 3 | Max concurrent tasks |
| `MEMORY_LIMIT` | 2048 | Memory limit (MB) |
| `GC_INTERVAL` | 300000 | Garbage collection interval (ms) |
| `TASK_TIMEOUT` | 30000 | Task timeout (ms) |
| `MAX_RETRIES` | 3 | Max retry attempts |

### Security

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | - | API authentication key |
| `CORS_ORIGIN` | * | CORS allowed origins |
| `ENABLE_AUTH` | false | Enable API authentication |

### Monitoring

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_TELEMETRY` | false | Enable telemetry |
| `SENTRY_DSN` | - | Sentry error tracking URL |
| `PROMETHEUS_PORT` | 9090 | Prometheus metrics port |

---

## Configuration Priority

Settings are resolved in this order (highest to lowest):

1. **Environment Variables** (`.env`)
2. **Command Line Arguments**
3. **config.json**
4. **Default Values** (hardcoded)

Example:
```bash
# .env has PORT=3008
# Command line: --port 4000
# Result: Uses 4000 (command line wins)
```

---

## Dynamic Configuration

### Hot Reload
`dynamic_rules.json` changes are automatically detected:

```javascript
// File watcher detects change
fs.watch('dynamic_rules.json', () => {
  config.reload();
  logger.info('Configuration reloaded');
});
```

### Runtime Updates
Update config via API:

```bash
curl -X PUT http://localhost:3008/api/config \
  -H "Content-Type: application/json" \
  -d '{"maxRetries": 5}'
```

---

## Validation

### Schema Validation (Zod)
All configurations are validated on load:

```javascript
const ConfigSchema = z.object({
  target: z.enum(['chatgpt', 'gemini']),
  maxRetries: z.number().min(1).max(10),
  timeout: z.number().min(1000),
  logLevel: z.enum(['debug', 'info', 'warn', 'error'])
});
```

### Error Handling
Invalid configurations prevent startup:

```bash
[ERROR] Configuration validation failed:
  - maxRetries must be between 1 and 10 (got: 15)
  - timeout must be at least 1000ms (got: 500)
```

---

## Best Practices

### 1. Environment-Specific Config
```bash
# .env.development
NODE_ENV=development
LOG_LEVEL=debug
CHROME_WS_ENDPOINT=ws://localhost:9222

# .env.production
NODE_ENV=production
LOG_LEVEL=info
CHROME_WS_ENDPOINT=ws://host.docker.internal:9222
```

### 2. Secrets Management
```bash
# ❌ Never commit .env
git add .env.example  # ✅ Template only

# Use environment-specific secrets
# .env.local (gitignored)
API_KEY=secret-key-here
```

### 3. Configuration Versioning
```json
// config.json
{
  "version": "1.0.0",
  "lastModified": "2026-01-19",
  ...
}
```

### 4. Documentation
Document all config changes:
```bash
# CHANGELOG.md
## [1.2.0] - 2026-01-19
### Changed
- Increased default maxRetries from 3 to 5
- Added MEMORY_LIMIT environment variable
```

---

## Troubleshooting

### Config Not Loading
```bash
# Check file permissions
ls -la config.json

# Verify JSON syntax
node -e "JSON.parse(require('fs').readFileSync('config.json'))"

# Check logs
tail -f logs/agente_current.log | grep CONFIG
```

### Environment Variables Not Applied
```bash
# Verify .env is loaded
node -e "require('dotenv').config(); console.log(process.env.PORT)"

# Check precedence
npm run dev -- --port 4000  # CLI overrides .env
```

### Dynamic Rules Not Reloading
```bash
# Check file watcher
lsof | grep dynamic_rules.json

# Manual reload via API
curl -X POST http://localhost:3008/api/config/reload
```

---

## Production Recommendations

### 1. Resource Limits
```bash
# .env.production
MEMORY_LIMIT=4096
MAX_WORKERS=5
GC_INTERVAL=180000
```

### 2. Logging
```bash
# Rotate logs
LOG_LEVEL=warn
LOG_MAX_SIZE=10485760  # 10MB
LOG_MAX_FILES=5
```

### 3. Timeouts
```bash
# Generous timeouts for production
TASK_TIMEOUT=60000
CHROME_CONNECT_TIMEOUT=10000
```

### 4. Monitoring
```bash
# Enable telemetry
ENABLE_TELEMETRY=true
SENTRY_DSN=https://...
PROMETHEUS_PORT=9090
```

---

## Examples

### Development Setup
```bash
cp .env.example .env
# Edit .env:
NODE_ENV=development
LOG_LEVEL=debug
PORT=3008

npm run dev
```

### Production Setup
```bash
cp .env.example .env.production
# Edit .env.production:
NODE_ENV=production
LOG_LEVEL=info
MEMORY_LIMIT=4096

npm run daemon:start
```

### Docker Setup
```yaml
# docker-compose.yml
services:
  agent:
    environment:
      - NODE_ENV=production
      - CHROME_WS_ENDPOINT=ws://host.docker.internal:9222
      - MAX_WORKERS=3
```

---

## Configuration Checklist

Before deploying:

- [ ] Set `NODE_ENV=production`
- [ ] Configure `CHROME_WS_ENDPOINT`
- [ ] Set resource limits (`MEMORY_LIMIT`, `MAX_WORKERS`)
- [ ] Configure logging (`LOG_LEVEL`, log rotation)
- [ ] Set timeouts (`TASK_TIMEOUT`, `CHROME_CONNECT_TIMEOUT`)
- [ ] Enable monitoring (if applicable)
- [ ] Secure API (set `API_KEY` if needed)
- [ ] Review `config.json` and `dynamic_rules.json`
- [ ] Test configuration: `npm run diagnose`
- [ ] Validate with: `node -e "require('./src/core/config')"`

---

## Support

For configuration issues:
- Check logs: `npm run daemon:logs`
- Run diagnostics: `npm run diagnose`
- Open issue: https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/issues
