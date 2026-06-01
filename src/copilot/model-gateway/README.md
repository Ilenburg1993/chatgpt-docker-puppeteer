# Model Gateway

`src/copilot/model-gateway` is the canonical domain for BYOK providers, provider-local models, capability metadata,
probes, routing decisions, health and cost policy.

The active operational automation roadmap is
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATIONAL_AUTOMATION_ROADMAP_2026-06-01.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATIONAL_AUTOMATION_ROADMAP_2026-06-01.md).
Use it as the source of truth before changing importers, catalog storage, account access, eligibility, probes, runtime
selection, terminal automation or live tests.

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

The operational CLI cockpit is:

```bash
npm run model-gateway:ops
```

That command is read-only and is the fastest way to check whether the metadata database, readiness checks, automation
decision and command inventory are coherent before live tests.
