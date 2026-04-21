# Inventário Estrutural Completo — `src/copilot`

## Escopo e leitura

Este documento inventaria a árvore real de `src/copilot/` por:

- arquivos de raiz;
- módulos top-level;
- subpastas;
- arquivos JavaScript observados.

### Arquivos de raiz observados

- `src/copilot/agent.js`
- `src/copilot/bootstrap.js`
- `src/copilot/README.md`

### Diretório operacional não-fonte

Existe também `src/copilot/logs/`, que contém artefatos operacionais como:

- `agent.log`
- `audit.jsonl`
- `events.jsonl`
- `metrics.jsonl`
- `otel-traces.jsonl`
- `tool-audit.jsonl`

Ele faz parte da realidade operacional do sistema, mas **não** deve ser tratado como camada
arquitetural de código.

## Tabela-base por módulo

| Módulo             | Arquivos JS | Linhas | Subpastas observadas | Papel atual resumido                              |
| ------------------ | ----------: | -----: | -------------------: | ------------------------------------------------- |
| `agent`            |          63 |  8.455 |                    9 | runtime principal, ciclo de vida, diálogo, sessão |
| `audit`            |           9 |    915 |                    1 | trilha de auditoria e pipelines auxiliares        |
| `bridges`          |          13 |  2.205 |                    2 | integrações Git/GitHub/MCP/NERV                   |
| `channel`          |           8 |  1.445 |                    1 | transporte contínuo LLM-A ↔ LLM-B                 |
| `config`           |          24 |  2.574 |                    4 | builders, defaults, prompts e env                 |
| `conversation-hub` |          12 |  2.223 |                    1 | sessões conversacionais, turns e memória          |
| `core`             |          20 |  3.217 |                    2 | utilidades centrais, DI, erros, shared-state      |
| `db`               |           3 |    440 |                    1 | persistência SQLite e migrações                   |
| `event-handlers`   |          13 |    825 |                    1 | reações semânticas a eventos                      |
| `events`           |          20 |  2.319 |                    3 | taxonomia e middleware de eventos                 |
| `hooks`            |          25 |  4.635 |                    2 | políticas, composição, lifecycle hooks            |
| `infra`            |          12 |  1.129 |                    2 | registries, storage, filas, SSE state             |
| `observability`    |          33 |  5.893 |                    4 | coleta, tracking, alerting, métricas              |
| `plugins`          |           3 |    271 |                    1 | registry de plugins                               |
| `presentation`     |           7 |  1.526 |                    1 | projections/handlers compartilhados entre bordas  |
| `sdk`              |          38 |  7.969 |                    7 | wrapper do vendor SDK e capacidades               |
| `server`           |          41 |  5.438 |                    6 | borda HTTP/SSE/Socket                             |
| `terminal`         |          50 |  7.113 |                    5 | frontend principal da LLM-B                       |
| `tools`            |          33 |  7.134 |                    5 | surface de ferramentas do runtime                 |
| `types`            |           4 |    223 |                    2 | contratos compartilhados                          |

## Inventário módulo a módulo

### `agent/`

**Subpastas**: `.`, `dialog`, `facades`, `infra`, `lifecycle`, `messaging`, `session`,
`session/event-handlers`, `state`

**Arquivos de raiz**:

- `agent-context.js`
- `always-alive.js`
- `background-tasks.js`
- `di-tokens.js`
- `error-policy.js`
- `event-bridge-map.js`
- `event-bridge-wiring.js`
- `health-check.js`
- `index.js`
- `queue-processor.js`
- `types.js`

**`dialog/`**:

- `agent-dialog-controller.js`
- `backpressure.js`
- `event-wiring.js`
- `index.js`
- `loop-manager.js`
- `model-fallback.js`
- `protocol.js`
- `turn-executor.js`
- `user-input-handler.js`
- `watchdog.js`

**`facades/`**:

- `agent-model-config.js`
- `agent-session-ops.js`
- `agent-webhook-ops.js`

**`infra/`**:

- `handoff-manager.js`
- `index.js`
- `message-queue.js`
- `task-executor.js`

**`lifecycle/`**:

- `agent-lifecycle.js`
- `entry.js`
- `index.js`
- `reconnect-policy.js`
- `session-setup.js`
- `state-io.js`

**`messaging/`**:

- `agent-messaging.js`
- `index.js`

**`session/`**:

- `boot-steps.js`
- `boot-wiring.js`
- `cleanup.js`
- `event-wirer.js`
- `history-sync.js`
- `hook-context.js`
- `index.js`
- `initializer.js`
- `keepalive.js`
- `ownership.js`
- `rotation.js`
- `snapshot.js`

**`session/event-handlers/`**:

- `catch-all.js`
- `compaction.js`
- `index.js`
- `interaction-events.js`
- `mcp-events.js`
- `mode-and-tools.js`
- `sdk-responses.js`
- `session-lifecycle.js`
- `streaming.js`
- `system-notifications.js`
- `token-budget.js`
- `tool-lifecycle.js`
- `usage.js`

**`state/`**:

- `agent-state.js`
- `index.js`

### `audit/`

- `di-tokens.js`
- `index.js`
- `jsonl-writer.js`
- `logger.js`
- `pipeline-audit-log.js`
- `pipeline-permission.js`
- `pipeline-sdk-buffer.js`
- `pipeline.js`
- `ring-buffer.js`

### `bridges/`

**Raiz**:

- `di-tokens.js`
- `git-bridge-read.js`
- `git-bridge-write.js`
- `git-bridge.js`
- `index.js`
- `mcp-tool-bridge.js`
- `mcp-tool-schema.js`
- `nerv-event-bus-adapter.js`

**`gh/`**:

- `ci.js`
- `index.js`
- `issues.js`
- `prs.js`
- `shared.js`

### `channel/`

- `client-dialog.js`
- `client-history.js`
- `client-structured.js`
- `client.js`
- `di-tokens.js`
- `index.js`
- `inject.js`
- `sse-client.js`

### `config/`

**Raiz**:

- `agent.js`
- `auth.js`
- `client-options.js`
- `custom-agents.js`
- `env.js`
- `index.js`
- `mcp-servers.js`
- `pinned-files.js`
- `session-config.js`
- `system-prompt.js`

**`system-prompt/`**:

- `index.js`
- `mode.js`

**`system-prompt/sdk-defaults/`**:

- `capture.js`
- `snapshot.js`

**`system-prompt/sections/`**:

- `code-change-rules.js`
- `custom-instructions.js`
- `environment-context.js`
- `guidelines.js`
- `identity.js`
- `last-instructions.js`
- `safety.js`
- `tone.js`
- `tool-efficiency.js`
- `tool-instructions.js`

### `conversation-hub/`

- `broadcast.js`
- `call-strategies.js`
- `di-tokens.js`
- `hub.js`
- `index.js`
- `orchestrator.js`
- `send-pipeline.js`
- `store-helpers.js`
- `store-memories.js`
- `store-queries.js`
- `store-sync.js`
- `store.js`

### `core/`

**Raiz**:

- `cache.js`
- `circuit-breaker.js`
- `di-container.js`
- `di-tokens.js`
- `di.js`
- `error-codes.js`
- `error-handlers.js`
- `errors.js`
- `event-bus.js`
- `index.js`
- `interfaces.js`
- `mutex.js`
- `retry.js`
- `safe-json.js`
- `schemas.js`
- `shared-state.js`
- `shutdown.js`
- `structured-message.js`
- `timer-registry.js`

**`security/`**:

- `url-validator.js`

### `db/`

- `index.js`
- `migrations.js`
- `sqlite.js`

### `event-handlers/`

- `catch-all.js`
- `compaction.js`
- `index.js`
- `interaction-events.js`
- `mcp-events.js`
- `mode-and-tools.js`
- `sdk-responses.js`
- `session-lifecycle.js`
- `streaming.js`
- `system-notifications.js`
- `token-budget.js`
- `tool-lifecycle.js`
- `usage.js`

### `events/`

**Raiz**:

- `agent-events.js`
- `create-emitter.js`
- `emitter-events.js`
- `hook-events.js`
- `hub-events.js`
- `index.js`
- `legacy-events.js`
- `nerv-events.js`
- `sdk-events.js`
- `service-events.js`
- `system-events.js`
- `terminal-events.js`

**`middleware/`**:

- `correlation-enricher.js`
- `index.js`
- `rate-limiter.js`
- `schema-validator.js`
- `timestamp-enricher.js`

**`schemas/`**:

- `builtin-schemas.js`
- `index.js`
- `registry.js`

### `hooks/`

**Raiz**:

- `audit-trail.js`
- `bus.js`
- `composer.js`
- `di-tokens.js`
- `error-handler.js`
- `factory.js`
- `index.js`
- `logger.js`
- `permission-controller.js`
- `permission-handler.js`
- `prompt-transformer.js`
- `registry.js`
- `session-hooks.js`
- `tool-filter.js`
- `tool-interceptor.js`
- `types.js`
- `user-input.js`

**`presets/`**:

- `audit.js`
- `deny-all.js`
- `index.js`
- `interactive.js`
- `minimal.js`
- `production.js`
- `profiles.js`
- `safe.js`

### `infra/`

**Raiz**:

- `di-tokens.js`
- `index.js`
- `lockfile.js`
- `queue.js`
- `sdk-session-registry.js`
- `storage.js`
- `webhooks.js`

**`sse/`**:

- `fanout.js`
- `index.js`
- `replay-buffer.js`
- `state.js`
- `utils.js`

### `observability/`

**Raiz**:

- `agent-event-observer.js`
- `bootstrap.js`
- `di-tokens.js`
- `error-alerting.js`
- `error-tracker.js`
- `event-bus-observers.js`
- `event-catalog.js`
- `event-collector.js`
- `index.js`
- `logger.js`
- `metrics-histogram.js`
- `metrics.js`
- `otel.js`
- `snapshots.js`
- `tool-stats.js`

**`bus-actions/`**:

- `activity-tracker.js`
- `correlation-tracer.js`
- `error-alerter.js`
- `health-updater.js`
- `index.js`
- `log-observer.js`
- `metrics-collector.js`

**`collectors/`**:

- `assistant-handlers.js`
- `context.js`
- `index.js`
- `interaction-handlers.js`
- `session-handlers.js`
- `tool-handlers.js`

**`observers/`**:

- `context.js`
- `dialog-task-handlers.js`
- `event-name-map.js`
- `index.js`
- `session-agent-handlers.js`

### `plugins/`

- `di-tokens.js`
- `index.js`
- `plugin-registry.js`

### `presentation/`

- `agent-control.js`
- `agent-http-errors.js`
- `conversation-hub.js`
- `realtime.js`
- `sdk-sessions.js`
- `system-config.js`
- `system-metrics.js`

### `sdk/`

**Raiz**:

- `config.js`
- `constants.js`
- `di-tokens.js`
- `event-helpers.js`
- `feature-flags.js`
- `http-request.js`
- `index.js`
- `logger.js`
- `rpc.js`
- `types.js`
- `utils.js`

**`agent/`**:

- `agents.js`

**`models/`**:

- `helpers.js`
- `index.js`
- `known-models.js`
- `registry.js`
- `selector.js`
- `stats-tracker.js`

**`rpc/`**:

- `experimental.js`
- `ops.js`
- `server.js`
- `session.js`

**`session/`**:

- `client-events.js`
- `client-facade.js`
- `client.js`
- `events.js`
- `lifecycle.js`
- `permissions.js`
- `provider.js`
- `system-message.js`
- `wrapper.js`

**`telemetry/`**:

- `health.js`
- `quota-monitor.js`
- `tracing.js`

**`tools/`**:

- `core.js`
- `custom.js`
- `registry.js`
- `state.js`

### `server/`

**Raiz**:

- `app.js`
- `handler-bridge.js`
- `index.js`
- `router.js`

**`middleware/`**:

- `auth.js`
- `cors.js`
- `error-handler.js`
- `rate-limiter-state.js`
- `rate-limiter.js`
- `request-id.js`
- `security-headers.js`
- `validate.js`

**`routes/`**:

- `agent-health.js`
- `agent.js`
- `config.js`
- `git.js`
- `health-modules.js`
- `health-registry.js`
- `health.js`
- `memory.js`
- `observability.js`
- `sessions.js`
- `sse.js`
- `webhooks.js`

**`routes/copilot-api/`**:

- `control.js`
- `dialog.js`
- `index.js`
- `stream.js`
- `tasks.js`

**`routes/sdk/`**:

- `agent.js`
- `client.js`
- `hooks.js`
- `index.js`
- `middleware.js`
- `observability.js`
- `session-crud.js`
- `session-messaging.js`
- `session-middleware.js`
- `sessions.js`

**`socket/`**:

- `hub-ns.js`
- `index.js`

### `terminal/`

**Raiz**:

- `alias-store.js`
- `bootstrap.js`
- `di-wiring.js`
- `dialog.js`
- `file-context.js`
- `index.js`
- `rate-limiter-state.js`
- `repl-listeners.js`
- `repl.js`
- `state.js`
- `terminal-agent-wiring.js`
- `workspace-context.js`

**`commands/`**:

- `alias.js`
- `attach.js`
- `audit.js`
- `config.js`
- `context.js`
- `diagnose.js`
- `display.js`
- `errors.js`
- `export.js`
- `gh.js`
- `git.js`
- `help.js`
- `index.js`
- `memory.js`
- `metrics.js`
- `plan.js`
- `resume.js`
- `search.js`
- `session.js`
- `skills.js`
- `thinking.js`
- `tools.js`
- `usage.js`

**`dialog/`**:

- `engine-persistence.js`
- `engine.js`
- `index.js`
- `output.js`
- `sse.js`
- `turn-display.js`

**`frontend/`**:

- `index.js`
- `llm-b-frontend.js`
- `llm-b-runtime.js`

**`handlers/`**:

- `agent.js`
- `dialog.js`
- `index.js`
- `shared.js`
- `system-config.js`
- `system-metrics.js`

### `tools/`

**Raiz**:

- `bootstrap.js`
- `code-tools.js`
- `di-tokens.js`
- `experimental-rpc-tools.js`
- `hook-tools.js`
- `hub-tools.js`
- `index.js`
- `introspection-tools.js`
- `logger.js`
- `metrics-proxy.js`
- `permission-tools.js`
- `session-rpc-tools.js`
- `session-tools.js`
- `task-tools.js`
- `tool-factory.js`
- `web-tools.js`

**`file/`**:

- `index.js`
- `read-tools-io.js`
- `read-tools-search.js`
- `read-tools.js`
- `shared.js`
- `write-tools.js`

**`git/`**:

- `index.js`

**`shell/`**:

- `executor.js`
- `index.js`
- `sandbox.js`

**`todo/`**:

- `bulk-tools.js`
- `crud-tools.js`
- `index.js`
- `query-tools.js`
- `store.js`
- `todo-schema.js`
- `todo-write-tools.js`

### `types/`

**Raiz**:

- `index.js`

**`contracts/`**:

- `bridge-contract.js`
- `channel-contract.js`
- `contract.js`

## Leitura final do inventário

O inventário revela quatro fatos importantes:

1. `src/copilot` já tem massa crítica suficiente para ser tratado como **subplataforma interna**,
   não como “módulo auxiliar”.
2. Há módulos que já nasceram como **camadas** (`presentation`, `infra`, `event-handlers`),
   convivendo com módulos históricos mais “função-centristas”.
3. A árvore atual expõe bastante código de **compatibilidade/transição**, principalmente em
   `agent/`, `sdk/` e `terminal/`.
4. O sistema já possui peças suficientes para um endstate limpo — o problema é alinhá-las por
   ownership, não criar novos blocos arbitrários.
