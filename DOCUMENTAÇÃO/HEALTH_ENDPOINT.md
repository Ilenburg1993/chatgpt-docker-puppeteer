# Health Endpoint Implementation

## Implemented Features

### 1. Simple Health Check: `GET /api/health`

**Purpose**: Lightweight health check for Docker healthcheck and monitoring systems.

**Response** (HTTP 200 - Healthy):
```json
{
  "status": "ok",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "uptime": 3600,
  "chrome": {
    "connected": true,
    "endpoint": "http://host.docker.internal:9222",
    "version": "Chrome/120.0.0.0",
    "latency_ms": 15
  },
  "queue": {
    "pending": 5,
    "running": 1
  },
  "memory": {
    "usage_mb": 245,
    "total_mb": 512
  }
}
```

**Response** (HTTP 503 - Degraded):
```json
{
  "status": "degraded",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "uptime": 3600,
  "chrome": {
    "connected": false,
    "endpoint": "http://host.docker.internal:9222",
    "version": null,
    "latency_ms": 0
  },
  "queue": {
    "pending": 5,
    "running": 0
  },
  "memory": {
    "usage_mb": 245,
    "total_mb": 512
  }
}
```

**Status Codes**:
- `200 OK` - System healthy (Chrome connected)
- `503 Service Unavailable` - System degraded (Chrome disconnected)

**Use Cases**:
- Docker HEALTHCHECK directive
- Kubernetes liveness/readiness probes
- Load balancer health checks
- Monitoring systems (Prometheus, Datadog)

---

### 2. Comprehensive Health Check: `GET /api/system/health`

**Purpose**: Detailed diagnostic report for administrators.

**Response**:
```json
{
  "meta": {
    "version": "39.0",
    "engine": "Universal_Physician",
    "timestamp": "2026-01-19T12:00:00.000Z",
    "duration_ms": 342
  },
  "health": {
    "score": 100,
    "status": "HEALTHY"
  },
  "telemetry": {
    "network": [
      {
        "url": "https://www.google.com",
        "ok": true,
        "status": 200,
        "ms": 45
      },
      {
        "url": "https://chatgpt.com",
        "ok": true,
        "status": 200,
        "ms": 120
      }
    ],
    "storage": {
      "latency_ms": 12,
      "write_ok": true,
      "disk_info_raw": "Filesystem /dev/sda1 78G 45G 30G 61%"
    },
    "dna": {
      "ok": true,
      "version": 42
    },
    "chrome": {
      "connected": true,
      "endpoint": "http://host.docker.internal:9222",
      "version": "Chrome/120.0.0.0",
      "protocol": "1.3",
      "user_agent": "Mozilla/5.0...",
      "ws_endpoint": "ws://host.docker.internal:9222/devtools/browser/...",
      "latency_ms": 15
    },
    "queue": {
      "pending": 5,
      "running": 1,
      "total": 48
    },
    "system": {
      "cpu_load": "1.23",
      "ram_usage_pct": "42.5",
      "ram_free_gb": "3.21GB",
      "event_loop_lag_ms": 2,
      "uptime_seconds": 3600,
      "ts": 1705665600000
    }
  },
  "recovery_manifest": {
    "detected_issues": [],
    "suggested_steps": [],
    "can_auto_fix": true
  },
  "request_id": "uuid-1234-5678"
}
```

**Health Statuses**:
- `HEALTHY` - Score 100, no issues
- `DEGRADED` - Score 60-80, minor issues
- `CRITICAL` - Score <60, major issues

**Detected Issues Examples**:
- Chrome remote debugging não conectado
- Saturação de memória RAM (>90%)
- Latência de disco extrema detectada
- DNA do sistema comprometido
- Conectividade instável com provedores de IA

---

## Implementation Details

### Chrome Connection Check (`probeChromeConnection`)

**Algorithm**:
1. Extract Chrome endpoint from `CHROME_WS_ENDPOINT` or `DEBUG_PORT`
2. Convert WebSocket URL to HTTP (ws:// → http://)
3. Probe `/json/version` endpoint
4. Parse Chrome version, protocol, and WebSocket URL
5. Measure latency and connection status

**Timeout**: 5 seconds

**Error Handling**:
- Connection refused → `connected: false, error: 'Chrome not responding'`
- Timeout → `connected: false, error: 'Connection timeout'`
- Invalid response → `connected: true` (but version unknown)

---

### Queue Statistics

**Metrics**:
- `pending`: Tasks with status `PENDING`
- `running`: Tasks with status `RUNNING`
- `total`: All tasks in queue

**Source**: `io.loadAllTasks()` from file system

**Fail-safe**: Returns `{ pending: 0, running: 0, total: 0 }` on error

---

### Memory Metrics

**Metrics**:
- `usage_mb`: Heap used (MB)
- `total_mb`: Heap total (MB)

**Source**: `process.memoryUsage()`

---

## Testing

### Local Testing

```bash
# Start Chrome
chrome --remote-debugging-port=9222

# Start agent
npm run dev

# Test simple health check
curl http://localhost:3008/api/health

# Test comprehensive health check
curl http://localhost:3008/api/system/health
```

### Docker Testing

```bash
# Build and start
make build
make start

# Test from host
curl http://localhost:3008/api/health

# Test from container
docker exec -it chatgpt-docker-puppeteer-agent-1 curl http://localhost:3008/api/health

# Check Docker healthcheck
docker ps
# Look for "(healthy)" or "(unhealthy)" status
```

### Expected Healthcheck Behavior

**Healthy Container**:
```bash
$ docker ps
CONTAINER ID   STATUS
abc123def456   Up 5 minutes (healthy)
```

**Unhealthy Container** (Chrome disconnected):
```bash
$ docker ps
CONTAINER ID   STATUS
abc123def456   Up 5 minutes (unhealthy)
```

---

## Monitoring Integration

### Prometheus

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'chatgpt-agent'
    metrics_path: '/api/health'
    static_configs:
      - targets: ['localhost:3008']
```

### Kubernetes

```yaml
# deployment.yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 3008
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /api/health
    port: 3008
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 2
```

### Docker Compose

```yaml
# docker-compose.yml (already configured)
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3008/api/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

---

## Troubleshooting

### Chrome Connection Issues

**Symptom**: `"connected": false`

**Solutions**:
1. Verify Chrome is running:
   ```bash
   curl http://localhost:9222/json/version
   ```
2. Check `CHROME_WS_ENDPOINT` in `.env`
3. Verify firewall allows port 9222
4. For Docker: ensure `host.docker.internal` resolves

### High Memory Usage

**Symptom**: `"ram_usage_pct": "95.0"`

**Solutions**:
1. Check for memory leaks: `npm run diagnose`
2. Restart with PM2: `pm2 restart chatgpt-agent`
3. Increase container memory limit in docker-compose.yml

### Slow Health Check Response

**Symptom**: Health check takes >5s

**Causes**:
- Slow Chrome connection
- High disk I/O latency
- Network connectivity issues

**Solutions**:
1. Check Chrome latency in response
2. Run storage SLA test: `/api/system/health`
3. Investigate network probes

---

## Next Steps

- [ ] Add Prometheus metrics export (`/metrics`)
- [ ] Implement auto-healing for Chrome connection
- [ ] Add alerting integration (PagerDuty, Slack)
- [ ] Historical health trends visualization
- [ ] GraphQL health query support
