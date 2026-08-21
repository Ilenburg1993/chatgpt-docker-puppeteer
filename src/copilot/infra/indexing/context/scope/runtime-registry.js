// @ts-check
/**
 * Process-wide observability registry for workspace-owned scope runtimes.
 *
 * A runtime registers only while it owns at least one active scope. The registry never creates, closes or mutates a
 * scope and therefore does not own lifecycle.
 *
 * @module copilot/infra/indexing/context/scope/runtime-registry
 */

/** @typedef {{ runtimeId:string; snapshot:() => { activeScopes:number; scopes:readonly import('./types.js').ScopeStats[] } }} ScopeRuntimeProbe */
/** @type {Set<ScopeRuntimeProbe>} */
const activeRuntimeProbes = new Set();

/** @param {ScopeRuntimeProbe} probe */
export function registerScopeRuntimeProbe(probe) {
    activeRuntimeProbes.add(probe);
}

/** @param {ScopeRuntimeProbe} probe */
export function unregisterScopeRuntimeProbe(probe) {
    activeRuntimeProbes.delete(probe);
}

export function readScopeRuntimeRegistrySnapshot() {
    const runtimes = [...activeRuntimeProbes].map((probe) => ({ runtimeId: probe.runtimeId, ...probe.snapshot() }));
    return Object.freeze({
        activeRuntimes: runtimes.length,
        activeScopes: runtimes.reduce((total, runtime) => total + runtime.activeScopes, 0),
        runtimes: Object.freeze(runtimes),
        scopes: Object.freeze(runtimes.flatMap((runtime) => runtime.scopes)),
    });
}
