# Auditoria Arquitetural — src/copilot · Parte 2: Análise de Integração

**Data**: 2026-04-04 **Referência**: [PARTE-1-ARQUITETURA.md](PARTE-1-ARQUITETURA.md)

---

## 1. Padrão de Subscrição Dual (Evento SDK → Sistema)

O SDK do Copilot emite eventos na sessão (`session.on('event')`). Duas camadas **independentes**
subscrevem a esses eventos, cada uma com papel distinto:

```
SDK Session
    │
    ├── [A] event-collector.js ──── attach(session) ─────── OBSERVABILIDADE
    │       → Persiste events.jsonl (70+ tipos)
    │       → Alimenta MetricsStore (usage, tools, turns)
    │       → Alimenta ErrorTracker (erros)
    │       → Dispara HookBus (auditoria de hooks)
    │       → Rastreia quota (warn < 10%)
    │       → Histograma inter-token latency
    │
    └── [B] session-event-wirer.js  wireSessionEvents() ─── PROPAGAÇÃO
            → Emite no AlwaysAliveAgent (EventEmitter)
            → 80+ eventos SDK mapeados 1:1 para agent events
            → Filtra task.delta durante dialog loop
            → _wireUsageEvent: rastreia PR billing
```

### 1.1 Por que duplicação?

A separação é **intencional e desejável**:

- **[A]** é focado em **persistência e métricas** — opera de forma "write-only", nunca influencia
  comportamento.
- **[B]** é focado em **propagação para consumidores** (terminal, NERV bridge, SSE, dialog) — opera
  como middleware de eventos.

**Risco identificado:** ambos rastreiam tokens/usage de formas ligeiramente diferentes, podendo
gerar divergência nos dados reportados. (Ver Parte 4 — Gaps).

### 1.2 Fluxo de Subscrição na Inicialização

```
AlwaysAliveAgent.start()
│
├─① initEventCollector({ metrics, errorTracker })
│    → defaultEventCollector.init()
│    → errorTracker.registerGlobalHandlers()
│    → metrics.startPeriodicSnapshot()
│
├─② CopilotClient() → #initSession()
│    → buildMcpTools() + bootstrapTools()
│    → createSessionHooks() + attachBus()
│    → initOrResumeSession(client, config)
│
├─③ wireSessionEvents(session, agent)       [B]
│    → 80+ session.on() → agent.emit()
│    → retorna unsubs[]
│
├─④ defaultEventCollector.attach(session)   [A]
│    → 70+ session.on() → persist/metrics
│    → retorna unsubs[]
│
└─⑤ #ensureDialogLoopAttached()
     → wireDialogLoopEvents(dlm, agent)
     → createAgentEventObserver(agent, metrics, errorTracker)
```

**Ponto Crítico:** O step ⑤ (`agent-event-observer`) só se ativa quando o dialog loop é iniciado
**pela primeira vez**. Isso significa que metrics derivadas de eventos do agent (como
`recordDialogTurn`, `recordToolCall`) **não são coletadas** para tarefas executadas via
`sendMessage()` sem dialog loop.

---

## 2. Cadeia de Propagação: SDK → Terminal

```
SDK session event
    ↓
session-event-wirer.js → agent.emit('eventName', data)
    ↓
┌───────────────────── CONSUMIDORES ────────────────────────┐
│                                                           │
│  repl.js setupAgentListeners() ─── 11 handlers:           │
│    • question.pending (filtra protocolo READY/REPLY)      │
│    • stopped (once → marca terminal como offline)         │
│    • tool.execution_start → display inline ⚙️              │
│    • tool.execution_complete → display resultado          │
│    • session.error → display ❌ com stack                  │
│    • session.compaction_start → display ♻️                 │
│    • session.compaction_complete → display ✅              │
│    • assistant.intent → ephemeral status line             │
│    • subagent.started → display 🤖 (nome)                │
│    • subagent.completed → display ✅ (metrics)            │
│    • subagent.failed → display ❌ (error)                 │
│                                                           │
│  dialog.js ─── streaming:                                 │
│    • onDelta/onReasoning vindo do dialogTurn callback     │
│    • broadcastSse() → SSE + Socket.io                     │
│    • NERV events (copilot:turn:sent, :turn:complete)      │
│                                                           │
│  agent-event-observer.js ─── 40+ handlers:                │
│    • Turn: dialog.turn.start/complete → MetricsStore      │
│    • Tools: tool.execution_* → latency histograms         │
│    • Streaming: response.delta → chunk intervals          │
│    • Questions: question.pending/answered → latency       │
│    • Tasks: task.started/completed → MetricsStore         │
│    • OTEL spans para cada turn/tool                       │
│                                                           │
│  nerv-bridge.js ─── 49 eventos → NERV envelopes:          │
│    • dialog.turn.* → copilot:dialog:turn:*                │
│    • tool.execution_* → copilot:tool:*                    │
│    • session.* → copilot:session:*                        │
│    • task.* → copilot:task:*                              │
│                                                           │
│  SSE (via agent/always-alive.js + api/sse.js):            │
│    • response.delta → broadcastSse('delta')               │
│    • reasoning.delta → broadcastSse('thinking')           │
│    • tool events, usage → broadcastSse()                  │
└───────────────────────────────────────────────────────────┘
```

---

## 3. Integração Observability ↔ Terminal

### 3.1 Como o terminal usa métricas

O terminal acessa a observabilidade de **três formas**:

1. **Direta (imports):**
   - `import { defaultMetrics } from '../observability/index.js'`
   - Usado nos comandos `/metrics`, `/usage`, `/errors`, `/audit`
   - O comando `/metrics` chama `defaultMetrics.getSummary()`

2. **Via agent events (indireta):**
   - `repl.js` escuta `tool.execution_complete` para mostrar duração
   - `dialog.js` calcula TTFT (time to first token) localmente

3. **Via SSE broadcast:**
   - `dialog.js` => `broadcastSse()` → api/sse.js → clientes externos
   - O próprio terminal não consome SSE, mas UIs externas sim

### 3.2 Fluxo de um turno completo (terminal → SDK → terminal)

```
1. Usuário digita no REPL
2. repl.js → handleCommand() ou sendTurn()
3. dialog.js sendTurn() → mutex → _executeTurn()
4. _executeTurn():
   a. Verifica context window (warn 85%, block 95%)
   b. Enriquece com attachments/plan mode
   c. ensureDialogLoop() → coalescing + retry (3×, 2s/4s/8s backoff)
   d. llmBridgeClient.dialogTurn(message, {onDelta, onReasoning})
5. Streaming callbacks:
   a. onReasoning(chunk) → display 💭 + broadcast SSE 'thinking'
   b. onDelta(chunk) → display 🧠 + broadcast SSE 'delta'
6. Após resposta completa:
   a. conversationHub.store.writeTurn() + notifyTerminalTurn()
   b. NERV events (copilot:turn:sent, copilot:turn:complete)
   c. Usage summary display (model, cost, ctx%)
```

---

## 4. Integração Agent ↔ ConversationHub

O `ConversationHub` persiste turnos em SQLite para histórico multi-sessão.

```
dialog.js → _executeTurn() finaliza
    ↓
conversationHub.store.writeTurn({
    sessionId, role, content, model, usage, turnNumber
})
    ↓
conversationHub.notifyTerminalTurn(sessionId, turnData)
    ↓ (se hub em modo socket)
socket-ns.js → io.of('/copilot').emit('turn', data)
    ↓ (se hub standalone)
Silencioso — guard try/catch evita crash
```

**Estado Atual:** O `notifyTerminalTurn()` funciona em modo socket (quando o servidor principal está
ativo), mas falha silenciosamente em modo standalone (terminal-only). Isso é aceitável para
standalone, mas a falha silenciosa dificulta diagnóstico.

---

## 5. Integração Agent ↔ NERV Bridge

A ponte NERV conecta o agente ao barramento de eventos do projeto principal.

```
nerv-bridge.js mount():
    ↓
copilotNervBridge.mount(agent, nervInstance)
    ↓
Para cada um dos 49 eventos do EVENT_MAP:
    agent.on('dialog.turn.complete', (data) => {
        nervInstance.emit({
            source: 'copilot',
            actionCode: 'copilot:dialog:turn:complete',
            payload: data
        })
    })
    ↓
Também registra handler para 'before-stop' do NERV:
    → detach todos os listeners
    → re-attach em 'ready' (reconexão)
```

**Estado Atual:** A bridge funciona, mas há 49 mapeamentos hard-coded. Mudanças no EventEmitter do
agente exigem atualização manual do `EVENT_MAP`. Não há validação de que todos os eventos estão
mapeados.

---

## 6. Integração Hooks ↔ Agent ↔ Observability

O sistema de hooks observa e pode intervir nas ações do SDK:

```
hooks/factory.js createSessionHooks()
    ↓
onPreToolUse(ctx):
    1. Verifica denyTools → DENY
    2. Verifica denyPatterns → DENY
    3. Verifica allowTools → ALLOW
    4. askHandler() → pergunta ao usuário (terminal) → ALLOW/DENY
    ↓
hooks/bus.js attachBus(hooks):
    → Envolve cada hook com emissão no HookBus
    → HookBus emite 'preToolUse:input', 'preToolUse:output'
    → Subscribers (event-collector, audit-log) observam sem bloquear
    ↓
session-lifecycle.js:
    → onSessionStart: retorna additionalContext (env snapshot)
    → onErrorOccurred: rate_limit/quota → agenda fallback model
```

---

_Continua em [PARTE-3-DIALOG-LOOP.md](PARTE-3-DIALOG-LOOP.md)_
