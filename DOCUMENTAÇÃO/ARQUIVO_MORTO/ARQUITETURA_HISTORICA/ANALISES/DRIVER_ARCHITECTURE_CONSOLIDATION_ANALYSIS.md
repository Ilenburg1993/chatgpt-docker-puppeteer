> **Status**: Histórico **Este documento está arquivado** e não define o baseline oficial.
> **Referência vigente**:
> [../../../ARQUITETURA/ARCHITECTURE.md](../../../ARQUITETURA/ARCHITECTURE.md).

# 🏗️ Driver Architecture - Análise de Consolidação

**Data**: 3 de Fevereiro de 2026 **Objetivo**: Avaliar arquitetura atual e propor design desacoplado
Task ↔ Driver **Status**: 📊 Análise em Andamento

---

## 🎯 QUESTÕES FUNDAMENTAIS

### 1. API Clara

> "Precisamos ter uma API clara, de modo que outras partes do programa consigam chamar o driver com
> facilidade, sem entrar em seus detalhes"

### 2. Lifecycle vs Task

> "A criação/exclusão do driver precisa necessariamente estar associada a uma tarefa ou conjunto de
> tarefas? Ou devemos criar de outra forma?"

### 3. Ontologia Driver

> "O papel essencial dos drivers é executar as tarefas e devolver a resposta, mas isso não
> necessariamente significa que devam estar umbilicalmente ligados a uma tarefa"

---

## 📊 ARQUITETURA ATUAL (v2.1)

### Hierarquia Existente

```
DriverNERVAdapter (NERV bridge - 1629 linhas)
  ├─> activeDrivers: Map<taskId, DriverLifecycleManager>
  │
  └─> Para cada task:
       └─> DriverLifecycleManager (Orchestrator - 490 linhas)
            ├─> Constructor recebe: (page, task, config)
            ├─> Cria AbortController POR TAREFA
            ├─> acquire() → Factory.getDriver(target, page, config, signal)
            └─> release() → driver.destroy()
                 └─> Factory (Instance Manager - 852 linhas)
                      ├─> getDriver(target, page, config, signal)
                      ├─> Cache: WeakMap<page, Driver>
                      └─> Discovery + Lazy-load
                           └─> TargetDriver (Executor - ex: ChatGPTDriver 2000+ linhas)
                                ├─> Constructor: (page, config, signal)
                                ├─> executeTask(task)
                                └─> Estado interno: IDLE → EXECUTING → DONE
```

### Análise de Acoplamentos

#### ❌ ACOPLAMENTO 1: DriverLifecycleManager ↔ Task

**Onde acontece**:

```javascript
// src/driver/DriverLifecycleManager.js - linha 79
constructor(page, task, config) {
    this.page = page;
    this.task = task;  // ← Task armazenada
    this.config = config;

    this.abortController = new AbortController();  // ← AbortController POR TAREFA
    this.taskId = task.meta.id;  // ← TaskId extraído
    this.correlationId = task.meta.correlation_id || task.meta.id;
}

// Linha 148
this.driver = driverFactory.getDriver(
    this.task.spec.target,  // ← Usa task.spec.target
    this.page,
    this.config,
    this.abortController.signal  // ← Signal da task
);
```

**Problema**:

- DriverLifecycleManager existe APENAS para orquestrar 1 task
- 1 LifecycleManager = 1 Task = 1 Driver (vida curta)
- Driver pode executar múltiplas tasks, mas LifecycleManager não permite isso

**Consequência**:

- Driver Pool não funciona bem: cada task cria novo LifecycleManager → novo AbortController
- Reuse é artificial: LifecycleManager morre, mas Driver poderia continuar vivo

---

#### ❌ ACOPLAMENTO 2: Factory.getDriver() ↔ Page + Signal

**Onde acontece**:

```javascript
// src/driver/factory.js - linha 290
getDriver(target, page, config, signal) {
    // ... validações ...

    // Cache: WeakMap<page, Driver>
    if (this.cache.has(page)) {
        return this.cache.get(page);  // ← Cache por PAGE
    }

    // Cria novo driver
    const DriverClass = this.registry.get(target);
    const driver = new DriverClass(page, config, signal);  // ← Driver attached to page

    this.cache.set(page, driver);  // ← Cache vinculado a page
    return driver;
}
```

**Problema**:

- Driver é criado JÁ attached a uma page específica
- Signal é injetado no constructor (não pode trocar depois)
- Cache usa Page como chave → 1 Driver = 1 Page (não permite reuse)

**Consequência**:

- Pool precisa criar "mock page" para warm drivers (gambiarra)
- Não dá para ter "driver disponível" sem page

---

#### ❌ ACOPLAMENTO 3: TargetDriver Constructor ↔ Page + Signal

**Onde acontece**:

```javascript
// src/driver/core/TargetDriver.js
// src/driver/chatgpt/ChatGPTDriver.js - linha 45
constructor(page, config, signal) {
    super();
    this.page = page;  // ← Page OBRIGATÓRIA no constructor
    this.config = config;
    this.signal = signal;  // ← Signal OBRIGATÓRIO no constructor

    // ... DNA loading (só funciona se page existe) ...
}
```

**Problema**:

- Driver NÃO pode existir sem page
- Signal imutável (não pode trocar entre tasks)
- DNA loading assume page já está navegada

**Consequência**:

- Warm driver precisa de "mock page" (hack)
- Não dá para criar "pool de drivers ociosos"

---

#### ❌ ACOPLAMENTO 4: DriverNERVAdapter.activeDrivers ↔ TaskId

**Onde acontece**:

```javascript
// src/driver/nerv_adapter/driver_nerv_adapter.js - linha 520
async _executeTask(task) {
    // ... setup ...

    // Cria LifecycleManager POR TAREFA
    const lifecycleManager = new DriverLifecycleManager(page, task, this.config);

    // Armazena por taskId
    this.activeDrivers.set(task.meta.id, lifecycleManager);

    // ... acquire + execute ...

    // Cleanup: Remove da lista
    this.activeDrivers.delete(task.meta.id);
    await lifecycleManager.release();  // ← Destrói driver
}
```

**Problema**:

- activeDrivers é Map<taskId, LifecycleManager> → 1:1 task-driver
- Quando task termina, driver é destruído (não fica disponível)

**Consequência**:

- Não há "pool de drivers disponíveis"
- Driver não sobrevive além da task

---

## 🔍 ANÁLISE DE ALTERNATIVAS

### Opção A: ❌ Status Quo (Atual)

**Estrutura**:

```
Task → LifecycleManager → Factory → Driver
       (1:1)              (cache)   (attached to page)
```

**Prós**:

- ✅ Implementado e funcionando
- ✅ AbortSignal por task (isolamento)
- ✅ Telemetria granular (lifecycle events)

**Contras**:

- ❌ Driver acoplado a task (via LifecycleManager)
- ❌ Driver acoplado a page (via constructor)
- ❌ Driver acoplado a signal (via constructor)
- ❌ Não permite reuse verdadeiro (LifecycleManager morre com task)
- ❌ Pool precisa de "mock page" (gambiarra)
- ❌ API complexa (3 camadas: Adapter → Lifecycle → Factory)

**Veredito**: ❌ **Não atende requisito de desacoplamento**

---

### Opção B: ✅ Driver Pool Agnóstico de Task

**Estrutura Proposta**:

```
DriverPool (Pool de drivers IDLE)
  ├─> drivers: Map<target, Driver[]>  (drivers disponíveis)
  ├─> acquire(target) → Driver IDLE
  ├─> release(driver) → Driver volta IDLE
  └─> Driver pode executar MÚLTIPLAS tasks sequencialmente

Task → Adapter → DriverPool.acquire() → Driver IDLE
                                         ├─> attachContext(page, signal)
                                         ├─> executeTask(task)
                                         └─> detachContext()
       Adapter → DriverPool.release() → Driver volta IDLE
```

**Conceitos-chave**:

1. **Driver IDLE**: Driver sem page/signal attached (warm, pronto)
2. **Attach Context**: Injeta page + signal ANTES de executar task
3. **Detach Context**: Remove page + signal DEPOIS de executar task
4. **Pool Management**: Pool mantém drivers IDLE (não por task)

**Mudanças Necessárias**:

#### 1. TargetDriver - Suportar Attach/Detach

```javascript
// src/driver/core/TargetDriver.js

class TargetDriver extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;

    // ✅ Page e Signal são NULL inicialmente
    this.page = null;
    this.signal = null;

    this.state = 'IDLE';
    this.destroyed = false;
  }

  /**
   * Attach context (page + signal) antes de executar task
   * @param {Page} page - Puppeteer page
   * @param {AbortSignal} signal - AbortSignal da task
   */
  attachContext(page, signal) {
    if (this.state !== 'IDLE') {
      throw new Error('[DRIVER] Cannot attach: driver not IDLE');
    }

    this.page = page;
    this.signal = signal;

    log('DEBUG', `[DRIVER] Context attached: ${this.name}`);
  }

  /**
   * Detach context (page + signal) após executar task
   */
  detachContext() {
    this.page = null;
    this.signal = null;
    this.state = 'IDLE';

    log('DEBUG', `[DRIVER] Context detached: ${this.name}`);
  }

  /**
   * Executa task (assume context attached)
   * @param {object} task - Task object
   * @returns {object} Response
   */
  async executeTask(task) {
    if (!this.page || !this.signal) {
      throw new Error('[DRIVER] Cannot execute: context not attached');
    }

    if (this.state !== 'IDLE') {
      throw new Error('[DRIVER] Cannot execute: driver busy');
    }

    this.state = 'EXECUTING';

    try {
      // ... execução atual (prepareContext, execute, extractResponse) ...
      const response = await this._execute(task);

      this.state = 'IDLE';
      return response;
    } catch (error) {
      this.state = 'ERROR';
      throw error;
    }
  }
}
```

#### 2. Factory - Criar Drivers SEM Context

```javascript
// src/driver/factory.js

class DriverFactory {
  constructor() {
    this.registry = new Map();
    this.pool = new Map(); // Map<target, Driver[]>

    // ✅ Remove cache WeakMap (não precisa mais)
  }

  /**
   * Cria driver SEM context (IDLE)
   * @param {string} target - Target name (chatgpt, gemini)
   * @param {object} config - Driver config
   * @returns {TargetDriver} Driver IDLE
   */
  createDriver(target, config) {
    const DriverClass = this.registry.get(target);

    if (!DriverClass) {
      throw new Error(`[FACTORY] Driver not found: ${target}`);
    }

    // ✅ Driver criado SEM page/signal
    const driver = new DriverClass(config);

    log('DEBUG', `[FACTORY] Driver created: ${target} (IDLE)`);

    return driver;
  }

  /**
   * Acquire driver do pool (ou cria novo)
   * @param {string} target - Target name
   * @returns {TargetDriver} Driver IDLE
   */
  acquireFromPool(target) {
    let pool = this.pool.get(target);

    if (!pool || pool.length === 0) {
      // Pool miss: cria novo driver
      log('DEBUG', `[FACTORY] Pool MISS: creating new driver for ${target}`);
      return this.createDriver(target, this.config);
    }

    // Pool hit: reusa driver IDLE
    const driver = pool.shift();
    log('DEBUG', `[FACTORY] Pool HIT: reusing driver for ${target}`);

    return driver;
  }

  /**
   * Release driver de volta ao pool
   * @param {TargetDriver} driver - Driver para liberar
   */
  releaseToPool(driver) {
    if (driver.state !== 'IDLE') {
      log('WARN', `[FACTORY] Driver not IDLE, destroying: ${driver.name}`);
      driver.destroy();
      return;
    }

    const target = driver.constructor.target; // Ex: 'chatgpt'

    if (!this.pool.has(target)) {
      this.pool.set(target, []);
    }

    const pool = this.pool.get(target);

    if (pool.length >= POOL_CONFIG.MAX_POOL_SIZE) {
      log('DEBUG', `[FACTORY] Pool full, destroying driver: ${target}`);
      driver.destroy();
    } else {
      pool.push(driver);
      log('DEBUG', `[FACTORY] Driver released to pool: ${target}`);
    }
  }
}
```

#### 3. Adapter - API Simplificada

```javascript
// src/driver/nerv_adapter/driver_nerv_adapter.js

class DriverNERVAdapter {
  constructor() {
    this.factory = driverFactory;

    // ✅ activeDrivers agora mapeia taskId → Driver (não LifecycleManager)
    this.activeDrivers = new Map(); // Map<taskId, Driver>
  }

  async _executeTask(task) {
    let driver = null;
    const signal = new AbortController().signal; // ✅ Signal por task

    try {
      // 1. Acquire driver do pool (IDLE)
      driver = await this.factory.acquireFromPool(task.spec.target);

      // 2. Attach context (page + signal)
      driver.attachContext(page, signal);

      // 3. Registra driver ativo
      this.activeDrivers.set(task.meta.id, driver);

      // 4. Executa task
      const response = await driver.executeTask(task);

      return response;
    } catch (error) {
      log('ERROR', `[Adapter] Task execution failed: ${error.message}`);
      throw error;
    } finally {
      // 5. Cleanup
      this.activeDrivers.delete(task.meta.id);

      if (driver) {
        // 6. Detach context
        driver.detachContext();

        // 7. Release de volta ao pool
        this.factory.releaseToPool(driver);
      }
    }
  }
}
```

**Prós**:

- ✅ **API Clara**: `acquire() → attach → execute → detach → release`
- ✅ **Desacoplamento Total**: Driver não conhece task (só executa quando attached)
- ✅ **Reuse Verdadeiro**: Driver executa N tasks sequencialmente
- ✅ **Pool Simples**: Map<target, Driver[]> (sem mock page)
- ✅ **Lifecycle por Task**: AbortSignal criado por task, não por driver
- ✅ **Menos Código**: Remove DriverLifecycleManager (490 linhas)

**Contras**:

- ⚠️ **Breaking Change**: Requer refatoração de TargetDriver (attach/detach)
- ⚠️ **DNA Loading**: DNA precisa ser lazy (carrega em attach, não no constructor)

**Veredito**: ✅ **Arquitetura ideal para desacoplamento**

---

### Opção C: 🔀 Híbrido (LifecycleManager + Pool)

**Estrutura**:

```
Task → LifecycleManager → DriverPool.acquire() → Driver IDLE
       (orchestrator)                            ├─> attachContext()
                                                 ├─> executeTask()
                                                 └─> detachContext()
       LifecycleManager → DriverPool.release() → Driver volta IDLE
```

**Conceito**: Mantém LifecycleManager como orchestrator, mas Pool é agnóstico

**Prós**:

- ✅ API Clara (via LifecycleManager)
- ✅ Telemetria granular (lifecycle events)
- ✅ Pool desacoplado (drivers IDLE)

**Contras**:

- ⚠️ Mantém camada extra (LifecycleManager)
- ⚠️ Não remove acoplamento task ↔ LifecycleManager

**Veredito**: 🔀 **Solução intermediária (menos ideal que Opção B)**

---

## 🎯 RECOMENDAÇÃO FINAL

### ✅ Opção B: Driver Pool Agnóstico de Task

**Arquitetura Recomendada**:

```
┌─────────────────────────────────────────────────────────────────┐
│ DriverNERVAdapter (NERV Bridge)                                 │
│   ├─> _executeTask(task)                                        │
│   │    ├─> driver = pool.acquire(target)      ← Pool HIT/MISS   │
│   │    ├─> driver.attachContext(page, signal) ← Context Inject  │
│   │    ├─> response = driver.execute(task)    ← Execution       │
│   │    ├─> driver.detachContext()             ← Context Clear   │
│   │    └─> pool.release(driver)               ← Back to Pool    │
│   └─> activeDrivers: Map<taskId, Driver>                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ DriverFactory (Instance Manager + Pool)                         │
│   ├─> pool: Map<target, Driver[]>            ← Idle drivers     │
│   ├─> createDriver(target, config)           ← Create IDLE      │
│   ├─> acquireFromPool(target)                ← Get IDLE driver  │
│   └─> releaseToPool(driver)                  ← Return IDLE      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ TargetDriver (Executor - ChatGPT/Gemini/etc)                    │
│   ├─> state: IDLE | EXECUTING | ERROR                          │
│   ├─> page: null (até attach)                                  │
│   ├─> signal: null (até attach)                                │
│   ├─> attachContext(page, signal)            ← Inject           │
│   ├─> executeTask(task)                      ← Execute          │
│   └─> detachContext()                        ← Clear            │
└─────────────────────────────────────────────────────────────────┘
```

### 📋 Razões da Recomendação

#### 1. ✅ API Clara e Simples

**ANTES (3 camadas)**:

```javascript
// Código cliente precisa conhecer 3 abstrações
const lifecycleManager = new DriverLifecycleManager(page, task, config);
const driver = await lifecycleManager.acquire();
// ... executar ...
await lifecycleManager.release();
```

**DEPOIS (1 camada)**:

```javascript
// Código cliente só conhece Pool
const driver = await pool.acquire('chatgpt');
driver.attachContext(page, signal);
const response = await driver.executeTask(task);
driver.detachContext();
pool.release(driver);
```

#### 2. ✅ Desacoplamento Total

| Componente           | Antes (v2.1)                           | Depois (v3.0)                       |
| -------------------- | -------------------------------------- | ----------------------------------- |
| **Driver**           | Acoplado a page (constructor)          | ✅ page = null (attach on demand)   |
| **Driver**           | Acoplado a signal (constructor)        | ✅ signal = null (attach on demand) |
| **Driver**           | Acoplado a task (via LifecycleManager) | ✅ Não conhece task (só executa)    |
| **Pool**             | Precisa "mock page" (hack)             | ✅ Drivers IDLE sem context         |
| **LifecycleManager** | 1:1 com task (vida curta)              | ✅ Removido (desnecessário)         |

#### 3. ✅ Reuse Verdadeiro

**ANTES**:

```
Task 1 → LifecycleManager 1 → Driver 1 (destruído)
Task 2 → LifecycleManager 2 → Driver 2 (destruído)
Task 3 → LifecycleManager 3 → Driver 3 (destruído)

Resultado: 3 drivers criados, 0 reuse
```

**DEPOIS**:

```
Task 1 → Driver A (attach → execute → detach → IDLE)
Task 2 → Driver A (attach → execute → detach → IDLE)  ← Reuse!
Task 3 → Driver A (attach → execute → detach → IDLE)  ← Reuse!

Resultado: 1 driver criado, 2 reuses (67% reuse rate)
```

#### 4. ✅ Menos Código

| Arquivo                   | Antes (v2.1) | Depois (v3.0) | Δ           |
| ------------------------- | ------------ | ------------- | ----------- |
| DriverLifecycleManager.js | 490 linhas   | **0 linhas**  | -490 🎉     |
| factory.js                | 852 linhas   | 950 linhas    | +98         |
| TargetDriver.js           | 200 linhas   | 250 linhas    | +50         |
| driver_nerv_adapter.js    | 1629 linhas  | 1550 linhas   | -79         |
| **TOTAL**                 | 3171 linhas  | 2750 linhas   | **-421** 🚀 |

#### 5. ✅ Alinhamento com Ontologia

**Princípio Original**:

> "Driver deve saber executar a tarefa e devolver a resposta, no momento certo, do jeito certo. O
> driver não precisa necessariamente saber qual é missão, ou saber por que algo está sendo digitado
> ou saber interpretar qualquer coisa"

**Violação Atual**: Driver está **umbilicalmente ligado** a uma tarefa (via LifecycleManager)

**Correção v3.0**: Driver é **agnóstico de task**, apenas executa quando contexto é attached

---

## 📝 PLANO DE IMPLEMENTAÇÃO

### Fase 1: Refatorar TargetDriver (4h)

**Arquivo**: `src/driver/core/TargetDriver.js`

**Mudanças**:

1. Constructor: Remove `page` e `signal` (config apenas)
2. Novo método: `attachContext(page, signal)`
3. Novo método: `detachContext()`
4. Validação: `executeTask()` requer context attached
5. DNA Loading: Lazy (em `attachContext`, não no constructor)

**Breaking Changes**:

- ✅ Todos os drivers herdeiros (ChatGPTDriver, GeminiDriver) herdam automaticamente
- ⚠️ DNA loading precisa ser refatorado (lazy load)

### Fase 2: Refatorar Factory (3h)

**Arquivo**: `src/driver/factory.js`

**Mudanças**:

1. Remove cache WeakMap (não precisa mais)
2. Novo método: `createDriver(target, config)` (sem page/signal)
3. Pool structure: `Map<target, Driver[]>` (drivers IDLE)
4. Método: `acquireFromPool(target)`
5. Método: `releaseToPool(driver)`

**Breaking Changes**:

- ✅ `getDriver()` pode ser mantido como wrapper legacy (deprecated)

### Fase 3: Refatorar Adapter (2h)

**Arquivo**: `src/driver/nerv_adapter/driver_nerv_adapter.js`

**Mudanças**:

1. Remove import de DriverLifecycleManager
2. activeDrivers: `Map<taskId, DriverLifecycleManager>` → `Map<taskId, Driver>`
3. `_executeTask()`: Usa `pool.acquire()` + `attach/detach`
4. Remove `await lifecycleManager.acquire/release()`

**Breaking Changes**:

- ✅ API interna do Adapter muda, mas API NERV (eventos) mantém compatibilidade

### Fase 4: Remover DriverLifecycleManager (30min)

**Arquivo**: `src/driver/DriverLifecycleManager.js`

**Mudanças**:

1. ❌ **DELETE ARQUIVO** (490 linhas removidas)
2. Update imports em todos os arquivos que usam LifecycleManager

**Breaking Changes**:

- ✅ Apenas Adapter usava LifecycleManager (impacto controlado)

### Fase 5: Testes & Documentação (3h)

**Testes**:

1. Test: Driver attach/detach/execute cycle
2. Test: Pool acquire/release (HIT/MISS)
3. Test: Driver reuse (10 tasks → 2 drivers criados)
4. Test: AbortSignal per task (isolation)

**Documentação**:

1. Update: ARCHITECTURE.md (nova hierarquia)
2. Update: CHANGELOG.md (v3.0 - Breaking changes)
3. Create: MIGRATION_GUIDE_V3.md (guia de migração)

---

## 🎯 DECISÃO FINAL

### ✅ Recomendação: **Opção B - Driver Pool Agnóstico de Task**

**Justificativa**:

1. ✅ **API Clara**: 5 métodos simples (create, acquire, attach, execute, detach, release)
2. ✅ **Desacoplamento Total**: Driver não conhece task, só executa quando contexto attached
3. ✅ **Reuse Verdadeiro**: Driver sobrevive a múltiplas tasks (não destruído após cada task)
4. ✅ **Pool Simples**: Drivers IDLE sem "mock page" (hack removido)
5. ✅ **Menos Código**: -421 linhas (remove DriverLifecycleManager)
6. ✅ **Alinhamento Ontológico**: "Driver executa" ≠ "Driver umbilicalmente ligado a task"

**Trade-offs Aceitáveis**:

- ⚠️ Breaking Changes (refatoração de TargetDriver)
- ⚠️ DNA Loading precisa ser lazy (não no constructor)
- ⚠️ Migração de código existente (Adapter)

**Próximo Passo**: Aprovar refatoração arquitetural e iniciar Fase 1

**Aprovador**: @Ilenburg1993 **Status**: 📋 **AGUARDANDO APROVAÇÃO**
