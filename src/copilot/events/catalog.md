# Catálogo de Eventos — Copilot System

**Última atualização**: 2026-04-22 | **FAIXA-2A/F0.3** | **Fonte**: `src/copilot/events/`

> **SSOT**: Todas as strings de evento devem ser importadas de `#copilot/events`. Strings literais
> de evento de domínio ou legacy emitter fora deste módulo são violações arquiteturais (C11).
> Eventos locais de processo, UI e infraestrutura são classificados pelo auditor, mas não entram no
> catálogo global por padrão.

---

## Convenções de Naming

| Padrão               | Exemplo                | Uso                   |
| -------------------- | ---------------------- | --------------------- |
| `namespace:ação`     | `agent:ready`          | Eventos principais    |
| `namespace:sub:ação` | `agent:dialog:stalled` | Eventos de subsistema |
| `dot.notation`       | `task.started`         | Eventos legados SDK   |
| `socket:event`       | `join:session`         | Eventos de socket     |

## Classificação do Auditor

O auditor `scripts/audit-event-strings.mjs` separa achados em cinco famílias:

| Categoria        | Entra como violação? | Uso                                                                 |
| ---------------- | -------------------- | ------------------------------------------------------------------- |
| `domain`         | Sim                  | Evento de domínio Copilot fora de `events/`                         |
| `legacy-emitter` | Sim                  | Evento local/legado de `EventEmitter` sem constante importada       |
| `node-process`   | Não                  | Sinais e eventos do processo Node.js, como `SIGTERM` e `SIGINT`     |
| `ui-local`       | Não                  | Eventos locais de projection/UX, como `activity:changed`            |
| `infra-local`    | Não                  | Streams, sockets, HTTP, readline e eventos locais de infraestrutura |

Baseline atual:

```text
ssotCount=198
violationCount=0
findingCount=39
domain=0
legacy-emitter=0
node-process=9
ui-local=4
infra-local=26
```

---

## Agent Events (`events/agent-events.js`)

### Lifecycle

| Constante             | String                | Emitido por      |
| --------------------- | --------------------- | ---------------- |
| `AGENT_READY`         | `agent:ready`         | AlwaysAliveAgent |
| `AGENT_BEFORE_STOP`   | `agent:before-stop`   | AlwaysAliveAgent |
| `AGENT_STOPPED`       | `agent:stopped`       | AlwaysAliveAgent |
| `AGENT_SHUTDOWN`      | `agent:shutdown`      | AlwaysAliveAgent |
| `AGENT_ERROR`         | `agent:error`         | AlwaysAliveAgent |
| `AGENT_EMITTER_ERROR` | `agent:emitter.error` | AlwaysAliveAgent |

### Session

| Constante                 | String                    | Emitido por      |
| ------------------------- | ------------------------- | ---------------- |
| `AGENT_SESSION_KEEPALIVE` | `agent:session:keepalive` | AlwaysAliveAgent |
| `AGENT_SESSION_FATAL`     | `agent:session.fatal`     | AlwaysAliveAgent |

### Task

| Constante            | String               | Emitido por      | Consome PR? |
| -------------------- | -------------------- | ---------------- | ----------- |
| `AGENT_TASK_STARTED` | `agent:task:started` | task-executor.js | ⚠️ Sim      |
| `AGENT_TASK_DELTA`   | `agent:task:delta`   | task-executor.js | ⚠️ Sim      |
| `AGENT_TASK_ERROR`   | `agent:task.error`   | task-executor.js | ⚠️ Sim      |

### Dialog

| Constante                           | String                              | Emitido por     | Consome PR? |
| ----------------------------------- | ----------------------------------- | --------------- | ----------- |
| `AGENT_DIALOG_LOOP_CHANGED`         | `agent:dialog:loop:changed`         | loop-manager.js | ✅ Não      |
| `AGENT_DIALOG_TURN_TIMEOUT`         | `agent:dialog.turn_timeout`         | loop-manager.js | ✅ Não      |
| `AGENT_DIALOG_STALLED`              | `agent:dialog:stalled`              | loop-manager.js | ✅ Não      |
| `AGENT_DIALOG_PAUSED`               | `agent:dialog:paused`               | loop-manager.js | ✅ Não      |
| `AGENT_DIALOG_RESUMED`              | `agent:dialog:resumed`              | loop-manager.js | ✅ Não      |
| `AGENT_DIALOG_STOPPED`              | `agent:dialog:stopped`              | loop-manager.js | ✅ Não      |
| `AGENT_DIALOG_REPLY`                | `agent:dialog:reply`                | loop-manager.js | ✅ Não      |
| `AGENT_DIALOG_COMPACTION_REQUESTED` | `agent:dialog:compaction:requested` | loop-manager.js | ✅ Não      |

### Handoff

| Constante                | String                   | Emitido por    |
| ------------------------ | ------------------------ | -------------- |
| `AGENT_HANDOFF_RECEIVED` | `agent:handoff:received` | HandoffManager |
| `AGENT_HANDOFF_ACCEPTED` | `agent:handoff:accepted` | HandoffManager |
| `AGENT_HANDOFF_REJECTED` | `agent:handoff:rejected` | HandoffManager |

### Conjuntos de classificação

- **`AGENT_EVENTS`**: Array de todas as strings de evento (legado SDK, para loop dinâmico de
  listeners)
- **`MODEL_USAGE_LIFECYCLE_EVENTS`**: Set moderno de eventos de lifecycle que podem corresponder a uma chamada/tarefa de modelo
- **`PR_CONSUMING_EVENTS`**: alias/set legado preservado para compatibilidade com consumers request-based antigos; não deve ser usado para inferir billing atual
- **`DIALOG_LOOP_EVENTS`**: Set de eventos do dialog loop
- **`HIGH_FREQUENCY_EVENTS`**: Set de eventos de alta frequência (hot-path)

---

## Hook Events (`events/hook-events.js`)

Eventos emitidos pelo `HookBus` e bridgeados para o `EventBus` global.

| Constante               | String                  | Gatilho                |
| ----------------------- | ----------------------- | ---------------------- |
| `HOOK_PRE_TOOL_USE`     | `hook:pre_tool_use`     | Antes de executar tool |
| `HOOK_POST_TOOL_USE`    | `hook:post_tool_use`    | Após executar tool     |
| `HOOK_PROMPT_SUBMITTED` | `hook:prompt_submitted` | Prompt enviado ao LLM  |
| `HOOK_SESSION_START`    | `hook:session_start`    | Sessão iniciada        |
| `HOOK_SESSION_END`      | `hook:session_end`      | Sessão encerrada       |
| `HOOK_ERROR_OCCURRED`   | `hook:error_occurred`   | Erro em hook           |

---

## Hub Events (`events/hub-events.js`)

Eventos do ConversationHub (socket namespaces, Socket.IO).

| Constante             | String            | Direção       |
| --------------------- | ----------------- | ------------- |
| `HUB_ERROR`           | `hub:error`       | server→client |
| `HUB_SESSION_CREATED` | `session:created` | server→client |
| `HUB_SESSION_CLOSED`  | `session:closed`  | server→client |
| `HUB_TURN_SENT`       | `turn:sent`       | client→server |
| `HUB_TURN_COMPLETE`   | `turn:complete`   | server→client |
| `HUB_USER_INJECTED`   | `user:injected`   | server→client |
| `HUB_TURN_DELTA`      | `turn:delta`      | server→client |

Nota: `HUB_EVENTS` é o objeto completo para uso em socket handlers. Constantes individuais são para
bridges.

---

## Terminal e Audit Events (`events/terminal-events.js`)

| Constante          | String             | Emitido por       |
| ------------------ | ------------------ | ----------------- |
| `TERMINAL_STARTED` | `terminal:started` | terminal/index.js |
| `TERMINAL_STOPPED` | `terminal:stopped` | terminal/index.js |
| `TERMINAL_COMMAND` | `terminal:command` | terminal/index.js |
| `AUDIT_ENTRY`      | `audit:entry`      | audit pipeline    |
| `AUDIT_FLUSH`      | `audit:flush`      | audit pipeline    |
| `AUDIT_LOG`        | `audit:log`        | audit pipeline    |
| `AUDIT_QUICK`      | `audit:quick`      | audit pipeline    |

---

## System Events (`events/system-events.js`)

Eventos de infraestrutura: shutdown, config, health, bridges.

| Constante                     | String                        | Uso               |
| ----------------------------- | ----------------------------- | ----------------- |
| `SYSTEM_SHUTDOWN_STARTED`     | `system:shutdown:started`     | ShutdownRegistry  |
| `SYSTEM_SHUTDOWN_COMPLETE`    | `system:shutdown:complete`    | ShutdownRegistry  |
| `CONFIG_PINNED_FILES_CHANGED` | `config:pinned_files:changed` | PinnedFilesLoader |
| `CONFIG_CHANGED`              | `config:changed`              | config module     |
| `HEALTH_CHECK`                | `health:check`                | health-service    |
| `HEALTH_DEGRADED`             | `health:degraded`             | health-service    |
| `HEALTH_RECOVERED`            | `health:recovered`            | health-service    |
| `BRIDGE_MCP_RECONNECTED`      | `bridge:mcp:reconnected`      | mcp-tool-bridge   |
| `BRIDGE_NERV_CONNECTED`       | `bridge:nerv:connected`       | nerv-bridge       |
| `BRIDGE_NERV_DISCONNECTED`    | `bridge:nerv:disconnected`    | nerv-bridge       |

---

## Bridge Coverage (FAIXA-2C)

| Emitter           | Arquivo                                      | Bridgeado?    | Via                                              |
| ----------------- | -------------------------------------------- | ------------- | ------------------------------------------------ |
| AlwaysAliveAgent  | `agent/always-alive.js`                      | ✅            | `always-alive.js`                                |
| DialogLoopManager | `agent/dialog/orchestrators/loop-manager.js` | ✅            | `always-alive.js`                                |
| HandoffManager    | `agent/infra/handoff-manager.js`             | ✅            | `always-alive.js`                                |
| HookBus           | `hooks/bus.js`                               | ✅            | `agent/lifecycle/entrypoints/entry.js`           |
| HubOrchestrator   | `conversation-hub/orchestrator.js`           | ✅            | `conversation-hub/hub.js`                        |
| PinnedFilesLoader | `config/pinned-files.js`                     | ✅ (FAIXA-2C) | `conversation-hub/hub.js` ou `terminal/index.js` |

---

## EventBus Subscribers (FAIXA-2D)

> Status: em andamento. Ver progresso em PARTE-23I.

| Subscriber                    | Esculta           | Status      |
| ----------------------------- | ----------------- | ----------- |
| observability/event-collector | AGENT*\*, HOOK*\* | ⏳ pendente |
| audit-service                 | AUDIT\_\*         | ⏳ pendente |
