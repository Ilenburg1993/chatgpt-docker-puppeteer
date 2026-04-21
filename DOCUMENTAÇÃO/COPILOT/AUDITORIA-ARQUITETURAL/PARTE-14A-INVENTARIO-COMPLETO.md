# PARTE 14A — Inventário Completo de `src/copilot/agent/`

**Data**: 2026-03-15 **Baseline**: commit `54c135c4` (pós-F44) **Total de arquivos**: 37 (36 `.js` +
1 `messaging/`) **Total de linhas**: ~7.200L

---

## 1. Visão Geral da Árvore

```
src/copilot/agent/
├── always-alive.js          621L   Facade/Orquestrador — singleton AlwaysAliveAgent
├── agent-context.js         210L   Objeto de contexto compartilhado entre módulos
├── config.js                177L   Re-exportações centralizadas de env vars
├── types.js                 170L   Typedefs centralizados (JSDoc)
├── index.js                  20L   Barrel principal
│
├── dialog/                        ── Subsistema de Dialog Loop ──
│   ├── loop-manager.js      661L   DialogLoopManager — mutex, turns, watchdog
│   ├── turn-executor.js     361L   Funções puras de execução de turno
│   ├── agent-dialog-controller.js 148L   Start/stop/resume/ensure do dialog
│   ├── watchdog.js          189L   Monitor de inatividade com thresholds dinâmicos
│   ├── protocol.js          115L   Classificação de mensagens READY/REPLY/DONE/STOPPED
│   ├── user-input-handler.js 106L  Handlers para onUserInputRequest SDK
│   └── index.js              18L   Sub-barrel
│
├── lifecycle/                     ── Subsistema de Ciclo de Vida ──
│   ├── agent-lifecycle.js   362L   start/stop/initSession/tryReconnect
│   ├── entry.js             162L   Entry point PM2 com retry e signal handling
│   ├── reconnect-policy.js  133L   Exponential backoff + jitter
│   ├── state-io.js          251L   Persistência sdk-always-alive.json
│   └── index.js               9L   Sub-barrel
│
├── session/                       ── Subsistema de Sessão ──
│   ├── initializer.js       376L   initOrResumeSession + hook system context injection
│   ├── event-wirer.js       591L   wireSessionEvents — 80+ event handlers, 8 sub-funções
│   ├── boot-wiring.js       225L   performBootWiring — 10 etapas de wiring pós-init
│   ├── snapshot.js          213L   Criação/salvamento/listing/pruning de snapshots
│   ├── keepalive.js         155L   SessionKeepalive — heartbeat anti-idle
│   ├── history-sync.js      108L   Sincronização SDK → ConversationStore
│   ├── cleanup.js            97L   Limpeza de sessões expiradas
│   ├── rotation.js           82L   Política de rotação (idade, utilização, compactions)
│   └── index.js              20L   Sub-barrel
│
├── infra/                         ── Subsistema de Infraestrutura ──
│   ├── webhook-manager.js   300L   Webhooks com SSRF prevention + DNS rebinding mitigation
│   ├── message-queue.js     212L   Fila FIFO com AbortSignal, capacidade, drain
│   ├── task-executor.js     177L   Execução de tarefa com streaming/OTEL/retry
│   ├── permission-controller.js 155L   Modos approve_all/audit_only/selective
│   ├── handoff-manager.js   157L   Transferência de sessão entre agentes
│   ├── tools-bootstrap.js   133L   Bootstrap de 15+ categorias de tools
│   ├── status-snapshot.js   102L   Função pura de construção de snapshot
│   └── index.js              15L   Sub-barrel
│
├── messaging/                     ── Subsistema de Mensageria ──
│   └── agent-messaging.js   250L   sendMessage/steer/answer + enqueue
│
└── state/                         ── Subsistema de Estado ──
    └── agent-state.js         73L   getStatusSnapshot + listenerDiagnostics
```

---

## 2. Inventário Detalhado por Arquivo

### 2.1 Raiz

| Arquivo            | Linhas | Responsabilidade                                                                                                                                           | Classes/Exports                                                                                                                                        |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `always-alive.js`  | 621    | Facade orquestradora singleton. Estende EventEmitter. ~20 getters/setters/delegações + 3 métodos privados (`#setStatus`, `#processQueue`, `#tryReconnect`) | `AlwaysAliveAgent`, `alwaysAliveAgent`, `getAgent()`                                                                                                   |
| `agent-context.js` | 210    | Substitui 32+ campos `#private` do antigo always-alive. Instancia todos os managers                                                                        | `createAgentContext()`, typedef `AgentContext`                                                                                                         |
| `config.js`        | 177    | Renomeia env vars para nomes semânticos no domínio agent/                                                                                                  | ~40 constantes exportadas                                                                                                                              |
| `types.js`         | 170    | Typedefs JSDoc centralizados                                                                                                                               | `AgentStatus`, `PendingQuestion`, `AgentTask`, `AgentStatusSnapshot`, `LifecycleHost`, `DialogHost`, `MessagingHost`, `StateHost`, `IAlwaysAliveAgent` |
| `index.js`         | 20     | Barrel: re-exporta tudo via sub-barrels                                                                                                                    | —                                                                                                                                                      |

### 2.2 dialog/

| Arquivo                      | Linhas | Responsabilidade                                                            | Classes/Exports                                                                                                              |
| ---------------------------- | ------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `loop-manager.js`            | 661    | Turn mutex, backpressure, watchdog, pause/resume, model fallback            | `DialogLoopManager`, `wireDialogLoopEvents()`                                                                                |
| `turn-executor.js`           | 361    | Funções puras para send turn, buildResolutionListeners, restart-and-retry   | `emitTurnStart()`, `buildTurnResolutionListeners()`, `dispatchTurnToHost()`, `waitForRestartAndReply()`, `executeTurnImpl()` |
| `agent-dialog-controller.js` | 148    | Coordenação start/stop/resume/ensure com context health check               | `dialogStart()`, `dialogStop()`, `dialogResume()`, `ensureDialogLoopAttached()`                                              |
| `watchdog.js`                | 189    | Timer de inatividade com pre-stall warning (80%) e thresholds per-task-type | `DialogWatchdog`                                                                                                             |
| `protocol.js`                | 115    | Parse de marcadores READY/REPLY/DONE/STOPPED em mensagens SDK               | `DialogProtocol` (static)                                                                                                    |
| `user-input-handler.js`      | 106    | Callbacks para SDK onUserInputRequest; routing dialog vs interactive        | `handleDialogLoopInput()`, `handleInteractiveQuestion()`                                                                     |

### 2.3 lifecycle/

| Arquivo               | Linhas | Responsabilidade                                                              | Classes/Exports                                                                                            |
| --------------------- | ------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `agent-lifecycle.js`  | 362    | Boot sequence, shutdown graceful, initSession, tryReconnect wrapper           | `agentStart()`, `agentStop()`, `initSession()`, `agentTryReconnect()`                                      |
| `entry.js`            | 162    | PM2 entry point; 5 retries, SIGTERM/SIGINT, IPC commands                      | `main()` (implicit)                                                                                        |
| `reconnect-policy.js` | 133    | Backoff: delay = base × 2^(attempt-1) + jitter, cap 30s                       | `tryReconnect()`                                                                                           |
| `state-io.js`         | 251    | Read/write/clear `sdk-always-alive.json`; in-memory cache + async write mutex | `readState()`, `writeState()`, `writeStateAsync()`, `clearState()`, `persistState()`, `drainStateWrites()` |

### 2.4 session/

| Arquivo           | Linhas | Responsabilidade                                                                                                                   | Classes/Exports                                                                                                           |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `initializer.js`  | 376    | `initOrResumeSession()`: Zod validation, hook context injection, rotation check, resume-or-create SDK call                         | `initOrResumeSession()`, `buildHookSystemContext()`, `buildHookSystemContextSafe()`, `setBackgroundCompactionThreshold()` |
| `event-wirer.js`  | 591    | 80+ event types em 8 sub-funções: compaction, streaming, token budget, mode, system notifications, SDK responses, usage, catch-all | `wireSessionEvents()`                                                                                                     |
| `boot-wiring.js`  | 225    | 10 etapas de wiring pós-init: events, collector, client, observer, cleanup, dialog resume, metrics, MCP, keepalive, handoff        | `performBootWiring()`                                                                                                     |
| `snapshot.js`     | 213    | CRUD de snapshots com pruning por MAX_SNAPSHOTS                                                                                    | `createSnapshot()`, `saveSnapshot()`, `listSnapshots()`, `loadSnapshot()`, `loadLatestSnapshot()`, `pruneSnapshots()`     |
| `keepalive.js`    | 155    | Heartbeat anti-idle: client.ping() (0 PR) com fallback session.send (1 PR)                                                         | `SessionKeepalive`                                                                                                        |
| `history-sync.js` | 108    | Sync SDK messages → ConversationStore (SQLite) + SessionMessagesCache com TTL                                                      | `syncSdkHistory()`, `SessionMessagesCache`                                                                                |
| `cleanup.js`      | 97     | Lista e deleta sessões SDK expiradas (> 24h)                                                                                       | `cleanupStaleSessions()`                                                                                                  |
| `rotation.js`     | 82     | Política stateless: maxUtil, maxAge, maxCompactions, maxTurns                                                                      | `shouldRotateSession()`                                                                                                   |

### 2.5 infra/

| Arquivo                    | Linhas | Responsabilidade                                                                             | Classes/Exports                            |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `webhook-manager.js`       | 300    | Webhooks com SSRF prevention, DNS rebinding, retry exponential backoff, payload sanitization | `WebhookManager`                           |
| `message-queue.js`         | 212    | FIFO queue com MAX_QUEUE_SIZE, AbortSignal, drain(err) no shutdown                           | `MessageQueue`                             |
| `task-executor.js`         | 177    | `executeTask()`: streaming, OTEL spans, retry com reconnect, AbortError guard                | `executeTask()`                            |
| `permission-controller.js` | 155    | Runtime permission mode switching sem restart                                                | `PermissionController`                     |
| `handoff-manager.js`       | 157    | Session handoff receive/accept/reject com histórico                                          | `HandoffManager`                           |
| `tools-bootstrap.js`       | 133    | Bootstrap 15 categorias de tools + MCP + custom + instrumentação wrapWithStats               | `bootstrapTools()`, re-exports tool config |
| `status-snapshot.js`       | 102    | Função pura: params → AgentStatusSnapshot                                                    | `buildStatusSnapshot()`                    |

### 2.6 messaging/

| Arquivo              | Linhas | Responsabilidade                                                                                    | Classes/Exports                                                                                          |
| -------------------- | ------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `agent-messaging.js` | 250    | sendMessage (com dialog guard), sendMessageDialogBoot (bypass), steerMessage, answerPendingQuestion | `sendMessage()`, `sendMessageDialogBoot()`, `steerMessage()`, `answerPendingQuestion()`, `enqueueTask()` |

### 2.7 state/

| Arquivo          | Linhas | Responsabilidade                                     | Classes/Exports                                |
| ---------------- | ------ | ---------------------------------------------------- | ---------------------------------------------- |
| `agent-state.js` | 73     | Snapshot cacheado com TTL + diagnóstico de listeners | `getStatusSnapshot()`, `listenerDiagnostics()` |

---

## 3. Distribuição de Código por Subsistema

| Subsistema | Arquivos | Linhas     | % do Total |
| ---------- | -------- | ---------- | ---------- |
| dialog/    | 7        | 1.598      | 22,2%      |
| session/   | 8        | 1.867      | 25,9%      |
| lifecycle/ | 5        | 917        | 12,7%      |
| infra/     | 8        | 1.251      | 17,4%      |
| messaging/ | 1        | 250        | 3,5%       |
| state/     | 1        | 73         | 1,0%       |
| raiz       | 5        | 1.198      | 16,6%      |
| **TOTAL**  | **37**   | **~7.200** | **100%**   |

---

## 4. Dependências Internas (Grafo Simplificado)

```
always-alive.js ────────────────────────────────────────────────┐
  ├── agent-context.js ←── (quase todos os módulos)             │
  ├── dialog/agent-dialog-controller.js (delegação)             │
  ├── messaging/agent-messaging.js (delegação)                  │
  ├── state/agent-state.js (delegação)                          │
  └── lifecycle/agent-lifecycle.js (delegação)                  │
                                                                │
agent-context.js ───────────────────────────────────────────────┤
  ├── dialog/loop-manager.js (instancia)                        │
  ├── infra/message-queue.js (instancia)                        │
  ├── infra/webhook-manager.js (instancia)                      │
  ├── infra/permission-controller.js (instancia)                │
  ├── infra/handoff-manager.js (instancia)                      │
  ├── session/keepalive.js (instancia)                          │
  └── session/history-sync.js (instancia SessionMessagesCache)  │
                                                                │
lifecycle/agent-lifecycle.js ───────────────────────────────────┤
  ├── infra/tools-bootstrap.js (bootstrapTools)                 │
  ├── session/initializer.js (initOrResumeSession)              │
  ├── session/boot-wiring.js (performBootWiring)                │
  ├── lifecycle/reconnect-policy.js (tryReconnect)              │
  └── lifecycle/state-io.js (readState/writeState)              │
                                                                │
session/boot-wiring.js ─────────────────────────────────────────┤
  ├── session/event-wirer.js (wireSessionEvents)                │
  ├── session/cleanup.js (cleanupStaleSessions)                 │
  ├── session/keepalive.js (start)                              │
  └── infra/handoff-manager.js (wiring)                         │
                                                                │
dialog/loop-manager.js ─────────────────────────────────────────┤
  ├── dialog/turn-executor.js (executeTurnImpl)                 │
  ├── dialog/watchdog.js (DialogWatchdog)                       │
  ├── dialog/protocol.js (DialogProtocol)                       │
  └── messaging/agent-messaging.js (sendMessageDialogBoot)      │
                                                                │
session/initializer.js ─────────────────────────────────────────┤
  ├── session/rotation.js (shouldRotateSession)                 │
  ├── lifecycle/state-io.js (readState/writeStateAsync)         │
  └── [deps externas: audit/pipeline, config/, sdk/session]     │
```

---

## 5. Dependências Externas ao Módulo agent/

| Dependência                             | Módulos que Importam                                  | Tipo                |
| --------------------------------------- | ----------------------------------------------------- | ------------------- |
| `#copilot/core/events`                  | index.js, state/agent-state.js                        | Constantes          |
| `#copilot/core/errors`                  | messaging, message-queue                              | Classes de erro     |
| `#copilot/observability/logger`         | 25+ arquivos                                          | Logging             |
| `#copilot/observability/metrics`        | initializer.js, rotation.js                           | Métricas            |
| `#copilot/observability/otel`           | task-executor.js                                      | Tracing             |
| `#copilot/sdk/session`                  | initializer.js, cleanup.js                            | SDK wrappers        |
| `#copilot/sdk/tools-state`              | initializer.js                                        | Config de tools     |
| `#copilot/sdk/tools-registry`           | tools-bootstrap.js                                    | Registry            |
| `#copilot/sdk/utils`                    | initializer.js                                        | pickDefined         |
| `#copilot/config/env`                   | config.js, message-queue.js, permission-controller.js | Env vars            |
| `#copilot/config/session-config`        | initializer.js                                        | Defaults            |
| `#copilot/config/system-prompt`         | initializer.js                                        | System message      |
| `#copilot/config/custom-agents`         | initializer.js                                        | Sub-agents          |
| `#copilot/config/custom-tools-registry` | tools-bootstrap.js                                    | Custom tools        |
| `#copilot/audit/pipeline`               | infra/index.js, initializer.js                        | Audit logging       |
| `#copilot/hooks/permission`             | permission-controller.js                              | Permission handlers |
| `#copilot/tools/*`                      | tools-bootstrap.js, user-input-handler.js             | Tool definitions    |
| `#copilot/tools/hook-tools`             | agent-messaging.js                                    | resolveUserInput    |
| `#copilot/tools/todo/store`             | initializer.js                                        | TODO store          |
| `@github/copilot-sdk`                   | lifecycle, session, dialog                            | SDK principal       |
| `zod`                                   | initializer.js                                        | Schema validation   |
| `node:*`                                | múltiplos                                             | Node.js builtins    |

---

## 6. Cobertura de Testes Atual

| Suite                                  | Testes | Arquivos Cobertos                 |
| -------------------------------------- | ------ | --------------------------------- |
| `test_agent_context.spec.js`           | 7      | agent-context.js                  |
| `test_agent_state.spec.js`             | 6      | state/agent-state.js              |
| `test_agent_messaging.spec.js`         | 7      | messaging/agent-messaging.js      |
| `test_agent_dialog_controller.spec.js` | 5      | dialog/agent-dialog-controller.js |
| `test_agent_lifecycle.spec.js`         | 9      | lifecycle/agent-lifecycle.js      |
| `test_always_alive_delegation.spec.js` | 12     | always-alive.js (delegação)       |
| **TOTAL**                              | **46** | **6 de 37 arquivos**              |

**Cobertura**: 16,2% dos arquivos têm testes unitários. Nenhuma cobertura para:

- dialog/loop-manager.js (661L — o mais complexo)
- dialog/turn-executor.js (361L — race conditions)
- session/event-wirer.js (591L — maior arquivo)
- session/initializer.js (376L — lógica crítica)
- infra/message-queue.js (212L)
- infra/task-executor.js (177L)
- E 25 outros arquivos
