# 🏥 Sistema de Verificação e Monitoramento

> **Como verificamos se o sistema está funcionando?**
> **Versão**: 1.0 (2026-02-01)

---

## 📋 Visão Geral

O sistema possui **4 camadas de monitoramento** que funcionam como uma orquestra:

```
┌─────────────────────────────────────────────────────────────┐
│                    CAMADA 1: PM2 RUNTIME                     │
│  • pm2 status / pm2 monit                                    │
│  • pm2_bridge.js (eventos de processos)                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                 CAMADA 2: HEALTH ENDPOINTS                   │
│  • /api/health (geral)                                       │
│  • /api/health/chrome, /pm2, /kernel, /disk                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                 CAMADA 3: NERV TELEMETRY                     │
│  • Eventos INFRA_READY, SERVER_READY                        │
│  • health.js (snapshot observável)                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              CAMADA 4: DASHBOARD REAL-TIME                   │
│  • Socket.io streaming (logs, métricas)                     │
│  • Hardware telemetry (CPU, RAM, disco)                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔍 Camada 1: PM2 Runtime (Gerenciamento de Processos)

### **O que monitora**
- 3 processos: `agente-gpt`, `dashboard-web`, `chrome-proxy`
- Status: `online`, `stopped`, `errored`, `one-launch-status`
- Uptime, restarts, memória, CPU

### **Como usar**

#### Comando: `pm2 status`
```bash
pm2 status

# Output esperado:
┌─────┬──────────────┬─────────┬──────┬───────────┬──────────┐
│ id  │ name         │ status  │ cpu  │ memory    │ restarts │
├─────┼──────────────┼─────────┼──────┼───────────┼──────────┤
│ 0   │ agente-gpt   │ online  │ 2%   │ 850 MB    │ 0        │
│ 1   │ dashboard-web│ online  │ 1%   │ 320 MB    │ 0        │
│ 2   │ chrome-proxy │ online  │ 0.5% │ 45 MB     │ 0        │
└─────┴──────────────┴─────────┴──────┴───────────┴──────────┘
```

#### Comando: `pm2 monit` (Dashboard Interativo)
```bash
pm2 monit

# Abre TUI com:
# - Logs em tempo real
# - Gráficos de CPU/RAM
# - Custom metrics (se configurado)
```

#### Comando: `pm2 logs` (Logs Consolidados)
```bash
# Todos os processos
pm2 logs

# Processo específico
pm2 logs agente-gpt

# Filtrar erros
pm2 logs --err
```

### **Integração: pm2_bridge.js**

**Arquivo**: `src/server/realtime/bus/pm2_bridge.js`

**Propósito**: Escuta eventos do PM2 Bus e transmite via Socket.io

```javascript
// Eventos capturados:
- process:start
- process:stop
- process:restart
- process:exit
- process:online

// Health check a cada 30s
pm2Raw.list(err => {
    if (err) {
        log('WARN', 'Link com daemon PM2 perdido. Reiniciando ponte...');
        reconnect();
    }
});
```

**Consumo**: Dashboard recebe eventos via Socket.io

---

## 🏥 Camada 2: Health Endpoints (HTTP API)

### **Endpoints Disponíveis**

#### 1️⃣ **GET /api/health** (Geral)
```bash
curl http://localhost:3008/api/health

# Response:
{
  "status": "ok",
  "timestamp": "2026-02-01T12:34:56.789Z",
  "uptime": 3456,
  "components": {
    "kernel": "ok",
    "browser": "ok",
    "nerv": "ok"
  }
}
```

#### 2️⃣ **GET /api/health/chrome** (Browser Pool)
```bash
curl http://localhost:3008/api/health/chrome

# Response:
{
  "status": "ok",
  "chrome": {
    "connected": true,
    "endpoint": "http://host.docker.internal:9224",
    "version": "144.0.7559.110",
    "browsers": 3
  }
}
```

#### 3️⃣ **GET /api/health/pm2** (Processos)
```bash
curl http://localhost:3008/api/health/pm2

# Response:
{
  "status": "ok",
  "processes": [
    { "name": "agente-gpt", "status": "online", "uptime": 3456 },
    { "name": "dashboard-web", "status": "online", "uptime": 3450 },
    { "name": "chrome-proxy", "status": "online", "uptime": 3448 }
  ]
}
```

#### 4️⃣ **GET /api/health/kernel** (Task Engine)
```bash
curl http://localhost:3008/api/health/kernel

# Response:
{
  "status": "ok",
  "kernel": {
    "running": true,
    "tasks_pending": 5,
    "tasks_running": 2,
    "loop_hz": 20
  }
}
```

#### 5️⃣ **GET /api/health/disk** (Filesystem)
```bash
curl http://localhost:3008/api/health/disk

# Response:
{
  "status": "ok",
  "disk": {
    "total": "50 GB",
    "used": "12 GB",
    "free": "38 GB",
    "percent": 24
  }
}
```

### **Controller**: `src/server/api/controllers/health.js`

**Estrutura**:
```javascript
router.get('/health', async (req, res) => {
    // Agrega checks de múltiplos componentes
    const checks = await Promise.allSettled([
        checkKernel(),
        checkBrowser(),
        checkNERV(),
        checkDisk()
    ]);

    res.json({ status: 'ok', components: checks });
});
```

---

## 📡 Camada 3: NERV Telemetry (Event Bus)

### **O que monitora**
- Eventos de boot: `INFRA_READY`, `SERVER_READY`
- Health snapshots: buffers, conexões, última atividade
- Telemetria granular de cada subsistema

### **Arquivo**: `src/nerv/health/health.js`

**Snapshot observável**:
```javascript
{
    timestamp: 1738414896789,
    transport: {
        connected: true,
        reconnecting: false,
        lastError: null
    },
    buffers: {
        inbound: 42,
        outbound: 15
    },
    activity: {
        lastEmission: 1738414896000,
        lastReception: 1738414895500
    }
}
```

### **Eventos Chave**

#### **INFRA_READY** (Chrome Proxy)
```javascript
// Emitido por: src/main.js Fase 2.5
sendEvent(nerv, ActorRole.INFRA, ActionCode.INFRA_READY, {
    component: 'ChromeProxyService',
    port: 9224,
    host: '192.168.0.2',
    timestamp: Date.now(),
    mode: 'inline'
});
```

#### **SERVER_READY** (Dashboard Web)
```javascript
// Emitido por: src/server/main.js Fase 8
sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, {
    port: 3008,
    pid: process.pid,
    authority: 'standalone'
});
```

### **Discovery Mechanism**

**Maestro escuta SERVER_READY** (30s timeout):
```javascript
// src/main.js Fase 2.5B
const discoveredServerInfo = await waitForServerReady(nerv, {
    timeoutMs: 30000
});

if (discoveredServerInfo) {
    log('INFO', `Server descoberto: porta ${discoveredServerInfo.port}`);
} else {
    log('WARN', 'Discovery timeout - usando fallback');
}
```

---

## 📊 Camada 4: Dashboard Real-Time (Socket.io + Hardware)

### **Streaming de Logs**

**Arquivo**: `src/server/realtime/streams/log_tail.js`

**Funcionalidade**: Tail logs em tempo real via Socket.io

```javascript
// Cliente (Dashboard)
socket.on('log:new', (data) => {
    console.log(data.message);
});

// Servidor emite:
notify('log:new', {
    level: 'INFO',
    message: '[KERNEL] Task executada',
    timestamp: Date.now()
});
```

### **Hardware Telemetry**

**Arquivo**: `src/server/realtime/telemetry/hardware.js`

**Métricas coletadas**:
- CPU usage (%)
- Memória RAM (MB / %)
- Disco (GB / %)
- Load average (1m, 5m, 15m)

**Intervalo**: 10 segundos

```javascript
// Exemplo de payload
{
    cpu: 45.2,        // % usage
    memory: {
        used: 2048,   // MB
        total: 8192,  // MB
        percent: 25   // %
    },
    disk: {
        used: 12000,  // MB
        total: 50000, // MB
        percent: 24   // %
    },
    loadavg: [1.5, 1.2, 0.9]
}
```

### **Snapshot System**

**Arquivo**: `src/server/telemetry/snapshot.js`

**Propósito**: Snapshot periódico do estado completo

```javascript
// Intervalo: 60 segundos
{
    timestamp: Date.now(),
    processes: [...],     // PM2 list
    kernel: {...},        // Task queue stats
    browser: {...},       // Pool status
    missions: {...},      // Missões ativas
    hardware: {...}       // CPU/RAM/Disk
}
```

---

## 🛠️ Como Usar (Passo a Passo)

### **1. Verificação Rápida (30 segundos)**

```bash
# 1. PM2 status
pm2 status
# ✅ Todos processos "online"? → OK
# ❌ Algum "stopped" ou "errored"? → Investigar

# 2. Health check HTTP
curl http://localhost:3008/api/health
# ✅ status: "ok"? → OK
# ❌ status: "degraded" ou erro? → Investigar

# 3. Logs recentes
pm2 logs --lines 50
# ✅ Sem "[ERROR]" ou "[FATAL]"? → OK
# ❌ Muitos erros? → Investigar
```

### **2. Diagnóstico Profundo (5 minutos)**

```bash
# 1. Health de cada componente
curl http://localhost:3008/api/health/chrome   # Browser pool
curl http://localhost:3008/api/health/kernel   # Task engine
curl http://localhost:3008/api/health/pm2      # Processos
curl http://localhost:3008/api/health/disk     # Filesystem

# 2. PM2 monit (dashboard interativo)
pm2 monit
# Observar: CPU < 50%, RAM < 80%, restarts = 0

# 3. Logs por processo
pm2 logs agente-gpt --lines 100
pm2 logs dashboard-web --lines 100
pm2 logs chrome-proxy --lines 50

# 4. Métricas de hardware
curl http://localhost:3008/api/metrics
```

### **3. Monitoramento Contínuo (Produção)**

#### **Opção A: PM2 Plus** (SaaS)
```bash
pm2 link <secret> <public>
# Dashboard web: https://app.pm2.io
```

#### **Opção B: Logs + Alertas**
```bash
# Centralizar logs
pm2 install pm2-logrotate

# Configurar alertas
pm2 install pm2-slack  # ou pm2-discord
```

#### **Opção C: Dashboard Custom**
```bash
# Abrir dashboard web local
open http://localhost:3008
# Seção "Monitoring" → Real-time metrics
```

---

## 🚨 Indicadores de Problemas

### **❌ Sistema NÃO funcionando**

| Sintoma                       | Causa Provável        | Solução                           |
| ----------------------------- | --------------------- | --------------------------------- |
| `pm2 status` mostra "stopped" | Crash no boot         | `pm2 logs` → verificar erro       |
| `/api/health` retorna 502/503 | Server não iniciou    | Verificar `SERVER_MODE` + PM2     |
| `chrome-proxy` offline        | Porta 9224 em uso     | Verificar `lsof -i :9224`         |
| `agente-gpt` restarting loop  | EADDRINUSE (conflito) | Verificar `SERVER_MODE=split`     |
| CPU > 90% constante           | Loop infinito ou leak | `pm2 monit` → investigar processo |
| RAM > 90%                     | Memory leak           | Restart: `pm2 restart all`        |

### **✅ Sistema Funcionando Corretamente**

- ✅ `pm2 status`: Todos processos "online", 0 restarts
- ✅ `/api/health`: `{ status: "ok" }`
- ✅ Logs: Sem `[ERROR]` ou `[FATAL]` recentes
- ✅ CPU < 50%, RAM < 70%
- ✅ Uptime > 1 hora sem restarts

---

## 📚 Arquivos Relacionados

**Monitoring**:
- `src/server/realtime/bus/pm2_bridge.js` - PM2 eventos
- `src/server/api/controllers/health.js` - Health endpoints
- `src/nerv/health/health.js` - NERV telemetry
- `src/server/realtime/telemetry/hardware.js` - Métricas hardware

**Logs**:
- `logs/app.log` - Logs gerais
- `logs/error.log` - Apenas erros
- `logs/crash_reports/` - Dumps de crashes

**Scripts**:
- `scripts/validate-boot-fixes.sh` - Validação boot
- `Makefile` - Targets: `make health`, `make status`, `make logs`

---

## 🎯 Próximos Passos

### **P1 - Implementar** (próxima sprint)
- [ ] `/api/health/full` - Health check consolidado
- [ ] Alertas via Slack/Discord/Email
- [ ] Dashboard React completo

### **P2 - Melhorar**
- [ ] Métricas Prometheus/Grafana
- [ ] Logs centralizados (ELK/Loki)
- [ ] Tracing distribuído (OpenTelemetry)

---

**🎉 Sistema de monitoramento completo e funcional!**
**Use**: `pm2 status` + `curl /api/health` para verificação rápida
