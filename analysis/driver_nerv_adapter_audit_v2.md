# driver_nerv_adapter.js - Análise v2.0

**Data**: 2026-02-01
**Arquivo**: `src/driver/nerv_adapter/driver_nerv_adapter.js`
**Versão Atual**: v1.1 (415 linhas)
**Audit Level**: 800 — Critical Decoupling Layer

---

## 📋 RESUMO EXECUTIVO

### Responsabilidade
**Adapter crítico** que conecta NERV (pub/sub IPC) ao domínio DRIVER. Gerencia instâncias de DriverLifecycleManager, escuta COMMANDS do KERNEL, emite EVENTS de telemetria. **Zero acoplamento direto** com outros subsistemas.

### Hierarquia na Arquitetura
```
KERNEL
  ↓ (NERV commands)
DriverNERVAdapter v1.1 (415 linhas) ← ESTE ARQUIVO
  ↓ (creates/manages)
DriverLifecycleManager v2.0 (483 linhas)
  ↓ (uses)
factory.js v2.0 (791 linhas)
  ↓ (creates)
ChatGPTDriver v2.0 (693 linhas)
  ↓ (extends)
BaseDriver v2.0 (678 linhas)
  ↓ (extends)
TargetDriver v2.0 (658 linhas)
```

### Estado Atual
- **Tipo**: Class (non-EventEmitter)
- **Linhas**: 415 (v1.1)
- **Métodos Públicos**: 4 (shutdown, getStats, constructor, _handleDriverCommand)
- **Métodos Privados**: 6
- **Eventos Emitidos**: 0 (usa HighLevelNERV.sendEvent)
- **Validações**: 5 (básicas)
- **Try-Catch**: 4 blocos
- **JSDoc**: Parcial (~30%)

### Métricas de Qualidade
| Métrica                  | Status    | Nota |
| ------------------------ | --------- | ---- |
| EventEmitter Inheritance | ❌ Não     | 3/10 |
| Constants Centralizados  | ⚠️ Parcial | 6/10 |
| JSDoc Completo           | ⚠️ Parcial | 5/10 |
| Validações Robustas      | ⚠️ Básico  | 6/10 |
| Error Recovery           | ⚠️ Básico  | 6/10 |
| Telemetria               | ✅ NERV    | 8/10 |
| Health Check             | ✅ Sim     | 7/10 |
| Metrics                  | ✅ Sim     | 7/10 |
| Timeout Protection       | ❌ Não     | 4/10 |

---

## 🐛 BUGS IDENTIFICADOS (8 Total)

### BUG #1: Classe Não Herda EventEmitter - CRÍTICO (P0)
**Severidade**: P0 (Inconsistência arquitetural)
**Linha**: 29
**Impacto**: Adapter não segue padrão v2.0 de EventEmitter. Não pode emitir eventos locais.

**Código Atual**:
```javascript
class DriverNERVAdapter {
    constructor(nerv, browserPool, config) {
        // ...
    }
}
```

**Problema**:
- Não herda EventEmitter (inconsistente com TargetDriver v2.0, BaseDriver v2.0, ChatGPTDriver v2.0, DriverLifecycleManager v2.0, factory v2.0)
- Não pode emitir eventos locais (só via NERV)
- Não pode ser escutado localmente (server, monitoring)
- Viola padrão arquitetural v2.0

**Solução Proposta**:
```javascript
const EventEmitter = require('events');

class DriverNERVAdapter extends EventEmitter {
    constructor(nerv, browserPool, config) {
        super(); // ✅ EventEmitter constructor

        if (!nerv) {
            throw new Error('[DriverNERVAdapter] NERV instance required');
        }

        // ...
    }

    // ✅ Emitir eventos locais + NERV
    _emitLocalEvent(eventName, data) {
        this.emit(eventName, data); // Local
        // NERV emit também (duplo canal)
    }
}
```

**Benefícios**:
- Consistência arquitetural (100% dos módulos v2.0 herdam EventEmitter)
- Duplo canal (local + NERV)
- Pode ser escutado por server/monitoring
- Suporta EventEmitter API (on, once, off)

---

### BUG #2: Faltam ADAPTER_CONFIG e ADAPTER_EVENTS - ALTO (P1)
**Severidade**: P1 (Magic numbers e strings)
**Linhas**: 0 (não existe)
**Impacto**: Magic numbers em timeout, magic strings em eventos.

**Código Atual**:
```javascript
// ❌ Nenhuma constante de config
class DriverNERVAdapter {
    constructor(nerv, browserPool, config) {
        this.nerv = nerv;
        this.browserPool = browserPool;
        this.config = config; // ❌ Config geral, não específico de adapter
        this.degradedMode = !browserPool;
        this.activeDrivers = new Map();
        this.stats = { // ❌ Hardcoded structure
            tasksExecuted: 0,
            tasksAborted: 0,
            driversCrashed: 0,
            vitalsEmitted: 0
        };
    }
}

// ❌ Uso de ActionCode diretamente (não local)
this._emitEvent(ActionCode.DRIVER_TASK_STARTED, { ... });
```

**Problema**:
- Nenhum timeout configurável (executeTask, shutdown, health check)
- Nenhuma constante ADAPTER_CONFIG
- Nenhuma constante ADAPTER_EVENTS (local events)
- ActionCode importado de shared (correto para NERV, mas falta eventos locais)
- Stats structure hardcoded

**Solução Proposta**:
```javascript
// ✅ ADAPTER_CONFIG
const ADAPTER_CONFIG = {
    EXECUTE_TASK_TIMEOUT_MS: process.env.ADAPTER_EXECUTE_TIMEOUT || 300000, // 5min
    SHUTDOWN_TIMEOUT_MS: process.env.ADAPTER_SHUTDOWN_TIMEOUT || 30000, // 30s
    HEALTH_CHECK_INTERVAL_MS: process.env.ADAPTER_HEALTH_INTERVAL || 60000, // 1min
    MAX_ACTIVE_DRIVERS: process.env.ADAPTER_MAX_DRIVERS || 10,
    TELEMETRY_BUFFER_SIZE: 1000,
    DEGRADED_MODE_WARNING_INTERVAL_MS: 60000 // 1min
};

// ✅ ADAPTER_EVENTS (local EventEmitter events)
const ADAPTER_EVENTS = {
    TASK_STARTED: 'adapter:task_started',
    TASK_COMPLETED: 'adapter:task_completed',
    TASK_FAILED: 'adapter:task_failed',
    TASK_ABORTED: 'adapter:task_aborted',
    DRIVER_ATTACHED: 'adapter:driver_attached',
    DRIVER_DETACHED: 'adapter:driver_detached',
    HEALTH_CHECK: 'adapter:health_check',
    ERROR: 'adapter:error',
    DEGRADED_MODE: 'adapter:degraded_mode',
    SHUTDOWN: 'adapter:shutdown'
};
```

**Benefícios**:
- Zero magic numbers
- Config via env vars
- Eventos locais documentados
- Duplo canal (local events + NERV commands)

---

### BUG #3: _executeTask Sem Timeout Protection - ALTO (P1)
**Severidade**: P1 (Hang possível)
**Linha**: 193-265
**Impacto**: Task pode hang indefinidamente (driver.execute sem timeout).

**Código Atual**:
```javascript
async _executeTask(payload, correlationId) {
    // ...
    try {
        // 2. Aloca página do pool
        page = await this.browserPool.allocate(task.spec.target); // ❌ Sem timeout

        // 3. Cria DriverLifecycleManager
        lifecycleManager = new DriverLifecycleManager(page, task, this.config);
        this.activeDrivers.set(taskId, lifecycleManager);

        // 4. Adquire driver da Factory
        const driver = await lifecycleManager.acquire(); // ❌ Sem timeout

        // 7. Executa a tarefa
        const result = await driver.execute(task.spec.prompt); // ❌ Sem timeout

        // 8. Emite evento de conclusão
        this._emitEvent(ActionCode.DRIVER_TASK_COMPLETED, { ... });

    } catch (error) {
        // ...
    } finally {
        // 9. Libera recursos
        if (lifecycleManager) {
            await lifecycleManager.release(); // ❌ Sem timeout
        }

        if (page) {
            await this.browserPool.release(page); // ❌ Sem timeout
        }
    }
}
```

**Problema**:
- `driver.execute()` pode hang indefinidamente
- `lifecycleManager.acquire()` pode hang se factory falhar
- `browserPool.allocate()` pode hang se pool travado
- `lifecycleManager.release()` pode hang
- Nenhum timeout em nenhuma fase

**Solução Proposta**:
```javascript
async _executeTask(payload, correlationId) {
    const { task } = payload;
    const taskId = task.meta.id;

    let page = null;
    let lifecycleManager = null;
    let timeoutHandle = null;

    try {
        // ✅ Timeout wrapper para toda execução
        const executePromise = (async () => {
            // Fase 1: Allocate (com timeout)
            page = await Promise.race([
                this.browserPool.allocate(task.spec.target),
                this._timeout(ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS, 'browserPool.allocate')
            ]);

            // Fase 2: Acquire driver (com timeout)
            lifecycleManager = new DriverLifecycleManager(page, task, this.config);
            this.activeDrivers.set(taskId, lifecycleManager);

            const driver = await Promise.race([
                lifecycleManager.acquire(),
                this._timeout(ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS, 'lifecycleManager.acquire')
            ]);

            // Fase 3: Attach telemetry
            this._attachDriverTelemetry(driver, taskId, correlationId);

            // Fase 4: Execute (com timeout)
            this._emitEvent(ActionCode.DRIVER_TASK_STARTED, { ... });

            const result = await Promise.race([
                driver.execute(task.spec.prompt),
                this._timeout(ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS, 'driver.execute')
            ]);

            return result;
        })();

        const result = await executePromise;

        // Success
        this._emitEvent(ActionCode.DRIVER_TASK_COMPLETED, { ... });
        this.stats.tasksExecuted++;

    } catch (error) {
        if (error.name === 'TimeoutError') {
            log('ERROR', `[DriverNERVAdapter] Timeout na execução: ${error.message}`);
        }

        this._emitEvent(ActionCode.DRIVER_TASK_FAILED, { ... });
        this.stats.driversCrashed++;

    } finally {
        // ✅ Cleanup com timeout
        if (lifecycleManager) {
            await Promise.race([
                lifecycleManager.release(),
                this._timeout(5000, 'lifecycleManager.release')
            ]).catch(() => {});
            this.activeDrivers.delete(taskId);
        }

        if (page) {
            await Promise.race([
                this.browserPool.release(page),
                this._timeout(5000, 'browserPool.release')
            ]).catch(() => {});
        }
    }
}

// ✅ Helper para timeout
_timeout(ms, operation) {
    return new Promise((_, reject) => {
        setTimeout(() => {
            const error = new Error(`Timeout after ${ms}ms`);
            error.name = 'TimeoutError';
            error.operation = operation;
            reject(error);
        }, ms);
    });
}
```

**Benefícios**:
- Timeout em todas as fases (allocate, acquire, execute, release)
- Previne hangs indefinidos
- Cleanup garantido (even on timeout)
- Error claro (TimeoutError com operation name)

---

### BUG #4: shutdown() Sem Timeout Protection - MÉDIO (P2)
**Severidade**: P2 (Shutdown pode hang)
**Linha**: 392-414
**Impacto**: Shutdown pode hang se driver.release() travar.

**Código Atual**:
```javascript
async shutdown() {
    log('INFO', `[DriverNERVAdapter] Iniciando shutdown (${this.activeDrivers.size} drivers ativos)`);

    const shutdownPromises = [];

    for (const [taskId, lifecycleManager] of this.activeDrivers.entries()) {
        shutdownPromises.push(
            lifecycleManager.release().catch(err => { // ❌ Sem timeout
                log('ERROR', `[DriverNERVAdapter] Erro ao liberar driver ${taskId}: ${err.message}`);
            })
        );
    }

    await Promise.all(shutdownPromises); // ❌ Pode hang indefinidamente
    this.activeDrivers.clear();

    log('INFO', '[DriverNERVAdapter] Shutdown concluído');
}
```

**Problema**:
- `lifecycleManager.release()` pode hang indefinidamente
- `Promise.all()` espera todas as promises (sem timeout)
- Shutdown pode nunca completar

**Solução Proposta**:
```javascript
async shutdown(options = {}) {
    const timeout = options.timeout || ADAPTER_CONFIG.SHUTDOWN_TIMEOUT_MS;

    log('INFO', `[DriverNERVAdapter] Iniciando shutdown (${this.activeDrivers.size} drivers ativos, timeout: ${timeout}ms)`);

    const shutdownPromises = [];

    for (const [taskId, lifecycleManager] of this.activeDrivers.entries()) {
        const shutdownPromise = (async () => {
            try {
                // ✅ Timeout wrapper
                const releasePromise = lifecycleManager.release();
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Shutdown timeout')), timeout)
                );

                await Promise.race([releasePromise, timeoutPromise]);

                log('DEBUG', `[DriverNERVAdapter] Driver ${taskId} released successfully`);
                return { taskId, success: true };

            } catch (err) {
                log('ERROR', `[DriverNERVAdapter] Erro ao liberar driver ${taskId}: ${err.message}`);
                return { taskId, success: false, error: err.message };
            }
        })();

        shutdownPromises.push(shutdownPromise);
    }

    // ✅ Promise.allSettled (não falha se um falhar)
    const results = await Promise.allSettled(shutdownPromises);

    const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failedCount = results.length - successCount;

    this.activeDrivers.clear();

    // ✅ Emit shutdown event
    this.emit(ADAPTER_EVENTS.SHUTDOWN, {
        total: results.length,
        success: successCount,
        failed: failedCount,
        duration: Date.now() - startTime
    });

    log('INFO', `[DriverNERVAdapter] Shutdown concluído (${successCount}/${results.length} success)`);

    return { total: results.length, success: successCount, failed: failedCount };
}
```

**Benefícios**:
- Timeout de 30s por driver (configurável)
- Promise.allSettled (não falha se um driver falhar)
- Retorna resultado detalhado (success/failed counts)
- Event emitido (SHUTDOWN)

---

### BUG #5: _attachDriverTelemetry Sem Detach - MÉDIO (P2)
**Severidade**: P2 (Memory leak)
**Linha**: 338-381
**Impacto**: Listeners não removidos após task completar (memory leak).

**Código Atual**:
```javascript
_attachDriverTelemetry(driver, taskId, correlationId) {
    // Listener para mudanças de estado
    driver.on('state_change', data => { // ❌ Listener nunca removido
        this._emitEvent(ActionCode.DRIVER_STATE_OBSERVED, { ... });
    });

    // Listener para progresso
    driver.on('progress', data => { // ❌ Listener nunca removido
        this._emitEvent(ActionCode.DRIVER_VITAL, { ... });
        this.stats.vitalsEmitted++;
    });

    // Listener para anomalias
    if (typeof driver.on === 'function') {
        driver.on('anomaly', data => { // ❌ Listener nunca removido
            this._emitEvent(ActionCode.DRIVER_ANOMALY, { ... });
        });
    }
}
```

**Problema**:
- Listeners adicionados com `on()` (permanentes)
- Nunca removidos após task completar
- Memory leak se muitas tasks executarem
- Listener duplicados se task re-executar (improvável, mas possível)

**Solução Proposta**:
```javascript
_attachDriverTelemetry(driver, taskId, correlationId) {
    // ✅ Map de listeners para cleanup
    const listeners = [];

    // State change listener
    const stateChangeListener = (data) => {
        this._emitEvent(ActionCode.DRIVER_STATE_OBSERVED, {
            taskId,
            stateTransition: data,
            timestamp: new Date().toISOString()
        }, correlationId);

        // ✅ Emit local event também
        this.emit(ADAPTER_EVENTS.DRIVER_STATE_CHANGE, { taskId, data });
    };
    driver.on('state_change', stateChangeListener);
    listeners.push({ event: 'state_change', listener: stateChangeListener });

    // Progress listener
    const progressListener = (data) => {
        this._emitEvent(ActionCode.DRIVER_VITAL, {
            taskId,
            vitalType: 'PROGRESS',
            data,
            timestamp: new Date().toISOString()
        }, correlationId);

        this.stats.vitalsEmitted++;
        this.emit(ADAPTER_EVENTS.DRIVER_PROGRESS, { taskId, data });
    };
    driver.on('progress', progressListener);
    listeners.push({ event: 'progress', listener: progressListener });

    // Anomaly listener
    const anomalyListener = (data) => {
        this._emitEvent(ActionCode.DRIVER_ANOMALY, {
            taskId,
            anomalyType: data.type,
            severity: data.severity,
            details: data.message
        }, correlationId);

        this.emit(ADAPTER_EVENTS.DRIVER_ANOMALY, { taskId, data });
    };
    driver.on('anomaly', anomalyListener);
    listeners.push({ event: 'anomaly', listener: anomalyListener });

    // ✅ Detach automático quando driver destruído
    const destroyedListener = () => {
        this._detachDriverTelemetry(driver, listeners);
        this.emit(ADAPTER_EVENTS.DRIVER_DETACHED, { taskId });
    };
    driver.once('destroyed', destroyedListener);

    // ✅ Salvar listeners para detach manual se necessário
    this.activeDrivers.get(taskId)._telemetryListeners = listeners;

    this.emit(ADAPTER_EVENTS.DRIVER_ATTACHED, { taskId });
}

// ✅ Novo método para detach
_detachDriverTelemetry(driver, listeners) {
    for (const { event, listener } of listeners) {
        driver.off(event, listener);
    }
}
```

**Benefícios**:
- Listeners removidos automaticamente (via driver.once('destroyed'))
- Previne memory leak
- Listeners salvos para detach manual se necessário
- Emit local events (DRIVER_ATTACHED, DRIVER_DETACHED)

---

### BUG #6: _performHealthCheck Sem Error Handling - MÉDIO (P2)
**Severidade**: P2 (Health check pode crashar)
**Linha**: 320-336
**Impacto**: browserPool.getHealth() pode lançar erro e crashar health check.

**Código Atual**:
```javascript
async _performHealthCheck(payload, correlationId) {
    const health = {
        adapter: STATUS_VALUES.HEALTHY,
        activeDrivers: this.activeDrivers.size,
        stats: { ...this.stats },
        browserPoolHealth: await this.browserPool.getHealth() // ❌ Pode lançar erro
    };

    this._emitEvent(ActionCode.DRIVER_HEALTH_REPORT, health, correlationId);

    log('DEBUG', `[DriverNERVAdapter] Health check: ${this.activeDrivers.size} drivers ativos`, correlationId);
}
```

**Problema**:
- `browserPool.getHealth()` pode lançar erro (pool desconectado, erro de rede)
- Health check crasharia (uncaught exception)
- Nenhum try-catch

**Solução Proposta**:
```javascript
async _performHealthCheck(payload, correlationId) {
    let browserPoolHealth = null;
    let healthStatus = STATUS_VALUES.HEALTHY;

    try {
        // ✅ Try-catch em browserPool.getHealth()
        if (this.browserPool) {
            browserPoolHealth = await Promise.race([
                this.browserPool.getHealth(),
                this._timeout(5000, 'browserPool.getHealth')
            ]);
        } else {
            browserPoolHealth = { status: 'DEGRADED', reason: 'Pool not available' };
            healthStatus = STATUS_VALUES.DEGRADED;
        }
    } catch (poolError) {
        log('WARN', `[DriverNERVAdapter] Error getting browser pool health: ${poolError.message}`, correlationId);
        browserPoolHealth = {
            status: 'ERROR',
            error: poolError.message
        };
        healthStatus = STATUS_VALUES.UNHEALTHY;
    }

    const health = {
        adapter: healthStatus,
        activeDrivers: this.activeDrivers.size,
        stats: { ...this.stats },
        browserPoolHealth,
        degradedMode: this.degradedMode,
        config: {
            maxActiveDrivers: ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS,
            executeTimeout: ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS,
            shutdownTimeout: ADAPTER_CONFIG.SHUTDOWN_TIMEOUT_MS
        }
    };

    this._emitEvent(ActionCode.DRIVER_HEALTH_REPORT, health, correlationId);

    // ✅ Emit local event
    this.emit(ADAPTER_EVENTS.HEALTH_CHECK, health);

    log('DEBUG', `[DriverNERVAdapter] Health check: ${healthStatus}, ${this.activeDrivers.size} drivers ativos`, correlationId);

    return health;
}
```

**Benefícios**:
- Try-catch em browserPool.getHealth()
- Timeout de 5s
- Health status calculado (HEALTHY, DEGRADED, UNHEALTHY)
- Config incluído no health report
- Retorna resultado (para testes)

---

### BUG #7: _emitEvent Sem Retry Logic - BAIXO (P3)
**Severidade**: P3 (Telemetria pode falhar silenciosamente)
**Linha**: 383-391
**Impacto**: Se NERV falhar, evento é perdido (sem retry).

**Código Atual**:
```javascript
_emitEvent(actionCode, payload, correlationId) {
    try {
        HighLevelNERV.sendEvent(this.nerv, ActorRole.DRIVER, actionCode, payload, correlationId);
        log('DEBUG', `[DriverNERVAdapter] Evento emitido: ${actionCode}`, correlationId);
    } catch (err) {
        log('ERROR', `[DriverNERVAdapter] Falha ao emitir evento: ${err.message}`, correlationId);
        // ❌ Nenhum retry
        // ❌ Nenhuma métrica de falha
    }
}
```

**Problema**:
- Se `HighLevelNERV.sendEvent()` falhar, evento é perdido
- Nenhum retry logic
- Nenhuma métrica de falhas de telemetria

**Solução Proposta**:
```javascript
async _emitEvent(actionCode, payload, correlationId) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            HighLevelNERV.sendEvent(this.nerv, ActorRole.DRIVER, actionCode, payload, correlationId);

            log('DEBUG', `[DriverNERVAdapter] Evento emitido: ${actionCode}`, correlationId);

            // ✅ Métrica de sucesso
            if (!this.stats.eventsEmitted) this.stats.eventsEmitted = 0;
            this.stats.eventsEmitted++;

            return; // Success

        } catch (err) {
            lastError = err;

            if (attempt < maxRetries - 1) {
                log('WARN', `[DriverNERVAdapter] Falha ao emitir evento (tentativa ${attempt + 1}/${maxRetries}): ${err.message}`, correlationId);
                await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1))); // Backoff
            } else {
                log('ERROR', `[DriverNERVAdapter] Falha permanente ao emitir evento após ${maxRetries} tentativas: ${err.message}`, correlationId);

                // ✅ Métrica de falha
                if (!this.stats.eventsFailed) this.stats.eventsFailed = 0;
                this.stats.eventsFailed++;

                // ✅ Emit local error event
                this.emit(ADAPTER_EVENTS.ERROR, {
                    operation: '_emitEvent',
                    actionCode,
                    error: err.message
                });
            }
        }
    }
}
```

**Benefícios**:
- Retry logic (3 tentativas com backoff)
- Métricas de telemetria (eventsEmitted, eventsFailed)
- Emit local error event
- Log diferenciado (WARN para retry, ERROR para falha permanente)

---

### BUG #8: Falta Validação de activeDrivers Size Limit - BAIXO (P3)
**Severidade**: P3 (Memory leak potencial)
**Linha**: 207 (activeDrivers.set)
**Impacto**: Se muitas tasks executarem simultaneamente, activeDrivers pode crescer indefinidamente.

**Código Atual**:
```javascript
async _executeTask(payload, correlationId) {
    // ...

    // 3. Cria DriverLifecycleManager
    lifecycleManager = new DriverLifecycleManager(page, task, this.config);
    this.activeDrivers.set(taskId, lifecycleManager); // ❌ Sem limit check

    // ...
}
```

**Problema**:
- Nenhuma validação de `activeDrivers.size` antes de adicionar
- Se KERNEL enviar muitas tasks simultaneamente, pode causar OOM
- Nenhuma proteção contra DOS (denial of service)

**Solução Proposta**:
```javascript
async _executeTask(payload, correlationId) {
    const { task } = payload;
    const taskId = task.meta.id;

    // ✅ Validar limite de drivers ativos
    if (this.activeDrivers.size >= ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS) {
        const error = `Max active drivers limit reached (${this.activeDrivers.size}/${ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS})`;

        log('WARN', `[DriverNERVAdapter] ${error}`, correlationId);

        this._emitEvent(ActionCode.DRIVER_TASK_FAILED, {
            taskId,
            error,
            reason: 'MAX_ACTIVE_DRIVERS',
            suggestion: 'Aguarde tasks ativas completarem ou aumente MAX_ACTIVE_DRIVERS'
        }, correlationId);

        // ✅ Métrica
        if (!this.stats.tasksRejected) this.stats.tasksRejected = 0;
        this.stats.tasksRejected++;

        return;
    }

    // ...

    lifecycleManager = new DriverLifecycleManager(page, task, this.config);
    this.activeDrivers.set(taskId, lifecycleManager);

    // ✅ Emit local event
    this.emit(ADAPTER_EVENTS.TASK_STARTED, { taskId, activeCount: this.activeDrivers.size });

    // ...
}
```

**Benefícios**:
- Validação de limite (MAX_ACTIVE_DRIVERS = 10, configurável)
- Proteção contra OOM
- Mensagem clara de erro
- Métrica de rejeição (tasksRejected)
- Emit local event (TASK_STARTED)

---

## 🚀 MELHORIAS SUGERIDAS (10 Total)

### IMPROVEMENT #1: EventEmitter Inheritance + Eventos Locais (P1)
**Prioridade**: P1 (Consistência arquitetural)
**Esforço**: 2-3 horas
**Linhas**: +50

**Descrição**: Herdar EventEmitter e adicionar eventos locais (além de NERV events).

**Implementação**:
```javascript
const EventEmitter = require('events');

const ADAPTER_EVENTS = {
    TASK_STARTED: 'adapter:task_started',
    TASK_COMPLETED: 'adapter:task_completed',
    TASK_FAILED: 'adapter:task_failed',
    TASK_ABORTED: 'adapter:task_aborted',
    DRIVER_ATTACHED: 'adapter:driver_attached',
    DRIVER_DETACHED: 'adapter:driver_detached',
    HEALTH_CHECK: 'adapter:health_check',
    ERROR: 'adapter:error',
    DEGRADED_MODE: 'adapter:degraded_mode',
    SHUTDOWN: 'adapter:shutdown'
};

class DriverNERVAdapter extends EventEmitter {
    constructor(nerv, browserPool, config) {
        super(); // ✅ EventEmitter constructor
        // ...
    }

    // ✅ Duplo canal (local + NERV)
    _emitBoth(localEvent, nervActionCode, payload, correlationId) {
        // Local event (para server/monitoring)
        this.emit(localEvent, { ...payload, correlationId });

        // NERV event (para KERNEL)
        this._emitEvent(nervActionCode, payload, correlationId);
    }
}
```

**Benefícios**:
- Consistência com v2.0 stack (100% herdam EventEmitter)
- Duplo canal (local subscribers + NERV IPC)
- Server pode escutar eventos diretamente
- Suporta EventEmitter API (on, once, off, removeListener)

---

### IMPROVEMENT #2: ADAPTER_CONFIG - Zero Magic Numbers (P1)
**Prioridade**: P1 (Code quality)
**Esforço**: 1 hora
**Linhas**: +30

**Implementação**:
```javascript
const ADAPTER_CONFIG = {
    EXECUTE_TASK_TIMEOUT_MS: parseInt(process.env.ADAPTER_EXECUTE_TIMEOUT || '300000'), // 5min
    SHUTDOWN_TIMEOUT_MS: parseInt(process.env.ADAPTER_SHUTDOWN_TIMEOUT || '30000'), // 30s
    HEALTH_CHECK_INTERVAL_MS: parseInt(process.env.ADAPTER_HEALTH_INTERVAL || '60000'), // 1min
    MAX_ACTIVE_DRIVERS: parseInt(process.env.ADAPTER_MAX_DRIVERS || '10'),
    TELEMETRY_BUFFER_SIZE: parseInt(process.env.ADAPTER_TELEMETRY_BUFFER || '1000'),
    DEGRADED_MODE_WARNING_INTERVAL_MS: parseInt(process.env.ADAPTER_DEGRADED_WARNING || '60000'),
    EVENT_RETRY_MAX_ATTEMPTS: parseInt(process.env.ADAPTER_EVENT_RETRY || '3'),
    EVENT_RETRY_BACKOFF_MS: parseInt(process.env.ADAPTER_EVENT_BACKOFF || '100')
};
```

**Benefícios**:
- Zero magic numbers
- Configurável via env vars
- Valores padrão explícitos

---

### IMPROVEMENT #3: JSDoc Completo (P1)
**Prioridade**: P1 (Documentation)
**Esforço**: 2 horas
**Linhas**: +120

**Status Atual**: JSDoc parcial (~30%)

**Métodos Que Precisam JSDoc**:
```javascript
/**
 * Executa uma tarefa usando DriverLifecycleManager.
 * Aloca página do BrowserPool, cria driver, executa e monitora.
 *
 * @private
 * @param {Object} payload - Payload contendo task spec
 * @param {Object} payload.task - Task completa (meta + spec)
 * @param {string} payload.task.meta.id - Task ID
 * @param {Object} payload.task.spec - Task specification
 * @param {string} payload.task.spec.target - Target name (chatgpt, gemini, etc)
 * @param {string} payload.task.spec.prompt - Prompt para driver
 * @param {string} correlationId - NERV correlation ID
 *
 * @returns {Promise<void>}
 *
 * @throws {Error} Se task inválida ou timeout
 *
 * @emits ADAPTER_EVENTS.TASK_STARTED quando task inicia
 * @emits ADAPTER_EVENTS.TASK_COMPLETED quando task completa com sucesso
 * @emits ADAPTER_EVENTS.TASK_FAILED quando task falha
 *
 * @example
 * await adapter._executeTask({
 *   task: {
 *     meta: { id: 'task-123' },
 *     spec: { target: 'chatgpt', prompt: 'Hello' }
 *   }
 * }, 'corr-456');
 */
async _executeTask(payload, correlationId) { ... }
```

**Benefícios**:
- 100% JSDoc coverage
- IntelliSense completo
- API documentation automática

---

### IMPROVEMENT #4: Metrics Expandidos (P2)
**Prioridade**: P2 (Observability)
**Esforço**: 1 hora
**Linhas**: +30

**Stats Atuais**:
```javascript
this.stats = {
    tasksExecuted: 0,
    tasksAborted: 0,
    driversCrashed: 0,
    vitalsEmitted: 0
};
```

**Stats v2.0 Propostos**:
```javascript
this.stats = {
    // Existing
    tasksExecuted: 0,
    tasksAborted: 0,
    driversCrashed: 0,
    vitalsEmitted: 0,

    // ✅ New metrics
    tasksRejected: 0,
    tasksTimedOut: 0,
    eventsEmitted: 0,
    eventsFailed: 0,
    driversAttached: 0,
    driversDetached: 0,
    healthChecksPerformed: 0,
    degradedModeWarnings: 0,

    // ✅ Timing metrics
    avgTaskDuration: 0,
    maxTaskDuration: 0,
    minTaskDuration: Infinity,

    // ✅ Uptime
    startTime: Date.now(),
    uptime: () => Date.now() - this.stats.startTime
};
```

**Benefícios**:
- 14 métricas (+10 novas)
- Timing metrics (avg/max/min)
- Uptime tracking

---

### IMPROVEMENT #5: Telemetry Buffer (P2)
**Prioridade**: P2 (Performance)
**Esforço**: 2-3 horas
**Linhas**: +80

**Descrição**: Buffer de telemetria para batch emit (reduzir overhead de NERV).

**Implementação**:
```javascript
constructor(nerv, browserPool, config) {
    super();
    // ...

    // ✅ Telemetry buffer
    this.telemetryBuffer = [];
    this._startTelemetryFlush();
}

// ✅ Buffer telemetry events
_bufferTelemetry(actionCode, payload, correlationId) {
    this.telemetryBuffer.push({
        actionCode,
        payload,
        correlationId,
        timestamp: Date.now()
    });

    // Flush se buffer cheio
    if (this.telemetryBuffer.length >= ADAPTER_CONFIG.TELEMETRY_BUFFER_SIZE) {
        this._flushTelemetry();
    }
}

// ✅ Flush buffer periodicamente
_startTelemetryFlush() {
    this.telemetryFlushInterval = setInterval(() => {
        if (this.telemetryBuffer.length > 0) {
            this._flushTelemetry();
        }
    }, 1000); // Flush a cada 1s
}

// ✅ Flush batch
_flushTelemetry() {
    if (this.telemetryBuffer.length === 0) return;

    const batch = [...this.telemetryBuffer];
    this.telemetryBuffer = [];

    // Emit batch via NERV
    HighLevelNERV.sendBatchEvents(this.nerv, ActorRole.DRIVER, batch);

    log('DEBUG', `[DriverNERVAdapter] Flushed ${batch.length} telemetry events`);
}
```

**Benefícios**:
- Batch emit (reduz overhead)
- Buffer configurável (TELEMETRY_BUFFER_SIZE)
- Flush automático (1s interval + size threshold)

---

### IMPROVEMENT #6: Circuit Breaker Pattern (P2)
**Prioridade**: P2 (Resilience)
**Esforço**: 3-4 horas
**Linhas**: +100

**Descrição**: Implementar circuit breaker para proteger contra driver crashes frequentes.

**Implementação**:
```javascript
constructor(nerv, browserPool, config) {
    super();
    // ...

    // ✅ Circuit breaker
    this.circuitBreaker = {
        state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
        failures: 0,
        threshold: ADAPTER_CONFIG.CIRCUIT_BREAKER_THRESHOLD || 5,
        timeout: ADAPTER_CONFIG.CIRCUIT_BREAKER_TIMEOUT || 60000, // 1min
        lastFailureTime: null
    };
}

// ✅ Check circuit breaker antes de executar
async _executeTask(payload, correlationId) {
    // Check circuit breaker
    if (!this._canExecute()) {
        const error = `Circuit breaker OPEN - too many recent failures`;

        log('WARN', `[DriverNERVAdapter] ${error}`, correlationId);

        this._emitEvent(ActionCode.DRIVER_TASK_FAILED, {
            taskId: payload.task.meta.id,
            error,
            reason: 'CIRCUIT_BREAKER_OPEN'
        }, correlationId);

        return;
    }

    // Execute task...
    try {
        // ...
        this._recordSuccess(); // ✅ Reset failures
    } catch (error) {
        this._recordFailure(); // ✅ Increment failures
        throw error;
    }
}

_canExecute() {
    const { state, failures, threshold, timeout, lastFailureTime } = this.circuitBreaker;

    if (state === 'CLOSED') return true;

    if (state === 'OPEN') {
        // Check se timeout passou
        if (Date.now() - lastFailureTime > timeout) {
            this.circuitBreaker.state = 'HALF_OPEN';
            log('INFO', '[DriverNERVAdapter] Circuit breaker HALF_OPEN');
            return true;
        }
        return false;
    }

    if (state === 'HALF_OPEN') {
        return true; // Permite 1 tentativa
    }

    return true;
}

_recordFailure() {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();

    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
        this.circuitBreaker.state = 'OPEN';
        log('WARN', `[DriverNERVAdapter] Circuit breaker OPEN (${this.circuitBreaker.failures} failures)`);

        this.emit(ADAPTER_EVENTS.CIRCUIT_BREAKER_OPEN, {
            failures: this.circuitBreaker.failures,
            threshold: this.circuitBreaker.threshold
        });
    }
}

_recordSuccess() {
    if (this.circuitBreaker.state === 'HALF_OPEN') {
        this.circuitBreaker.state = 'CLOSED';
        log('INFO', '[DriverNERVAdapter] Circuit breaker CLOSED (recovered)');
    }

    this.circuitBreaker.failures = 0;
}
```

**Benefícios**:
- Proteção contra driver crashes frequentes
- Auto-recovery (timeout após 1min)
- HALF_OPEN state (teste de recovery)
- Event emitido (CIRCUIT_BREAKER_OPEN)

---

### IMPROVEMENT #7: Task Queue (P3)
**Prioridade**: P3 (Advanced)
**Esforço**: 4-5 horas
**Linhas**: +150

**Descrição**: Fila interna de tasks quando MAX_ACTIVE_DRIVERS atingido.

**Implementação**:
```javascript
constructor(nerv, browserPool, config) {
    super();
    // ...

    // ✅ Task queue
    this.taskQueue = [];
    this.maxQueueSize = ADAPTER_CONFIG.MAX_QUEUE_SIZE || 100;
}

async _executeTask(payload, correlationId) {
    // Se limite atingido, enfileirar
    if (this.activeDrivers.size >= ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS) {
        if (this.taskQueue.length >= this.maxQueueSize) {
            // Rejeitar (queue cheia)
            this._emitEvent(ActionCode.DRIVER_TASK_FAILED, {
                taskId: payload.task.meta.id,
                error: 'Task queue full',
                reason: 'QUEUE_FULL'
            }, correlationId);
            return;
        }

        // Enfileirar
        this.taskQueue.push({ payload, correlationId });

        log('DEBUG', `[DriverNERVAdapter] Task enqueued (${this.taskQueue.length} in queue)`);

        this.emit(ADAPTER_EVENTS.TASK_QUEUED, {
            taskId: payload.task.meta.id,
            queueSize: this.taskQueue.length
        });

        return;
    }

    // Executar normalmente...
}

// ✅ Process queue quando driver liberar
async _finallyCleanup(taskId, lifecycleManager, page) {
    // Cleanup...

    // ✅ Process next task from queue
    if (this.taskQueue.length > 0 && this.activeDrivers.size < ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS) {
        const next = this.taskQueue.shift();

        log('DEBUG', `[DriverNERVAdapter] Processing queued task (${this.taskQueue.length} remaining)`);

        // Execute async (não bloqueia cleanup)
        setImmediate(() => {
            this._executeTask(next.payload, next.correlationId).catch(err => {
                log('ERROR', `[DriverNERVAdapter] Error executing queued task: ${err.message}`);
            });
        });
    }
}
```

**Benefícios**:
- Fila automática (MAX_QUEUE_SIZE = 100)
- Auto-process quando driver liberar
- Métricas de fila (queueSize)
- Event emitido (TASK_QUEUED)

---

### IMPROVEMENT #8: Periodic Health Check (P3)
**Prioridade**: P3 (Monitoring)
**Esforço**: 1 hora
**Linhas**: +40

**Implementação**:
```javascript
constructor(nerv, browserPool, config) {
    super();
    // ...

    // ✅ Start periodic health check
    this._startPeriodicHealthCheck();
}

_startPeriodicHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
        try {
            await this._performHealthCheck({}, 'PERIODIC_HEALTH_CHECK');
        } catch (err) {
            log('ERROR', `[DriverNERVAdapter] Periodic health check failed: ${err.message}`);
        }
    }, ADAPTER_CONFIG.HEALTH_CHECK_INTERVAL_MS);

    log('INFO', `[DriverNERVAdapter] Periodic health check started (${ADAPTER_CONFIG.HEALTH_CHECK_INTERVAL_MS}ms interval)`);
}

async shutdown() {
    // ✅ Clear intervals
    if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
    }

    if (this.telemetryFlushInterval) {
        clearInterval(this.telemetryFlushInterval);
    }

    // ... resto do shutdown
}
```

**Benefícios**:
- Health check automático (1min interval)
- Detecção proativa de problemas
- Cleanup em shutdown

---

### IMPROVEMENT #9: Degraded Mode Periodic Warning (P3)
**Prioridade**: P3 (UX)
**Esforço**: 30min
**Linhas**: +30

**Implementação**:
```javascript
constructor(nerv, browserPool, config) {
    super();
    // ...

    // ✅ Degraded mode warning
    if (this.degradedMode) {
        this._startDegradedModeWarning();
    }
}

_startDegradedModeWarning() {
    this.degradedModeInterval = setInterval(() => {
        log('WARN', '[DriverNERVAdapter] MODO DEGRADADO - Browser Pool não disponível');

        this.emit(ADAPTER_EVENTS.DEGRADED_MODE, {
            reason: 'Browser Pool not available',
            suggestion: 'Configure browserEndpoint/proxy e reinicie'
        });

        this.stats.degradedModeWarnings++;

    }, ADAPTER_CONFIG.DEGRADED_MODE_WARNING_INTERVAL_MS);
}

async shutdown() {
    // ✅ Clear degraded mode warning
    if (this.degradedModeInterval) {
        clearInterval(this.degradedModeInterval);
    }

    // ... resto
}
```

**Benefícios**:
- Warning periódico (1min)
- Não esquece de configurar browser pool
- Métrica (degradedModeWarnings)

---

### IMPROVEMENT #10: Module Exports Completo (P3)
**Prioridade**: P3 (API)
**Esforço**: 30min
**Linhas**: +20

**Implementação**:
```javascript
module.exports = {
    // ✅ Class export
    DriverNERVAdapter,

    // ✅ Constants export
    ADAPTER_CONFIG,
    ADAPTER_EVENTS,

    // ✅ Factory function (opcional)
    create: (nerv, browserPool, config) => {
        return new DriverNERVAdapter(nerv, browserPool, config);
    }
};
```

**Benefícios**:
- Export de constantes (para testes)
- Factory function (alternative constructor)
- API completa

---

## 📊 ESTIMATIVA DE IMPLEMENTAÇÃO v2.0

### Sprints Propostos

#### **SPRINT 1: P0 Bugs (CRÍTICO)**
**Duração**: 2-3 horas
**Linhas**: +80

**Tarefas**:
- [x] BUG #1: EventEmitter inheritance
- [x] JSDoc mínimo (métodos públicos)
- [x] Syntax validation

**Output**: driver_nerv_adapter.js v2.0 (415 → 495 linhas)

---

#### **SPRINT 2: P1 Bugs + Improvements (ALTO)**
**Duração**: 4-5 horas
**Linhas**: +120

**Tarefas**:
- [x] BUG #2: ADAPTER_CONFIG + ADAPTER_EVENTS
- [x] BUG #3: _executeTask timeout protection
- [x] IMPROVEMENT #1: EventEmitter + eventos locais
- [x] IMPROVEMENT #2: ADAPTER_CONFIG completo
- [x] IMPROVEMENT #3: JSDoc completo

**Output**: driver_nerv_adapter.js v2.0 (495 → 615 linhas)

---

#### **SPRINT 3: P2 Bugs + Improvements (MÉDIO)**
**Duração**: 3-4 horas
**Linhas**: +100

**Tarefas**:
- [x] BUG #4: shutdown() timeout protection
- [x] BUG #5: _attachDriverTelemetry detach
- [x] BUG #6: _performHealthCheck error handling
- [x] IMPROVEMENT #4: Metrics expandidos
- [x] IMPROVEMENT #5: Telemetry buffer
- [x] IMPROVEMENT #6: Circuit breaker

**Output**: driver_nerv_adapter.js v2.0 (615 → 715 linhas)

---

#### **SPRINT 4: P3 Bugs + Improvements (BAIXO)**
**Duração**: 2-3 horas
**Linhas**: +85

**Tarefas**:
- [x] BUG #7: _emitEvent retry logic
- [x] BUG #8: activeDrivers size limit
- [x] IMPROVEMENT #7: Task queue (opcional)
- [x] IMPROVEMENT #8: Periodic health check
- [x] IMPROVEMENT #9: Degraded mode warning
- [x] IMPROVEMENT #10: Module exports completo

**Output**: driver_nerv_adapter.js v2.0 (715 → 800 linhas)

---

### **TOTAL ESTIMADO**
```
Duração Total:   11-15 horas
Linhas:          415 → 800 (+385, +93%)
Bugs Corrigidos: 8 (1 P0, 2 P1, 3 P2, 2 P3)
Melhorias:       10 (3 P1, 3 P2, 4 P3)
```

---

## 🎯 PRIORIZAÇÃO RECOMENDADA

### Ordem de Implementação
1. **SPRINT 1** (P0 - CRÍTICO): EventEmitter, JSDoc básico
2. **SPRINT 2** (P1 - ALTO): Config, timeout, events
3. **SPRINT 3** (P2 - MÉDIO): Shutdown, detach, health, metrics, buffer, circuit breaker
4. **SPRINT 4** (P3 - BAIXO): Retry, queue, warnings

### Justificativa
- P0: Consistência arquitetural (100% dos módulos v2.0 herdam EventEmitter)
- P1: Timeout protection crítico (previne hangs)
- P2: Error handling + resilience (circuit breaker)
- P3: Advanced features (queue, periodic checks)

---

## 📝 CHECKLIST DE VALIDAÇÃO

### Pré-Implementação
- [ ] Ler audit completo
- [ ] Entender hierarquia (NERV → Adapter → LifecycleManager → Factory → Drivers)
- [ ] Revisar código atual (415 linhas)

### Durante Implementação
- [ ] EventEmitter inheritance
- [ ] ADAPTER_CONFIG (8 constantes)
- [ ] ADAPTER_EVENTS (10 eventos)
- [ ] Timeout protection (_executeTask, shutdown)
- [ ] Error handling robusto
- [ ] JSDoc completo (100%)
- [ ] Metrics expandidos (14 métricas)
- [ ] Syntax validation (node --check)

### Pós-Implementação
- [ ] Relatório de implementação
- [ ] Update todo list
- [ ] Integration testing (Adapter → LifecycleManager → Factory → Driver)
- [ ] Performance benchmarks

---

## 🔧 ARQUIVOS RELACIONADOS

### Dependências Diretas
- `src/driver/DriverLifecycleManager.js` (v2.0, 483 linhas)
- `src/driver/factory.js` (v2.0, 791 linhas)
- `src/nerv/adapters/high_level_adapter.js`
- `src/shared/nerv/constants.js` (ActionCode, MessageType, ActorRole)
- `src/core/validators/prerequisite_validator.js`

### Arquivos Que Importam Este Módulo
- `src/main.js` (boot sequence)
- `src/kernel/` (envia DRIVER_* commands via NERV)

### Testes
- `tests/` (criar test_driver_nerv_adapter.js)

---

## 📚 DOCUMENTAÇÃO ADICIONAL

### Conceitos-Chave
1. **NERV Adapter Pattern**: Desacoplamento total via pub/sub IPC
2. **Duplo Canal**: Eventos locais (EventEmitter) + NERV events (IPC)
3. **Degraded Mode**: Opera sem browserPool (rejeita tasks com mensagem clara)
4. **Circuit Breaker**: Proteção contra driver crashes frequentes
5. **Telemetry Buffer**: Batch emit para reduzir overhead

### Referências
- `ARCHITECTURE.md` v3.0 (NERV architecture)
- `NERV_EVENTS.md` (event catalog)
- `analysis/driverlifecyclemanager_v2_implementation_report.md`
- `analysis/factory_v2_implementation_report.md`

---

## ✅ CONCLUSÃO

**driver_nerv_adapter.js** é o **adapter crítico** entre NERV (pub/sub IPC) e o domínio DRIVER. Responsável por:
- Escutar DRIVER_* commands do KERNEL via NERV
- Gerenciar DriverLifecycleManager instances
- Emitir telemetria via NERV + EventEmitter local
- Garantir zero acoplamento direto

**Bugs Críticos** (P0-P1):
1. Não herda EventEmitter (inconsistência arquitetural)
2. Faltam ADAPTER_CONFIG + ADAPTER_EVENTS (magic numbers)
3. _executeTask sem timeout (hang possível)

**v2.0 Transformação**:
```
v1.1: 415 linhas  →  v2.0: 800 linhas  (+93%)
```

**Benefícios v2.0**:
- EventEmitter inheritance (100% v2.0 stack)
- Duplo canal (local events + NERV IPC)
- Timeout protection (execute, shutdown, health)
- Circuit breaker (resilience)
- Telemetry buffer (performance)
- Metrics expandidos (14 métricas)
- JSDoc completo (100%)

**Status**: ✅ Pronto para implementação (sprints 1-4, 11-15h)

---
**Versão**: v2.0 Audit
**Data**: 2026-02-01
**Próximo**: Implementar DriverNERVAdapter v2.0 (4 sprints)
