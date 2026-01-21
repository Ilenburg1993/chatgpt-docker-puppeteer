# 🏗️ Arquitetura do Sistema

**Versão**: 2.0
**Última Atualização**: 21/01/2026
**Público-Alvo**: Desenvolvedores (intermediário a avançado)
**Tempo de Leitura**: ~25 min

---

## 📖 Visão Geral

O **chatgpt-docker-puppeteer** é um **agente autônomo** que automatiza interações com LLMs via browser. Este documento explica a arquitetura sistêmica completa: estrutura de componentes, fluxos de dados, interações e decisões arquiteturais.

### O Que É Este Sistema?

Sistema de **automação de LLMs** baseado em browser que:
- ✅ Executa tarefas automaticamente via Puppeteer
- ✅ Suporta múltiplos targets (ChatGPT, Gemini)
- ✅ Gerencia fila de tarefas com priorização
- ✅ Oferece dashboard web para monitoramento
- ✅ Opera de forma autônoma 24/7

### Características Principais

| Característica     | Implementação                          | Benefício                          |
| ------------------ | -------------------------------------- | ---------------------------------- |
| **Event-Driven**   | NERV event bus central                 | Zero acoplamento entre componentes |
| **Domain-Driven**  | Kernel/Driver/Infra/Server separados   | Manutenção localizada              |
| **Cross-Platform** | Windows + Linux support                | Flexibilidade de deploy            |
| **Audit-Driven**   | 14 auditorias completas (P1-P9)        | Qualidade sistemática (~9.2/10)    |
| **Observable**     | Logs estruturados, telemetria, metrics | Debug facilitado                   |
| **Resilient**      | Circuit breakers, locks, timeouts      | Tolerância a falhas                |

---

## 🎯 Objetivos Deste Documento

Ao ler este documento, você aprenderá:

- **Estrutura de 13 módulos** e responsabilidades de cada um
- **Fluxo de vida de uma task** do início ao fim (end-to-end)
- **Comunicação via NERV** (event bus central)
- **Interações entre componentes** (diagramas C4)
- **Decisões arquiteturais** fundamentais

**Pré-requisitos**:
- Leitura de [PHILOSOPHY.md](PHILOSOPHY.md) (entender "por quês")
- Conhecimento básico de Node.js, event-driven architecture

**Próximos Passos**:
- [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) - Diagramas C4 detalhados
- [DATA_FLOW.md](DATA_FLOW.md) - Fluxos de dados end-to-end
- [SUBSYSTEMS.md](SUBSYSTEMS.md) - Deep dive em cada módulo

---

## 🗺️ Visão 10,000 ft - Context Diagram (C4)

### Sistema no Contexto do Mundo

```
                        ┌──────────────────────────────────┐
                        │         MUNDO EXTERNO            │
                        └──────────────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              ▼                        ▼                        ▼
      ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
      │   Usuário    │        │   Chrome     │        │     LLMs     │
      │   (Manual)   │        │  (Externo)   │        │ (ChatGPT/    │
      │              │        │  Port 9222   │        │  Gemini)     │
      └───────┬──────┘        └───────┬──────┘        └───────┬──────┘
              │                       │                       │
              │ HTTP/WebSocket        │ CDP Protocol          │ HTTPS
              ↓                       ↓                       ↓
      ┌─────────────────────────────────────────────────────────────┐
      │                                                               │
      │            chatgpt-docker-puppeteer                         │
      │         (Agente Autônomo - PM2 Process)                     │
      │                                                               │
      │  [Dashboard Web] [Execution Engine] [Browser Automation]     │
      │                                                               │
      └───────────────────────────┬─────────────────────────────────┘
                                  │
                                  ↓
                          ┌──────────────┐
                          │  File System │
                          │  (Fila JSON, │
                          │   Respostas) │
                          └──────────────┘
```

### Atores Externos

1. **Usuário Manual**
   - Acessa dashboard web (localhost:3008)
   - Adiciona tasks via interface
   - Monitora execução em tempo real
   - Visualiza respostas coletadas

2. **Chrome Externo**
   - Instância externa rodando com `--remote-debugging-port=9222`
   - Agente conecta via Chrome DevTools Protocol (CDP)
   - Compartilhado entre múltiplas tasks
   - Gerenciado por ConnectionOrchestrator

3. **LLMs (ChatGPT/Gemini)**
   - Interfaces web que o agente automatiza
   - Recebem prompts via digitação automatizada
   - Geram respostas (30-120s)
   - Coletadas incrementalmente pelo Driver

4. **File System**
   - Fila de tarefas (`fila/*.json`)
   - Respostas coletadas (`respostas/*.txt`)
   - Logs estruturados (`logs/`)
   - Estado persistente (`controle.json`, `config.json`)

---

## 🏗️ Visão 1,000 ft - Container Diagram (C4)

### Containers Principais

```
┌───────────────────────────────────────────────────────────────────┐
│                  chatgpt-docker-puppeteer                         │
│                    (Node.js 20 + PM2)                              │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │   SERVER     │  │   KERNEL     │  │   DRIVER     │            │
│  │              │  │              │  │              │            │
│  │  Express +   │  │  Execution   │  │  Puppeteer   │            │
│  │  Socket.io   │  │  Engine      │  │  Automation  │            │
│  │              │  │              │  │              │            │
│  │  Port: 3008  │  │  Loop: 20Hz  │  │  Targets:    │            │
│  │  Dashboard   │  │  Workers: 3  │  │  ChatGPT,    │            │
│  │  API REST    │  │  Policy      │  │  Gemini      │            │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │
│         │                 │                 │                     │
│         └─────────────────┼─────────────────┘                     │
│                           │                                       │
│                    ┌──────▼──────┐                                │
│                    │    NERV     │                                │
│                    │  Event Bus  │                                │
│                    │  (Central)  │                                │
│                    │             │                                │
│                    │  Buffers,   │                                │
│                    │  Transport, │                                │
│                    │  Receptors  │                                │
│                    └──────┬──────┘                                │
│                           │                                       │
│         ┌─────────────────┼─────────────────┐                     │
│         │                 │                 │                     │
│  ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐             │
│  │   INFRA     │   │    LOGIC    │   │    CORE     │             │
│  │             │   │             │   │             │             │
│  │ Browser     │   │ Adaptive    │   │ Config      │             │
│  │ Pool        │   │ Delays      │   │ Logger      │             │
│  │             │   │             │   │ Schemas     │             │
│  │ Queue       │   │ Context     │   │ Identity    │             │
│  │ Cache       │   │ Assembly    │   │ (DNA)       │             │
│  │             │   │             │   │             │             │
│  │ Lock        │   │ Validation  │   │ Constants   │             │
│  │ Manager     │   │             │   │             │             │
│  │             │   │             │   │             │             │
│  │ Storage     │   │             │   │             │             │
│  │ (I/O)       │   │             │   │             │             │
│  └─────────────┘   └─────────────┘   └─────────────┘             │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

### Responsabilidades dos Containers

#### 1. SERVER - Interface com Usuário
**Tecnologia**: Express 4.21 + Socket.io 4.8
**Porta**: 3008 (HTTP/WebSocket)

**Funcionalidades**:
- ✅ Dashboard HTML para monitoramento
- ✅ API REST (`/api/health`, `/api/queue`, `/api/metrics`)
- ✅ WebSocket para updates em tempo real (task progress)
- ✅ Autenticação opcional (DASHBOARD_PASSWORD)
- ✅ Rate limiting (100 req/min por IP)

**Eventos NERV Emitidos**:
- `WEB_REQUEST` - Nova request HTTP
- `DASHBOARD_COMMAND` - Comando via dashboard

**Eventos NERV Escutados**:
- `TASK_STATE_CHANGE` - Broadcast para clientes WebSocket
- `SYSTEM_STATUS_UPDATE` - Atualizar métricas dashboard

---

#### 2. KERNEL - Orquestração de Execução
**Tecnologia**: Node.js (loop custom)
**Frequência**: 20Hz (50ms por ciclo)

**Funcionalidades**:
- ✅ Loop de decisão 20Hz (policy evaluation)
- ✅ Alocação de tasks (MAX_WORKERS=3)
- ✅ Gerenciamento de estado (PENDING → RUNNING → DONE)
- ✅ Health monitoring (infra, browser pool, queue)
- ✅ Observação de sistema (observation store)

**Componentes Internos**:
```
kernel/
├── kernel_loop/           # Loop principal 20Hz
├── policy_engine/         # Decisões de alocação
├── task_runtime/          # Lifecycle de tasks
├── observation_store/     # Histórico de observações
├── nerv_bridge/           # Integração com NERV
└── maestro/               # Orquestrador principal
```

**Eventos NERV Emitidos**:
- `TASK_ALLOCATED` - Task alocada para driver
- `TASK_STATE_CHANGE` - Mudança de estado
- `SYSTEM_OBSERVATION` - Observação de sistema

**Eventos NERV Escutados**:
- `DRIVER_RESULT` - Resultado de execução
- `INFRA_STATUS` - Estado de infraestrutura
- `QUEUE_CHANGE` - Fila modificada

---

#### 3. DRIVER - Automação de Browser
**Tecnologia**: Puppeteer 23.11 + Puppeteer-Extra
**Targets**: ChatGPT, Gemini

**Funcionalidades**:
- ✅ Automação específica por target (factory pattern)
- ✅ Digitação humana (delays adaptativos)
- ✅ Navegação de threads (Ariadne algorithm)
- ✅ Coleta incremental de respostas
- ✅ Detecção de erros específicos (rate limit, session expired)

**Componentes Internos**:
```
driver/
├── factory/               # DriverFactory (seleciona target)
├── targets/
│   ├── chatgpt/           # Automação ChatGPT
│   └── gemini/            # Automação Gemini
├── modules/
│   ├── human.js           # Digitação humana
│   ├── ariadne_thread.js  # Navegação de threads
│   ├── collection.js      # Coleta de respostas
│   └── detection.js       # Detecção de elementos
└── nerv_adapter/          # Integração com NERV
```

**Eventos NERV Emitidos**:
- `DRIVER_RESULT` - Execução completa (sucesso/falha)
- `DRIVER_PROGRESS` - Progresso de coleta (chunks)

**Eventos NERV Escutados**:
- `TASK_ALLOCATED` - Nova task para executar

---

#### 4. NERV - Event Bus Central
**Tecnologia**: Custom event system
**Filosofia**: Zero acoplamento direto entre componentes

**Funcionalidades**:
- ✅ Buffers de eventos (inbound/outbound)
- ✅ Transport layer (emit/receive)
- ✅ Correlation IDs (rastreamento end-to-end)
- ✅ Telemetria unificada
- ✅ Backpressure control

**Componentes Internos**:
```
nerv/
├── buffers/               # Buffers de eventos (FIFO)
├── transport/             # Emissão e recepção
├── correlation/           # Correlation IDs
├── emission/              # Lógica de emit
├── reception/             # Lógica de on/once
├── telemetry/             # Métricas de eventos
└── health/                # Health check de NERV
```

**Fluxo de Evento**:
```
Component A                           Component B
    │                                     │
    │ nerv.emit('EVENT', payload)         │
    ↓                                     │
┌─────────────────────────────────────┐  │
│ NERV                                │  │
│  1. Create envelope                 │  │
│  2. Add correlationId               │  │
│  3. Enqueue in outbound buffer      │  │
│  4. Transport to receptors          │  │
│  5. Match event type                │  │
└─────────────────────────────────────┘  │
                                         ↓
                      Component B.handler(payload)
```

**Métricas**:
- P9.5: JSON memoization (50% CPU reduction em hot path)
- P9.3: Buffer overflow limit (10k items max)
- P9.8: Debouncing para broadcasts (50ms)

---

#### 5. INFRA - Recursos Compartilhados
**Tecnologia**: Node.js + File System + Puppeteer

**Funcionalidades**:
- ✅ **Browser Pool**: Gerencia instâncias Chrome (launcher/external)
- ✅ **Queue Cache**: Cache de fila com file watcher (95% hit rate)
- ✅ **Lock Manager**: Two-phase commit locks (PID validation)
- ✅ **Storage**: Persistência de tasks, respostas, DNA
- ✅ **File System Utils**: Path safety, symlink validation

**Componentes Internos**:
```
infra/
├── browser_pool/
│   ├── pool_manager.js    # Gerenciamento de pool
│   ├── health_monitor.js  # Circuit breaker (P9.2)
│   └── connection_orchestrator.js  # Hybrid/launcher/external
├── queue/
│   ├── cache.js           # Cache com p-limit (P9.7)
│   └── fs_watcher.js      # File watcher (100ms debounce)
├── locks/
│   └── lock_manager.js    # Two-phase commit + PID validation
├── storage/
│   └── io.js              # CRUD de tasks/respostas
└── fs/
    └── fs_utils.js        # Path traversal protection (P8.7)
```

**Métricas**:
- P9.7: Queue scan com p-limit(10) - controle de I/O
- P9.6: Cache metrics (hits/misses tracking)
- P9.2: Circuit breaker - só instâncias HEALTHY

---

#### 6. LOGIC - Lógica de Negócio
**Tecnologia**: Algoritmos adaptativos customizados

**Funcionalidades**:
- ✅ **Adaptive Delays**: EMA + 6σ outlier rejection
- ✅ **Context Assembly**: Monta context para prompts
- ✅ **Validation System**: Valida responses (min length, forbidden terms)

**Componentes Internos**:
```
logic/
├── adaptive_delay.js      # EMA delays (P7.1-P7.5)
├── context_assembly.js    # Context para prompts
└── validation.js          # Validação de respostas
```

**Métricas**:
- Auditoria: 9.7/10 (highest rating)
- EMA: Adapta delays baseado em histórico

---

#### 7. CORE - Fundação do Sistema
**Tecnologia**: Zod 3.24 + Winston logging

**Funcionalidades**:
- ✅ **Config**: Configuração central (config.json + .env)
- ✅ **Logger**: Logging estruturado (severity levels)
- ✅ **Schemas**: Validação Zod (tasks, config)
- ✅ **Identity**: DNA (identificador único do agente)
- ✅ **Constants**: Constantes tipadas (TASK_STATES, etc)

**Componentes Internos**:
```
core/
├── config.js              # Configuração (P9.9: MAX_WORKERS)
├── logger.js              # Winston logging
├── schemas.js             # Zod schemas
├── identity.js            # DNA generation
├── context.js             # Context management
├── hardware.js            # Heap monitoring (P9.1)
└── constants/
    ├── tasks.js           # TASK_STATES, STATUS_VALUES
    ├── browser.js         # CONNECTION_MODES, BROWSER_STATES
    └── nerv.js            # MESSAGE_TYPES, ACTION_CODES
```

---

## 🔄 Fluxo de Vida de uma Task (End-to-End)

### Visão Simplificada

```
[1] User adiciona task.json → fila/
         ↓
[2] File watcher detecta → markDirty()
         ↓
[3] Kernel loop (20Hz) → scanQueue()
         ↓
[4] Policy evaluates → canAllocate? (MAX_WORKERS=3)
         ↓
[5] Kernel aloca → emit('TASK_ALLOCATED')
         ↓
[6] Driver recebe → execute(task)
         ↓
[7] Browser automation → ChatGPT/Gemini
         ↓
[8] Coleta incremental → chunks
         ↓
[9] Response completa → saveResponse()
         ↓
[10] Driver emite → emit('DRIVER_RESULT')
         ↓
[11] Kernel atualiza → task.state = DONE
         ↓
[12] Server broadcast → WebSocket clients
```

### Detalhamento por Fase

#### FASE 1: Chegada da Task

**Ator**: Usuário (manual ou API)

```javascript
// 1. Criar arquivo JSON na fila
const task = {
    id: 'task-123',
    target: 'chatgpt',
    prompt: 'Explique Node.js event loop',
    state: 'PENDING',
    createdAt: Date.now()
};

fs.writeFileSync('fila/task-123.json', JSON.stringify(task));
```

**File Watcher Detecta** (100ms debounce):
```javascript
// src/infra/queue/fs_watcher.js
watcher.on('change', (filePath) => {
    debounce(() => {
        cache.markDirty();  // P5.2: Mark BEFORE write
        nerv.emit('QUEUE_CHANGE', { filePath });
    }, 100);
});
```

---

#### FASE 2: Decisão de Alocação

**Ator**: Kernel Loop (20Hz)

```javascript
// src/kernel/kernel_loop/kernel_loop.js
async function cycle() {
    // 1. Gather decisions (com timeout 5s - P9.4)
    const decisions = await Promise.race([
        Promise.all([
            policyEngine.evaluateTasks(),    // Deve alocar?
            taskAllocator.checkAllocation(), // Há workers livres?
            healthMonitor.checkInfra()       // Infra saudável?
        ]),
        timeoutPromise(5000)  // P9.4: Never block > 5s
    ]);

    // 2. Process decisions
    if (decisions.shouldAllocate && decisions.hasWorkers) {
        const task = await queue.getNext();
        await allocateTask(task);
    }

    // 3. Schedule next cycle (20Hz = 50ms)
    setTimeout(cycle, 50);
}
```

**Policy Engine**:
```javascript
// src/kernel/policy_engine/policy_engine.js
async function evaluateTasks() {
    const running = getRunningTasks().length;
    const MAX_WORKERS = config.MAX_WORKERS;  // P9.9: Configurable

    return {
        canAllocate: running < MAX_WORKERS,
        queueSize: await queue.size(),
        healthStatus: 'HEALTHY'
    };
}
```

---

#### FASE 3: Alocação via NERV

**Ator**: Kernel → NERV → Driver

```javascript
// Kernel emite evento
nerv.emit('TASK_ALLOCATED', {
    taskId: task.id,
    target: task.target,
    prompt: task.prompt,
    correlationId: generateCorrelationId()  // Rastreamento
});

// Driver recebe evento
class DriverNERVAdapter {
    constructor() {
        nerv.on('TASK_ALLOCATED', (data) => {
            this.handleTaskAllocation(data);
        });
    }

    async handleTaskAllocation({ taskId, target, prompt }) {
        const driver = DriverFactory.create(target);  // 'chatgpt' ou 'gemini'
        await driver.execute(taskId, prompt);
    }
}
```

---

#### FASE 4: Execução no Browser

**Ator**: Driver + Puppeteer

```javascript
// src/driver/targets/chatgpt/chatgpt_driver.js
async function execute(taskId, prompt) {
    // 1. Obter página do pool
    const page = await browserPool.allocatePage('chatgpt');

    try {
        // 2. Navegar (se necessário)
        if (!await isOnChatGPT(page)) {
            await page.goto('https://chatgpt.com');
        }

        // 3. Localizar textarea (Ariadne algorithm)
        const textarea = await ariadneLocateTextarea(page);

        // 4. Sanitizar prompt (P8.1: Security)
        const safe = sanitizePrompt(prompt);

        // 5. Digitar como humano (adaptive delays)
        await human.type(page, textarea, safe);

        // 6. Enviar (Enter)
        await textarea.press('Enter');

        // 7. Coletar resposta (incremental)
        const response = await collectResponse(page, taskId);

        // 8. Salvar resposta
        await storage.saveResponse(taskId, response);

        // 9. Emitir resultado
        nerv.emit('DRIVER_RESULT', {
            taskId,
            status: 'SUCCESS',
            responseLength: response.length
        });

    } finally {
        // 10. Liberar página (sempre, mesmo em erro)
        await browserPool.releasePage(page);
    }
}
```

**Coleta Incremental** (anti-loop):
```javascript
// src/driver/modules/collection.js
async function collectResponse(page, taskId) {
    let response = '';
    let stableCount = 0;
    let lastHash = '';

    while (stableCount < 3) {  // 3 chunks idênticos = fim
        const chunk = await page.evaluate(() => {
            return document.querySelector('.response').innerText;
        });

        const currentHash = hash(chunk);

        if (currentHash === lastHash) {
            stableCount++;
        } else {
            stableCount = 0;
            response = chunk;
        }

        lastHash = currentHash;
        await delay(1000);  // Poll a cada 1s
    }

    return response;
}
```

---

#### FASE 5: Finalização

**Ator**: Kernel + Server

```javascript
// Kernel recebe resultado
nerv.on('DRIVER_RESULT', async ({ taskId, status }) => {
    // 1. Atualizar estado (optimistic locking - P5.1)
    await updateTaskState(taskId, 'DONE', 'RUNNING');

    // 2. Remover de runningTasks
    runningTasks.delete(taskId);

    // 3. Mover arquivo fila/ → processadas/
    await moveTaskToProcessed(taskId);

    // 4. Log telemetria
    telemetry.emit('task.completed', {
        taskId,
        duration: Date.now() - task.startTime
    });
});

// Server broadcast para dashboard
nerv.on('TASK_STATE_CHANGE', ({ taskId, state }) => {
    // P9.8: Debounced broadcast (50ms)
    debouncedBroadcast('task:update', { taskId, state });
});
```

---

## 📊 Métricas e Performance

### Latências Típicas

| Operação               | Latência    | Observação               |
| ---------------------- | ----------- | ------------------------ |
| Kernel cycle           | 10-30ms     | 20Hz nominal             |
| Queue scan (10 tasks)  | 200ms       | P9.7: p-limit controlado |
| Queue scan (100 tasks) | 1200ms      | 40% faster com p-limit   |
| Task allocation        | 50-100ms    | NERV + disk I/O          |
| Browser navigate       | 2-5s        | Network dependent        |
| Prompt typing          | 5-15s       | Human-like delays        |
| Response collection    | 30-120s     | LLM generation time      |
| **Task total**         | **45-150s** | **End-to-end**           |

### Throughput

| Configuração            | Throughput       | Observação      |
| ----------------------- | ---------------- | --------------- |
| MAX_WORKERS=1           | ~20-30 tasks/h   | Single-threaded |
| MAX_WORKERS=3 (default) | ~50-70 tasks/h   | Balanced        |
| MAX_WORKERS=5           | ~80-100 tasks/h  | High load       |
| MAX_WORKERS=10          | ~120-150 tasks/h | Max (P9.9)      |

### Resource Usage

| Resource         | Idle   | Light Load (3 workers) | Heavy Load (10 workers) |
| ---------------- | ------ | ---------------------- | ----------------------- |
| CPU              | <5%    | 15-25%                 | 40-60%                  |
| Memory           | ~100MB | ~300MB                 | ~800MB                  |
| Heap             | ~50MB  | ~150MB                 | ~400MB                  |
| File Descriptors | ~50    | ~150                   | ~300                    |

---

## 🔗 Interconexões Principais

### 1. Kernel ↔ Driver (via NERV)

```
Kernel                    NERV                    Driver
  │                        │                        │
  │ emit('TASK_ALLOCATED') │                        │
  ├───────────────────────→│                        │
  │                        │ route to Driver        │
  │                        ├───────────────────────→│
  │                        │                        │
  │                        │ emit('DRIVER_RESULT')  │
  │                        │←───────────────────────┤
  │ handle result          │                        │
  │←───────────────────────┤                        │
```

**Eventos**:
- `TASK_ALLOCATED` (Kernel → Driver)
- `DRIVER_RESULT` (Driver → Kernel)
- `DRIVER_PROGRESS` (Driver → Server, opcional)

---

### 2. Server ↔ Todos (via NERV)

```
Server                    NERV                All Components
  │                        │                        │
  │ on('TASK_STATE_CHANGE')│                        │
  │←───────────────────────┤                        │
  │                        │                        │
  │ broadcast to clients   │                        │
  │                        │                        │
  │                        │ emit('SYSTEM_STATUS')  │
  │                        │←───────────────────────┤
  │ on('SYSTEM_STATUS')    │                        │
  │←───────────────────────┤                        │
```

**Eventos**:
- `TASK_STATE_CHANGE` (qualquer → Server)
- `SYSTEM_STATUS_UPDATE` (Kernel → Server)
- `WEB_REQUEST` (Server → Kernel, comandos)

---

### 3. Infra ↔ Kernel (via NERV)

```
Kernel                    NERV                    Infra
  │                        │                        │
  │ emit('QUEUE_SCAN')     │                        │
  ├───────────────────────→│                        │
  │                        │ route to Queue Cache   │
  │                        ├───────────────────────→│
  │                        │                        │
  │                        │ emit('QUEUE_RESULT')   │
  │                        │←───────────────────────┤
  │ handle queue data      │                        │
  │←───────────────────────┤                        │
```

**Eventos**:
- `QUEUE_CHANGE` (File Watcher → Kernel)
- `QUEUE_SCAN` (Kernel → Queue Cache)
- `BROWSER_HEALTH` (Pool Manager → Kernel)

---

## 📚 Decisões Arquiteturais Chave

### 1. Por Que Event Bus (NERV)?

**Problema Evitado**: Acoplamento direto (Kernel conhece Driver, Driver conhece Server, etc)

**Solução**: Event bus central = zero acoplamento

**Trade-off**: +5-10ms latência, mas +100% testabilidade

**Decisão**: Benefícios superam custos (ver [PHILOSOPHY.md](PHILOSOPHY.md))

---

### 2. Por Que Separar Kernel/Driver/Infra?

**Problema Evitado**: Monólito sem fronteiras (tudo misturado)

**Solução**: Domain-driven design (responsabilidades claras)

**Trade-off**: Mais arquivos (+60 vs 10), mas -60% manutenção

**Decisão**: Escalabilidade de longo prazo prioritária

---

### 3. Por Que 20Hz Kernel Loop?

**Problema Evitado**: Polling muito lento (tasks esperando) ou muito rápido (CPU waste)

**Solução**: 20Hz = 50ms por ciclo (sweet spot)

**Trade-off**: CPU +5-10%, mas responsiveness +200%

**Decisão**: 50ms é imperceptível para tasks de 45-150s

---

### 4. Por Que Browser Pool Externo?

**Problema Evitado**: Launcher mode consome recursos (1 Chrome por task)

**Solução**: Modo hybrid (launcher para dev, external para prod)

**Trade-off**: Setup inicial mais complexo, mas -70% resource usage

**Decisão**: ConnectionOrchestrator oferece ambos (flexibilidade)

---

## 🔍 Próximos Passos

### Para Entender Mais a Fundo

1. **Diagramas Detalhados**: [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md)
   - C4 Component diagrams
   - Sequence diagrams (key scenarios)
   - State machines (task lifecycle, browser health)

2. **Fluxos de Dados**: [DATA_FLOW.md](DATA_FLOW.md)
   - Fluxo de task end-to-end (detalhado)
   - Fluxo de eventos NERV (buffers → transport)
   - Fluxo de browser (pool → page → release)

3. **Deep Dive em Módulos**: [SUBSYSTEMS.md](SUBSYSTEMS.md)
   - 13 módulos, cada um explicado em profundidade
   - Interfaces públicas, dependências, padrões

4. **Padrões Aplicados**: [PATTERNS.md](PATTERNS.md)
   - Event-driven architecture
   - Factory, Observer, Circuit Breaker
   - Two-phase commit, Memoization

### Para Começar a Desenvolver

1. **Setup Ambiente**: [DEVELOPMENT.md](DEVELOPMENT.md)
2. **Configuração**: [CONFIGURATION.md](CONFIGURATION.md)
3. **Testes**: [TESTING.md](TESTING.md)
4. **Contribuir**: [CONTRIBUTING.md](CONTRIBUTING.md)

---

## ❓ FAQ

### 1. Quantos containers Docker existem?

**Resposta**: Apenas **1 container** (agente Node.js). Chrome é externo (host).

### 2. Kernel loop consome muito CPU?

**Resposta**: Não. Em idle: <5% CPU. Em carga: 15-25% (3 workers).

### 3. NERV adiciona overhead significativo?

**Resposta**: +5-10ms por hop. Para tasks de 45-150s, é <0.01% overhead.

### 4. Por que não usar PM2 cluster mode?

**Resposta**: Browser pool não é thread-safe. 1 processo PM2 gerencia múltiplos workers internos (MAX_WORKERS=3-10).

### 5. Sistema suporta múltiplas instâncias?

**Resposta**: Sim, com cuidado:
- UUID-based recovery locks (evita race)
- Fila compartilhada (lock manager)
- Testes com 2 instâncias simultâneas passam

---

*Última revisão: 21/01/2026 | Contribuidores: AI Architect, Core Team*
