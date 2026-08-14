# Route Protocol Reference

## Read-only first

Use these calls before any promotion:

1. `model_gateway_control_plane_guide({ objective: "same_session_switch", includeTerminalCommands: true, includeApplyExamples: true })` when the route workflow is unclear.
2. `model_gateway_overview({ runtimeId: null, maxSnapshotAgeHours: 720, operationLimit: 10 })`.
3. `model_gateway_workflow_plan({ objective: "same_session_route_switch", taskProfile: "repo_agent", runtimeId: null, providerId: null, candidateModelIds: [], preferredProbeKinds: ["live_tool_protocol", "live_ask_user"], maxSnapshotAgeHours: 720, maxCandidates: 5, maxProbeCount: 2, maxEstimatedCostUsd: 0, includeCatalogRefreshPlan: false, includeRouteSwitchPlan: true, requireRuntimeProof: true })`.

Use the plan output as the authority for profile, candidate and route fields. An absent selected route is a blocker, not a prompt to construct a route manually.

## Promotion sequence

For the selected candidate, use the exact arguments from the plan.

1. `model_gateway_probe_execute({ mode: "plan", ..., confirm: false, idempotencyKey: "<stable-workflow-key>:probe" })`.
2. After approval, `model_gateway_probe_execute({ mode: "apply", ..., confirm: true, idempotencyKey: "<same-key>:probe" })` only when proof is needed.
3. `model_gateway_route_switch({ mode: "plan", route: <selectedRoute>, runtimeId: null, timeoutMs: 60000, confirm: false, idempotencyKey: "<stable-workflow-key>:route-switch" })`.
4. After approval, reuse the exact idempotency key for `model_gateway_route_switch({ mode: "apply", route: <selectedRoute>, runtimeId: null, timeoutMs: 60000, confirm: true, idempotencyKey: "<stable-workflow-key>:route-switch" })`.
5. If deferred, end the turn. On the following turn inspect `model_gateway_operation_status({ operationId: <operationId>, limit: 10 })` and `model_gateway_overview`.

Use one mutable tool call per assistant response. Do not send `ask_user` between route apply and the scheduler’s turn boundary.

## State table

| State | Meaning | Action |
| --- | --- | --- |
| `planned` | Read-only proposal | Review route/proofs; do not claim a change. |
| `confirmation_required` | Mutable action awaits approval | Request/obtain normal tool approval, then reuse the key. |
| `deferred_until_turn_boundary` | Apply accepted during a tool turn | End the turn; let the scheduler promote it. |
| `committed` | Reattach and route confirmation completed | Verify session id and overview, then report success. |
| `failed` / `blocked` / `expired` | Promotion did not complete | Read status, preserve the route, and select another candidate only if policy permits. |

## Terminal commands for operators

Keep these available for a human without requiring them for normal autonomous recovery:

```text
/byok status
/byok health
/byok gateway operator-ready profile:repo_agent
/byok auto status profile:repo_agent
/byok auto standby profile:repo_agent 12
/byok auto on profile:repo_agent preset:auto_same_session_route
/byok auto on profile:repo_agent preset:llm_operator_guarded
```

The `auto_same_session_route` preset permits same-session live route setting but not a new session. The guarded preset requires runtime proof and keeps live set-model disabled. Use the least permissive preset that satisfies the request.

## Failure language

Report only observed facts: active route, failed stage, candidate rejection reason, operation id and next safe action. Distinguish provider failure from catalog staleness, environment absence, policy denial, pending turn-boundary promotion and tool approval. Never report a credential value, an authorization header, or a raw provider response that might contain one.
