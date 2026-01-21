# 🔧 Guia de Troubleshooting

**Versão**: 1.0
**Última Atualização**: 21/01/2026
**Público-Alvo**: Desenvolvedores, DevOps, Usuários
**Tempo de Leitura**: ~30 min

---

## 📖 Visão Geral

Este documento cataloga **problemas comuns** do sistema `chatgpt-docker-puppeteer` com diagnósticos e soluções passo-a-passo.

---

## 🗂️ Categorias

1. [Boot & Startup](#-boot--startup)
2. [Browser & Conexão](#-browser--conexão)
3. [Tasks & Execução](#-tasks--execução)
4. [Locks & Concorrência](#-locks--concorrência)
5. [Queue & File System](#-queue--file-system)
6. [Performance & Memory](#-performance--memory)
7. [Network & API](#-network--api)
8. [Security & Auth](#-security--auth)
9. [PM2 & Processes](#-pm2--processes)
10. [Docker & Containers](#-docker--containers)

---

## 🚀 Boot & Startup

### Problema: Sistema não inicia

**Sintomas**:
```
[ERROR] Failed to start agent
Error: Cannot find module './src/core/config'
```

**Diagnóstico**:
```bash
# Check file structure
ls -la src/core/config.js

# Check dependencies
npm list
```

**Causas comuns**:
1. ❌ `npm install` não executado
2. ❌ Arquivos faltando (clone incompleto)
3. ❌ Node.js version incompatível (<20.0.0)

**Solução**:
```bash
# 1. Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# 2. Verify Node version
node -v  # Should be >=20.0.0

# 3. Check file integrity
git status
git reset --hard HEAD  # If corrupted

# 4. Retry start
make start
```

---

### Problema: Config validation failed

**Sintomas**:
```
[ERROR] Configuration validation failed:
  - maxWorkers: Expected number, received string
  - dashboardPassword: String must contain at least 8 character(s)
```

**Diagnóstico**:
```bash
# Validate config manually
node -e "
const config = require('./config.json');
const { configSchema } = require('./src/core/schemas');
console.log(configSchema.parse(config));
"
```

**Causas**:
- ❌ Valores com tipo errado (string vs number)
- ❌ Password muito curta (<8 chars)
- ❌ Valores fora do range

**Solução**:
```json
// ❌ Errado
{
  "maxWorkers": "3",  // String
  "dashboardPassword": "123"  // Muito curta
}

// ✅ Correto
{
  "maxWorkers": 3,  // Number
  "dashboardPassword": "secure-password-123"  // Min 8 chars
}
```

**Verificar schema**:
```javascript
// src/core/schemas.js
maxWorkers: z.number().int().min(1).max(20),
dashboardPassword: z.string().min(8).nullable()
```

---

### Problema: Port already in use

**Sintomas**:
```
[ERROR] Error: listen EADDRINUSE: address already in use :::3008
```

**Diagnóstico**:
```bash
# Check what's using port 3008
lsof -i :3008  # Linux/Mac
netstat -ano | findstr :3008  # Windows

# Output:
# node    12345 user   23u  IPv6  TCP *:3008 (LISTEN)
```

**Solução**:

**Opção A: Kill processo**:
```bash
# Linux/Mac
kill -9 12345

# Windows
taskkill /F /PID 12345
```

**Opção B: Mudar porta**:
```bash
# .env
DASHBOARD_PORT=3009

# Restart
make restart
```

---

## 🌐 Browser & Conexão

### Problema: Browser connection failed

**Sintomas**:
```
[ERROR] [INFRA] Failed to connect to browser
Error: connect ECONNREFUSED 127.0.0.1:9222
```

**Diagnóstico**:
```bash
# Check external browser
curl http://localhost:9222/json/version

# If connection refused:
# - Browser not running
# - Wrong port
# - Firewall blocking
```

**Causas**:
1. ❌ External browser não iniciado (mode: external)
2. ❌ Porta incorreta (config: 9222, browser: 9223)
3. ❌ Browser crashou durante execução

**Solução**:

**Opção A: Start external browser**:
```bash
# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%USERPROFILE%\chrome-debug"

# Linux/Mac
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=$HOME/chrome-debug &

# Verify connection
curl http://localhost:9222/json/version
```

**Opção B: Switch to launcher mode**:
```json
// config.json
{
  "browserMode": "launcher"  // Agent inicia browser automaticamente
}
```

**Opção C: Use hybrid mode** (fallback automático):
```json
{
  "browserMode": "hybrid"  // Tenta external, fallback launcher
}
```

---

### Problema: Browser DEGRADED status

**Sintomas**:
```
[WARN] [POOL] Browser instance degraded (response time: 6200ms)
```

**Diagnóstico**:
```bash
# Check pool status
curl http://localhost:3008/api/metrics | jq '.browserPool'

# Output:
{
  "healthy": 2,
  "degraded": 1,  # ← Problema
  "crashed": 0
}
```

**Causas**:
- ⚠️ Response time >5s (P9.2 circuit breaker)
- ⚠️ Memory leak no browser
- ⚠️ CPU throttling

**Solução**:

**1. Restart browser instance**:
```javascript
// Via API (futuro)
POST /api/browser/restart/:instanceId

// Manual: Kill browser PID
ps aux | grep chrome
kill -9 <PID>
```

**2. Adjust pool size**:
```json
// config.json
{
  "browserPoolSize": 5  // Aumentar de 3 para 5 (mais redundância)
}
```

**3. Monitor memory**:
```bash
# Check browser memory
ps aux | grep chrome | awk '{sum+=$6} END {print sum/1024 " MB"}'
```

---

### Problema: Browser crashes frequentes

**Sintomas**:
```
[ERROR] [POOL] Browser instance crashed (exit code: -11)
[ERROR] [POOL] Circuit breaker OPEN (5 consecutive failures)
```

**Diagnóstico**:
```bash
# Check crash logs
tail -100 logs/agente-gpt-err.log | grep "Browser crash"

# Check system resources
free -m  # Linux
top      # CPU usage
```

**Causas**:
- ❌ Out of memory (OOM killer)
- ❌ Shared memory `/dev/shm` cheio (Docker)
- ❌ Too many tabs open

**Solução**:

**1. Aumentar memória (Docker)**:
```yaml
# docker-compose.yml
services:
  agente-gpt:
    mem_limit: 2g  # De 1g para 2g
    shm_size: '2gb'  # Shared memory
```

**2. Add Chrome flags**:
```bash
# .env
LAUNCH_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu
```

**3. Reduce pool size**:
```json
// config.json (low-resource mode)
{
  "browserPoolSize": 1,
  "maxWorkers": 1
}
```

---

## 📋 Tasks & Execução

### Problema: Task stuck em RUNNING

**Sintomas**:
```
Task abc123 has been RUNNING for 15 minutes
Expected: max 5 minutes (taskTimeout)
```

**Diagnóstico**:
```bash
# Check task status
curl http://localhost:3008/api/task/abc123 | jq

# Check locks
node -e "
const locks = require('./src/infra/lock_manager');
console.log(locks.listActiveLocks());
"
```

**Causas**:
1. ❌ Task timeout não configurado
2. ❌ Lock não liberado (processo morreu)
3. ❌ Browser travado (waiting for selector)

**Solução**:

**1. Cancel task manualmente**:
```bash
# Via API
curl -X POST http://localhost:3008/api/task/abc123/cancel \
  -H "Authorization: Bearer YOUR_PASSWORD"

# Via file system
rm fila/abc123.json
```

**2. Force unlock**:
```javascript
// Break orphaned lock
const locks = require('./src/infra/lock_manager');
locks.breakLock('abc123', 'chatgpt');
```

**3. Restart agent** (última opção):
```bash
make restart
```

---

### Problema: Task sempre falha

**Sintomas**:
```
[ERROR] [TASK] Task xyz789 failed (attempt 3/3)
Error: Timeout waiting for selector 'textarea'
```

**Diagnóstico**:
```bash
# Check response file
cat respostas/xyz789.txt

# Check task details
curl http://localhost:3008/api/task/xyz789 | jq '.failureHistory'

# Output:
[
  {
    "attempt": 1,
    "error": "Timeout waiting for selector",
    "timestamp": 1737450000000
  },
  ...
]
```

**Causas**:
1. ❌ Selector desatualizado (LLM mudou UI)
2. ❌ Prompt inválido (vazio, muito longo)
3. ❌ Network timeout

**Solução**:

**1. Update selectors** (dynamic_rules.json):
```json
{
  "targets": {
    "chatgpt": {
      "selectors": {
        "input": "textarea[data-id='root']",  // Verificar se mudou
        "submit": "button[data-testid='send-button']"
      }
    }
  }
}
```

**2. Test selector manualmente**:
```javascript
// Chrome DevTools Console
document.querySelector('textarea[data-id="root"]')
// Se retornar null → selector errado
```

**3. Validate prompt**:
```bash
# Check length
echo -n "Seu prompt" | wc -c  # Max 10000 chars

# Check forbidden terms
grep -i "forbidden_term" fila/xyz789.json
```

---

### Problema: Response vazia ou incompleta

**Sintomas**:
```
Task completed but response is empty
File: respostas/task-123.txt (0 bytes)
```

**Diagnóstico**:
```bash
# Check response file
ls -lh respostas/task-123.txt
# -rw-r--r-- 1 user user 0 Jan 21 10:30 task-123.txt  # ← 0 bytes

# Check logs
grep "task-123" logs/agente-gpt-out.log | grep COLLECT
```

**Causas**:
- ❌ Response selector errado
- ❌ LLM ainda processando (collection muito rápida)
- ❌ Response em shadow DOM (não acessível)

**Solução**:

**1. Ajustar collection timing**:
```json
// config.json
{
  "collectionPollInterval": 2000,  // De 1s para 2s
  "collectionMaxStable": 5  // De 3 para 5 iterações
}
```

**2. Update response selector**:
```json
// dynamic_rules.json
{
  "targets": {
    "chatgpt": {
      "selectors": {
        "response": "div.markdown"  // Verificar no DevTools
      }
    }
  }
}
```

**3. Manual collection test**:
```javascript
// Chrome DevTools
Array.from(document.querySelectorAll('div.markdown'))
  .map(el => el.innerText)
  .join('\n')
```

---

## 🔒 Locks & Concorrência

### Problema: Lock timeout

**Sintomas**:
```
[WARN] [LOCK] Failed to acquire lock for task-456 (target: chatgpt)
Reason: Lock held by agent-xyz123:12345
```

**Diagnóstico**:
```bash
# List active locks
node -e "
const io = require('./src/infra/io');
console.log(io.listActiveLocks());
"

# Check lock file
cat fila/.lock-chatgpt
# agent-xyz123:12345:1737450000000
```

**Causas**:
1. ❌ Lock não liberado (processo crashou)
2. ❌ Multiple agents sem coordenação (distributed env)
3. ❌ Lock timeout muito curto

**Solução**:

**1. Check lock owner alive** (P5.1):
```javascript
const locks = require('./src/infra/lock_manager');
const isAlive = locks.isLockOwnerAlive('chatgpt');
console.log(isAlive);  // false → lock órfã
```

**2. Break orphaned lock**:
```bash
# Remove lock file
rm fila/.lock-chatgpt

# Or via code
node -e "
const locks = require('./src/infra/lock_manager');
locks.breakLock('task-456', 'chatgpt');
"
```

**3. Increase lock timeout**:
```json
// config.json
{
  "lockTimeout": 120000  // De 60s para 120s
}
```

---

### Problema: Race condition (task executado 2x)

**Sintomas**:
```
[WARN] [P5.1] Race detected: expected PENDING, got RUNNING
Task allocated by 2 workers simultaneously
```

**Diagnóstico**:
```bash
# Check task state history
curl http://localhost:3008/api/task/task-789 | jq '.stateHistory'

# Output:
[
  {"state": "PENDING", "timestamp": 1737450000},
  {"state": "RUNNING", "timestamp": 1737450001},
  {"state": "RUNNING", "timestamp": 1737450001}  # ← Duplicado!
]
```

**Causa**:
- ❌ Optimistic locking falhou (P5.1)
- ❌ File system delay (NFS lento)

**Solução**:

**1. Verificar fix P5.1**:
```javascript
// src/kernel/task_runtime.js
async function allocateTask(taskId, expectedState = 'PENDING') {
    const task = await io.getTask(taskId);

    // ✅ Race detection
    if (task.state !== expectedState) {
        logger.log('WARN', `[P5.1] Race detected`, taskId);
        return null;  // Abort allocation
    }

    task.state = 'RUNNING';
    await io.saveTask(task);
    return task;
}
```

**2. Se problema persistir** (distributed env):
```bash
# Use Redis distributed locks
npm install ioredis

# Configure Redis coordination
# Ver DEPLOYMENT.md seção "Lock Coordination"
```

---

## 📂 Queue & File System

### Problema: Queue scan lento (>1s)

**Sintomas**:
```
[PERF] Queue scan took 1200ms (expected <500ms)
```

**Diagnóstico**:
```bash
# Count files in queue
ls -1 fila/*.json | wc -l
# 500 files

# Time scan manually
time ls fila/*.json
```

**Causa**:
- ⚠️ Muitos arquivos (>100)
- ⚠️ Cache invalidado (P9.4)
- ⚠️ Slow disk I/O

**Solução**:

**1. Verificar cache P9.4**:
```javascript
// src/infra/io.js
const queueCache = { tasks: null, lastScan: 0 };

function scanQueue() {
    const now = Date.now();
    if (queueCache.tasks && (now - queueCache.lastScan) < 5000) {
        return queueCache.tasks;  // ✅ Hit: 0.1ms
    }
    // Miss: Rebuild cache (200ms)
}
```

**2. Limpar queue antiga**:
```bash
# Archive completed tasks
mkdir -p fila/archive
mv fila/*-DONE-*.json fila/archive/

# Or delete old tasks (>7 days)
find fila/ -name "*.json" -mtime +7 -delete
```

**3. Reduce scan frequency**:
```json
// config.json
{
  "queueScanInterval": 10000  // De 5s para 10s
}
```

---

### Problema: Corrupted task file

**Sintomas**:
```
[ERROR] [QUEUE] Corrupted task file: task-abc.json
Error: Unexpected token } in JSON at position 245
```

**Diagnóstico**:
```bash
# Validate JSON
cat fila/task-abc.json | jq .
# parse error: Invalid numeric literal at line 5, column 10

# Check file
cat fila/task-abc.json
# { "id": "task-abc", "state": "PENDING"  # ← Missing }
```

**Causa**:
- ❌ Write interrupted (disk full, crash)
- ❌ Manual edit (typo)

**Solução**:

**1. Move to corrupted dir**:
```bash
# Automatic (schema validation)
# Agent moves to fila/corrupted/ on boot

# Manual
mkdir -p fila/corrupted
mv fila/task-abc.json fila/corrupted/
```

**2. Repair JSON**:
```bash
# Fix manually
nano fila/corrupted/task-abc.json
# Add missing }

# Validate
cat fila/corrupted/task-abc.json | jq .

# Move back
mv fila/corrupted/task-abc.json fila/
```

**3. Prevent** (atomic writes - já implementado):
```javascript
// src/infra/io.js
async function saveTask(task) {
    const tmpPath = path.join(TMP_DIR, `${task.id}.tmp`);
    await fs.writeFile(tmpPath, JSON.stringify(task, null, 2));
    await fs.rename(tmpPath, taskPath);  // ✅ Atomic
}
```

---

## 💾 Performance & Memory

### Problema: High memory usage

**Sintomas**:
```
[WARN] [P9.1] Heap usage: 456MB / 512MB (89%)
PM2 restarting due to max_memory_restart (800M)
```

**Diagnóstico**:
```bash
# Check heap metrics
curl http://localhost:3008/api/health-metrics | jq '.heap'

# Output:
{
  "used": 478482432,     # 456 MB
  "total": 536870912,    # 512 MB
  "limit": 838860800,    # 800 MB
  "usagePercent": 89.1   # ← Alto!
}

# PM2 memory
pm2 describe agente-gpt | grep memory
# memory: 765 MB
```

**Causas**:
- ❌ Memory leak (event listeners, pages não fechadas)
- ❌ Cache excessivo (NERV buffers, queue cache)
- ❌ Too many workers

**Solução**:

**1. Force garbage collection**:
```bash
# Manual GC (apenas debug)
node --expose-gc index.js

# Trigger GC
curl -X POST http://localhost:3008/api/system/gc
```

**2. Reduce buffers**:
```json
// config.json
{
  "nervBufferMaxSize": 5000,  // De 10000 para 5000
  "observationStoreSize": 500  // De 1000 para 500
}
```

**3. Restart PM2 on high memory**:
```javascript
// ecosystem.config.js
{
  max_memory_restart: '600M',  // De 800M para 600M (restart mais cedo)
  node_args: '--max-old-space-size=512'
}
```

**4. Profile memory leak**:
```bash
# Chrome DevTools
node --inspect index.js
# Chrome: chrome://inspect → Open DevTools
# Memory tab → Take heap snapshot → Compare
```

---

### Problema: High CPU usage

**Sintomas**:
```
CPU constantly at 100%
System unresponsive
```

**Diagnóstico**:
```bash
# Check CPU per process
top -p $(pgrep -f "node.*index.js")

# PM2 monitoring
pm2 monit
```

**Causas**:
- ❌ Infinite loop (kernel cycle sem delay)
- ❌ Too many workers (CPU oversubscribed)
- ❌ Browser processes (Chromium multi-process)

**Solução**:

**1. Reduce workers**:
```json
// config.json
{
  "maxWorkers": 2  // De 10 para 2
}
```

**2. Increase kernel cycle**:
```json
{
  "kernelCycleMs": 100  // De 50ms (20Hz) para 100ms (10Hz)
}
```

**3. Profile CPU**:
```bash
# Clinic flame graph
npm install -g clinic
clinic flame -- node index.js

# Wait 2min, Ctrl+C
# Opens HTML with flame graph
```

---

## 🌐 Network & API

### Problema: API retorna 503 Service Unavailable

**Sintomas**:
```bash
curl http://localhost:3008/api/health
# 503 Service Unavailable
```

**Diagnóstico**:
```bash
# Check process
ps aux | grep "node.*index.js"

# Check port
lsof -i :3008
# (empty) → Nothing listening
```

**Causas**:
- ❌ Agent crashou (boot error)
- ❌ Port blocked by firewall
- ❌ Server não iniciado

**Solução**:

**1. Check logs**:
```bash
tail -100 logs/agente-gpt-err.log

# Look for:
# - Boot errors
# - Port conflicts
# - Unhandled exceptions
```

**2. Restart**:
```bash
make restart

# Or PM2
pm2 restart agente-gpt
```

**3. Verify port**:
```bash
# Test localhost
curl http://localhost:3008/api/health

# Test external
curl http://$(hostname -I | awk '{print $1}'):3008/api/health
```

---

### Problema: Rate limit 429

**Sintomas**:
```bash
curl http://localhost:3008/api/queue/add -X POST -d '{...}'
# 429 Too Many Requests
# {"error": "Rate limit exceeded. Retry after 30s"}
```

**Diagnóstico**:
```bash
# Check headers
curl -I http://localhost:3008/api/queue

# X-RateLimit-Limit: 100
# X-RateLimit-Remaining: 0
# X-RateLimit-Reset: 1737450060
```

**Causa**:
- ⚠️ Exceeded 100 requests/min

**Solução**:

**1. Wait** (60s window):
```bash
# Wait for reset
sleep 60
curl http://localhost:3008/api/queue
```

**2. Increase limit** (config):
```bash
# .env
RATE_LIMIT_MAX=200  # De 100 para 200
RATE_LIMIT_WINDOW_MS=60000

# Restart
make restart
```

**3. Disable rate limiting** (dev only):
```javascript
// src/server/middleware/rate_limiter.js
const rateLimiter = {
    enabled: process.env.NODE_ENV === 'production',  // Desabilita em dev
    // ...
};
```

---

## 🔐 Security & Auth

### Problema: Dashboard 401 Unauthorized

**Sintomas**:
```bash
curl http://localhost:3008/api/queue
# 401 Unauthorized
# {"error": "Authentication required"}
```

**Diagnóstico**:
```bash
# Check config
cat config.json | jq '.dashboardPassword'
# "my-secret-password"  # ← Auth enabled

# Check .env
grep DASHBOARD_PASSWORD .env
# DASHBOARD_PASSWORD=my-secret-password
```

**Causa**:
- ⚠️ dashboardPassword configurado mas não enviando credenciais

**Solução**:

**1. Include password**:
```bash
# Basic auth
curl -u :my-secret-password http://localhost:3008/api/queue

# Bearer token
curl -H "Authorization: Bearer my-secret-password" \
  http://localhost:3008/api/queue
```

**2. Disable auth** (dev only):
```json
// config.json
{
  "dashboardPassword": null  // Remove senha
}

// .env
DASHBOARD_PASSWORD=
```

---

### Problema: CORS blocked

**Sintomas**:
```
Access to fetch at 'http://localhost:3008/api/queue' from origin 'http://localhost:3000'
has been blocked by CORS policy
```

**Diagnóstico**:
```bash
# Check CORS origin
grep CORS_ORIGIN .env
# CORS_ORIGIN=https://dashboard.example.com  # ← Restrito
```

**Solução**:

**1. Allow origin**:
```bash
# .env
CORS_ORIGIN=http://localhost:3000

# Or allow all (dev only)
CORS_ORIGIN=*
```

**2. Restart**:
```bash
make restart
```

---

## 🔄 PM2 & Processes

### Problema: PM2 restart loop

**Sintomas**:
```bash
pm2 status
# agente-gpt │ errored │ 10 │ 0s │ 50 restarts
```

**Diagnóstico**:
```bash
# Check error logs
pm2 logs agente-gpt --err --lines 50

# Check restart count
pm2 describe agente-gpt | grep restarts
```

**Causas**:
- ❌ Boot error (syntax, missing module)
- ❌ Crash no startup (<10s uptime)
- ❌ Port conflict

**Solução**:

**1. Reset restart counter**:
```bash
pm2 reset agente-gpt
```

**2. Check boot error**:
```bash
# Run directly (sem PM2)
node index.js

# Ver erro real
```

**3. Increase min_uptime**:
```javascript
// ecosystem.config.js
{
  min_uptime: '30s',  // De 10s para 30s
  max_restarts: 20    // De 10 para 20
}
```

---

## 🐳 Docker & Containers

### Problema: Container não inicia

**Sintomas**:
```bash
docker ps
# (container não aparece)

docker ps -a
# agente-gpt-prod  Exited (1) 2 seconds ago
```

**Diagnóstico**:
```bash
# Check logs
docker logs agente-gpt-prod

# Inspect
docker inspect agente-gpt-prod
```

**Causas**:
- ❌ Volume mount inválido
- ❌ Env vars faltando
- ❌ Port conflict

**Solução**:

**1. Check volumes**:
```yaml
# docker-compose.yml
volumes:
  - ./fila:/app/fila  # ✅ Path existe?
  - ./respostas:/app/respostas
```

**2. Create dirs**:
```bash
mkdir -p fila respostas logs profile backups
```

**3. Recreate container**:
```bash
docker-compose down
docker-compose up -d --force-recreate
```

---

## 📚 Referências

- [DEVELOPMENT.md](DEVELOPMENT.md) - Debugging avançado
- [CONFIGURATION.md](CONFIGURATION.md) - Tuning parameters
- [DEPLOYMENT.md](DEPLOYMENT.md) - Production issues
- [FAQ.md](FAQ.md) - Perguntas frequentes

---

## 💡 Ainda com problemas?

1. **GitHub Issues**: https://github.com/ORG/chatgpt-docker-puppeteer/issues
2. **Discussions**: https://github.com/ORG/chatgpt-docker-puppeteer/discussions
3. **Logs completos**: `make diagnose` gera relatório detalhado

---

*Última revisão: 21/01/2026 | Contribuidores: AI Architect, Support Team*
