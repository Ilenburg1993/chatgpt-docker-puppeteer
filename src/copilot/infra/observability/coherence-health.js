// @ts-check
/** Side-effect-free runtime-owned coherence/invalidation health projection. */
import { healthErrorMessage } from './safe-call.js';

/** @param {ReturnType<typeof import('../composition/runtime/index.js').createInfraRuntime>} runtime */
export function readCoherenceHealthStats(runtime) {
    try {
        const invalidation = runtime.coherence.invalidation.snapshot();
        const externalWatchers = runtime.listWorkspaces().flatMap((workspace) => workspace.externalWatchStats());
        const active = externalWatchers.filter((entry) => entry.watching === true);
        return Object.freeze({
            ...invalidation,
            externalWatch: Object.freeze({
                enabled: externalWatchers.some((entry) => entry.enabled === true),
                watching: active.length > 0,
                activeWatchers: active.length,
                watchedRoots: new Set(active.map((entry) => entry.root)).size,
                watchers: Object.freeze(externalWatchers),
            }),
        });
    } catch (error) {
        return Object.freeze({
            error: healthErrorMessage(error),
            hooks: 0,
            pending: 0,
            pendingReplications: 0,
            debounceMs: 0,
            localDispatches: 0,
            replicationQueued: 0,
            replicationCoalesced: 0,
            replicationFlushes: 0,
            replicationPublished: 0,
            externalWatch: Object.freeze({
                enabled: false,
                watching: false,
                activeWatchers: 0,
                watchedRoots: 0,
                watchers: Object.freeze([]),
            }),
            crossProcess: Object.freeze({
                enabled: false,
                initialized: false,
                initializationErrors: 1,
                writeErrors: 0,
                readErrors: 0,
                gapDetections: 0,
            }),
        });
    }
}
