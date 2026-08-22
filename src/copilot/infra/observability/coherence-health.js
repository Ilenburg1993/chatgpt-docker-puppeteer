// @ts-check
/** Side-effect-free runtime-owned coherence/invalidation health projection. */
import { healthErrorMessage } from './safe-call.js';

const WATCH_COUNTER_FIELDS = Object.freeze([
    'starts',
    'reuses',
    'stops',
    'events',
    'queued',
    'coalesced',
    'canonicalSuppressed',
    'filtered',
    'nullFilename',
    'dropped',
    'invalidated',
    'errors',
    'flushes',
    'highWater',
]);

/** @param {Record<string, unknown>} entry */
function projectExternalWatcher(entry) {
    /** @type {Record<string, unknown>} */
    const projected = {
        enabled: entry['enabled'] === true,
        watching: entry['watching'] === true,
        pending: Number(entry['pending'] ?? 0),
        debounceMs: Number(entry['debounceMs'] ?? 0),
        maxBatch: Number(entry['maxBatch'] ?? 0),
        maxPending: Number(entry['maxPending'] ?? 0),
        lastEventAtMs: typeof entry['lastEventAtMs'] === 'number' ? entry['lastEventAtMs'] : null,
        lastFlushAtMs: typeof entry['lastFlushAtMs'] === 'number' ? entry['lastFlushAtMs'] : null,
    };
    for (const field of WATCH_COUNTER_FIELDS) projected[field] = Number(entry[field] ?? 0);
    return Object.freeze(projected);
}

/** @param {ReturnType<typeof import('../composition/runtime/index.js').createInfraRuntime>} runtime */
export function readCoherenceHealthStats(runtime) {
    try {
        const invalidation = runtime.coherence.invalidation.snapshot();
        const externalWatchers = runtime.listWorkspaces().flatMap((workspace) => workspace.externalWatchStats());
        const active = externalWatchers.filter((entry) => entry.watching === true);
        const watcherSample = externalWatchers.slice(0, 20).map((entry) => projectExternalWatcher(entry));
        return Object.freeze({
            ...invalidation,
            externalWatch: Object.freeze({
                enabled: externalWatchers.some((entry) => entry.enabled === true),
                watching: active.length > 0,
                activeWatchers: active.length,
                watchedRoots: new Set(active.map((entry) => entry.root)).size,
                watcherCount: externalWatchers.length,
                watcherSample: Object.freeze(watcherSample),
                truncated: externalWatchers.length > watcherSample.length,
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
                watcherCount: 0,
                watcherSample: Object.freeze([]),
                truncated: false,
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
