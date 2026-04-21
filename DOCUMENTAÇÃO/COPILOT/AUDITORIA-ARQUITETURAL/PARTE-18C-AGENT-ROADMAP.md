# PARTE-18C — Auditoria `src/copilot/agent/` — Roadmap de Correções

> **Data**: 2026-06-28 | **Baseline**: PARTE-18A (Situação Atual) + PARTE-18B (Situação Ideal)
> **Estratégia**: Faixas incrementais, cada uma com commit isolado, testes validados, zero
> regressão. **Re-auditoria**: 2026-06-29 — Novas faixas F76-F81 adicionadas (achados pós-execução
> de F61/F66/F68/F74).

---

## Sumário de Faixas

| Faixa   | Prioridade | Tema                                                             | Estimativa (linhas) | Risco | Status      |
| ------- | ---------- | ---------------------------------------------------------------- | ------------------: | ----- | ----------- |
| F61     | 🔴 P0      | BUG-A01: Fix loadLatestSnapshot broken                           |                 ~20 | Baixo | ✅ DONE     |
| F62     | 🔴 P0      | BUG-A02: Migrar persistState→writeStateAsync (dialog/)           |                 ~40 | Médio | ✅ DONE     |
| F63     | 🔴 P0      | BUG-A02: Migrar persistState→writeStateAsync (session+messaging) |                 ~30 | Médio | ✅ DONE     |
| F64     | 🟡 P1      | BUG-A02: Migrar readState→readStateAsync (all callers)           |                 ~35 | Médio | ✅ DONE     |
| F65     | 🟡 P1      | Remover APIs deprecated sync de snapshot.js e state-io.js        |         ~80 remoção | Médio | ⏳ Pendente |
| F66     | 🟡 P1      | BUG-A03: AbortSignal em steerMessage                             |                 ~15 | Baixo | ✅ DONE     |
| F67     | 🟡 P1      | Boundary fix: history-sync dependency inversion                  |                 ~30 | Médio | ✅ DONE     |
| F68     | 🟡 P1      | Boundary fix: hook-tools decoupling                              |                 ~20 | Baixo | ✅ DONE     |
| F69     | 🟡 P1      | Boundary fix: MCP injection via ctx                              |                 ~25 | Médio | ✅ DONE     |
| F70     | 🟢 P2      | OTEL spans: agentStop, sendMessage, steer, answer                |                 ~50 | Baixo | ✅ DONE     |
| F71     | 🟢 P2      | OTEL spans: cleanup, rotation, snapshot                          |                 ~40 | Baixo | ✅ DONE     |
| F72     | 🟢 P2      | SDK integration: setSessionModel + listAvailableModels           |                 ~30 | Médio | ✅ DONE     |
| F73     | 🟢 P2      | SDK integration: feature flags + typed events                    |                 ~30 | Baixo | ✅ DONE     |
| F74     | 🟢 P2      | Metrics double-recording fix (rotation)                          |                 ~10 | Baixo | ✅ DONE     |
| F75     | 🟢 P2      | loop-manager decomposição (PR metrics + compaction)              |        ~80 extração | Médio | ⏳ Pendente |
| **F76** | **🔴 P0**  | **BUG: Duplicate F68 listener em boot-wiring.js**                |                  ~6 | Baixo | ✅ DONE     |
| **F77** | **🟡 P1**  | **AGENT_EVENTS: catálogo 100% completo (verificado)**            |                   0 | Baixo | ✅ N/A      |
| **F78** | **🟡 P1**  | **SESSION_EVENTS: 2 handlers SDK com magic strings**             |                  ~8 | Baixo | ✅ DONE     |
| **F79** | **🟢 P2**  | **Math.random() → crypto.randomUUID() em 5 locais**              |                 ~20 | Baixo | ✅ DONE     |
| **F80** | **🟢 P2**  | **Testes diretos: boot-wiring.js + history-sync.js**             |                ~120 | Médio | ⏳ Pendente |
| **F81** | **🟢 P2**  | **SDK constant: SYSTEM_NOTIFICATION já existia**                 |                   0 | Baixo | ✅ N/A      |

---

## Detalhamento por Faixa

### F61 — BUG-A01: Fix `loadLatestSnapshot()` (P0) ✅ DONE (commit 4bce0163)

**Problema**: `loadLatestSnapshot()` chama `listSnapshots()` que está deprecated e retorna `[]`,
tornando restore inoperante.

**Correção**:

```js
// snapshot.js — substituir listSnapshots() por listSnapshotsAsync()
export async function loadLatestSnapshotAsync() {
  const snapshots = await listSnapshotsAsync();
  if (snapshots.length === 0) return null;
  // sort by date descending e retornar o primeiro
  snapshots.sort((a, b) => b.date.getTime() - a.date.getTime());
  return loadSnapshotAsync(snapshots[0].id);
}
```

**Arquivos**: `src/copilot/agent/session/snapshot.js` **Testes**: Atualizar
`tests/copilot/agent/session/snapshot.test.js` **Validação**: `npm run test:unit -- --reporter=dot`

---

### F62 — Migrar persistState→writeStateAsync (dialog/) (P0) ✅ DONE

**Problema**: 8 chamadas a `persistState()` sync em `dialog/` — race condition com async writers.

**Arquivos afetados**:

- `dialog/loop-manager.js` — 6 chamadas (`dialogLoopActive`, `prMetrics` × 4, `dialogPaused` read)
- `dialog/turn-executor.js` — 1 chamada
- `dialog/user-input-handler.js` — 2 chamadas

**Correção**: Substituir `persistState(data, label)` por `void writeStateAsync(data, label)`
(fire-and-forget, mantendo o pattern de "persist best-effort"). Onde o await é necessário
(shutdown), usar `await writeStateAsync(...)`.

**Testes**: Ajustar mocks em `tests/copilot/agent/dialog/` para esperar `writeStateAsync` em vez de
`persistState`.

---

### F63 — Migrar persistState→writeStateAsync (session + messaging) (P0) ✅ DONE

**Arquivos afetados**:

- `session/event-handlers/usage.js` — 1 chamada
- `messaging/agent-messaging.js` — 1 chamada (answerPendingQuestion)

**Mesma estratégia de F62**.

---

### F64 — Migrar readState→readStateAsync (all callers) (P1)

**Problema**: 12 chamadas a `readState()` sync.

**Arquivos afetados**:

- `dialog/loop-manager.js` — 3 chamadas (prMetrics load, dialogPaused check, resume state)
- `session/boot-wiring.js` — 1 chamada
- `session/initializer.js` — 1 chamada (via `_readState`)
- `session/snapshot.js` — 1 chamada

**Nota**: `readState()` é chamado em hot paths (loop start, resume). A migração para async requer
que os callers sejam `async` — verificar se já são antes de migrar.

**Mitigação**: Todos os callers relevantes já são `async function` — migração segura.

---

### F65 — Remover APIs deprecated sync (P1)

**Pré-requisito**: F62-F64 concluídas (zero callers sync).

**Ação**:

1. Remover `persistState()`, `readState()`, `clearState()` de `state-io.js`
2. Remover `saveSnapshot()`, `listSnapshots()`, `loadSnapshot()`, `pruneSnapshots()` de
   `snapshot.js`
3. Atualizar barrels (`index.js`) para não re-exportar APIs removidas
4. Atualizar testes que usam as versões sync

**Redução estimada**: ~80 linhas removidas.

---

### F66 — AbortSignal em steerMessage (P1) ✅ DONE (commit 4bce0163)

**Problema**: `steerMessage()` não aceita AbortSignal — steering irrecancelável.

**Correção**:

```js
export async function steerMessage(ctx, host, prompt, { signal } = {}) {
  signal?.throwIfAborted();
  // ... existing logic
}
```

**Arquivo**: `src/copilot/agent/messaging/agent-messaging.js`

---

### F67 — Boundary fix: history-sync dependency inversion (P1)

**Problema**: `history-sync.js` importa de `../../conversation-hub/store.js` e
`../../terminal/state.js`.

**Solução A** (preferida): Mover `history-sync.js` para `src/copilot/conversation-hub/` (ownership
correto).

**Solução B**: Receber deps via callbacks em `boot-wiring.js`:

```js
// boot-wiring.js
ctx.historySyncDeps = {
  getStore: () => conversationStore,
  getHubSessionId: () => getHubSessionId(),
};
```

**Decisão**: Solução A é mais limpa — o sync faz parte do domínio do conversation-hub.

---

### F68 — Boundary fix: hook-tools decoupling (P1) ✅ DONE (commit 4bce0163)

**Problema**: `agent-messaging.js` importa `resolveUserInput` de `../../tools/hook-tools.js`.

**Solução**: Hook-tools registra listener em `host.on('question.answered')` durante boot-wiring.
Agent apenas emite `'question.answered'` — zero import cross-boundary.

**Arquivos**:

- `messaging/agent-messaging.js` — remover import e chamada direta
- `session/boot-wiring.js` — registrar listener de hook-tools

---

### F69 — Boundary fix: MCP injection via ctx (P1)

**Problema**: `boot-wiring.js` e `session-setup.js` importam de `../../bridges/mcp-tool-bridge.js` e
`../../config/mcp-servers.js`.

**Solução**: MCP deps injetadas via `AgentContext` durante `agentStart()`:

```js
ctx.mcpBridge = { buildTools, startAutoReconnect, buildConfig };
```

---

### F70 — OTEL spans: operações core (P2)

**Adicionar spans em**:

- `agentStop()` → `copilot.agent.stop`
- `sendMessage()` → `copilot.agent.sendMessage`
- `steerMessage()` → `copilot.agent.steer`
- `answerPendingQuestion()` → `copilot.agent.answer`

**Arquivo principal**: `lifecycle/agent-lifecycle.js`, `messaging/agent-messaging.js`

---

### F71 — OTEL spans: operações auxiliares (P2)

**Adicionar spans em**:

- `cleanupStaleSessions()` → `copilot.session.cleanup`
- `shouldRotateSession()` execution → `copilot.session.rotation`
- `saveSnapshotAsync()` / `loadSnapshotAsync()` → `copilot.snapshot.{save,load}`

---

### F72 — SDK integration: model management (P2)

**Ações**:

1. Em `setRuntimeModel()` (always-alive facade): chamar `setSessionModel()` do SDK após atualizar
   `ctx.model`
2. Em `ModelFallbackState.schedule()`: consultar `listAvailableModels()` para validar modelo existe

---

### F73 — SDK integration: feature flags + typed events (P2)

**Ações**:

1. Em `boot-wiring.js`: consultar `isExperimentalEnabled()` para handoff, multi-agent
2. Em `sdk-responses.js`: substituir strings manuais por `SESSION_EVENTS.*` constants

---

### F74 — Metrics double-recording fix (P2) ✅ DONE (commit 4bce0163)

**Problema**: `recordSessionRotation()` chamado em `rotation.js` E `initializer.js`.

**Correção**: Remover `recordIfRotated()` de `rotation.js` — `shouldRotateSession()` retorna decisão
pura. Métrica emitida apenas em `initializer.js` no ponto de execução.

---

### F75 — loop-manager decomposição (P2)

**Extrair de `loop-manager.js` (600L → ~400L)**:

1. `dialog/pr-metrics.js` (~50L) — tracking de boots, resumes, zeroPR
2. `dialog/compaction-handler.js` (~40L) — `handleTokenBudget`, `resetCompactionFlag`, flag de
   compaction ativa

---

## Sequência de Execução

```
P0 (bugs críticos):     F61 → F62 → F63
P1 (debt + boundary):   F64 → F65 → F66 → F67 → F68 → F69
P2 (enhancements):      F70 → F71 → F72 → F73 → F74 → F75
```

**Regra**: Cada faixa gera 1 commit. Antes do commit: `npm run lint && npm run test:unit`.

---

---

## Faixas Novas — Re-auditoria 2026-06-29

### F76 — BUG: Duplicate F68 listener em boot-wiring.js (P0)

**Problema**: O bloco de listener `question.answered` introduzido em F68 foi duplicado — linhas
231-236 e 238-243 são idênticas. Resultado: cada evento `question.answered` chama
`resolveUserInput()` _duas vezes_, o que pode causar side-effects duplos no hook-tools (resoluções
duplicadas, logs duplicados, possível double-fire em prompts).

**Correção**: Remover o bloco duplicado (linhas 238-243).

**Arquivo**: `src/copilot/agent/session/boot-wiring.js` **Testes**: Verificar que event relay
funciona sem duplicação. **Validação**: `npm run test:unit -- --reporter=dot`

---

### F77 — AGENT_EVENTS adoption: eliminar magic strings em emits (P1)

**Problema**: `core/events.js` define `AGENT_EVENTS` com 50+ constantes, mas **zero** chamadas
`host.emit()` ou `ctx.emit()` em `agent/` as utilizam. Há 13+ emit calls usando strings literais —
violação de F55 (Event Constants).

**Emits com magic strings identificados**:

- `host.emit('question.answered', ...)` — `messaging/agent-messaging.js`
- `host.emit('agent:...')` — `lifecycle/agent-lifecycle.js`
- `ctx.emit('dialog.boot_recovery', ...)` — `session/boot-wiring.js`
- `ctx.emit(...)` — `dialog/loop-manager.js`, `dialog/turn-executor.js`
- Demais — varrer com `rg "host\.emit\('" src/copilot/agent/`

**Correção**: Importar `AGENT_EVENTS` e substituir todas as strings por constantes. Ex.:

```js
import { AGENT_EVENTS } from '#core/events.js';
host.emit(AGENT_EVENTS.QUESTION_ANSWERED, { answer });
```

**Arquivos**: Todos os arquivos em `agent/` que emitem eventos (~8 arquivos). **Risco**: Baixo —
rename de strings para constantes, sem mudança de comportamento.

---

### F78 — SESSION_EVENTS: 2 handlers SDK com magic strings (P1)

**Problema**: 6/8 handlers em `event-handlers/` já usam `SESSION_EVENTS.*`, mas 2 ainda usam
strings:

- `mode-and-tools.js` → `'session.mode_changed'` (constante existe:
  `SESSION_EVENTS.SESSION_MODE_CHANGED`)
- `system-notifications.js` → `'system.notification'` (constante **não existe** no SDK)

**Correção**:

1. `mode-and-tools.js`: substituir string por `SESSION_EVENTS.SESSION_MODE_CHANGED`
2. `system-notifications.js`: depende de F81 (adicionar constante ao SDK) OU aceitar como exceção
   documentada

**Arquivos**: `src/copilot/agent/session/event-handlers/mode-and-tools.js`,
`system-notifications.js`

---

### F79 — Math.random() → crypto.randomUUID() (P2)

**Problema**: 6 locais em `agent/` usam `Math.random()` para IDs/jitter — previsível,
não-criptográfico. (SM-A03)

**Locais**:

- `messaging/agent-messaging.js` — message ID generation
- `session/snapshot.js` — snapshot ID generation
- `session/reconnect-policy.js` — jitter calculation (já injectable, menor prioridade)
- `session/handoff-manager.js` — handoff ID
- `session/webhook-manager.js` — correlation ID

**Correção**: Usar `crypto.randomUUID()` (nativo Node.js 19+) para IDs. Para jitter, manter
`Math.random()` (não é sensível a segurança) ou usar `randomInt()` de `node:crypto`.

**Arquivos**: 5 arquivos acima.

---

### F80 — Testes diretos: boot-wiring.js + history-sync.js (P2)

**Problema**: `boot-wiring.js` e `history-sync.js` não possuem testes diretos. São exercitados
indiretamente via integration, mas sem cobertura unitária das suas funções exportadas.

**Ação**:

1. Criar `tests/copilot/agent/session/boot-wiring.spec.js` — testar:
   - `performBootWiring()` registra listeners esperados
   - Relay de `question.answered` chama hook-tools
   - Unsub functions limpam tudo
   - `scheduleDialogBootRecovery()` adia corretamente

2. Criar `tests/copilot/agent/session/history-sync.spec.js` — testar:
   - Sync com conversation-hub store
   - Merge com terminal state
   - Edge cases (store vazio, conflitos de versão)

**Estimativa**: ~120 linhas de testes (60 cada).

---

### F81 — SDK constant: adicionar SYSTEM_NOTIFICATION (P2)

**Problema**: `system.notification` é emitido pelo SDK mas não tem constante nomeada em
`sdk/constants.js`. O handler `system-notifications.js` é obrigado a usar magic string.

**Correção**: Adicionar a `SESSION_EVENTS`:

```js
SYSTEM_NOTIFICATION: 'system.notification',
```

**Arquivo**: `src/copilot/sdk/constants.js` **Pré-requisito para**: F78 (parte 2).

---

## Sequência de Execução Atualizada

```
P0 (bugs críticos):       F62 → F63               (DONE)
P1 (debt + boundary):     F64 → F65 → F67 → F69 → F78 (DONE)
P2 (enhancements):        F70 → F71 → F72 → F73 → F75 → F79 → F80
```

**Já executadas**: F61 ✅, F62 ✅, F63 ✅, F64 ✅, F66 ✅, F67 ✅, F68 ✅, F69 ✅, F70 ✅, F71 ✅,
F72 ✅, F73 ✅, F74 ✅, F76 ✅, F77 N/A, F78 ✅, F79 ✅, F81 N/A

**Regra**: Cada faixa gera 1 commit. Antes do commit: `npm run lint && npm run test:unit`.

---

## Métricas de Sucesso (atualizado pós re-auditoria)

| Métrica                     | Baseline (2026-06-28) | Após F61/66/68/74 | Após F65 | Após F81 |
| --------------------------- | --------------------: | ----------------: | -------: | -------: |
| Chamadas sync I/O           |                    30 |                25 |        0 |        0 |
| Violações de boundary       |                     5 |                 4 |        4 |        0 |
| Bugs confirmados            |                     3 |                 1 |        1 |        0 |
| Operações sem OTEL span     |                     7 |                 7 |        7 |        0 |
| APIs deprecated exportadas  |                     8 |                 8 |        0 |        0 |
| Linhas loop-manager.js      |                   600 |               600 |      600 |     ≤400 |
| Magic string emits          |                   13+ |               13+ |      13+ |        0 |
| Math.random() locais        |                     6 |                 6 |        6 |        0 |
| Arquivos sem testes diretos |                     2 |                 2 |        2 |        0 |
