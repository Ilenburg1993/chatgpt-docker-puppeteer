# Route Protocol Reference

## Canonical selection sequence

Use `terminal:llm-b` plus Model Gateway as one control plane. Normal best-route operation is **rank → prove → re-rank → promote**, never “switch then discover whether it works”.

1. `model_gateway_overview({ runtimeId: null, maxSnapshotAgeHours: 24, operationLimit: 10 })` when state is not already known.
2. `model_gateway_workflow_plan(...)` with the task profile and explicit decision policy. For repo work with unconstrained LLM usage:

```json
{
  "objective": "same_session_route_switch",
  "taskProfile": "repo_agent",
  "runtimeId": null,
  "providerId": null,
  "candidateModelIds": [],
  "preferredProbeKinds": ["agent"],
  "maxSnapshotAgeHours": 24,
  "maxCandidates": 8,
  "maxProbeCount": 1,
  "maxEstimatedCostUsd": 10,
  "idempotencyKeyPrefix": "llmb-route-<stable-operation-id>",
  "includeCatalogRefreshPlan": false,
  "includeRouteSwitchPlan": true,
  "requireRuntimeProof": true,
  "selectionGoal": "quality_first",
  "probeStrategy": "aggressive",
  "maxRuntimeProofAgeHours": 24
}
```

3. Read `data.selectionDecision` before reading the long plan.
4. If `status=probe_required`, execute only the **current top candidate** exposed by the returned `model_gateway_probe_execute` plan/apply steps. After that single success or failure, call `model_gateway_workflow_plan` again before touching candidate #2.
5. Only the freshly recalculated post-probe workflow may choose the next probe or serve as authority for route promotion.

The `agent` probe is the preferred `repo_agent`/`tool_agent` certificate. It exercises actual model generation, tool calling, a synthetic canonical file-read tool, `ask_user`, streaming/final assistant events and a disposable SDK session. `chat`, `json`, `vision` or `streaming` probes can be added when they test a capability the task actually needs.

## Direct route inspection

Use two route plans when debugging selection itself:

```text
model_gateway_route_plan(... selectionGoal="quality_first", proofPolicy="metadata_only", maxRuntimeProofAgeHours=24)
model_gateway_route_plan(... selectionGoal="quality_first", proofPolicy="fresh_runtime_required", maxRuntimeProofAgeHours=24)
```

The first is the **discovery ranking**. The second is the **proved ranking**. A model present only in discovery is a probe candidate, not a promotion target.

`quality_first` intentionally disables the generic price penalty. Use `balanced`, `latency_first` or `cost_first` only when those tradeoffs are actually desired.

## Adaptive probe protocol

For each ranked candidate returned by the workflow:

1. Execute its `model_gateway_probe_execute` step with `mode=plan`.
2. If the plan authorizes the exact candidate/probe, apply with `confirm=true` and the same idempotency key.
3. After **every** probe result, rerun `model_gateway_workflow_plan` before any next probe or switch. The result changed runtime health, so the old ranking must not drive another action.
4. On success, stop using the old plan; the rerun determines whether that candidate is now the best freshly proved route or whether a better discovery candidate still needs proof.
5. On objective failure, retain the recorded failure; the rerun should surface the new top candidate, which can be probed automatically without asking the user.
6. A recent failure may block during cooldown. An old failure is historical risk and may be re-probed. A positive proof older than the configured proof horizon is stale and must not count as current proof.

Do not ask the user whether to continue from candidate #1 to #2 when the failure is objective. Recalculate and continue with the new top-ranked candidate.

## Promotion sequence

Once a rerun returns `selectionDecision.status=switch_recommended`:

1. Use the exact `selectedRoute` returned by that post-proof workflow.
2. `model_gateway_route_switch({ mode: "plan", route: <selectedRoute>, runtimeId: null, timeoutMs: 60000, confirm: false, idempotencyKey: "<stable-key>" })`.
3. After normal approval, reuse the exact key in `mode=apply, confirm=true`.
4. If the result is deferred to `dialog.turn_end`, stop route tools and finish the current turn.
5. On the following turn call `model_gateway_operation_status` and `model_gateway_overview`.
6. Report success only when the operation is `committed` and same-session continuity is observed.

A model-only switch is appropriate only when provider/binding does not change. Cross-provider changes belong to `model_gateway_route_switch`.

## State table

| State | Meaning | Action |
| --- | --- | --- |
| `planned_use_current` / `use_current` | Current route already satisfies the best fresh proof contract | Continue; no mutation. |
| `planned_probe_required` / `probe_required` | Best discovery candidate lacks accepted fresh proof | Execute adaptive probe chain; rerun workflow after first success. |
| `planned_switch_recommended` / `switch_recommended` | Better freshly proved route exists | Review and apply same-session route switch. |
| `planned` | Read-only proposal without a stronger state | Inspect `selectionDecision`; do not claim a change. |
| `confirmation_required` | Mutable action awaits approval | Obtain normal approval and reuse the idempotency key. |
| `deferred_until_turn_boundary` | Apply accepted during a tool turn | End turn; let scheduler promote. |
| `committed` | Reattach and route confirmation completed | Verify session id + overview; report success. |
| `failed` / `blocked` / `expired` | Action did not complete | Preserve session, read evidence, continue ranked recovery if possible. |

## Human cockpit

The human should be able to observe the same facts without being required for routine autonomous selection:

```text
/byok status
/byok health
/byok models refresh provider:<provider>
/byok models route repo_agent active --show-rejected
/byok gateway operator-ready profile:repo_agent
/byok auto status profile:repo_agent
/byok auto standby profile:repo_agent 12
```

Positive health older than the proof horizon should be rendered as `histórico/stale`, not `ok`. A current authoritative provider catalog that no longer contains the configured model is strong negative availability evidence.

## Failure language

Report only observed facts: active route, discovery winner, proved winner, proof age/kind, failed stage, classified provider failure, operation id and next safe action. Distinguish catalog absence, stale proof, current runtime failure, account/credits failure, rate limit, environment absence, policy denial and pending turn-boundary promotion.

Never expose a credential value, authorization header or raw provider payload that may contain a secret.
