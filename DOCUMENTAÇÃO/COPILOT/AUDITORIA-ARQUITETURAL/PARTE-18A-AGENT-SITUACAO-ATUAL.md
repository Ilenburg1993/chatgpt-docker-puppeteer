# PARTE-18A — Auditoria `src/copilot/agent/` — Situação Atual

> **Data**: 2026-06-28 | **Escopo**: `src/copilot/agent/` deep audit
> **Baseline**: commit `2982acda` (main)

---

## 1. Inventário e Estrutura

| Diretório    | Arquivos |    Linhas | Responsabilidade                                  |
| ------------ | -------: | --------: | ------------------------------------------------- |
| `root/`      |        6 |     1.264 | Facade (always-alive), contexto, config, tipos    |
| `dialog/`    |        9 |     1.892 | Dialog loop FSM, protocol, turn execution         |
| `infra/`     |        8 |     1.125 | Queue, webhook, handoff, tools bootstrap, SSRF    |
| `lifecycle/` |        6 |     1.086 | Start/stop/reconnect, state persistence, PM2      |
| `messaging/` |      2+1 |       323 | Send/steer/answer, send-pipeline (delegação)      |
| `session/`   |     15+2 |     1.474 | Inicialização, wiring, snapshot, keepalive, hooks |
| `state/`     |      2+1 |        80 | Status snapshot builder + diagnostics             |
| **TOTAL**    |   **54** | **7.764** |                                                   |

### Top-10 maiores arquivos

| Arquivo                        | Linhas | Observação                                                      |
| ------------------------------ | -----: | --------------------------------------------------------------- |
| `dialog/loop-manager.js`       |    600 | God module candidato (FSM + boot + turn + compaction + metrics) |
| `always-alive.js`              |    585 | Facade legítima — delegação pura                                |
| `dialog/turn-executor.js`      |    361 | Funções puras — bem estruturado                                 |
| `lifecycle/agent-lifecycle.js` |    326 | Start/stop/reconnect orchestration                              |
| `session/snapshot.js`          |    304 | Sync + async duplicados                                         |
| `lifecycle/state-io.js`        |    281 | Sync + async duplicados + mutex                                 |
| `session/boot-wiring.js`       |    258 | 11 etapas de wiring — coeso                                     |
| `agent-context.js`             |    241 | Shared mutable context                                          |
| `infra/webhook-manager.js`     |    233 | Completo e bem testado                                          |
| `session/hook-context.js`      |    216 | System prompt injection                                         |

---

## 2. Padrões Arquiteturais em Uso

### 2.1 Shared Mutable Context (`AgentContext`)
- Objeto flat passado por referência a todos os sub-módulos
- Substitui ~32 campos private que existiam antes das extrações F37-F60
- **Vantagem**: elimina need de acessar `this.#field` em módulos extraídos
- **Risco**: qualquer módulo pode mutar estado de outro; não há encapsulamento

### 2.2 Status FSM
```
stopped → starting → idle → processing → waiting_for_input
                             ↑                       ↓
                             └───────────────────────┘
(stopped reachable from any state)
```
- Transições validadas em `AgentContext.setStatus()` — warn, não bloqueia
- **Gap**: warn sem block pode mascarar bugs de sequenciamento em produção

### 2.3 Callback Injection (Host + Context)
- Módulos extraídos recebem `(ctx, host, ...)` em vez de referências ao `this`
- `host` é o EventEmitter (`AlwaysAliveAgent`), `ctx` é `AgentContext`
- Padrão consistente em 100% dos módulos pós-extração

### 2.4 Dialog Protocol (ask_user hijack)
- SDK `onUserInputRequest` → classificação READY/REPLY/STOPPED/QUESTION
- Boot prompt instrui o modelo a seguir o loop infinito
- PR-aware: tracking boots vs resumes (0-PR vs 1-PR)

### 2.5 Singleton com Accessor
- `alwaysAliveAgent` instanciado no topo de `always-alive.js`
- `getAgent()` exportado como accessor para consumers
- Consumidores mistos: ~60% usam `getAgent()`, ~40% importam singleton direto

---

## 3. Integração com SDK

### 3.1 Superfície Usada

| Categoria SDK         | Usado | Localização no Agent                           |
| --------------------- | :---: | ---------------------------------------------- |
| Client lifecycle      |   ✅   | `agent-lifecycle.js`, `reconnect-policy.js`    |
| Session create/resume |   ✅   | `initializer.js`                               |
| Session send          |   ✅   | `task-executor.js`, `steerMessage`             |
| Session events (16+)  |   ✅   | `event-handlers/*.js` (8 files)                |
| Tools registry        |   ✅   | `tools-bootstrap.js`                           |
| Permissions           |   ✅   | `permission-controller.js`, `session-setup.js` |
| Hooks factory         |   ✅   | `session-setup.js`                             |
| System message        |   ✅   | `hook-context.js` (via hooks)                  |
| MCP bridge            |   ✅   | `session-setup.js`, `boot-wiring.js`           |
| Quota monitor         |   ✅   | `boot-wiring.js` (F118)                        |

### 3.2 Superfície NÃO Usada / Sub-utilizada

| Capability SDK             | Status      | Impacto                                                       |
| -------------------------- | ----------- | ------------------------------------------------------------- |
| `setSessionModel()`        | ❌ Não usado | Model switch usa `ctx.model` local, sem notificar SDK         |
| `abortSession()`           | ⚠️ Parcial   | `agent.abort()` liga para session mas sem otel span           |
| `listAvailableModels()`    | ❌ Não usado | Model fallback usa config estático, sem discovery             |
| `rpc.*` (plan/shell/mode)  | ❌ Não usado | RPC via tools direto, não via agent layer                     |
| `feature-flags`            | ❌ Não usado | Experimental features ignoradas no agent                      |
| `provider.js` (BYOK)       | ❌ Não usado | Provider config não integrado no agent                        |
| `client-events.js`         | ⚠️ Parcial   | Lifecycle events usados em hooks mas não diretamente no agent |
| `events.js` typed filters  | ❌ Não usado | Event handlers fazem filtro manual                            |
| `telemetry.js` OTLP export | ❌ Não usado | Agent usa otel/startSpan mas não configura exporters          |

---

## 4. Integração com Observability

### 4.1 O que está instrumentado

| Tipo              | Cobertura | Detalhes                                                                          |
| ----------------- | :-------: | --------------------------------------------------------------------------------- |
| Logger (`log()`)  |    ✅✅     | Presente em 42/54 arquivos                                                        |
| OTEL Spans        |     ⚠️     | Apenas 5 locais: lifecycle, reconnect, turn-executor, loop-manager, task-executor |
| Metrics (record*) |     ⚠️     | 7/17 funções usadas diretamente no agent                                          |
| Tool stats        |     ✅     | `wrapWithStats()` em 100% das tools                                               |
| Event observer    |     ✅     | Via `boot-wiring.js` → event-collector                                            |

### 4.2 Métricas NÃO emitidas pelo Agent (emitidas via Observers)

| Métrica                 | Responsável atual                     |
| ----------------------- | ------------------------------------- |
| `recordSessionStart`    | `hooks/session-lifecycle.js`          |
| `recordSessionEnd`      | `hooks/session-lifecycle.js`          |
| `recordSessionError`    | `observers/session-agent-handlers.js` |
| `recordDialogStall`     | `observers/dialog-task-handlers.js`   |
| `recordDialogTimeout`   | `observers/dialog-task-handlers.js`   |
| `recordTaskCompletion`  | `observers/dialog-task-handlers.js`   |
| `recordStreamingChunk`  | `observers/dialog-task-handlers.js`   |
| `recordQuestionLatency` | `observers/session-agent-handlers.js` |
| `recordToolCall`        | `wrapWithStats()` (tool-stats.js)     |
| `recordUsage`           | `observers/` (billing event)          |

**Avaliação**: A arquitetura de observers está **correta** — o agent emite eventos e os observers capturam métricas. Não é responsabilidade do agent chamar `recordX()` para tudo. Os 7 record* diretos no agent são para operações internas (keepalive, cleanup, rotation, quota).

### 4.3 Gaps de OTEL

| Operação                  | Span? | Gap                             |
| ------------------------- | :---: | ------------------------------- |
| `agentStart()`            |   ✅   | `copilot.session.init`          |
| `agentStop()`             |   ❌   | Shutdown sem trace              |
| `reconnect`               |   ✅   | `copilot.reconnect`             |
| `executeTurn`             |   ✅   | `copilot.dialog.turn`           |
| `executeTask`             |   ✅   | `copilot.task` + `copilot.tool` |
| `dialogLoop.start()`      |   ✅   | `copilot.dialog.loop`           |
| `sendMessage()`           |   ❌   | Enqueue → execute sem span E2E  |
| `steerMessage()`          |   ❌   | Steering sem trace              |
| `answerPendingQuestion()` |   ❌   | Resposta sem trace              |
| `cleanupStaleSessions()`  |   ❌   | Cleanup sem trace               |
| `sessionRotation`         |   ❌   | Rotação sem trace               |
| `snapshot save/load`      |   ❌   | Snapshot ops sem trace          |

---

## 5. Separação de Responsabilidades

### 5.1 Responsabilidades Corretas ✅

- **Facade lean**: `always-alive.js` é 100% delegação — 0 lógica de negócio
- **Dialog loop isolado**: FSM, protocol, backpressure, watchdog em módulos separados
- **Wiring por evento**: 8 handler files especializados em `session/event-handlers/`
- **Infra hermética**: URL validation, webhook, permission controller bem isolados
- **Lifecycle claro**: start/stop/reconnect em módulos dedicados

### 5.2 Violações de Boundary ⚠️

| Violação                  | Arquivo                 | Natureza                                            |
| ------------------------- | ----------------------- | --------------------------------------------------- |
| Agent → ConversationStore | `history-sync.js:13`    | Import direto de `../../conversation-hub/store.js`  |
| Agent → TerminalState     | `history-sync.js:14`    | Import direto de `../../terminal/state.js`          |
| Agent → HookTools         | `agent-messaging.js:16` | Import direto de `../../tools/hook-tools.js`        |
| Agent → MCP bridge        | `boot-wiring.js:32`     | Import direto de `../../bridges/mcp-tool-bridge.js` |
| Agent → MCP config        | `session-setup.js:17`   | Import direto de `../../config/mcp-servers.js`      |

**Regra violada**: O módulo `agent/` deveria depender apenas de:
- `#copilot/core/*` (contratos)
- `#copilot/observability/*` (logging/metrics)
- `#copilot/sdk/*` (abstração do SDK)
- `#copilot/config/*` (configuração)
- Intra-agent (imports relativos internos)

### 5.3 Responsabilidades Questionáveis

| Funcionalidade                | Onde está             | Deveria estar em                             |
| ----------------------------- | --------------------- | -------------------------------------------- |
| TODO count para system prompt | `hook-context.js:169` | `tools/todo/` ou `hooks/`                    |
| ConversationStore sync        | `history-sync.js`     | `conversation-hub/` (ownership invertido)    |
| MCP auto-reconnect            | `boot-wiring.js:190`  | `bridges/mcp-tool-bridge.js` (self-managing) |
| Stale session cleanup         | `cleanup.js`          | OK (agent lifecycle concern)                 |
| `resolveUserInput` fallback   | `agent-messaging.js`  | `hooks/` ou `tools/hook-tools.js`            |

---

## 6. Bugs e Issues Identificados

### 6.1 Bugs Confirmados

| ID      | Severidade | Descrição                                                                                                            | Arquivo                           |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| BUG-A01 | 🔴 Alto     | `loadLatestSnapshot()` chama `listSnapshots()` que retorna `[]` (deprecated), tornando restore inoperante            | `snapshot.js:155-163`             |
| BUG-A02 | 🟡 Médio    | `persistState()` sync chamado 13× — race condition com `writeStateAsync()` (11×) quando ambos atuam no mesmo arquivo | `state-io.js` (múltiplos callers) |
| BUG-A03 | 🟡 Médio    | `steerMessage()` não suporta AbortSignal — steering irrecancellable                                                  | `agent-messaging.js:124`          |

### 6.2 Deprecated APIs Ainda em Uso

| API Deprecated          | Chamadas | Substituto Async        |
| ----------------------- | -------: | ----------------------- |
| `persistState()` sync   |       13 | `writeStateAsync()`     |
| `readState()` sync      |       12 | `readStateAsync()`      |
| `saveSnapshot()` sync   |        1 | `saveSnapshotAsync()`   |
| `listSnapshots()` sync  |        2 | `listSnapshotsAsync()`  |
| `loadSnapshot()` sync   |        1 | `loadSnapshotAsync()`   |
| `pruneSnapshots()` sync |        1 | `pruneSnapshotsAsync()` |
| `clearState()` sync     |        0 | `clearStateAsync()` ✅   |

**Total**: 30 chamadas a APIs deprecated sync vs 17 chamadas async. Ratio 64% sync.

### 6.3 Gaps de Funcionalidade

| ID      | Gap                                                 | Impacto                                                                 |
| ------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| GAP-A01 | Model switch não notifica SDK (`setSessionModel`)   | SDK pode ter modelo desatualizado no server-side                        |
| GAP-A02 | Sem discovery de modelos (`listAvailableModels`)    | Fallback hardcoded, sem adaptive selection                              |
| GAP-A03 | Feature flags SDK não integradas                    | Experimental features invisíveis ao agent                               |
| GAP-A04 | OTEL spans faltando em 7 operações (§4.3)           | Trace gaps em shutdown, messaging, cleanup                              |
| GAP-A05 | Dialog loop `stop()` não emite métrica de duration  | Sem visibilidade da duração total do dialog loop                        |
| GAP-A06 | `event-wirer.js` orquestra 8 files sem cleanup list | Memory leak potencial se unsubscribers não forem chamados coletivamente |
| GAP-A07 | Snapshot deprecated sync path ainda é default       | Sync I/O bloqueia event loop                                            |
| GAP-A08 | `tools_updated` event não tratado                   | Agent não sabe quando tools mudam mid-session                           |

### 6.4 Code Smells

| ID     | Smell                                                                                              | Arquivo(s)                                                       |
| ------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| SM-A01 | `loop-manager.js` (600L) mistura FSM + boot + turn + compaction + metrics                          | `dialog/loop-manager.js`                                         |
| SM-A02 | Status FSM warn-only (deveria throw em dev)                                                        | `agent-context.js:187`                                           |
| SM-A03 | ID generation com `Math.random()` em 4 locais                                                      | `task-executor`, `messaging`, `handoff-manager`, `message-queue` |
| SM-A04 | Singleton instanciado no module scope                                                              | `always-alive.js` último bloco                                   |
| SM-A05 | `hook-context.js` faz I/O de 4 fontes (briefing, session.json, skills, todos)                      | `hook-context.js`                                                |
| SM-A06 | Duplicate metrics recording: `recordSessionRotation()` chamado em `rotation.js` E `initializer.js` | Contagem duplicada                                               |

---

## 7. Cobertura de Testes

- **60+ arquivos de teste** cobrem o módulo agent
- **Pontos fortes**: lifecycle, dialog-loop, messaging, reconnect, shutdown, delegation, context, event-wiring
- **Gap de testes**: `history-sync.js`, `hook-context.js` (I/O complexo), `cleanup.js` (integration with listSessions)

---

## 8. Sumário Executivo

### Pontos Fortes
1. **Facade disciplinada**: `always-alive.js` é 100% delegação pós-F37-F60
2. **Event-driven**: 16+ eventos SDK tratados em handlers especializados
3. **Observability distributed**: Métricas via observers (não acopladas ao agent)
4. **Security**: SSRF protection, URL validation, permission controller
5. **Testing**: 60+ test files com cobertura ampla
6. **Protocol**: Dialog loop protocol bem definido e isolado

### Pontos Fracos
1. **30 chamadas deprecated sync I/O** bloqueando event loop
2. **5 violações de boundary** (imports diretos para conversation-hub, terminal, tools, bridges, config)
3. **BUG-A01**: Snapshot restore quebrado (listSnapshots deprecated retorna [])
4. **7 operações sem OTEL spans** (gaps de tracing)
5. **loop-manager.js god module** (600L, 5+ responsabilidades)
6. **AgentContext é shared mutable state** sem encapsulamento
