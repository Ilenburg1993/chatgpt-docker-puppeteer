# 🏗️ Driver Pool - Decisão Arquitetural

**Data**: 3 de Fevereiro de 2026
**Decisão**: ✅ **Evoluir Factory.js para DriverFactory com Pool** (NÃO criar arquivo novo)
**Status**: 📋 Planejamento Completo

---

## 🎯 PERGUNTA FUNDAMENTAL

**"Devo criar DriverPoolManager.js OU evoluir factory.js existente?"**

---

## 📊 ANÁLISE DE OPÇÕES

### Opção 1: ❌ Novo Arquivo `DriverPoolManager.js`

**Estrutura Proposta**:
```
src/driver/
├── factory.js              (mantém lazy-load + discovery)
├── driver_pool_manager.js  (NOVO - pool management)
└── nerv_adapter/
    └── driver_nerv_adapter.js (usa DriverPoolManager)
```

**Prós**:
- ✅ Separação clara de responsabilidades (Factory vs Pool)
- ✅ Código novo não afeta factory existente
- ✅ Facilita testes isolados de pool

**Contras**:
- ❌ **Duplicação**: Pool precisa de discovery (já existe em Factory)
- ❌ **Acoplamento**: DriverNERVAdapter precisa conhecer 2 componentes (Factory + Pool)
- ❌ **Overhead**: 2 caches (Factory WeakMap + Pool Map) → conflito de responsabilidades
- ❌ **Confusão**: "Quando usar Factory.getDriver() vs DriverPool.acquire()?"
- ❌ **Complexidade**: Adiciona +1 camada desnecessária

**Violação de Princípios**:
```
❌ SOLID - Violação do Princípio de Responsabilidade Única (SRP)
   Factory cria, Pool gerencia → Ambos manipulam mesma entidade (Driver)
   Isso cria OVERLAP de responsabilidades

❌ DRY - Don't Repeat Yourself
   Discovery repetido, cache management duplicado
```

---

### Opção 2: ✅ **Evoluir `factory.js` para DriverFactory com Pool**

**Estrutura Proposta**:
```
src/driver/
├── factory.js → Evolui para DriverFactory v3.0
│   ├── Discovery (mantém)
│   ├── Lazy-load (mantém)
│   ├── Cache WeakMap (mantém)
│   └── Pool Management (NOVO - warm instances)
└── nerv_adapter/
    └── driver_nerv_adapter.js (usa Factory.acquireFromPool())
```

**Prós**:
- ✅ **Single Source of Truth**: Factory é O componente de lifecycle de drivers
- ✅ **Evolução Natural**: Cache → Pool é extensão lógica (não ruptura)
- ✅ **Zero Duplicação**: Discovery, lazy-load, registry compartilhados
- ✅ **API Consistente**: `factory.getDriver()` (cache) vs `factory.acquireFromPool()` (pool)
- ✅ **Menos Acoplamento**: Adapter só conhece 1 componente (Factory)
- ✅ **Backward Compatible**: Código existente continua funcionando

**Contras**:
- ⚠️ **Tamanho do Arquivo**: factory.js cresce ~300 linhas (de 850 → 1150 linhas)
  - **Mitigação**: Ainda é razoável (< 1500 linhas), bem estruturado em seções
- ⚠️ **Complexidade Interna**: Factory tem 2 modos (cache + pool)
  - **Mitigação**: Separação clara via métodos distintos (`getDriver` vs `acquireFromPool`)

**Alinhamento com Princípios**:
```
✅ SOLID - Responsabilidade Única (SRP)
   Factory: "Gerenciar instâncias de Driver (criar, cachear, poolizar, destruir)"
   Pool é PARTE dessa responsabilidade, não uma responsabilidade separada

✅ DRY - Don't Repeat Yourself
   Reusa discovery, lazy-load, registry existente

✅ KISS - Keep It Simple, Stupid
   1 componente, 1 API, 0 confusão

✅ YAGNI - You Aren't Gonna Need It
   Não adiciona abstração prematura (DriverPool como entidade separada)
```

---

### Opção 3: ❌ Integrar em `driver_nerv_adapter.js`

**Estrutura Proposta**:
```
src/driver/nerv_adapter/
└── driver_nerv_adapter.js
    ├── activeDrivers Map (já existe)
    └── Pool Management (NOVO - integrado)
```

**Prós**:
- ✅ Adapter já tem Map de drivers ativos (activeDrivers)
- ✅ Centraliza gerenciamento de lifecycle em 1 lugar

**Contras**:
- ❌ **Violação Ontológica**: Adapter é NERV bridge, não gerenciador de instâncias
- ❌ **Responsabilidade Excessiva**: Adapter faria NERV + Pool + Telemetria
- ❌ **Acoplamento Ruim**: Factory perderia controle sobre instâncias que criou
- ❌ **Confusão de Domínios**: activeDrivers é "drivers em uso", não "pool de warm drivers"

**Violação de Princípios**:
```
❌ Separação de Responsabilidades (SoC)
   Adapter = NERV bridge (comunicação)
   Pool = Instance management (criação/destruição)

❌ Single Responsibility Principle (SRP)
   Adapter teria 3 responsabilidades:
   1. NERV communication
   2. Telemetria
   3. Pool management
```

---

## ✅ DECISÃO FINAL: Opção 2

### **Evoluir factory.js para DriverFactory v3.0 com Pool Management**

**Justificativa Técnica**:
1. **Responsabilidade Natural**: Factory JÁ gerencia instâncias de drivers
   - Create (lazy-load)
   - Cache (WeakMap)
   - **Pool (warm instances)** ← Extensão lógica

2. **Zero Duplicação**: Reusa 100% da infraestrutura existente
   - Discovery (registry)
   - Lazy-load (require com timeout)
   - Validation (destroyed check)
   - Telemetria (FACTORY_EVENTS)

3. **API Clara e Consistente**:
   ```javascript
   // Modo 1: Cache (stateless, attached to page)
   const driver = factory.getDriver(target, page, config, signal);

   // Modo 2: Pool (stateful, warm instance)
   const driver = await factory.acquireFromPool(target, page, signal);
   await factory.releaseToPool(driver);
   ```

4. **Backward Compatible**: Código existente (MissionManager, Kernel) continua funcionando
   - `getDriver()` mantém comportamento atual (cache)
   - `acquireFromPool()` é opt-in para novo fluxo

5. **Alinhamento com Filosofia do Sistema**:
   - **Factory = Lifecycle Manager** (ontologia clara) - Cria, cacheia, pooliza
   - **DriverLifecycleManager = Orchestrator por Tarefa** - Acquire, inject signal, release
   - **Adapter = Communication Bridge** (não gerencia instâncias) - NERV events
   - **Driver = Task Executor** (não sabe de pool) - Executa, retorna response

---

## 🏗️ PLANEJAMENTO DETALHADO

### Fase 1: Adicionar Pool Structure (30min)

**Arquivo**: `src/driver/factory.js`
**Linhas**: +150 linhas

**Mudanças**:
1. **POOL_CONFIG** (novo):
   ```javascript
   const POOL_CONFIG = {
       MAX_POOL_SIZE: 5,          // Máximo de drivers no pool
       MIN_POOL_SIZE: 2,          // Mínimo de drivers (warm start)
       IDLE_TIMEOUT_MS: 300000,   // 5min idle → eviction
       WARMUP_TARGETS: ['chatgpt', 'gemini'],
       HEALTH_CHECK_INTERVAL_MS: 30000
   };
   ```

2. **Novo atributo no constructor**:
   ```javascript
   constructor() {
       // ... código existente ...

       /**
        * Pool de drivers warm (sem page attached).
        * Estrutura: Map<target, DriverEntry[]>
        *
        * DriverEntry: {
        *   driver: TargetDriver,
        *   target: string,
        *   busy: boolean,
        *   createdAt: number,
        *   lastUsedAt: number,
        *   totalUses: number
        * }
        */
       this.pool = new Map();

       // Initialize pools para cada target
       for (const target of POOL_CONFIG.WARMUP_TARGETS) {
           this.pool.set(target, []);
       }
   }
   ```

3. **Novo método: `initializePool()`** (chamado após discovery)
   ```javascript
   async initializePool() {
       log('INFO', '[FACTORY] Initializing driver pool...');

       for (const target of POOL_CONFIG.WARMUP_TARGETS) {
           // Cria MIN_POOL_SIZE drivers warm para cada target
           for (let i = 0; i < POOL_CONFIG.MIN_POOL_SIZE; i++) {
               const warmDriver = await this._createWarmDriver(target);
               this.pool.get(target).push({
                   driver: warmDriver,
                   target,
                   busy: false,
                   createdAt: Date.now(),
                   lastUsedAt: null,
                   totalUses: 0
               });
           }
       }

       log('INFO', `[FACTORY] Pool initialized: ${this._getPoolSize()} warm drivers`);
   }
   ```

---

### Fase 2: Criar Warm Drivers (1h)

**Novo método: `_createWarmDriver(target)`**

**Desafio**: Como criar driver SEM page?

**Solução 1** (Preferida): **Mock Page Object**
```javascript
async _createWarmDriver(target) {
    // Cria mock page (não é Puppeteer page real)
    const mockPage = {
        url: () => 'about:blank',
        isClosed: () => false,
        _isWarmMock: true  // Flag para detectar
    };

    // Driver criado com mock page
    const driver = this.getDriver(target, mockPage, { warmInstance: true }, new AbortController().signal);

    // Driver em estado IDLE (ready para attach real page)
    driver.setState('IDLE');

    return driver;
}
```

**Solução 2** (Alternativa): **Modificar TargetDriver para aceitar null page**
```javascript
// Em TargetDriver.js constructor:
constructor(page, config, signal) {
    super();

    // ✅ Permite null page para warm instances
    this.page = page || null;  // ← Mudança aqui

    // ... resto do constructor ...
}
```

**Decisão**: **Solução 1 (Mock Page)** é preferível porque:
- ✅ Não modifica TargetDriver (menos risco)
- ✅ Validações de `page.isClosed()` continuam funcionando
- ✅ Mais fácil de debugar (mock é explícito)

---

### Fase 3: Acquire/Release from Pool (1h)

**Novo método: `acquireFromPool(target, realPage, signal)`**

```javascript
/**
 * Adquire driver do pool (warm instance).
 * Se pool vazio, cria novo temporariamente.
 *
 * @param {string} target - Target name
 * @param {Page} realPage - Real Puppeteer page
 * @param {AbortSignal} signal - Abort signal
 *
 * @returns {TargetDriver} Driver pronto para uso
 *
 * @throws {Error} Se pool exhausted
 */
async acquireFromPool(target, realPage, signal) {
    const pool = this.pool.get(target);

    if (!pool) {
        throw new Error(`[FACTORY] Invalid target: ${target}`);
    }

    // 1. Busca driver disponível (não busy)
    let entry = pool.find(e => !e.busy && e.driver.state === 'IDLE');

    if (entry) {
        // Pool HIT - reusa warm driver
        this.metrics.poolHits++;
        log('DEBUG', `[FACTORY] Pool HIT: Reusing warm driver for ${target}`);
    } else {
        // Pool MISS - cria novo ou aguarda
        this.metrics.poolMisses++;

        if (pool.length < POOL_CONFIG.MAX_POOL_SIZE) {
            log('DEBUG', `[FACTORY] Pool MISS: Creating new driver for ${target}`);

            const warmDriver = await this._createWarmDriver(target);
            entry = {
                driver: warmDriver,
                target,
                busy: false,
                createdAt: Date.now(),
                lastUsedAt: null,
                totalUses: 0
            };
            pool.push(entry);
        } else {
            throw new Error(`[FACTORY] POOL_EXHAUSTED: All ${POOL_CONFIG.MAX_POOL_SIZE} drivers for ${target} are busy`);
        }
    }

    // 2. Marca como busy
    entry.busy = true;
    entry.lastUsedAt = Date.now();
    entry.totalUses++;

    // 3. Attach real page + signal (troca mock → real)
    entry.driver.page = realPage;
    entry.driver.signal = signal;

    // 4. Valida estado
    if (entry.driver.destroyed) {
        throw new Error(`[FACTORY] Driver was destroyed (should not happen)`);
    }

    log('DEBUG', `[FACTORY] Acquired driver: ${target} (uses: ${entry.totalUses})`);

    return entry.driver;
}
```

**Novo método: `releaseToPool(driver)`**

```javascript
/**
 * Libera driver de volta ao pool (warm novamente).
 *
 * @param {TargetDriver} driver - Driver para liberar
 *
 * @returns {void}
 */
releaseToPool(driver) {
    // 1. Encontra entry no pool
    let entry = null;
    let pool = null;

    for (const [target, targetPool] of this.pool.entries()) {
        entry = targetPool.find(e => e.driver === driver);
        if (entry) {
            pool = targetPool;
            break;
        }
    }

    if (!entry) {
        log('WARN', `[FACTORY] Driver not found in pool (might be temporary)`);
        driver.destroy();
        return;
    }

    // 2. Detach page + signal (volta para mock)
    const mockPage = {
        url: () => 'about:blank',
        isClosed: () => false,
        _isWarmMock: true
    };
    driver.page = mockPage;
    driver.signal = null;

    // 3. Reset estado para IDLE
    driver.setState('IDLE');

    // 4. Marca como disponível
    entry.busy = false;

    log('DEBUG', `[FACTORY] Released driver: ${entry.target} (idle again)`);

    this.emit(FACTORY_EVENTS.DRIVER_REUSED, {
        target: entry.target,
        totalUses: entry.totalUses
    });
}
```

---

### Fase 4: Health Checks & Garbage Collection (30min)

**Novo método: `_startPoolHealthChecks()`**

```javascript
_startPoolHealthChecks() {
    this.poolHealthTimer = setInterval(() => {
        for (const [target, pool] of this.pool.entries()) {
            const now = Date.now();

            // Remove drivers idle por muito tempo (se pool > MIN)
            for (let i = pool.length - 1; i >= 0; i--) {
                const entry = pool[i];

                const idleTime = now - (entry.lastUsedAt || entry.createdAt);
                const shouldRemove = !entry.busy &&
                                    idleTime > POOL_CONFIG.IDLE_TIMEOUT_MS &&
                                    pool.length > POOL_CONFIG.MIN_POOL_SIZE;

                if (shouldRemove) {
                    log('DEBUG', `[FACTORY] Removing idle driver: ${target} (idle: ${idleTime}ms)`);

                    // Destrói driver
                    entry.driver.destroy();

                    // Remove do pool
                    pool.splice(i, 1);

                    this.metrics.driversDestroyed++;
                }
            }
        }
    }, POOL_CONFIG.HEALTH_CHECK_INTERVAL_MS);
}
```

---

### Fase 5: Integração com DriverLifecycleManager (30min)

**⚠️ DECISÃO ARQUITETURAL**: Pool integration acontece no **DriverLifecycleManager**, NÃO no Adapter.

**Razão**: DriverLifecycleManager JÁ é responsável por acquire/release drivers via Factory.

**Arquitetura**:
```
DriverNERVAdapter
  └─> DriverLifecycleManager
       ├─> acquire() → Factory.acquireFromPool()  ← POOL
       └─> release() → Factory.releaseToPool()    ← POOL
```

**Arquivo**: `src/driver/DriverLifecycleManager.js`

**Mudanças no método `acquire()` (linha 148)**:

```javascript
// ANTES (v2.1 - Cache):
this.driver = driverFactory.getDriver(
    this.task.spec.target,
    this.page,
    this.config,
    this.abortController.signal
);

// DEPOIS (v3.0 - Pool):
this.driver = await driverFactory.acquireFromPool(
    this.task.spec.target,
    this.page,
    this.abortController.signal
);

// ✅ Retry logic continua funcionando (envolve acquireFromPool)
// ✅ Telemetria continua funcionando (lifecycle:acquired event)
// ✅ Timeout protection continua funcionando (ACQUIRE_TIMEOUT_MS)
```

**Mudanças no método `release()` (linha 275)**:

```javascript
// ANTES (v2.1 - Cache):
if (this.driver) {
    // ... removeListener ...

    const destroyPromise = this.driver.destroy().catch(err => {
        log('WARN', `[LIFECYCLE] Erro no descarte do driver: ${err.message}`, this.correlationId);
    });

    // Timeout de 5s para prevenir hang
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Driver destroy timeout')), LIFECYCLE_CONFIG.DESTROY_TIMEOUT_MS);
    });

    await Promise.race([destroyPromise, timeoutPromise]).catch(err => {
        log('ERROR', `[LIFECYCLE] Destroy timeout ou erro: ${err.message}`, this.correlationId);
    });
}

// DEPOIS (v3.0 - Pool):
if (this.driver) {
    // ... removeListener ...

    // ✅ Pool-aware release (não destrói, volta para pool)
    try {
        driverFactory.releaseToPool(this.driver);
        log('DEBUG', `[LIFECYCLE] Driver released to pool (warm)`, this.correlationId);
    } catch (err) {
        // Fallback: Se pool rejeita (driver inválido), destrói
        log('WARN', `[LIFECYCLE] Pool release failed, destroying driver: ${err.message}`, this.correlationId);
        await this.driver.destroy().catch(destroyErr => {
            log('ERROR', `[LIFECYCLE] Destroy fallback error: ${destroyErr.message}`, this.correlationId);
        });
    }
}
```

**⚠️ MUDANÇA NO ADAPTER**: Adapter NÃO modifica (continua chamando lifecycleManager.acquire/release)

---

## 📊 MÉTRICAS DE SUCESSO

### Antes (v2.1 - Cache Only)

| Métrica              | Valor                        |
| -------------------- | ---------------------------- |
| Acquire Latency      | 100ms (cache miss)           |
| Driver Creation Time | 150ms (lazy-load + DNA load) |
| Throughput           | 10 tasks/min                 |
| Driver Reuse         | 0% (sempre cria novo)        |
| Memory Overhead      | Baixo (GC automático)        |

### Depois (v3.0 - Pool + Cache)

| Métrica              | Valor Esperado              |
| -------------------- | --------------------------- |
| Acquire Latency      | **10ms (-90%)** (pool hit)  |
| Driver Creation Time | 150ms (inalterado - boot)   |
| Throughput           | **13 tasks/min (+30%)**     |
| Driver Reuse         | **80%** (4/5 tasks reusam)  |
| Memory Overhead      | Médio (pool warm instances) |

### Trade-offs

**Custos**:
- ✅ **Memória**: +50MB (5 warm drivers @ 10MB cada)
  - **Aceitável**: Memória é barata, latência é cara
- ✅ **Complexidade**: +300 linhas em factory.js
  - **Aceitável**: Bem estruturado, separado em métodos claros

**Benefícios**:
- ✅ **Latência**: -90% em acquire (100ms → 10ms)
- ✅ **Throughput**: +30% (10 → 13 tasks/min)
- ✅ **UX**: Tasks começam 90ms mais rápido
- ✅ **Escala**: Pool permite 5 tasks simultâneas vs 1 no cache

---

## 🧪 PLANO DE TESTES

### Teste 1: Pool Initialization
```bash
# Scenario: Boot com pool warmup
node tests/integration/test_driver_pool_init.js

# Expected:
# - 2 warm drivers criados para chatgpt
# - 2 warm drivers criados para gemini
# - Drivers em estado IDLE
# - Mock page attached
```

### Teste 2: Acquire from Pool (HIT)
```bash
# Scenario: Acquire driver de pool não vazio
node tests/performance/test_pool_acquire_hit.js

# Expected:
# - Latência < 20ms
# - Driver busy = true
# - Real page attached
# - Signal attached
```

### Teste 3: Acquire from Pool (MISS → Create)
```bash
# Scenario: Pool vazio, cria novo driver
node tests/performance/test_pool_acquire_miss.js

# Expected:
# - Novo driver criado
# - Adicionado ao pool
# - Latência ~150ms (lazy-load)
```

### Teste 4: Release to Pool
```bash
# Scenario: Libera driver de volta ao pool
node tests/integration/test_pool_release.js

# Expected:
# - Driver busy = false
# - Mock page re-attached
# - Signal = null
# - Estado = IDLE
```

### Teste 5: Pool Exhaustion
```bash
# Scenario: Todos os drivers busy
node tests/reliability/test_pool_exhausted.js

# Expected:
# - Error: POOL_EXHAUSTED
# - Adapter faz fallback para cache OU aguarda release
```

### Teste 6: Garbage Collection
```bash
# Scenario: Driver idle por > 5min
node tests/integration/test_pool_gc.js

# Expected:
# - Driver evictado do pool
# - Pool size reduz para MIN_POOL_SIZE
# - Memory freed
```

---

## 📅 CRONOGRAMA IMPLEMENTAÇÃO

### Dia 1 (Manhã - 4h)
- ✅ Fase 1: Pool structure em factory.js (30min)
- ✅ Fase 2: Warm drivers com mock page (1h)
- ✅ Fase 3: Acquire/Release em factory.js (1h)
- ✅ Fase 4: Health checks & GC (30min)
- ✅ Testes unitários básicos (1h)

### Dia 1 (Tarde - 4h)
- ✅ Fase 5: Integração em DriverLifecycleManager (30min) ← **MUDANÇA AQUI**
- ✅ Testes de integração (2h)
- ✅ Benchmarks (antes/depois) (1h)
- ✅ Documentação + CHANGELOG (30min)

**Total**: 8h (1 dia de trabalho)

---

## ✅ CONCLUSÃO

### Decisão Arquitetural: **Evoluir factory.js para v3.0 com Pool**

**Razões**:
1. ✅ **Responsabilidade Natural**: Factory gerencia instâncias (cache + pool são parte dessa responsabilidade)
2. ✅ **Zero Duplicação**: Reusa discovery, lazy-load, registry existente
3. ✅ **API Clara**: `getDriver()` (cache) vs `acquireFromPool()` (pool)
4. ✅ **Backward Compatible**: Código existente continua funcionando
5. ✅ **Alinhamento SOLID**: Single Responsibility (Factory = Instance Lifecycle)

**Próximo Passo**: Implementar Fase 1 (Pool Structure)

**Aprovador**: @Ilenburg1993
**Status**: 📋 **AGUARDANDO APROVAÇÃO PARA IMPLEMENTAÇÃO**
