# PARTE-16C — Mapa de Fluxos e Dependências Críticas

**Data**: 2026-04-08
**Baseline**: commit `bfe96b57`
**Referência**: PARTE-16A (inventário), PARTE-16B (dívida técnica)

---

## 1. Grafo de Dependências Inter-Módulo

### 1.1 Visão Geral (260 arquivos, 788 imports)

```
                         ┌────────────┐
                         │   core/    │  (1.328L, 12 files)
                         │  errors    │  zero-dep foundation
                         │  retry     │
                         │  abort     │
                         │  shutdown  │
                         └─────┬──────┘
                               │ (imported by 26+ files)
              ┌────────────────┼───────────────────┐
              ▼                ▼                    ▼
     ┌────────────┐   ┌──────────────┐   ┌────────────────┐
     │  config/   │   │observability/│   │     db/        │
     │   (1.413L) │   │  (4.434L)    │   │   (410L)       │
     │  env, sys  │   │  logger(108) │   │  sqlite        │
     └─────┬──────┘   │  metrics     │   └──────┬─────────┘
           │          │  otel        │          │
           │          └──────┬───────┘          │
           │                 │                  │
     ┌─────┴─────────────────┴──────────────────┴───────────┐
     │                    agent/ (7.736L, 53 files)          │
     │  lifecycle/entry → always-alive → dialog-manager      │
     │  session/ → tools/ → hooks/ → state-machine           │
     └───────────┬───────────────────────────┬───────────────┘
                 │                           │
         ┌───────┴──────┐            ┌───────┴──────────┐
         │  channel/    │            │  hooks/           │
         │  (1.495L)    │            │  (3.423L)         │
         │  client+SSE  │            │  factory+presets  │
         └───────┬──────┘            └──────────────────┘
                 │
     ┌───────────┴───────────────────────────────┐
     │              sdk/ (3.231L)                 │
     │  @github/copilot-sdk wrapper              │
     └───────────┬───────────────────────────────┘
                 │
     ┌───────────┴───────────────────────────────┐
     │         tools/ (6.120L, 24 files)         │
     │  todo, file, git, shell, web, session     │
     └───────────┬───────────────────────────────┘
                 │
     ┌───────────┴───────────────────────┐───────────────────┐
     │   bridges/ (2.183L)               │ conversation-hub/  │
     │   mcp, git, nerv, gh              │ (2.473L)           │
     └────────────┬──────────────────────┘ orchestrator,store │
                  │                        └──────┬───────────┘
     ┌────────────┴─────────────────────────────┐
     │         terminal/ (7.618L, 49 files)     │
     │  server, repl, inject, dialog, commands  │
     └──────────┬───────────────────────────────┘
                │
     ┌──────────┴──────────────┐
     │     api/ (3.173L)       │
     │  REST + WebSocket       │
     └─────────────────────────┘
```

### 1.2 Módulos Foundation (sem dependências upstream)

| Módulo    | Linhas | Imports Recebidos | Risco de Mudança |
| --------- | -----: | ----------------: | :--------------: |
| `core/`   |  1.328 |              108+ |       Alto       |
| `config/` |  1.413 |               80+ |       Alto       |
| `db/`     |    410 |               20+ |      Médio       |

### 1.3 Fan-Out Crítico (dependências que mais se propagam)

| Módulo Importado                          | Importado Por N Arquivos | Risco       |
| ----------------------------------------- | -----------------------: | ----------- |
| `#copilot/observability/logger`           |                      108 | 🔴 Altíssimo |
| `#copilot/core/errors`                    |                       26 | 🟡 Alto      |
| `#copilot/config/env`                     |                       22 | 🟡 Alto      |
| `#copilot/agent/session` (diversas paths) |                       15 | 🟡 Alto      |

---

## 2. Fluxos Críticos

### 2.1 Boot Flow (Atualizado pós-PARTE-14E)

```
main.js
  └─→ entry.js::startWithRetry()
        ├─→ withRetry(alwaysAliveAgent.start, { maxAttempts: 5 })
        │     └─→ AlwaysAlive.start()
        │           ├─→ SessionManager.initialize()
        │           │     ├─→ StateIO.loadLastState()  ← FS sync ⚠️
        │           │     ├─→ SQLite.init()
        │           │     └─→ StateMachine.transition('initialized')
        │           ├─→ DialogManager.setup()
        │           │     └─→ LoopManager.init()
        │           ├─→ ToolRegistry.registerAll()
        │           │     ├─→ defineTool() × 40+
        │           │     └─→ HookFactory.createHooks()
        │           ├─→ NervBridge.connect()
        │           ├─→ TerminalServer.start()
        │           │     ├─→ Express.listen()
        │           │     ├─→ SocketIO.attach()
        │           │     ├─→ REPL.init()
        │           │     └─→ setInterval(cleanup) ← sem cleanup no shutdown ⚠️
        │           └─→ AlwaysAlive.heartbeatLoop()
        │                 └─→ setInterval(health) ← sem clear ⚠️
        ├─→ registerShutdownHandler('agent.stop', ...)
        └─→ process.on('SIGTERM'/'SIGINT', runShutdown)
```

### 2.2 Message/Dialog Flow

```
SDK.on('turn_start')
  └─→ DialogManager.handleTurn()
        └─→ LoopManager.runLoop(messages)
              ├─→ promptBuilder() ← inline (deveria ser extraído)
              ├─→ SDK.createMessage(model, messages)
              │     └─→ channel/client.js::sendRequest()
              │           ├─→ fetchWithRetry() ← retry manual ⚠️
              │           └─→ SSE streaming
              ├─→ Tool dispatch (se tool_use)
              │     ├─→ ToolRegistry.execute(toolName, args)
              │     │     ├─→ HookRunner.pre(toolName) ← hooks/factory
              │     │     ├─→ tool.handler(args)
              │     │     └─→ HookRunner.post(toolName, result)
              │     └─→ Loop continues with tool result
              ├─→ Observer notifications
              │     ├─→ EventCollector.collect()
              │     ├─→ MetricsTracker.increment()
              │     └─→ OTEL.span() (se disponível)
              └─→ ConversationHub.store(messages)
                    ├─→ store.js::insertMessage()
                    └─→ socket-ns.js::broadcast('message')
```

### 2.3 Shutdown Flow (Atualizado)

```
Signal (SIGTERM/SIGINT) or session.fatal
  └─→ runShutdown(reason)
        ├─→ isShuttingDown = true
        ├─→ Handlers por prioridade:
        │     10: agent.stop → AlwaysAlive.stop()
        │     20: bridges → NervBridge.disconnect()
        │     30: copilot.db → SQLite.close()
        │     40: terminal → ??? ⚠️ NÃO REGISTRADO
        │     50: ??? ⚠️ NÃO REGISTRADO
        └─→ process.exit(0)

⚠️ GAPS no shutdown:
  - terminal/server.js: usa process.on('exit') próprio
  - terminal/inject.js: usa process.on('exit') próprio
  - socket-ns.js: cleanup manual não integrado
  - Timers (setInterval) não cancelados
  - ConversationHub: sem handler de shutdown
```

---

## 3. Hot Paths e Gargalos

### 3.1 Critical Path: Message Processing

Latência estimada por estágio:

| Estágio                      | Async?  | Latência Est. | Gargalo?  |
| ---------------------------- | ------- | ------------- | --------- |
| `LoopManager.runLoop()`      | Sim     | ~50ms         | ✅ OK      |
| `SDK.createMessage()`        | Sim     | 1-30s (LLM)   | I/O bound |
| `ToolRegistry.execute()`     | Sim     | 10ms-5s       | Variável  |
| `ConversationHub.store()`    | Sim     | ~5ms          | ✅ OK      |
| `EventCollector.collect()`   | **NÃO** | ~1ms          | ⚠️ Sync    |
| `MetricsTracker.increment()` | **NÃO** | ~0.1ms        | ✅ OK      |

### 3.2 Background Paths

| Path                  | Tipo        | Intervalo | Problema          |
| --------------------- | ----------- | --------- | ----------------- |
| AlwaysAlive heartbeat | setInterval | 30s       | Sem clearInterval |
| Terminal cleanup      | setInterval | 60s       | Sem clearInterval |
| Socket heartbeat      | setInterval | 25s       | Sem clearInterval |
| Metrics flush         | setTimeout  | Variável  | Sem cancelamento  |
| DB WAL checkpoint     | setTimeout  | 300s      | OK (timeout)      |

---

## 4. Dependency Coupling Score

### 4.1 Acoplamento Aferente (Ca) — "Quem depende de mim?"

| Módulo           |   Ca | Interpretação              |
| ---------------- | ---: | -------------------------- |
| `observability/` |  108 | ⚠️ Mudança aqui quebra tudo |
| `core/`          |   52 | ⚠️ Foundation crítico       |
| `config/`        |   22 | Estável (muda pouco)       |
| `agent/session/` |   15 | Estado compartilhado       |
| `db/`            |   10 | Interface estável          |

### 4.2 Acoplamento Eferente (Ce) — "De quem eu dependo?"

| Módulo              |   Ce | Interpretação                   |
| ------------------- | ---: | ------------------------------- |
| `terminal/`         |   45 | Depende de quase tudo           |
| `agent/`            |   38 | Hub central, esperado           |
| `tools/`            |   32 | Depende de agent, db, bridges   |
| `bridges/`          |   20 | Depende de core, config, logger |
| `conversation-hub/` |   18 | Depende de db, sockets, config  |

### 4.3 Instability Index (I = Ce / (Ca + Ce))

| Módulo              |    I | Classe         | Nota                               |
| ------------------- | ---: | -------------- | ---------------------------------- |
| `core/`             | 0.08 | Estável        | ✅ Foundation correto               |
| `config/`           | 0.15 | Estável        | ✅ Configuração estável             |
| `observability/`    | 0.20 | Estável        | ✅ Logger/metrics estáveis          |
| `db/`               | 0.30 | Semi-estável   | ✅ Interface clara                  |
| `hooks/`            | 0.55 | Balanceado     | OK                                 |
| `agent/`            | 0.72 | Instável       | ⚠️ Depende de muitos módulos        |
| `bridges/`          | 0.80 | Instável       | OK (é adapter — deve ser instável) |
| `tools/`            | 0.82 | Instável       | OK (leaf node)                     |
| `terminal/`         | 0.90 | Muito instável | ⚠️ Acumula deps de todos            |
| `conversation-hub/` | 0.90 | Muito instável | OK se tests existirem              |

---

## 5. Pontos de Fragilidade Estrutural

### 5.1 Single Points of Failure

| Componente              | Impacto se falhar                | Mitigation Atual        | Gap       |
| ----------------------- | -------------------------------- | ----------------------- | --------- |
| `always-alive.js`       | Processo inteiro para            | withRetry no start      | ✅ OK      |
| `sqlite.js` (DB)        | Perda de state                   | registerShutdownHandler | ✅ OK      |
| `logger.js`             | Sem observabilidade              | Fallback console        | ✅ OK      |
| `NervBridge`            | Sem comunicação com bus          | ❌ Sem fallback          | ⚠️ Gap     |
| `TerminalServer`        | Sem REPL/WebSocket               | ❌ Sem fallback          | ⚠️ Gap     |
| `ConversationHub.store` | Perda de contexto de conversação | ❌ Sem fallback          | 🔴 Crítico |

### 5.2 Race Conditions Potenciais

| ID    | Módulo                | Condição                                  | Severidade |
| ----- | --------------------- | ----------------------------------------- | ---------- |
| RC-01 | `state-io.js`         | Read/Write sync concorrente de state.json | 🟡 Média    |
| RC-02 | `snapshot.js`         | Multiple snapshot writes simultâneos      | 🟡 Média    |
| RC-03 | `store.js` (conv-hub) | INSERT concorrente no SQLite              | 🟢 Baixa    |
| RC-04 | `alias-store.js`      | Read-modify-write sem lock                | 🟢 Baixa    |
| RC-05 | `tools-state.js`      | File-based state sem atomicidade          | 🟢 Baixa    |

---

## 6. Recomendações Estruturais para PARTE-16E (Roadmap)

### 6.1 Ordem de Execução Recomendada

```
Faixa 1: Foundation hardening (core/retry migration + FS async + shutdown integration)
         ↓
Faixa 2: Security hardening (execSync→execFile, socket auth, origin validation)
         ↓
Faixa 3: Catch block audit + error handling standardization
         ↓
Faixa 4: Timer cleanup + lifecycle management
         ↓
Faixa 5: conversation-hub tests (P0 — 2473L, 0 testes)
         ↓
Faixa 6: bridges tests (P0 — 2183L, 0 testes)
         ↓
Faixa 7: terminal hardening + decomposição (7618L, 3 testes)
         ↓
Faixa 8: tools decomposição + testes (6120L, 6 testes)
         ↓
Faixa 9: observability tests + dead catch cleanup
         ↓
Faixa 10: God module decomposição tier-2 (450-600L files)
          ↓
Faixa 11: God module decomposição tier-3 (400-450L files)
          ↓
Faixa 12: Performance hardening (FS async final, metrics reset, unbounded arrays)
          ↓
Faixa 13: API consistency + padronização final
          ↓
Faixa 14: Coverage targets + CI hardening + relatório final
```

### 6.2 Métricas Alvo para Fim do PARTE-16

| Métrica                 | Atual     | Alvo   | Delta |
| ----------------------- | --------- | ------ | ----- |
| Arquivos >400L          | 22        | ≤8     | -14   |
| Catch blocks vazios     | ~133      | ≤20    | -113  |
| FS sync calls (runtime) | ~60       | ≤10    | -50   |
| Modules com 0 testes    | 2 (5156L) | 0      | -2    |
| Testes totais           | 2.342     | ≥3.000 | +658  |
| Coverage lines          | 30%       | ≥45%   | +15%  |
| Coverage branches       | 20%       | ≥30%   | +10%  |
| Retry duplicados        | 4         | 0      | -4    |
| process.on dispersos    | ~14       | ≤3     | -11   |
| Timers sem cleanup      | ~15       | ≤3     | -12   |
| SEC issues médias       | 4         | 0      | -4    |
