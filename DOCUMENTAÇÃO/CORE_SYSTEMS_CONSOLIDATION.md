# 🎯 Consolidação dos Sistemas Fundamentais
**Data**: 3 de Fevereiro de 2026
**Versão**: v1.0
**Status**: ✅ Revisão Completa | 🔍 Documentação Canônica

---

## 📋 ÍNDICE

1. [Visão Geral](#visão-geral)
2. [Sistema 1: Boot Sequence](#sistema-1-boot-sequence)
3. [Sistema 2: Browser Connection](#sistema-2-browser-connection)
4. [Sistema 3: Driver Integration](#sistema-3-driver-integration)
5. [Fluxo de Execução Completo](#fluxo-de-execução-completo)
6. [Validação e Testes](#validação-e-testes)
7. [Troubleshooting](#troubleshooting)

---

## 🌟 VISÃO GERAL

### Propósito Deste Documento

Este documento consolida a arquitetura e funcionamento dos **3 sistemas fundamentais** que servem de base para toda a operação do projeto:

1. **Boot Sequence** (`src/main.js` + `boot_resilience_manager.js`)
2. **Browser Connection** (`ConnectionOrchestrator.js` + `pool_manager.js`)
3. **Driver Integration** (`DriverLifecycleManager.js` + `execution_engine.js`)

**Por que são fundamentais?**
- ✅ **Boot** garante inicialização ordenada e resiliente de todos os subsistemas
- ✅ **Browser Connection** estabelece comunicação com Chrome via Puppeteer
- ✅ **Driver Integration** executa automação via drivers (ChatGPT, Gemini, Claude)

**Interdependências**:
```
┌─────────────────────────────────────────────────────────────────┐
│ BOOT SEQUENCE                                                   │
│  ├─ Fase 1: Config + Identity                                  │
│  ├─ Fase 2: NERV (Event Bus)                                   │
│  ├─ Fase 2.5: Chrome Proxy Service                             │
│  ├─ Fase 3: Browser Pool Manager ← ConnectionOrchestrator      │
│  ├─ Fase 3.5: ContextManager                                   │
│  ├─ Fase 4: KERNEL                                             │
│  ├─ Fase 5: Adapters (Driver + Server)                         │
│  └─ Fase 5.5: Mission Orchestration                            │
└─────────────────────────────────────────────────────────────────┘
             ↓
┌─────────────────────────────────────────────────────────────────┐
│ BROWSER CONNECTION                                              │
│  ├─ ConnectionOrchestrator (3 modos: wsEndpoint, connect, auto)│
│  ├─ BrowserPoolManager (pool de 3 instâncias)                  │
│  ├─ Circuit Breaker (detecção inteligente de falhas)           │
│  └─ Health Checks (heartbeat a cada 30s)                       │
└─────────────────────────────────────────────────────────────────┘
             ↓
┌─────────────────────────────────────────────────────────────────┐
│ DRIVER INTEGRATION                                              │
│  ├─ DriverLifecycleManager v2.0 (EventEmitter)                 │
│  ├─ Factory (ChatGPT, Gemini, Claude drivers)                  │
│  ├─ ExecutionEngine (orquestra task execution)                 │
│  └─ DriverNERVAdapter (ponte NERV)                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 SISTEMA 1: BOOT SEQUENCE

### Responsabilidades

**Arquivo Principal**: `src/main.js`
**Módulo de Resiliência**: `src/core/boot_resilience_manager.js`

**O que faz**:
- ✅ Orquestra boot sequence em 6 fases ordenadas
- ✅ Detecta e trata falhas durante boot (modo degradado)
- ✅ Valida conflitos de configuração (PM2 + SERVER_MODE, porta EADDRINUSE)
- ✅ Oferece opções ao usuário quando Chrome não está disponível
- ✅ Garante graceful shutdown (SIGTERM, SIGINT)

### Arquitetura - 6 Fases de Boot

#### **Fase 1: Configuração e Identidade**
```javascript
// Carga de configuração
await CONFIG.reload('sys-boot');

// Identidade do robô
await identityManager.initialize();
const identity = identityManager.getFullIdentity();
// → { robot_id: 'agente-001', ... }
```

**Validações**:
- ✅ Resolve `SERVER_AUTHORITY` (standalone | delegated)
- ✅ Resolve `SERVER_MODE` (integrated | split | disabled)
- ✅ Detecta conflito PM2 + SERVER_MODE=integrated → FATAL exit

**Outputs**:
- `identity.robot_id` disponível globalmente
- `SERVER_MODE` determinístico

---

#### **Fase 2: NERV (Event Bus)**
```javascript
const nerv = await createNERV({
    mode: CONNECTION_MODES.HYBRID,
    correlation: true,
    bufferSize: 1000,
    telemetry: true
});
```

**Features**:
- ✅ Event-driven architecture (zero acoplamento direto)
- ✅ Correlation IDs para rastreamento
- ✅ Buffer de 1000 eventos (overflow policy)
- ✅ Telemetria integrada

**Injeção NERV**:
```javascript
forensics.setNERV(nerv);
setInfraPolicyNERV(nerv);
// Circuit Breaker (BrowserPool) recebe NERV em Fase 3
// DriverAdapter recebe NERV em Fase 5
```

---

#### **Fase 2.5: Chrome Proxy Service** (🆕 v3.0)
```javascript
// Validação: Proxy duplicado?
const proxyAlreadyRunning = await checkPortInUse(9224);

if (!proxyAlreadyRunning) {
    const chromeProxy = new ChromeProxyService({
        PROXY_PORT: 9224,
        CHROME_PORT: 9225,
        CHROME_HOST: 'host.docker.internal'
    });

    chromeProxy.setNERV(nerv);
    await chromeProxy.start();
}
```

**Arquitetura Ontológica**:
```
DevContainer (Puppeteer) → localhost:9224 (Proxy) → host.docker.internal:9225 (Chrome)
```

**Princípios**:
- ✅ DevContainer **NÃO inicia Chrome** (responsabilidade do Windows Host)
- ✅ DevContainer **APENAS conecta** via proxy
- ✅ Proxy gerenciado por PM2 OU inline (validação anti-duplicação)

**Validação Anti-Duplicação**:
- Se porta 9224 já está em uso → assume proxy externo (PM2) → não cria inline
- Previne erro EADDRINUSE

---

#### **Fase 3: Browser Pool Manager**
```javascript
const { initializeBrowserPoolResilient } = require('./core/boot_resilience_manager');

const browserPoolResult = await initializeBrowserPoolResilient(
    {
        poolSize: 3,
        allocationStrategy: 'round-robin',
        healthCheckInterval: 30000,
        browserEndpoint: { url: 'http://localhost:9224' }
    },
    {
        nerv,
        allowDegradedMode: true,
        autoRetry: true,
        maxAutoRetries: 2
    }
);

const browserPool = browserPoolResult.browserPool;
const systemMode = browserPoolResult.mode; // 'full' | 'degraded'
```

**Features de Resiliência**:
1. **Auto-Retry**: Tenta iniciar Chrome automaticamente (2 tentativas)
2. **Modo Degradado**: Sistema continua sem Browser Pool
3. **Opções ao Usuário**: Mostra instruções para corrigir Chrome
4. **Health Checks**: Valida Chrome accessibility

**Modos de Operação**:

| Modo         | Browser Pool | Driver Tasks | Dashboard | Uso                   |
| ------------ | ------------ | ------------ | --------- | --------------------- |
| **Full**     | ✅ Ativo      | ✅ Executam   | ✅ Sim     | Produção normal       |
| **Degraded** | ❌ Null       | ⏸️ Pausadas   | ✅ Sim     | Chrome não disponível |

**Decision Tree**:
```
Chrome OK?
  ├─ YES → Full mode (browserPool ativa)
  └─ NO  → Tentar auto-start?
            ├─ YES → Executar scripts/start-chrome.sh
            │        └─ Success? → Full mode
            │        └─ Fail    → Modo degradado?
            │                     ├─ YES → Degraded mode
            │                     └─ NO  → Abort boot
            └─ NO  → Modo degradado?
                     ├─ YES → Degraded mode
                     └─ NO  → Abort boot
```

---

#### **Fase 3.5: ContextManager**
```javascript
const { ContextManager } = require('./orchestrator/context_manager');

const contextManager = new ContextManager({
    strategy: 'sliding_window',
    maxTokens: 100000,
    summarizationPolicy: 'on_overflow'
});
```

**Compartilhamento**:
- ✅ Usado por **Kernel** (task execution context)
- ✅ Usado por **MissionManager** (multi-step context)
- ✅ Sliding window com summarization automática

---

#### **Fase 4: KERNEL**
```javascript
const kernel = await createKernel({
    nerv,
    contextManager,
    telemetry: { source: 'kernel', retention: 1000 },
    policy: {},
    loop: { cycleInterval: 50 } // 20 Hz
});
```

**Responsabilidades**:
- ✅ Orquestra execução de tasks
- ✅ Loop 20 Hz (50ms cycle interval)
- ✅ Policy Engine (timeout, retry, abort)
- ✅ Integração com ContextManager

---

#### **Fase 5: Adapters (Pontes NERV)**

**DriverNERVAdapter**:
```javascript
const driverAdapter = new DriverNERVAdapter(nerv, browserPool, CONFIG);

// Modo degradado: browserPool = null
if (systemMode === 'degraded') {
    log('WARN', 'DriverAdapter em modo degradado (tasks pausadas)');
}
```

**ServerNERVAdapter** (Condicional):
```javascript
if (SERVER_MODE === 'integrated') {
    // Maestro sobe server local
    const { server, port } = await serverEngine.start(3008);
    socketHub = socketModule.init(server);
    serverAdapter = new ServerNERVAdapter(nerv, socketHub, CONFIG);

} else if (SERVER_MODE === 'split') {
    // Maestro conecta em server externo
    socketHub = await socketModule.connectExternal(3008);
    serverAdapter = new ServerNERVAdapter(nerv, socketHub, CONFIG);

} else if (SERVER_MODE === 'disabled') {
    // Sem camada server
    serverAdapter = null;
}
```

**Modos de Server**:
- `integrated`: Maestro sobe HTTP server inline (porta 3008)
- `split`: Maestro conecta em server externo (PM2 gerencia processos separados)
- `disabled`: Sem camada server (headless mode)

---

#### **Fase 5.5: Mission Orchestration**
```javascript
const missionManager = new MissionManager({
    kernel,
    nerv,
    contextManager,
    feedbackProcessor,
    checkpointManager
});
```

**Componentes**:
- `FeedbackProcessor`: LLM-as-judge (validação de outputs)
- `CheckpointManager`: Recovery em <5min (granular state)
- `MissionManager`: Orquestra workflows multi-step (97 templates)

---

### Graceful Shutdown

```javascript
process.on('SIGTERM', async () => {
    log('INFO', 'SIGTERM received, shutting down gracefully...');

    // 1. Para kernel loop
    if (kernel && typeof kernel.stop === 'function') {
        await kernel.stop();
    }

    // 2. Fecha browser pool
    if (browserPool && typeof browserPool.shutdown === 'function') {
        await browserPool.shutdown();
    }

    // 3. Fecha Chrome Proxy
    if (global.chromeProxy && typeof global.chromeProxy.stop === 'function') {
        await global.chromeProxy.stop();
    }

    // 4. Fecha HTTP server
    if (httpServer) {
        httpServer.close();
    }

    process.exit(0);
});
```

---

## 🌐 SISTEMA 2: BROWSER CONNECTION

### Responsabilidades

**Arquivo Principal**: `src/infra/ConnectionOrchestrator.js`
**Pool Manager**: `src/infra/browser_pool/pool_manager.js`

**O que faz**:
- ✅ Conecta a Chrome via Puppeteer (3 modos: wsEndpoint, connect, auto)
- ✅ Gerencia pool de 3 instâncias Chrome (round-robin, least-loaded, target-affinity)
- ✅ Health checks periódicos (heartbeat a cada 30s)
- ✅ Circuit Breaker (detecção inteligente de falhas)
- ✅ Auto-restart de instâncias crashed

### Arquitetura de Conexão

```
┌─────────────────────────────────────────────────────────────────┐
│ WINDOWS HOST                                                    │
│                                                                 │
│  START-CHROME-SIMPLE.bat                                        │
│    ↓                                                            │
│  chrome.exe --remote-debugging-port=9225                        │
│    ↓                                                            │
│  DevTools Protocol @ localhost:9225                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
             ↓ (não acessível do container Docker)
┌─────────────────────────────────────────────────────────────────┐
│ DEVCONTAINER                                                    │
│                                                                 │
│  chromeProxyService.js @ localhost:9224                         │
│    ↓                                                            │
│  HTTP + WebSocket Proxy                                         │
│    - Reescreve URLs: ws://localhost → ws://host.docker.internal │
│    - Reescreve headers: Host: localhost                         │
│    - Health checks + graceful shutdown                          │
│                                                                 │
│  ConnectionOrchestrator.js                                      │
│    ↓                                                            │
│  puppeteer.connect('http://localhost:9224')                     │
│    ↓                                                            │
│  BrowserPoolManager (pool de 3 instâncias)                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### ConnectionOrchestrator v3.0

**Princípios Ontológicos**:
```javascript
/* ONTOLOGICAL PRINCIPLE:
   Chrome é propriedade do Windows Host. DevContainer APENAS conecta. */

// ✅ DevContainer (ConnectionOrchestrator):
//    - Conectar a Chrome via browserEndpoint
//    - Validar conexão (health checks)
//    - Retry logic (exponential backoff)

// ❌ DevContainer NÃO deve:
//    - Iniciar Chrome (launcher mode) → Windows responsibility
//    - Configurar Chrome args → Windows responsibility
//    - Gerenciar Chrome lifecycle → Windows responsibility
```

**3 Modos de Conexão**:

| Modo           | Prioridade | Uso                               |
| -------------- | ---------- | --------------------------------- |
| **wsEndpoint** | 1          | Conexão via WebSocket (rápido)    |
| **connect**    | 2          | Conexão via browserURL (fallback) |
| **auto**       | 3          | Tenta todos os modos em ordem     |

**Config Padrão**:
```javascript
const DEFAULTS = {
    mode: 'wsEndpoint',
    ports: [9224], // Chrome Proxy port
    hosts: ['localhost'],
    retryDelayMs: 3000,
    maxRetryDelayMs: 15000,
    maxConnectionAttempts: 5,
    connectionTimeout: 30000,
    pageScanIntervalMs: 4000,
    allowedDomains: ['chatgpt.com', 'gemini.google.com', 'claude.ai'],
    pageSelectionPolicy: 'FIRST'
};
```

**Método Principal**: `ensureBrowser()`
```javascript
// 1. Detecta se browser já está conectado
if (this.browser && this.browser.isConnected()) {
    return this.browser;
}

// 2. Tenta conectar (retry logic com exponential backoff)
for (let attempt = 1; attempt <= maxConnectionAttempts; attempt++) {
    try {
        this.browser = await this._connectMode(mode);
        this.state = STATES.BROWSER_READY;
        return this.browser;

    } catch (err) {
        const backoffDelay = retryDelayMs * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
}

throw new Error('Browser connection failed after retries');
```

**Page Selection**:
```javascript
async scanForTargetPage() {
    const pages = await this.browser.pages();

    // Filtra páginas permitidas
    for (const page of pages) {
        const url = page.url();
        const isAllowed = this.config.allowedDomains.some(
            domain => url.includes(domain)
        );

        if (isAllowed) {
            this.page = page;
            this.state = STATES.PAGE_VALIDATED;
            return page;
        }
    }

    throw new Error('No valid target page found');
}
```

---

### BrowserPoolManager v2.0

**Pool de 3 Instâncias**:
```javascript
const pool = [
    {
        id: 'browser-0',
        browser: Browser,
        pages: Map<taskId, Page>,
        health: {
            status: 'HEALTHY',
            lastCheck: Date.now(),
            consecutiveFailures: 0
        },
        stats: {
            allocations: 0,
            activeTasks: 0,
            totalUptime: Date.now()
        }
    },
    // ... browser-1, browser-2
];
```

**Estratégias de Alocação**:

1. **round-robin** (padrão):
```javascript
allocatePage(task) {
    const poolEntry = this.pool[this.roundRobinIndex];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % this.pool.length;

    const page = await poolEntry.browser.newPage();
    poolEntry.pages.set(task.meta.id, page);

    return page;
}
```

2. **least-loaded**:
```javascript
allocatePage(task) {
    // Encontra instância com menos tasks ativas
    const poolEntry = this.pool.reduce((min, entry) =>
        entry.stats.activeTasks < min.stats.activeTasks ? entry : min
    );

    const page = await poolEntry.browser.newPage();
    return page;
}
```

3. **target-affinity**:
```javascript
allocatePage(task) {
    // Reutiliza instância se task tem mesmo target
    const existingEntry = this.pool.find(entry =>
        Array.from(entry.pages.values()).some(page =>
            page.url().includes(task.spec.target)
        )
    );

    const poolEntry = existingEntry || this.pool[0];
    const page = await poolEntry.browser.newPage();
    return page;
}
```

**Health Checks**:
```javascript
async _startHealthChecks() {
    this.healthCheckTimer = setInterval(async () => {
        for (const poolEntry of this.pool) {
            try {
                const isConnected = poolEntry.browser.isConnected();

                if (!isConnected) {
                    poolEntry.health.consecutiveFailures++;

                    if (poolEntry.health.consecutiveFailures >= 3) {
                        // Auto-restart
                        await this._restartInstance(poolEntry);
                    }
                } else {
                    poolEntry.health.consecutiveFailures = 0;
                    poolEntry.health.status = 'HEALTHY';
                }

            } catch (err) {
                poolEntry.health.status = 'UNHEALTHY';
            }
        }

        this.stats.healthChecks++;

    }, this.config.healthCheckInterval);
}
```

**Circuit Breaker** (🆕 v1.0):
```javascript
class CircuitBreakerManager {
    constructor({ poolSize, nerv }) {
        this.poolSize = poolSize;
        this.nerv = nerv;
        this.states = new Map(); // instanceId → CircuitState
    }

    recordFailure(instanceId, cause) {
        const state = this.states.get(instanceId) || {
            consecutiveFailures: 0,
            state: 'CLOSED' // CLOSED | OPEN | HALF_OPEN
        };

        state.consecutiveFailures++;

        if (state.consecutiveFailures >= 3) {
            state.state = 'OPEN'; // Desativa instância
            this._emitCircuitEvent('OPEN', instanceId, cause);
        }

        this.states.set(instanceId, state);
    }

    recordSuccess(instanceId) {
        const state = this.states.get(instanceId);
        if (state && state.state === 'HALF_OPEN') {
            state.state = 'CLOSED'; // Reativa instância
            state.consecutiveFailures = 0;
            this._emitCircuitEvent('CLOSED', instanceId);
        }
    }

    _emitCircuitEvent(newState, instanceId, cause) {
        if (this.nerv) {
            this.nerv.emit({
                type: 'CIRCUIT_BREAKER_STATE_CHANGE',
                payload: { instanceId, newState, cause }
            });
        }
    }
}
```

---

## 🔌 SISTEMA 3: DRIVER INTEGRATION

### Responsabilidades

**Lifecycle Manager**: `src/driver/DriverLifecycleManager.js` (v2.0)
**Execution Engine**: `src/kernel/execution_engine/execution_engine.js`
**Factory**: `src/driver/factory.js`

**O que faz**:
- ✅ Orquestra ciclo de vida do driver (acquire → execute → release)
- ✅ Gerencia AbortController (kill switch soberano)
- ✅ Emite eventos via EventEmitter (6 lifecycle events)
- ✅ Integra com NERV via DriverNERVAdapter
- ✅ Factory pattern para drivers (ChatGPT, Gemini, Claude)

### DriverLifecycleManager v2.0

**Herança EventEmitter**:
```javascript
class DriverLifecycleManager extends EventEmitter {
    constructor(page, task, config) {
        super();

        this.page = page; // Puppeteer page instance
        this.task = task; // Task object (Schema V4)
        this.config = config;
        this.driver = null;

        // ✅ Kill Switch Soberano
        this.abortController = new AbortController();

        // ✅ Métricas de lifecycle
        this.metrics = {
            acquireAttempts: 0,
            acquireTime: 0,
            releaseTime: 0,
            stateChanges: 0,
            progressUpdates: 0
        };

        this.setMaxListeners(20); // Memory leak detection
    }
}
```

**6 Lifecycle Events**:
```javascript
const LIFECYCLE_EVENTS = {
    ACQUIRED: 'lifecycle:acquired',     // Driver adquirido com sucesso
    RELEASED: 'lifecycle:released',     // Driver liberado
    ERROR: 'lifecycle:error',           // Erro em operação
    STATE_CHANGE: 'lifecycle:state_change', // Mudança de estado
    PROGRESS: 'lifecycle:progress',     // Atualização de progresso
    HEALTH: 'lifecycle:health'          // Health check executado
};
```

**Método Principal**: `acquire()`
```javascript
async acquire(options = {}) {
    const startTime = Date.now();
    const maxRetries = options.maxRetries || 3;
    const retryDelay = options.retryDelay || 1000;

    // ✅ Retry logic com exponential backoff
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // 1. Obtém driver da Factory
            this.driver = driverFactory.getDriver(
                this.task.spec.target,
                this.page,
                this.config,
                this.abortController.signal
            );

            // ✅ BUG #1 FIX: Validar driver retornado
            if (!this.driver) {
                throw new Error(`Driver not found for target: ${this.task.spec.target}`);
            }

            // 2. Injeta Correlation ID
            if (typeof this.driver.setCorrelationId === 'function') {
                this.driver.setCorrelationId(this.task.meta.correlation_id);
            }

            // 3. Vincular handlers de telemetria
            this.driver.on('state_change', this._handleStateChange);
            this.driver.on('progress', this._handleProgress);

            // ✅ Telemetria
            this.metrics.acquireTime = Date.now() - startTime;
            this.emit(LIFECYCLE_EVENTS.ACQUIRED, {
                taskId: this.task.meta.id,
                driverName: this.driver.name,
                attempts: attempt,
                acquireTime: this.metrics.acquireTime
            });

            return this.driver;

        } catch (err) {
            log('WARN', `Tentativa ${attempt}/${maxRetries} falhou: ${err.message}`);

            if (attempt < maxRetries) {
                const backoffDelay = retryDelay * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
            }
        }
    }

    throw new Error(`Falha após ${maxRetries} tentativas`);
}
```

**Método**: `release()`
```javascript
async release() {
    const startTime = Date.now();

    try {
        // 1. ✅ Aciona AbortSignal
        if (!this.abortController.signal.aborted) {
            this.abortController.abort();
        }

        // 2. Desacopla eventos
        if (this.driver) {
            this.driver.removeListener('state_change', this._handleStateChange);
            this.driver.removeListener('progress', this._handleProgress);

            // 3. ✅ Destruição física com timeout protection (5s)
            const destroyPromise = this.driver.destroy();
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), 5000)
            );

            await Promise.race([destroyPromise, timeoutPromise]);
        }

        this.driver = null;
        this.page = null;

        // ✅ Telemetria
        this.metrics.releaseTime = Date.now() - startTime;
        this.emit(LIFECYCLE_EVENTS.RELEASED, {
            taskId: this.task.meta.id,
            releaseTime: this.metrics.releaseTime
        });

    } catch (err) {
        this.emit(LIFECYCLE_EVENTS.ERROR, {
            taskId: this.task.meta.id,
            operation: 'release',
            error: err.message
        });
        throw err;
    }
}
```

**Handlers de Telemetria**:
```javascript
// Sincroniza estado do Driver com Task state
async _handleStateChange(data) {
    // ✅ Validação
    if (!data || !data.to) {
        log('WARN', 'Invalid state change data');
        return;
    }

    // Validar estados válidos
    const validStates = Object.values(STATUS_VALUES);
    if (!validStates.includes(data.to)) {
        log('WARN', `Invalid state: ${data.to}`);
        return;
    }

    // Atualizar task state
    this.task.state.status = data.to;
    this.task.state.history.push({
        ts: new Date().toISOString(),
        event: 'DRIVER_STATE_CHANGE',
        msg: `Transição: ${data.from} -> ${data.to}`
    });

    this.metrics.stateChanges++;
    this.emit(LIFECYCLE_EVENTS.STATE_CHANGE, {
        taskId: this.task.meta.id,
        from: data.from,
        to: data.to
    });
}

// Atualiza progresso da tarefa
async _handleProgress(data) {
    // ✅ Validação
    if (!data || typeof data.length !== 'number' || data.length < 0) {
        log('WARN', 'Invalid progress data');
        return;
    }

    // Estimativa baseada em caracteres processados
    const estimated = Math.min(99, Math.round((data.length / 5000) * 100));

    if (isNaN(estimated)) {
        log('WARN', 'Progress calculation resulted in NaN');
        return;
    }

    this.task.state.progress_estimate = estimated;

    this.metrics.progressUpdates++;
    this.emit(LIFECYCLE_EVENTS.PROGRESS, {
        taskId: this.task.meta.id,
        progress: estimated,
        length: data.length
    });
}
```

**Health Check Endpoint**:
```javascript
getHealth() {
    return {
        taskId: this.task.meta.id,
        correlationId: this.task.meta.correlation_id,
        driverStatus: this.driver ? 'acquired' : 'released',
        driverName: this.driver?.name || null,
        aborted: this.abortController.signal.aborted,
        metrics: {
            acquireAttempts: this.metrics.acquireAttempts,
            acquireTime: this.metrics.acquireTime,
            releaseTime: this.metrics.releaseTime,
            stateChanges: this.metrics.stateChanges,
            progressUpdates: this.metrics.progressUpdates
        },
        task: {
            target: this.task?.spec?.target || null,
            status: this.task?.state?.status || null,
            progress: this.task?.state?.progress_estimate || 0
        },
        driver: this.driver?.getHealth() || null
    };
}
```

---

### Driver Factory

**Arquivo**: `src/driver/factory.js`

**Padrão Factory**:
```javascript
const DRIVERS = {
    'chatgpt.com': require('./chatgpt/chatgpt_driver_v2'),
    'gemini.google.com': require('./gemini/gemini_driver_v2'),
    'claude.ai': require('./claude/claude_driver_v2')
};

function getDriver(target, page, config, abortSignal) {
    const driverClass = DRIVERS[target];

    if (!driverClass) {
        throw new Error(`No driver found for target: ${target}`);
    }

    // Instancia driver com AbortSignal
    const driver = new driverClass(page, config, abortSignal);

    // ✅ Todos os drivers v2.0 herdam EventEmitter
    // ✅ Todos possuem .destroy(), .setCorrelationId(), .getHealth()

    return driver;
}
```

**Estrutura de Driver v2.0**:
```javascript
class ChatGPTDriver extends EventEmitter {
    constructor(page, config, abortSignal) {
        super();

        this.name = 'ChatGPTDriver';
        this.page = page;
        this.config = config;
        this.abortSignal = abortSignal;
        this.correlationId = null;

        this.capabilities = {
            text: true,
            vision: true,
            files: true,
            browsing: true
        };
    }

    async execute(task) {
        // 1. Emite state_change
        this.emit('state_change', { from: 'PENDING', to: 'RUNNING' });

        // 2. Executa automação
        // ...

        // 3. Emite progress
        this.emit('progress', { length: 1500 });

        // 4. Retorna resultado
        return { success: true, output: '...' };
    }

    async destroy() {
        // Cleanup resources
        this.removeAllListeners();
    }

    setCorrelationId(id) {
        this.correlationId = id;
    }

    getHealth() {
        return {
            name: this.name,
            capabilities: this.capabilities,
            connected: this.page ? true : false
        };
    }
}
```

---

### Integração com ExecutionEngine

**Arquivo**: `src/kernel/execution_engine/execution_engine.js`

**Fluxo Completo**:
```javascript
async executeTask(task) {
    // 1. Aloca página do Browser Pool
    const page = await this.browserPool.allocatePage(task);

    // 2. Cria DriverLifecycleManager
    const lifecycle = new DriverLifecycleManager(page, task, this.config);

    // 3. Adquire driver (retry logic interno)
    const driver = await lifecycle.acquire();

    // 4. Executa task
    try {
        const result = await driver.execute(task);

        // 5. Libera recursos
        await lifecycle.release();
        await this.browserPool.releasePage(task.meta.id);

        return result;

    } catch (err) {
        // Cleanup em erro
        await lifecycle.release();
        await this.browserPool.releasePage(task.meta.id);
        throw err;
    }
}
```

---

## 🔄 FLUXO DE EXECUÇÃO COMPLETO

### Sequência End-to-End (1 Task)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. BOOT SEQUENCE                                                │
├─────────────────────────────────────────────────────────────────┤
│  ├─ Fase 1: Config + Identity         [✓ 200ms]                │
│  ├─ Fase 2: NERV                       [✓ 100ms]                │
│  ├─ Fase 2.5: Chrome Proxy             [✓ 1500ms]               │
│  ├─ Fase 3: Browser Pool               [✓ 2000ms]               │
│  ├─ Fase 3.5: ContextManager           [✓ 50ms]                 │
│  ├─ Fase 4: KERNEL                     [✓ 300ms]                │
│  ├─ Fase 5: Adapters                   [✓ 200ms]                │
│  └─ Fase 5.5: MissionManager           [✓ 100ms]                │
│                                         ──────────               │
│                                Total Boot: ~4.5s                 │
└─────────────────────────────────────────────────────────────────┘
             ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. TASK SUBMISSION                                              │
├─────────────────────────────────────────────────────────────────┤
│  API POST /tasks                                                │
│    ├─ Schema validation (JSON Schema V4)                        │
│    ├─ Save to fila/PENDING/task_ABC123.json                     │
│    └─ Emit NERV event: TASK_CREATED                             │
└─────────────────────────────────────────────────────────────────┘
             ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. KERNEL LOOP (20 Hz)                                          │
├─────────────────────────────────────────────────────────────────┤
│  Kernel detecta task pendente                                   │
│    ├─ Valida contra policy (timeout, dependencies)              │
│    ├─ Emit NERV: TASK_VALIDATED                                 │
│    └─ Chama ExecutionEngine.executeTask()                       │
└─────────────────────────────────────────────────────────────────┘
             ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. BROWSER CONNECTION                                           │
├─────────────────────────────────────────────────────────────────┤
│  BrowserPoolManager.allocatePage()                              │
│    ├─ Estratégia: round-robin                                   │
│    ├─ Seleciona: browser-1                                      │
│    └─ Cria nova Page: page_task_ABC123                          │
└─────────────────────────────────────────────────────────────────┘
             ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. DRIVER LIFECYCLE                                             │
├─────────────────────────────────────────────────────────────────┤
│  new DriverLifecycleManager(page, task, config)                 │
│    ├─ await lifecycle.acquire()                                 │
│    │    ├─ Retry 1: driverFactory.getDriver('chatgpt.com')      │
│    │    │    ├─ new ChatGPTDriver(page, config, abortSignal)    │
│    │    │    └─ ✓ Driver validado                               │
│    │    ├─ driver.setCorrelationId(task.meta.correlation_id)    │
│    │    ├─ driver.on('state_change', handler)                   │
│    │    └─ emit: lifecycle:acquired                             │
│    │                                                             │
│    ├─ await driver.execute(task)                                │
│    │    ├─ emit: state_change (PENDING → RUNNING)               │
│    │    ├─ Navega para chatgpt.com                              │
│    │    ├─ Espera textarea                                      │
│    │    ├─ Digite prompt                                        │
│    │    ├─ Click botão enviar                                   │
│    │    ├─ Aguarda resposta                                     │
│    │    ├─ emit: progress (length: 500, 1500, 3000)             │
│    │    ├─ Extrai resposta completa                             │
│    │    └─ emit: state_change (RUNNING → COMPLETED)             │
│    │                                                             │
│    └─ await lifecycle.release()                                 │
│         ├─ abortController.abort()                              │
│         ├─ driver.removeListener('state_change')                │
│         ├─ driver.destroy() (timeout 5s)                        │
│         └─ emit: lifecycle:released                             │
└─────────────────────────────────────────────────────────────────┘
             ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. RESULT HANDLING                                              │
├─────────────────────────────────────────────────────────────────┤
│  ExecutionEngine                                                │
│    ├─ Save result to respostas/task_ABC123_response.json        │
│    ├─ Move task: PENDING → COMPLETED                            │
│    ├─ Emit NERV: TASK_COMPLETED                                 │
│    └─ Release page: BrowserPoolManager.releasePage()            │
└─────────────────────────────────────────────────────────────────┘
             ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. TELEMETRY & MONITORING                                       │
├─────────────────────────────────────────────────────────────────┤
│  Events emitidos via NERV:                                      │
│    ├─ TASK_CREATED                                              │
│    ├─ TASK_VALIDATED                                            │
│    ├─ lifecycle:acquired                                        │
│    ├─ lifecycle:state_change (x2)                               │
│    ├─ lifecycle:progress (x3)                                   │
│    ├─ lifecycle:released                                        │
│    └─ TASK_COMPLETED                                            │
│                                                                 │
│  Dashboard recebe via Socket.io                                 │
│    └─ UI atualiza em tempo real                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Timing Típico**:
- Boot: ~4.5s
- Task submission: ~50ms
- Kernel detect: ~50ms (loop 20 Hz)
- Page allocation: ~200ms
- Driver acquire: ~500ms
- Driver execute: 5-30s (depende da LLM)
- Cleanup: ~300ms
- **Total**: 6-31s por task

---

## ✅ VALIDAÇÃO E TESTES

### Testes de Boot

```bash
# 1. Boot normal (modo full)
make start
make health-core  # Valida boot completo

# 2. Boot em modo degradado (Chrome não disponível)
# Simular: Parar Chrome no Windows
export ALLOW_DEGRADED_MODE=true
make start

# Validar: Sistema inicia sem Browser Pool
# Logs: "Sistema iniciando em MODO DEGRADADO"
```

### Testes de Browser Connection

```bash
# 1. Health check do Chrome
curl http://localhost:9225/json/version  # Windows
curl http://localhost:9224/json/version  # Container (via proxy)

# 2. Validar pool initialization
node -e "
const PoolManager = require('./src/infra/browser_pool/pool_manager');
const pool = new PoolManager({
    poolSize: 3,
    browserEndpoint: { url: 'http://localhost:9224' }
});
await pool.initialize();
console.log('Pool size:', pool.pool.length);
process.exit(0);
"

# 3. Testar retry logic
# Simular: Parar Chrome no meio do teste
# Validar: Exponential backoff (3s → 6s → 12s)
```

### Testes de Driver Integration

```bash
# 1. Factory pattern
node -e "
const factory = require('./src/driver/factory');
const driver = factory.getDriver('chatgpt.com', mockPage, config, signal);
console.log('Driver:', driver.name);
process.exit(0);
"

# 2. Lifecycle completo (acquire → execute → release)
node tests/integration/test_driver_lifecycle.js

# 3. EventEmitter telemetry
node -e "
const lifecycle = new DriverLifecycleManager(page, task, config);
lifecycle.on('lifecycle:acquired', (data) => {
    console.log('Acquired:', data);
});
lifecycle.on('lifecycle:state_change', (data) => {
    console.log('State:', data);
});
await lifecycle.acquire();
// ... validar eventos emitidos
"
```

### Scripts de Validação

```bash
# Makefile targets
make health              # 4 endpoints + PM2 status
make health-core         # Core endpoint only
make test-fast           # Pre-commit tests
make test-integration    # Full integration tests
```

---

## 🔧 TROUBLESHOOTING

### Problema 1: Boot Fails - Chrome Not Available

**Sintomas**:
```
[BOOT] Fase 3/6: Inicializando Browser Pool
[ERROR] Chrome remote debugging não está acessível
[ERROR] curl http://localhost:9224/json/version → Connection refused
```

**Diagnóstico**:
```bash
# 1. Chrome está rodando no Windows?
curl http://localhost:9225/json/version  # (executar no Windows)

# 2. Proxy está rodando?
curl http://localhost:9224/json/version  # (executar no container)
pm2 list | grep chrome-proxy

# 3. Portas corretas?
lsof -i :9224  # Container
lsof -i :9225  # Windows (PowerShell: Get-NetTCPConnection -LocalPort 9225)
```

**Soluções**:
```bash
# A. Iniciar Chrome no Windows
START-CHROME-SIMPLE.bat

# B. Iniciar Proxy (se PM2 não gerenciou)
make start  # Inicia PM2 com proxy

# C. Modo degradado (temporário)
export ALLOW_DEGRADED_MODE=true
make start
```

---

### Problema 2: Browser Pool Initialization Fails

**Sintomas**:
```
[BrowserPool] ❌ Bug #3: Proxy não está acessível
[BrowserPool] Curl test FALHOU: http://localhost:9224/json/version
[RESILIENCE] Browser Pool falhou após 2 tentativas
```

**Diagnóstico**:
```bash
# 1. Validar proxy health
bash wsl-chrome-integration.sh all

# 2. Logs do proxy
pm2 logs chrome-proxy

# 3. Network connectivity
curl -v http://localhost:9224/json/version
```

**Soluções**:
```bash
# A. Restart proxy
pm2 restart chrome-proxy

# B. Verificar firewall (Windows)
# PowerShell (Admin):
New-NetFirewallRule -DisplayName "Chrome Remote Debug" -Direction Inbound -LocalPort 9225 -Protocol TCP -Action Allow

# C. Validar config
node -e "console.log(require('./src/core/config').CHROME_PROXY_PORT)"
```

---

### Problema 3: Driver Acquisition Fails

**Sintomas**:
```
[LIFECYCLE] Tentativa 1/3 falhou: Driver not found for target: chatgpt.com
[LIFECYCLE] Tentativa 2/3 falhou: Driver not found for target: chatgpt.com
[LIFECYCLE] Falha após 3 tentativas
```

**Diagnóstico**:
```bash
# 1. Driver existe?
ls -la src/driver/chatgpt/

# 2. Factory está correto?
node -e "
const factory = require('./src/driver/factory');
console.log('Drivers:', Object.keys(factory.DRIVERS));
"

# 3. Target correto?
# Validar task.spec.target === 'chatgpt.com' (exato)
```

**Soluções**:
```bash
# A. Corrigir target na task
# ERRADO: "target": "https://chatgpt.com"
# CORRETO: "target": "chatgpt.com"

# B. Adicionar driver à factory (se novo target)
# src/driver/factory.js:
const DRIVERS = {
    'chatgpt.com': require('./chatgpt/chatgpt_driver_v2'),
    'novatarget.com': require('./novatarget/driver_v2')  // <-- ADD
};
```

---

### Problema 4: AbortController Not Working

**Sintomas**:
```
[LIFECYCLE] AbortSignal triggered for task ABC123
[WARN] Driver não respondeu a abort signal
[ERROR] Driver destroy timeout
```

**Diagnóstico**:
```bash
# 1. Driver está escutando signal?
node -e "
const driver = new ChatGPTDriver(page, config, abortSignal);
console.log('Has abort listener:', driver.abortSignal.aborted);
"

# 2. Timeout de 5s é suficiente?
# Para operações longas, aumentar DESTROY_TIMEOUT_MS
```

**Soluções**:
```bash
# A. Validar driver implementation
# Driver DEVE checar abortSignal periodicamente:
async execute(task) {
    while (!this.abortSignal.aborted) {
        // ... operação

        if (this.abortSignal.aborted) {
            throw new Error('Task aborted');
        }
    }
}

# B. Aumentar timeout (último recurso)
# src/driver/DriverLifecycleManager.js:
const LIFECYCLE_CONFIG = {
    DESTROY_TIMEOUT_MS: 10000  // 5s → 10s
};
```

---

### Problema 5: EventEmitter Memory Leak

**Sintomas**:
```
(node:12345) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 state_change listeners added to DriverLifecycleManager.
```

**Diagnóstico**:
```bash
# 1. Listeners não estão sendo removidos?
node -e "
const lifecycle = new DriverLifecycleManager(page, task, config);
console.log('Listeners before:', lifecycle.listenerCount('state_change'));
await lifecycle.acquire();
console.log('Listeners after:', lifecycle.listenerCount('state_change'));
await lifecycle.release();
console.log('Listeners after release:', lifecycle.listenerCount('state_change'));
"

# 2. Multiple acquire() calls sem release()?
```

**Soluções**:
```bash
# A. Validar cleanup em release()
async release() {
    // ✅ OBRIGATÓRIO
    this.driver.removeListener('state_change', this._handleStateChange);
    this.driver.removeListener('progress', this._handleProgress);

    await this.driver.destroy();
}

# B. Aumentar limite (se legítimo)
constructor() {
    super();
    this.setMaxListeners(50);  // 20 → 50
}
```

---

## 📚 REFERÊNCIAS

### Documentação Relacionada

1. **ARCHITECTURE.md** (v3.0) - Arquitetura completa do sistema
2. **CONNECTION_ARCHITECTURE/** - Deep dive Chrome Proxy v3.0
3. **ENV_VARIABLE_REFERENCE.md** - Variáveis de ambiente (v6.0)
4. **MIGRATION_SSH_V5.3.md** - DevContainer SSH configuration

### Arquivos-Chave

**Boot**:
- `src/main.js` (1,229 linhas)
- `src/core/boot_resilience_manager.js` (465 linhas)

**Browser Connection**:
- `src/infra/ConnectionOrchestrator.js` (771 linhas)
- `src/infra/browser_pool/pool_manager.js` (569 linhas)
- `src/infra/browser_pool/circuit_breaker.js`
- `src/infra/proxy/chromeProxyService.js`

**Driver Integration**:
- `src/driver/DriverLifecycleManager.js` (490 linhas)
- `src/driver/factory.js`
- `src/kernel/execution_engine/execution_engine.js`
- `src/driver/nerv_adapter/driver_nerv_adapter.js`

### Constantes e Schemas

**Browser**:
- `src/core/constants/browser.js` - CONNECTION_MODES, BROWSER_STATES
- `src/core/constants/tasks.js` - STATUS_VALUES, TASK_TYPES

**Lifecycle**:
- `LIFECYCLE_CONFIG` - Timeouts, retries, thresholds
- `LIFECYCLE_EVENTS` - 6 eventos de telemetria

---

## ✅ CHECKLIST DE VALIDAÇÃO

### Boot Sequence
- [ ] Fase 1: Config + Identity completa
- [ ] Fase 2: NERV online (hybrid mode)
- [ ] Fase 2.5: Chrome Proxy rodando (9224)
- [ ] Fase 3: Browser Pool inicializado (3 instâncias)
- [ ] Fase 3.5: ContextManager compartilhado
- [ ] Fase 4: KERNEL loop 20 Hz ativo
- [ ] Fase 5: Adapters (Driver + Server) online
- [ ] Fase 5.5: MissionManager pronto
- [ ] Graceful shutdown funcionando

### Browser Connection
- [ ] Chrome rodando no Windows (9225)
- [ ] Proxy rodando no container (9224)
- [ ] ConnectionOrchestrator.ensureBrowser() sucesso
- [ ] Pool de 3 instâncias ativas
- [ ] Health checks a cada 30s
- [ ] Circuit Breaker detectando falhas
- [ ] Auto-restart de instâncias crashed

### Driver Integration
- [ ] Factory retorna driver correto para target
- [ ] DriverLifecycleManager.acquire() sucesso
- [ ] AbortController funcionando
- [ ] EventEmitter emitindo 6 eventos
- [ ] Telemetria via _handleStateChange e _handleProgress
- [ ] Release() limpando listeners
- [ ] Health endpoint retornando métricas

---

**Documento Criado**: 3 de Fevereiro de 2026
**Autor**: GitHub Copilot
**Base**: 3 sistemas fundamentais (Boot, Connection, Driver)
**Próxima Revisão**: Após implementação de melhorias (ANÁLISE_E_MELHORIAS_FEV2026.md)

---

**Status**: ✅ Documento Completo | 🔒 Canônico | 📌 Referência Permanente
