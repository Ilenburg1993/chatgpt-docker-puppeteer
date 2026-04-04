# Auditoria Arquitetural — src/copilot · Parte 1: Arquitetura e Inventário

**Data**: 2026-04-04
**Escopo**: 172 arquivos JS · ~39.000 linhas · 25 diretórios
**SDK**: `@github/copilot-sdk` v0.2.0

---

## 1. Visão Geral da Arquitetura

O módulo `src/copilot/` implementa um agente autônomo LLM-B sobre o GitHub Copilot SDK, com
terminal interativo REPL, servidor HTTP, canais de comunicação LLM-A ↔ LLM-B, e sistema de
observabilidade completo. O design é orientado a eventos via `EventEmitter` do Node.js, com bridges
opcionais para o NERV (event bus do projeto principal).

### Diagrama de Camadas

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TERMINAL (porta 3009)                            │
│   repl.js · dialog.js · server.js · commands/* · state.js               │
├─────────────────────────────────────────────────────────────────────────┤
│                          CHANNEL                                        │
│   client.js (LlmBridgeClient) · inject.js (HTTP) · index.js            │
├─────────────────────────────────────────────────────────────────────────┤
│                           AGENT                                         │
│   always-alive.js · dialog-loop-manager.js · task-executor.js           │
│   session-event-wirer.js · dialog-protocol.js · session-initializer.js  │
├─────────────────────────────────────────────────────────────────────────┤
│                     HOOKS & PERMISSIONS                                  │
│   factory.js · bus.js · composer.js · permission-handler.js             │
│   session-lifecycle.js · error-handler.js · presets/*                    │
├─────────────────────────────────────────────────────────────────────────┤
│                       OBSERVABILITY                                      │
│   event-collector.js · agent-event-observer.js · metrics.js             │
│   error-tracker.js · audit-log.js · tool-stats.js · otel.js · logger.js │
├─────────────────────────────────────────────────────────────────────────┤
│                    TOOLS (16 arquivos)                                    │
│   shell · git · todo · file · web · code · hub · permission · session   │
│   introspection · task · hook · tool-factory                             │
├─────────────────────────────────────────────────────────────────────────┤
│                    BRIDGES (8 arquivos)                                   │
│   nerv-bridge.js · gh-bridge.js · mcp-tool-bridge.js · alias-store.js   │
├─────────────────────────────────────────────────────────────────────────┤
│                  CONVERSATION HUB                                        │
│   hub.js · orchestrator.js · store.js · store-helpers.js · socket-ns.js  │
├─────────────────────────────────────────────────────────────────────────┤
│               CONFIG · CORE · TYPES · DB · LIB                           │
│   system-prompt.js · session-config.js · constants.js · errors.js        │
│   mcp-servers.js · pinned-files.js · sdk-client.js · models.js           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Inventário de Módulos (por diretório)

### 2.1 `agent/` — 18 arquivos · ~5.200 linhas

O núcleo do agente autônomo. Contém o `AlwaysAliveAgent` (singleton, `EventEmitter`), o
`DialogLoopManager` (dialog loop zero-PR), e a lógica de execução de tarefas.

| Arquivo                    | Linhas | Responsabilidade                                            |
| -------------------------- | ------ | ----------------------------------------------------------- |
| `always-alive.js`          | 1288   | Singleton do agente: lifecycle, queue, session, reconnect   |
| `dialog-loop-manager.js`   | 485    | Boot, mutex de turnos, pause/resume, watchdog               |
| `session-event-wirer.js`   | 535    | Subscreve ~80 eventos SDK → emite no EventEmitter do agente |
| `session-initializer.js`   | 364    | Init/resume de sessão, MCP tools, hooks                     |
| `dialog-turn-executor.js`  | 324    | Executa um turno individual do dialog loop                  |
| `task-executor.js`         | 190    | Executa uma task (sendAndWait), reconexão, OTEL spans       |
| `entry.js`                 | 163    | Entry point PM2: retry, IPC, signals, shutdown              |
| `dialog-protocol.js`       | 115    | READY/REPLY/DONE/STOPPED — classificação de protocolo       |
| `dialog-loop-wirer.js`     | 55     | Forwards 11 DLM events → agent.emit()                       |
| `reconnect-policy.js`      | ~150   | Backoff exponencial com jitter                              |
| `tools-bootstrap.js`       | ~120   | Monta registry de tools + MCP tools                         |
| `state-io.js`              | ~100   | Persistência de estado em disco (debounced writes)          |
| `webhook-manager.js`       | ~80    | Fire-and-forget para COPILOT_READY_WEBHOOK                  |
| `permission-controller.js` | ~70    | Modos: auto-approve, interactive, deny-all                  |
| `message-queue.js`         | ~60    | Fila FIFO com prioridade para task queuing                  |
| `index.js`                 | ~30    | Barrel exports                                              |
| `session-hooks.js`         | ~20    | (deprecated) Shim → hooks/session-lifecycle.js              |

### 2.2 `observability/` — 9 arquivos · ~4.100 linhas

Sistema completo de métricas, erros, audit log e telemetria.

| Arquivo                   | Linhas | Responsabilidade                                           |
| ------------------------- | ------ | ---------------------------------------------------------- |
| `event-collector.js`      | 1408   | Captura 70+ eventos SDK, persiste em events.jsonl          |
| `agent-event-observer.js` | 851    | Observa EventEmitter do agente → alimenta MetricsStore     |
| `metrics.js`              | 523    | MetricsStore com histogramas p50/p95/p99, gauges, counters |
| `audit-log.js`            | 377    | Ring buffer + JSONL de ações sensíveis                     |
| `logger.js`               | 270    | Logger com níveis, rotação, LOG_DIR                        |
| `error-tracker.js`        | 232    | Rastreio de erros com dedup e global handlers              |
| `otel.js`                 | 224    | Spans OTEL opcionais (Jaeger/Grafana)                      |
| `tool-stats.js`           | 163    | Stats por ferramenta (latência, sucesso, erros)            |
| `index.js`                | 46     | Barrel exports com singletons                              |

### 2.3 `terminal/` — 20+ arquivos · ~4.500 linhas

Servidor HTTP 3009 + REPL interativo + comandos.

| Arquivo                    | Linhas | Responsabilidade                                        |
| -------------------------- | ------ | ------------------------------------------------------- |
| `dialog.js`                | 839    | sendTurn, ensureDialogLoop, SSE broadcast, streaming    |
| `repl.js`                  | 491    | Readline REPL, setupAgentListeners, command dispatch    |
| `server.js`                | 438    | Express server 3009, rate limiting, auth                |
| `state.js`                 | 268    | Estado mutável centralizado (busy, showThinking, etc.)  |
| `handlers-system.js`       | ~300   | Handlers HTTP: /health, /metrics, /errors, /audit       |
| `route-table.js`           | ~150   | Roteamento declarativo com middleware                   |
| `bootstrap.js`             | 40     | Entry point do terminal (ESM)                           |
| `commands/` (12+ arquivos) | ~800   | /tools, /errors, /audit, /thinking, /usage, /display... |

### 2.4 `channel/` — 3 arquivos · ~1.300 linhas

Canal de comunicação LLM-A ↔ LLM-B.

| Arquivo     | Linhas | Responsabilidade                                        |
| ----------- | ------ | ------------------------------------------------------- |
| `client.js` | 729    | LlmBridgeClient: chat(), chatStructured(), dialogTurn() |
| `inject.js` | 546    | HTTP inject POST /inject com retry, backoff, métricas   |
| `index.js`  | ~25    | Barrel exports                                          |

### 2.5 `hooks/` — 13 arquivos · ~1.500 linhas

Sistema de hooks do SDK (onPreToolUse, onPostToolUse, etc.).

| Arquivo                 | Linhas | Responsabilidade                                     |
| ----------------------- | ------ | ---------------------------------------------------- |
| `factory.js`            | 402    | Build dos 6 handlers: preToolUse, postToolUse, etc.  |
| `bus.js`                | 185    | HookBus EventEmitter para observação sem acoplamento |
| `session-lifecycle.js`  | 133    | onSessionStart/End/ErrorOccurred com DI              |
| `composer.js`           | ~120   | Compõe múltiplos handlers em pipeline                |
| `permission-handler.js` | ~100   | Lógica de allow/deny/ask com preset                  |
| `error-handler.js`      | ~80    | Recovery: retry/skip/abort por tipo de erro          |
| `types.js`              | ~60    | TypeDefs (JSDoc) para todos os hooks                 |
| `presets/`              | ~200   | audit.js, restrictive.js, permissive.js              |

### 2.6 `bridges/` — 8 arquivos · ~800 linhas

Pontes para sistemas externos.

| Arquivo              | Linhas | Responsabilidade                                         |
| -------------------- | ------ | -------------------------------------------------------- |
| `nerv-bridge.js`     | 315    | 55+ eventos AlwaysAlive → NERV envelopes (mount/unmount) |
| `mcp-tool-bridge.js` | ~200   | Conexão com MCP servers, auto-reconnect, circuit breaker |
| `gh-bridge.js`       | ~100   | GitHub CLI wrapping (gh pr, gh issue, etc.)              |
| `alias-store.js`     | ~80    | Aliases de comandos com detecção de loops                |

### 2.7 `conversation-hub/` — 5 arquivos · ~1.200 linhas

Persistência SQLite de conversas multi-sessão.

| Arquivo            | Linhas | Responsabilidade                                       |
| ------------------ | ------ | ------------------------------------------------------ |
| `store.js`         | ~450   | CRUD SQLite: sessions, turns, busca, métricas          |
| `hub.js`           | ~250   | Hub principal: init/initStandalone, notifyTerminalTurn |
| `orchestrator.js`  | ~200   | Coordena fluxo entre terminal e Hub                    |
| `socket-ns.js`     | ~200   | Namespace Socket.io /copilot para real-time            |
| `store-helpers.js` | ~100   | Utilities para queries e paginação                     |

### 2.8 `tools/` — 16 arquivos · ~3.000 linhas

Custom Tools registradas no SDK via `defineTool`.

### 2.9 `config/` — 6 arquivos · ~800 linhas

Configuração de sessão, system prompt, MCP servers, pinned files.

### 2.10 Outros

- `core/` (3 arquivos): constants.js, errors.js, index.js
- `types/` (3 arquivos): index.js, sdk.js, structured-message.js
- `db/` (2 arquivos): sqlite.js, migrations.js
- `lib/` (10 arquivos): sdk-client, models, http-request, agents, event-helpers, etc.
- `api/` (8 arquivos): bridge-control, dialog, stream, tasks, event-fanout, http-bridge, sdk-api, sse
- `routes/` (7 arquivos): agent, client, hooks, middleware, observability, sessions, webhooks

---

## 3. Singletons e Instâncias Globais

| Singleton               | Arquivo                     | Tipo            | Usado em     |
| ----------------------- | --------------------------- | --------------- | ------------ |
| `alwaysAliveAgent`      | agent/always-alive.js       | EventEmitter    | 25+ arquivos |
| `defaultMetrics`        | observability/metrics.js    | MetricsStore    | 25+ arquivos |
| `defaultErrorTracker`   | observability/error-tracker | ErrorTracker    | 15+ arquivos |
| `defaultAuditLog`       | observability/audit-log.js  | AuditLog        | 15+ arquivos |
| `defaultEventCollector` | observability/event-coll.   | EventCollector  | 5 arquivos   |
| `defaultBus` (HookBus)  | hooks/bus.js                | EventEmitter    | 3 arquivos   |
| `llmBridgeClient`       | channel/client.js           | LlmBridgeClient | 5 arquivos   |
| `conversationHub`       | conversation-hub/hub.js     | ConversationHub | 8 arquivos   |
| `copilotNervBridge`     | bridges/nerv-bridge.js      | Bridge obj      | 3 arquivos   |

---

_Continua em [PARTE-2-INTEGRACOES.md](PARTE-2-INTEGRACOES.md)_
