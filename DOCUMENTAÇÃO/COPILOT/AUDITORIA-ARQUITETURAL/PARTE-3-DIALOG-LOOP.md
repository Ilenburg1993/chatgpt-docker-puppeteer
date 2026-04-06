# Auditoria Arquitetural — src/copilot · Parte 3: Dialog Loop & Sistema de Eventos

**Data**: 2026-04-04 **Referência**: [PARTE-2-INTEGRACOES.md](PARTE-2-INTEGRACOES.md)

---

## 1. Mecanismo Dialog Loop Zero-PR

O Dialog Loop é o mecanismo central que permite comunicação contínua com o modelo consumindo **zero
Premium Requests** após o boot inicial. Isso é possível graças ao uso da tool `ask_user` do SDK como
protocolo de turnos.

### 1.1 Protocolo de Mensagens

O `DialogProtocol` (dialog-protocol.js) define 4 tipos de mensagem:

| Tipo      | Prefixo      | Significado                      | PR Cost |
| --------- | ------------ | -------------------------------- | ------- |
| `READY`   | `READY:`     | Modelo pronto para próximo turno | 0       |
| `REPLY`   | `REPLY: ...` | Modelo respondendo ao usuário    | 0       |
| `DONE`    | `DONE:`      | Modelo sinalizando fim de tarefa | 0       |
| `STOPPED` | `STOPPED:`   | Modelo parando por erro/limite   | 0       |

```javascript
// dialog-protocol.js
static classify(text) {
    if (text.startsWith('READY:'))   return { type: 'READY' };
    if (text.startsWith('REPLY:'))   return { type: 'REPLY', content: text.slice(7) };
    if (text.startsWith('DONE:'))    return { type: 'DONE' };
    if (text.startsWith('STOPPED:')) return { type: 'STOPPED', reason: text.slice(9) };
    return { type: 'UNKNOWN', raw: text };
}
```

### 1.2 Ciclo de Vida

```
┌─ BOOT (1 PR) ─────────────────────────────────────────────────┐
│                                                                │
│  agent.sendMessageDialogBoot(systemPrompt, bootMessage)        │
│     → session.sendAndWait(bootMessage, { tools })              │
│     → Modelo processa → chama ask_user("READY:")               │
│     → DLM recebe READY → estado = 'active'                    │
│     → Emite 'dialog.loop.started'                              │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌─ TURN CYCLE (0 PR cada) ──────────────────────────────────────┐
│                                                                │
│  1. Terminal envia mensagem                                    │
│     → dialog.js sendTurn(text)                                 │
│     → llmBridgeClient.dialogTurn(text, callbacks)              │
│     → agent.answerPendingQuestion(text)                        │
│                                                                │
│  2. Modelo processa (pode usar tools, subagents, etc.)         │
│     → Streaming: onDelta(), onReasoning() callbacks            │
│     → Tool calls: tool.execution_start/complete events         │
│                                                                │
│  3. Modelo responde                                            │
│     → Chama ask_user("REPLY: <resposta>")                      │
│     → DLM classifica → tipo REPLY → emite 'reply'             │
│     → dialog.js exibe resposta no terminal                     │
│                                                                │
│  4. Modelo sinaliza prontidão                                  │
│     → Chama ask_user("READY:")                                 │
│     → DLM classifica → tipo READY → ciclo volta ao step 1     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌─ PAUSE/RESUME ────────────────────────────────────────────────┐
│                                                                │
│  Pause:                                                        │
│    → DLM.pause() → dialogPaused = true                         │
│    → Emite 'dialog.loop.paused'                                │
│    → ask_user pendente fica em espera                          │
│                                                                │
│  Resume Strategy A (0 PR):                                     │
│    → Se ask_user ainda está pendente (não expirou)             │
│    → answerPendingQuestion("resuming") → modelo volta          │
│                                                                │
│  Resume Strategy B (1 PR):                                     │
│    → Se ask_user expirou ou sessão foi reiniciada              │
│    → Novo boot completo → 1 PR consumido                       │
│    → Re-entrar no ciclo de turnos                              │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 1.3 Componentes do DLM

O `DialogLoopManager` (485 linhas) implementa:

| Componente       | Detalhe                                                    |
| ---------------- | ---------------------------------------------------------- |
| **Mutex**        | Serializa turnos — máximo 1 turno ativo por vez            |
| **Backpressure** | Fila máxima `MAX_QUEUE_SIZE=10`, rejeita turnos excedentes |
| **Watchdog**     | Timer 5min, detecta stall (>15min sem atividade)           |
| **Boot timeout** | 30s para o primeiro READY: após boot                       |
| **Fallback**     | Se modelo falha, tenta modelo alternativo (configurável)   |
| **Estado**       | `idle` → `booting` → `active` → `paused` → `stopped`       |

### 1.4 Eventos do DLM

O `dialog-loop-wirer.js` (55 linhas) propaga 11 eventos do DLM para o `agent.emit()`:

| Evento DLM      | → Evento Agent         | Consumidores                |
| --------------- | ---------------------- | --------------------------- |
| `started`       | `dialog.loop.started`  | NERV bridge, observer, REPL |
| `stopped`       | `dialog.loop.stopped`  | NERV bridge, observer       |
| `paused`        | `dialog.loop.paused`   | NERV bridge                 |
| `resumed`       | `dialog.loop.resumed`  | NERV bridge                 |
| `turn.start`    | `dialog.turn.start`    | Observer → MetricsStore     |
| `turn.complete` | `dialog.turn.complete` | Observer, NERV, terminal    |
| `turn.error`    | `dialog.turn.error`    | Observer → ErrorTracker     |
| `reply`         | `dialog.reply`         | Terminal display, SSE       |
| `ready`         | `dialog.ready`         | Terminal status             |
| `stall`         | `dialog.stall`         | NERV bridge, error alerting |
| `watchdog`      | `dialog.watchdog`      | NERV bridge, auto-recovery  |

---

## 2. Mapeamento Completo de Eventos

### 2.1 Eventos do SDK (session-event-wirer.js)

Os ~80 eventos do SDK são agrupados em 8 categorias de wiring:

| Função                          | Eventos                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| `_wireCompactionEvents`         | compaction.start, compaction.complete                       |
| `_wireStreamingEvents`          | response.delta, response.reasoning, response.done           |
| `_wireTokenBudgetEvents`        | token.budget.warning (85%), token.budget.exceeded (95%)     |
| `_wireModeAndToolEvents`        | tool.execution_start, tool.execution_complete, mode.changed |
| `_wireSystemNotificationEvents` | system.notification, system.maintenance                     |
| `_wireSdkResponseEvents`        | response.complete, response.cancelled, response.failed      |
| `_wireUsageEvent`               | usage (tokens, PR count, model, billing)                    |
| `_wireCatchAll`                 | \* (catch-all para eventos desconhecidos)                   |

### 2.2 Eventos do Agent (EventEmitter)

O `AlwaysAliveAgent` emite os seguintes eventos (agregando SDK + DLM + internos):

**Categoria Dialog:**

- `dialog.loop.started` / `stopped` / `paused` / `resumed`
- `dialog.turn.start` / `complete` / `error`
- `dialog.reply` / `dialog.ready` / `dialog.stall` / `dialog.watchdog`

**Categoria Tool:**

- `tool.execution_start` / `tool.execution_complete`
- `tool.permission.requested` / `tool.permission.granted` / `tool.permission.denied`

**Categoria Session:**

- `session.started` / `session.ended` / `session.error`
- `session.compaction_start` / `session.compaction_complete`
- `session.reconnecting` / `session.reconnected`
- `session.fatal`

**Categoria Task:**

- `task.started` / `task.completed` / `task.failed`

**Categoria Streaming:**

- `response.delta` / `response.reasoning`
- `response.complete` / `response.cancelled`

**Categoria System:**

- `assistant.intent`
- `subagent.started` / `subagent.completed` / `subagent.failed`
- `usage` (token/PR accounting)
- `question.pending` / `question.answered`
- `metrics` (periodic summary)

### 2.3 Eventos NERV (nerv-bridge.js EVENT_MAP)

49 mapeamentos agent → NERV actionCode. Exemplos:

```
dialog.turn.start    → copilot:dialog:turn:start
dialog.turn.complete → copilot:dialog:turn:complete
tool.execution_start → copilot:tool:execution:start
session.started      → copilot:session:started
task.completed       → copilot:task:completed
```

---

## 3. Fluxo de Eventos por Cenário

### 3.1 Cenário: Turno normal no terminal

```
User types → REPL
    ↓
① agent.emit('dialog.turn.start', { turnId, message })
    ├─→ agent-event-observer: _turnStarts.set(turnId), OTEL span
    ├─→ nerv-bridge: copilot:dialog:turn:start
    └─→ terminal: noop (não exibe nada)

② SDK processa, usa tools:
    agent.emit('tool.execution_start', { tool, args })
    ├─→ repl.js: display "⚙️ tool(args...)"
    ├─→ observer: _toolStarts.set(toolId), OTEL span
    ├─→ nerv-bridge: copilot:tool:execution:start
    └─→ SSE: broadcastSse('tool.start', data)

    agent.emit('tool.execution_complete', { tool, result, duration })
    ├─→ repl.js: display "✅ tool → result (500ms)"
    ├─→ observer: MetricsStore.recordToolCall(), OTEL span end
    ├─→ nerv-bridge: copilot:tool:execution:complete
    └─→ SSE: broadcastSse('tool.complete', data)

③ Streaming response:
    onDelta(chunk): display 🧠 + SSE 'delta'
    onReasoning(chunk): display 💭 (se showThinking=true)

④ agent.emit('dialog.turn.complete', { turnId, response, usage })
    ├─→ observer: MetricsStore.recordDialogTurn(), OTEL span end
    ├─→ nerv-bridge: copilot:dialog:turn:complete
    ├─→ terminal: usage summary display
    └─→ SSE: broadcastSse('turn.complete', summary)

⑤ conversationHub.store.writeTurn() → SQLite persist
```

### 3.2 Cenário: Task (não-dialog) via sendMessage

```
task.enqueue → agent.#processQueue()
    ↓
task-executor.js executeTask()
    ↓
agent.emit('task.started', { taskId })
    ↓
session.sendAndWait(message, { tools })
    ↓
    [PROBLEMA: agent-event-observer NÃO ESTÁ ATTACHED se dialog loop
     nunca foi iniciado. Veja GAP-01 na Parte 4.]
    ↓
agent.emit('task.completed', { taskId, result })
```

### 3.3 Cenário: Rate limit / quota exceeded

```
SDK emits 'error' com type=rate_limit
    ↓
event-collector: persiste erro, ErrorTracker.track()
    ↓
session-event-wirer → agent.emit('session.error', { type: 'rate_limit' })
    ↓
hooks/session-lifecycle.js onErrorOccurred:
    → Detecta rate_limit → agenda fallback model
    ↓
reconnect-policy.js:
    → Backoff exponencial: 2s → 4s → 8s → 16s → 30s max
    → Tenta com modelo alternativo se configurado
```

---

## 4. Proteções de Estabilidade

| Proteção              | Onde                 | Detalhe                                   |
| --------------------- | -------------------- | ----------------------------------------- |
| Mutex de turnos       | DLM + dialog.js      | Máximo 1 turno ativo                      |
| Backpressure          | DLM (MAX_QUEUE=10)   | Rejeita turnos excedentes                 |
| Watchdog              | DLM (5min interval)  | Detecta stall > 15min                     |
| Boot timeout          | DLM                  | 30s para primeiro READY                   |
| Context window check  | dialog.js            | Warn 85%, block 95%                       |
| Tool TTL cleanup      | event-collector      | \_pending Map: 5min TTL                   |
| Turn TTL cleanup      | event-collector      | \_turnStart Map: 10min TTL                |
| SSE truncation        | dialog.js            | MAX_SSE_CONTENT_CHARS                     |
| Events.jsonl rotation | event-collector      | 5MB max → rotate                          |
| Metrics ring buffer   | metrics.js           | 500 samples max por histograma            |
| Error dedup           | error-tracker.js     | Mesmo erro não rastreado duas vezes       |
| Reconnect backoff     | reconnect-policy.js  | Exponencial com jitter                    |
| Dialog coalescing     | dialog.js            | Evita boots simultâneos via flag          |
| Safe event handlers   | agent-event-observer | \_safe() wraps every handler in try/catch |

---

_Continua em [PARTE-4-GAPS-BUGS.md](PARTE-4-GAPS-BUGS.md)_
