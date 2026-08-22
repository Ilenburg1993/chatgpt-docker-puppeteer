// @ts-check
/**
 * Process-wide observability registry for owner-bound workspace scope probes.
 *
 * The registry owns no scope lifecycle and never materializes a capability. Selection is performed from immutable probe
 * metadata before `snapshot()` is called, so reading runtime A cannot even inspect runtime B's scope state.
 *
 * @module copilot/infra/indexing/context/scope/runtime-registry
 */

/**
 * @typedef {Readonly<{
 *   scope:'workspace';
 *   ownerId:string;
 *   runtimeOwnerId:string;
 *   probeId:string;
 *   mayMaterialize:false;
 *   snapshot:() => { activeScopes:number; scopes:readonly import('./types.js').ScopeStats[] };
 * }>} ScopeRuntimeProbe
 */

/** @type {Set<ScopeRuntimeProbe>} */
const activeScopeProbes = new Set();

/** @param {ScopeRuntimeProbe} probe */
export function registerScopeRuntimeProbe(probe) {
    if (
        probe?.scope !== 'workspace' ||
        probe.mayMaterialize !== false ||
        !probe.ownerId ||
        !probe.runtimeOwnerId ||
        !probe.probeId ||
        typeof probe.snapshot !== 'function'
    ) {
        throw new TypeError('ScopeRuntimeProbe requires owner-bound workspace metadata and mayMaterialize=false.');
    }
    activeScopeProbes.add(probe);
}

/** @param {ScopeRuntimeProbe} probe */
export function unregisterScopeRuntimeProbe(probe) {
    activeScopeProbes.delete(probe);
}

/**
 * @param {{runtimeOwnerId?:string;ownerId?:string;scope?:'workspace'}} [filter]
 */
export function readScopeRuntimeRegistrySnapshot(filter = {}) {
    const selected = [...activeScopeProbes].filter((probe) => {
        if (filter.scope !== undefined && probe.scope !== filter.scope) return false;
        if (filter.runtimeOwnerId !== undefined && probe.runtimeOwnerId !== filter.runtimeOwnerId) return false;
        if (filter.ownerId !== undefined && probe.ownerId !== filter.ownerId) return false;
        return true;
    });
    const probes = selected.map((probe) =>
        Object.freeze({
            scope: probe.scope,
            ownerId: probe.ownerId,
            runtimeOwnerId: probe.runtimeOwnerId,
            probeId: probe.probeId,
            mayMaterialize: probe.mayMaterialize,
            ...probe.snapshot(),
        }),
    );
    return Object.freeze({
        activeProbes: probes.length,
        activeScopes: probes.reduce((total, probe) => total + probe.activeScopes, 0),
        probes: Object.freeze(probes),
        scopes: Object.freeze(probes.flatMap((probe) => probe.scopes)),
    });
}
