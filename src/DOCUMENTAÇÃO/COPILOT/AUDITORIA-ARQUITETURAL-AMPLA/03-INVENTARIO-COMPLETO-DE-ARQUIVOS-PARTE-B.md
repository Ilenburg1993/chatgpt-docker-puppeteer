# 03 — Inventário Completo de Arquivos (Parte B)

> Cobertura módulo a módulo de `infra` até `types`. Parte Anterior:
> /workspaces/chatgpt-docker-puppeteer/src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/02-INVENTARIO-COMPLETO-DE-ARQUIVOS-PARTE-A.md

## `infra/`

**Subpastas**

- `infra/sse`

**Arquivos**

- `infra/di-tokens.js`
- `infra/index.js`
- `infra/lockfile.js`
- `infra/queue.js`
- `infra/sdk-session-registry.js`
- `infra/sse/fanout.js`
- `infra/sse/index.js`
- `infra/sse/replay-buffer.js`
- `infra/sse/state.js`
- `infra/sse/stream-hub.js`
- `infra/sse/utils.js`
- `infra/storage.js`
- `infra/webhooks.js`

## `logs/`

**Subpastas**

- _(sem subpastas)_

**Arquivos**

- `logs/agent.log`
- `logs/audit.jsonl`
- `logs/copilot_agent_2026-04-07T05-04-52-099Z.bak.log`
- `logs/copilot_agent_2026-04-07T15-39-27-346Z.bak.log`
- `logs/copilot_agent_2026-04-09T16-34-44-540Z.bak.log`
- `logs/copilot_agent_2026-04-10T03-23-11-201Z.bak.log`
- `logs/copilot_agent_2026-04-10T06-39-35-911Z.bak.log`
- `logs/events.jsonl`
- `logs/metrics.jsonl`
- `logs/otel-traces.jsonl`
- `logs/tool-audit.jsonl`
- `logs/tool-execution-audit.jsonl`
- `logs/tool-permissions-audit.jsonl`

## `observability/`

**Subpastas**

- `observability/bus-actions`
- `observability/collectors`
- `observability/observers`

**Arquivos**

- `observability/README.md`
- `observability/agent-event-observer.js`
- `observability/bootstrap.js`
- `observability/bus-actions/activity-tracker.js`
- `observability/bus-actions/correlation-tracer.js`
- `observability/bus-actions/error-alerter.js`
- `observability/bus-actions/health-updater.js`
- `observability/bus-actions/index.js`
- `observability/bus-actions/log-observer.js`
- `observability/bus-actions/metrics-collector.js`
- `observability/collectors/assistant-handlers.js`
- `observability/collectors/context.js`
- `observability/collectors/index.js`
- `observability/collectors/interaction-handlers.js`
- `observability/collectors/session-handlers.js`
- `observability/collectors/tool-handlers.js`
- `observability/di-tokens.js`
- `observability/error-alerting.js`
- `observability/error-tracker.js`
- `observability/event-bus-runtime.js`
- `observability/event-catalog.js`
- `observability/event-collector.js`
- `observability/index.js`
- `observability/logger.js`
- `observability/metrics-histogram.js`
- `observability/metrics.js`
- `observability/observers/context.js`
- `observability/observers/dialog-task-handlers.js`
- `observability/observers/event-name-map.js`
- `observability/observers/index.js`
- `observability/observers/session-agent-handlers.js`
- `observability/otel.js`
- `observability/snapshots.js`
- `observability/tool-stats.js`

## `plugins/`

**Subpastas**

- _(sem subpastas)_

**Arquivos**

- `plugins/di-tokens.js`
- `plugins/index.js`
- `plugins/plugin-registry.js`

## `presentation/`

**Subpastas**

- _(sem subpastas)_

**Arquivos**

- `presentation/README.md`
- `presentation/agent-control.js`
- `presentation/agent-http-errors.js`
- `presentation/agent-runtime.js`
- `presentation/conversation-hub.js`
- `presentation/dialog-timeout-policy.js`
- `presentation/index.js`
- `presentation/realtime.js`
- `presentation/runtime-capabilities.js`
- `presentation/runtime-controls.js`
- `presentation/runtime-dialog.js`
- `presentation/runtime-file-context.js`
- `presentation/runtime-health.js`
- `presentation/runtime-models.js`
- `presentation/runtime-overview.js`
- `presentation/runtime-ownership.js`
- `presentation/runtime-request.js`
- `presentation/runtime-route-deps.js`
- `presentation/runtime-sdk-session.js`
- `presentation/runtime-status.js`
- `presentation/runtime-targeting.js`
- `presentation/runtime-todos.js`
- `presentation/runtime-tools.js`
- `presentation/runtime-ui-state-store.js`
- `presentation/runtime-ui-state.js`
- `presentation/runtime-webhooks.js`
- `presentation/sdk-sessions.js`
- `presentation/system-config.js`
- `presentation/system-metrics.js`
- `presentation/types.js`

## `sdk/`

**Subpastas**

- `sdk/agent`
- `sdk/models`
- `sdk/rpc`
- `sdk/session`
- `sdk/telemetry`
- `sdk/tools`

**Arquivos**

- `sdk/README.md`
- `sdk/agent/agents.js`
- `sdk/config.js`
- `sdk/constants.js`
- `sdk/di-tokens.js`
- `sdk/errors.js`
- `sdk/event-helpers.js`
- `sdk/feature-flags.js`
- `sdk/http-request.js`
- `sdk/index.js`
- `sdk/logger.js`
- `sdk/models/helpers.js`
- `sdk/models/index.js`
- `sdk/models/known-models.js`
- `sdk/models/registry.js`
- `sdk/models/selector.js`
- `sdk/models/stats-tracker.js`
- `sdk/persistent-paths.js`
- `sdk/rpc.js`
- `sdk/rpc/experimental.js`
- `sdk/rpc/ops.js`
- `sdk/rpc/server.js`
- `sdk/rpc/session.js`
- `sdk/session/client-events.js`
- `sdk/session/client-facade.js`
- `sdk/session/client-options.js`
- `sdk/session/client.js`
- `sdk/session/events.js`
- `sdk/session/lifecycle.js`
- `sdk/session/permissions.js`
- `sdk/session/provider.js`
- `sdk/session/system-message.js`
- `sdk/session/ui.js`
- `sdk/session/wrapper.js`
- `sdk/telemetry/health.js`
- `sdk/telemetry/operation-metrics.js`
- `sdk/telemetry/quota-monitor.js`
- `sdk/telemetry/tracing.js`
- `sdk/tools/core.js`
- `sdk/tools/custom.js`
- `sdk/tools/registry.js`
- `sdk/tools/state.js`
- `sdk/types.js`
- `sdk/utils.js`

## `server/`

**Subpastas**

- `server/middleware`
- `server/routes`
- `server/routes/copilot-api`
- `server/routes/sdk`
- `server/socket`
- `server/sse`

**Arquivos**

- `server/app.js`
- `server/index.js`
- `server/middleware/auth.js`
- `server/middleware/cors.js`
- `server/middleware/error-handler.js`
- `server/middleware/rate-limiter-state.js`
- `server/middleware/rate-limiter.js`
- `server/middleware/request-id.js`
- `server/middleware/security-headers.js`
- `server/middleware/validate.js`
- `server/router.js`
- `server/routes/agent-health.js`
- `server/routes/agent.js`
- `server/routes/config.js`
- `server/routes/copilot-api/control.js`
- `server/routes/copilot-api/dialog.js`
- `server/routes/copilot-api/index.js`
- `server/routes/copilot-api/stream.js`
- `server/routes/copilot-api/tasks.js`
- `server/routes/git.js`
- `server/routes/health-modules.js`
- `server/routes/health-registry.js`
- `server/routes/health.js`
- `server/routes/memory.js`
- `server/routes/observability.js`
- `server/routes/sdk/README.md`
- `server/routes/sdk/agent.js`
- `server/routes/sdk/client.js`
- `server/routes/sdk/deps.js`
- `server/routes/sdk/hooks.js`
- `server/routes/sdk/index.js`
- `server/routes/sdk/middleware.js`
- `server/routes/sdk/observability.js`
- `server/routes/sdk/session-crud.js`
- `server/routes/sdk/session-messaging.js`
- `server/routes/sdk/session-middleware.js`
- `server/routes/sdk/sessions.js`
- `server/routes/sessions.js`
- `server/routes/sse.js`
- `server/routes/webhooks.js`
- `server/socket/hub-ns.js`
- `server/socket/index.js`

## `terminal/`

**Subpastas**

- `terminal/commands`
- `terminal/dialog`
- `terminal/frontend`
- `terminal/handlers`

**Arquivos**

- `terminal/README.md`
- `terminal/activity-state.js`
- `terminal/agent-runtime-events.README.md`
- `terminal/agent-runtime-events.js`
- `terminal/agent-sse-fallback.js`
- `terminal/alias-store.js`
- `terminal/bootstrap.js`
- `terminal/commands/activity.js`
- `terminal/commands/alias.js`
- `terminal/commands/attach.js`
- `terminal/commands/audit.js`
- `terminal/commands/config.js`
- `terminal/commands/context.js`
- `terminal/commands/diagnose.js`
- `terminal/commands/display.js`
- `terminal/commands/errors.js`
- `terminal/commands/export.js`
- `terminal/commands/gh.js`
- `terminal/commands/git.js`
- `terminal/commands/help.js`
- `terminal/commands/index.js`
- `terminal/commands/memory.js`
- `terminal/commands/metrics.js`
- `terminal/commands/plan.js`
- `terminal/commands/resume.js`
- `terminal/commands/runtime-target.js`
- `terminal/commands/sdk.js`
- `terminal/commands/search.js`
- `terminal/commands/session.js`
- `terminal/commands/skills.js`
- `terminal/commands/thinking.js`
- `terminal/commands/tools.js`
- `terminal/commands/usage.js`
- `terminal/dialog/README.md`
- `terminal/dialog/engine-persistence.js`
- `terminal/dialog/engine.js`
- `terminal/dialog/index.js`
- `terminal/dialog/output.js`
- `terminal/dialog/sse.js`
- `terminal/dialog/turn-display.js`
- `terminal/frontend/README.md`
- `terminal/frontend/index.js`
- `terminal/frontend/llm-b-frontend.js`
- `terminal/frontend/llm-b-runtime.js`
- `terminal/frontend/sdk-session-projection.js`
- `terminal/handlers/agent.js`
- `terminal/handlers/dialog.js`
- `terminal/handlers/index.js`
- `terminal/handlers/shared.js`
- `terminal/handlers/system-config.js`
- `terminal/handlers/system-metrics.js`
- `terminal/index.js`
- `terminal/rate-limiter-state.js`
- `terminal/repl-listeners.js`
- `terminal/repl.js`
- `terminal/sdk-interactions.js`
- `terminal/sdk-session-events.js`
- `terminal/task-stream-events.js`
- `terminal/terminal-agent-wiring.js`

## `tools/`

**Subpastas**

- `tools/file`
- `tools/git`
- `tools/shell`
- `tools/todo`

**Arquivos**

- `tools/README.md`
- `tools/bootstrap.js`
- `tools/code-tools.js`
- `tools/di-tokens.js`
- `tools/experimental-rpc-tools.js`
- `tools/file/index.js`
- `tools/file/read-tools-io.js`
- `tools/file/read-tools-search.js`
- `tools/file/read-tools.js`
- `tools/file/shared.js`
- `tools/file/symbol-search-tool.js`
- `tools/file/write-tools.js`
- `tools/git/index.js`
- `tools/hook-tools.js`
- `tools/hub-tools.js`
- `tools/index.js`
- `tools/introspection-tools.js`
- `tools/logger.js`
- `tools/metrics-proxy.js`
- `tools/permission-tools.js`
- `tools/session-rpc-tools.js`
- `tools/session-tools.js`
- `tools/shell/executor.js`
- `tools/shell/index.js`
- `tools/shell/sandbox.js`
- `tools/task-tools.js`
- `tools/todo/bulk-tools.js`
- `tools/todo/crud-tools.js`
- `tools/todo/index.js`
- `tools/todo/query-tools.js`
- `tools/todo/store.js`
- `tools/todo/todo-schema.js`
- `tools/todo/todo-write-tools.js`
- `tools/tool-factory.js`
- `tools/web-tools.js`

## `types/`

**Subpastas**

- `types/contracts`

**Arquivos**

- `types/README.md`
- `types/contracts/bridge-contract.js`
- `types/contracts/channel-contract.js`
- `types/contracts/contract.js`
- `types/index.js`
