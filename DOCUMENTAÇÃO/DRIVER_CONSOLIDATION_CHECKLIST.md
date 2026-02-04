# 🎯 Driver Consolidation - Checklist Completo

**Data**: 3 de Fevereiro de 2026
**Objetivo**: Consolidar arquitetura pool-ready do Driver System
**Status**: 🔄 Em Andamento

---

## ✅ FASE 1: TargetDriver v3.0 (COMPLETO)

- ✅ Constructor: Remove `page` e `signal` (apenas `config`)
- ✅ Novo estado: `UNATTACHED` (driver sem context)
- ✅ Novo método: `attachContext(page, signal, correlationId)`
- ✅ Novo método: `detachContext()`
- ✅ Novo método: `isContextAttached()`
- ✅ Validação: `execute()` valida context attached antes de executar
- ✅ AbortSignal: Configurado em `attachContext()`, removido em `detachContext()`
- ✅ Destroy: Detach automático antes de destruir
- ✅ State transitions: UNATTACHED ↔ IDLE
- ✅ Telemetria: Eventos `CONTEXT_ATTACHED`, `CONTEXT_DETACHED`

**Arquivo**: `src/driver/core/TargetDriver.js` (v3.0)
**Linhas modificadas**: ~200 linhas
**Breaking Changes**: ✅ Sim - Constructor signature mudou

---

## ✅ FASE 2: Factory v3.0 (COMPLETO)

- ✅ Pool structure: `Map<target, DriverEntry[]>`
- ✅ Novo método: `createDriver(target, config)` - Cria driver UNATTACHED
- ✅ Novo método: `acquireFromPool(target)` - Get IDLE driver (HIT/MISS)
- ✅ Novo método: `releaseToPool(driver)` - Return IDLE driver
- ✅ Novo método: `initializePool()` - Warmup MIN_POOL_SIZE drivers no boot
- ✅ Health checks & GC: Evict drivers idle > 5min
- ✅ Telemetria: Pool HIT/MISS/EXHAUSTED events
- ✅ Metrics: poolHits, poolMisses, poolExhausted, driversReleased, driversEvicted
- ✅ Config: MAX_POOL_SIZE, MIN_POOL_SIZE, IDLE_TIMEOUT_MS, WARMUP_TARGETS
- ✅ Removed: Cache WeakMap (replaced by pool Map)
- ✅ Removed: `getDriver(page, config, signal)` method (deprecated)

**Arquivo**: `src/driver/factory.js` (v3.0)
**Linhas modificadas**: ~850 linhas (reescrita completa)
**Breaking Changes**: ✅ Sim - API completamente diferente

---

## 🔄 FASE 3: Adapter v3.0 (EM ANDAMENTO)

### API Pública (Mantém Simplicidade)

```javascript
// ✅ API EXTERNA (simples - não muda):
const response = await adapter.executeTask(task);
```

### Mudanças Internas

- [ ] **Remove import**: `DriverLifecycleManager` (linha ~10)
- [ ] **Remove import**: Qualquer referência a LifecycleManager
- [ ] **activeDrivers Map**: `Map<taskId, LifecycleManager>` → `Map<taskId, Driver>`
- [ ] **_executeTask()**: Refatorar para usar pool diretamente
  - [ ] Remove: `new DriverLifecycleManager(page, task, config)`
  - [ ] Remove: `await lifecycleManager.acquire()`
  - [ ] Remove: `await lifecycleManager.release()`
  - [ ] Adiciona: `driver = await driverFactory.acquireFromPool(task.spec.target)`
  - [ ] Adiciona: `driver.attachContext(page, signal, correlationId)`
  - [ ] Adiciona: `response = await driver.execute(task.spec.prompt)`
  - [ ] Adiciona: `driver.detachContext()`
  - [ ] Adiciona: `driverFactory.releaseToPool(driver)`
- [ ] **Error handling**: Garantir que driver sempre volta ao pool (finally block)
- [ ] **Telemetria**: Manter eventos NERV (TASK_STARTED, TASK_COMPLETED, etc)
- [ ] **Métricas**: Manter stats (activeDrivers count, etc)

### Pseudocódigo (Novo _executeTask)

```javascript
async _executeTask(task) {
    let driver = null;
    let page = null;
    const signal = new AbortController().signal;

    try {
        // 1. Aloca página do pool
        page = await this.browserPool.allocate(task.spec.target);

        // 2. Acquire driver do pool (IDLE)
        driver = await driverFactory.acquireFromPool(task.spec.target);

        // 3. Attach context (page + signal)
        driver.attachContext(page, signal, task.meta.correlation_id);

        // 4. Registra driver ativo
        this.activeDrivers.set(task.meta.id, driver);

        // 5. Emite TASK_STARTED
        this._emitBoth(ADAPTER_EVENTS.TASK_STARTED, ...);

        // 6. Executa task
        const response = await driver.execute(task.spec.prompt);

        // 7. Emite TASK_COMPLETED
        this._emitBoth(ADAPTER_EVENTS.TASK_COMPLETED, ...);

        return response;

    } catch (error) {
        // Emite TASK_FAILED
        this._emitBoth(ADAPTER_EVENTS.TASK_FAILED, ...);
        throw error;

    } finally {
        // 8. Cleanup (SEMPRE executado)
        this.activeDrivers.delete(task.meta.id);

        if (driver) {
            try {
                // Detach context
                driver.detachContext();

                // Release de volta ao pool
                driverFactory.releaseToPool(driver);
            } catch (cleanupErr) {
                log('WARN', `[Adapter] Cleanup error: ${cleanupErr.message}`);
            }
        }

        if (page) {
            await this.browserPool.release(page);
        }
    }
}
```

**Arquivo**: `src/driver/nerv_adapter/driver_nerv_adapter.js` (v3.0)
**Linhas modificadas**: ~100 linhas (método _executeTask principalmente)
**Breaking Changes**: ❌ Não - API pública mantém compatibilidade

---

## ⏳ FASE 4: Remover DriverLifecycleManager (PENDENTE)

### Ações

- [ ] **DELETE arquivo**: `src/driver/DriverLifecycleManager.js` (490 linhas)
- [ ] **Update imports**: Buscar todos os arquivos que importam LifecycleManager
  - [ ] `src/driver/nerv_adapter/driver_nerv_adapter.js` (já removido na Fase 3)
  - [ ] Outros arquivos? (verificar com grep)
- [ ] **Testes**: Remover testes que usam LifecycleManager diretamente
- [ ] **Documentação**: Update ARCHITECTURE.md (remover referências)

### Verificação

```bash
# Buscar referências a DriverLifecycleManager
grep -r "DriverLifecycleManager" src/ tests/
grep -r "lifecycleManager" src/ tests/
```

**Impacto**: 490 linhas removidas
**Breaking Changes**: ✅ Sim - Mas apenas internamente (API pública não afetada)

---

## ⏳ FASE 5: Drivers Herdeiros (ChatGPT, Gemini) (PENDENTE)

### ⚠️ CRÍTICO: Drivers precisam adaptar constructor

**Antes (v2.0)**:
```javascript
class ChatGPTDriver extends TargetDriver {
    constructor(page, config, signal) {
        super(page, config, signal);
        // ... DNA loading ...
    }
}
```

**Depois (v3.0)**:
```javascript
class ChatGPTDriver extends TargetDriver {
    constructor(config) {
        super(config); // ✅ Apenas config
        // ❌ NÃO carrega DNA aqui (page ainda é null)
    }

    // ✅ DNA loading deve ser lazy (em execute ou attachContext)
    async execute(prompt) {
        if (!this.isContextAttached()) {
            throw new Error('Context not attached');
        }

        // ✅ Carregar DNA se necessário (lazy)
        if (!this.dnaRules) {
            await this._loadDNA();
        }

        // ... execução normal ...
    }
}
```

### Arquivos a Modificar

- [ ] `src/driver/targets/ChatGPTDriver.js` (~2000 linhas)
  - [ ] Constructor: Remove `page`, `signal` parameters
  - [ ] DNA loading: Mover para método lazy (chamado em execute)
  - [ ] Validações: Adicionar `isContextAttached()` no execute
- [ ] `src/driver/targets/GeminiDriver.js` (~1500 linhas)
  - [ ] Mesmas mudanças do ChatGPTDriver
- [ ] Outros drivers? (verificar diretório targets/)

**Breaking Changes**: ✅ Sim - Constructor signature muda

---

## ⏳ FASE 6: Testes (PENDENTE)

### Unit Tests

- [ ] **TargetDriver v3.0**:
  - [ ] `test_targetdriver_attach_detach.js` - Attach/detach cycle
  - [ ] `test_targetdriver_execute_without_context.js` - Erro se não attached
  - [ ] `test_targetdriver_state_transitions.js` - UNATTACHED ↔ IDLE
- [ ] **Factory v3.0**:
  - [ ] `test_factory_pool_acquire_hit.js` - Pool HIT (reuse)
  - [ ] `test_factory_pool_acquire_miss.js` - Pool MISS (create new)
  - [ ] `test_factory_pool_exhausted.js` - Pool EXHAUSTED (all busy)
  - [ ] `test_factory_pool_release.js` - Release to pool
  - [ ] `test_factory_pool_gc.js` - Garbage collection (idle > 5min)
- [ ] **Adapter v3.0**:
  - [ ] `test_adapter_execute_task_pool.js` - Execute com pool
  - [ ] `test_adapter_driver_reuse.js` - Reuse entre tasks

### Integration Tests

- [ ] **Driver Reuse**:
  - [ ] 10 tasks consecutivas → 2-3 drivers criados (67% reuse)
  - [ ] Validar latency: acquire < 20ms (pool HIT)
- [ ] **Pool Exhaustion**:
  - [ ] 6 tasks simultâneas → Pool exhausted error (MAX_POOL_SIZE=5)
- [ ] **Throughput**:
  - [ ] Benchmark: tasks/min antes vs depois
  - [ ] Esperado: +30% throughput (10 → 13 tasks/min)

### Performance Tests

- [ ] **Latency**:
  - [ ] Pool HIT: < 20ms (vs 100ms cache miss)
  - [ ] Pool MISS: ~150ms (lazy-load + DNA)
- [ ] **Memory**:
  - [ ] Pool overhead: +50MB (5 warm drivers @ 10MB each)
  - [ ] Acceptable: < 100MB total overhead

**Diretório**: `tests/driver/` (criar estrutura)

---

## ⏳ FASE 7: Documentação (PENDENTE)

### Atualizar Documentação Existente

- [ ] **ARCHITECTURE.md**: Update hierarquia (remove LifecycleManager)
  - [ ] Seção "Driver System" (linhas ~200-400)
  - [ ] Diagrams: Atualizar para mostrar Pool
  - [ ] Responsabilidades: Clarificar Factory vs Adapter
- [ ] **DRIVER_CONSOLIDATION_PLAN.md**: Marcar Fase 2 como COMPLETA
- [ ] **DRIVER_POOL_ARCHITECTURE_DECISION.md**: Update status para IMPLEMENTED

### Criar Documentação Nova

- [ ] **MIGRATION_GUIDE_V3.md**: Guia de migração v2.0 → v3.0
  - [ ] Breaking changes detalhados
  - [ ] Code examples (antes vs depois)
  - [ ] Checklist de migração para cada componente
- [ ] **CHANGELOG.md v3.0**: Entrada completa
  - [ ] **Breaking Changes**: Constructor signatures, API removida
  - [ ] **Added**: Pool management, attach/detach, warmup
  - [ ] **Changed**: Factory API, Adapter internals
  - [ ] **Removed**: DriverLifecycleManager, cache WeakMap
  - [ ] **Fixed**: P1 bugs (AbortSignal, Error emission)
  - [ ] **Performance**: +30% throughput, -90% latency

### API Documentation

- [ ] **API_REFERENCE.md**: Documentar API pública v3.0
  - [ ] `adapter.executeTask(task)` - API principal
  - [ ] `factory.acquireFromPool(target)` - Para uso avançado
  - [ ] `factory.releaseToPool(driver)` - Para uso avançado
  - [ ] `driver.attachContext(page, signal)` - Para uso avançado
  - [ ] `driver.execute(prompt)` - Core method

---

## 📊 MÉTRICAS DE SUCESSO

### Performance

- [ ] **Latency**: Pool HIT < 20ms (atual: 100ms cache miss) → **-80%**
- [ ] **Throughput**: 13 tasks/min (atual: 10 tasks/min) → **+30%**
- [ ] **Reuse Rate**: 67% (atual: 0%) → **+67pp**

### Code Quality

- [ ] **Linhas de código**: -421 linhas (remove LifecycleManager)
- [ ] **Complexity**: 3 camadas → 2 camadas (remove LifecycleManager)
- [ ] **API Clarity**: 1 método público (`executeTask`)

### Reliability

- [ ] **Tests**: 100% coverage em TargetDriver, Factory, Adapter
- [ ] **Error Handling**: Zero memory leaks (pool cleanup garantido)
- [ ] **Telemetria**: 100% coverage (todos os eventos emitidos)

---

## 🚨 RISCOS & MITIGAÇÕES

### Risco 1: Drivers Herdeiros Quebram

**Problema**: ChatGPTDriver, GeminiDriver usam constructor(page, config, signal)
**Impacto**: ❌ Sistema não inicia (constructor mismatch)
**Mitigação**:
- ✅ Criar wrapper temporário em TargetDriver v3.0 (backward compat)
- ✅ Migrar drivers um por um
- ✅ Remover wrapper após migração completa

### Risco 2: DNA Loading Falha (Lazy)

**Problema**: DNA carregado no constructor (page existe), agora page=null
**Impacto**: ⚠️ DNA não carrega, execute() falha
**Mitigação**:
- ✅ Mover DNA loading para método lazy (chamado em execute)
- ✅ Cache DNA rules (não recarregar a cada execute)
- ✅ Validar DNA loaded antes de executar

### Risco 3: Pool Exhaustion Frequente

**Problema**: MAX_POOL_SIZE=5 pode ser insuficiente sob carga
**Impacto**: ⚠️ Tasks falham com POOL_EXHAUSTED
**Mitigação**:
- ✅ Config via env vars (DRIVER_POOL_MAX_SIZE)
- ✅ Telemetria: Alert se poolExhausted > 5% das requests
- ✅ Auto-scale: Aumentar MAX_POOL_SIZE dinamicamente (futuro)

### Risco 4: Memory Leak (Pool)

**Problema**: Drivers não destruídos, pool cresce indefinidamente
**Impacto**: ❌ OOM (Out of Memory)
**Mitigação**:
- ✅ Health checks & GC (evict idle > 5min)
- ✅ MAX_POOL_SIZE hard limit
- ✅ Monitoring: Alert se pool size > MAX_POOL_SIZE * 1.5

---

## 📅 CRONOGRAMA CONSOLIDADO

### Já Completo (8h)

- ✅ **Fase 1**: TargetDriver v3.0 (4h) - COMPLETO
- ✅ **Fase 2**: Factory v3.0 (4h) - COMPLETO

### Em Andamento (2h)

- 🔄 **Fase 3**: Adapter v3.0 (2h) - **EM ANDAMENTO**

### Pendente (12h)

- ⏳ **Fase 4**: Remover DriverLifecycleManager (30min)
- ⏳ **Fase 5**: Drivers Herdeiros (ChatGPT, Gemini) (4h)
- ⏳ **Fase 6**: Testes (Unit + Integration) (4h)
- ⏳ **Fase 7**: Documentação (CHANGELOG, MIGRATION_GUIDE) (3h)

**Total Estimado**: 22h (8h completo, 14h restante)
**Status**: 36% completo (8/22h)

---

## ✅ PRÓXIMOS PASSOS IMEDIATOS

1. ✅ **Continuar Fase 3**: Refatorar Adapter._executeTask() (30min)
2. ✅ **Testar Adapter**: Validar sintaxe + basic execution (15min)
3. ✅ **Fase 4**: Remover DriverLifecycleManager (30min)
4. ⏳ **Fase 5**: Adaptar ChatGPTDriver constructor (2h)
5. ⏳ **Testes básicos**: Smoke tests para validar integração (1h)

---

**Última Atualização**: 3 Fev 2026 - Fases 1-2 completas, Fase 3 em andamento
**Responsável**: Sistema autônomo de consolidação
**Aprovação**: @Ilenburg1993
