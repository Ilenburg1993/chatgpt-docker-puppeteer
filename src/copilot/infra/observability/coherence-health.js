// @ts-check
/** Read-side coherence/invalidation health projection with bounded fail-closed fallback. */
import { getIoExternalWatchStats, getIoInvalidationBusStats } from '#copilot/infra/internal/filesystem/invalidation';
import { healthErrorMessage, safeHealthCall } from './safe-call.js';

export function readCoherenceHealthStats() {
    const externalWatch = safeHealthCall(getIoExternalWatchStats, {
        starts: 0,
        reuses: 0,
        stops: 0,
        events: 0,
        queued: 0,
        coalesced: 0,
        canonicalSuppressed: 0,
        filtered: 0,
        nullFilename: 0,
        dropped: 0,
        invalidated: 0,
        errors: 1,
        flushes: 0,
        highWater: 0,
        lastEventAtMs: null,
        lastFlushAtMs: null,
        lastError: 'external-watch-health-unavailable',
        enabled: false,
        watching: false,
        rootKnown: false,
        pending: 0,
        debounceMs: 0,
        maxBatch: 0,
        maxPending: 0,
    });
    try {
        return { ...getIoInvalidationBusStats(), externalWatch };
    } catch (error) {
        return {
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
            externalWatch,
            crossProcess: {
                enabled: false,
                initialized: false,
                initializationErrors: 1,
                writeErrors: 0,
                readErrors: 0,
                gapDetections: 0,
            },
        };
    }
}
