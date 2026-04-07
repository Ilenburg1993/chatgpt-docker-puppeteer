# PARTE 14C — Mapa de Fluxos de `src/copilot/agent/`

**Data**: 2026-03-15  
**Baseline**: commit `54c135c4` (pós-F44)  
**Referência**: PARTE-14A (Inventário), PARTE-14B (Análise Arquitetural)

---

## 1. Fluxo de Boot (Agent Start)

```
entry.js::main()
  │
  ├── [1] Pré-checks: CLI ping, model validation
  ├── [2] Cria singleton: alwaysAliveAgent (already-alive.js)
  │        └── createAgentContext() (agent-context.js)
  │             ├── instancia DialogLoopManager
  │             ├── instancia MessageQueue
  │             ├── instancia WebhookManager
  │             ├── instancia PermissionController
  │             ├── instancia ToolRegistry [SDK]
  │             ├── instancia SessionKeepalive
  │             ├── instancia HandoffManager
  │             └── instancia SessionMessagesCache
  │
  ├── [3] startWithRetry(agent, 5 attempts)
  │        └── agent.start()
  │             └── agentStart(ctx, host)           ── lifecycle/agent-lifecycle.js
  │                  │
  │                  ├── [3.1] ctx.status = 'starting'
  │                  ├── [3.2] new CopilotClient(token)
  │                  ├── [3.3] initSession(ctx, host)
  │                  │         ├── buildMCPTools()
  │                  │         ├── ToolRegistry.create()
  │                  │         ├── bootstrapTools(registry, mcpTools)    ── infra/tools-bootstrap.js
  │                  │         │    └── registra 15 categorias + MCP + custom
  │                  │         ├── createLifecycleHooks()
  │                  │         ├── createSessionHooks(bus)
  │                  │         ├── initOrResumeSession(client, opts)     ── session/initializer.js
  │                  │         │    ├── readState() — lê sessionId persistido
  │                  │         │    ├── _validateSessionForResume()
  │                  │         │    ├── shouldRotateSession()            ── session/rotation.js
  │                  │         │    ├── buildHookSystemContextSafe()
  │                  │         │    │    └── buildHookSystemContext()
  │                  │         │    │         ├── lê session-briefing.md (≤16KB)
  │                  │         │    │         ├── valida session.json (Zod)
  │                  │         │    │         ├── sanitiza close_key
  │                  │         │    │         ├── lê skills/ dir
  │                  │         │    │         └── lê runtime state + TODOs
  │                  │         │    └── resumeOrCreate(client, sessionId, opts)  ── SDK
  │                  │         └── setup onUserInputRequest handler
  │                  │
  │                  ├── [3.4] performBootWiring(ctx, host)               ── session/boot-wiring.js
  │                  │         ├── ① wireSessionEvents(session, ctx, host)  ── session/event-wirer.js
  │                  │         │    ├── _wireCompactionEvents
  │                  │         │    ├── _wireStreamingEvents
  │                  │         │    ├── _wireTokenBudgetEvents
  │                  │         │    ├── _wireModeAndToolEvents
  │                  │         │    ├── _wireSystemNotificationEvents
  │                  │         │    ├── _wireSdkResponseEvents
  │                  │         │    ├── _wireUsageEvent
  │                  │         │    └── _wireCatchAll
  │                  │         ├── ② event-collector.attach()
  │                  │         ├── ③ client lifecycle handlers (error, disconnect)
  │                  │         ├── ④ agent-event-observer
  │                  │         ├── ⑤ cleanupStaleSessions()                ── session/cleanup.js
  │                  │         ├── ⑥ dialog loop resume (if boot recovery)
  │                  │         ├── ⑦ metrics timer (interval)
  │                  │         ├── ⑧ MCP auto-reconnect
  │                  │         ├── ⑨ keepalive.start()                     ── session/keepalive.js
  │                  │         └── ⑩ handoff wiring
  │                  │
  │                  ├── [3.5] ctx.status = 'idle'
  │                  └── [3.6] emit('ready')
  │
  ├── [4] Signal handlers: SIGTERM → agent.stop(), SIGINT → agent.stop()
  ├── [5] IPC handlers: ping, status (→ getStatus()), stop
  └── [6] session.on('fatal') → process.exit(1)
```

---

## 2. Fluxo de sendMessage (Task Queue Processing)

```
API HTTP (server/)
  │
  └── agent.sendMessage(text, opts)
       └── sendMessage(ctx, host, text, opts)      ── messaging/agent-messaging.js
            │
            ├── [Guard] Dialog loop ativo? → reject DIALOG_ACTIVE
            ├── [Guard] AbortSignal já disparado? → reject AbortError
            │
            └── enqueueTask(ctx, host, text, opts)
                 │
                 └── ctx.messageQueue.enqueue(task, {signal})   ── infra/message-queue.js
                      │
                      ├── [Guard] Fila cheia? → throw QUEUE_FULL
                      ├── Registra abort listener (se signal)
                      ├── Push task na fila
                      └── onEnqueue() callback
                           │
                           └── agent.#processQueue()            ── always-alive.js
                                │
                                ├── [Guard] Já processando? → skip (single consumer)
                                ├── [Guard] status !== 'idle'? → skip
                                │
                                ├── task = ctx.messageQueue.shift()
                                ├── ctx.status = 'processing'
                                ├── ctx.sendCount++
                                ├── persistState({sendCount})
                                │
                                └── executeTask(session, task, callbacks)  ── infra/task-executor.js
                                     │
                                     ├── Subscribe: session.on('assistant.message_delta')
                                     ├── Subscribe: session.on('tool.execution_start')
                                     ├── Subscribe: session.on('tool.execution_complete')
                                     ├── Subscribe: session.on('session.idle')
                                     ├── Start OTEL span 'copilot.task'
                                     │
                                     ├── session.sendAndWait(prompt, timeout)  ── SDK
                                     │    │
                                     │    ├── [Success] → resolve(text), emit('task.completed')
                                     │    │
                                     │    └── [Error]
                                     │         ├── AbortError → reject (sem reconexão)
                                     │         └── Network/Session error
                                     │              ├── tryReconnect()
                                     │              │    └── reconnect-policy.js (exp. backoff)
                                     │              ├── [Recovered + attempts < MAX]
                                     │              │    → requeueTask(task) [retry]
                                     │              ├── [Recovered + attempts ≥ MAX]
                                     │              │    → reject (max retries)
                                     │              └── [Not recovered] → reject(error)
                                     │
                                     └── Finally:
                                          ├── Unsubscribe all listeners
                                          ├── Close OTEL spans
                                          └── scheduleNext() → #processQueue() [recursive]
```

---

## 3. Fluxo de Dialog Loop

```
dialogStart(ctx, host)                 ── dialog/agent-dialog-controller.js
  │
  ├── [Guard] Context utilization ≥ 95% → block
  ├── [Guard] Context utilization ≥ 80% → warn
  ├── keepalive.stop()
  │
  └── ctx.dialogLoop.start(agentHost)  ── dialog/loop-manager.js
       │
       ├── status → 'dialog_active'
       ├── Boot: sendMessageDialogBoot(bootPrompt)  ── messaging/agent-messaging.js
       │    └── (bypassa guard de dialog ativo)
       │
       └── Loop contínuo (enquanto active):
            │
            ├── [Mutex entry] await #turnMutex
            │    └── Serialização: apenas 1 turno por vez
            │
            ├── executeTurnImpl(turnEmitter, agentHost, turnNo, opts)  ── dialog/turn-executor.js
            │    │
            │    ├── emitTurnStart()
            │    ├── dispatchTurnToHost(agentHost, prompt)
            │    │    └── agentHost.sendMessage(prompt, {timeout})
            │    │
            │    ├── buildTurnResolutionListeners()
            │    │    └── Race: reply vs stopped vs timeout
            │    │         ├── SDK ask_user → DialogProtocol.classify()
            │    │         │    ├── 'ready'  → READY: marcador (loop continua)
            │    │         │    ├── 'reply'  → REPLY:<dados> (extrai e resolve)
            │    │         │    ├── 'stopped' → dialog parado
            │    │         │    └── 'question' → suspend (aguarda input)
            │    │         │
            │    │         ├── Timeout → stall warning
            │    │         └── session.idle → turno completo
            │    │
            │    └── waitForRestartAndReply() [se stopped unauthorized]
            │         └── Aguarda restart signal + novo reply
            │
            ├── [Watchdog] ping() a cada turno
            │    ├── Pre-stall warning (80% threshold)
            │    └── Stall detected → forceDeactivate()
            │
            ├── [Backpressure] #turnQueueDepth monitoring
            │    └── Se depth > limit → pause loop
            │
            ├── [Compaction] handleCompaction()
            │    └── Pausa temporária durante compaction SDK
            │
            └── [Model fallback] scheduleModelFallback()
                 └── Switch model após N falhas consecutivas

dialogStop(ctx, host)
  ├── ctx.dialogLoop.stop()
  └── keepalive.start()

dialogResume(ctx, host)
  └── ctx.dialogLoop.resume()
       └── Envia 0 ou 1 PR (strategy A vs B)
```

---

## 4. Fluxo de Reconexão

```
Qualquer erro de rede/sessão no sendAndWait ou dialog turn
  │
  └── tryReconnect(error, ctx, host)        ── lifecycle/agent-lifecycle.js
       │
       └── tryReconnect(opts)                ── lifecycle/reconnect-policy.js
            │
            ├── Loop: attempt 1..maxAttempts
            │    │
            │    ├── delay = base * 2^(attempt-1) + jitter, cap 30s
            │    ├── await sleep(delay)
            │    │
            │    ├── client.stop()  [para client antigo]
            │    ├── new CopilotClient(token)  [novo client]
            │    │
            │    ├── initSession(newClient)
            │    │    └── initOrResumeSession() → tenta resume da sessão
            │    │
            │    ├── Health check: client.ping()
            │    │    ├── [Success] → return true
            │    │    │    └── Notifica dialog loop se ativo
            │    │    └── [Fail] → next attempt
            │    │
            │    └── [Max attempts] → return false
            │
            └── Sync SDK history se reconectou:
                 └── syncSdkHistory()          ── session/history-sync.js
```

---

## 5. Fluxo de Shutdown Graceful

```
SIGTERM / SIGINT / agent.stop()
  │
  └── agentStop(ctx, host)                   ── lifecycle/agent-lifecycle.js
       │
       ├── [1] ctx.status = 'stopped'
       │
       ├── [2] Aguarda task atual (se processing)
       │        └── Timeout: SHUTDOWN_TIMEOUT_MS (10s)
       │
       ├── [3] forceDeactivate dialog loop
       │        └── dialogLoop.forceDeactivate()
       │
       ├── [4] Salva snapshot
       │        ├── createSnapshot(opts)      ── session/snapshot.js
       │        └── saveSnapshot(snap)
       │
       ├── [5] Persiste estado final
       │        ├── persistState({gracefulShutdown: true})
       │        └── drainStateWrites()        ── lifecycle/state-io.js
       │
       ├── [6] Keepalive.stop()
       │
       ├── [7] Disconnect session
       │        └── session.disconnect()
       │
       ├── [8] Stop client
       │        └── client.stop()
       │
       ├── [9] Drain message queue
       │        └── ctx.messageQueue.drain(shutdownError)
       │
       └── [10] Emit 'stopped'
```

---

## 6. Fluxo de User Input (Interactive vs Dialog)

```
SDK onUserInputRequest callback
  │
  └── [Routing]                             ── dialog/user-input-handler.js
       │
       ├── Dialog loop ativo?
       │    │
       │    └── YES → handleDialogLoopInput()
       │              │
       │              ├── DialogProtocol.classify(message)
       │              │    ├── 'ready' / 'reply' → resolve (skipPersist=true)
       │              │    ├── 'stopped' → resolve
       │              │    └── 'question' → suspend (emit 'session.user_input_request')
       │              │
       │              └── Resolve com resposta ao SDK
       │
       └── NO → handleInteractiveQuestion()
                │
                ├── Salva em ctx.pendingQuestion = { question, resolve, choices, askedAt }
                ├── persistState({pendingQuestion})
                ├── emit('session.user_input_request')
                │
                └── Aguarda resposta via HTTP API:
                     └── agent.answerPendingQuestion(answer)
                          └── answerPendingQuestion(ctx, host, answer)  ── messaging/agent-messaging.js
                               ├── ctx.pendingQuestion.resolve(answer)
                               ├── ctx.pendingQuestion = null
                               ├── persistState({pendingQuestion: null})
                               └── hookToolsResolveUserInput(answer)
```

---

## 7. Fluxo de Session Events (80+ tipos)

```
SDK emite evento na sessão
  │
  └── wireSessionEvents(session, ctx, host)    ── session/event-wirer.js
       │
       ├── Compaction Events:
       │    ├── session.compaction_start → emit, record metric
       │    ├── session.compaction_complete → emit, update contextState
       │    └── session.compaction_error → emit, log
       │
       ├── Streaming Events:
       │    ├── assistant.message_delta
       │    │    ├── Dialog loop ativo → forward to dialogLoop
       │    │    └── Task mode → emit('task.delta')
       │    └── assistant.reasoning_delta → emit('task.reasoning')
       │
       ├── Token Budget Events:
       │    ├── context_window.tokens_used → update contextState
       │    ├── token_budget.warning → emit, log
       │    └── token_budget.exceeded → emit, handleTokenBudget()
       │
       ├── Mode & Tool Events:
       │    ├── mode.changed → emit
       │    ├── tool.approved / tool.denied → emit
       │    └── tool.error → emit
       │
       ├── System Notification Events:
       │    ├── agent_completed → emit
       │    ├── shell_completed → emit
       │    ├── subagent.* → emit
       │    ├── elicitation.* → emit
       │    └── handoff.* → handoffManager.receive()
       │
       ├── SDK Response Events:
       │    ├── intent → emit
       │    ├── reasoning → emit
       │    ├── turn.start / turn.end → emit
       │    ├── error → emit, log
       │    ├── shutdown → agentStop
       │    ├── truncation → emit
       │    └── snapshot_rewind → emit
       │
       ├── Usage/Billing Events:
       │    └── usage → emit, record metrics
       │
       └── Catch-All:
            └── * (desconhecidos) → filter por KNOWN_SDK_EVENTS → log DEBUG
```

---

## 8. Fluxo de Keepalive

```
SessionKeepalive.start(callbacks)            ── session/keepalive.js
  │
  └── setInterval(tick, 10min)
       │
       └── #tick()
            │
            ├── [Guard] Dialog loop ativo → skip (dialog mantém sessão viva)
            ├── [Guard] Não está idle → skip (atividade recente)
            ├── [Guard] Idle < threshold (20min) → skip
            │
            ├── [1] Tenta client.ping() (0 PR)
            │    ├── [Success] → done
            │    └── [Fail] → fallback
            │
            └── [2] Fallback: session.send('[keepalive]') (1 PR)
                 └── [Success/Fail] → log
```

---

## 9. Fluxo de Webhooks

```
Qualquer evento no agent EventEmitter
  │
  └── ctx.webhooks.emit(event, payload)        ── infra/webhook-manager.js
       │
       ├── [Guard] Nenhum webhook registrado → return
       │
       ├── Sanitiza payload (#sanitizePayload)
       │    ├── task.delta / task.reasoning → { redacted: true }
       │    └── Outros → remove tokens/secrets/passwords/content
       │
       └── Promise.allSettled( urls.map(deliver) )
            │
            └── #deliverWithRetry(id, url, body, maxRetries=3)
                 │
                 ├── [Pre-check] DNS rebinding: resolve hostname → check IP
                 │    └── IP privado → block
                 │
                 └── Loop: 0..maxRetries
                      ├── fetch(url, { method: POST, body, timeout: 5s })
                      ├── [2xx] → success
                      ├── [4xx] → permanent error (no retry)
                      ├── [5xx] → retry with backoff (500ms → 1s → 2s)
                      └── [Network/Timeout] → retry with backoff
```

---

## 10. Mapa de Dependências Circular Check

**Resultado: Nenhuma dependência circular detectada.**

A hierarquia de dependências é estritamente top-down:

```
always-alive.js (facade)
  └── módulos funcionais (dialog, lifecycle, session, messaging, state)
       └── infra/ (utilities)
            └── config.js, types.js (configuração)
                 └── #copilot/* (dependências externas ao agent/)
```

Exceção controlada: `messaging/agent-messaging.js` importa `#copilot/tools/hook-tools.js` (cross-cutting), e `session/history-sync.js` importa `../../conversation-hub/store.js` (cross-domain).
