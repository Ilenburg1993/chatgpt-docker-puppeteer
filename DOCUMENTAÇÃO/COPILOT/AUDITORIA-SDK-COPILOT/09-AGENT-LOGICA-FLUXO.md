# 09 — Agent Module: Lógica, Fluxo e Arquitetura Detalhada

**Data**: 2026-03-21
**Escopo**: `src/copilot/agent/` — 50+ arquivos, ~8620 linhas
**Referência**: Análise de código-fonte vivo (commit `4234854f`)

---

## 1. Visão Geral do Módulo

O módulo `agent/` implementa o **AlwaysAliveAgent** — um agente singleton persistente que gerencia
o ciclo de vida completo de uma sessão Copilot SDK neste processo Node.js. É a camada L5 da
arquitetura de camadas do sistema.

### Responsabilidades centrais

1. **Lifecycle management**: start/stop do agente com retry, reconexão e shutdown gracioso
2. **Session management**: criar/resumir sessões SDK com persistência em disco
3. **Dialog loop**: modo de diálogo contínuo com o LLM (boot, turnos, pause/resume, watchdog)
4. **Message queue**: enfileiramento e processamento sequencial de tasks
5. **Event wiring**: bridge de ~80 eventos SDK → EventBus centralizado
6. **Permission control**: modos approve_all/audit_only/selective
7. **Observabilidade**: métricas, spans OTEL, event-collector, agent-event-observer
8. **Infraestrutura**: webhooks, handoff, keepalive, snapshots, MCP auto-reconnect

### Números-chave

| Métrica | Valor |
|---------|-------|
| Total de arquivos | ~55 |
| Total de linhas | ~8620 |
| Subdiretórios | 8 (`dialog/`, `facades/`, `infra/`, `lifecycle/`, `messaging/`, `session/`, `session/event-handlers/`, `state/`) |
| Eventos bridgeados | ~80 agent → EventBus |
| Event handlers SDK | 12 módulos especializados |
| Host interfaces (JSDoc) | 5 (`LifecycleHost`, `DialogHost`, `MessagingHost`, `StateHost`, `IAlwaysAliveAgent`) |

---

## 2. Mapa de Arquivos por Subsistema

### 2.1 Root (`agent/`)

| Arquivo | Linhas | Função |
|---------|--------|--------|
| `always-alive.js` | 759 | Classe singleton `AlwaysAliveAgent` — fachada pública, bridge de eventos |
| `agent-context.js` | 254 | `AgentContext` — estado compartilhado entre todos os módulos internos |
| `config.js` | 205 | Configuração centralizada (re-exporta de `#copilot/config` com nomes semânticos) |
| `types.js` | 176 | Typedefs centralizados (AgentStatus, PendingQuestion, AgentTask, etc.) |
| `queue-processor.js` | 67 | Processa próxima task da fila quando idle |
| `di-tokens.js` | ~20 | Tokens DI para o agente |
| `index.js` | ~100 | Barrel exports |

### 2.2 Dialog (`agent/dialog/`)

| Arquivo | Linhas | Função |
|---------|--------|--------|
| `loop-manager.js` | 597 | `DialogLoopManager` — mutex, watchdog, backpressure, pause/resume, boot |
| `turn-executor.js` | 391 | Execução de turno individual com spans OTEL e protocol parsing |
| `agent-dialog-controller.js` | ~100 | Funções extraídas: `dialogStart`, `dialogStop`, `dialogResume`, `ensureDialogLoopAttached` |
| `protocol.js` | ~120 | `DialogProtocol` — classificação READY/REPLY/STOPPED/QUESTION |
| `watchdog.js` | ~120 | `DialogWatchdog` — detecção de inatividade com thresholds adaptativos |
| `backpressure.js` | ~100 | `TurnQueue` — mutex promise-chain + limite de profundidade |
| `model-fallback.js` | ~80 | `ModelFallbackState` — fallback de modelo entre restarts |
| `user-input-handler.js` | ~80 | Handler de ask_user do SDK com integração dialog loop |
| `event-wiring.js` | ~60 | `wireDialogLoopEvents` — wiring de eventos do DLM no host |

### 2.3 Lifecycle (`agent/lifecycle/`)

| Arquivo | Linhas | Função |
|---------|--------|--------|
| `agent-lifecycle.js` | 359 | `agentStart`, `agentStop`, `agentTryReconnect`, `initSession` |
| `entry.js` | 251 | `startAgentLoop` — bootstrap PM2, retry, shutdown handlers, IPC |
| `state-io.js` | 288 | Leitura/escrita de estado persistido em JSON (sync + async) |
| `reconnect-policy.js` | ~150 | `tryReconnect` — backoff exponencial + jitter |
| `session-setup.js` | ~120 | `buildSessionTools`, `buildSessionHooks`, `buildSessionOptions`, `finalizeSessionInit` |

### 2.4 Session (`agent/session/`)

| Arquivo | Linhas | Função |
|---------|--------|--------|
| `boot-wiring.js` | 331 | `performBootWiring` — 12 etapas de wiring pós-init |
| `snapshot.js` | 262 | `createSnapshot`, `saveSnapshotAsync` — snapshots de estado |
| `hook-context.js` | 219 | `buildHookSystemContext` — injeção de session-briefing no system message |
| `initializer.js` | 196 | `initOrResumeSession` — criação/retomada persistente de sessão |
| `keepalive.js` | 157 | `SessionKeepalive` — pings periódicos para manter sessão viva |
| `rotation.js` | ~100 | `shouldRotateSession` — decisão de rotação por idade/tokens/compactions |
| `cleanup.js` | 126 | `cleanupStaleSessions` — limpeza assíncrona de sessões órfãs |
| `history-sync.js` | 119 | `syncSdkHistory`, `SessionMessagesCache` — sync de histórico |
| `event-wirer.js` | ~90 | `wireSessionEvents` — orquestrador dos 12 event handlers |

### 2.5 Event Handlers (`agent/session/event-handlers/`)

| Arquivo | Linhas | Função |
|---------|--------|--------|
| `catch-all.js` | 101 | `wireCatchAll` — log de eventos SDK não tratados |
| `sdk-responses.js` | 133 | `wireSdkResponseEvents` — intent, reasoning, turns, subagents |
| `interaction-events.js` | 115 | `wireInteractionEvents` — skill, command, permission, subagent |
| `session-lifecycle.js` | 68 | `wireSessionLifecycleEvents` — idle, error, warning, model_change |
| `system-notifications.js` | 69 | `wireSystemNotificationEvents` — system.notification |
| `token-budget.js` | 56 | `wireTokenBudgetEvents` — usage_info + warning heuristics |
| `mcp-events.js` | 55 | `wireMcpEvents` — MCP server status, OAuth |
| `compaction.js` | 50 | `wireCompactionEvents` — compaction start/complete |
| `tool-lifecycle.js` | 39 | `wireToolLifecycleEvents` — tool execution progress |
| `streaming.js` | 38 | `wireStreamingEvents` — reasoning delta, message delta |
| `mode-and-tools.js` | 23 | `wireModeAndToolEvents` — session mode changed |
| `usage.js` | ~30 | `wireUsageEvent` — session.usage |

### 2.6 Infra (`agent/infra/`)

| Arquivo | Linhas | Função |
|---------|--------|--------|
| `webhook-manager.js` | 233 | `WebhookManager` — registro/dispatch de webhooks com retry |
| `message-queue.js` | 213 | `MessageQueue` — fila FIFO com abort via AbortSignal |
| `task-executor.js` | 179 | `executeTask` — send/await com streaming, spans OTEL, reconexão |
| `handoff-manager.js` | 159 | `HandoffManager` — handoff entre agentes (experimental fleet) |
| `permission-controller.js` | 156 | `PermissionController` — runtime mode switching |
| `tools-bootstrap.js` | 137 | `setSessionRpc`, `setExperimentalSession` — bootstrap de tools |
| `status-snapshot.js` | ~100 | `buildStatusSnapshot` — montagem do snapshot de status |

### 2.7 Facades (`agent/facades/`)

| Arquivo | Linhas | Função |
|---------|--------|--------|
| `agent-model-config.js` | ~80 | `getModel`, `setModel`, `listAvailableModels`, `getReasoningEffort`, `setReasoningEffort` |
| `agent-session-ops.js` | ~80 | `abortCurrentMessage`, `pingDialogWatchdog`, `sessionLog`, `getSessionMessages` |
| `agent-webhook-ops.js` | ~50 | `registerWebhook`, `unregisterWebhook`, `listWebhooks` |

### 2.8 Messaging e State

| Arquivo | Linhas | Função |
|---------|--------|--------|
| `messaging/agent-messaging.js` | ~180 | `enqueueTask`, `sendMessage`, `sendMessageDialogBoot`, `steerMessage`, `answerPendingQuestion` |
| `state/agent-state.js` | ~80 | `getStatusSnapshot`, `listenerDiagnostics` |

---

## 3. Fluxo Principal: Boot do Agente

```
entry.js::startAgentLoop()
  │
  ├── Plugin discovery (assíncrono, não-blocking)
  ├── Bridge HookBus → EventBus
  ├── CLI ping + auth check
  ├── Model validation
  │
  └── startWithRetry() [até 5 tentativas]
        │
        └── alwaysAliveAgent.start()
              │
              ├── ctx.setStatus('starting')
              ├── writeState({ gracefulShutdown: false })
              ├── initEventCollector()
              ├── new CopilotClient([telemetry])
              │
              ├── initSession(ctx, client, host)
              │     ├── buildSessionTools(ctx) → tools[]
              │     ├── buildSessionHooks(ctx, host) → busHooks
              │     ├── buildSessionOptions(ctx, host, {tools, busHooks})
              │     └── initOrResumeSession(client, options)
              │           ├── readState() → sessionId
              │           ├── _validateSessionForResume(sessionId, lastActivity)
              │           ├── shouldRotateSession()
              │           └── resumeOrCreate(client, sessionId, opts)
              │
              ├── performBootWiring(client, session, isResumed, host, ctx)
              │     ├── 1. wireSessionEvents() → 12 handlers
              │     ├── 2. eventCollector.attach()
              │     ├── 3. onLifecycleEvents(client)
              │     ├── 4. createAgentEventObserver()
              │     ├── 5. cleanupStaleSessions()
              │     ├── 6. Dialog loop resume (se retomada)
              │     ├── 7. Metrics timer
              │     ├── 8. MCP auto-reconnect
              │     ├── 9. SessionKeepalive.start()
              │     ├── 10. QuotaMonitor.start()
              │     ├── 11. Handoff wiring (se fleet habilitado)
              │     └── 12. question.answered → hook-tools relay
              │
              ├── ctx.setStatus('idle')
              ├── syncSdkHistory() (se retomada)
              └── emit('ready', { sessionId, isResumed })
```

---

## 4. Fluxo Principal: Envio de Mensagem

```
agent.sendMessage(message, opts)
  │
  └── msgSend(ctx, host, message, opts)
        │
        └── new Promise((resolve, reject) => {
              enqueueTask(ctx, host, message, { resolve, reject, ... })
                │
                └── ctx.messageQueue.enqueue(task)
                      │
                      └── emit('__processQueue')
            })

agent.__processQueue
  │
  └── processQueue(ctx, host, callbacks)
        │
        ├── Guard: isReconnecting || status !== 'idle' || queue empty || no session → return
        ├── ctx.messageQueue.shift() → task
        ├── ctx.setStatus('processing')
        ├── ctx.sendCount++
        └── executeTask(session, task, callbacks)
              │
              ├── session.on('assistant.message_delta') → onDelta
              ├── session.on('tool.execution_start') → emit + OTEL span
              ├── session.on('tool.execution_complete') → emit + close span
              ├── session.on('session.idle') → capture idleTime
              │
              ├── session.sendAndWait({ prompt: task.message }, timeoutMs)
              │     │
              │     ├── [SUCCESS] → setStatus('idle'), emit('task.completed'), task.resolve(text)
              │     └── [ERROR]
              │           ├── AbortError → setStatus('idle'), task.reject
              │           └── tryReconnect(error)
              │                 ├── [recovered] → requeueTask(task) ou reject se max retries
              │                 └── [failed] → setStatus('idle'), task.reject
              │
              └── finally: unsubAll, close spans, scheduleNext()
```

---

## 5. Fluxo Principal: Dialog Loop

```
agent.startDialogLoop(bootPrompt?)
  │
  └── dialogStart(ctx, host, bootPrompt)
        │
        ├── Guard: status !== 'idle' → throw INVALID_STATE
        ├── Context health check (block ≥95%, warn ≥80%)
        ├── ensureDialogLoopAttached(ctx, host)
        │     └── ctx.dialogLoop.attach(host) + wireDialogLoopEvents()
        ├── keepalive.stop()
        └── ctx.dialogLoop.start(bootPrompt)
              │
              ├── Activate + emit('changed', { active: true })
              ├── Apply model fallback if pending
              ├── Create DialogWatchdog + start()
              ├── Build boot prompt via DialogProtocol.buildBootPrompt()
              ├── sendMessageDialogBoot(metaPrompt, { timeoutMs: 24h })
              ├── waitForEvent('ready', { timeoutMs: bootTimeout })
              ├── prMetrics.boots++
              └── Log "Dialog loop iniciado"

[Turno de diálogo]
agent.sendDialogTurn(message, opts)
  │
  └── ctx.dialogLoop.sendTurn(message, opts)
        │
        ├── Guard: !active → reject DIALOG_NOT_ACTIVE
        ├── Guard: signal.aborted → reject AbortError
        ├── watchdog.ping()
        └── turnQueue.enqueue(() => executeTurnImpl(...))
              │
              ├── emitTurnStart + increment sendCount
              ├── waitForReply (race: host event 'ready' | 'reply' vs timeout)
              ├── Answer pending question with message
              ├── Await reply event
              ├── emitTurnEnd
              └── return reply text

[Protocolo]
SDK emite ask_user → handleProtocolInput({ question })
  │
  ├── DialogProtocol.classify(question)
  │     ├── "READY:" → emit('ready')
  │     ├── "REPLY:" → emit('reply', { reply: extractReply(question) })
  │     ├── "DONE:"  → emit('reply', { reply: extractReply(question) })
  │     ├── "STOPPED" → emit('stopped', { reason: 'model_stopped' })
  │     └── default → classified as question (routed to user)
```

---

## 6. Fluxo: Reconexão

```
executeTask → error (não AbortError)
  │
  └── tryReconnect(error)
        │
        └── reconnect-policy.js::tryReconnect(error, client, status, callbacks, opts)
              │
              ├── maxAttempts (default: 3), exponential backoff + jitter
              ├── clearSessionEventUnsubs()
              ├── Attempt: initSession(client) ou createClient() + initSession()
              ├── dialogLoop.notifyReconnect()
              └── Return true (recovered) | false (failed)
```

---

## 7. Fluxo: Shutdown Gracioso

```
agent.stop({ shutdownTimeoutMs })
  │
  └── agentStop(ctx, host, opts)
        │
        ├── emit('before-stop')
        ├── Se status === 'starting' → await race(ready|error, 15s)
        ├── Se status === 'processing'|'waiting_for_input' → await race(idle, timeout)
        ├── DialogLoop: removeAllListeners, forceDeactivate
        ├── Save snapshot + writeState
        ├── clearInterval(metricsTimer)
        ├── mcpReconnectCancel()
        ├── quotaMonitor.stop()
        ├── keepalive.stop()
        ├── setStatus('stopped')
        ├── messageQueue.drain() → reject remaining tasks
        ├── agentObserver.detach()
        ├── sessionEventUnsubscribers.forEach(unsub)
        ├── session.disconnect()
        └── client.stop()
```

---

## 8. Máquina de Estados

O `AgentContext` implementa um FSM com transições validadas:

```
  ┌─────────┐    start()    ┌──────────┐    initSession OK    ┌──────┐
  │ stopped │ ──────────── ▶│ starting │ ──────────────────── ▶│ idle │
  └─────────┘               └──────────┘                       └──────┘
       ▲                         │                                │ ▲
       │                    error│                    processQueue │ │task done
       │                         ▼                                ▼ │
       │                   ┌─────────┐                      ┌────────────┐
       │                   │ stopped │◀──── stop() ─────────│ processing │
       │                   └─────────┘                      └────────────┘
       │                                                         │
       │                                                 ask_user│
       │                                                         ▼
       │                                              ┌──────────────────┐
       └───────────── stop() ─────────────────────────│waiting_for_input │
                                                      └──────────────────┘
```

Transições válidas:
- `stopped` → `starting`
- `starting` → `idle` | `stopped`
- `idle` → `processing` | `stopped`
- `processing` → `idle` | `waiting_for_input` | `stopped`
- `waiting_for_input` → `processing` | `stopped`

Nota: qualquer estado → `stopped` é sempre permitido (shutdown).

---

## 9. Sistema de Eventos

### 9.1 Agente → EventBus (Bridge)

O `always-alive.js` faz bridge de ~80 eventos do agente (e subsistemas) para o EventBus
centralizado via `bridgeEmitter()`. Os eventos são divididos em categorias:

- **Agent lifecycle**: ready, before-stop, stopped, error, status
- **Dialog loop**: changed, ready, turn_start, turn_end, stalled, paused, resumed, stopped, reply
- **Session**: keepalive, fatal, compaction, usage, token_budget, mode_changed, etc.
- **Task**: queued, started, completed, delta, error, reasoning
- **Tool**: execution_start, execution_complete, execution_progress
- **SDK**: lifecycle, mcp.reconnected, quota.warning, steering.sent
- **Subagent**: started, completed, failed

### 9.2 Session SDK → Agente (wireSessionEvents)

12 módulos especializados registram listeners na sessão SDK e re-emitem como eventos do agente:

1. `compaction` — session.compaction_start, session.compaction_complete
2. `streaming` — assistant.reasoning_delta, assistant.message_delta
3. `token-budget` — session.usage_info (com heurísticas de warning)
4. `mode-and-tools` — session.mode_changed, session.tools_updated
5. `system-notifications` — system.notification (PR consumed, model routing, etc.)
6. `sdk-responses` — assistant.intent, reasoning_complete, turn_start/end, etc.
7. `session-lifecycle` — session.idle, error, warning, model_change, snapshot_rewind
8. `mcp-events` — session.mcp_server_status_changed, session.oauth_events
9. `tool-lifecycle` — tool.execution_progress, tool.user_requested
10. `interaction-events` — skill.invoked, command.invoked, permission events, subagent events
11. `usage` — session.usage
12. `catch-all` — eventos não cobertos (log only)

### 9.3 DialogLoopManager → EventBus (Bridge)

Eventos próprios: changed, stalled, paused, resumed, stopped, reply, compaction.requested,
turn_timeout.

### 9.4 HandoffManager → EventBus (Bridge)

Eventos: handoff.received, handoff.accepted, handoff.rejected.

---

## 10. Padrão Arquitetural: AgentContext

O `AgentContext` é o **objeto central de estado compartilhado** entre todos os módulos do agente.
Substituiu 32+ campos `#private` que existiam em `always-alive.js`.

**Conteúdo**:
- Referências SDK: `client`, `session`, `sessionEventUnsubscribers`
- Estado: `status` (FSM), `isResumed`, `sendCount`, `pendingQuestion`, cache de snapshot
- Config: `model`, `reasoningEffort`
- Contadores: `lastPrInfo`, `contextState`, `lastCheckpointPath`
- Timers: `metricsTimer`, `mcpReconnectCancel`, `quotaMonitor`
- Managers: `dialogLoop`, `messageQueue`, `webhooks`, `permissions`, `toolsRegistry`,
  `keepalive`, `handoff`, `messagesCache`

**Prós**: reduz acoplamento vs campos privados; permite que módulos extraídos acessem estado sem
callbacks pesados.

**Contras**: é um "god object" que concentra todo o estado — qualquer módulo pode mutar qualquer
campo.

---

## 11. Padrão de Extração: Host Interfaces

Módulos extraídos (lifecycle, dialog, messaging, state) recebem callbacks via "host interfaces"
tipadas em `types.js`:

- `LifecycleHost` — emit, on, off, sessionId, getStatusSnapshot, resumeDialogLoop, etc.
- `DialogHost` — emit, on, sessionId, sendMessage, sendMessageDialogBoot, answerPendingQuestion
- `MessagingHost` — emit
- `StateHost` — sessionId, listenerCount

Esse padrão permite que os módulos operem sem referência direta ao `AlwaysAliveAgent`, facilitando
testes unitários com mocks.

---

## 12. Boot Wiring: 12 Etapas

O `performBootWiring()` é chamado após `initSession()` e configura toda a infraestrutura
operacional:

1. **wireSessionEvents** — 12 handlers de eventos SDK
2. **eventCollector.attach** — observabilidade de eventos
3. **onLifecycleEvents(client)** — session.created/deleted/updated
4. **createAgentEventObserver** — métricas de alto nível
5. **cleanupStaleSessions** — limpeza assíncrona
6. **Dialog loop resume** — boot recovery se sessão retomada
7. **Metrics timer** — emissão periódica de agent.metrics
8. **MCP auto-reconnect** — reconexão periódica de servidores MCP
9. **SessionKeepalive.start** — pings periódicos
10. **QuotaMonitor.start** — monitoramento de quota
11. **Handoff wiring** — (experimental, feature flag 'fleet')
12. **question.answered relay** — hook-tools boundary decoupling

---

## 13. Persistência de Estado

### 13.1 state-io.js

Estado persistido em JSON (leitura sync com cache + escrita async debounced):

- `sessionId`, `startedAt`, `resumedAt`, `resumeCount`
- `sendCount`, `model`, `dialogLoopActive`, `dialogPaused`
- `pendingQuestion`, `gracefulShutdown`, `prMetrics`
- `pausedAt`, `lastCheckpointPath`

### 13.2 Snapshots

Snapshots de estado salvos em disco para diagnóstico (diretório configurável):
- Criados no shutdown, em erros fatais, ou periodicamente
- Rotação automática por max snapshots
- Incluem: sessionId, model, status, sendCount, dialogLoop state, prMetrics

---

## 14. Concorrência e Serialização

### 14.1 MessageQueue

Fila FIFO com suporte a abort via AbortSignal. Tasks são processadas sequencialmente — apenas uma
por vez. Quando idle, `processQueue` dequeue a próxima.

### 14.2 TurnQueue (Dialog)

Mutex promise-chain que serializa turnos do dialog loop. Máximo configurável de profundidade
(default: 10). Reset atômico em forceDeactivate para evitar turns fantasma.

### 14.3 Guards de Concorrência

- `ctx.isReconnecting` — bloqueia processamento durante reconexão
- `#stopping` — idempotência do stop
- `#resuming` — previne interleaving entre resume/start concorrentes
- `statusSnapshotCache` com dirty flag + TTL — evita recalcular snapshot
