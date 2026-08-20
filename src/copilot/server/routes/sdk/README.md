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
- configuration: `systemMessage`, `infiniteSessions`, `provider`, `reasoningEffort`,
  `modelCapabilities`, `configDir`, `enableConfigDiscovery`, `includeSubAgentStreamingEvents`,
  `mcpServers`, `customAgents`, `defaultAgent`, selected `agent`, `skillDirectories`,
  `disabledSkills`, `gitHubToken`, `availableTools`, `excludedTools`;
- session methods: `setModel(model, { reasoningEffort })` and `session.log()`.

Function-valued SDK capabilities (`tools[].handler`, `onPermissionRequest`, `onUserInputRequest`,
`hooks`, `onEvent`, trace context callbacks) remain process-local capabilities. They enter through
`deps.js`, hooks, tools registry or agent ports, not through JSON request bodies.

## Public Response Contracts

All public JSON responses that can aggregate SDK, provider, hook, audit or observability payloads
must include runtime route metadata when a route is runtime-aware:

- `runtimeId`: resolved runtime serving the request;
- `requestedRuntimeId`: runtime requested by the caller before fallback;
- `runtimeFound`: whether the requested runtime exists;
- `usedDefaultRuntimeFallback`: whether the default runtime served the response.

Public responses must also apply boundary redaction before `res.json` whenever a payload can contain
provider credentials, request headers, tool arguments, audit entries or arbitrary metadata.
Redaction is defense in depth; producers should still sanitize at write time.

### Payload Classification

Each route must classify its payload before returning it:

- Intentional content may remain raw: chat messages, explicit workspace file content, shell/tool/RPC
  command output and UI answers are the content the caller requested.
- Diagnostic metadata must be redacted: model/session metadata, hook events, observability entries,
  audit/log/error payloads, route error messages, convergence reasons and provider/BYOK records.
- Mixed payloads must redact only the diagnostic shell around intentional content. For example,
  workspace read returns raw `content`, while `INVALID_LOCAL_PATH` messages and convergence `reason`
  fields are redacted.

When a route is ambiguous, prefer a small helper at the route boundary and a focused test proving
that token-like values do not appear in the serialized response. Do not invent “effective”
model/reasoning fields unless the SDK or runtime exposes a trustworthy source of truth.

### `GET /models`

`/models` is the HTTP view of `client.listModels()`. In this application, `client.listModels()` is
the canonical SDK 1.0 model catalog seam and may be backed by `CopilotClientOptions.onListModels`
from the model-gateway/BYOK importer.

The route returns:

- `ok`, `count`, `models` and runtime metadata;
- official SDK model fields such as `id`, `name`, `defaultReasoningEffort` and
  `supportedReasoningEfforts`;
- local extension metadata when present, such as `byok.provider`, `byok.providerModel`,
  `byok.routeLayer`, `byok.wireApi`, `supportedReasoningSummaries` and `supportedContextTiers`.

The route must not leak provider secrets. `apiKey`, `Authorization`, `headers` and matching token
strings are redacted at the HTTP boundary even if the model-gateway already sanitized the source
record. Ollama/local metadata may be exposed only as operational metadata (`local_daemon`,
`openai_compatible`, local/private flags), never as credentials.

## Current Hotspots

- `session-messaging.js`: now only composes route families. Core behavior lives in
  `session-core-routes.js`; workspace, UI and RPC helpers live in dedicated family modules.
- `session-core-routes.js`: still combines send, stream, model/log/abort/messages; keep it under
  watch and split send/stream if it grows.
- `session-crud.js`: split by inventory/foreground, create/resume and destructive operations.
- `observability.js`: split by health/metrics, errors/logs, audit and event catalog.
- `agent.js` and `client.js`: split SSE/control helpers from pure HTTP route registration.
- `session-middleware.js`: schemas already live in `session-schemas.js`; keep future growth focused
  on middleware helpers only.
