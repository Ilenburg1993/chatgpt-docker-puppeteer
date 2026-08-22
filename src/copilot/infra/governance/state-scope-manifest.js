// @ts-check
/**
 * Semantic ownership decisions for every infra module that currently keeps mutable state at module scope.
 *
 * Entries are intentionally restricted to genuine process semantics. Runtime/workspace operational state is forbidden
 * here and must be instance-owned instead of being classified as deferred migration debt.
 *
 * @module copilot/infra/governance/state-scope-manifest
 */

/**
 * @typedef {'process' | 'runtime' | 'workspace'} InfraStateScope
 * @typedef {{ path:string; scope:InfraStateScope; rationale:string }} InfraStateScopeDescriptor
 */

/** @param {InfraStateScopeDescriptor} descriptor */
const state = (descriptor) => Object.freeze(descriptor);

export const INFRA_STATE_SCOPE_MANIFEST = Object.freeze([
    state({
        path: 'composition/process/service.js',
        scope: 'process',
        rationale: 'Monotonic diagnostic ID sequence only; no operational authority or resource is shared.',
    }),
    state({
        path: 'composition/runtime/service.js',
        scope: 'process',
        rationale: 'Monotonic diagnostic runtime ID sequence only.',
    }),
    state({
        path: 'composition/workspace/service.js',
        scope: 'process',
        rationale: 'Monotonic diagnostic workspace ID sequence only.',
    }),
    state({
        path: 'concurrency/locks/configured/service.js',
        scope: 'process',
        rationale:
            'Configured-path promise tails and AsyncLocalStorage serialize control-plane filesystem resources process-wide without owning path authority.',
    }),
    state({
        path: 'concurrency/locks/file/state.js',
        scope: 'process',
        rationale: 'File-lock lease/metric state is process-wide coordination evidence.',
    }),
    state({
        path: 'concurrency/locks/local/observability.js',
        scope: 'process',
        rationale: 'Local lock leases and counters describe process-wide coordination.',
    }),
    state({
        path: 'concurrency/locks/local/resource-lock.js',
        scope: 'process',
        rationale: 'Promise tails serialize resources across the whole process.',
    }),
    state({
        path: 'concurrency/locks/process-state/service.js',
        scope: 'process',
        rationale: 'Exactly one explicitly activated process-lock configuration owner coordinates all lock kernels.',
    }),
    state({
        path: 'filesystem/configured/service.js',
        scope: 'process',
        rationale:
            'WeakMap grant internals preserve unforgeable capability identity process-wide without owning shared operational resources.',
    }),
    state({
        path: 'filesystem/transaction/capacity-preflight.js',
        scope: 'process',
        rationale: 'Short-lived statfs cache is keyed by function/filesystem evidence and safely shared process-wide.',
    }),
    state({
        path: 'filesystem/transaction/temp-path.js',
        scope: 'process',
        rationale: 'Prepared-directory cache is a process-local filesystem optimization without authority.',
    }),
    state({
        path: 'filesystem/workspace/authority/service.js',
        scope: 'process',
        rationale:
            'Weak authority internals and aggregate issuance counters are process bookkeeping; capabilities remain instance-bound.',
    }),
    state({
        path: 'filesystem/workspace/path-policy/cache.js',
        scope: 'process',
        rationale:
            'Physical workspace path-policy decisions, process owner identity and bounded cache counters are process coordination state; authority issuance remains workspace-instance bound.',
    }),

    state({
        path: 'indexing/context/scope/runtime-registry.js',
        scope: 'process',
        rationale:
            'Observability-only registry of active workspace scope-runtime probes; it never owns scope lifecycle.',
    }),
    state({
        path: 'indexing/parser/foundation/runtime-state.js',
        scope: 'process',
        rationale: 'Parser worker/foundation operational counters summarize the shared process parser runtime.',
    }),
    state({
        path: 'indexing/parser/parse/service.js',
        scope: 'process',
        rationale: 'Lazy Babel parser binding is immutable after resolution and safe to share process-wide.',
    }),
    state({
        path: 'policy/budgets.js',
        scope: 'process',
        rationale:
            'One token-bound process owner supplies immutable search defaults to stateless search operations; per-call budget resolution remains pure.',
    }),
    state({
        path: 'indexing/search/subprocess/process/service.js',
        scope: 'process',
        rationale:
            'Exactly one token-bound process owner supplies the minimal subprocess environment and memoizes ripgrep capability per generation.',
    }),
    state({
        path: 'platform/node/compile-cache.js',
        scope: 'process',
        rationale: 'Node compile cache is intrinsically process-global.',
    }),
]);
