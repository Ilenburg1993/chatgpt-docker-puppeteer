---
name: llm-b-route-operator
description: Diagnose, select, prove and promote LLM-B BYOK provider/model routes through the Model Gateway while preserving the current SDK session. Use when LLM-B has no response, a BYOK/provider/model route is unhealthy, a fallback is needed, a same-session switch is requested, or an operator asks for autonomous route recovery.
---

# LLM-B Route Operator

## Objective

Recover or improve the active LLM-B route with the least possible human intervention. Preserve the current SDK session, never expose secrets, and make a route change only from structured Model Gateway evidence.

Use `llm-b-comms` for terminal transport/health and `llm-b-ops` for workspace work. This skill owns only route selection and promotion.

## Operating Modes

Classify the request before mutating anything.

| Mode | Trigger | Allowed outcome |
| --- | --- | --- |
| Inspect | “what is wrong?”, unknown availability | Explain readiness and propose a route; do not probe or switch. |
| Recover | active route failed or no response | Select a proven fallback and attempt a same-session recovery when policy/approval permits. |
| Switch | explicit provider/model preference | Plan and apply that route only after it is eligible and proved. |
| Prepare | user wants resilience | Persist standby candidates; do not change the active route. |

Default to **Inspect**. Treat explicit “recover automatically”, an established automatic BYOK policy, or an approved tool invocation as authorization for **Recover**. Never create a new SDK session unless the user explicitly requests one.

## Mandatory Flow

1. Load this skill with `invoke_skill` when it is not already in context.
2. Call `model_gateway_control_plane_guide` for a new or uncertain workflow, then call `model_gateway_overview`.
3. Call `model_gateway_workflow_plan` with the task profile and `includeRouteSwitchPlan=true`. Keep `requireRuntimeProof=true` unless the user explicitly accepts an unproved route.
4. Read the returned selected route, blockers, proof status and exact step arguments. Do not invent provider ids, model ids, base URLs, headers, or a route object.
5. For a route without accepted runtime proof, run `model_gateway_probe_execute` in `plan` first. Run `apply` only when the tool’s approval/policy permits it; a probe is disposable and must not switch the live session.
6. Call `model_gateway_route_switch` in `plan` using the selected route and a stable idempotency key. Apply only the plan’s route with `confirm=true`.
7. If apply reports `automaticContinuation.armed=true` or `deferred_until_turn_boundary`, stop route tool calls and finish the current turn. The terminal scheduler promotes the handoff at `assistant.turn_end`.
8. On the next turn, call `model_gateway_operation_status` and `model_gateway_overview`. Report success only for `committed` plus same-session route confirmation.

Use a compact single-tool-at-a-time sequence for mutable Model Gateway calls. Do not bury a route promotion between unrelated tools or ask_user calls.

## Selection Rules

- Prefer the workflow planner’s `selectedRoute` with runtime proof, then its ranked fallback candidates.
- Reject a candidate marked blocked, denied access, missing required environment, stale without an allowed refresh, or with a recent blocking probe failure.
- Prefer `prefer_runtime_proved` for normal recovery; use `require_runtime_proof` for guarded operation.
- Keep the existing route when it is healthy. A different model is not an upgrade merely because it appears in the catalog.
- Use `/byok auto standby profile:<profile>` or the returned standby command to prepare alternatives without activating them.
- State the active route, selected route, proof source, operation id and final state in the response. Never state secret values.

Read [references/route-protocol.md](references/route-protocol.md) for exact status handling, tool sequence and user-visible terminal commands.

## Guardrails

- Do not call `model_gateway_model_switch`, `model_gateway_route_switch`, `model_gateway_runtime_reconcile`, catalog refresh, or profile mutation in `apply` mode from a speculative diagnosis.
- Do not retry an unknown or failed apply with a new idempotency key. Read `model_gateway_operation_status` first.
- Do not claim success for `planned`, `confirmation_required`, `deferred_until_turn_boundary`, `accepted_for_turn_boundary`, or `restarting`.
- Do not weaken a blocked proof, force a provider, or bypass approval merely to make the terminal respond.
- Do not use a new session as fallback for a same-session failure. Surface the blocker and retain the existing session.
- After two failed candidate probes, stop automatic exploration, summarize the structured failures, and request only the missing authorization or credential action.

## Completion Criteria

For an inspection, return a concrete selected route or blocker with the next safe command. For recovery/switch, require all of:

- a structured route plan and eligibility evidence;
- a stable idempotency key and approved apply;
- operation status `committed`;
- the same SDK session id before and after the change;
- no hidden fallback or new-session handoff;
- a readable final status from `model_gateway_overview` or `/byok status`.

If any condition is absent, report the current state honestly and leave the current route intact.
