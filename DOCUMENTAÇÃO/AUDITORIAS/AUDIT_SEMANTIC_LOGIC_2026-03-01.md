# Auditoria Semântica — Fluxo Completo de Tasks

**Data:** 2026-03-01  
**Skill:** `semantic-logic-audit` (nova — primeira aplicação)  
**Escopo:** Fluxo completo de tasks do início ao fim  
**Baseline:** 798 pass / 2 fail / 0 lint warnings  
**Status:** ✅ Concluída — 2 bugs semânticos corrigidos

---

## Objetivo do Sistema (como entendido)

O sistema é um **agente autônomo de automação de LLMs** (ChatGPT, Gemini, etc.) via browser.
O fluxo principal de tasks:

1. **Task é criada** com `spec.payload.user_message` e opcionalmente `system_message`
2. **QueueWorker** reivindica tasks elegíveis do banco (stage=READY, status=PENDING, sem lock)
3. **Kernel** executa a task: o driver abre o browser, submete o prompt, captura a resposta
4. **Resultado** é salvo como artefato e o task movido para stage=ARCHIVED, status=DONE
5. **TaskOrchestrationWorker** processa tasks ARCHIVED+DONE com estratégias especiais:
   - `ITERATIVE`: valida qualidade do output; se não passou → retry; se passou → done
   - `MULTI_STEP`: avança para o próximo step do workflow criando task filha

---

## Invariantes Identificados

| # | Invariante | Status |
|---|-----------|--------|
| I1 | `status=DONE` implica que a task cumpriu seus critérios de qualidade | ⚠️ **Violado pelo BUG #2** |
| I2 | Uma task que atingiu max_iterations sem passar validação deve ser `FAILED` | ⚠️ **Violado pelo BUG #2** |
| I3 | Uma task com output ausente repetidamente deve ser bloqueada após N ocorrências | ⚠️ **Violado pelo BUG #1** |
| I4 | Locks são liberados em todos os caminhos de saída | ✅ OK (`resilientLock.release` em `finally`) |
| I5 | Eventos stale/duplicados de dispatch são ignorados pelo correlationId | ✅ OK (idempotência por correlationId) |
| I6 | max_attempts é verificado antes do dispatch (não após) | ✅ OK |
| I7 | Estado de workflow (accumulated_context) é corretamente propagado para task filha | ✅ OK |

---

## Bugs Confirmados e Corrigidos

---

### BUG-SEM-1 (ALTO) — `_handleMissingOutput`: Threshold nunca alcançado por dedup

**Arquivo:** `src/agent/task_orchestration_worker.js`, método `_handleMissingOutput`

**Descrição do problema:**

O método `_handleMissingOutput` é chamado quando a task completou (DONE) mas o output
do attempt não está disponível. A intenção é: se isso acontecer N vezes (`threshold=3`)
dentro de uma janela de tempo (`windowMs`), a task deve ser bloqueada (`BLOCKED`).

**Fluxo com o bug:**

```
Tick 1: recordEvent(dedupKey='task:X:orch_output_missing:A') → INSERT OK (count=1)
         COUNT query: 1 < threshold(3) → return false
         
Tick 2: recordEvent(dedupKey='task:X:orch_output_missing:A') → INSERT OR IGNORE (count=1)
         COUNT query: 1 < threshold(3) → return false ← NUNCA AVANÇA!
         
Tick 3, 4, 5...: idem — count sempre 1, threshold nunca atingido
```

**Por que falha semanticamente:**

`recordEvent` usa `INSERT OR IGNORE` no SQL. Se `dedup_key` já existe, o evento é silenciado
e a função retorna `false` (sem erro). Como a `dedupKey` inclui apenas `taskId` e `attemptId`
(fixos durante todo o processamento de um attempt), o segundo insert em diante é sempre ignorado.
O `COUNT` query conta eventos reais — mas como só 1 existe, nunca atinge threshold=3.

**Evidência:**
```javascript
// events_repo.js linha 52-60:
const res = db.prepare(`INSERT OR IGNORE INTO events ... `).run({...});
return Boolean(res?.changes);  // Retorna false se duplicado (sem erro!)

// _handleMissingOutput — bug:
recordEvent({ ..., dedupKey: `task:${taskId}:orch_output_missing:${attemptId}` });
// ↑ O mesmo dedupKey é usado em CADA tick para o mesmo attempt
// ↑ Apenas o 1º INSERT é bem-sucedido; todos os demais são silenciados

const recent = db.prepare(`SELECT COUNT(1) FROM events WHERE event_type = 'TASK_ORCHESTRATION_OUTPUT_MISSING' AND ts_ms >= ?`).get(...)?.c;
// ↑ COUNT é sempre 1, threshold é 3 → task NUNCA é bloqueada
```

**Impacto:** Tasks com output permanentemente ausente ficam num loop infinito, sendo
"processadas" a cada tick sem progredir nem serem bloqueadas. O `BLOCKED` state nunca é atingido.

**Correção aplicada:**

```javascript
// ANTES (bug):
recordEvent({ ..., dedupKey: `task:${taskId}:orch_output_missing:${attemptId}` });

// DEPOIS (correto):
recordEvent({
    ...,
    // No dedupKey: each occurrence must be counted independently for threshold detection.
    // Using INSERT OR IGNORE with a fixed dedupKey would cap the count at 1 per (taskId,attemptId),
    // preventing the threshold from ever being reached.
});
```

---

### BUG-SEM-2 (MÉDIO) — `_handleIterative`: max_iterations atingido mas task fica DONE

**Arquivo:** `src/agent/task_orchestration_worker.js`, método `_handleIterative`

**Descrição do problema:**

Quando uma task `ITERATIVE` atinge `max_iterations` sem que a validação passe, o sistema
registrava apenas um evento `TASK_ORCHESTRATION_MAX_ITERATIONS_REACHED` e retornava,
**deixando a task no status `DONE`**.

**Fluxo com o bug:**

```
Task ITERATIVE com max_iterations=3, validação nunca passa:
  Iteration 1: score=0.4 → retry schedulado → task → PENDING → executa de novo
  Iteration 2: score=0.4 → retry schedulado → task → PENDING → executa de novo
  Iteration 3: score=0.4 → nextIteration(3) >= maxIterations(3)
               → recordEvent(MAX_ITERATIONS_REACHED)
               → return
               → task fica: stage=ARCHIVED, status=DONE ← ERRADO! Não passou validação!
```

**Violação de invariante:**

O invariante I1 afirma: "status=DONE implica que a task cumpriu seus critérios de qualidade".
Com o bug, `status=DONE` pode significar "executou N vezes sem passar validação".

**Inconsistência com o bloco "hopeless":**

O bloco imediatamente acima (score < MIN_SCORE_THRESHOLD) corretamente marca como FAILED:
```javascript
// Bloco hopeless (correto):
this._safeUpdateTask(taskId, {
    status: 'FAILED',
    stage: TASK_STAGES.ARCHIVED,
    last_error: `VALIDATION_HOPELESS: score ${...} < ${MIN_SCORE_THRESHOLD} after ${nextIteration} iterations`,
});
```

Mas o bloco max_iterations apenas registrava o evento sem atualizar o status:
```javascript
// ANTES (bug):
if (nextIteration >= maxIterations) {
    recordEvent({ eventType: 'TASK_ORCHESTRATION_MAX_ITERATIONS_REACHED' });
    return;  // ← task fica DONE sem atualizar status
}
```

**Correção aplicada:**

```javascript
// DEPOIS (correto):
if (nextIteration >= maxIterations) {
    this._safeUpdateTask(taskId, {
        status: 'FAILED',
        stage: TASK_STAGES.ARCHIVED,
        failed_at_ms: now,
        last_error: `MAX_ITERATIONS_REACHED: validation did not pass after ${nextIteration} iterations (max=${maxIterations})`,
    }, { context: 'Mark failed at max iterations' });
    recordEvent({ eventType: 'TASK_ORCHESTRATION_MAX_ITERATIONS_REACHED', ... });
    return;
}
```

---

## Áreas Verificadas e Sem Bugs

| Área | Verificado | Resultado |
|------|-----------|-----------|
| `QueueWorker.tick()` — inflight count | ✅ | OK: query correta, loop de slots funciona |
| `QueueWorker` — max_attempts check | ✅ | OK: `>= maxAttempts` correto (`attempts` = tentativas JÁ feitas) |
| `QueueWorker` — correlationId como attemptId | ✅ | OK: gerado antes de upsertAttempt, consistente |
| `_handleIterative` — update de estado antes de retry | ✅ | OK: state persisted, então task rearmed |
| `_handleMultiStep` — propagação de accumulatedContext | ✅ | OK: contexto propagado para task filha corretamente |
| `buildWorkflowNextStepTask` — task_id em inputs | ✅ | OK: usa taskId do step correto do accumulatedContext |
| `_setOrReplaceInput` — semântica AND vs OR | ✅ | OK: AND correto para o caso de uso (replace por (type, label)) |
| `TaskExecutionOrchestrator` — idempotência | ✅ | OK: processedExecutionEvents guarda por (taskId, correlationId) |
| `TaskExecutionOrchestrator` — stale events | ✅ | OK: correlationId mismatch descarta evento |
| Lock management no TaskOrchestrationWorker | ✅ | OK: resilientLock.release em finally |

---

## Sobre a Skill `semantic-logic-audit`

Esta auditoria inaugurou a skill `semantic-logic-audit`. Os dois bugs encontrados são
**exemplares** do tipo de bug que a skill cobre:

- **BUG-SEM-1**: não aparece em lint, não tem padrão grep identificável, passa em todos os
  testes unitários. É visível apenas quando se entende a semântica do `INSERT OR IGNORE`
  e a relação entre dedupKey e o sistema de threshold.

- **BUG-SEM-2**: não aparece em lint ou grep. É visível apenas quando se entende o invariante
  "DONE implica qualidade aprovada" e se compara com o comportamento do bloco "hopeless" vizinho.

Ambos só foram encontrados por leitura profunda com foco no comportamento esperado vs. real.

---

## Security Summary

Nenhuma vulnerabilidade de segurança encontrada neste escopo. Os bugs corrigidos são
de natureza operacional (estado incorreto, threshold inoperante), sem impacto na superfície
de segurança do sistema.
