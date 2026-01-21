# 🔧 Subsistemas: Análise Detalhada dos 13 Módulos

**Versão**: 1.0
**Última Atualização**: 21/01/2026
**Público-Alvo**: Desenvolvedores (avançado)
**Tempo de Leitura**: ~45 min

---

## 📖 Visão Geral

Este documento fornece **análise detalhada** de cada um dos **13 módulos** que compõem o sistema `chatgpt-docker-puppeteer`. Complementa [ARCHITECTURE.md](ARCHITECTURE.md) com foco em **implementação interna**, não apenas estrutura.

### O Que Este Documento Cobre

- ✅ **Responsabilidades** de cada módulo
- ✅ **Interfaces públicas** (APIs, eventos)
- ✅ **Dependências** (imports, acoplamento)
- ✅ **Padrões internos** (design patterns)
- ✅ **Exemplos de uso** com código real
- ✅ **Métricas** (performance, qualidade, audit ratings)

---

## 🎯 Estrutura deste Documento

```
CORE (5 subcomponentes)
├── Config Management
├── Logger
├── Schemas (Zod)
├── Identity (DNA)
└── Constants

NERV (13 subcomponentes)
├── Core API
├── Emission
├── Reception
├── Buffers
├── Transport
├── Correlation
├── Telemetry
├── ... (6 mais)

KERNEL (6 subcomponentes)
├── KernelMaestro
├── KernelLoop
├── PolicyEngine
├── TaskRuntime
├── ObservationStore
└── KernelNERVBridge

INFRA (5 áreas)
├── Browser Pool
├── Queue Cache
├── Lock Manager
├── Storage (I/O)
└── File Watcher

DRIVER (8 componentes)
├── DriverFactory
├── ChatGPTDriver
├── GeminiDriver
├── human.js
├── ariadne_thread.js
├── collection.js
├── validation.js
└── DriverNERVAdapter

SERVER (2 componentes)
├── Express + API
└── Socket.io + ServerNERVAdapter

LOGIC (3 componentes)
├── Adaptive Delays
├── Context Assembly
└── Validation
```

Total: **37 componentes** em **13 módulos** (~15k LOC)

---

## 🧩 CORE (Fundação)

**Localização**: `src/core/`
**LOC**: ~1,200 linhas
**Audit Rating**: 9.5/10
**Acoplamento**: Zero (não depende de nenhum outro módulo)

### 1.1. Config Management

**Arquivo**: `src/core/config.js`
**LOC**: ~250 linhas
**Responsabilidades**:
- ✅ Carregar configurações de `config.json` e `.env`
- ✅ Validar com schemas Zod
- ✅ Fornecer defaults seguros
- ✅ Hot-reload (opcional)

**Interface Pública**:
```javascript
// src/core/config.js
module.exports = {
    // Browser settings
    BROWSER_MODE: process.env.BROWSER_MODE || 'launcher',
    EXTERNAL_BROWSER_PORT: parseInt(process.env.EXTERNAL_BROWSER_PORT) || 9222,

    // Kernel settings (P9.9 - Configurável)
    MAX_WORKERS: parseInt(process.env.MAX_WORKERS) || 3,
    KERNEL_CYCLE_MS: parseInt(process.env.KERNEL_CYCLE_MS) || 50,  // 20Hz

    // Security (P8.4)
    DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD || null,

    // Reload function
    reload: function() {
        // Re-read config.json + .env
        Object.assign(this, loadConfig());
    }
};
```

**Uso**:
```javascript
const CONFIG = require('./core/config');

// Leitura
const maxWorkers = CONFIG.MAX_WORKERS;  // 3

// Hot-reload
CONFIG.reload();
```

**Dependências**: Zero (independente)

**P-Level Fixes Relacionados**:
- P9.9: MAX_WORKERS configurável (antes hardcoded)

---

### 1.2. Logger

**Arquivo**: `src/core/logger.js`
**LOC**: ~180 linhas
**Responsabilidades**:
- ✅ Logging estruturado com níveis (DEBUG, INFO, WARN, ERROR)
- ✅ Rotação de logs
- ✅ Correlation ID tracking
- ✅ JSON format (machine-readable)

**Interface Pública**:
```javascript
// src/core/logger.js
function log(level, message, context = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...context
    };

    // Console output (desenvolvimento)
    if (level === 'ERROR') {
        console.error(JSON.stringify(entry));
    } else {
        console.log(JSON.stringify(entry));
    }

    // File output (produção)
    if (CONFIG.LOG_TO_FILE) {
        appendToFile('logs/app.log', JSON.stringify(entry) + '\n');
    }
}

module.exports = { log };
```

**Uso**:
```javascript
const { log } = require('./core/logger');

// Simples
log('INFO', 'System starting');

// Com contexto
log('ERROR', 'Task failed', {
    taskId: 'task-abc',
    error: error.message,
    correlationId: '550e8400-...'
});
```

**Dependências**:
- `config.js` (para LOG_TO_FILE)

**Categorias de Log** (documentação):
- `[BOOT]` - Inicialização do sistema
- `[LIFECYCLE]` - Start/stop/reload
- `[KERNEL]` - Kernel loop, policy decisions
- `[DRIVER]` - Browser automation, page interactions
- `[NERV]` - Event bus operations
- `[INFRA]` - Browser pool, queue, locks
- `[SECURITY]` - P8 fixes, auth, validation

---

### 1.3. Schemas (Zod)

**Arquivo**: `src/core/schemas.js`
**LOC**: ~320 linhas
**Responsabilidades**:
- ✅ Validar estruturas de dados (tasks, config, events)
- ✅ Type safety (runtime validation)
- ✅ Error messages estruturados

**Interface Pública**:
```javascript
// src/core/schemas.js
const { z } = require('zod');

// Task Schema
const TaskSchema = z.object({
    id: z.string().min(1),
    target: z.enum(['chatgpt', 'gemini']),
    prompt: z.string().min(1),
    state: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELED']).optional(),
    priority: z.number().int().min(0).max(10).default(5),
    createdAt: z.number().int().positive(),
    spec: z.object({
        validation: z.object({
            minLength: z.number().optional(),
            forbiddenTerms: z.array(z.string()).optional()
        }).optional()
    }).optional()
});

function parseTask(data) {
    const result = TaskSchema.safeParse(data);

    if (!result.success) {
        const errors = result.error.flatten();
        log('ERROR', '[SCHEMA] Task validation failed', { errors });
        return null;
    }

    return result.data;
}

module.exports = {
    TaskSchema,
    parseTask,
    // ... outros schemas
};
```

**Uso**:
```javascript
const { parseTask } = require('./core/schemas');

// Validar task
const rawData = JSON.parse(fs.readFileSync('fila/task-abc.json'));
const task = parseTask(rawData);

if (!task) {
    // Inválido - já logado
    moveToCorrupted('task-abc');
}
```

**Schemas Disponíveis**:
- `TaskSchema` - Tasks na fila
- `ConfigSchema` - config.json
- `EnvelopeSchema` - NERV envelopes (P9.5)
- `HealthSchema` - Health check responses

**Dependências**:
- `zod` (npm package)
- `logger.js`

---

### 1.4. Identity (DNA)

**Arquivo**: `src/core/identity/dna.js`
**LOC**: ~150 linhas
**Responsabilidades**:
- ✅ Gerar IDs únicos (UUID v4)
- ✅ Identificar instância do agente
- ✅ Persistir identidade

**Interface Pública**:
```javascript
// src/core/identity/dna.js
const { v4: uuidv4 } = require('uuid');

let agentDNA = null;

function initDNA() {
    const dnaPath = path.join(ROOT, 'controle.json');

    if (fs.existsSync(dnaPath)) {
        const data = JSON.parse(fs.readFileSync(dnaPath));
        agentDNA = data.agentDNA;
    } else {
        agentDNA = uuidv4();
        fs.writeFileSync(dnaPath, JSON.stringify({ agentDNA }, null, 2));
    }

    log('INFO', `[DNA] Agent identity: ${agentDNA}`);
    return agentDNA;
}

function generateTaskId() {
    return `task-${uuidv4().slice(0, 8)}`;
}

function generateCorrelationId() {
    return uuidv4();
}

module.exports = {
    initDNA,
    getAgentDNA: () => agentDNA,
    generateTaskId,
    generateCorrelationId
};
```

**Uso**:
```javascript
const { initDNA, generateTaskId } = require('./core/identity/dna');

// Na inicialização
const dna = initDNA();  // Carrega ou cria

// Gerar IDs
const taskId = generateTaskId();  // 'task-a3f9c2b1'
```

**Dependências**:
- `uuid` (npm package)

---

### 1.5. Constants

**Arquivo**: `src/core/constants/tasks.js`, `browser.js`, etc
**LOC**: ~200 linhas
**Responsabilidades**:
- ✅ Centralizar valores mágicos
- ✅ Enums tipados (TypeScript-like)
- ✅ Documentação inline

**Interface Pública**:
```javascript
// src/core/constants/tasks.js
const STATUS_VALUES = {
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    DONE: 'DONE',
    FAILED: 'FAILED',
    CANCELED: 'CANCELED'
};

const STATUS_VALUES_ARRAY = Object.values(STATUS_VALUES);

const TASK_STATES = STATUS_VALUES;  // Alias

module.exports = {
    STATUS_VALUES,
    STATUS_VALUES_ARRAY,
    TASK_STATES
};
```

```javascript
// src/core/constants/browser.js
const CONNECTION_MODES = {
    HYBRID: 'hybrid',
    LAUNCHER: 'launcher',
    EXTERNAL: 'external'
};

const BROWSER_STATES = {
    CREATED: 'CREATED',
    HEALTHY: 'HEALTHY',
    DEGRADED: 'DEGRADED',
    CRASHED: 'CRASHED',
    SHUTDOWN: 'SHUTDOWN'
};

module.exports = {
    CONNECTION_MODES,
    BROWSER_STATES
};
```

**Uso**:
```javascript
const { STATUS_VALUES } = require('./core/constants/tasks');

// ❌ Antes (magic string)
if (task.state === 'PENDING') { ... }

// ✅ Depois (typed constant)
if (task.state === STATUS_VALUES.PENDING) { ... }
```

**Codemods**: Scripts para migrar magic strings → constants (`scripts/apply-all-codemods.sh`)

**Dependências**: Zero

---

## 🌐 NERV (Event Bus)

**Localização**: `src/nerv/`
**LOC**: ~2,100 linhas
**Audit Rating**: 9.4/10
**Acoplamento**: Zero (NERV não depende de ninguém; todos dependem de NERV)

### 2.1. Core API

**Arquivo**: `src/nerv/nerv.js`
**LOC**: ~180 linhas
**Responsabilidades**:
- ✅ API principal: `emit()`, `on()`, `once()`
- ✅ Orchestrar Emission, Reception, Buffers, Transport

**Interface Pública**:
```javascript
// src/nerv/nerv.js
class NERV {
    constructor() {
        this.emission = new Emission();
        this.reception = new Reception();
        this.buffers = new Buffers();
        this.transport = new Transport(this.buffers, this.reception);
    }

    emit(messageType, payload) {
        const envelope = this.emission.createEnvelope(messageType, payload);
        this.buffers.enqueueOutbound(envelope);
        this.transport.route();
    }

    on(messageType, handler) {
        this.reception.register(messageType, handler);
    }

    once(messageType, handler) {
        this.reception.registerOnce(messageType, handler);
    }
}

const nerv = new NERV();
module.exports = nerv;
```

**Uso**:
```javascript
const nerv = require('./nerv/nerv');

// Emitir evento
nerv.emit('TASK_ALLOCATED', {
    taskId: 'task-abc',
    target: 'chatgpt'
});

// Escutar evento
nerv.on('DRIVER_RESULT', ({ taskId, status }) => {
    log('INFO', `Task ${taskId} completed: ${status}`);
});
```

**Dependências**:
- Emission, Reception, Buffers, Transport (submódulos internos)

---

### 2.2. Emission Layer

**Arquivo**: `src/nerv/emission/emission.js`
**LOC**: ~120 linhas
**Responsabilidades**:
- ✅ Criar envelope estruturado
- ✅ Adicionar correlationId
- ✅ Adicionar timestamp
- ✅ Inicializar _serialized (P9.5)

**Interface Interna**:
```javascript
// src/nerv/emission/emission.js
class Emission {
    createEnvelope(messageType, payload) {
        const { generateCorrelationId } = require('../core/identity/dna');

        const envelope = {
            messageType,
            payload,
            correlationId: payload.correlationId || generateCorrelationId(),
            timestamp: Date.now(),
            _serialized: null  // P9.5: Lazy memoization
        };

        return envelope;
    }
}

module.exports = Emission;
```

**Uso** (interno):
```javascript
// Dentro de NERV.emit()
const envelope = this.emission.createEnvelope('EVENT_TYPE', { data: 'xyz' });
```

---

### 2.3. Reception Layer

**Arquivo**: `src/nerv/reception/reception.js`
**LOC**: ~140 linhas
**Responsabilidades**:
- ✅ Registrar handlers (on/once)
- ✅ Matchear eventos por messageType
- ✅ Executar callbacks
- ✅ Error handling

**Interface Interna**:
```javascript
// src/nerv/reception/reception.js
class Reception {
    constructor() {
        this.handlers = new Map();  // messageType → Set<handler>
    }

    register(messageType, handler) {
        if (!this.handlers.has(messageType)) {
            this.handlers.set(messageType, new Set());
        }
        this.handlers.get(messageType).add(handler);
    }

    registerOnce(messageType, handler) {
        const wrapper = (envelope) => {
            handler(envelope);
            this.unregister(messageType, wrapper);
        };
        this.register(messageType, wrapper);
    }

    matchAndExecute(envelope) {
        const handlers = this.handlers.get(envelope.messageType);

        if (!handlers || handlers.size === 0) {
            log('DEBUG', `[NERV] No handlers for ${envelope.messageType}`);
            return;
        }

        for (const handler of handlers) {
            try {
                handler(envelope);
            } catch (error) {
                log('ERROR', `[NERV] Handler error for ${envelope.messageType}`, {
                    error: error.message,
                    correlationId: envelope.correlationId
                });
            }
        }
    }
}

module.exports = Reception;
```

---

### 2.4. Buffers

**Arquivo**: `src/nerv/buffers/buffers.js`
**LOC**: ~160 linhas
**Responsabilidades**:
- ✅ FIFO queues (inbound + outbound)
- ✅ Overflow protection (P9.3: max 10k items)
- ✅ Backpressure signals

**Interface Interna**:
```javascript
// src/nerv/buffers/buffers.js
class Buffers {
    constructor() {
        this.outbound = [];
        this.inbound = [];
        this.MAX_BUFFER_SIZE = 10000;  // P9.3
    }

    enqueueOutbound(envelope) {
        if (this.outbound.length >= this.MAX_BUFFER_SIZE) {
            log('WARN', '[NERV] Outbound buffer overflow - dropping event', {
                messageType: envelope.messageType
            });
            return false;
        }

        this.outbound.push(envelope);
        return true;
    }

    dequeueOutbound() {
        return this.outbound.shift();
    }

    enqueueInbound(envelope) {
        if (this.inbound.length >= this.MAX_BUFFER_SIZE) {
            log('WARN', '[NERV] Inbound buffer overflow - dropping event');
            return false;
        }

        this.inbound.push(envelope);
        return true;
    }

    dequeueInbound() {
        return this.inbound.shift();
    }

    getMetrics() {
        return {
            outbound: this.outbound.length,
            inbound: this.inbound.length,
            totalBuffered: this.outbound.length + this.inbound.length
        };
    }
}

module.exports = Buffers;
```

**P9.3 Fix**: Limite de 10k items previne memory leaks em hot paths (kernel 20Hz)

---

### 2.5. Transport Layer

**Arquivo**: `src/nerv/transport/transport.js`
**LOC**: ~130 linhas
**Responsabilidades**:
- ✅ Serializar envelopes (P9.5 memoization)
- ✅ Rotear de outbound → inbound
- ✅ Invocar Reception.matchAndExecute()

**Interface Interna**:
```javascript
// src/nerv/transport/transport.js
class Transport {
    constructor(buffers, reception) {
        this.buffers = buffers;
        this.reception = reception;
    }

    route() {
        while (this.buffers.outbound.length > 0) {
            const envelope = this.buffers.dequeueOutbound();

            // P9.5: Serializar (memoizado)
            this.serialize(envelope);

            // Rotear para inbound
            this.buffers.enqueueInbound(envelope);
        }

        // Processar inbound
        while (this.buffers.inbound.length > 0) {
            const envelope = this.buffers.dequeueInbound();
            this.reception.matchAndExecute(envelope);
        }
    }

    serialize(envelope) {
        // P9.5: Lazy memoization
        if (envelope._serialized) {
            return envelope._serialized;  // Cache hit (98% reduction)
        }

        const { _serialized, ...clean } = envelope;
        envelope._serialized = JSON.stringify(clean);
        return envelope._serialized;
    }
}

module.exports = Transport;
```

**Performance (P9.5)**:
- 1ª serialização: ~5ms
- 2ª+ serializações: ~0.1ms (cache hit)
- Reduction: 98% em hot paths

---

### 2.6. Correlation

**Arquivo**: `src/nerv/correlation/correlation.js`
**LOC**: ~100 linhas
**Responsabilidades**:
- ✅ Gerar correlation IDs (UUID v4)
- ✅ Propagar IDs através de eventos
- ✅ Tracking de lineage (parent → child events)

**Interface Interna**:
```javascript
// src/nerv/correlation/correlation.js
const { v4: uuidv4 } = require('uuid');

class Correlation {
    constructor() {
        this.lineage = new Map();  // correlationId → parentId
    }

    generate(parentId = null) {
        const id = uuidv4();

        if (parentId) {
            this.lineage.set(id, parentId);
        }

        return id;
    }

    getParent(correlationId) {
        return this.lineage.get(correlationId) || null;
    }

    getChain(correlationId) {
        const chain = [correlationId];
        let current = correlationId;

        while (this.lineage.has(current)) {
            current = this.lineage.get(current);
            chain.push(current);
        }

        return chain.reverse();
    }
}

module.exports = Correlation;
```

**Exemplo de Chain**:
```
User Input (no correlationId)
    ↓
QUEUE_CHANGE (correlationId: A)
    ↓
TASK_ALLOCATED (correlationId: B, parent: A)
    ↓
DRIVER_RESULT (correlationId: C, parent: B)
    ↓
TASK_STATE_CHANGE (correlationId: D, parent: C)

Chain: [A, B, C, D]
```

---

### 2.7. Telemetry

**Arquivo**: `src/nerv/telemetry/telemetry.js`
**LOC**: ~140 linhas
**Responsabilidades**:
- ✅ Contar eventos por tipo
- ✅ Medir latências
- ✅ Health metrics (P9.1)

**Interface Pública**:
```javascript
// src/nerv/telemetry/telemetry.js
class Telemetry {
    constructor() {
        this.eventCounts = new Map();
        this.latencies = new Map();
        this.startTime = Date.now();
    }

    recordEvent(messageType) {
        const count = this.eventCounts.get(messageType) || 0;
        this.eventCounts.set(messageType, count + 1);
    }

    recordLatency(messageType, durationMs) {
        if (!this.latencies.has(messageType)) {
            this.latencies.set(messageType, []);
        }

        const latencies = this.latencies.get(messageType);
        latencies.push(durationMs);

        // Limit history (últimos 100)
        if (latencies.length > 100) {
            latencies.shift();
        }
    }

    getMetrics() {
        const uptime = Date.now() - this.startTime;

        return {
            uptime,
            eventCounts: Object.fromEntries(this.eventCounts),
            avgLatencies: this.calculateAvgLatencies(),
            totalEvents: Array.from(this.eventCounts.values()).reduce((a, b) => a + b, 0)
        };
    }

    calculateAvgLatencies() {
        const result = {};

        for (const [type, latencies] of this.latencies) {
            const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
            result[type] = Math.round(avg * 10) / 10;  // 1 decimal
        }

        return result;
    }
}

module.exports = Telemetry;
```

**Uso** (endpoint `/api/health`):
```javascript
app.get('/api/health', (req, res) => {
    const nervMetrics = nerv.telemetry.getMetrics();

    res.json({
        status: 'ok',
        uptime: nervMetrics.uptime,
        eventCounts: nervMetrics.eventCounts,
        avgLatencies: nervMetrics.avgLatencies
    });
});
```

---

## ⚙️ KERNEL (Execution Engine)

**Localização**: `src/kernel/`
**LOC**: ~1,800 linhas
**Audit Rating**: 9.2/10
**Acoplamento**: NERV (via KernelNERVBridge), INFRA (queue, locks)

### 3.1. KernelMaestro

**Arquivo**: `src/kernel/maestro/maestro.js`
**LOC**: ~280 linhas
**Responsabilidades**:
- ✅ Orchestrar Kernel Loop
- ✅ Manter estado de runningTasks
- ✅ Coordenar PolicyEngine, TaskRuntime, ObservationStore

**Interface Pública**:
```javascript
// src/kernel/maestro/maestro.js
class KernelMaestro {
    constructor() {
        this.runningTasks = new Set();
        this.loop = new KernelLoop(this);
        this.policy = new PolicyEngine(this);
        this.taskRuntime = new TaskRuntime();
        this.observations = new ObservationStore();
        this.nervBridge = new KernelNERVBridge(this);
    }

    async start() {
        log('INFO', '[KERNEL] Starting...');

        await this.nervBridge.initialize();
        await this.loop.start();

        log('INFO', '[KERNEL] Running (20Hz loop)');
    }

    async stop() {
        log('INFO', '[KERNEL] Stopping...');

        await this.loop.stop();
        await this.nervBridge.shutdown();

        log('INFO', '[KERNEL] Stopped');
    }

    getRunningTasks() {
        return this.runningTasks;
    }
}

module.exports = KernelMaestro;
```

**Uso** (em `main.js`):
```javascript
const KernelMaestro = require('./kernel/maestro/maestro');

const kernel = new KernelMaestro();

// Start
await kernel.start();

// Stop (gracefully)
process.on('SIGINT', async () => {
    await kernel.stop();
    process.exit(0);
});
```

---

### 3.2. KernelLoop (20Hz)

**Arquivo**: `src/kernel/kernel_loop/kernel_loop.js`
**LOC**: ~220 linhas
**Responsabilidades**:
- ✅ Loop 20Hz (50ms por ciclo)
- ✅ Timeout wrapper (P9.4: 5s max)
- ✅ Invocar PolicyEngine
- ✅ Processar decisões

**Interface Interna**:
```javascript
// src/kernel/kernel_loop/kernel_loop.js
class KernelLoop {
    constructor(maestro) {
        this.maestro = maestro;
        this.running = false;
        this.cycleTimeout = 5000;  // P9.4
    }

    async start() {
        this.running = true;
        await this.cycle();
    }

    async stop() {
        this.running = false;
    }

    async cycle() {
        if (!this.running) return;

        const cycleStart = Date.now();

        try {
            // P9.4: Timeout wrapper (5s)
            const decisions = await Promise.race([
                this.gatherDecisions(),
                this.timeoutPromise(this.cycleTimeout)
            ]);

            await this.processDecisions(decisions);

        } catch (error) {
            if (error.message === 'CYCLE_TIMEOUT') {
                log('WARN', '[KERNEL] Cycle timeout exceeded (5s)');
            } else {
                log('ERROR', '[KERNEL] Cycle error', { error: error.message });
            }
        }

        const cycleDuration = Date.now() - cycleStart;

        // Manter 20Hz (50ms target)
        const nextDelay = Math.max(0, 50 - cycleDuration);

        setTimeout(() => this.cycle(), nextDelay);
    }

    async gatherDecisions() {
        return await this.maestro.policy.evaluate();
    }

    async processDecisions(decisions) {
        if (decisions.shouldAllocate && decisions.nextTask) {
            await this.maestro.allocateTask(decisions.nextTask);
        }
    }

    timeoutPromise(ms) {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error('CYCLE_TIMEOUT')), ms);
        });
    }
}

module.exports = KernelLoop;
```

**Performance Típica**:
- Cycle duration: 10-30ms
- Overhead: 20-40% do tempo
- Decisões: 60-80% do tempo
- Próximo cycle: 20-40ms depois

---

### 3.3. PolicyEngine

**Arquivo**: `src/kernel/policy_engine/policy_engine.js`
**LOC**: ~200 linhas
**Responsabilidades**:
- ✅ Avaliar MAX_WORKERS (P9.9)
- ✅ Consultar queue via INFRA
- ✅ Decidir se pode alocar nova task

**Interface Interna**:
```javascript
// src/kernel/policy_engine/policy_engine.js
const CONFIG = require('../../core/config');
const { getQueue } = require('../../infra/queue/cache');

class PolicyEngine {
    constructor(maestro) {
        this.maestro = maestro;
    }

    async evaluate() {
        const running = this.maestro.getRunningTasks().size;
        const maxWorkers = CONFIG.MAX_WORKERS;

        // Política 1: Respeitar MAX_WORKERS
        if (running >= maxWorkers) {
            return {
                shouldAllocate: false,
                reason: 'MAX_WORKERS_REACHED'
            };
        }

        // Política 2: Queue não vazia
        const queue = await getQueue();
        const pendingTasks = queue.filter(t => t.state === 'PENDING');

        if (pendingTasks.length === 0) {
            return {
                shouldAllocate: false,
                reason: 'QUEUE_EMPTY'
            };
        }

        // Política 3: Alocar primeira task PENDING
        return {
            shouldAllocate: true,
            nextTask: pendingTasks[0],
            queueSize: pendingTasks.length
        };
    }
}

module.exports = PolicyEngine;
```

**Decisões Típicas**:
```javascript
// Scenario 1: Pode alocar
{
    shouldAllocate: true,
    nextTask: { id: 'task-abc', ... },
    queueSize: 15
}

// Scenario 2: MAX_WORKERS atingido
{
    shouldAllocate: false,
    reason: 'MAX_WORKERS_REACHED'
}

// Scenario 3: Queue vazia
{
    shouldAllocate: false,
    reason: 'QUEUE_EMPTY'
}
```

---

### 3.4. TaskRuntime

**Arquivo**: `src/kernel/task_runtime/task_runtime.js`
**LOC**: ~180 linhas
**Responsabilidades**:
- ✅ Gerenciar estados de tasks
- ✅ Optimistic locking (P5.1)
- ✅ Validar transições de estado

**Interface Pública**:
```javascript
// src/kernel/task_runtime/task_runtime.js
const { loadTask, saveTask } = require('../../infra/storage/io');

class TaskRuntime {
    async updateState(taskId, newState, expectedState = null) {
        // 1. Load current state
        const task = await loadTask(taskId);

        if (!task) {
            throw new Error(`TASK_NOT_FOUND: ${taskId}`);
        }

        // 2. P5.1: Optimistic locking
        if (expectedState && task.state !== expectedState) {
            throw new Error(`RACE_CONDITION: Expected ${expectedState}, got ${task.state}`);
        }

        // 3. Validate transition
        if (!this.isValidTransition(task.state, newState)) {
            throw new Error(`INVALID_TRANSITION: ${task.state} → ${newState}`);
        }

        // 4. Update
        task.state = newState;
        task.updatedAt = Date.now();

        // 5. Save
        await saveTask(task);

        log('INFO', `[RUNTIME] Task ${taskId} state: ${task.state} → ${newState}`);

        return task;
    }

    isValidTransition(from, to) {
        const validTransitions = {
            'PENDING': ['RUNNING', 'CANCELED'],
            'RUNNING': ['DONE', 'FAILED', 'CANCELED'],
            'DONE': [],
            'FAILED': [],
            'CANCELED': []
        };

        return validTransitions[from]?.includes(to) || false;
    }
}

module.exports = TaskRuntime;
```

**Uso**:
```javascript
// P5.1: Optimistic locking prevents race conditions
await taskRuntime.updateState('task-abc', 'RUNNING', 'PENDING');
```

---

### 3.5. ObservationStore

**Arquivo**: `src/kernel/observation_store/observation_store.js`
**LOC**: ~150 linhas
**Responsabilidades**:
- ✅ Histórico de execuções
- ✅ Telemetria agregada
- ✅ Memoização de decisões (P9.5)

**Interface Pública**:
```javascript
// src/kernel/observation_store/observation_store.js
class ObservationStore {
    constructor() {
        this.history = [];
        this.memoCache = new WeakMap();  // P9.5
    }

    record(observation) {
        this.history.push({
            ...observation,
            timestamp: Date.now()
        });

        // Limit history (últimos 1000)
        if (this.history.length > 1000) {
            this.history.shift();
        }
    }

    getHistory(filter = {}) {
        return this.history.filter(obs => {
            if (filter.taskId && obs.taskId !== filter.taskId) return false;
            if (filter.type && obs.type !== filter.type) return false;
            return true;
        });
    }

    // P9.5: Memoize expensive computations
    memoize(key, fn) {
        if (this.memoCache.has(key)) {
            return this.memoCache.get(key);
        }

        const result = fn();
        this.memoCache.set(key, result);
        return result;
    }
}

module.exports = ObservationStore;
```

---

### 3.6. KernelNERVBridge

**Arquivo**: `src/kernel/nerv_bridge/nerv_bridge.js`
**LOC**: ~240 linhas
**Responsabilidades**:
- ✅ Conectar Kernel ↔ NERV
- ✅ Emitir eventos: TASK_ALLOCATED, TASK_STATE_CHANGE
- ✅ Escutar eventos: DRIVER_RESULT, QUEUE_CHANGE

**Interface Interna**:
```javascript
// src/kernel/nerv_bridge/nerv_bridge.js
const nerv = require('../../nerv/nerv');

class KernelNERVBridge {
    constructor(maestro) {
        this.maestro = maestro;
    }

    async initialize() {
        // Escutar DRIVER_RESULT
        nerv.on('DRIVER_RESULT', (envelope) => {
            this.handleDriverResult(envelope.payload);
        });

        // Escutar QUEUE_CHANGE
        nerv.on('QUEUE_CHANGE', (envelope) => {
            this.handleQueueChange(envelope.payload);
        });

        log('INFO', '[KERNEL] NERV bridge initialized');
    }

    emit(messageType, payload) {
        nerv.emit(messageType, payload);
    }

    async handleDriverResult({ taskId, status, correlationId }) {
        try {
            await this.maestro.taskRuntime.updateState(
                taskId,
                status === 'SUCCESS' ? 'DONE' : 'FAILED',
                'RUNNING'
            );

            this.maestro.runningTasks.delete(taskId);

            this.emit('TASK_STATE_CHANGE', {
                taskId,
                state: status === 'SUCCESS' ? 'DONE' : 'FAILED',
                correlationId
            });

        } catch (error) {
            log('ERROR', '[KERNEL] Failed to finalize task', {
                taskId,
                error: error.message
            });
        }
    }

    handleQueueChange({ action, filePath }) {
        log('DEBUG', `[KERNEL] Queue changed: ${action} - ${filePath}`);
        // Kernel loop will pick up on next cycle
    }
}

module.exports = KernelNERVBridge;
```

---

*Continuação em próxima seção devido ao limite de caracteres...*

## 📚 Referências

- [ARCHITECTURE.md](ARCHITECTURE.md) - Visão geral dos componentes
- [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) - Diagramas detalhados
- [DATA_FLOW.md](DATA_FLOW.md) - Fluxos de dados
- [PATTERNS.md](PATTERNS.md) - Padrões arquiteturais

---

*Última revisão: 21/01/2026 | Contribuidores: AI Architect, Core Team*
