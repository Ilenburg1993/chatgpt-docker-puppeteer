# SDK HTTP Adapter Boundary

`server/routes/sdk/` is the HTTP/SSE adapter for SDK-facing operations. It is not a runtime, not an
agent host, and not a second presentation layer.

Use `../module-map.js` as the executable inventory for this directory. The map marks oversized route
files as `risk: 'hotspot'` so physical decomposition can happen in a controlled order without
changing public endpoints.

## Hard Rules

- `deps.js` is the only composition root in this directory.
- Route handlers receive SDK, agent, tools, hooks, audit, bridges, config and presentation
  capabilities through `deps.js`.
- Route handlers may validate HTTP input, apply rate limits, open SSE streams and serialize
  responses.
- Route handlers must not import `#copilot/sdk`, `#copilot/agent`, `#copilot/tools`,
  `#copilot/hooks`, `#copilot/bridges`, `#copilot/audit`, `#copilot/config` or `presentation/`
  directly.
- Local middleware may use cross-cutting error/log helpers, but not domain state.

## Vocabulary

- SDK client: the live SDK/CLI communication client.
- SDK session: a persisted SDK conversation identified by `sessionId`.
- Agent: the runtime authority after the SDK.
- Runtime: a live agent instance addressed by `runtimeId`.
- Multi-runtime: more than one live runtime instance.
- Multi-agent: more than one agent policy/persona/capability set.

The global architecture gate enforces this with `sdk-routes-must-compose-through-deps`.

## SDK Vanilla Coverage

The HTTP adapter must expose every JSON-serializable SDK capability that can cross an HTTP boundary
without inventing local semantics:

- client control: `start`, `stop`, `forceStop`, `ping`, `status`, `auth`, `models`;
- session inventory: `listSessions`, `getLastSessionId`, `deleteSession`, foreground get/set;
- session lifecycle: create, resume, disconnect, abort, messages and SSE event stream;
- messaging: `send`, `sendAndWait`, delivery `mode`, file/directory/selection/blob attachments;
- configuration: `systemMessage`, `infiniteSessions`, `provider`, `reasoningEffort`, `configDir`,
  `mcpServers`, `customAgents`, selected `agent`, `skillDirectories`, `disabledSkills`,
  `availableTools`, `excludedTools`;
- session methods: `setModel(model, { reasoningEffort })` and `session.log()`.

Function-valued SDK capabilities (`tools[].handler`, `onPermissionRequest`, `onUserInputRequest`,
`hooks`, `onEvent`, trace context callbacks) remain process-local capabilities. They enter through
`deps.js`, hooks, tools registry or agent ports, not through JSON request bodies.

## Current Hotspots

- `session-messaging.js`: split by messaging, stream, workspace, UI/permissions/tools, compaction
  and shell. Route metadata, send helpers, stream state and workspace path validation already live
  in dedicated helper modules.
- `session-crud.js`: split by inventory/foreground, create/resume and destructive operations.
- `observability.js`: split by health/metrics, errors/logs, audit and event catalog.
- `agent.js` and `client.js`: split SSE/control helpers from pure HTTP route registration.
- `session-middleware.js`: schemas already live in `session-schemas.js`; keep future growth focused
  on middleware helpers only.
