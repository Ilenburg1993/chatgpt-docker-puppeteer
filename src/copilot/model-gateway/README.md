# Model Gateway

`src/copilot/model-gateway` is the canonical domain for BYOK providers, provider-local models,
capability metadata, probes, routing decisions, health and cost policy.

The current canonical audit, target architecture and continuously updated implementation roadmap is
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_LLM_B_CONTROL_PLANE_AUDIT_AND_ROADMAP_2026-06-15.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_LLM_B_CONTROL_PLANE_AUDIT_AND_ROADMAP_2026-06-15.md).
Read and update it in the same increment before changing catalog authority, provider bindings,
runtime switching, LLM-B tools, automation or readiness.

The current specialized authority for MCP/LLM-B live-readiness cancellation, security proof, cache,
SQLite runtime-health/retention, source barriers and the recurring host `TaskGroup` incident is
[`../docs/WORKSPACE_LLMB_MCP_TASKGROUP_READINESS_AUDITORIA_PROFUNDA_ESTADO_ATUAL_ESTADO_ALVO_ROADMAP_2026-08-26.md`](../docs/WORKSPACE_LLMB_MCP_TASKGROUP_READINESS_AUDITORIA_PROFUNDA_ESTADO_ATUAL_ESTADO_ALVO_ROADMAP_2026-08-26.md).
It governs this boundary when more specific than the general Model Gateway roadmap.

The previous operational and code reference remains available as historical context at
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATIONAL_AND_CODE_REFERENCE_2026-06-02.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATIONAL_AND_CODE_REFERENCE_2026-06-02.md).

The previous terminal auto runtime roadmap remains available as historical context at
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_TERMINAL_AUTO_RUNTIME_ROADMAP_2026-06-01.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_TERMINAL_AUTO_RUNTIME_ROADMAP_2026-06-01.md).

The specialized operator/runtime playbook is
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_RUNTIME_PLAYBOOK_2026-06-01.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_RUNTIME_PLAYBOOK_2026-06-01.md).
Use it before operating auto mode, running terminal live tests or authorizing real BYOK provider
calls.

The specialized operator/code guide is
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_AND_CODE_GUIDE_2026-06-01.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_AND_CODE_GUIDE_2026-06-01.md).
Use it to understand the code layers, SQLite operational ledgers, command surfaces, configuration
and test ladder.

The previous operational automation roadmap remains available as context at
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATIONAL_AUTOMATION_ROADMAP_2026-06-01.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATIONAL_AUTOMATION_ROADMAP_2026-06-01.md).

The previous runtime automation roadmap remains available as context at
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_RUNTIME_AUTOMATION_ROADMAP_2026-06-01.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_RUNTIME_AUTOMATION_ROADMAP_2026-06-01.md).

The previous BYOK next guide remains available as legacy context at
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_NEXT_GUIDE_2026-05-26.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_NEXT_GUIDE_2026-05-26.md).

The previous universal guide remains available as legacy context at
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_UNIVERSAL_GUIDE_2026-05-25.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_UNIVERSAL_GUIDE_2026-05-25.md).

The short operator guide for auto mode lives at
[`../docs/model-gateway/MODEL_GATEWAY_AUTO_MODE_OPERATOR_GUIDE_2026-06-01.md`](../docs/model-gateway/MODEL_GATEWAY_AUTO_MODE_OPERATOR_GUIDE_2026-06-01.md).

It is not a replacement for the GitHub Copilot SDK wrapper. The SDK layer remains the boundary that
knows how to create, resume and operate Copilot SDK sessions. The gateway decides what
provider/model binding should be used and projects that decision into SDK-compatible objects.

## Boundaries

- `model-gateway` owns provider/model records, provenance, capability facts, probe results, health
  facts, routing policy and redacted operator projections.
- `sdk/session` owns the vanilla SDK contract: `ProviderConfig`, session lifecycle, `ModelInfo`,
  events and typed handlers.
- `terminal` renders gateway projections and triggers probes or route changes; it should not own
  provider health forever.
- `observability` records stabilized gateway events and metrics. It must not infer capabilities or
  make routing decisions.

## Current migration stage

The first stage imports the existing env-based BYOK configuration through `EnvByokCompatImporter`.
This keeps the current terminal/runtime flow intact while giving the system a single provider/model
identity model:

```txt
providerId: openrouter
providerModel: deepseek/deepseek-v4-flash:free
gateway model id: openrouter:deepseek/deepseek-v4-flash:free
```

Provider secrets never appear in model gateway records. Only redacted `secretRefs` and
configured/not-configured facts are stored.

## Live readiness safety and performance

`llmb_live_readiness` is an operational inspection path, not a model/provider turn. Its current
architecture deliberately separates four concerns:

- the MCP boundary starts one **call-scoped supervised subprocess** for fresh readiness. Caller
  abort, timeout or output pressure terminates the process group and settles only after physical
  close;
- catalog/SQLite redaction is a separate **security proof**. Redaction Workers are one-shot,
  resource-bounded and receive only the explicit readiness environment. A valid proof is reused only
  for the same environment context, coverage and content fingerprints; it is not governed by the
  short operational cache TTL;
- the operational result cache is bounded to 30 seconds and is populated only when initial and final
  state fingerprints are identical. SQLite change detection is O(1), using the application-owned
  connection capability rather than historical `COUNT(*)` scans;
- the default MCP result is task-first and compact (`<16 KiB` in the regression fixture). Full phase
  trees are opt-in through `includeDetails=true`.

Runtime health v14 uses pointer-only latest tables backed by historical ledgers. Latest reads were
benchmarked with 100k/250k/500k rows per health/probe ledger and remained in the low-millisecond
range with covering latest indexes plus primary-key lookups; no historical window sort is required.
Operational retention is latest-preserving and chunked. Heavy PASSIVE checkpoint I/O is delegated to
a path-bound Infra Worker so `better-sqlite3` checkpoint work does not block the application event
loop.

The current local acceptance SLO for a **fresh operational readiness with an already-valid security
proof** is p95 <= 7.0 s. In the final publication-set 1/5/20 certification, N=20 measured p50 ~6.382
s, p95 ~6.552 s and max ~6.569 s, with 27 created/27 terminated subprocesses and current=0. This is
distinct from both the first security-proof build and sub-millisecond memory-cache hits. The 79-file
publication set was hash-bound before/after execution; see the specialized 2026-08-26 audit for
exact phases and memory HWM.

Do not perform intentional retention against `data/copilot.sqlite` as a side effect of readiness or
benchmarking. Real retention requires the documented backup/integrity, publication/reload and
host-acceptance gates first.

## Runtime Automation

The automation layer is split deliberately:

- `automation/decision.js` selects the next route action without mutating terminal or provider
  state.
- `automation/controller.js` converts a decision into explicit effect intents.
- `terminal/byok/gateway-auto.js` adapts the pure decision to the live terminal inventory.
- `/byok auto status` inspects, `/byok auto record` persists the decision, `/byok auto apply`
  applies only authorized terminal effects, and `/byok auto off` explains how to disable persistent
  policy.

Provider and route changes preserve the current SDK `sessionId`. The runtime may rebuild its
transport and resume the same session with a different provider binding, but it must never create a
replacement session as an inferred fallback. `model_gateway_route_plan` returns the structured
target and `model_gateway_route_switch` applies it transactionally with confirmation, idempotency,
verification, rollback and durable operation records.

Gateway-selected routes are projected to session boot as explicit provider bindings. The route
carries an authoritative provider id while provider type, endpoint, wire API and an ephemeral
generic credential projection are resolved before the SDK compatibility parser runs. This keeps
migrated routes independent from provider-specific preset defaults. Operator-authored BYOK profiles
are materialized by the gateway profile store into the same explicit env projection before the SDK
boundary; the profile marker is removed from that ephemeral env so the SDK does not reinterpret the
JSON profile. The terminal BYOK cockpit lists profiles and activates the current process through
that same gateway store, preserving redaction and keeping the SDK profile parser out of
operator-facing profile inventory. Legacy env-only BYOK remains an explicit compatibility path.
Cost/free-tier hints and profile readiness displayed by the cockpit now come from the gateway
profile store instead of the raw SDK profile JSON. New profile writes through the gateway store/tool
reject inline secrets and reject `apiKeyEnv`/`bearerTokenEnv` references that are not in the
selected provider's allowlist; already-authored legacy profiles remain readable for compatibility.

The LLM-B Model Gateway surface currently contains 14 structured tools covering overview, catalog
search, route planning, model evaluation, policy proposal, probe planning/execution, model and route
switching, catalog refresh, reconciliation, operation status, maintenance and BYOK profile
management. The overview also projects the selected runtime's public capability map, including
transactional model switching and same-session provider route reattach, so planning does not infer
live support from catalog metadata alone. It accepts an optional runtime id, includes the effective
model/statistics for that runtime and lists redacted operator BYOK profiles through the
gateway-owned profile store.

The operational CLI cockpit is:

```bash
npm run model-gateway:ops
```

That command is read-only and is the fastest way to check whether the metadata database, readiness
checks, automation decision and command inventory are coherent before live tests.
