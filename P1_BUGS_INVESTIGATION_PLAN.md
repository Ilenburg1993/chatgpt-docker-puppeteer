# 🔍 Plano de Implementação - 5 Bugs P1 Prioritários

**Data:** 2026-02-12
**Status:** Investigação Concluída - Pronto para Implementação
**Bugs Investigados:** 5/5 (100%)

---

## 📊 Sumário Executivo

Investigação completa de 5 bugs P1 prioritários revelou **28 issues críticos** que precisam ser corrigidos:

| Bug | Issues Encontrados | Severidade | Arquivos Afetados | Estimativa |
|-----|-------------------|------------|-------------------|------------|
| **P1-1** | 10 operações RAG sem timeout | Alta | 4 arquivos | 4-6h |
| **P1-7** | 1 race condition crítica | Crítica | 1 arquivo | 2-3h |
| **P1-17** | 30 callers desprotegidos | Alta | 4 arquivos | 6-8h |
| **P1-20** | 3 JSON.parse() desprotegidos | Crítica | 2 arquivos | 1-2h |
| **P1-22** | 8 write operations sem limite | Crítica | 5 arquivos | 3-4h |
| **TOTAL** | **52 correções** | - | **11 arquivos** | **16-23h** |

---

## 🐛 P1-1: RAG Operations Timeout Enforcement

### Problema Identificado
**10 operações RAG sem proteção de timeout** que podem hang indefinidamente.

### Localizações Críticas

#### 1. **tools/rag/lib/facade.mjs** (4 operações)
- **L344**: `ragQuery()` - `embeddings.embed(options.query)` sem timeout
- **L443**: `ragHybridSearch()` - `embeddings.embed(options.query)` sem timeout
- **L60**: `ragHealth()` - `embeddings.health()` sem timeout
- **L228-238**: `ragIndex()` - embedding por chunk sem timeout

#### 2. **tools/rag/lib/storage/lancedb.mjs** (5 operações)
- **L112**: `search()` - `await q.toArray()` sem timeout
- **L183**: `hybridSearch()` - `await q.toArray()` sem timeout
- **L33**: `ensureTable()` - `await db.tableNames()` sem timeout
- **L74**: `addChunks()` - `await table.add()` sem timeout
- **L66**: `deleteByPath()` - `await table.delete()` sem timeout

#### 3. **src/server/api/controllers/rag.js** (5 handlers)
- **L52**: `handleRagAsk()` - `await ragAsk()` sem timeout
- **L106**: `handleRagQuery()` - `await ragQuery()` sem timeout
- **L153**: `handleRagHealth()` - `await ragHealth()` sem timeout
- **L250**: `handleRagHybridSearch()` - `await ragHybridSearch()` sem timeout
- **L186**: `handleRagIndex()` - background task sem timeout

#### 4. **src/orchestrator/orchestrator_engine.js** (1 operação)
- **L650**: `ragHybridSearch()` no planejamento de missão sem timeout

### Solução Recomendada

**Usar `withTimeout()` do `abort_controller_utils.js` (já existe!)**

```javascript
import { withTimeout } from '#infra/abort_controller_utils';

// Em facade.mjs L344
const vector = await withTimeout(
    () => embeddings.embed(options.query),
    5000,  // 5s timeout
    'RAG_EMBED_TIMEOUT'
);

// Em lancedb.mjs L112
const rows = await withTimeout(
    () => q.toArray(),
    5000,
    'VECTOR_SEARCH_TIMEOUT'
);

// Em rag.js L52
const result = await withTimeout(
    () => ragAsk({ query, topK, pathPrefix, ext, tags }),
    5000,
    'RAG_ASK_TIMEOUT'
);
```

### Timeouts Recomendados
- Query embedding: **5s**
- Vector search: **5s**
- Hybrid search: **8s**
- Health check: **2s**
- Index per chunk: **10s**
- API handler wrapper: **10s** (para safety extra)

### Arquivos para Modificar
1. `tools/rag/lib/facade.mjs` - adicionar timeout em 4 funções
2. `tools/rag/lib/storage/lancedb.mjs` - adicionar timeout em 5 operações DB
3. `src/server/api/controllers/rag.js` - adicionar timeout em 5 handlers
4. `src/orchestrator/orchestrator_engine.js` - adicionar timeout em L650

### Validação
- ✅ Utility `withTimeout()` já existe e está pronta para uso
- ✅ Padrão testado em P0 fixes anteriores
- ✅ Suporta AbortController nativo

---

## 🐛 P1-7: Dependency Cycle Detection Race Condition

### Problema Identificado
**Race condition crítica** na validação de dependências cíclicas - padrão check-then-insert sem transaction lock.

### Localização
**Arquivo:** `src/server/api/controllers/tasks.js`
- **L42-75**: Função `_detectDependencyCycle()` - lê DB sem lock
- **L564-654**: Handler `PUT /:id/dependencies` - race window entre check (L608) e insert (L635)

### Código Atual (Vulnerável)
```javascript
// L608: CHECK sem lock
const cycleCheck = _detectDependencyCycle(taskId, deps);
if (cycleCheck.hasCycle) {
    return res.status(400).json({ error: 'Circular dependency' });
}

// RACE WINDOW AQUI (linhas 608-634)
// Outro request pode modificar dependências

// L634: INSERT dentro de transaction
const tx = db.transaction(() => {
    updateTask(taskId, { task: nextTask, dependencies: deps });
    recordEvent({ /* ... */ });
});
tx();
```

### Timeline do Race Condition
```
Request A                      Request B
─────────────────────────     ─────────────────────────
Read deps of task-1           [waiting]
Check: hasCycle = false
                               Read deps of task-1
                               Check: hasCycle = false
                               [enters tx]
                               INSERT task-1 → task-2
                               [commits]
[enters tx]
INSERT task-1 → task-3
INSERT task-3 → task-1        ✅ CICLO CRIADO!
[commits]
```

### Solução Recomendada

**Option 1: Wrap Check+Insert em Transaction (RECOMENDADO)**
```javascript
router.put('/:id/dependencies', schemaGuard(replaceDependenciesSchema), async (req, res) => {
    const db = getDb();

    const tx = db.transaction(() => {
        // ✅ CHECK dentro da transaction com lock exclusivo
        const cycleCheck = _detectDependencyCycle(taskId, deps);
        if (cycleCheck.hasCycle) {
            throw new Error('Circular dependency detected');
        }

        // ✅ SAFE to update - nenhum outro worker pode entrar
        updateTask(taskId, { task: nextTask, dependencies: deps });
        recordEvent({ /* ... */ });
    });

    try {
        tx();
        res.json({ success: true, dependencies: deps });
    } catch (err) {
        if (err.message.includes('Circular')) {
            res.status(400).json({ error: 'Circular dependency detected' });
        } else {
            throw err;
        }
    }
});
```

**Option 2: Use IMMEDIATE Transaction Mode**
```javascript
// Em sqlite.js
function getDbExclusive() {
    const db = getDb();
    return {
        transaction: (fn) => {
            db.prepare('BEGIN IMMEDIATE').run();  // Lock on start
            try {
                const result = fn();
                db.prepare('COMMIT').run();
                return result;
            } catch (err) {
                db.prepare('ROLLBACK').run();
                throw err;
            }
        }
    };
}
```

### Arquivos para Modificar
1. `src/server/api/controllers/tasks.js` L564-654 - envolver check+insert em transaction

### Validação
- ✅ SQLite WAL mode já está habilitado (permite concurrent reads)
- ✅ `db.transaction()` usa DEFERRED por padrão → precisa wrap check+insert juntos
- ⚠️ Aumenta hold time do lock (~5-20ms), mas garante consistência

---

## 🐛 P1-17: Optimistic Locking Callers Desprotegidos

### Problema Identificado
**P0-2.6 mudou `updateTask()` para THROW `OptimisticLockError`**, mas **30 callers (85%) não têm try-catch**.

### Estatísticas
- **Total callers:** 39
- **Protegidos:** 5-8
- **Desprotegidos:** 30-31
- **Impacto:** Crashes em workers e API 500 errors

### Callers Desprotegidos por Arquivo

#### 1. **task_orchestration_worker.js** (9 calls ❌)
- **L527**: Status → BLOCKED (strategy unknown)
- **L607**: Status → BLOCKED (output missing)
- **L680**: Task update (workflow)
- **L704**: Status → BLOCKED (manual review)
- **L733**: Status → FAILED (validation hopeless)
- **L797**: Rearm task (retry/next iteration)
- **L900**: Status → BLOCKED (workflow config missing)
- **L926**: Status → BLOCKED (workflow action unsupported)
- **L992**: Status → BLOCKED (next step action unsupported)

#### 2. **task_state_projector.js** (11 calls ❌)
- **L331**: Update correlation/attempt IDs
- **L376**: Status → RUNNING
- **L620**: Status → PAUSED/CANCELLED
- **L1053**: Status → PENDING (retry após erro)
- **+7 outras** chamadas similares

#### 3. **queue_worker.js** (6 calls ❌)
- **L271**: Status → FAILED (task invalid)
- **L308**: Update correlation/attempt IDs
- **L361**: Update prompt template artifact
- **L396**: Update rendered prompt artifact
- **L434**: Status → PENDING (dispatch retry)
- **L456**: Status → FAILED (dispatch failed)

#### 4. **tasks.js (API Controller)** (4-7 calls ⚠️)
- **L427**: PUT /:id (partial protection - null check, sem try-catch)
- **L671**: POST /:id/approve (sem protection)
- **L713**: POST /:id/reject (sem protection)
- **L860**: POST /:id/reset (sem protection)
- **L939**: POST /:id/cancel (sem protection)
- **L1165**: POST /bulk (dentro de transaction, sem try-catch)

#### 5. **attempt_watchdog.js** (5 calls ✅)
- **L214, L263, L332, L468, L521**: TODOS protegidos com try-catch

### Padrão de Fix Recomendado
```javascript
// ANTES (crash em conflict)
updateTask(taskId, { status: 'BLOCKED', blocked_reason: 'ORCH_STRATEGY_UNKNOWN' });

// DEPOIS (handle gracefully)
try {
    updateTask(taskId, { status: 'BLOCKED', blocked_reason: 'ORCH_STRATEGY_UNKNOWN' });
} catch (err) {
    if (err.name === 'OptimisticLockError') {
        // Option 1: Retry immediately (1-2x)
        log('WARN', `Task ${taskId} had concurrent modification, retrying...`);
        // retry logic

        // Option 2: Schedule for later
        // ...

        // Option 3: Log and continue (if non-critical)
        log('WARN', `Task ${taskId} update conflict ignored (non-critical)`);
    } else {
        throw err;  // Re-throw unexpected errors
    }
}
```

### Priorização de Fixes
1. **P0**: task_orchestration_worker.js (9 calls) - bloqueia orchestration
2. **P0**: task_state_projector.js (11 calls) - bloqueia event sync
3. **P0**: queue_worker.js (6 calls) - bloqueia dispatch
4. **P1**: tasks.js API (4-7 calls) - 500 errors ao invés de 409 Conflict

### Arquivos para Modificar
1. `src/agent/task_orchestration_worker.js` - adicionar try-catch em 9 calls
2. `src/agent/task_state_projector.js` - adicionar try-catch em 11 calls
3. `src/agent/queue_worker.js` - adicionar try-catch em 6 calls
4. `src/server/api/controllers/tasks.js` - adicionar try-catch em 4-7 calls

---

## 🐛 P1-20: JSON Parsing Errors Not Handled

### Problema Identificado
**3 JSON.parse() desprotegidos** que podem crash a aplicação se JSON está corrompido.

### Localizações Críticas

#### 1. **task_repo.js:91** (CRÍTICO 🔴)
```javascript
function _rowToTask(row) {
    if (!row) return null;
    const task = JSON.parse(row.task_json);  // ❌ UNPROTECTED
    // ...
}
```

**Impacto:** Crash em:
- `getTaskById()` - qualquer API request para /api/tasks/:id
- `listTasks()` - lista de tasks retorna 500
- `claimNextEligibleTask()` - worker não consegue claim tasks

**Usado por:** Todos os endpoints de tasks, todos os workers

#### 2. **mission_repo.js:103** (ALTO 🟡)
```javascript
function _rowToMission(row) {
    const policy = row.policy_json ? JSON.parse(row.policy_json) : {};  // ❌ UNPROTECTED
    const context = row.context_json ? JSON.parse(row.context_json) : {};  // ❌ UNPROTECTED
    // ...
}
```

**Impacto:** Crash em mission retrieval/updates

**Usado por:** `getMissionById()`, `updateMission()`

### Solução Recomendada

#### Fix para task_repo.js
```javascript
function _rowToTask(row) {
    if (!row) return null;

    let task = null;
    try {
        task = JSON.parse(row.task_json);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[task_repo] Invalid task_json for task ${row?.id}: ${msg}`);

        // Option 1: Return null (task invisível)
        return null;

        // Option 2: Throw error (falha explícita)
        // throw new Error(`Corrupted task record: ${row?.id}`);
    }

    // ... rest of function unchanged
}
```

#### Fix para mission_repo.js
```javascript
function _rowToMission(row) {
    let policy = {};
    let context = {};

    if (row.policy_json) {
        try {
            policy = JSON.parse(row.policy_json);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[mission_repo] Invalid policy_json for mission ${row?.id}: ${msg}`);
            policy = {};  // Fallback seguro
        }
    }

    if (row.context_json) {
        try {
            context = JSON.parse(row.context_json);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[mission_repo] Invalid context_json for mission ${row?.id}: ${msg}`);
            context = {};  // Fallback seguro
        }
    }

    return {
        id: row.id,
        title: row.title,
        description: row.description,
        // ... rest unchanged
    };
}
```

### Padrão Correto Já Usado no Código (L118-124, L127-133)
```javascript
if (row.blocked_details_json) {
    try {
        task.state.blocked_details = JSON.parse(row.blocked_details_json);
    } catch (_) {
        task.state.blocked_details = row.blocked_details_json;  // Fallback para string
    }
}
```

### Arquivos para Modificar
1. `src/infra/db/task_repo.js` L91 - adicionar try-catch em _rowToTask
2. `src/infra/db/mission_repo.js` L103-104 - adicionar try-catch em _rowToMission

### Detecção de Dados Corrompidos (Bonus)
```javascript
// Adicionar check na boot sequence
function validateJsonColumns() {
    const db = getDb();

    const badTasks = db.prepare(`
        SELECT id FROM tasks
        WHERE task_json IS NOT NULL
        AND json_valid(task_json) = 0
    `).all();

    if (badTasks.length > 0) {
        console.error(`[CRITICAL] Found ${badTasks.length} tasks with invalid JSON`);
        return false;
    }

    return true;
}
```

---

## 🐛 P1-22: Artifact Write Size Limit

### Problema Identificado
**8 operações de write sem validação de tamanho** que podem encher o disco.

### Vulnerabilidades Críticas

#### 1. **artifact_store.js:142-160 - putText()** 🔴
```javascript
async function putText({ kind, text, relPath, ext = 'txt', mime = 'text/plain' } = {}) {
    // ...
    const body = String(text ?? '');
    await atomicWrite(fullPath, body, 'utf8');  // ❌ NO SIZE CHECK
    // ...
}
```

**Usado por:**
- Orchestration feedback (linha 868 de task_orchestration_worker.js)
- Rendered prompts (linha 379 de queue_worker.js)
- Diagnostic HTML (linha 1264 de driver_nerv_adapter.js)

#### 2. **artifact_store.js:174-212 - putBuffer()** 🔴
```javascript
async function putBuffer({ kind, buffer, relPath, ext = 'bin', mime = 'application/octet-stream' } = {}) {
    // ...
    await atomicWrite(fullPath, body);  // ❌ NO SIZE CHECK
    // ...
}
```

**Usado por:**
- Screenshots full-page (linha 1247 de driver_nerv_adapter.js) - pode ser 50MB+

#### 3. **artifact_store.js:226-229 - putJson()** 🔴
```javascript
async function putJson({ kind, json, relPath, ext = 'json', mime = 'application/json' } = {}) {
    const body = JSON.stringify(json ?? null, null, 2);
    return await putText({ kind, text: body, relPath, ext, mime });  // ❌ NO SIZE CHECK
}
```

**Usado por:**
- Prompt templates (linha 346 de queue_worker.js)
- Diagnostic metadata (linha 1297 de driver_nerv_adapter.js)

### Callers Vulneráveis

| Arquivo | Linha | Operação | Tipo | Risk |
|---------|-------|----------|------|------|
| driver_nerv_adapter.js | 1247 | Screenshot PNG | `putBuffer()` | 🔴 50MB+ |
| driver_nerv_adapter.js | 1264 | HTML dump | `putText()` | 🟡 1MB (truncado) |
| task_orchestration_worker.js | 868 | Feedback text | `putText()` | 🔴 Unbounded |
| queue_worker.js | 346 | Prompt template | `putJson()` | 🔴 Unbounded |
| queue_worker.js | 379 | Rendered prompt | `putText()` | 🔴 200KB+ |
| tasks.js (API) | 219 | API prompt | `putJson()` | 🔴 Unbounded |

### Limites Recomendados por Tipo
```javascript
const ARTIFACT_SIZE_LIMITS = {
    // Task outputs
    'response_text': 10 * 1024 * 1024,        // 10MB
    'response_md': 10 * 1024 * 1024,          // 10MB
    'response_html': 5 * 1024 * 1024,         // 5MB

    // Screenshots & diagnostics
    'diagnostic_screenshot': 50 * 1024 * 1024, // 50MB (compressed PNG)
    'diagnostic_html': 2 * 1024 * 1024,        // 2MB
    'diagnostic_meta': 1 * 1024 * 1024,        // 1MB

    // Prompts & feedback
    'prompt_template': 1 * 1024 * 1024,        // 1MB
    'prompt_rendered': 2 * 1024 * 1024,        // 2MB
    'orchestration_feedback': 5 * 1024 * 1024, // 5MB

    // Default
    'default': 5 * 1024 * 1024                 // 5MB
};
```

### Solução Recomendada

**Adicionar validação ANTES de atomicWrite:**
```javascript
async function putText({ kind, text, relPath, ext = 'txt', mime = 'text/plain', computeSha256 = false } = {}) {
    // ... existing code ...

    const body = String(text ?? '');

    // ✅ ADD SIZE CHECK
    const MAX_SIZE = parseInt(process.env.ARTIFACT_MAX_SIZE_BYTES || '10485760', 10); // 10MB default
    const sizeBytes = Buffer.byteLength(body, 'utf8');

    if (sizeBytes > MAX_SIZE) {
        throw new Error(
            `Artifact too large: ${(sizeBytes / 1024 / 1024).toFixed(2)}MB ` +
            `exceeds max ${(MAX_SIZE / 1024 / 1024).toFixed(2)}MB (kind=${kind})`
        );
    }

    await atomicWrite(fullPath, body, 'utf8');
    // ... rest unchanged ...
}
```

**Similar para putBuffer():**
```javascript
async function putBuffer({ kind, buffer, relPath, ext = 'bin', mime = 'application/octet-stream', computeSha256 = false } = {}) {
    // ... convert buffer ...

    const MAX_SIZE = parseInt(process.env.ARTIFACT_MAX_SIZE_BYTES || '52428800', 10); // 50MB default (para screenshots)

    if (body.byteLength > MAX_SIZE) {
        throw new Error(
            `Artifact too large: ${(body.byteLength / 1024 / 1024).toFixed(2)}MB ` +
            `exceeds max ${(MAX_SIZE / 1024 / 1024).toFixed(2)}MB (kind=${kind})`
        );
    }

    await atomicWrite(fullPath, body);
    // ...
}
```

### Variáveis de Ambiente
```bash
# .env
ARTIFACT_MAX_SIZE_BYTES=10485760          # 10MB default
ARTIFACT_SCREENSHOT_MAX_BYTES=52428800    # 50MB para screenshots
ARTIFACT_HTML_MAX_BYTES=2097152           # 2MB para HTML dumps
```

### Arquivos para Modificar
1. `src/infra/storage/artifact_store.js` - adicionar size check em putText(), putBuffer(), putJson()
2. Callers precisam try-catch para size errors (graceful degradation)

### Proteções Existentes (Insuficientes)
- `DIAGNOSTIC_HTML_MAX_BYTES` (1MB) - apenas HTML truncation, não enforcement
- `MAX_JSON_SIZE` (1MB) - apenas leitura, não escrita
- `MAX_LOG_SIZE` (5MB) - apenas rotação de logs

---

## 📋 Plano de Implementação Consolidado

### Fase 1: Quick Wins (Baixa Complexidade, Alto Impacto)
**Duração:** 3-5 horas

1. **P1-20: JSON Parsing** (1-2h)
   - Adicionar try-catch em _rowToTask (L91)
   - Adicionar try-catch em _rowToMission (L103-104)
   - ✅ 2 arquivos, 3 fixes

2. **P1-7: Dependency Cycle** (2-3h)
   - Envolver check+insert em transaction
   - ✅ 1 arquivo, 1 fix

### Fase 2: Medium Complexity (Repetitivo)
**Duração:** 10-14 horas

3. **P1-1: RAG Timeouts** (4-6h)
   - 4 arquivos × múltiplas funções
   - Padrão repetitivo com withTimeout()
   - ✅ 10 operações

4. **P1-17: Optimistic Lock Callers** (6-8h)
   - 4 arquivos × múltiplas chamadas
   - Padrão repetitivo com try-catch
   - ✅ 30 callers

### Fase 3: Infrastructure (Medium Complexity)
**Duração:** 3-4 horas

5. **P1-22: Artifact Size Limits** (3-4h)
   - Modificar 3 funções em artifact_store.js
   - Adicionar constants de limite
   - Testar com artifacts grandes
   - ✅ 3 write functions

### Ordem de Execução Recomendada
1. **Dia 1 AM**: P1-20 (JSON parsing) - 1-2h ✅ Bloqueia tudo
2. **Dia 1 PM**: P1-7 (Dependency cycle) - 2-3h ✅ Race condition crítica
3. **Dia 2**: P1-1 (RAG timeouts) - 4-6h ✅ Hang prevention
4. **Dia 3-4**: P1-17 (Optimistic lock) - 6-8h ✅ Crash prevention
5. **Dia 4 PM**: P1-22 (Artifact size) - 3-4h ✅ Disk exhaustion

**Total:** 16-23 horas (2-3 dias de trabalho)

---

## ✅ Critérios de Sucesso

### P1-1 (RAG Timeouts)
- ✅ Todas as 10 operações RAG têm timeout
- ✅ Timeout configurável via ENV
- ✅ Logs de timeout para debugging
- ✅ Operações não hang indefinidamente

### P1-7 (Dependency Cycle)
- ✅ Check+insert são atômicos (transaction)
- ✅ Race condition eliminada
- ✅ Testes de concorrência passam

### P1-17 (Optimistic Lock)
- ✅ Todos os 30 callers têm try-catch
- ✅ 409 Conflict retornado (não 500)
- ✅ Retry logic onde apropriado

### P1-20 (JSON Parsing)
- ✅ JSON.parse() protegido com try-catch
- ✅ Fallback seguro (null ou {})
- ✅ Logs de corrupção para debugging
- ✅ Aplicação não crash com JSON inválido

### P1-22 (Artifact Size)
- ✅ Limites de tamanho por tipo de artifact
- ✅ Erro claro quando limite excedido
- ✅ Configurável via ENV
- ✅ Disco não enche com artifacts gigantes

---

## 📊 Sumário de Arquivos Modificados

| Arquivo | Bugs | Linhas Modificadas | Complexidade |
|---------|------|-------------------|--------------|
| tools/rag/lib/facade.mjs | P1-1 | ~40 | Média |
| tools/rag/lib/storage/lancedb.mjs | P1-1 | ~50 | Média |
| src/server/api/controllers/rag.js | P1-1 | ~50 | Baixa |
| src/orchestrator/orchestrator_engine.js | P1-1 | ~10 | Baixa |
| src/server/api/controllers/tasks.js | P1-7 | ~30 | Média |
| src/agent/task_orchestration_worker.js | P1-17 | ~90 | Alta |
| src/agent/task_state_projector.js | P1-17 | ~110 | Alta |
| src/agent/queue_worker.js | P1-17 | ~60 | Alta |
| src/infra/db/task_repo.js | P1-20 | ~15 | Baixa |
| src/infra/db/mission_repo.js | P1-20 | ~20 | Baixa |
| src/infra/storage/artifact_store.js | P1-22 | ~60 | Média |
| **TOTAL** | **5 bugs** | **~535 linhas** | **Média** |

---

## 🔮 Próximos Passos (P1 Restantes: 36 de 41)

Após completar estes 5 bugs prioritários, focar em:

1. **Input Validation** (12 issues) - SQL injection, XSS, path traversal
2. **Transaction Handling** (6 issues) - Rollback failures, dependency checks
3. **Observability** (7 issues) - NERV emission failures, audit logs
4. **Remaining Timeouts** (3 issues) - Artifact reads, API endpoints
5. **Error Handling** (8 issues) - Unhandled promises, cleanup failures

**Total P1+P2 restantes:** 36 issues

---

## 📝 Notas de Implementação

### Utilities Existentes (Reuso)
- ✅ `withTimeout()` - `src/infra/abort_controller_utils.js`
- ✅ `withRetry()` - `src/infra/abort_controller_utils.js`
- ✅ `resilientLock` - `src/infra/locks/resilient_lock.js`
- ✅ `atomicWrite()` - `src/infra/fs/atomic_write.js`

### Padrões de Código
- **Timeout**: Sempre usar `withTimeout()` ao invés de `Promise.race()` manual
- **JSON Parse**: Sempre try-catch + fallback seguro
- **Optimistic Lock**: Sempre try-catch + retry ou log
- **Size Check**: Sempre validar ANTES de I/O
- **Transaction**: Sempre envolver operações críticas em `db.transaction()`

### Testing
- **Unit tests**: Cada fix precisa de 2-3 unit tests
- **Integration tests**: Testar cenários de concorrência
- **Stress tests**: Load test com 100 requests paralelos
- **Regression tests**: Garantir que fixes não quebram funcionalidade existente

---

**Implementado por:** Claude Sonnet 4.5
**Data:** 2026-02-12
**Status:** ✅ Investigação 100% Completa - Pronto para Implementação
