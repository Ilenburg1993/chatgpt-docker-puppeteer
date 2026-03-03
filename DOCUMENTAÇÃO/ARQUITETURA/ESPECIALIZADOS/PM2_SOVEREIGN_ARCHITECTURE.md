> **Status**: Especializado **Não é baseline principal**: use [ARCHITECTURE.md](../ARCHITECTURE.md)
> como fonte oficial. **Quando consultar**: apenas para aprofundamento deste recorte.

# PM2 Sovereign Architecture

> **PM2 como Única Fonte de Verdade para Orquestração de Processos**

**Status**: ✅ Implementado (v3.0 - Fev 2026) **Audit Level**: 800 (PM2 Bridge) + 500 (Enforcement)
**Baseline**: `ecosystem.config.cjs` + `pm2_bridge.js` + Scripts de Gestão

---

## Tabela de Conteúdo

1. [Por Que PM2 Soberano?](#por-que-pm2-soberano)
2. [Arquitetura de Enforcement](#arquitetura-de-enforcement)
3. [Processos Gerenciados](#processos-gerenciados)
4. [Configuração (ecosystem.config.cjs)](#configuração-ecosystemconfigcjs)
5. [Monitoramento (pm2_bridge.js)](#monitoramento-pm2_bridgejs)
6. [Health Checks](#health-checks)
7. [Scripts de Gestão](#scripts-de-gestão)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)
10. [Evolução Futura](#evolução-futura)

---

## Por Que PM2 Soberano?

### Problema Original (Jan 2026)

Antes da arquitetura PM2 Sovereign, existiam **3 modos de execução** ambíguos:

1. **`SERVER_MODE=integrated`** → Maestro inicia servidor internamente (via `createExpressServer()`)
2. **`SERVER_MODE=split`** → PM2 gerencia Maestro e Servidor separadamente
3. **`SERVER_MODE=disabled`** → Sem servidor HTTP

**Conflitos Críticos**:

- 🔴 **P1 (EADDRINUSE)**: PM2 + `SERVER_MODE=integrated` → 2 processos tentam usar porta 3008
- 🔴 **Duração do Boot**: Discovery timeout de 5s insuficiente para servidor lento
- 🔴 **Monitoramento Parcial**: `pm2_bridge.js` só monitorava `agente-gpt`, ignorando
  `dashboard-web` e `chrome-proxy`

### Solução: PM2 Sovereign (Fev 2026)

**Princípio**: PM2 é o **único** responsável por lifecycle management. Application code **nunca**
inicia subprocessos.

**Enforcement em 3 Camadas**:

1. **Camada 1: Configuração Forçada** (`ecosystem.config.cjs`)
   - `SERVER_MODE=split` obrigatório em PM2
   - `SERVER_AUTHORITY=standalone` (processos independentes)
   - `CHROME_PROXY_ENABLED=false` (evita proxy interno)

2. **Camada 2: Validação Runtime** (`src/main.js`)
   - Detecta PM2 + `SERVER_MODE=integrated` → `process.exit(1)` com erro claro
   - Verifica porta 9224 antes de criar proxy interno
   - Discovery timeout ajustável (30s padrão)

3. **Camada 3: Monitoramento Completo** (`pm2_bridge.js`)
   - Monitora **todos** os 3 processos
   - Telemetria completa (memory, CPU, uptime, restarts, PID)
   - Socket.io events para Dashboard real-time

**Resultado**: Zero ambiguidade. PM2 decide TUDO sobre processos.

---

## Arquitetura de Enforcement

```
┌─────────────────────────────────────────────────────────────┐
│ CAMADA 1: CONFIGURAÇÃO (ecosystem.config.cjs)               │
│ ──────────────────────────────────────────────────────────  │
│ • Força SERVER_MODE=split                                   │
│ • Força SERVER_AUTHORITY=standalone                         │
│ • Desabilita proxy interno (CHROME_PROXY_ENABLED=false)     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ CAMADA 2: VALIDAÇÃO RUNTIME (src/main.js)                   │
│ ──────────────────────────────────────────────────────────  │
│ • Detecta PM2 + integrated → EXIT 1 (fail-fast)             │
│ • Verifica porta proxy → Skip se ocupada                    │
│ • Discovery timeout adaptativo (30s)                        │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ CAMADA 3: MONITORAMENTO (pm2_bridge.js)                     │
│ ──────────────────────────────────────────────────────────  │
│ • Monitora 3 processos (agente-gpt, dashboard-web, proxy)   │
│ • Telemetria completa (memory, CPU, uptime, PID)            │
│ • Events: pm2:process:event, pm2:process:critical,          │
│           pm2:snapshot, pm2:metrics                         │
│ • Exporta getProcessStates(), refreshSnapshot()             │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ CAMADA 4: SCRIPTS & HEALTH (pm2-check.sh, pm2-startup.sh)  │
│ ──────────────────────────────────────────────────────────  │
│ • 6 validações automatizadas (daemon, processos, restarts,  │
│   memória, env vars, logs)                                  │
│ • Auto-fix mode (--fix)                                     │
│ • Startup seguro com pre-flight checks                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Processos Gerenciados

PM2 Sovereign gerencia **3 processos** independentes:

### 1. `agente-gpt` (Maestro)

**Script**: `index.js` → `src/main.js` **Papel**: Orquestrador de missões, kernel execution, drivers
LLM

**Recursos**:

- Memory: 3GB (`max_memory_restart: 3072`)
- Restarts: automáticos (`autorestart: true`)
- Instances: 1 (single process, não cluster)

**Environment Variables (Enforced)**:

```javascript
{
  NODE_ENV: 'development',
  FORCE_COLOR: '1',
  SERVER_MODE: 'split',              // PM2 SOBERANO
  SERVER_AUTHORITY: 'standalone',    // Signals independentes
  CHROME_PROXY_ENABLED: 'false'      // Sem proxy interno
}
```

**Boot Sequence**: 6 fases

1. Environment & Config
2. NERV Core
3. Kernel Bootstrap
4. Driver System
5. Browser Pool
6. Server Discovery (via NERV)

### 2. `dashboard-web` (HTTP Server)

**Script**: `src/server/main.js` **Papel**: API REST + Dashboard + Socket.io + Health endpoints

**Recursos**:

- Memory: 3GB (`max_memory_restart: 3072`)
- Port: 3008 (HTTP)
- Instances: 1

**Environment Variables (Enforced)**:

```javascript
{
  PORT: 3008,
  NODE_ENV: 'development',
  DAEMON_MODE: 'true',               // Modo standalone (não integrado)
  SERVER_AUTHORITY: 'standalone',    // Signals independentes
  ENABLE_STATE_FILE: 'false'         // NERV-first (sem estado.json)
}
```

**Boot Sequence**: 10 fases

1. Environment & Logger
2. NERV + PM2 Bridge
3. Express Core
4. Health Endpoints (`/api/health/*`)
5. API Routes (`/api/*`)
6. Socket.io Realtime
7. Static Assets
8. Error Handlers
9. Server Listen (3008)
10. NERV Broadcast (`SERVER_READY`)

### 3. `chrome-proxy` (Windows ↔ Container Bridge)

**Script**: `scripts/chrome-proxy-service.js` **Papel**: Proxy HTTP + WebSocket (container:9224 →
Windows:9225)

**Recursos**:

- Memory: 500MB (`max_memory_restart: 500`)
- Ports: 9224 (container), 9225 (Windows)

**Environment Variables**:

```javascript
{
  CHROME_PORT: 9225,           // Chrome DevTools no Windows
  CHROME_PROXY_PORT: 9224      // Proxy no container
}
```

**Arquitetura**: Veja `DOCUMENTAÇÃO/ARQUITETURA/CONNECTION_ARCHITECTURE/` (2,600+ linhas)

---

## Configuração (ecosystem.config.cjs)

```javascript
module.exports = {
  apps: [
    // ───────────────────────────────────────────────────────────
    // 1. AGENTE-GPT (Maestro) — PM2 SOBERANO
    // ───────────────────────────────────────────────────────────
    {
      name: 'agente-gpt',
      script: 'index.js',
      node_args: [...NODE_ARGS_BASE],
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '3072M',
      env: {
        NODE_ENV: 'development',
        FORCE_COLOR: '1',
        SERVER_MODE: 'split', // ✅ PM2 SOBERANO
        SERVER_AUTHORITY: 'standalone', // ✅ Signals independentes
        CHROME_PROXY_ENABLED: 'false', // ✅ Sem proxy interno
      },
    },

    // ───────────────────────────────────────────────────────────
    // 2. DASHBOARD-WEB (HTTP Server) — PM2 SOBERANO
    // ───────────────────────────────────────────────────────────
    {
      name: 'dashboard-web',
      script: 'src/server/main.js',
      node_args: [...NODE_ARGS_BASE],
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '3072M',
      env: {
        PORT: 3008,
        NODE_ENV: 'development',
        DAEMON_MODE: 'true', // ✅ Standalone (não integrado)
        SERVER_AUTHORITY: 'standalone', // ✅ Signals independentes
        ENABLE_STATE_FILE: 'false', // ✅ NERV-first
      },
    },

    // ───────────────────────────────────────────────────────────
    // 3. CHROME-PROXY (Windows ↔ Container)
    // ───────────────────────────────────────────────────────────
    {
      name: 'chrome-proxy',
      script: 'scripts/chrome-proxy-service.js',
      node_args: [...NODE_ARGS_BASE],
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        CHROME_PORT: 9225,
        CHROME_PROXY_PORT: 9224,
      },
    },
  ],
};
```

**Validação**:

```bash
make pm2-validate
# ✓ SERVER_MODE=split configurado
# ✓ SERVER_AUTHORITY=standalone configurado
# ✓ DAEMON_MODE=true configurado
```

---

## Monitoramento (pm2_bridge.js)

### Antes (Single-Process)

```javascript
// ❌ ANTES: Só monitorava agente-gpt
const AGENTE_NAME = 'agente-gpt';

bus.on('process:event', data => {
  if (data.process.name === AGENTE_NAME) {
    const payload = { event, status, ts: Date.now() };
    notify('pm2:process', payload);
  }
});
```

### Depois (All-Process — PM2 Sovereign)

```javascript
// ✅ AGORA: Monitora TODOS os processos
const MANAGED_PROCESSES = ['agente-gpt', 'dashboard-web', 'chrome-proxy'];
let lastProcessStates = new Map();

bus.on('process:event', data => {
  const processName = data.process.name || data.process.pm2_env?.name;

  if (MANAGED_PROCESSES.includes(processName)) {
    const payload = {
      name: processName,
      event: data.event,
      status: data.process.pm2_env?.status,
      pid: data.process.pid,
      pm_id: data.process.pm_id,
      restarts: data.process.restart_time || 0,
      uptime: Date.now() - data.process.pm_uptime,
      memory: data.process.monit.memory,
      cpu: data.process.monit.cpu,
      ts: Date.now(),
    };

    lastProcessStates.set(processName, payload);

    // Evento principal (todos os eventos)
    notify('pm2:process:event', payload);

    // Evento crítico (exit, error, stop)
    if (['exit', 'error', 'stop'].includes(data.event)) {
      notify('pm2:process:critical', payload);
    }
  }
});
```

### Socket.io Events

**4 eventos novos**:

1. **`pm2:process:event`** (todos os eventos)
   - Emitido para QUALQUER mudança (start, restart, reload, online, exit, error, stop)
   - Payload completo (name, event, status, pid, pm_id, restarts, uptime, memory, cpu)

2. **`pm2:process:critical`** (eventos críticos apenas)
   - Filtro: `exit`, `error`, `stop`
   - Usado para alertas/notificações urgentes

3. **`pm2:snapshot`** (snapshot inicial)
   - Emitido quando Socket.io client conecta
   - Retorna estado atual de todos os 3 processos

4. **`pm2:metrics`** (métricas periódicas)
   - Emitido a cada 30s (health check interval)
   - Usado para gráficos/dashboards

### Exported Functions

```javascript
module.exports = {
  init,
  stop,
  getProcessStates, // ✅ NOVO: Retorna Map com estados
  refreshSnapshot, // ✅ NOVO: Force refresh from PM2
  MANAGED_PROCESSES, // ✅ NOVO: Array de processos
};
```

**Uso em Health Endpoints**:

```javascript
const { refreshSnapshot } = require('@server/realtime/bus/pm2_bridge');

app.get('/api/health/pm2', async (req, res) => {
  const states = await refreshSnapshot();
  res.json({
    status: 'ok',
    processes: Array.from(states.values()),
  });
});
```

---

## Health Checks

### 4 Níveis de Monitoramento

#### 1. PM2 Runtime (CLI)

```bash
# Status
pm2 status
pm2 list

# Monitor real-time
pm2 monit

# Logs
pm2 logs
pm2 logs agente-gpt --lines 50
```

#### 2. Scripts de Gestão

```bash
# Health check completo (6 validações)
make pm2-check
bash scripts/pm2-check.sh

# Auto-fix mode
bash scripts/pm2-check.sh --fix

# Startup seguro
bash scripts/pm2-startup.sh
```

**6 Validações**:

1. ✅ PM2 daemon online?
2. ✅ Todos os 3 processos rodando?
3. ✅ Restarts < 3 (estabilidade)?
4. ✅ Memória dentro dos limites?
5. ✅ Environment variables corretas?
6. ✅ Logs sem erros críticos?

#### 3. Health Endpoints (HTTP)

```bash
# Core health
curl http://localhost:3008/api/health

# PM2-specific health
curl http://localhost:3008/api/health/pm2
```

**Response `/api/health/pm2`**:

```json
{
  "status": "ok",
  "processes": [
    {
      "name": "agente-gpt",
      "status": "online",
      "pid": 12345,
      "pm_id": 0,
      "restarts": 0,
      "uptime": 3600000,
      "memory": 256000000,
      "cpu": 2.5
    },
    {
      "name": "dashboard-web",
      "status": "online",
      "pid": 12346,
      "pm_id": 1,
      "restarts": 0,
      "uptime": 3600000,
      "memory": 128000000,
      "cpu": 1.2
    },
    {
      "name": "chrome-proxy",
      "status": "online",
      "pid": 12347,
      "pm_id": 2,
      "restarts": 0,
      "uptime": 3600000,
      "memory": 64000000,
      "cpu": 0.5
    }
  ]
}
```

#### 4. Socket.io Real-Time (Dashboard)

```javascript
// Frontend
socket.on('pm2:process:event', data => {
  console.log(`${data.name} → ${data.event} (${data.status})`);
  updateProcessCard(data);
});

socket.on('pm2:process:critical', data => {
  showAlert(`CRITICAL: ${data.name} ${data.event}`);
});

socket.on('pm2:metrics', data => {
  updateChart(data);
});

// Initial state
socket.on('pm2:snapshot', snapshot => {
  snapshot.forEach(process => renderProcessCard(process));
});
```

---

## Scripts de Gestão

### `pm2-check.sh` (Health Check)

**Uso**:

```bash
bash scripts/pm2-check.sh           # Check apenas
bash scripts/pm2-check.sh --fix     # Check + auto-fix
make pm2-check                      # Via Makefile
```

**6 Checks**:

1. ✅ PM2 daemon respondendo?
2. ✅ Processos esperados rodando?
3. ✅ Restarts < 3?
4. ✅ Memória dentro dos limites?
5. ✅ Env vars corretas?
6. ✅ Logs sem erros críticos?

**Auto-Fix** (com `--fix`):

- Inicia processos faltantes
- Reinicia processos com erro
- Para processos em loop de crash

**Exit Codes**:

- `0` → Tudo OK
- `1` → Problemas detectados

### `pm2-startup.sh` (Safe Startup)

**Uso**:

```bash
bash scripts/pm2-startup.sh
make pm2-startup
```

**5 Fases**:

1. **Pré-voo** (Validações):
   - PM2 instalado?
   - ecosystem.config.cjs existe?
   - Node >= 24?
   - Diretórios criados?

2. **Limpeza** (Processos órfãos):
   - Detecta processos PM2 existentes
   - Pergunta se deseja parar/reiniciar
   - Remove processos órfãos

3. **Inicialização**:
   - `npx pm2 start ecosystem.config.cjs`
   - Wait 3s para boot

4. **Validação** (Health checks):
   - Todos os processos online?
   - Servidor HTTP respondendo (porta 3008)?
   - Timeout 10s

5. **Status**:
   - `pm2 status`
   - Comandos úteis
   - Dashboard URL

**Exemplo de Output**:

```
╔════════════════════════════════════════════════════════════╗
║  PM2 Sovereign Mode - Startup Sequence                    ║
╚════════════════════════════════════════════════════════════╝

[1/5] Pré-voo: Validações...
  ✓ PM2 instalado
  ✓ ecosystem.config.cjs encontrado
  ✓ Node.js v24.13.0 OK
  ✓ Estrutura de diretórios OK

[2/5] Limpeza: Verificando processos órfãos...
  ✓ Nenhum processo órfão

[3/5] Inicialização: Iniciando processos PM2...
  ✓ Processos iniciados

[4/5] Validação: Health checks...
  ✓ agente-gpt online
  ✓ dashboard-web online
  ✓ chrome-proxy online
  ✓ Servidor HTTP respondendo

[5/5] Status: Resumo do sistema...

╔════════════════════════════════════════════════════════════╗
║  ✅ PM2 Sovereign Mode - Sistema Operacional               ║
╚════════════════════════════════════════════════════════════╝

Comandos úteis:
  • Ver logs:      pm2 logs
  • Monitorar:     pm2 monit
  • Status:        pm2 status
  • Restart:       pm2 restart all
  • Health check:  bash scripts/pm2-check.sh
  • Dashboard:     http://localhost:3008

Sistema pronto para uso!
```

### Makefile Targets

```bash
# Health
make health          # pm2-check.sh
make pm2-check       # pm2-check.sh
make pm2-check-fix   # pm2-check.sh --fix

# Startup
make pm2-startup     # pm2-startup.sh (safe boot)

# Validação
npm run daemon:status # Valida estado do daemon PM2
```

---

## Best Practices

### 1. Sempre Use PM2 (Nunca Node Direto)

❌ **ERRADO**:

```bash
node index.js
node src/server/main.js
```

✅ **CORRETO**:

```bash
npx pm2 start ecosystem.config.cjs
make start
bash scripts/pm2-startup.sh
```

### 2. Nunca Use `SERVER_MODE=integrated` em PM2

❌ **ERRADO** (causa EADDRINUSE):

```javascript
// ecosystem.config.cjs
env: {
  SERVER_MODE: 'integrated'; // ❌ CONFLITO!
}
```

✅ **CORRETO**:

```javascript
// ecosystem.config.cjs
env: {
  SERVER_MODE: 'split'; // ✅ PM2 SOBERANO
}
```

### 3. Prefira `pm2 reload` em Produção

❌ **EVITAR** (downtime):

```bash
pm2 restart all
```

✅ **PREFERIR** (zero-downtime):

```bash
pm2 reload all
```

**Diferença**:

- `restart` → Para processo, depois inicia (downtime ~1-2s)
- `reload` → Inicia novo processo, depois para antigo (zero-downtime)

### 4. Configure PM2 Startup (Produção)

**Linux (systemd)**:

```bash
pm2 startup systemd
pm2 save
```

**Efeito**: PM2 inicia automaticamente no boot do sistema.

### 5. Log Rotation (Evitar Logs Gigantes)

```bash
pm2 install pm2-logrotate

# Configurar
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

### 6. Cluster Mode (Produção - Escalabilidade)

**Configuração** (ecosystem.config.cjs):

```javascript
{
    name: 'dashboard-web',
    script: 'src/server/main.js',
    instances: 4,              // 4 instâncias
    exec_mode: 'cluster'       // Cluster mode (load balancing)
}
```

**Cuidado**: `agente-gpt` deve permanecer em `fork` mode (1 instância) porque gerencia estado de
missões.

### 7. Monitoring Externo (Keymetrics)

```bash
pm2 link <secret> <public>
```

Integra com [app.keymetrics.io](https://app.keymetrics.io) para:

- Monitoring real-time
- Alertas customizados
- Dashboards avançados
- Exception tracking

---

## Troubleshooting

### Problema 1: Processo Não Inicia

**Sintomas**:

```bash
pm2 list
# chrome-proxy  stopped
```

**Debug**:

```bash
# Ver logs
pm2 logs chrome-proxy --lines 50

# Restart manual
pm2 restart chrome-proxy

# Se persistir: delete + start
pm2 delete chrome-proxy
npx pm2 start ecosystem.config.cjs --only chrome-proxy
```

### Problema 2: Restarts Excessivos

**Sintomas**:

```bash
pm2 list
# agente-gpt  online  15 restarts
```

**Causas Comuns**:

- Memory leak (excede `max_memory_restart`)
- Uncaught exception (crash loop)
- Port conflict (EADDRINUSE)

**Debug**:

```bash
# Ver últimos crashes
pm2 logs agente-gpt --err --lines 100

# Aumentar memory limit temporariamente
pm2 restart agente-gpt --max-memory-restart 4096M

# Monitorar memória
pm2 monit
```

### Problema 3: PM2 Daemon Travado

**Sintomas**:

```bash
pm2 list
# Timeout ou resposta lenta
```

**Solução**:

```bash
# Kill daemon
pm2 kill

# Restart
npx pm2 start ecosystem.config.cjs
```

### Problema 4: EADDRINUSE (Porta Ocupada)

**Sintomas**:

```
Error: listen EADDRINUSE: address already in use :::3008
```

**Debug**:

```bash
# Verificar porta 3008
lsof -i :3008
netstat -tulpn | grep 3008

# Kill processo órfão
kill -9 <PID>

# Ou usar kill-ports-and-start.bat (Windows)
```

### Problema 5: Variables de Ambiente Incorretas

**Sintomas**:

- `agente-gpt` inicia servidor interno (duplicação)
- `dashboard-web` cria estado.json (deprecated)

**Validação**:

```bash
make pm2-validate
# ✗ SERVER_MODE não encontrado

# Verificar manualmente
pm2 show agente-gpt | grep SERVER_MODE
```

**Correção**:

```bash
# Editar ecosystem.config.cjs (adicionar SERVER_MODE=split)
# Depois:
pm2 restart all
```

---

## Evolução Futura

### Roadmap Q1 2026

**v3.1 (Cluster Mode)**:

- Dashboard em cluster (4 instâncias)
- Load balancing automático
- Session affinity (sticky sessions)

**v3.2 (Health Endpoint Enhancement)**:

- `/api/health/pm2/detailed` (histórico de restarts, CPU trends)
- Alertas configuráveis (Slack, Discord, Email)
- SLA monitoring (uptime %, response time)

**v3.3 (Graceful Shutdown)**:

- Shutdown hooks em todos os processos
- Mission checkpoint save antes de exit
- Zero-loss restart (state persistence)

### Roadmap Q2 2026

**v4.0 (Kubernetes Migration)**:

- PM2 → K8s Deployments + StatefulSets
- Helm charts
- Auto-scaling (HPA)
- Service mesh (Istio)

---

## Conclusão

**PM2 Sovereign Architecture** elimina ambiguidade ao tornar PM2 a **única fonte de verdade** para
lifecycle management.

**Pilares**:

1. ✅ **Enforcement**: `ecosystem.config.cjs` força `SERVER_MODE=split`
2. ✅ **Validação**: `src/main.js` fail-fast em configuração incorreta
3. ✅ **Monitoramento**: `pm2_bridge.js` telemetria completa dos 3 processos
4. ✅ **Tooling**: Scripts automatizados (`pm2-check.sh`, `pm2-startup.sh`)

**Benefícios**:

- 🎯 Zero ambiguidade (PM2 decide tudo)
- 🚀 Startup confiável (6 validações pre-flight)
- 📊 Observabilidade completa (Socket.io real-time)
- 🛡️ Fail-fast (erro claro em misconfiguration)

**Next Steps**:

- Integrar health endpoint (`/api/health/pm2`)
- Cluster mode em produção
- Alertas customizados
- K8s migration (Q2 2026)

---

**Versão**: 3.0 (PM2 Sovereign - Fev 2026) **Autor**: AI Agent Expert + GitHub Copilot **Baseline**:
`ecosystem.config.cjs` + `pm2_bridge.js` v800 + Scripts v3.0
