**Status**: Canônico de apoio.  
**Escopo**: aprofundamento arquitetural deste recorte.  
**Quando consultar**: quando precisar detalhar este subsistema, fluxo ou visão especializada.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](./ARCHITECTURE.md).

# 🌊 Fluxos de Dados do Sistema

**Versão**: 1.0 **Última Atualização**: 21/01/2026 **Público-Alvo**: Desenvolvedores (intermediário
a avançado) **Tempo de Leitura**: ~20 min

---

## 📖 Visão Geral

Este documento detalha os **fluxos de dados** através do sistema `chatgpt-docker-puppeteer`: como
informações transitam entre componentes, transformações aplicadas, e pontos de persistência.
Complementa [ARCHITECTURE.md](./ARCHITECTURE.md) e [SYSTEM_DESIGN.md](./ESPECIALIZADOS/SYSTEM_DESIGN.md) com foco em
**dados**, não estrutura.

### O Que Este Documento Cobre

- ✅ **Fluxo de Task** - Da criação à conclusão (end-to-end)
- ✅ **Fluxo de Eventos NERV** - Buffers → Transport → Receptors
- ✅ **Fluxo de Browser** - Pool → Allocation → Execution → Release
- ✅ **Fluxo de Persistência** - File System reads/writes
- ✅ **Fluxo de Telemetria** - Logs, metrics, observability

---

## 🎯 Objetivos Deste Documento

Ao ler este documento, você aprenderá:

- **Transformações de dados** em cada etapa do fluxo
- **Pontos de validação** (Zod schemas, sanitization)
- **Caching e invalidação** (queue cache, JSON memoization)
- **Persistência** (tasks, respostas, controle, logs)
- **Observabilidade** (correlation IDs, telemetria)

**Pré-requisitos**:

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Entender containers e componentes
- [SYSTEM_DESIGN.md](./ESPECIALIZADOS/SYSTEM_DESIGN.md) - Conhecer sequence diagrams básicos

---

## 🔄 Fluxo 1: Task End-to-End (Detalhado)

### Visão Geral

```
[User Input] → [File System] → [Queue Cache] → [Kernel] → [Driver]
              → [Browser] → [LLM] → [Response] → [Storage] → [Dashboard]
```

### Fase 1: Criação da Task

#### 1.1. User Input (JSON Manual)

**Ator**: Usuário ou sistema externo

**Input**: Arquivo JSON criado manualmente

```json
// fila/task-abc123.json
{
  "id": "task-abc123",
  "target": "chatgpt",
  "prompt": "Explique event loop em Node.js",
  "priority": 1,
  "createdAt": 1737469200000
}
```

**Validações Pendentes**:

- ❌ Ainda não validado (JSON raw no filesystem)
- ❌ Pode conter erros de sintaxe
- ❌ Pode ter campos faltando

---

#### 1.2. File System Write

**Ator**: Node.js fs.writeFileSync()

**Transformação**: JavaScript Object → JSON String → Bytes no disco

```javascript
const task = { id: 'task-abc123', ... };
const json = JSON.stringify(task, null, 2);  // Pretty print
fs.writeFileSync('fila/task-abc123.json', json, 'utf-8');
```

**Ponto de Persistência**: `fila/task-abc123.json`

**Eventos Disparados**:

- Sistema operacional: file change event
- File watcher (100ms debounce): detectará mudança

---

### Fase 2: Detecção e Caching

#### 2.1. File Watcher Detection

**Ator**: `src/infra/queue/fs_watcher.js`

**Fluxo**:

```
OS File Change Event
    ↓
chokidar watcher.on('add', filePath)
    ↓
Debounce 100ms (acumula múltiplos eventos)
    ↓
Trigger action
```

**Código**:

```javascript
// src/infra/queue/fs_watcher.js
watcher.on('add', filePath => {
  debouncedInvalidate(() => {
    log('DEBUG', `[WATCHER] New file detected: ${filePath}`);

    // P5.2: Mark dirty BEFORE any operation
    cache.markDirty();

    // Notify NERV
    nerv.emit('QUEUE_CHANGE', {
      action: 'add',
      filePath,
      timestamp: Date.now(),
    });
  }, 100);
});
```

**Saída**:

- ✅ Cache invalidado (`isCacheDirty = true`)
- ✅ Evento NERV emitido (`QUEUE_CHANGE`)

---

#### 2.2. Queue Cache Invalidation

**Ator**: `src/infra/queue/cache.js`

**Estado Antes**:

```javascript
{
    globalQueueCache: [...], // Snapshot antigo
    isCacheDirty: false,     // Cache válido
    lastFullScan: 1737469100000
}
```

**Transformação**:

```javascript
function markDirty() {
  isCacheDirty = true; // P5.2: Marca ANTES de qualquer I/O
  log('DEBUG', '[CACHE] Marked dirty - next scan will refresh');
}
```

**Estado Depois**:

```javascript
{
    globalQueueCache: [...], // Ainda snapshot antigo
    isCacheDirty: true,      // ⚠ Cache inválido!
    lastFullScan: 1737469100000
}
```

**Próxima Leitura**: `getQueue()` detectará dirty e disparará `scanQueue()`

---

### Fase 3: Kernel Loop Decision

#### 3.1. Kernel Cycle Start (20Hz)

**Ator**: `src/kernel/kernel_loop/kernel_loop.js`

**Frequência**: 20Hz = 50ms por ciclo

**Fluxo**:

```javascript
async function cycle() {
  const cycleStart = Date.now();

  try {
    // [P9.4] Timeout wrapper (5s)
    const decisions = await Promise.race([gatherDecisions(), timeoutPromise(5000)]);

    await processDecisions(decisions);
  } catch (error) {
    handleError(error);
  }

  const cycleDuration = Date.now() - cycleStart;

  // Manter 20Hz (50ms target)
  const nextDelay = Math.max(0, 50 - cycleDuration);
  setTimeout(() => cycle(), nextDelay);
}
```

**Métricas**:

- Ciclo típico: 10-30ms
- Overhead: 20-40% do tempo disponível
- Remaining: 60-80% para decisões reais

---

#### 3.2. Policy Evaluation

**Ator**: `src/kernel/policy_engine/policy_engine.js`

**Input**:

```javascript
{
    runningTasks: Set(2),     // 2 tasks executando
    MAX_WORKERS: 3,           // P9.9: Configurável
    queueSize: null           // Ainda não consultado
}
```

**Consulta Queue**:

```javascript
async function evaluateTasks() {
  const queue = await queueCache.getQueue();
  const running = maestro.getRunningTasks().size;

  return {
    canAllocate: running < CONFIG.MAX_WORKERS,
    queueSize: queue.length,
    nextTask: queue[0] || null,
  };
}
```

**Output**:

```javascript
{
    canAllocate: true,        // 2 < 3 workers
    queueSize: 15,            // 15 tasks na fila
    nextTask: {               // Primeira task PENDING
        id: 'task-abc123',
        target: 'chatgpt',
        prompt: '...',
        state: 'PENDING'
    }
}
```

---

#### 3.3. Queue Scan (com p-limit)

**Ator**: `src/infra/queue/cache.js`

**Trigger**: `getQueue()` detectou `isCacheDirty = true`

**Fluxo**:

```javascript
async function scanQueue() {
  const files = fs.readdirSync('fila/').filter(f => f.endsWith('.json'));

  // P9.7: p-limit controla concorrência (10 simultâneos)
  const limit = pLimit(10);

  const tasks = await Promise.all(files.map(file => limit(() => loadTask(file))));

  // P9.6: Cache metrics
  cacheHits = 0;
  cacheMisses++;

  globalQueueCache = tasks.filter(Boolean);
  lastFullScan = Date.now();
  isCacheDirty = false;

  return globalQueueCache;
}
```

**Transformação**:

```
Files (15 arquivos)
    ↓ readdir
['task-abc123.json', 'task-def456.json', ...]
    ↓ Promise.all + p-limit(10)
[Promise<task1>, Promise<task2>, ...]
    ↓ await
[{id:'task-abc123',...}, {id:'task-def456',...}, ...]
    ↓ filter(Boolean)
[validTask1, validTask2, ...] (14 válidos, 1 corrupto removido)
```

**Performance** (P9.7):

- Antes: 15 files = 15 FDs simultâneos
- Depois: 15 files = 10 FDs max (p-limit)
- Latência: 200ms (cache miss)

---

#### 3.4. Task Loading & Validation

**Ator**: `src/infra/storage/io.js` + `src/core/schemas.js`

**Fluxo de Validação**:

```javascript
// 1. Load raw JSON
function loadTask(taskId) {
  const filePath = path.join(ROOT, 'fila', `${taskId}.json`);

  // P8.7: Path traversal protection
  if (!isPathSafe(filePath)) {
    throw new Error('SECURITY_PATH_TRAVERSAL');
  }

  // P8.8: Symlink validation
  const stats = fs.lstatSync(filePath);
  if (stats.isSymbolicLink()) {
    throw new Error('SECURITY_SYMLINK_DENIED');
  }

  const rawJson = fs.readFileSync(filePath, 'utf-8');
  const rawData = JSON.parse(rawJson);

  // 2. Validate with Zod schema
  return schemas.parseTask(rawData);
}
```

**Schema Validation** (Zod):

```javascript
// src/core/schemas.js
const TaskSchema = z.object({
  id: z.string().min(1),
  target: z.enum(['chatgpt', 'gemini']),
  prompt: z.string().min(1),
  state: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED']).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  createdAt: z.number().int().positive(),
  spec: z
    .object({
      validation: z
        .object({
          minLength: z.number().optional(),
          forbiddenTerms: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
});

function parseTask(data) {
  const result = TaskSchema.safeParse(data);

  if (!result.success) {
    log('ERROR', `[SCHEMA] Invalid task: ${result.error.message}`);
    // Move para fila/corrupted/
    moveToCorrupted(data.id);
    return null;
  }

  return result.data;
}
```

**Transformação**:

```
Raw JSON (untyped)
    ↓ JSON.parse()
JavaScript Object (untyped)
    ↓ TaskSchema.safeParse()
Task (typed, validated) ✅
    OR
Error (moved to corrupted/) ❌
```

---

### Fase 4: Task Allocation

#### 4.1. Kernel Allocates Task

**Ator**: `src/kernel/maestro/maestro.js`

**Decisão**:

```javascript
if (policy.canAllocate && policy.nextTask) {
  await allocateTask(policy.nextTask);
}
```

**Allocation Flow**:

```javascript
async function allocateTask(task) {
  // 1. Update state (optimistic locking - P5.1)
  await taskRuntime.updateState(task.id, 'RUNNING', 'PENDING');

  // 2. Add to running set
  runningTasks.add(task.id);

  // 3. Emit via NERV
  nervBridge.emit('TASK_ALLOCATED', {
    taskId: task.id,
    target: task.target,
    prompt: task.prompt,
    correlationId: generateCorrelationId(),
  });

  // 4. Telemetry
  telemetry.emit('task.allocated', {
    taskId: task.id,
    queueWaitTime: Date.now() - task.createdAt,
  });
}
```

**State Transition**:

```
Task {
    state: 'PENDING',
    allocatedAt: null
}
    ↓
Task {
    state: 'RUNNING',      // ✅ Changed
    allocatedAt: 1737469250000  // ✅ Added
}
```

---

#### 4.2. NERV Event Flow

**Ator**: `src/nerv/`

**Fluxo Completo**:

```
Kernel.emit('TASK_ALLOCATED', payload)
    ↓
[1] Emission Layer
    - Create envelope
    - Add correlationId
    - Add timestamp
    - Initialize _serialized = null (P9.5)
    ↓
[2] Buffers Layer
    - Enqueue in outbound buffer
    - Check overflow (P9.3: max 10k items)
    ↓
[3] Transport Layer
    - Serialize envelope (memoized - P9.5)
    - Route to receptors
    ↓
[4] Reception Layer
    - Match event type ('TASK_ALLOCATED')
    - Find registered handlers
    - Execute callbacks
    ↓
Driver.on('TASK_ALLOCATED', handler)
```

**Envelope Structure**:

```javascript
{
    messageType: 'TASK_ALLOCATED',
    payload: {
        taskId: 'task-abc123',
        target: 'chatgpt',
        prompt: 'Explique event loop...',
        correlationId: '550e8400-e29b-41d4-a716-446655440000'
    },
    correlationId: '550e8400-e29b-41d4-a716-446655440000',
    timestamp: 1737469250123,
    _serialized: null  // P9.5: Lazy memoization
}
```

**Serialization (P9.5 - Memoização)**:

```javascript
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

**Performance**:

- 1ª serialização: ~5ms (parse + stringify)
- 2ª+ serializações: ~0.1ms (cache hit)
- Reduction: 98% em hot paths (kernel loop 20Hz)

---

### Fase 5: Driver Execution

#### 5.1. Driver Receives Event

**Ator**: `src/driver/nerv_adapter/nerv_adapter.js`

**Handler**:

```javascript
class DriverNERVAdapter {
  constructor() {
    nerv.on('TASK_ALLOCATED', envelope => {
      this.handleAllocation(envelope.payload);
    });
  }

  async handleAllocation({ taskId, target, prompt, correlationId }) {
    log('INFO', `[DRIVER] Received task ${taskId} for ${target}`, {
      correlationId,
    });

    try {
      const driver = DriverFactory.create(target);
      const result = await driver.execute(taskId, prompt);

      this.emitResult('SUCCESS', taskId, result, correlationId);
    } catch (error) {
      this.emitResult('FAILURE', taskId, error, correlationId);
    }
  }
}
```

---

#### 5.2. Browser Page Allocation

**Ator**: `src/infra/browser_pool/pool_manager.js`

**Request**:

```javascript
const page = await browserPool.allocatePage('chatgpt');
```

**Pool Selection (P9.2 - Circuit Breaker)**:

```javascript
function _selectInstance(target) {
  // Filtrar apenas instâncias HEALTHY (circuit breaker)
  const healthy = pool.filter(
    e => e.health.status === 'HEALTHY' && e.health.consecutiveFailures === 0
  );

  if (healthy.length === 0) {
    throw new Error('BROWSER_POOL_EXHAUSTED');
  }

  // Round-robin ou least-loaded
  const instance = selectByStrategy(healthy);

  return instance;
}
```

**Page Allocation**:

```javascript
async function allocatePage(target) {
  const instance = _selectInstance(target);

  // Criar nova página
  const page = await instance.browser.newPage();

  // Configurar interceptors, user-agent, etc
  await setupPage(page);

  // Incrementar contador
  instance.stats.activeTasks++;

  return page;
}
```

**State Transition**:

```
BrowserInstance {
    health: { status: 'HEALTHY', consecutiveFailures: 0 },
    stats: { activeTasks: 2, totalTasks: 45 }
}
    ↓
BrowserInstance {
    health: { status: 'HEALTHY', consecutiveFailures: 0 },
    stats: { activeTasks: 3, totalTasks: 46 }  // ✅ Incremented
}
```

---

#### 5.3. Prompt Sanitization (P8.1)

**Ator**: `src/driver/modules/human.js`

**Input** (raw prompt):

```javascript
const rawPrompt = 'Explique\x00event\r\nloop\x1Fem Node.js';
```

**Sanitization**:

```javascript
function sanitizePrompt(text) {
  // Remove control characters (\x00-\x1F, exceto \n e \t)
  let clean = text.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

  // Normalizar line endings (CRLF → LF)
  clean = clean.replace(/\r\n/g, '\n');

  // Trim whitespace
  clean = clean.trim();

  return clean;
}
```

**Output** (sanitized):

```javascript
const sanitized = 'Explique event\nloop em Node.js';
```

**Por Que Importante**:

- ❌ `\x00` (null byte) pode quebrar browser protocol
- ❌ `\x1F` (control chars) podem causar comportamento inesperado
- ✅ Sanitização previne ataques de injection

---

#### 5.4. Human-like Typing

**Ator**: `src/driver/modules/human.js`

**Input**:

```javascript
{
    page: ChromiumPage,
    element: ElementHandle<textarea>,
    text: "Explique event loop em Node.js",
    delays: { min: 50, max: 150 }  // Adaptive
}
```

**Fluxo**:

```javascript
async function type(page, element, text, delays = {}) {
  const chars = text.split('');

  for (const char of chars) {
    // Delay adaptativo (EMA algorithm)
    const delay = adaptiveDelay.next(char);

    await element.type(char);
    await page.waitForTimeout(delay);
  }
}
```

**Adaptive Delay** (P7.1-P7.5):

```javascript
// src/logic/adaptive_delay.js
class AdaptiveDelay {
  constructor() {
    this.ema = 100; // Exponential Moving Average
    this.alpha = 0.3;
  }

  next(char) {
    // Randomização base
    const base = Math.random() * (150 - 50) + 50;

    // EMA smoothing
    this.ema = this.alpha * base + (1 - this.alpha) * this.ema;

    // Outlier rejection (6σ)
    if (Math.abs(base - this.ema) > 6 * stdDev) {
      return this.ema; // Rejeitar outlier
    }

    return Math.round(this.ema);
  }
}
```

**Timeline**:

```
Char: 'E' → delay: 95ms  → type
Char: 'x' → delay: 103ms → type
Char: 'p' → delay: 87ms  → type
...
Total: 32 chars × ~95ms avg = ~3s total
```

---

#### 5.5. Response Collection (Incremental)

**Ator**: `src/driver/modules/collection.js`

**Goal**: Coletar resposta enquanto LLM gera (30-120s)

**Anti-Loop Heuristics**:

```javascript
async function collectResponse(page, taskId) {
  let response = '';
  let lastHash = '';
  let stableCount = 0;

  const MAX_STABLE = 3; // 3 chunks idênticos = fim
  const POLL_INTERVAL = 1000; // 1s entre polls

  while (stableCount < MAX_STABLE) {
    // Extrair texto atual
    const currentText = await page.evaluate(() => {
      const element = document.querySelector('.response-text');
      return element ? element.innerText : '';
    });

    // Hash comparison (anti-loop)
    const currentHash = hash(currentText);

    if (currentHash === lastHash) {
      stableCount++;
      log('DEBUG', `[COLLECTION] Stable count: ${stableCount}/${MAX_STABLE}`);
    } else {
      stableCount = 0;
      response = currentText;
      lastHash = currentHash;

      // Emit progress (optional)
      nerv.emit('DRIVER_PROGRESS', {
        taskId,
        length: response.length,
        timestamp: Date.now(),
      });
    }

    await page.waitForTimeout(POLL_INTERVAL);
  }

  return response;
}
```

**Timeline**:

```
t=0s    : response = "" (vazio)
t=1s    : response = "Event loop é..." (generating)
t=2s    : response = "Event loop é um mecanismo..." (generating)
...
t=28s   : response = "...conclusão." (stable 1/3)
t=29s   : response = "...conclusão." (stable 2/3)
t=30s   : response = "...conclusão." (stable 3/3) ✅ DONE
```

**Hash Function**:

```javascript
function hash(text) {
  // Simple hash (não criptográfico)
  return text.split('').reduce((acc, char) => {
    return (acc << 5) - acc + char.charCodeAt(0);
  }, 0);
}
```

---

### Fase 6: Persistência e Finalização

#### 6.1. Save Response

**Ator**: `src/infra/storage/io.js`

**Input**:

```javascript
{
    taskId: 'task-abc123',
    response: "Event loop é um mecanismo que permite...\n\nConclusão: ..."
}
```

**Fluxo**:

```javascript
async function saveResponse(taskId, text) {
  const filePath = path.join(ROOT, 'respostas', `${taskId}.txt`);

  // P8.7: Path safety
  if (!isPathSafe(filePath)) {
    throw new Error('SECURITY_PATH_TRAVERSAL');
  }

  // Write atomically
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, text, 'utf-8');
  fs.renameSync(tmpPath, filePath); // Atomic on POSIX

  log('INFO', `[STORAGE] Response saved: ${taskId} (${text.length} bytes)`);
}
```

**Ponto de Persistência**: `respostas/task-abc123.txt`

---

#### 6.2. Emit Result via NERV

**Ator**: `src/driver/nerv_adapter/nerv_adapter.js`

**Event**:

```javascript
nerv.emit('DRIVER_RESULT', {
  taskId: 'task-abc123',
  status: 'SUCCESS',
  responseLength: 1234,
  duration: 32000, // 32s
  correlationId: '550e8400-...',
});
```

**Envelope**:

```javascript
{
    messageType: 'DRIVER_RESULT',
    payload: { taskId, status, ... },
    correlationId: '550e8400-...',
    timestamp: 1737469282123,
    _serialized: null
}
```

---

#### 6.3. Kernel Updates State

**Ator**: `src/kernel/maestro/maestro.js`

**Handler**:

```javascript
nerv.on('DRIVER_RESULT', async ({ taskId, status, correlationId }) => {
  try {
    // 1. Update state (optimistic locking - P5.1)
    await taskRuntime.updateState(
      taskId,
      status === 'SUCCESS' ? 'DONE' : 'FAILED',
      'RUNNING' // Expected state
    );

    // 2. Remove from running set
    runningTasks.delete(taskId);

    // 3. Move file fila/ → processadas/
    await moveToProcessed(taskId);

    // 4. Telemetry
    telemetry.emit('task.completed', {
      taskId,
      status,
      totalDuration: Date.now() - task.createdAt,
      correlationId,
    });

    // 5. Broadcast to dashboard
    nerv.emit('TASK_STATE_CHANGE', {
      taskId,
      state: status === 'SUCCESS' ? 'DONE' : 'FAILED',
      timestamp: Date.now(),
    });
  } catch (error) {
    log('ERROR', `[KERNEL] Failed to finalize task ${taskId}: ${error.message}`);
  }
});
```

**State Transition**:

```
Task {
    state: 'RUNNING',
    allocatedAt: 1737469250000,
    completedAt: null
}
    ↓
Task {
    state: 'DONE',               // ✅ Changed
    allocatedAt: 1737469250000,
    completedAt: 1737469282000  // ✅ Added
}
```

---

#### 6.4. Dashboard Broadcast (P9.8 - Debounced)

**Ator**: `src/server/engine/socket.js`

**Debouncing** (50ms):

```javascript
const pendingBroadcasts = new Map();
let timer = null;

function debouncedBroadcast(taskId, data) {
  // Buffer update
  pendingBroadcasts.set(taskId, { taskId, ...data });

  // Schedule flush (only once)
  if (!timer) {
    timer = setTimeout(() => {
      flushBroadcasts();
    }, 50);
  }
}

function flushBroadcasts() {
  const updates = Array.from(pendingBroadcasts.values());

  // Emit batched
  io.emit('tasks:batch_update', {
    updates,
    count: updates.length,
    timestamp: Date.now(),
  });

  pendingBroadcasts.clear();
  timer = null;
}
```

**Timeline**:

```
t=0ms  : Task 1 completes → buffer
t=10ms : Task 2 completes → buffer
t=25ms : Task 3 completes → buffer
t=50ms : FLUSH → emit batched (3 tasks)
```

**Reduction**: 70-80% em broadcasts (3 events → 1 batch)

---

## 🔄 Fluxo 2: Eventos NERV (Internal)

### Arquitetura de Buffers

```
┌─────────────────────────────────────────┐
│            Component A                  │
└────────────────┬────────────────────────┘
                 │
                 │ emit('EVENT', payload)
                 ↓
┌─────────────────────────────────────────┐
│         NERV Emission Layer             │
│  1. Create envelope                     │
│  2. Add correlationId                   │
│  3. Add timestamp                       │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│        Outbound Buffer (FIFO)           │
│  [envelope1, envelope2, envelope3, ...] │
│  Max: 10,000 items (P9.3)               │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│        NERV Transport Layer             │
│  1. Dequeue from outbound               │
│  2. Serialize (memoized - P9.5)         │
│  3. Route to receptors                  │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│         Inbound Buffer (FIFO)           │
│  [envelope1, envelope2, envelope3, ...] │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│        NERV Reception Layer             │
│  1. Dequeue from inbound                │
│  2. Match event type                    │
│  3. Execute handlers                    │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│            Component B                  │
│  on('EVENT', handler)                   │
└─────────────────────────────────────────┘
```

### Performance Metrics

| Operação             | Latência   | Observação                     |
| -------------------- | ---------- | ------------------------------ |
| emit()               | 1-2ms      | Create envelope + enqueue      |
| Serialization (1st)  | 5ms        | JSON.stringify                 |
| Serialization (2nd+) | 0.1ms      | P9.5 cache hit (98% reduction) |
| Transport            | 1-2ms      | Route to receptors             |
| Reception            | 0.5-1ms    | Match + execute                |
| **Total (cold)**     | **8-10ms** | First event                    |
| **Total (hot)**      | **3-5ms**  | Cached events (P9.5)           |

---

## 📚 Referências

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Visão geral dos componentes
- [SYSTEM_DESIGN.md](./ESPECIALIZADOS/SYSTEM_DESIGN.md) - Diagramas e sequence flows
- [SUBSYSTEMS.md](./SUBSYSTEMS.md) - Deep dive em cada módulo

---

_Última revisão: 21/01/2026 | Contribuidores: AI Architect, Core Team_
