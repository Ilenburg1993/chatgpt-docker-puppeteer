# PARTE-18C — Auditoria `src/copilot/agent/` — Roadmap de Correções

> **Data**: 2026-06-28 | **Baseline**: PARTE-18A (Situação Atual) + PARTE-18B (Situação Ideal)  
> **Estratégia**: Faixas incrementais, cada uma com commit isolado, testes validados, zero regressão.

---

## Sumário de Faixas

| Faixa | Prioridade | Tema                                     | Estimativa (linhas) | Risco |
| ----- | ---------- | ---------------------------------------- | ------------------: | ----- |
| F61   | 🔴 P0     | BUG-A01: Fix loadLatestSnapshot broken   |                ~20  | Baixo |
| F62   | 🔴 P0     | BUG-A02: Migrar persistState→writeStateAsync (dialog/) | ~40 | Médio |
| F63   | 🔴 P0     | BUG-A02: Migrar persistState→writeStateAsync (session+messaging) | ~30 | Médio |
| F64   | 🟡 P1     | BUG-A02: Migrar readState→readStateAsync (all callers)  | ~35 | Médio |
| F65   | 🟡 P1     | Remover APIs deprecated sync de snapshot.js e state-io.js | ~80 remoção | Médio |
| F66   | 🟡 P1     | BUG-A03: AbortSignal em steerMessage     |                ~15  | Baixo |
| F67   | 🟡 P1     | Boundary fix: history-sync dependency inversion | ~30 | Médio |
| F68   | 🟡 P1     | Boundary fix: hook-tools decoupling      |                ~20  | Baixo |
| F69   | 🟡 P1     | Boundary fix: MCP injection via ctx      |                ~25  | Médio |
| F70   | 🟢 P2     | OTEL spans: agentStop, sendMessage, steer, answer | ~50 | Baixo |
| F71   | 🟢 P2     | OTEL spans: cleanup, rotation, snapshot  |                ~40  | Baixo |
| F72   | 🟢 P2     | SDK integration: setSessionModel + listAvailableModels | ~30 | Médio |
| F73   | 🟢 P2     | SDK integration: feature flags + typed events | ~30 | Baixo |
| F74   | 🟢 P2     | Metrics double-recording fix (rotation)  |                ~10  | Baixo |
| F75   | 🟢 P2     | loop-manager decomposição (PR metrics + compaction) | ~80 extração | Médio |

---

## Detalhamento por Faixa

### F61 — BUG-A01: Fix `loadLatestSnapshot()` (P0)

**Problema**: `loadLatestSnapshot()` chama `listSnapshots()` que está deprecated e retorna `[]`, tornando restore inoperante.

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

**Arquivos**: `src/copilot/agent/session/snapshot.js`  
**Testes**: Atualizar `tests/copilot/agent/session/snapshot.test.js`  
**Validação**: `npm run test:unit -- --reporter=dot`

---

### F62 — Migrar persistState→writeStateAsync (dialog/) (P0)

**Problema**: 8 chamadas a `persistState()` sync em `dialog/` — race condition com async writers.

**Arquivos afetados**:
- `dialog/loop-manager.js` — 6 chamadas (`dialogLoopActive`, `prMetrics` × 4, `dialogPaused` read)
- `dialog/turn-executor.js` — 1 chamada
- `dialog/user-input-handler.js` — 2 chamadas

**Correção**: Substituir `persistState(data, label)` por `void writeStateAsync(data, label)` (fire-and-forget, mantendo o pattern de "persist best-effort"). Onde o await é necessário (shutdown), usar `await writeStateAsync(...)`.

**Testes**: Ajustar mocks em `tests/copilot/agent/dialog/` para esperar `writeStateAsync` em vez de `persistState`.

---

### F63 — Migrar persistState→writeStateAsync (session + messaging) (P0)

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

**Nota**: `readState()` é chamado em hot paths (loop start, resume). A migração para async requer que os callers sejam `async` — verificar se já são antes de migrar.

**Mitigação**: Todos os callers relevantes já são `async function` — migração segura.

---

### F65 — Remover APIs deprecated sync (P1)

**Pré-requisito**: F62-F64 concluídas (zero callers sync).

**Ação**:
1. Remover `persistState()`, `readState()`, `clearState()` de `state-io.js`
2. Remover `saveSnapshot()`, `listSnapshots()`, `loadSnapshot()`, `pruneSnapshots()` de `snapshot.js`
3. Atualizar barrels (`index.js`) para não re-exportar APIs removidas
4. Atualizar testes que usam as versões sync

**Redução estimada**: ~80 linhas removidas.

---

### F66 — AbortSignal em steerMessage (P1)

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

**Problema**: `history-sync.js` importa de `../../conversation-hub/store.js` e `../../terminal/state.js`.

**Solução A** (preferida): Mover `history-sync.js` para `src/copilot/conversation-hub/` (ownership correto).

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

### F68 — Boundary fix: hook-tools decoupling (P1)

**Problema**: `agent-messaging.js` importa `resolveUserInput` de `../../tools/hook-tools.js`.

**Solução**: Hook-tools registra listener em `host.on('question.answered')` durante boot-wiring. Agent apenas emite `'question.answered'` — zero import cross-boundary.

**Arquivos**:
- `messaging/agent-messaging.js` — remover import e chamada direta
- `session/boot-wiring.js` — registrar listener de hook-tools

---

### F69 — Boundary fix: MCP injection via ctx (P1)

**Problema**: `boot-wiring.js` e `session-setup.js` importam de `../../bridges/mcp-tool-bridge.js` e `../../config/mcp-servers.js`.

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
1. Em `setRuntimeModel()` (always-alive facade): chamar `setSessionModel()` do SDK após atualizar `ctx.model`
2. Em `ModelFallbackState.schedule()`: consultar `listAvailableModels()` para validar modelo existe

---

### F73 — SDK integration: feature flags + typed events (P2)

**Ações**:
1. Em `boot-wiring.js`: consultar `isExperimentalEnabled()` para handoff, multi-agent
2. Em `sdk-responses.js`: substituir strings manuais por `SESSION_EVENTS.*` constants

---

### F74 — Metrics double-recording fix (P2)

**Problema**: `recordSessionRotation()` chamado em `rotation.js` E `initializer.js`.

**Correção**: Remover `recordIfRotated()` de `rotation.js` — `shouldRotateSession()` retorna decisão pura. Métrica emitida apenas em `initializer.js` no ponto de execução.

---

### F75 — loop-manager decomposição (P2)

**Extrair de `loop-manager.js` (600L → ~400L)**:
1. `dialog/pr-metrics.js` (~50L) — tracking de boots, resumes, zeroPR
2. `dialog/compaction-handler.js` (~40L) — `handleTokenBudget`, `resetCompactionFlag`, flag de compaction ativa

---

## Sequência de Execução

```
P0 (bugs críticos):     F61 → F62 → F63
P1 (debt + boundary):   F64 → F65 → F66 → F67 → F68 → F69
P2 (enhancements):      F70 → F71 → F72 → F73 → F74 → F75
```

**Regra**: Cada faixa gera 1 commit. Antes do commit: `npm run lint && npm run test:unit`.

---

## Métricas de Sucesso

| Métrica                     | Antes | Após F65 | Após F75 |
| --------------------------- | ----: | -------: | -------: |
| Chamadas sync I/O           |    30 |        0 |        0 |
| Violações de boundary       |     5 |        5 |        0 |
| Bugs confirmados            |     3 |        1 |        0 |
| Operações sem OTEL span     |     7 |        7 |        0 |
| APIs deprecated exportadas  |     7 |        0 |        0 |
| Linhas loop-manager.js      |   600 |      600 |     ≤400 |
