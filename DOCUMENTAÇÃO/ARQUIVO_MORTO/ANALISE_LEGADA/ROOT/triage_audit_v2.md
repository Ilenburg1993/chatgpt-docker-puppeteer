# triage.js v2.0 - Comprehensive Audit Report

**Data**: 2026-02-01 **Versão Atual**: v1.x (CONSOLIDATED Protocol 11) **Audit Level**: 500
(Instrumented Diagnostic Triage IPC 2.0) **Status**: CONSOLIDATED

---

## 📊 Executive Summary

| Metric               | Value                                           |
| -------------------- | ----------------------------------------------- |
| **Lines of Code**    | 248 linhas                                      |
| **Type**             | Module (function export)                        |
| **Functions**        | 1 public (`diagnoseStall`)                      |
| **Events**           | 0 local (usa IPC via NERV)                      |
| **Config**           | 2 constants (SNAPSHOT_DELAY_MS, MAX_TEXT_PARTS) |
| **JSDoc**            | 10% (apenas function signature)                 |
| **EventEmitter**     | ❌ Não                                          |
| **Metrics Tracking** | ❌ Não                                          |
| **Validation**       | ❌ Mínima                                       |

---

## 🎯 Responsibilities

O `triage.js` é o **sistema de diagnóstico em tempo real** do driver, responsável por:

1. **Detecção de Travamentos**: Browser frozen, event loop lag
2. **Detecção de Barreiras**: CAPTCHA, Cloudflare, CORS, CSP
3. **Detecção de Erros**: Login required, quota exceeded, generic errors
4. **Detecção de Anomalias**: Logical loops (spinning sem progresso), visual errors (cores de
   alerta)
5. **Análise Semântica**: Varredura de DOM + Shadow DOM + IFrames para detectar padrões
6. **Telemetria**: Diagnostics para RemediationEngine (recovery decisions)

---

## 🔍 Current Implementation Analysis

### Architecture Overview

```javascript
// triage.js v1.x (248 lines)
const stabilizer = require('@shared/page_stability/stabilizer');
const { STATUS_VALUES } = require('@core/constants/tasks.js');
const i18n = require('@core/i18n');
const { log } = require('@core/logger');

// ❌ No EventEmitter
// ❌ No TRIAGE_CONFIG
// ❌ No metrics tracking

async function diagnoseStall(page, langCode = 'en') {
    // 1. Event loop lag check (via stabilizer)
    const lag = await stabilizer.measureEventLoopLag(page);
    if (lag > 1500) {
        return { type: 'BROWSER_FROZEN', severity: 'CRITICAL', ... };
    }

    // 2. Get i18n terms (error indicators, close actions)
    const errorTerms = await i18n.getTerms('error_indicators', langCode);
    const closeTerms = await i18n.getTerms('close_actions', langCode);

    // 3. Execute diagnostic probe in browser context (page.evaluate)
    const diagnosis = await page.evaluate(async (errors, closers, delayMs, maxParts) => {
        // In-browser diagnostic engine (Probe object)
        const Probe = {
            // Single-pass DOM scan (text, nodes, password, spinners, buttons)
            scan: (root, acc, depth) => { ... },

            // Visual error detection (red/orange colors)
            checkVisualError: buttons => { ... }
        };

        // Capture snapshot 1
        const snap1 = Probe.scan();

        // Wait for entropy detection
        await new Promise(r => setTimeout(r, delayMs));

        // Capture snapshot 2
        const snap2 = Probe.scan();

        // Analysis logic (7 detection patterns)
        // 2. CAPTCHA/Cloudflare detection
        // 3. Login required (password input)
        // 4. CORS/CSP barriers (cross-origin iframe)
        // 5. Quota/limit detection
        // 6. Generic error text
        // 7. Visual error (color-based)
        // 8. Finished abruptly (retry without stop)
        // 9. Logical loop (spinning without progress)

        return diagnosis || null;
    }, errorTerms, closeTerms, SNAPSHOT_DELAY_MS, MAX_TEXT_PARTS);

    return diagnosis || { type: STATUS_VALUES.HEALTHY, severity: 'NONE', ... };
}

module.exports = { diagnoseStall };
```

### Dependencies

- **stabilizer**: Event loop lag measurement
- **STATUS_VALUES**: Task status constants
- **i18n**: Error terms localization
- **logger**: Error logging

### Diagnostic Patterns (9 total)

1. **BROWSER_FROZEN**: Event loop lag > 1500ms
2. **CAPTCHA_CHALLENGE**: Cloudflare/captcha semantic detection
3. **LOGIN_REQUIRED**: Password input detected
4. **INFRA_BARRIER_DETECTED**: Cross-origin iframe blocking >40% viewport
5. **LIMIT_REACHED**: Quota/limit semantic detection
6. **GENERIC_ERROR_TEXT**: Error terms in DOM
7. **VISUAL_ERROR_DETECTED**: Red/orange color alerts
8. **FINISHED_ABRUPTLY**: Retry button without stop button
9. **LOGICAL_LOOP**: Spinners active without DOM mutation

---

## 🐛 Bugs Identified (10 total)

### ❌ BUG #1: Não herda EventEmitter (P0 - CRITICAL)

- **Impact**: Inconsistência com stack v2.0 (todos os outros módulos são EventEmitter)
- **Evidence**: `module.exports = { diagnoseStall }` (function export)
- **Expected**: `class Triage extends EventEmitter`
- **RICE Score**: Reach: 5, Impact: 5, Confidence: 5, Effort: 2 → **62.5**

### ❌ BUG #2: Zero configuração centralizada (P1 - HIGH)

- **Impact**: Hardcoded constants (SNAPSHOT_DELAY_MS: 600ms, MAX_TEXT_PARTS: 1000)
- **Evidence**: No `TRIAGE_CONFIG` object
- **Expected**: Config via env vars (LAG_THRESHOLD_MS, SNAPSHOT_DELAY_MS, MAX_TEXT_PARTS,
  MAX_SCAN_DEPTH, etc.)
- **RICE Score**: Reach: 5, Impact: 4, Confidence: 5, Effort: 2 → **50.0**

### ❌ BUG #3: Nenhum metrics tracking (P2 - MEDIUM)

- **Impact**: Zero observabilidade de performance/detecções
- **Evidence**: No stats object, no counters
- **Expected**: Metrics (totalDiagnoses, patterns detected, timing, scan depth)
- **RICE Score**: Reach: 4, Impact: 4, Confidence: 5, Effort: 3 → **26.7**

### ❌ BUG #4: Validação de parâmetros ausente (P2 - MEDIUM)

- **Impact**: Função aceita page null/undefined sem validação
- **Evidence**: `async function diagnoseStall(page, langCode = 'en')` → no checks
- **Expected**: Validate page.evaluate, page.title, langCode
- **RICE Score**: Reach: 4, Impact: 3, Confidence: 5, Effort: 1 → **60.0**

### ❌ BUG #5: Timeout protection ausente (P1 - HIGH)

- **Impact**: page.evaluate pode travar indefinidamente (browser frozen)
- **Evidence**: No timeout wrapper em page.evaluate (248 linhas de browser code)
- **Expected**: Promise.race com timeout (default: 10s)
- **RICE Score**: Reach: 5, Impact: 5, Confidence: 4, Effort: 2 → **50.0**

### ❌ BUG #6: JSDoc incompleto (P3 - LOW)

- **Impact**: Apenas 10% documentado (function signature)
- **Evidence**: No JSDoc para Probe.scan, Probe.checkVisualError, patterns
- **Expected**: JSDoc 100% (all methods + patterns)
- **RICE Score**: Reach: 3, Impact: 2, Confidence: 5, Effort: 4 → **7.5**

### ❌ BUG #7: Nenhum AbortSignal support (P3 - LOW)

- **Impact**: Não pode cancelar diagnósticos longos
- **Evidence**: Função não aceita AbortSignal
- **Expected**: signal parameter + checks
- **RICE Score**: Reach: 3, Impact: 3, Confidence: 4, Effort: 2 → **18.0**

### ❌ BUG #8: Error handling limitado (P2 - MEDIUM)

- **Impact**: Try-catch genérico retorna DIAGNOSTIC_CRASH (perde contexto)
- **Evidence**: `catch (e) { ... return { type: 'DIAGNOSTIC_CRASH' } }`
- **Expected**: TriageError class com type/context
- **RICE Score**: Reach: 4, Impact: 4, Confidence: 4, Effort: 2 → **32.0**

### ❌ BUG #9: Hardcoded lag threshold (P2 - MEDIUM)

- **Impact**: `if (lag > 1500)` → não configurável
- **Evidence**: Magic number 1500ms
- **Expected**: Config key (LAG_THRESHOLD_MS: 1500)
- **RICE Score**: Reach: 4, Impact: 3, Confidence: 5, Effort: 1 → **60.0**

### ❌ BUG #10: Sem retry logic para stabilizer (P3 - LOW)

- **Impact**: Falha em measureEventLoopLag pode crashar diagnostic
- **Evidence**: `const lag = await stabilizer.measureEventLoopLag(page);` → no retry
- **Expected**: Retry wrapper (3 attempts)
- **RICE Score**: Reach: 3, Impact: 3, Confidence: 4, Effort: 2 → **18.0**

---

## ✨ Improvements Suggested (10 total)

### 1. EventEmitter Class Architecture

**Implementar classe Triage extends EventEmitter**

```javascript
class Triage extends EventEmitter {
  constructor(page, langCode = 'en') {
    super();
    // Validation
    // Metrics initialization
  }

  async diagnose(signal) {
    this.emit('triage:diagnosis_started', { langCode: this.langCode });
    // ... diagnosis logic
    this.emit('triage:diagnosis_completed', { result, duration });
  }
}
```

**Eventos propostos** (8 total):

- `triage:diagnosis_started` (diagnóstico iniciado)
- `triage:diagnosis_completed` (diagnóstico completo)
- `triage:diagnosis_failed` (diagnóstico falhou)
- `triage:lag_detected` (event loop lag detectado)
- `triage:pattern_detected` (padrão detectado: CAPTCHA, LOGIN, ERROR, etc.)
- `triage:scan_started` (varredura DOM iniciada)
- `triage:scan_completed` (varredura DOM completa)
- `triage:timeout_reached` (timeout excedido)

**Benefits**:

- Consistência com stack v2.0 (14 modules EventEmitter)
- Observable diagnostic lifecycle
- Hook points para extensões
- Drop-in replacement (backward compatible)

---

### 2. TRIAGE_CONFIG Object

**Centralizar todas as configurações**

```javascript
const TRIAGE_CONFIG = {
  // Lag detection
  LAG_THRESHOLD_MS: parseInt(process.env.TRIAGE_LAG_THRESHOLD || '1500'),
  LAG_RETRY_ATTEMPTS: parseInt(process.env.TRIAGE_LAG_RETRIES || '3'),

  // Snapshot timing
  SNAPSHOT_DELAY_MS: parseInt(process.env.TRIAGE_SNAPSHOT_DELAY || '600'),

  // Scan limits
  MAX_TEXT_PARTS: parseInt(process.env.TRIAGE_MAX_TEXT_PARTS || '1000'),
  MAX_SCAN_DEPTH: parseInt(process.env.TRIAGE_MAX_DEPTH || '15'),

  // Timeouts
  DIAGNOSIS_TIMEOUT_MS: parseInt(process.env.TRIAGE_TIMEOUT || '10000'),
  SCAN_TIMEOUT_MS: parseInt(process.env.TRIAGE_SCAN_TIMEOUT || '5000'),

  // Visual error detection
  ERROR_COLOR_RED_THRESHOLD: parseInt(process.env.TRIAGE_RED_THRESHOLD || '180'),
  ERROR_COLOR_ORANGE_THRESHOLD: parseInt(process.env.TRIAGE_ORANGE_THRESHOLD || '200'),

  // Barrier detection
  IFRAME_SIZE_THRESHOLD: parseFloat(process.env.TRIAGE_IFRAME_THRESHOLD || '0.4'),
};
```

**Benefits**:

- Tunable via env vars
- Consistent with v2.0 pattern
- Easy testing (override config)
- Production optimization

---

### 3. Complete Validation

**Validar todos os parâmetros no constructor**

```javascript
constructor(page, langCode = 'en') {
    super();

    // ✅ Validate page
    if (!page) {
        throw new Error('[Triage] Page is required');
    }
    if (typeof page.evaluate !== 'function') {
        throw new Error('[Triage] Page must have evaluate method');
    }

    // ✅ Validate langCode
    if (typeof langCode !== 'string' || langCode.length === 0) {
        throw new Error('[Triage] langCode must be a non-empty string');
    }

    this.page = page;
    this.langCode = langCode;

    // Metrics initialization
    this.stats = {
        totalDiagnoses: 0,
        successfulDiagnoses: 0,
        failedDiagnoses: 0,
        patternsDetected: { /* per pattern counters */ },
        totalScanTime: 0,
        maxScanTime: 0,
        totalLagMeasurements: 0,
        avgLag: 0
    };
}
```

**Benefits**:

- Early error detection
- Clear error messages
- Consistent with v2.0 validation pattern
- Prevents runtime crashes

---

### 4. JSDoc 100%

**Documentar todas as classes, métodos e padrões**

Adicionar JSDoc completo (~200+ linhas):

- Class documentation com @extends, @example
- Method documentation com @param, @returns, @throws, @emits
- Pattern detection documentation (cada um dos 9 padrões)
- Probe object documentation (scan, checkVisualError)
- Config documentation (@readonly, @enum)
- Error class documentation

**Benefits**:

- IntelliSense support
- API discoverability
- Maintenance clarity
- Onboarding acceleration

---

### 5. Metrics Tracking (12 counters)

**Rastrear todas as métricas de diagnóstico**

```javascript
this.stats = {
  // Diagnosis
  totalDiagnoses: 0,
  successfulDiagnoses: 0,
  failedDiagnoses: 0,
  timeoutDiagnoses: 0,

  // Patterns (per-pattern counters)
  patternsDetected: {
    BROWSER_FROZEN: 0,
    CAPTCHA_CHALLENGE: 0,
    LOGIN_REQUIRED: 0,
    INFRA_BARRIER_DETECTED: 0,
    LIMIT_REACHED: 0,
    GENERIC_ERROR_TEXT: 0,
    VISUAL_ERROR_DETECTED: 0,
    FINISHED_ABRUPTLY: 0,
    LOGICAL_LOOP: 0,
  },

  // Timing
  totalDiagnosisTime: 0,
  maxDiagnosisTime: 0,
  totalScanTime: 0,

  // Lag
  totalLagMeasurements: 0,
  totalLag: 0,
  maxLag: 0,
};
```

**Derived metrics**:

- `avgDiagnosisTime`: totalDiagnosisTime / totalDiagnoses
- `successRate`: successfulDiagnoses / totalDiagnoses \* 100
- `avgLag`: totalLag / totalLagMeasurements
- `mostCommonPattern`: argmax(patternsDetected)

**getStats() method**:

```javascript
getStats() {
    return {
        ...this.stats,
        avgDiagnosisTime: this.stats.totalDiagnoses > 0
            ? (this.stats.totalDiagnosisTime / this.stats.totalDiagnoses).toFixed(2) + 'ms'
            : '0ms',
        successRate: this.stats.totalDiagnoses > 0
            ? ((this.stats.successfulDiagnoses / this.stats.totalDiagnoses) * 100).toFixed(2) + '%'
            : '0%',
        avgLag: this.stats.totalLagMeasurements > 0
            ? (this.stats.totalLag / this.stats.totalLagMeasurements).toFixed(2) + 'ms'
            : '0ms',
        config: { ...TRIAGE_CONFIG }
    };
}
```

---

### 6. Timeout Protection

**Promise.race em todas as operações críticas**

```javascript
async diagnose(signal) {
    this.emit('triage:diagnosis_started', { langCode: this.langCode });
    this.stats.totalDiagnoses++;
    const startTime = Date.now();

    try {
        // ✅ Timeout protection
        const result = await Promise.race([
            this._executeDiagnosis(signal),
            this._timeout(TRIAGE_CONFIG.DIAGNOSIS_TIMEOUT_MS, 'diagnose')
        ]);

        const duration = Date.now() - startTime;
        this.stats.totalDiagnosisTime += duration;
        this.stats.maxDiagnosisTime = Math.max(this.stats.maxDiagnosisTime, duration);
        this.stats.successfulDiagnoses++;

        this.emit('triage:diagnosis_completed', { result, duration });

        return result;
    } catch (err) {
        this.stats.failedDiagnoses++;

        if (err.type === 'TIMEOUT') {
            this.stats.timeoutDiagnoses++;
            this.emit('triage:timeout_reached', { timeout: err.context.timeout });
        }

        this.emit('triage:diagnosis_failed', { error: err.message });
        throw err;
    }
}

// Helper: Timeout wrapper
_timeout(ms, operation) {
    return new Promise((_, reject) => {
        setTimeout(() => {
            const error = new TriageError('TIMEOUT', `Timeout in ${operation} after ${ms}ms`, {
                timeout: ms,
                operation
            });
            reject(error);
        }, ms);
    });
}
```

---

### 7. AbortSignal Support

**Permitir cancelamento de diagnósticos**

```javascript
async diagnose(signal) {
    // ... existing code

    // ✅ Signal check antes de operações pesadas
    if (signal?.aborted) {
        throw new TriageError('ABORTED', 'Diagnosis aborted', {
            langCode: this.langCode
        });
    }

    // Pass signal para page.evaluate (via context)
    const diagnosis = await this.page.evaluate(async (config) => {
        // In-browser check via polling
        // (AbortSignal não pode ser serializado para page.evaluate)
        // Alternativa: timeout protection
    }, { ...config });
}
```

---

### 8. Enhanced Error Handling

**Classe customizada TriageError**

```javascript
class TriageError extends Error {
  constructor(type, message, context) {
    super(message);
    this.name = 'TriageError';
    this.type = type; // TIMEOUT, ABORTED, INVALID_PAGE, SCAN_FAILED, PATTERN_DETECTION_FAILED
    this.context = context;
    this.timestamp = Date.now();
  }
}
```

**Usage**:

```javascript
try {
  const lag = await this._measureLagWithRetry();
} catch (err) {
  throw new TriageError('LAG_MEASUREMENT_FAILED', err.message, {
    attempts: 3,
    langCode: this.langCode,
  });
}
```

---

### 9. Retry Logic para Stabilizer

**Wrapper com retry para measureEventLoopLag**

```javascript
async _measureLagWithRetry() {
    for (let attempt = 0; attempt < TRIAGE_CONFIG.LAG_RETRY_ATTEMPTS; attempt++) {
        try {
            const lag = await stabilizer.measureEventLoopLag(this.page);

            this.stats.totalLagMeasurements++;
            this.stats.totalLag += lag;
            this.stats.maxLag = Math.max(this.stats.maxLag, lag);

            if (lag > TRIAGE_CONFIG.LAG_THRESHOLD_MS) {
                this.emit('triage:lag_detected', { lag, threshold: TRIAGE_CONFIG.LAG_THRESHOLD_MS });
            }

            return lag;
        } catch (err) {
            log('WARN', `[TRIAGE] Lag measurement attempt ${attempt + 1}/${TRIAGE_CONFIG.LAG_RETRY_ATTEMPTS} failed: ${err.message}`);

            if (attempt === TRIAGE_CONFIG.LAG_RETRY_ATTEMPTS - 1) {
                throw err;
            }

            // Backoff
            await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        }
    }
}
```

---

### 10. Module Exports Completo

**Exportar classe + config + eventos + factory**

```javascript
module.exports = {
  Triage,
  TRIAGE_CONFIG,
  TRIAGE_EVENTS,
  TriageError,
  create: (page, langCode) => new Triage(page, langCode),

  // ✅ Backward compatibility (legacy function export)
  diagnoseStall: async (page, langCode) => {
    const triage = new Triage(page, langCode);
    return await triage.diagnose();
  },
};
```

**Benefits**:

- Consistent with v2.0 pattern (todas as outras 13 modules)
- Factory function para convenience
- Backward compatibility (diagnoseStall preserved)
- Named exports para tree-shaking

---

## 📈 Implementation Plan

### Transformation Estimate

| Metric          | v1.x | v2.0                                                                                      | Δ            |
| --------------- | ---- | ----------------------------------------------------------------------------------------- | ------------ |
| **Lines**       | 248  | ~620                                                                                      | +372 (+150%) |
| **Classes**     | 0    | 2 (Triage, TriageError)                                                                   | +2           |
| **Methods**     | 1    | 6 (diagnose, \_executeDiagnosis, \_measureLagWithRetry, \_timeout, getStats, constructor) | +5           |
| **Events**      | 0    | 8 (TRIAGE_EVENTS)                                                                         | +8           |
| **Config Keys** | 2    | 10 (TRIAGE_CONFIG)                                                                        | +8           |
| **Metrics**     | 0    | 12 counters + 4 derived                                                                   | +16          |
| **JSDoc Lines** | ~10  | ~200                                                                                      | +190         |
| **Validation**  | ❌   | ✅                                                                                        | Full         |
| **Timeout**     | ❌   | ✅                                                                                        | Yes          |
| **AbortSignal** | ❌   | ✅                                                                                        | Yes          |

**Estimated Effort**: 15-18 hours (5 sprints)

---

### Sprint Breakdown

#### Sprint 1: P0 - EventEmitter + Config (4-5h)

- [ ] BUG #1: Convert to EventEmitter class
- [ ] BUG #2: TRIAGE_CONFIG object (10 keys)
- [ ] IMPROVEMENT #1: 8 eventos locais
- [ ] IMPROVEMENT #2: Config via env vars
- [ ] Validation: Class structure

#### Sprint 2: P1 - Validation + Timeout (5-6h)

- [ ] BUG #4: Parameter validation (page, langCode)
- [ ] BUG #5: Timeout protection (Promise.race)
- [ ] BUG #9: Config-based lag threshold
- [ ] IMPROVEMENT #3: Complete validation
- [ ] IMPROVEMENT #6: Timeout wrapper
- [ ] Validation: Timeout scenarios

#### Sprint 3: P2 - Metrics + Error Handling (4-5h)

- [ ] BUG #3: Metrics tracking (12 counters)
- [ ] BUG #8: TriageError class
- [ ] IMPROVEMENT #5: getStats() method
- [ ] IMPROVEMENT #8: Enhanced error handling
- [ ] Validation: Metrics accuracy

#### Sprint 4: P3 - JSDoc + Retry + AbortSignal (3-4h)

- [ ] BUG #6: JSDoc 100% (~200 lines)
- [ ] BUG #7: AbortSignal support
- [ ] BUG #10: Retry logic (lag measurement)
- [ ] IMPROVEMENT #4: Complete documentation
- [ ] IMPROVEMENT #7: Signal checks
- [ ] IMPROVEMENT #9: Retry wrapper
- [ ] Validation: Documentation coverage

#### Sprint 5: Polish + Module Exports (2-3h)

- [ ] IMPROVEMENT #10: Module exports completo
- [ ] Backward compatibility testing (diagnoseStall function)
- [ ] Integration tests
- [ ] Final validation

**Total**: 18-23h (5 sprints)

---

## 🎯 RICE Prioritization

| Bug/Improvement             | Reach | Impact | Confidence | Effort | **Score** | **Priority** |
| --------------------------- | ----- | ------ | ---------- | ------ | --------- | ------------ |
| **BUG #1** (EventEmitter)   | 5     | 5      | 5          | 2      | **62.5**  | **P0**       |
| **BUG #4** (Validation)     | 4     | 3      | 5          | 1      | **60.0**  | **P0**       |
| **BUG #9** (Lag Threshold)  | 4     | 3      | 5          | 1      | **60.0**  | **P0**       |
| **BUG #2** (Config)         | 5     | 4      | 5          | 2      | **50.0**  | **P1**       |
| **BUG #5** (Timeout)        | 5     | 5      | 4          | 2      | **50.0**  | **P1**       |
| **BUG #8** (Error Handling) | 4     | 4      | 4          | 2      | **32.0**  | **P2**       |
| **BUG #3** (Metrics)        | 4     | 4      | 5          | 3      | **26.7**  | **P2**       |
| **BUG #7** (AbortSignal)    | 3     | 3      | 4          | 2      | **18.0**  | **P3**       |
| **BUG #10** (Retry)         | 3     | 3      | 4          | 2      | **18.0**  | **P3**       |
| **BUG #6** (JSDoc)          | 3     | 2      | 5          | 4      | **7.5**   | **P3**       |

**Recommendation**: Implement in priority order (P0 → P1 → P2 → P3)

---

## 🔬 Comparative Analysis

### triage.js v1.x vs v2.0 Stack

| Feature           | v1.x               | v2.0 Stack (14 modules)       | Gap           |
| ----------------- | ------------------ | ----------------------------- | ------------- |
| **EventEmitter**  | ❌ Function export | ✅ Class extends EventEmitter | 2 generations |
| **Config Object** | ❌ Hardcoded (2)   | ✅ Centralized (5-16 keys)    | 2 generations |
| **Events**        | ❌ None (IPC only) | ✅ 8-14 local events          | 2 generations |
| **Metrics**       | ❌ None            | ✅ 10-16 counters + derived   | 2 generations |
| **Validation**    | ❌ None            | ✅ Complete (constructor)     | 2 generations |
| **Timeout**       | ❌ None            | ✅ Promise.race               | 2 generations |
| **JSDoc**         | 10%                | 100%                          | 2 generations |
| **AbortSignal**   | ❌ None            | ✅ Signal checks              | 1 generation  |
| **Error Class**   | ❌ Generic         | ✅ Custom (type/context)      | 1 generation  |
| **getStats()**    | ❌ None            | ✅ Full introspection         | 1 generation  |

**Conclusion**: triage v1.x é **2 gerações atrás** do stack v2.0 atual.

---

## 💰 ROI Assessment

### Benefits (v2.0 Upgrade)

1. **Consistency**: Alinha com 14 modules v2.0 (EventEmitter pattern)
2. **Observability**: Metrics + events para monitoring/debugging
3. **Configurability**: 10 config keys tunable via env vars
4. **Stability**: Timeout protection previne hangs
5. **Security**: Validation previne invalid inputs
6. **Maintainability**: JSDoc 100% + error handling
7. **Performance**: Retry logic para transient failures
8. **Developer Experience**: Factory function + backward compatibility

### Costs

1. **Development**: 18-23h (5 sprints)
2. **Testing**: Integration tests (diagnose scenarios)
3. **Documentation**: Update README (new API)
4. **Migration**: Zero (backward compatible via diagnoseStall function)

### ROI Score

**5/5 stars** ⭐⭐⭐⭐⭐

**Recommendation**: **Highly recommended**

- Critical for v2.0 stack completion (último dos 3 módulos)
- High-impact improvements (timeout, validation, metrics)
- Zero breaking changes (backward compatible)
- Foundation para advanced triage features (ML patterns, custom rules)

---

## ⚠️ Breaking Changes

**ZERO breaking changes** (100% backward compatible)

### Preserved API

```javascript
// ✅ Legacy function export preserved
const { diagnoseStall } = require('./triage');
const result = await diagnoseStall(page, 'en');
// Still works identically to v1.x
```

### New API (Optional)

```javascript
// ✅ New class-based API
const { Triage, create } = require('./triage');

// Factory
const triage = create(page, 'en');

// Or constructor
const triage = new Triage(page, 'en');

// Listen to events
triage.on('triage:pattern_detected', (data) => {
  console.log('Pattern:', data.pattern);
});

// Diagnose with AbortSignal
const controller = new AbortController();
const result = await triage.diagnose(controller.signal);

// Get metrics
const stats = triage.getStats();
console.log('Success rate:', stats.successRate);
```

**Migration Path**: Zero-effort (drop-in replacement)

---

## 📚 Related Modules

### Dependencies (Unchanged)

- `stabilizer.js` (event loop lag)
- `STATUS_VALUES` (task constants)
- `i18n.js` (error terms)
- `logger.js` (logging)

### Integration Points

- **BaseDriver**: Calls `triage.diagnose()` para recovery decisions
- **RemediationEngine**: Consumes diagnostic results
- **NERV**: Receives IPC telemetry (via driver.\_emitVital)

### v2.0 Stack Completion

- **Complete**: 14 modules (human, stabilizer, TargetDriver, BaseDriver, ChatGPTDriver,
  DriverLifecycleManager, factory, driver_nerv_adapter, handle_manager, recovery_system,
  submission_controller, input_resolver, biomechanics_engine, frame_navigator)
- **Pending**: triage ← **ÚLTIMO**

---

## 🎬 Next Steps

1. ✅ **Review audit report** (este documento)
2. ⏳ **Approve v2.0 upgrade** (user decision)
3. ⏳ **Implement triage.js v2.0** (248 → 620 lines, +150%)
4. ⏳ **Integration tests** (all 9 diagnostic patterns)
5. ⏳ **Update documentation** (README + API reference)
6. ⏳ **Celebrate** 🎉 (v2.0 driver stack 100% completo!)

---

**Audit Date**: 2026-02-01 **Auditor**: GitHub Copilot + Claude Sonnet 4.5 **Status**: ✅ READY FOR
IMPLEMENTATION **Priority**: HIGH (último módulo para completar stack v2.0)

---

## Appendix: Code Snippets

### Current v1.x Signature

```javascript
async function diagnoseStall(page, langCode = 'en') {
  // ... 248 lines
  return diagnosis || { type: STATUS_VALUES.HEALTHY, severity: 'NONE', ts: Date.now() };
}
module.exports = { diagnoseStall };
```

### Proposed v2.0 Signature

```javascript
class Triage extends EventEmitter {
  constructor(page, langCode = 'en') {
    super();
    // Validation + metrics initialization
  }

  async diagnose(signal) {
    // EventEmitter events + timeout + metrics
    return result;
  }

  getStats() {
    return { ...this.stats, avgDiagnosisTime, successRate, avgLag, config };
  }
}

// ✅ Backward compatibility
module.exports = {
  Triage,
  TRIAGE_CONFIG,
  TRIAGE_EVENTS,
  TriageError,
  create,
  diagnoseStall, // Legacy function preserved
};
```

---

**End of Audit Report**
