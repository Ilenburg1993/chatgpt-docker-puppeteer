---
name: llm-b-route-operator
description: Diagnose, rank, prove and promote LLM-B BYOK provider/model routes through terminal:llm-b and the Model Gateway while preserving the current SDK session. Use for normal best-route selection, stale or failed routes, provider/model comparison, adaptive probing, fallback, or same-session promotion.
user-invocable: true
---

# LLM-B Route Operator

## Mission

Treat `terminal:llm-b` as the canonical human/LLM cockpit for model selection. The goal is not merely to find an eligible model: select the **best model for the task that is demonstrably functional now**, explain why, and preserve the current SDK session when promoting it.

Use `llm-b-comms` for terminal transport/health and `llm-b-ops` for workspace work. This skill owns route/model selection, runtime proof and same-session promotion.

## The five states — never collapse them

A model can be:

1. **eligible** — credentials/policy/capabilities permit it;
2. **offered now** — the current provider/catalog actually exposes it;
3. **task-best** — it ranks highly for the present task and operator preferences;
4. **runtime-proved now** — required probes succeeded within the freshness window;
5. **session-ready** — the route can be bound/rebound to the live SDK session safely.

`eligible` or `task-best` is never equivalent to `runtime-proved`. A positive probe older than the configured freshness horizon is **historical/stale**, not current proof. An old failure outside cooldown is historical risk, not a permanent blacklist: re-probe it if it becomes competitive again.

## Default selection policy in this workspace

Unless the user explicitly asks to optimize cost or latency, use:

- `selectionGoal="quality_first"`;
- `requireRuntimeProof=true` for any promotion;
- `probeStrategy="aggressive"` when the best candidate is not freshly proved;
- `maxRuntimeProofAgeHours=24` unless the task needs a tighter window;
- `preferredProbeKinds=["agent"]` for `repo_agent` and `tool_agent`.

`quality_first` means price does not silently lower a model's ranking. Functionality, capability, confidence and task fit remain decisive. The operator has explicitly allowed extensive LLM-B/provider probing, so do not conserve calls at the expense of choosing a worse or unproved route.

For `repo_agent`, the disposable **agent probe** is the primary functional certificate: it exercises real model generation, tool calling, the canonical synthetic file-read tool, `ask_user`, streaming/final events and the temporary SDK-session path. Add `json`, `vision`, etc. only when the task actually needs those capabilities.

## Mandatory selection flow

1. Call `model_gateway_overview` when runtime/catalog state is not already known.
2. Call `model_gateway_workflow_plan` as the normal entry point. For best-route operation use `selectionGoal=quality_first`, `probeStrategy=aggressive`, `requireRuntimeProof=true`, and the task profile that matches the job.
3. Read **`selectionDecision` first**. It is the concise authority for the next action. The workflow is compact-first by default; request `includeDetailedEvidence=true` only when diagnosing a disagreement or blocker. Use `selectionDecision.operatorExplanation` as the default user-facing explanation instead of translating machine rationale codes yourself:
   - `use_current` — current route is already the best freshly proved route;
   - `switch_recommended` — a better freshly proved route exists;
   - `probe_required` — discovery found a better candidate but no acceptable fresh proof yet;
   - `blocked` — no eligible candidate; inspect hard blockers/refresh.
4. When `probe_required`, execute only the **current top candidate** returned as actionable. Use `model_gateway_probe_execute` `plan` first, then approved `apply` with the same idempotency key.
5. After **every** probe result — success or failure — call `model_gateway_workflow_plan` again before probing another candidate or promoting anything. Health changed, so the ranking is stale by definition.
6. On success, the rerun should turn that candidate into a freshly proved winner or reveal an even better candidate that still needs proof. On objective failure, the rerun should promote the next best candidate automatically. Do not use a pre-probe switch target.
7. Only when the new `selectionDecision` is `switch_recommended` should you plan/apply `model_gateway_route_switch` (or the narrower model switch when appropriate).
8. Preserve the same SDK `sessionId`. If an apply returns `automaticContinuation.armed=true`, `deferred_until_turn_boundary` or equivalent, stop route tools and finish the turn. Verify with `model_gateway_operation_status` on the next turn.
9. Report success only after the operation is `committed` and the terminal/runtime confirms the same session on the new route.

## Discovery ranking vs proved ranking

Use `model_gateway_route_plan` directly when you need to inspect the two layers:

- `proofPolicy="metadata_only"` + `selectionGoal="quality_first"`: best candidates to **consider/probe**. Lack of positive proof must not erase a strong candidate.
- `proofPolicy="task_default"`: enforce the task profile's normal runtime contract.
- `proofPolicy="fresh_runtime_required"`: only current runtime-proved candidates may win.

When the metadata winner and proved winner differ, explain the gap. Typical language:

> “GLM-X ranks first for this repo-agent task, but it has no fresh agent proof. Y is currently proved. I will probe GLM-X before recommending a switch.”

Never call an unproved metadata winner “the best fully functional model.”

## Adaptive failure handling

A candidate probe failure is evidence, not a dead end.

- Record/classify the failure through the normal probe tool; do not hide it.
- Recent `auth`, `credits/payment`, rate-limit or protocol failures should block/penalize the candidate according to health policy.
- After an objective failure, rerun `model_gateway_workflow_plan`; continue automatically with whatever candidate is now top-ranked.
- Do **not** ask the user whether to try candidate #2 merely because candidate #1 failed; recalculation and continuation are objective and the operator has authorized extensive probing.
- Ask the user only for genuinely subjective choices (for example, quality vs latency, local/privacy preference, or paying a provider when no usable credited route remains) or missing authorization/credentials that tools cannot resolve.

If all planned candidates fail, summarize provider/model, probe stage, classified failure and the next best remediation. Do not fall back to a new SDK session.

## Current-catalog evidence

Treat “configured model no longer appears in the provider's authoritative current catalog” as strong negative availability evidence. Refresh/discovery failures themselves are not proof that the model disappeared; fail open on discovery transport errors, but fail closed when an authoritative provider catalog was successfully read and the model is absent.

Human cockpit commands such as `/byok models refresh provider:<provider>` and `/byok models route <profile> active --show-rejected` should tell the same story as Model Gateway tools. If they disagree, prefer fresh structured evidence and investigate the projection mismatch before promotion.

## Explanation contract

Keep route explanations compact but explicit. Include:

- current provider/model and whether it is healthy, stale or failed;
- task profile and selection goal;
- best discovery candidate;
- best freshly proved candidate, if any;
- proof kind and age;
- why the winner beats the nearest alternatives;
- exact next action: use, probe, switch, refresh, or ask the user.

Do not expose tokens, secrets, authorization headers or raw provider payloads.

## Same-session guardrails

- Never create a new SDK session as an automatic fallback.
- Never promote a candidate merely because catalog metadata is attractive.
- Never treat stale positive proof as current proof.
- Never retry a failed mutable apply under a new idempotency key before reading `model_gateway_operation_status`.
- Never continue route-tool calls in the same turn after a deferred turn-boundary promotion is armed.
- Never weaken eligibility/access/env constraints to make a preferred model win.

Read [references/route-protocol.md](references/route-protocol.md) for the concrete tool sequence and state table.

## Completion criteria

A best-route selection is complete only when either:

- the current route is shown to be the highest-ranked route satisfying the fresh functional contract; or
- a better candidate has been freshly proved, re-ranked, promoted same-session, and confirmed `committed`.

If neither is true, report the decision state as `probe_required` or `blocked`, not as success.
