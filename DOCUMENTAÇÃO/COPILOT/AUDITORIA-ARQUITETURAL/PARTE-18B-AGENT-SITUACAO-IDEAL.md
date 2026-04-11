# PARTE-18B — Auditoria `src/copilot/agent/` — Situação Ideal

> **Data**: 2026-06-28 | **Baseline**: PARTE-18A
> **Objetivo**: Descrever o estado-alvo arquitetural do módulo agent após a resolução de todos os bugs, gaps e smells.

---

## 1. Princípios-Alvo

1. **Zero sync I/O**: Todas as operações de arquivo e estado são async
2. **Boundary discipline**: Agent importa apenas de `#copilot/{core,sdk,config,observability}`
3. **Trace coverage**: Toda operação observável tem OTEL span
4. **Single-purpose modules**: Nenhum arquivo > 400 linhas; cada módulo tem uma responsabilidade clara
5. **Encapsulated state**: AgentContext expõe getters/setters com validação, não campos abertos
6. **No deprecated paths**: APIs deprecated removidas ou desabilitadas em runtime

---

## 2. Estado I/O — Meta Zero Sync

### 2.1 State Persistence

**Atual**: `persistState()` sync (13 chamadas) + `writeStateAsync()` (11 chamadas) coexistem.

**Ideal**:
- `persistState()` removido — todo caller migrado para `writeStateAsync()`
- `readState()` removido — todo caller migrado para `readStateAsync()`
- `clearState()` removido — todo caller migrado para `clearStateAsync()` (já concluído)
- Módulo `state-io.js` exporta apenas as versões async
- Callers sync substituídos por fire-and-forget `void writeStateAsync(...)` onde não precisam de await

### 2.2 Snapshot

**Atual**: 4 funções sync deprecated + 4 funções async. `loadLatestSnapshot()` está quebrada.

**Ideal**:
- Funções sync (`saveSnapshot`, `listSnapshots`, `loadSnapshot`, `pruneSnapshots`) removidas
- `loadLatestSnapshot()` corrigido para usar `listSnapshotsAsync()`
- Export barrel atualizado para expor apenas versões async
- `snapshot.js` reduzido de 304L para ~200L

---

## 3. Boundaries — Dependency Inversion

### 3.1 Imports Diretos a Eliminar

| Import atual                       | Módulo de destino    | Solução                                  |
| ---------------------------------- | -------------------- | ---------------------------------------- |
| `../../conversation-hub/store.js`  | `history-sync.js`    | Inverter: hub → agent (observer pattern) |
| `../../terminal/state.js`          | `history-sync.js`    | Receber `hubSessionId` via callback/ctx  |
| `../../tools/hook-tools.js`        | `agent-messaging.js` | Abstrair como callback em AgentContext   |
| `../../bridges/mcp-tool-bridge.js` | 2 files              | Receber MCP bridge via injeção (ctx)     |
| `../../config/mcp-servers.js`      | `session-setup.js`   | Usar `#copilot/config` barrel            |

### 3.2 Padrão-Alvo de Imports

```
src/copilot/agent/** pode importar de:
  ├── #copilot/core/*          (contratos, errors, schemas)
  ├── #copilot/sdk/*           (SDK abstractions)
  ├── #copilot/config/*        (configuração)
  ├── #copilot/observability/* (logging, metrics, otel)
  └── ./  ../                  (intra-agent apenas)

NÃO pode importar de:
  ├── #copilot/tools/*
  ├── #copilot/terminal/*
  ├── #copilot/conversation-hub/*
  └── #copilot/bridges/*
```

### 3.3 history-sync.js — Inversão de Dependência

**Atual**: Agent puxa dados do ConversationStore e TerminalState.

**Ideal**: `history-sync.js` recebe as dependências via callbacks registrados em `boot-wiring.js`:
```js
// boot-wiring.js
ctx.historySyncDeps = {
    getConversationStore: () => conversationStore,
    getHubSessionId: () => getHubSessionId(),
};
```
Ou melhor: mover `history-sync` para `conversation-hub/` (ownership correto: quem possui o store faz o sync).

---

## 4. OTEL Spans — Cobertura Meta

### 4.1 Spans a Adicionar

| Operação                  | Nome do Span                   | Atributos                          |
| ------------------------- | ------------------------------ | ---------------------------------- |
| `agentStop()`             | `copilot.agent.stop`           | `reason`, `graceful`, `durationMs` |
| `sendMessage()`           | `copilot.agent.sendMessage`    | `taskId`, `messageLength`          |
| `steerMessage()`          | `copilot.agent.steer`          | `messageId`, `promptLength`        |
| `answerPendingQuestion()` | `copilot.agent.answer`         | `answerLength`                     |
| `cleanupStaleSessions()`  | `copilot.session.cleanup`      | `total`, `deleted`, `errors`       |
| `sessionRotation`         | `copilot.session.rotation`     | `reason`, `oldSessionId`           |
| `snapshot save/load`      | `copilot.snapshot.{save,load}` | `snapshotId`, `sizeBytes`          |

### 4.2 Dialog Loop Duration

**Atual**: `copilot.dialog.loop` span é criado no start mas endSpan não é chamado com atributos de métricas finais.

**Ideal**: No stop/forceDeactivate, o span é encerrado com:
- `totalTurns`
- `totalDurationMs`
- `prMetrics` (boots, resumes)
- `stopReason` (authorized, watchdog, error)

---

## 5. SDK Integration Completeness

### 5.1 `setSessionModel()` — Notificação do SDK

**Atual**: Agent muda `ctx.model` mas não notifica o SDK via `setSessionModel()`.

**Ideal**: `setRuntimeModel()` no agent chama `setSessionModel()` depois de atualizar `ctx.model`, garantindo que o servidor SDK reflete o modelo ativo.

### 5.2 `listAvailableModels()` — Model Discovery

**Atual**: Fallback de modelo é estático (config env).

**Ideal**: `ModelFallbackState.schedule()` consulta `listAvailableModels()` para validar que o modelo de fallback existe e está disponível antes de agendar.

### 5.3 Feature Flags

**Atual**: `sdk/feature-flags.js` exporta `isExperimentalEnabled()` mas agent nunca consulta.

**Ideal**: `boot-wiring.js` consulta feature flags no início para habilitar/desabilitar capabilities experimentais (ex: handoff, multi-agent, snapshot_rewind).

### 5.4 Typed Event Filters

**Atual**: Event handlers fazem `session.on('event.name', ...)` com strings manuais.

**Ideal**: Usar `SESSION_EVENTS` constants do SDK em todos os handlers (parcialmente feito em compaction.js e streaming.js, mas não em sdk-responses.js).

---

## 6. Separação de Responsabilidades

### 6.1 `loop-manager.js` — Decomposição

**Atual**: 600 linhas com 5+ responsabilidades.

**Ideal** (meta ≤ 400L):
- **FSM + start/stop**: permanece em `loop-manager.js`
- **Boot logic** (sendBoot, handleReady): já parcialmente em `turn-executor.js` — ampliar
- **PR metrics tracking**: extrair para `dialog/pr-metrics.js` (~50L)
- **Compaction handling** (`handleTokenBudget`, `resetCompactionFlag`): extrair para `dialog/compaction-handler.js` (~40L)

### 6.2 `hook-context.js` — Redução de I/O

**Atual**: Lê 4 fontes de I/O (briefing, session.json, skills, todos).

**Ideal**:
- TODO count removido (não é responsabilidade do system prompt do agent)
- Skills loading via callback ou pre-cached no boot-wiring
- Briefing e session.json consolidados num único read (ou cached com TTL)

### 6.3 `agent-messaging.js` — Remoção de Hook-Tools Coupling

**Atual**: `answerPendingQuestion()` chama `resolveUserInput()` de `tools/hook-tools.js`.

**Ideal**: Hook-tools registra um listener em `host.on('question.answered')` — o agent apenas emite o evento, hook-tools reage. Zero import cross-boundary.

---

## 7. Singleton Pattern

### 7.1 Estado Atual
- `alwaysAliveAgent` instanciado no module scope (cold start)
- `getAgent()` retorna a mesma instância
- Consumers mistos (import direto vs `getAgent()`)

### 7.2 Estado Ideal
- Instanciação lazy: `getAgent()` cria na primeira chamada (não no import)
- Export nomeado apenas `getAgent()` (sem export default do singleton)
- Consumers uniformizados para usar `getAgent()`
- Facilita teste: `_resetAgentForTest()` pode nullificar a instância

---

## 8. Metrics Double-Recording

### 8.1 Atual
- `recordSessionRotation()` chamado em `rotation.js` (decisão) E `initializer.js` (execução)
- Resulta em contagem duplicada

### 8.2 Ideal
- Métrica emitida apenas no ponto de execução (`initializer.js`)
- `rotation.js` retorna decisão pura sem side-effects de métricas
- `shouldRotateSession()` é pure function

---

## 9. Resumo das Métricas-Alvo

| Métrica                    | Atual | Ideal | Delta |
| -------------------------- | ----: | ----: | ----: |
| Chamadas sync I/O          |    30 |     0 |   -30 |
| Violações de boundary      |     5 |     0 |    -5 |
| Operações sem OTEL span    |     7 |     0 |    -7 |
| APIs deprecated exportadas |     7 |     0 |    -7 |
| Bugs confirmados           |     3 |     0 |    -3 |
| Métricas duplicadas        |     1 |     0 |    -1 |
| Linhas loop-manager.js     |   600 |  ≤400 |  -200 |
| Linhas snapshot.js         |   304 |  ≤200 |  -104 |
