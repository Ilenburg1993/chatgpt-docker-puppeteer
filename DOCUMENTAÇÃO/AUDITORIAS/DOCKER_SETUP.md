# Docker Setup for Windows with Remote Chrome

## Prerequisites

### 1. Start Chrome with Remote Debugging

Before running the Docker container, start Chrome with remote debugging enabled:

```powershell
# Windows Command
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-automation-profile"
```

**Important:**

- Chrome must be running BEFORE starting the container
- Port 9222 must be accessible from Docker
- User data directory ensures isolated browser profile

### 2. Verify Chrome is Ready

Open browser and check: http://localhost:9222/json/version

You should see Chrome DevTools metadata.

---

## Quick Start

### Production Mode

```bash
# 1. Start Chrome (in separate terminal)
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-automation-profile"

# 2. Build and start container
make build
make start

# 3. Access dashboard
http://localhost:3008
```

### Development Mode

```bash
# 1. Start Chrome
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-automation-profile"

# 2. Start dev container (with hot reload)
make start-dev

# 3. Access dashboard
http://localhost:3008
```

---

## Architecture

```
┌─────────────────────┐
│   Windows Host      │
│                     │
│  Chrome.exe         │
│  Port: 9222         │
│  (Remote Debugging) │
└──────────┬──────────┘
           │
           │ WebSocket
           │ ws://host.docker.internal:9222
           │
┌──────────▼──────────┐
│  Docker Container   │
│                     │
│  Node.js App        │
│  Puppeteer          │
│  Port: 3008         │
└─────────────────────┘
```

**Benefits:**

- ✅ Chrome UI visible (not headless)
- ✅ Use Chrome extensions
- ✅ Persistent profiles
- ✅ Easier debugging
- ✅ Smaller container (~150MB vs ~400MB)

---

## Environment Variables

Configure in `docker-compose.yml`:

```yaml
environment:
    # Chrome WebSocket endpoint
    - CHROME_WS_ENDPOINT=ws://host.docker.internal:9222

    # Timezone
    - TZ=America/Sao_Paulo

    # Node environment
    - NODE_ENV=production
```

---

## Troubleshooting

### Container can't connect to Chrome

**Problem:** `Error: connect ECONNREFUSED`

**Solutions:**

1. Verify Chrome is running with `--remote-debugging-port=9222`
2. Check: http://localhost:9222/json/version
3. Windows Firewall may block connection
4. Try restarting Docker Desktop

### host.docker.internal not working

**On Linux:** Add to docker-compose.yml:

```yaml
extra_hosts:
    - 'host.docker.internal:host-gateway'
```

### Port 9222 already in use

**Solution:** Kill existing Chrome instances:

```powershell
taskkill /F /IM chrome.exe
```

---

## Advanced Configuration

### Custom Chrome Path

Edit your code to use environment variable:

```javascript
const browser = await puppeteer.connect({
    browserWSEndpoint: process.env.CHROME_WS_ENDPOINT || 'ws://host.docker.internal:9222'
});
```

### Multiple Chrome Profiles

```bash
# Profile 1 (port 9222)
chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\profile1"

# Profile 2 (port 9223)
chrome.exe --remote-debugging-port=9223 --user-data-dir="C:\profile2"
```

### Windows Startup Script

Create `start-chrome.bat`:

```batch
@echo off
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-automation-profile"
echo Chrome started with remote debugging on port 9222
```

---

## Security Notes

⚠️ **Remote debugging exposes Chrome control:**

- Only use on trusted networks
- Firewall port 9222 from external access
- Use different profile from personal browsing
- Don't expose to internet without authentication

---

## Docker Commands

```bash
# Build
make build

# Start
make start

# Stop
make stop

# Logs
make logs

# Shell access
make shell

# Health check
make health

# Clean everything
make clean
```

---

## Next Steps

1. ✅ Start Chrome with remote debugging
2. ✅ Run `make build && make start`
3. ✅ Access http://localhost:3008
4. ✅ Check logs with `make logs`
5. ✅ Add tasks via dashboard or API
