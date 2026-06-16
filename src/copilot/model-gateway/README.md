# Model Gateway

`src/copilot/model-gateway` is the canonical domain for BYOK providers, provider-local models, capability metadata,
probes, routing decisions, health and cost policy.

The current canonical audit, target architecture and continuously updated implementation roadmap is
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_LLM_B_CONTROL_PLANE_AUDIT_AND_ROADMAP_2026-06-15.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_LLM_B_CONTROL_PLANE_AUDIT_AND_ROADMAP_2026-06-15.md).
Read and update it in the same increment before changing catalog authority, provider bindings, runtime switching,
LLM-B tools, automation or readiness.

The previous operational and code reference remains available as historical context at
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATIONAL_AND_CODE_REFERENCE_2026-06-02.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATIONAL_AND_CODE_REFERENCE_2026-06-02.md).

The previous terminal auto runtime roadmap remains available as historical context at
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_TERMINAL_AUTO_RUNTIME_ROADMAP_2026-06-01.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_TERMINAL_AUTO_RUNTIME_ROADMAP_2026-06-01.md).

The specialized operator/runtime playbook is
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_RUNTIME_PLAYBOOK_2026-06-01.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_RUNTIME_PLAYBOOK_2026-06-01.md).
Use it before operating auto mode, running terminal live tests or authorizing real BYOK provider calls.

The specialized operator/code guide is
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_AND_CODE_GUIDE_2026-06-01.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_AND_CODE_GUIDE_2026-06-01.md).
Use it to understand the code layers, SQLite operational ledgers, command surfaces, configuration and test ladder.

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

It is not a replacement for the GitHub Copilot SDK wrapper. The SDK layer remains the boundary that knows how to create,
resume and operate Copilot SDK sessions. The gateway decides what provider/model binding should be used and projects that
decision into SDK-compatible objects.

## Boundaries

- `model-gateway` owns provider/model records, provenance, capability facts, probe results, health facts, routing policy
  and redacted operator projections.
- `sdk/session` owns the vanilla SDK contract: `ProviderConfig`, session lifecycle, `ModelInfo`, events and typed handlers.
- `terminal` renders gateway projections and triggers probes or route changes; it should not own provider health forever.
- `observability` records stabilized gateway events and metrics. It must not infer capabilities or make routing decisions.

## Current migration stage

The first stage imports the existing env-based BYOK configuration through `EnvByokCompatImporter`. This keeps the current
terminal/runtime flow intact while giving the system a single provider/model identity model:

```txt
providerId: openrouter
providerModel: deepseek/deepseek-v4-flash:free
gateway model id: openrouter:deepseek/deepseek-v4-flash:free
```

Provider secrets never appear in model gateway records. Only redacted `secretRefs` and configured/not-configured facts are
stored.

## Runtime Automation

The automation layer is split deliberately:

- `automation/decision.js` selects the next route action without mutating terminal or provider state.
- `automation/controller.js` converts a decision into explicit effect intents.
- `terminal/byok/gateway-auto.js` adapts the pure decision to the live terminal inventory.
- `/byok auto status` inspects, `/byok auto record` persists the decision, `/byok auto apply` applies only authorized
  terminal effects, and `/byok auto off` explains how to disable persistent policy.

Provider and route changes preserve the current SDK `sessionId`. The runtime may rebuild its transport and resume the
same session with a different provider binding, but it must never create a replacement session as an inferred fallback.
`model_gateway_route_plan` returns the structured target and `model_gateway_route_switch` applies it transactionally
with confirmation, idempotency, verification, rollback and durable operation records.

Gateway-selected routes are projected to session boot as explicit provider bindings. The route carries an authoritative
provider id while provider type, endpoint, wire API and an ephemeral generic credential projection are resolved before
the SDK compatibility parser runs. This keeps migrated routes independent from provider-specific preset defaults.
Operator-authored BYOK profiles are materialized by the gateway profile store into the same explicit env projection
before the SDK boundary; the profile marker is removed from that ephemeral env so the SDK does not reinterpret the JSON
profile. The terminal BYOK cockpit lists profiles and activates the current process through that same gateway store,
preserving redaction and keeping the SDK profile parser out of operator-facing profile inventory. Legacy env-only BYOK
remains an explicit compatibility path. Cost/free-tier hints and profile readiness displayed by the cockpit now come
from the gateway profile store instead of the raw SDK profile JSON. New profile writes through the gateway store/tool
reject inline secrets and reject `apiKeyEnv`/`bearerTokenEnv` references that are not in the selected provider's
allowlist; already-authored legacy profiles remain readable for compatibility.

The LLM-B Model Gateway surface currently contains 14 structured tools covering overview, catalog search, route planning,
model evaluation, policy proposal, probe planning/execution, model and route switching, catalog refresh, reconciliation,
operation status, maintenance and BYOK profile management. The overview also projects the selected runtime's public capability map, including
transactional model switching and same-session provider route reattach, so planning does not infer live support from
catalog metadata alone. It accepts an optional runtime id, includes the effective model/statistics for that runtime and
lists redacted operator BYOK profiles through the gateway-owned profile store.

The operational CLI cockpit is:

```bash
npm run model-gateway:ops
```

That command is read-only and is the fastest way to check whether the metadata database, readiness checks, automation
decision and command inventory are coherent before live tests.
