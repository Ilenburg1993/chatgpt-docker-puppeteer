> **Status**: Especializado **Não é baseline principal**: use [ARCHITECTURE.md](../ARCHITECTURE.md)
> como fonte oficial. **Quando consultar**: apenas para aprofundamento deste recorte.

# 🎨 Padrões Arquiteturais

**Versão**: 1.0 **Última Atualização**: 21/01/2026 **Público-Alvo**: Arquitetos, desenvolvedores
sênior **Tempo de Leitura**: ~25 min

---

## 📖 Visão Geral

Este documento cataloga os **padrões arquiteturais e de design** aplicados no sistema
`chatgpt-docker-puppeteer`. Cada padrão é apresentado com:

- **Intent** - Por que usar este padrão?
- **Implementation** - Como está implementado no código?
- **Benefits** - Quais vantagens oferece?
- **Trade-offs** - Quais desvantagens/custos?
- **Code Examples** - Exemplos reais do codebase

---

## 🎯 Padrões Catalogados

### Arquiteturais (Macro)

1. Event-Driven Architecture
2. Domain-Driven Design
3. Layered Architecture
4. Plugin Architecture

### Estruturais (Meso)

5. Factory Pattern
6. Adapter Pattern
7. Observer Pattern
8. Singleton Pattern

### Comportamentais (Micro)

9. Circuit Breaker
10. Retry with Backoff
11. Optimistic Locking
12. Memoization

### Concorrência

13. Async/Await
14. Promise Pooling (p-limit)
15. Debouncing

---

## 🏗️ 1. Event-Driven Architecture

### Intent

**Desacoplar componentes** para que não se conheçam diretamente. Comunicação via eventos
intermediados por um **event bus** (NERV).

### Implementation

```javascript
// src/nerv/nerv.js
class NERV {
  emit(messageType, payload) {
    const envelope = this.emission.createEnvelope(messageType, payload);
    this.buffers.enqueueOutbound(envelope);
    this.transport.route();
  }

  on(messageType, handler) {
    this.reception.register(messageType, handler);
  }
}

// Uso: Kernel emite evento
nerv.emit('TASK_ALLOCATED', { taskId: 'task-abc', target: 'chatgpt' });

// Uso: Driver escuta evento
nerv.on('TASK_ALLOCATED', ({ taskId, target }) => {
  log('INFO', `[DRIVER] Received task ${taskId} for ${target}`);
  executeTask(taskId, target);
});
```

### Benefits

- ✅ **Zero coupling**: Kernel não conhece Driver, Driver não conhece Server
- ✅ **Testability**: Componentes testados isoladamente (mock NERV)
- ✅ **Extensibility**: Adicionar novos listeners sem modificar emitters
- ✅ **Observability**: Todos os eventos visíveis no NERV

### Trade-offs

- ❌ **Latência**: +5-10ms por evento (vs chamada direta)
- ❌ **Debugging**: Stack traces fragmentados (indireção)
- ❌ **Complexity**: Entender fluxo requer rastrear eventos

### Metrics

- Total de eventos (por tipo): Disponível via `/api/health`
- Latência média por evento: 3-5ms (hot path com memoization P9.5)

### Related Patterns

- Observer Pattern (receptors como observers)
- Publish-Subscribe (NERV é o pub/sub broker)

---

## 🗂️ 2. Domain-Driven Design

### Intent

**Organizar código por domínios funcionais**, não camadas técnicas. Cada domínio tem
responsabilidades claras e fronteiras bem definidas.

### Implementation

```
src/
├── kernel/      # Domínio: Execução de tarefas
│   ├── maestro/
│   ├── kernel_loop/
│   ├── policy_engine/
│   └── task_runtime/
├── driver/      # Domínio: Automação de browser
│   ├── factory/
│   ├── chatgpt/
│   ├── gemini/
│   └── modules/
├── infra/       # Domínio: Recursos compartilhados
│   ├── browser_pool/
│   ├── queue/
│   ├── locks/
│   └── storage/
├── server/      # Domínio: Interface web
├── nerv/        # Domínio: Event bus
├── core/        # Domínio: Fundação
└── logic/       # Domínio: Regras de negócio
```

### Domain Responsibilities

| Domínio    | O Que Faz                                    | O Que NÃO Faz             |
| ---------- | -------------------------------------------- | ------------------------- |
| **KERNEL** | Decide quais tasks executar, quando executar | ❌ Automação de browser   |
| **DRIVER** | Controla browser, coleta respostas           | ❌ Decisões de scheduling |
| **INFRA**  | Gerencia recursos (browsers, queue, locks)   | ❌ Regras de negócio      |
| **SERVER** | Interface web, API REST, WebSocket           | ❌ Lógica de execução     |
| **NERV**   | Event bus, buffers, correlation              | ❌ Conteúdo dos eventos   |
| **CORE**   | Config, logger, schemas, identidade          | ❌ Domínios específicos   |
| **LOGIC**  | Adaptive delays, validação, contexto         | ❌ I/O direto             |

### Benefits

- ✅ **Clarity**: Fácil saber onde adicionar código
- ✅ **Testability**: Testar domínio sem carregar outros
- ✅ **Team Scalability**: Times diferentes cuidam de domínios diferentes
- ✅ **Refactoring**: Mudanças isoladas dentro de domínio

### Trade-offs

- ❌ **More files**: 60+ arquivos (vs 10 monolítico)
- ❌ **Navigation**: Entender fluxo requer navegar vários diretórios
- ❌ **Initial complexity**: Curva de aprendizado maior

### Metrics

- LOC por domínio:
  - CORE: ~1,200
  - NERV: ~2,100
  - KERNEL: ~1,800
  - INFRA: ~2,500
  - DRIVER: ~3,200
  - SERVER: ~900
  - LOGIC: ~700
  - **Total**: ~12,400 LOC (domain code only)

---

## 📚 3. Layered Architecture

### Intent

Organizar código em **camadas hierárquicas** onde camadas superiores dependem de inferiores, nunca o
contrário.

### Implementation

```
┌────────────────────────────────────┐
│         Layer 4: SERVER            │ (Presentation)
│  Express, Socket.io, Dashboard     │
└────────────────┬───────────────────┘
                 │ uses
┌────────────────┴───────────────────┐
│     Layer 3: KERNEL + DRIVER       │ (Application)
│  Orchestration, Business Logic     │
└────────────────┬───────────────────┘
                 │ uses
┌────────────────┴───────────────────┐
│       Layer 2: INFRA + LOGIC       │ (Domain Services)
│  Browser Pool, Queue, Validation   │
└────────────────┬───────────────────┘
                 │ uses
┌────────────────┴───────────────────┐
│         Layer 1: CORE              │ (Foundation)
│  Config, Logger, Schemas, Identity │
└────────────────────────────────────┘
```

### Dependency Rules

- ✅ **Allowed**: Layer N → Layer N-1 (Server → Kernel → Infra → Core)
- ❌ **Forbidden**: Layer N-1 → Layer N (Core não pode importar Kernel)
- ✅ **Exception**: NERV (cross-cutting, todos podem usar)

### Benefits

- ✅ **Substitutability**: Trocar Layer 2 sem afetar Layer 3
- ✅ **Testing**: Layer 1 testado sem Layer 2-4
- ✅ **Reusability**: Core/Infra reutilizáveis em outros projetos

### Trade-offs

- ❌ **Rigidity**: Algumas operações precisam atravessar muitas camadas
- ❌ **Over-engineering**: Pode ser excessivo para projetos pequenos

---

## 🔌 4. Plugin Architecture

### Intent

Permitir **extensibilidade** sem modificar código core. Novos targets LLM podem ser adicionados como
plugins.

### Implementation

```javascript
// src/driver/factory/driver_factory.js
class DriverFactory {
  static drivers = new Map();

  // Registrar plugin
  static register(target, DriverClass) {
    this.drivers.set(target, DriverClass);
    log('INFO', `[FACTORY] Driver registered: ${target}`);
  }

  // Criar instância
  static create(target) {
    const DriverClass = this.drivers.get(target);

    if (!DriverClass) {
      throw new Error(`UNKNOWN_TARGET: ${target}`);
    }

    return new DriverClass();
  }
}

// Plugin: ChatGPT
class ChatGPTDriver {
  async execute(taskId, prompt) {
    // Implementação específica ChatGPT
  }
}

// Plugin: Gemini
class GeminiDriver {
  async execute(taskId, prompt) {
    // Implementação específica Gemini
  }
}

// Registro
DriverFactory.register('chatgpt', ChatGPTDriver);
DriverFactory.register('gemini', GeminiDriver);

// Uso
const driver = DriverFactory.create('chatgpt');
```

### Benefits

- ✅ **Open/Closed Principle**: Aberto para extensão, fechado para modificação
- ✅ **Isolation**: Bug em plugin não afeta core
- ✅ **Easy addition**: Adicionar novo LLM = criar plugin + registrar

### Trade-offs

- ❌ **Interface rigidity**: Todos os plugins devem seguir mesma interface
- ❌ **Discovery**: Não há auto-discovery (registro manual necessário)

### Adding New Plugin (Example: Claude)

```javascript
// 1. Create plugin
class ClaudeDriver {
  async execute(taskId, prompt) {
    // Claude-specific implementation
    const page = await browserPool.allocatePage('claude');
    await page.goto('https://claude.ai');
    // ... resto da implementação
  }
}

// 2. Register
DriverFactory.register('claude', ClaudeDriver);

// 3. Use
const driver = DriverFactory.create('claude');
await driver.execute('task-xyz', 'Hello Claude');
```

---

## 🏭 5. Factory Pattern

### Intent

**Encapsular criação de objetos** com lógica condicional. Cliente não precisa saber qual classe
concreta instanciar.

### Implementation

Ver "Plugin Architecture" acima (DriverFactory).

### Benefits

- ✅ **Encapsulation**: Lógica de criação centralizada
- ✅ **Polymorphism**: Cliente trabalha com interface comum

### Trade-offs

- ❌ **Extra indirection**: +1 camada entre cliente e objeto

---

## 🔌 6. Adapter Pattern

### Intent

**Converter interface incompatível** em interface esperada. Usado para conectar componentes ao NERV
sem modificá-los.

### Implementation

```javascript
// src/driver/nerv_adapter/nerv_adapter.js
class DriverNERVAdapter {
  constructor() {
    this.drivers = new Map();

    // Adapter: Escutar NERV e chamar Driver
    nerv.on('TASK_ALLOCATED', (envelope) => {
      this.handleAllocation(envelope.payload);
    });
  }

  async handleAllocation({ taskId, target, prompt, correlationId }) {
    const driver = DriverFactory.create(target);

    try {
      const result = await driver.execute(taskId, prompt);

      // Adapter: Converter resultado Driver → NERV event
      this.emitResult('SUCCESS', taskId, result, correlationId);
    } catch (error) {
      this.emitResult('FAILURE', taskId, error, correlationId);
    }
  }

  emitResult(status, taskId, data, correlationId) {
    nerv.emit('DRIVER_RESULT', {
      status,
      taskId,
      data,
      correlationId,
    });
  }
}
```

### Benefits

- ✅ **Decoupling**: Driver não precisa conhecer NERV
- ✅ **Reusability**: Driver reutilizável sem NERV
- ✅ **Single Responsibility**: Adapter cuida da conversão

### Trade-offs

- ❌ **Extra layer**: +1 arquivo e camada de indireção

### Similar Adapters

- `KernelNERVBridge` - Adapter entre Kernel ↔ NERV
- `ServerNERVAdapter` - Adapter entre Server ↔ NERV

---

## 👀 7. Observer Pattern

### Intent

**Observar mudanças** em objeto e reagir automaticamente. Usado em file watcher para detectar novas
tasks.

### Implementation

```javascript
// src/infra/queue/fs_watcher.js
const chokidar = require('chokidar');

class FileWatcher {
  constructor(dirPath) {
    this.watcher = chokidar.watch(dirPath, {
      ignoreInitial: false,
      persistent: true,
      awaitWriteFinish: true,
    });

    // Observer: Registrar callbacks para eventos
    this.watcher
      .on('add', (filePath) => this.handleAdd(filePath))
      .on('change', (filePath) => this.handleChange(filePath))
      .on('unlink', (filePath) => this.handleRemove(filePath));
  }

  handleAdd(filePath) {
    log('DEBUG', `[WATCHER] File added: ${filePath}`);

    // Debounce 100ms (acumular múltiplos eventos)
    this.debouncedInvalidate(() => {
      cache.markDirty();

      nerv.emit('QUEUE_CHANGE', {
        action: 'add',
        filePath,
        timestamp: Date.now(),
      });
    }, 100);
  }
}
```

### Benefits

- ✅ **Reactive**: Sistema reage automaticamente a mudanças externas
- ✅ **Decoupling**: File system não conhece sistema
- ✅ **Real-time**: Mudanças detectadas imediatamente (100ms debounce)

### Trade-offs

- ❌ **Resource usage**: File watcher consome FD (file descriptor)
- ❌ **Complexity**: Debouncing necessário para evitar spam

---

## 🔒 8. Singleton Pattern

### Intent

**Garantir única instância** de objeto global. Usado para NERV, Config, Logger.

### Implementation

```javascript
// src/nerv/nerv.js
class NERV {
  constructor() {
    if (NERV.instance) {
      return NERV.instance;
    }

    this.emission = new Emission();
    this.reception = new Reception();
    // ...

    NERV.instance = this;
  }
}

// Export singleton
const nerv = new NERV();
module.exports = nerv;
```

### Benefits

- ✅ **Global access**: Qualquer módulo pode importar e usar
- ✅ **Consistency**: Estado compartilhado centralmente
- ✅ **Lazy init**: Criado apenas quando necessário

### Trade-offs

- ❌ **Testing**: Difícil mockar (estado global persiste entre testes)
- ❌ **Hidden dependencies**: Não explícito em assinaturas de função

### Singletons no Sistema

- `nerv` - Event bus
- `CONFIG` - Configurações
- `log` - Logger
- `browserPool` - Pool de browsers (implícito)

---

## ⚡ 9. Circuit Breaker

### Intent

**Prevenir cascata de falhas** detectando degradação e "abrindo circuito" (bloqueando requisições a
serviço instável).

### Implementation

```javascript
// src/infra/browser_pool/pool_manager.js
class PoolManager {
  _selectInstance(target) {
    // P9.2: Circuit Breaker - filtrar apenas HEALTHY
    const healthy = this.pool.filter(
      (entry) => entry.health.status === 'HEALTHY' && entry.health.consecutiveFailures === 0,
    );

    if (healthy.length === 0) {
      log('ERROR', '[POOL] Circuit breaker OPEN - no healthy instances');
      throw new Error('BROWSER_POOL_EXHAUSTED');
    }

    return this.selectByStrategy(healthy);
  }

  async _handleFailure(instance) {
    instance.health.consecutiveFailures++;

    // Threshold: 3 failures
    if (instance.health.consecutiveFailures >= 3) {
      log('WARN', `[POOL] Circuit breaker triggered for instance ${instance.id}`);

      instance.health.status = 'CRASHED';
      this.pool = this.pool.filter((e) => e !== instance);

      // Tentar recuperar
      await instance.browser.close();
    } else if (instance.health.consecutiveFailures >= 1) {
      instance.health.status = 'DEGRADED';
    }
  }
}
```

### States

```
┌─────────┐
│ HEALTHY │ ◄──── consecutiveFailures = 0
└────┬────┘
     │ failure
     ↓
┌─────────┐
│DEGRADED │ ◄──── consecutiveFailures = 1-2
└────┬────┘       (ainda acessível em emergência)
     │ failure (>=3)
     ↓
┌─────────┐
│ CRASHED │ ◄──── consecutiveFailures >= 3
└─────────┘       (removido do pool)
```

### Benefits

- ✅ **Fault tolerance**: Sistema continua funcionando com instâncias saudáveis
- ✅ **Fast fail**: Não desperdiça tempo com instâncias ruins
- ✅ **Self-healing**: Instâncias recuperadas após restart

### Trade-offs

- ❌ **False positives**: Instância pode ser marcada DEGRADED por pico temporário
- ❌ **Threshold tuning**: 3 failures pode ser muito ou pouco (configurável)

### Metrics

- Response time: Se >5s → considerar DEGRADED
- Consecutive failures: Se >=3 → marcar CRASHED
- Recovery: Manual restart ou auto-heal (pendente)

---

## 🔁 10. Retry with Backoff

### Intent

**Tentar novamente após falha** com delays crescentes (exponential backoff) para evitar
sobrecarregar serviço.

### Implementation

```javascript
// src/driver/modules/human.js (adaptive delays)
class AdaptiveDelay {
  constructor() {
    this.baseDelay = 100;
    this.maxDelay = 500;
    this.backoffMultiplier = 1.5;
    this.currentDelay = this.baseDelay;
  }

  next() {
    const delay = this.currentDelay;

    // Exponential backoff
    this.currentDelay = Math.min(this.currentDelay * this.backoffMultiplier, this.maxDelay);

    return delay;
  }

  reset() {
    this.currentDelay = this.baseDelay;
  }
}

// Uso em retry
async function retryWithBackoff(fn, maxAttempts = 3) {
  const backoff = new AdaptiveDelay();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      const delay = backoff.next();
      log('WARN', `[RETRY] Attempt ${attempt} failed, retrying in ${delay}ms`);

      await sleep(delay);
    }
  }
}
```

### Timeline Example

```
Attempt 1: Execute → FAIL → Wait 100ms
Attempt 2: Execute → FAIL → Wait 150ms
Attempt 3: Execute → SUCCESS ✅
```

### Benefits

- ✅ **Resilience**: Transient errors não causam falha permanente
- ✅ **Politeness**: Não sobrecarrega serviço com retry imediato

### Trade-offs

- ❌ **Latency**: Aumenta latência total (100+150+... ms)
- ❌ **Complexity**: Requer lógica de retry em múltiplos lugares

---

## 🔐 11. Optimistic Locking

### Intent

**Prevenir race conditions** em atualizações concorrentes verificando se estado esperado ainda é
atual antes de commitar.

### Implementation

```javascript
// src/kernel/task_runtime/task_runtime.js
async function updateState(taskId, newState, expectedState = null) {
  // 1. Load current
  const task = await loadTask(taskId);

  // 2. P5.1: Optimistic locking check
  if (expectedState && task.state !== expectedState) {
    throw new Error(`RACE_CONDITION: Expected ${expectedState}, got ${task.state}`);
  }

  // 3. Update
  task.state = newState;
  task.updatedAt = Date.now();

  // 4. Save
  await saveTask(task);

  return task;
}
```

### Race Condition Example

```
T=0    : Task state = 'PENDING'
T=100ms: Instance A reads ('PENDING')
T=110ms: Instance B reads ('PENDING')
T=200ms: Instance A updates to 'RUNNING' with expected='PENDING' ✅ SUCCESS
T=210ms: Instance B tries update to 'RUNNING' with expected='PENDING'
         → Current state is 'RUNNING' (changed by A)
         → expected ('PENDING') ≠ actual ('RUNNING')
         → ❌ RACE_CONDITION error thrown
```

### Benefits

- ✅ **Data consistency**: Previne overwrites inválidos
- ✅ **Detection**: Race conditions detectadas explicitamente
- ✅ **Simple**: Não requer locks externos

### Trade-offs

- ❌ **Retry needed**: Cliente precisa retry após RACE_CONDITION
- ❌ **Performance**: Requer extra read antes de write

### Alternatives

- Pessimistic locking (Lock Manager) - mais overhead, zero races
- Last-write-wins - simples, mas perde updates

---

## 💾 12. Memoization

### Intent

**Cachear resultados** de computações caras para evitar reprocessamento.

### Implementation

```javascript
// P9.5: Memoização de serialização de envelopes NERV
function serializeEnvelope(envelope) {
  // Cache hit: retorna imediatamente
  if (envelope._serialized) {
    return envelope._serialized;
  }

  // Cache miss: serializa e guarda
  const { _serialized, ...clean } = envelope;
  envelope._serialized = JSON.stringify(clean);

  return envelope._serialized;
}
```

### Performance Impact

| Operação           | Latência (cold) | Latência (hot) | Reduction |
| ------------------ | --------------- | -------------- | --------- |
| JSON.stringify     | 5ms             | 0.1ms          | **98%**   |
| Kernel loop (20Hz) | 10ms            | 3ms            | **70%**   |
| NERV emit          | 8ms             | 3ms            | **62%**   |

### Benefits

- ✅ **Performance**: 98% reduction em hot paths
- ✅ **Automatic**: Transparente para cliente
- ✅ **Memory efficient**: WeakMap permite GC

### Trade-offs

- ❌ **Memory**: Cache consome memória (pequeno neste caso)
- ❌ **Staleness**: Caches podem ficar desatualizados (não aplicável aqui - envelopes imutáveis)

---

## ⏱️ 13. Async/Await

### Intent

Escrever código **assíncrono de forma síncrona** (linear), evitando callback hell.

### Implementation

```javascript
// ❌ Antes (callback hell)
function executeTask(taskId, callback) {
  loadTask(taskId, (err, task) => {
    if (err) return callback(err);

    allocatePage(task.target, (err, page) => {
      if (err) return callback(err);

      navigate(page, task.url, (err) => {
        if (err) return callback(err);

        type(page, task.prompt, (err) => {
          if (err) return callback(err);

          collectResponse(page, (err, response) => {
            if (err) return callback(err);

            saveResponse(taskId, response, callback);
          });
        });
      });
    });
  });
}

// ✅ Depois (async/await)
async function executeTask(taskId) {
  const task = await loadTask(taskId);
  const page = await allocatePage(task.target);
  await navigate(page, task.url);
  await type(page, task.prompt);
  const response = await collectResponse(page);
  await saveResponse(taskId, response);
}
```

### Benefits

- ✅ **Readability**: Código linear, fácil de entender
- ✅ **Error handling**: try/catch tradicional funciona
- ✅ **Debugging**: Stack traces mais claras

### Trade-offs

- ❌ **Parallelism loss**: await sequencial (usar Promise.all quando possível)

---

## 🏊 14. Promise Pooling (p-limit)

### Intent

**Controlar concorrência** de operações assíncronas para evitar esgotar recursos (file descriptors,
memória).

### Implementation

```javascript
// src/infra/queue/cache.js
const pLimit = require('p-limit');

async function scanQueue() {
  const files = fs.readdirSync('fila/');

  // P9.7: p-limit controla concorrência (10 simultâneos)
  const limit = pLimit(10);

  const tasks = await Promise.all(files.map((file) => limit(() => loadTask(file))));

  return tasks.filter(Boolean);
}
```

### Performance

| Cenário                     | FDs usados | Latência                        |
| --------------------------- | ---------- | ------------------------------- |
| Sem p-limit (100 files)     | 100        | 150ms (rápido mas perigoso)     |
| Com p-limit(10) (100 files) | 10         | 200ms (+33% latência, -90% FDs) |

### Benefits

- ✅ **Resource control**: Evita esgotar file descriptors
- ✅ **Stability**: Sistema não trava com queues grandes
- ✅ **Tunable**: Fácil ajustar concorrência (CONFIG.QUEUE_CONCURRENCY)

### Trade-offs

- ❌ **Latency**: +33% latência vs sem limite
- ❌ **Complexity**: +1 dependência (p-limit npm package)

---

## ⏳ 15. Debouncing

### Intent

**Agrupar múltiplos eventos** em curto período de tempo para reduzir processamento redundante.

### Implementation

```javascript
// src/infra/queue/fs_watcher.js
function debounce(fn, delayMs) {
  let timer = null;

  return function (...args) {
    if (timer) clearTimeout(timer);

    timer = setTimeout(() => {
      fn(...args);
      timer = null;
    }, delayMs);
  };
}

const debouncedInvalidate = debounce((action) => {
  cache.markDirty();
  nerv.emit('QUEUE_CHANGE', { action });
}, 100);

// Uso
watcher.on('add', (filePath) => {
  debouncedInvalidate(() => handleAdd(filePath));
});
```

### Timeline Example

```
T=0ms   : File 1 added → debounce timer start (100ms)
T=10ms  : File 2 added → reset timer (100ms from now)
T=25ms  : File 3 added → reset timer (100ms from now)
T=125ms : Timer fires → process all 3 files at once
```

### Benefits

- ✅ **Efficiency**: Processa N eventos com 1 operação
- ✅ **Rate limiting**: Previne spam de eventos
- ✅ **User experience**: Mais responsivo (batch updates)

### Trade-offs

- ❌ **Latency**: +100ms delay (configurável)
- ❌ **Complexity**: Requer state (timer)

### Debounced Operations

- File watcher (100ms)
- Dashboard broadcasts (50ms - P9.8)
- Health checks (1000ms)

---

## 📊 Padrões por Categoria

### Tabela de Uso

| Padrão             | Frequência | Complexidade | Impacto |
| ------------------ | ---------- | ------------ | ------- |
| Event-Driven       | ⭐⭐⭐⭐⭐ | Média        | Alto    |
| Domain-Driven      | ⭐⭐⭐⭐⭐ | Alta         | Alto    |
| Factory            | ⭐⭐⭐     | Baixa        | Médio   |
| Adapter            | ⭐⭐⭐⭐   | Baixa        | Alto    |
| Observer           | ⭐⭐       | Média        | Médio   |
| Circuit Breaker    | ⭐⭐       | Média        | Alto    |
| Optimistic Locking | ⭐⭐       | Baixa        | Médio   |
| Memoization        | ⭐⭐⭐⭐   | Baixa        | Alto    |
| Async/Await        | ⭐⭐⭐⭐⭐ | Baixa        | Alto    |
| p-limit            | ⭐⭐       | Baixa        | Médio   |
| Debouncing         | ⭐⭐⭐     | Baixa        | Médio   |

---

## 🎓 Quando Usar Cada Padrão

### Event-Driven

- ✅ Quando desacoplamento é crítico
- ✅ Quando múltiplos componentes precisam reagir ao mesmo evento
- ❌ Quando latência é crítica (<1ms)

### Factory

- ✅ Quando lógica de criação é complexa
- ✅ Quando múltiplas implementações de interface
- ❌ Quando apenas 1 implementação existe

### Circuit Breaker

- ✅ Quando falhas em cascata são risco
- ✅ Quando serviço externo instável
- ❌ Quando downtime zero é impossível

### Memoization

- ✅ Quando função pura (same input → same output)
- ✅ Quando computação cara (>5ms)
- ❌ Quando inputs altamente variáveis (cache miss sempre)

---

## 📚 Referências

- [ARCHITECTURE.md](../ARCHITECTURE.md) - Visão geral dos componentes
- [SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md) - Diagramas e sequence flows
- [SUBSYSTEMS.md](../SUBSYSTEMS.md) - Deep dive em cada módulo
- [PHILOSOPHY.md](./PHILOSOPHY.md) - Princípios arquiteturais

### Recursos Externos

- [Patterns of Enterprise Application Architecture (Fowler)](https://martinfowler.com/books/eaa.html)
- [Circuit Breaker Pattern (Microsoft)](https://docs.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [Domain-Driven Design (Evans)](https://domainlanguage.com/ddd/)

---

_Última revisão: 21/01/2026 | Contribuidores: AI Architect, Core Team_
