# Model Gateway

`src/copilot/model-gateway` is the canonical domain for BYOK providers, provider-local models, capability metadata,
probes, routing decisions, health and cost policy.

The living roadmap and architecture guide is
[`../docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_UNIVERSAL_GUIDE_2026-05-25.md`](../docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_UNIVERSAL_GUIDE_2026-05-25.md).
Use it as the source of truth before changing importers, catalog storage, account access, eligibility, probes or runtime
selection.

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
