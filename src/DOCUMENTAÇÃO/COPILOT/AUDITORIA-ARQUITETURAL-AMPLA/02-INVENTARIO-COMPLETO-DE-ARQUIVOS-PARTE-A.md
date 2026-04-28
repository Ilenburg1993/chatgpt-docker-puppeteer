# 02 — Inventário Completo de Arquivos (Parte A)

> Cobertura módulo a módulo de `.github` até `hooks`. Continua:
> /workspaces/chatgpt-docker-puppeteer/src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/03-INVENTARIO-COMPLETO-DE-ARQUIVOS-PARTE-B.md

## `.github/`

**Subpastas**

- `.github/hooks`
- `.github/hooks/state`
- `.github/hooks/state/snapshots`

**Arquivos**

- `.github/hooks/state/sdk-always-alive.json`
- `.github/hooks/state/snapshots/snap-1775558321141-efx8sl.json`
- `.github/hooks/state/snapshots/snap-1775802062001-9duow1.json`
- `.github/hooks/state/snapshots/snap-1775802093455-1l151n.json`
- `.github/hooks/state/snapshots/snap-1776034630747-405b8615.json`
- `.github/hooks/state/snapshots/snap-1776034716017-7a684530.json`
- `.github/hooks/state/snapshots/snap-1776038328295-217217d3.json`

## `agent/`

**Subpastas**

- `agent/dialog`
- `agent/facades`
- `agent/infra`
- `agent/lifecycle`
- `agent/messaging`
- `agent/ports`
- `agent/session`
- `agent/state`

**Arquivos**

- `agent/README.md`
- `agent/agent-context.js`
- `agent/always-alive.js`
- `agent/background-tasks.js`
- `agent/context-factories.js`
- `agent/di-tokens.js`
- `agent/dialog/agent-dialog-controller.js`
- `agent/dialog/backpressure.js`
- `agent/dialog/compaction-policy.js`
- `agent/dialog/cost-ledger.js`
- `agent/dialog/event-wiring.js`
- `agent/dialog/index.js`
- `agent/dialog/loop-manager.js`
- `agent/dialog/model-fallback.js`
- `agent/dialog/pending-question-shadow.js`
- `agent/dialog/resume-policy.js`
- `agent/dialog/state-machine.js`
- `agent/dialog/turn-executor.js`
- `agent/dialog/user-input-handler.js`
- `agent/dialog/watchdog-supervisor.js`
- `agent/dialog/watchdog.js`
- `agent/error-policy.js`
- `agent/event-bridge-map.js`
- `agent/event-bridge-wiring.js`
- `agent/facades/README.md`
- `agent/facades/agent-dialog-runtime.js`
- `agent/facades/agent-model-config.js`
- `agent/facades/agent-runtime-capabilities.js`
- `agent/facades/agent-runtime-controls.js`
- `agent/facades/agent-runtime-ownership.js`
- `agent/facades/agent-runtime-status.js`
- `agent/facades/agent-runtime-todos.js`
- `agent/facades/agent-runtime-tools.js`
- `agent/facades/agent-runtime-webhooks.js`
- `agent/facades/agent-sdk-access.js`
- `agent/facades/agent-sdk-runtime.js`
- `agent/facades/agent-sdk-session.js`
- `agent/facades/agent-session-ops.js`
- `agent/facades/agent-webhook-ops.js`
- `agent/facades/index.js`
- `agent/health-check.js`
- `agent/index.js`
- `agent/infra/handoff-manager.js`
- `agent/infra/index.js`
- `agent/infra/message-queue.js`
- `agent/lifecycle/agent-lifecycle.js`
- `agent/lifecycle/entry.js`
- `agent/lifecycle/index.js`
- `agent/lifecycle/reconnect-policy.js`
- `agent/lifecycle/runtime-host.js`
- `agent/lifecycle/session-setup.js`
- `agent/lifecycle/state-io.js`
- `agent/messaging/agent-messaging.js`
- `agent/messaging/index.js`
- `agent/ports/conversation-port.js`
- `agent/ports/hook-port.js`
- `agent/ports/index.js`
- `agent/ports/mcp-port.js`
- `agent/ports/observability-port.js`
- `agent/ports/permission-port.js`
- `agent/ports/todo-port.js`
- `agent/ports/tool-port.js`
- `agent/runtime-contracts.js`
- `agent/runtime-registry.js`
- `agent/session/boot-steps.js`
- `agent/session/boot-wiring.js`
- `agent/session/cleanup.js`
- `agent/session/event-wirer.js`
- `agent/session/history-sync.js`
- `agent/session/hook-context.js`
- `agent/session/index.js`
- `agent/session/initializer.js`
- `agent/session/keepalive.js`
- `agent/session/ownership.js`
- `agent/session/rotation.js`
- `agent/session/snapshot.js`
- `agent/state/agent-state.js`
- `agent/state/index.js`
- `agent/types.js`

## `audit/`

**Subpastas**

- _(sem subpastas)_

**Arquivos**

- `audit/README.md`
- `audit/di-tokens.js`
- `audit/index.js`
- `audit/jsonl-writer.js`
- `audit/logger.js`
- `audit/pipeline-audit-log.js`
- `audit/pipeline-permission.js`
- `audit/pipeline-sdk-buffer.js`
- `audit/pipeline.js`
- `audit/ring-buffer.js`

## `boot/`

**Subpastas**

- _(sem subpastas)_

**Arquivos**

- `boot/README.md`
- `boot/config.js`
- `boot/contract.js`
- `boot/index.js`
- `boot/plan.js`
- `boot/skills.js`
- `boot/workspace.js`

## `bridges/`

**Subpastas**

- `bridges/gh`

**Arquivos**

- `bridges/README.md`
- `bridges/di-tokens.js`
- `bridges/gh/ci.js`
- `bridges/gh/index.js`
- `bridges/gh/issues.js`
- `bridges/gh/prs.js`
- `bridges/gh/shared.js`
- `bridges/git-bridge-read.js`
- `bridges/git-bridge-write.js`
- `bridges/git-bridge.js`
- `bridges/index.js`
- `bridges/mcp-tool-bridge.js`
- `bridges/mcp-tool-schema.js`
- `bridges/nerv-event-bus-adapter.js`

## `channel/`

**Subpastas**

- _(sem subpastas)_

**Arquivos**

- `channel/README.md`
- `channel/client-dialog.js`
- `channel/client-history.js`
- `channel/client-structured.js`
- `channel/client.js`
- `channel/di-tokens.js`
- `channel/index.js`
- `channel/inject.js`
- `channel/sse-client.js`

## `config/`

**Subpastas**

- `config/system-prompt`
- `config/system-prompt/sdk-defaults`
- `config/system-prompt/sections`

**Arquivos**

- `config/README.md`
- `config/agent.js`
- `config/auth.js`
- `config/client-options.js`
- `config/custom-agents.js`
- `config/declarative-runtime-config.js`
- `config/env.js`
- `config/index.js`
- `config/mcp-servers.js`
- `config/persistent-paths.js`
- `config/pinned-files.js`
- `config/sdk-config-port.js`
- `config/session-config.js`
- `config/system-prompt/index.js`
- `config/system-prompt/mode.js`
- `config/system-prompt/sdk-defaults/README.md`
- `config/system-prompt/sdk-defaults/capture.js`
- `config/system-prompt/sdk-defaults/captured-2026-04-14.json`
- `config/system-prompt/sdk-defaults/snapshot.js`
- `config/system-prompt/sections/code-change-rules.js`
- `config/system-prompt/sections/custom-instructions.js`
- `config/system-prompt/sections/environment-context.js`
- `config/system-prompt/sections/guidelines.js`
- `config/system-prompt/sections/identity.js`
- `config/system-prompt/sections/last-instructions.js`
- `config/system-prompt/sections/safety.js`
- `config/system-prompt/sections/tone.js`
- `config/system-prompt/sections/tool-efficiency.js`
- `config/system-prompt/sections/tool-instructions.js`

## `conversation-hub/`

**Subpastas**

- _(sem subpastas)_

**Arquivos**

- `conversation-hub/README.md`
- `conversation-hub/access.js`
- `conversation-hub/broadcast.js`
- `conversation-hub/call-strategies.js`
- `conversation-hub/di-tokens.js`
- `conversation-hub/hub.js`
- `conversation-hub/index.js`
- `conversation-hub/orchestrator.js`
- `conversation-hub/send-pipeline.js`
- `conversation-hub/store-helpers.js`
- `conversation-hub/store-memories.js`
- `conversation-hub/store-queries.js`
- `conversation-hub/store-sync.js`
- `conversation-hub/store.js`

## `core/`

**Subpastas**

- `core/security`

**Arquivos**

- `core/README.md`
- `core/cache.js`
- `core/circuit-breaker.js`
- `core/di-container.js`
- `core/di-tokens.js`
- `core/di.js`
- `core/error-codes.js`
- `core/error-handlers.js`
- `core/errors.js`
- `core/event-bus.js`
- `core/index.js`
- `core/interfaces.js`
- `core/mutex.js`
- `core/retry.js`
- `core/safe-json.js`
- `core/schemas.js`
- `core/security/url-validator.js`
- `core/shared-state.js`
- `core/shutdown.js`
- `core/structured-message.js`
- `core/timer-registry.js`

## `db/`

**Subpastas**

- _(sem subpastas)_

**Arquivos**

- `db/README.md`
- `db/index.js`
- `db/migrations.js`
- `db/sqlite.js`

## `dialog/`

**Subpastas**

- _(sem subpastas)_

**Arquivos**

- `dialog/index.js`
- `dialog/protocol.js`

## `event-handlers/`

**Subpastas**

- _(sem subpastas)_

**Arquivos**

- `event-handlers/README.md`
- `event-handlers/catch-all.js`
- `event-handlers/compaction.js`
- `event-handlers/index.js`
- `event-handlers/interaction-events.js`
- `event-handlers/mcp-events.js`
- `event-handlers/mode-and-tools.js`
- `event-handlers/sdk-responses.js`
- `event-handlers/session-lifecycle.js`
- `event-handlers/streaming.js`
- `event-handlers/system-notifications.js`
- `event-handlers/token-budget.js`
- `event-handlers/tool-lifecycle.js`
- `event-handlers/usage.js`

## `events/`

**Subpastas**

- `events/middleware`
- `events/schemas`

**Arquivos**

- `events/agent-events.js`
- `events/base-events.js`
- `events/catalog.md`
- `events/emitter-events.js`
- `events/hook-events.js`
- `events/hub-events.js`
- `events/index.js`
- `events/local-emitter.js`
- `events/middleware/correlation-enricher.js`
- `events/middleware/index.js`
- `events/middleware/rate-limiter.js`
- `events/middleware/schema-validator.js`
- `events/middleware/timestamp-enricher.js`
- `events/nerv-events.js`
- `events/schemas/builtin-schemas.js`
- `events/schemas/index.js`
- `events/schemas/registry.js`
- `events/sdk-events.js`
- `events/service-events.js`
- `events/system-events.js`
- `events/terminal-events.js`

## `hooks/`

**Subpastas**

- `hooks/presets`

**Arquivos**

- `hooks/README.md`
- `hooks/audit-trail.js`
- `hooks/bus.js`
- `hooks/composer.js`
- `hooks/di-tokens.js`
- `hooks/elicitation.js`
- `hooks/error-handler.js`
- `hooks/factory.js`
- `hooks/index.js`
- `hooks/logger.js`
- `hooks/permission-controller.js`
- `hooks/permission-handler.js`
- `hooks/presets/audit.js`
- `hooks/presets/deny-all.js`
- `hooks/presets/index.js`
- `hooks/presets/interactive.js`
- `hooks/presets/minimal.js`
- `hooks/presets/production.js`
- `hooks/presets/profiles.js`
- `hooks/presets/safe.js`
- `hooks/prompt-transformer.js`
- `hooks/registry.js`
- `hooks/session-hooks.js`
- `hooks/tool-filter.js`
- `hooks/tool-interceptor.js`
- `hooks/types.js`
- `hooks/user-input.js`
