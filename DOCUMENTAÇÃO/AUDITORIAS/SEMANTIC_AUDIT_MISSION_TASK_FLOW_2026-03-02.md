# Auditoria Semântica — Fluxo Completo Mission/Task (2026-03-02)

**Skill usada**: `semantic-logic-audit`  
**Escopo**: fluxo completo desde criação de missão/task no dashboard até recebimento de resposta
da LLM, cobrindo todos os cenários de falha não-usuário.  
**Status**: Correções aplicadas — todos os bugs P0/P1 resolvidos.

---

## Objetivo do Sistema

Orquestrar missões de longa duração compostas de tarefas individuais, onde cada tarefa envia
um prompt para uma LLM via browser automation (Puppeteer) e armazena a resposta. O sistema deve:
- Suportar pause/resume por usuário ou pelo sistema
- Recuperar automaticamente de falhas transientes (driver crash, network timeout, heartbeat stale)
- Bloquear tasks que precisam de ação do usuário sem falhar a missão inteira
- Manter consistência de estado entre missão e suas tasks filhas

---

## Invariantes Críticos

1. Uma task jamais deve ficar em `DONE` se a validação falhou
2. O lock de uma task jamais deve ser mantido se o processamento falhou
3. Uma missão com task `BLOCKED` não deve falhar imediatamente — deve pausar para resolução
4. O `HeartbeatWatchdog` deve causar transição de estado real, não apenas registrar eventos
5. Tasks paradas por timeout devem ser rescheduadas, não abandonadas

---

## Mapa de Estado: Task

```
PENDING (stage=READY)
  ↓ QueueWorker claim
RUNNING (stage=READY) + lock ativo
  ↓ Driver envia prompt → espera resposta
  ↓ sucesso
DONE (stage=ARCHIVED)     ← terminal feliz

  ↓ falha retryable (ENV_UNAVAILABLE)
PENDING (reschedula com backoff)  ← reinicia ciclo

  ↓ falha fatal (TASK_ERROR, USER_ACTION_REQUIRED)
FAILED (stage=ARCHIVED)   ← terminal de falha
BLOCKED (stage=READY)     ← espera ação do usuário

  ↓ usuário pausa
PAUSED  ← pode ser retomada

  ↓ usuário cancela
CANCELLED ← terminal

  ↓ max_attempts esgotado
FAILED ← terminal
```

## Mapa de Estado: Missão

```
READY → RUNNING → DONE    ← workflow completo
              ↓ task FAILED/CANCELLED
           FAILED          ← terminal de falha
              ↓ task BLOCKED (NOVO comportamento)
           PAUSED          ← aguarda resolução → RUNNING (após retomar)
              ↓ task PAUSED individualmente (NOVO comportamento)
           PAUSED          ← cascade pause
```

---

## Bugs Identificados e Corrigidos

### BUG-MISSION-BLOCKED (P0 — CRÍTICO)

**Arquivo**: `src/agent/mission_runner.js`

**Descrição**: `MissionRunner._processMission()` tratava status `BLOCKED` de uma task no grupo
"terminal mas não DONE", chamando `failMissionTransition` imediatamente. Isso era semanticamente
incorreto: `BLOCKED` significa que a task precisa de intervenção do usuário (desbloquear/reexecutar),
não que falhou definitivamente. A missão seria marcada como `FAILED` sem dar chance ao usuário
de resolver o problema.

**Cenário reproduzível**:
1. Missão RUNNING com workflow de 3 steps
2. Step 1: task executa, validação falha (VALIDATION_MANUAL_REVIEW) → task BLOCKED
3. `MissionRunner.tick()` → `status = 'BLOCKED'` → cai em "Terminal but not DONE"
4. `failMissionTransition()` → missão FAILED
5. Usuário não consegue mais interagir com a missão

**Correção**: Quando task está `BLOCKED`, chamar `pauseMissionTransition` com `dedupKey` baseado
no `task_id`, garantindo idempotência. A missão fica PAUSED até o usuário desbloquear a task
e retomar manualmente.

---

### BUG-MISSION-NULL-TASK (P0 — CRÍTICO)

**Arquivo**: `src/agent/mission_runner.js`

**Descrição**: Quando `progress.current_task_id` aponta para uma task que não existe no banco
(deletada, purgada, ou nunca inserida por erro), `row?.status || null` retorna `null`. O código
anterior tratava `!status` no mesmo grupo de `PENDING/RUNNING/PAUSED` (→ "still in progress"),
causando loop infinito: a missão nunca avança nem falha, ficando travada para sempre.

**Correção**: Tratar `!status` como falha da missão com reason `task_not_found`, limpando
`current_task_id` para que a missão possa ser inspecionada.

---

### BUG-MISSION-PAUSED-TASK (P1 — ALTO)

**Arquivo**: `src/agent/mission_runner.js`

**Descrição**: Se o usuário pausa uma task individualmente (não via pausa da missão), a task
fica em `PAUSED` mas a missão continua `RUNNING`. O `MissionRunner` tratava `PAUSED` como "still
in progress" e retornava sem fazer nada. A missão ficava travada esperando a task que nunca
avançaria automaticamente (o usuário precisaria descobrir que precisava retomar a task individual
OU pausar/resumir a missão manualmente).

**Correção**: Se uma task de missão está `PAUSED` enquanto a missão está `RUNNING`, cascadear
o pause para a missão (idempotente via `dedupKey`). O usuário pode então retomar a missão
normalmente, o que retomará a task via `resumeMissionTransition.taskMutation`.

---

### BUG-HB-WATCHDOG (P0 — CRÍTICO)

**Arquivo**: `src/agent/heartbeat_watchdog.js`

**Descrição**: O `HeartbeatWatchdog.tick()` usava `recordEvent(eventType=DRIVER_TASK_FAILED)`
esperando que o `TaskStateProjector` reagisse e fizesse a transição de estado. Mas o projector
escuta o **NERV bus** (`nerv.onReceive`), não a tabela `events` do SQLite. `recordEvent` salva
apenas no DB — o projector nunca recebe esse evento. O watchdog registrava centenas de eventos
no banco sem nenhum efeito real nas tasks stale.

Evidência: `TaskStateProjector.start()` → `this.nerv.onReceive(envelope => ...)` — não há
nenhum polling da tabela `events`.

**Impacto**: Tasks com driver crashado ou deadlocked ficavam em `RUNNING` para sempre, nunca
sendo rescheduadas. O `AttemptWatchdog` cobre o caso `t.status='RUNNING' AND a.status='RUNNING'`,
mas o `HeartbeatWatchdog` cobre `a.status='RUNNING'` independente de `t.status` (state mismatch).

**Correção**: Substituir `recordEvent(DRIVER_TASK_FAILED)` por chamadas diretas de `updateAttempt`
+ `updateTask` + `releaseTaskLock` (mesmo padrão do `AttemptWatchdog`). O event de auditoria
`TASK_WATCHDOG_HEARTBEAT_TIMEOUT` ainda é registrado para observabilidade, mas agora com dedupKey
estável.

---

### BUG-HB-DEDUP (P1 — ALTO)

**Arquivo**: `src/agent/heartbeat_watchdog.js`

**Descrição**: O `dedupKey` incluía `${now}` (timestamp do tick):
```js
dedupKey: `watchdog:${taskId}:${attemptId}:heartbeat_timeout:${now}`
```
Isso garantia que **nunca havia deduplicação** — cada tick registrava um novo evento para a
mesma task/attempt. Com intervalos de 60s e threshold de 3min, uma task stale acumulava ~3+
eventos por minuto, sem efeito real (pois o `recordEvent` não disparava o projector).

**Correção**: Remover `${now}` do dedupKey:
```js
dedupKey: `watchdog:hb:${taskId}:${attemptId}:heartbeat_timeout`
```
Garante que o watchdog processa cada (taskId, attemptId) exatamente uma vez.

---

### BUG-PAUSE-RACE (P0 — CRÍTICO) — *corrigido na sessão anterior*

**Arquivo**: `src/agent/task_control_watcher.js`

**Descrição**: `pauseTaskCommand` chamava `releaseTaskLock` antes do `TaskControlWatcher` ter
chance de enviar `DRIVER_ABORT`. O watcher só buscava tasks `PAUSED/CANCELLED` com
`locked_by IS NOT NULL` — se o lock já tinha sido liberado, o abort nunca chegava ao driver.

**Correção**: Expandir o WHERE para incluir tasks PAUSED/CANCELLED atualizadas nos últimos 5
minutos, independente de terem lock ativo. A dedupKey em `CONTROL_ABORT_INTENT` (baseada no
`intentAt`) garante idempotência.

---

### GAP-UI-BLOCKED (P1) — *corrigido na sessão anterior*

**Arquivos**: `src/server/api/utils/task_views.js`, `src/dashboard-ui/src/views/TaskDetail.vue`

**Descrição**: `taskRowToDetailTask` não expunha `blocked_reason`, `blocked_details`,
`last_error` do DB — apenas lia `task_json`. O usuário não sabia por que a task estava BLOCKED.

**Correção**:
- `taskRowToDetailTask` agora popula `task.blocked_reason`, `task.blocked_details`,
  `task.last_error`, `task.blocked_at_ms` a partir das colunas do DB
- `TaskDetail.vue` mostra painel âmbar com blocked_reason + detalhes + instrução de ação
- Painel vermelho com `last_error` para tasks FAILED/BLOCKED
- Painel verde com links para artefatos de resposta quando task está DONE

---

## Áreas Verificadas e Sem Bugs Críticos

- `TaskStateProjector`: lógica de projeção de DRIVER_TASK_COMPLETED/FAILED/ABORTED ✓
- `TaskOrchestrationWorker`: _handleIterative, _handleMultiStep, _handleMissingOutput ✓
- `AttemptWatchdog`: detecção de DISPATCHED/ACCEPTED/RUNNING stale, escalação ENV_UNAVAILABLE ✓
- `TaskControlWatcher`: fluxo de abort para PAUSED/CANCELLED (após correção BUG-PAUSE-RACE) ✓
- `MissionExecutionService`: transições de estado com allowedFrom guards e preconditions ✓
- `ChatGPTDriver`: sendPrompt, waitForCompletion com AbortSignal e timeout máximo ✓
- `pauseMissionTransition`: taskMutation pausa tasks PENDING/RUNNING ✓
- `resumeMissionTransition`: taskMutation retoma tasks PAUSED ✓
- `cancelMissionTransition`: taskMutation cancela tasks PENDING/RUNNING/PAUSED/FAILED ✓

---

## Lacunas na Cobertura

- **Driver Gemini/Claude**: não auditados nesta sessão (foco em ChatGPTDriver)
- **`queue_worker.js`**: não auditado completamente — especialmente a lógica de `max_attempts`
- **`TaskAttemptInvariants`**: não auditado — verifica stale attempts no projector
- **Testes de integração**: não cobrem o cenário BUG-MISSION-BLOCKED

---

## Checklist de Quality Gates

- [x] `npm run lint` — sem erros
- [x] `npm run test:unit` — 798/2 (2 falhas são de infra de CI, pré-existentes)
- [x] Correções mínimas aplicadas (sem refatoração desnecessária)
