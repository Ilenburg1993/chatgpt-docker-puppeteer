# BaseDriver.js v2.0 Audit Report

**Data**: 2026-02-01 **Arquivo**: `src/driver/core/BaseDriver.js` **Linhas Atuais**: 228 **Versão
Atual**: v1.1 (consolidada com Protocol 11) **Objetivo**: Identificar bugs, melhorias e upgrade path
para v2.0

---

## 📊 Análise Executiva

### Responsabilidades

BaseDriver coordena **6 subsistemas modulares** (recovery, handles, inputResolver, frameNavigator,
biomechanics, submission) e emite telemetria desacoplada via event bus. Herda de TargetDriver e é
herdado por ChatGPTDriver.

### Arquitetura Atual

```
TargetDriver (abstrato)
  ↓ herda
BaseDriver (orquestrador)
  ├── RecoverySystem        (recovery_system.js)
  ├── HandleManager         (handle_manager.js)
  ├── InputResolver         (input_resolver.js)
  ├── FrameNavigator        (frame_navigator.js)
  ├── BiomechanicsEngine    (biomechanics_engine.js)
  └── SubmissionController  (submission_controller.js)
  ↓ herda
ChatGPTDriver (implementação concreta)
```

### Pontos Críticos

- **Telemetria**: Apenas 1 evento emitido (`TRIAGE_ALERT`)
- **Error handling**: Try-catch genérico sem classificação de erros
- **Validação**: Prerequisite validator integrado (v1.1)
- **Correlação**: Sistema de correlationId presente mas subutilizado

---

## 🐛 BUGS IDENTIFICADOS (8 Total)

### BUG #1: Telemetria Anêmica (CRÍTICO)

**Linha**: 67 (`_emitVital`) **Severidade**: ALTA **Sintoma**: Apenas 1 evento emitido em toda
execução de `sendPrompt()` (linha 174 TRIAGE_ALERT)

```javascript
// PROBLEMA: Método existe mas não é usado
_emitVital(type, payload) {
    this.emit('driver:vital', { type, payload, correlationId: this.correlationId, ts: Date.now() });
}

// ÚNICO USO: linha 174 (somente em ERRO)
this._emitVital('TRIAGE_ALERT', { ... });
```

**Impacto**:

- Dashboard não recebe progresso de execução
- Debugging impossível sem logs detalhados
- Telemetria só captura falhas, nunca sucessos

**Root Cause**: Código preparado para telemetria mas não instrumentado

**Fix**:

1. Emitir `EXECUTION_START` no início de `sendPrompt()`
2. Emitir `PREREQUISITE_CHECK` após validação
3. Emitir `MODULE_INVOKED` para cada subsistema chamado
4. Emitir `EXECUTION_SUCCESS` ao final
5. Emitir `RETRY_ATTEMPT` a cada retry

---

### BUG #2: Error History Overflow (MÉDIO)

**Linha**: 181-183 **Severidade**: MÉDIA **Sintoma**: Array `errorHistory` limitado a 10 itens mas
loop permite até 4 tentativas

```javascript
errorHistory.push({ attempt: attempts, error: err.message.substring(0, 200), ts: Date.now() });

if (errorHistory.length > 10) {
  errorHistory.shift(); // ⚠️ Nunca atinge 10 em 4 tentativas
}
```

**Problema**: Lógica inútil - máximo é 4 items (4 tentativas), limite é 10

**Fix**: Remover código morto OU aumentar tentativas para justificar limite

---

### BUG #3: Correlação Não Propagada (MÉDIO)

**Linha**: 47-51 **Severidade**: MÉDIA **Sintoma**: `setCorrelationId()` só propaga para
`inputResolver`, outros 5 módulos não recebem

```javascript
setCorrelationId(id) {
    this.correlationId = id;
    // ❌ Propaga APENAS para inputResolver
    if (this.inputResolver) {
        this.inputResolver.driver = this;
    }
    log('DEBUG', `[DRIVER] Contexto de rastro sincronizado: ${id}`, id);
}
```

**Módulos Órfãos**:

- `this.recovery`
- `this.handles`
- `this.frameNavigator`
- `this.biomechanics`
- `this.submission`

**Impacto**: Logs de subsistemas não correlacionados, debugging fragmentado

**Fix**: Loop para propagar `driver` a todos os 6 módulos

---

### BUG #4: Signal Check Desbalanceado (BAIXO)

**Linha**: 114, 130 **Severidade**: BAIXA **Sintoma**: Apenas 2 checks de `signal?.aborted`, mas
fluxo tem 7 etapas

```javascript
// CHECK #1: linha 114 (antes de waitIfBusy)
if (signal?.aborted) {
  throw new Error('OPERATION_ABORTED');
}

// CHECK #2: linha 130 (dentro do loop de retry)
if (signal?.aborted) {
  throw new Error('OPERATION_ABORTED');
}

// ❌ FALTAM CHECKS: entre etapas 3-7 (resolve, navigate, prepare, type, submit)
```

**Problema**: Operações longas (digitação, navegação) não podem ser interrompidas

**Fix**: Propagar `signal` para subsistemas e adicionar checks intermediários

---

### BUG #5: Falha Silenciosa em Cleanup (BAIXO)

**Linha**: 207-221 **Severidade**: BAIXA **Sintoma**: Erros de cleanup ignorados sem logging

```javascript
async destroy() {
    try {
        await this.handles.clearAll();
    } catch (_e) {
        /* Ignore cleanup errors */ // ❌ Silencioso
    }
    try {
        await this.biomechanics.releaseModifiers();
    } catch (_e) {
        /* Ignore release errors */ // ❌ Silencioso
    }
    // ...
}
```

**Problema**: Leaks de recursos não são detectados

**Fix**: Log warnings com correlationId

---

### BUG #6: Domain Update Não Propagado (BAIXO)

**Linha**: 82-92 **Severidade**: BAIXA **Sintoma**: `_updateDomain()` chamado apenas no constructor,
nunca atualizado

```javascript
constructor(page, config, signal) {
    super(page, config, signal);
    this.name = 'BaseUniversalDriver';
    this.currentDomain = this._updateDomain(); // ✅ Chamado AQUI
    // ...
}

// ❌ NUNCA mais chamado - domain fica fixo mesmo após navegação
```

**Impacto**: `currentDomain` desatualizado após redirecionamentos

**Fix**: Chamar `_updateDomain()` em checkpoints (pré-resolução, pós-submissão)

---

### BUG #7: Prerequisite Validator Não Propagado (MÉDIO)

**Linha**: 107-113 **Severidade**: MÉDIA **Sintoma**: Validação ocorre mas resultado não emitido via
telemetria

```javascript
const pageValidation = await validateLLMPage(this.page);

if (!pageValidation.valid) {
  const error = new Error(`PREREQUISITE_FAILED: ${pageValidation.reason}`);
  error.details = pageValidation.details;
  throw error; // ❌ Sem telemetria antes de throw
}
```

**Problema**: Dashboard não sabe que validação falhou, só vê erro genérico

**Fix**: Emitir `PREREQUISITE_CHECK` com resultado antes do throw

---

### BUG #8: Module Instantiation Sem Validação (BAIXO)

**Linha**: 32-38 **Severidade**: BAIXA **Sintoma**: Módulos instanciados sem verificar se
constructors retornaram instâncias válidas

```javascript
this.recovery = new RecoverySystem(this);
this.handles = new HandleManager(this);
// ... (sem verificação de null/undefined)
```

**Problema**: Se constructor falhar silenciosamente, `this.recovery` pode ser undefined

**Fix**: Validar após instanciação OU usar try-catch com fallback

---

## ✨ MELHORIAS IDENTIFICADAS (12 Total)

### MELHORIA #1: Telemetria Completa (ALTA PRIORIDADE)

**Impacto**: Dashboard em tempo real, debugging granular **Esforço**: Médio (adicionar 10-15
eventos)

**Eventos a Adicionar**:

```javascript
// sendPrompt() - início
this._emitVital('EXECUTION_START', { taskId, textLength: text.length });

// Após validateLLMPage()
this._emitVital('PREREQUISITE_CHECK', {
  valid: pageValidation.valid,
  reason: pageValidation.reason,
});

// Após inputResolver.resolve()
this._emitVital('SELECTOR_RESOLVED', {
  selector: proto.selector,
  confidence: proto.confidence,
});

// Após frameNavigator.getExecutionContext()
this._emitVital('CONTEXT_ACQUIRED', {
  depth: execContext.depth,
  type: execContext.type,
});

// Antes de biomechanics.typeText()
this._emitVital('TYPING_START', { textLength: text.length });

// Após submission.submit()
this._emitVital('SUBMISSION_SUCCESS', { taskId });

// Final
this._emitVital('EXECUTION_SUCCESS', { taskId, attempts, duration: Date.now() - startTime });
```

---

### MELHORIA #2: Constants para Magic Numbers (ALTA)

**Impacto**: Manutenibilidade **Esforço**: Baixo

```javascript
// ❌ ATUAL (linha 121)
while (attempts < 4) { ... }

// ✅ PROPOSTO
const BASEDRIVER_CONFIG = {
    MAX_RETRY_ATTEMPTS: 4,
    ERROR_HISTORY_SIZE: 10,
    PREREQUISITE_TIMEOUT: 5000
};

while (attempts < BASEDRIVER_CONFIG.MAX_RETRY_ATTEMPTS) { ... }
```

**Incluir**:

- `MAX_RETRY_ATTEMPTS` (4)
- `ERROR_HISTORY_SIZE` (10)
- `WAIT_IF_BUSY_TIMEOUT`
- `DOMAIN_UPDATE_INTERVAL`

---

### MELHORIA #3: Error Classification (ALTA)

**Impacto**: Recovery inteligente, logs estruturados **Esforço**: Médio

```javascript
// ❌ ATUAL (linha 166)
} catch (err) {
    if (err.message === 'OPERATION_ABORTED') {
        throw err;
    }
    // Tudo tratado igual
}

// ✅ PROPOSTO
} catch (err) {
    const errorClass = this._classifyError(err);

    switch (errorClass) {
        case 'ABORT': throw err;
        case 'FATAL': throw err; // Não retryável
        case 'TRANSIENT': break; // Retry
        case 'TIMEOUT': /* Ajustar estratégia */
        case 'SELECTOR': /* Invalidar cache */
    }
}

_classifyError(err) {
    if (err.message === 'OPERATION_ABORTED') return 'ABORT';
    if (err.message === 'TARGET_CLOSED') return 'FATAL';
    if (err.message.includes('timeout')) return 'TIMEOUT';
    if (err.message.includes('selector')) return 'SELECTOR';
    return 'TRANSIENT';
}
```

---

### MELHORIA #4: Timing Metrics (MÉDIA)

**Impacto**: Performance insights, SLA tracking **Esforço**: Baixo

```javascript
async sendPrompt(text, taskId, signal) {
    const startTime = Date.now();
    const timings = {};

    // Antes de cada etapa
    let stepStart = Date.now();

    // Após cada etapa
    timings.validation = Date.now() - stepStart;
    stepStart = Date.now();

    // Ao final
    this._emitVital('EXECUTION_METRICS', {
        taskId,
        totalDuration: Date.now() - startTime,
        timings: {
            prerequisite: timings.validation,
            resolution: timings.resolution,
            typing: timings.typing,
            submission: timings.submission
        }
    });
}
```

---

### MELHORIA #5: Signal Propagation (MÉDIA)

**Impacto**: Cancelamento responsivo **Esforço**: Médio

```javascript
// ✅ Propagar signal para subsistemas
await this.biomechanics.typeText(execContext.ctx, proto.selector, text, signal);
await this.submission.submit(execContext.ctx, proto.selector, taskId, signal);

// ✅ Adicionar checks intermediários
if (signal?.aborted) {
  this._emitVital('EXECUTION_ABORTED', { stage: 'typing', taskId });
  throw new Error('OPERATION_ABORTED');
}
```

---

### MELHORIA #6: Module Health Checks (BAIXA)

**Impacto**: Diagnóstico proativo **Esforço**: Baixo

```javascript
async getModuleHealth() {
    return {
        recovery: this.recovery.isHealthy(),
        handles: this.handles.getActiveCount(),
        inputResolver: this.inputResolver.getCacheStatus(),
        frameNavigator: this.frameNavigator.getDepth(),
        biomechanics: this.biomechanics.getState(),
        submission: this.submission.isLocked()
    };
}
```

---

### MELHORIA #7: Correlation ID Auto-Generation (BAIXA)

**Impacto**: Uso simplificado **Esforço**: Baixo

```javascript
constructor(page, config, signal) {
    super(page, config, signal);
    this.correlationId = this._generateCorrelationId(); // ✅ Auto
    // ...
}

_generateCorrelationId() {
    return `drv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
```

---

### MELHORIA #8: Retry Strategy Configurável (MÉDIA)

**Impacto**: Flexibilidade **Esforço**: Médio

```javascript
// ✅ Config em BASEDRIVER_CONFIG
RETRY_STRATEGY: {
    MAX_ATTEMPTS: 4,
    BACKOFF_TYPE: 'exponential', // linear, exponential, fixed
    BASE_DELAY: 1000,
    MAX_DELAY: 10000
}

// ✅ Implementar backoff
async _applyBackoff(attempt) {
    const { RETRY_STRATEGY } = BASEDRIVER_CONFIG;
    const delay = RETRY_STRATEGY.BACKOFF_TYPE === 'exponential'
        ? Math.min(RETRY_STRATEGY.BASE_DELAY * Math.pow(2, attempt), RETRY_STRATEGY.MAX_DELAY)
        : RETRY_STRATEGY.BASE_DELAY;

    this._emitVital('RETRY_BACKOFF', { attempt, delay });
    await new Promise(r => setTimeout(r, delay));
}
```

---

### MELHORIA #9: JSDoc Completo (BAIXA)

**Impacto**: Developer experience **Esforço**: Baixo

```javascript
/**
 * Executa envio de prompt com retry escalonado e telemetria completa.
 *
 * @param {string} text - Conteúdo do prompt a enviar
 * @param {string} taskId - UUID da task (para correlação)
 * @param {AbortSignal} [signal] - Sinal de cancelamento (opcional)
 * @returns {Promise<void>}
 * @throws {Error} PREREQUISITE_FAILED - Página inválida
 * @throws {Error} OPERATION_ABORTED - Sinal de cancelamento
 * @throws {Error} EXECUTION_FAIL - Máximo de tentativas excedido
 *
 * @emits {object} EXECUTION_START - Início de execução
 * @emits {object} EXECUTION_SUCCESS - Sucesso após N tentativas
 * @emits {object} TRIAGE_ALERT - Falha em tentativa individual
 */
async sendPrompt(text, taskId, signal) { ... }
```

---

### MELHORIA #10: Readonly Properties (BAIXA)

**Impacto**: Imutabilidade, prevenção de bugs **Esforço**: Baixo

```javascript
constructor(page, config, signal) {
    super(page, config, signal);

    // ✅ Readonly via Object.defineProperty
    Object.defineProperty(this, 'name', {
        value: 'BaseUniversalDriver',
        writable: false
    });

    this.currentDomain = this._updateDomain();
    this.correlationId = this._generateCorrelationId();

    // ✅ Freeze module references
    Object.freeze({
        recovery: this.recovery,
        handles: this.handles,
        inputResolver: this.inputResolver,
        frameNavigator: this.frameNavigator,
        biomechanics: this.biomechanics,
        submission: this.submission
    });
}
```

---

### MELHORIA #11: Async Cleanup Garantido (MÉDIA)

**Impacto**: Resource leak prevention **Esforço**: Baixo

```javascript
async destroy() {
    const cleanupErrors = [];

    const cleanupSteps = [
        { name: 'handles', fn: () => this.handles.clearAll() },
        { name: 'biomechanics', fn: () => this.biomechanics.releaseModifiers() },
        { name: 'inputResolver', fn: () => this.inputResolver.clearCache() },
        { name: 'submission', fn: () => this.submission.clearLock() }
    ];

    for (const step of cleanupSteps) {
        try {
            await step.fn();
        } catch (err) {
            cleanupErrors.push({ module: step.name, error: err.message });
            log('WARN', `[${this.name}] Cleanup ${step.name} failed: ${err.message}`, this.correlationId);
        }
    }

    if (cleanupErrors.length > 0) {
        this._emitVital('CLEANUP_WARNINGS', { errors: cleanupErrors });
    }

    this.removeAllListeners();
    log('DEBUG', `[${this.name}] Cleanup concluído. Erros: ${cleanupErrors.length}`, this.correlationId);
}
```

---

### MELHORIA #12: Domain Update Hook (BAIXA)

**Impacto**: Domain tracking acurado **Esforço**: Baixo

```javascript
async sendPrompt(text, taskId, signal) {
    // ✅ Update domain antes de resolver
    const previousDomain = this.currentDomain;
    this.currentDomain = this._updateDomain();

    if (previousDomain !== this.currentDomain) {
        this._emitVital('DOMAIN_CHANGED', {
            from: previousDomain,
            to: this.currentDomain
        });
    }

    // ...
}
```

---

## 📋 Checklist de Upgrade v2.0

### Fase 1: Bug Fixes Críticos (P0)

- [ ] **BUG #1**: Instrumentar telemetria completa (10+ eventos)
- [ ] **BUG #3**: Propagar correlationId para todos os 6 módulos
- [ ] **BUG #7**: Emitir PREREQUISITE_CHECK antes de throw

### Fase 2: Melhorias de Arquitetura (P1)

- [ ] **MELHORIA #1**: Adicionar 15+ eventos de telemetria
- [ ] **MELHORIA #2**: Criar BASEDRIVER_CONFIG com constants
- [ ] **MELHORIA #3**: Implementar error classification
- [ ] **MELHORIA #4**: Adicionar timing metrics
- [ ] **MELHORIA #5**: Propagar signal para subsistemas

### Fase 3: Robustez e DX (P2)

- [ ] **BUG #2**: Remover código morto (error history limit)
- [ ] **BUG #4**: Adicionar signal checks intermediários
- [ ] **BUG #5**: Log warnings em cleanup
- [ ] **BUG #6**: Update domain em checkpoints
- [ ] **MELHORIA #6**: Adicionar getModuleHealth()
- [ ] **MELHORIA #8**: Implementar retry backoff configurável
- [ ] **MELHORIA #11**: Cleanup garantido com error collection

### Fase 4: Polish (P3)

- [ ] **BUG #8**: Validar module instantiation
- [ ] **MELHORIA #7**: Auto-generation de correlationId
- [ ] **MELHORIA #9**: JSDoc completo
- [ ] **MELHORIA #10**: Readonly properties
- [ ] **MELHORIA #12**: Domain update hook

---

## 📊 Métricas de Upgrade

### Antes (v1.1)

- **Linhas**: 228
- **Telemetria**: 1 evento (TRIAGE_ALERT)
- **Constants**: 0 (magic numbers)
- **Error handling**: Genérico
- **Timing**: Não rastreado
- **Signal checks**: 2
- **JSDoc**: Parcial

### Após (v2.0 Estimado)

- **Linhas**: ~340 (+112, +49%)
- **Telemetria**: 18+ eventos (18x aumento)
- **Constants**: 8 config keys (BASEDRIVER_CONFIG)
- **Error handling**: Classificação em 5 categorias
- **Timing**: 7 checkpoints
- **Signal checks**: 6 (+4)
- **JSDoc**: Completo com @emits

---

## 🎯 Priorização de Trabalho

### Impacto Alto + Esforço Baixo (QUICK WINS)

1. **MELHORIA #2**: Constants (5 min)
2. **MELHORIA #7**: Auto correlationId (5 min)
3. **BUG #5**: Log cleanup warnings (5 min)
4. **MELHORIA #4**: Timing metrics (10 min)

### Impacto Alto + Esforço Médio (CORE WORK)

1. **BUG #1 + MELHORIA #1**: Telemetria completa (30 min)
2. **BUG #3**: Correlation propagation (10 min)
3. **MELHORIA #3**: Error classification (20 min)
4. **MELHORIA #5**: Signal propagation (15 min)

### Impacto Médio (ENHANCEMENT)

1. **MELHORIA #8**: Retry backoff (20 min)
2. **BUG #7**: Prerequisite telemetry (5 min)
3. **MELHORIA #11**: Cleanup garantido (15 min)

### Impacto Baixo (POLISH)

1. **BUG #2, #4, #6, #8**: Fixes menores (20 min total)
2. **MELHORIA #6, #9, #10, #12**: DX improvements (30 min total)

**Tempo Total Estimado**: ~3.5 horas

---

## 🔗 Dependências de Upgrade

### Pré-requisitos

✅ **human.js v2.0** - COMPLETO ✅ **stabilizer.js v2.0** - COMPLETO ⏭️ **TargetDriver.js v2.0** -
PENDENTE (herança)

### Impacta Diretamente

- `ChatGPTDriver.js` (herda de BaseDriver)
- `DriverLifecycleManager.js` (instancia BaseDriver)
- `driver_nerv_adapter.js` (escuta eventos de BaseDriver)

### Requer Upgrades Subsequentes

- `RecoverySystem` (recebe signal)
- `BiomechanicsEngine` (recebe signal)
- `SubmissionController` (recebe signal)

---

## 📝 Notas de Implementação

### Estratégia de Telemetria

- **Regra**: Emitir evento ANTES de cada operação blocking
- **Razão**: Se operação travar, último evento indica onde
- **Pattern**: `this._emitVital('<STAGE>_START', { ... })` → operação → `<STAGE>_SUCCESS`

### Error Classification Pattern

```javascript
const ERROR_CLASSES = {
  ABORT: ['OPERATION_ABORTED'],
  FATAL: ['TARGET_CLOSED', 'PAGE_DESTROYED'],
  TIMEOUT: ['timeout', 'Navigation timeout', 'waitForSelector'],
  SELECTOR: ['No node found', 'selector'],
  TRANSIENT: [], // Default
};
```

### Module Health Check Pattern

- **Frequência**: On-demand via `getModuleHealth()`
- **Uso**: Pre-flight check, diagnostics endpoint
- **Retorno**: Object com status booleano ou métrica numérica

---

## ✅ Conclusão

**BaseDriver.js está funcional mas sub-instrumentado.**

### Pontos Fortes ✅

- Arquitetura modular bem definida
- Prerequisite validation integrada
- Error history tracking
- Cleanup robusto
- Retry logic funcional

### Gaps Críticos ❌

- **Telemetria anêmica**: 1 evento vs 18+ necessários
- **Correlação incompleta**: 5 de 6 módulos órfãos
- **Magic numbers**: 0 constants, código hardcoded
- **Error handling genérico**: Sem classificação
- **Signal propagation incompleto**: Cancelamento ineficaz

### Recomendação

**Upgrade JUSTIFICADO** - BaseDriver é **fundação de todo driver system**. Instrumentação adequada
impacta diretamente:

- Dashboard real-time
- Debugging de produção
- SLA tracking
- Error analytics

**Prioridade**: **P1 (Core Architecture)** - Fazer **ANTES** de ChatGPTDriver

**Tempo**: 3.5h (Quick Wins: 30min, Core: 1.5h, Enhancement: 1h, Polish: 30min)

---

**Status**: ✅ **AUDIT COMPLETO - PRONTO PARA IMPLEMENTAÇÃO**
