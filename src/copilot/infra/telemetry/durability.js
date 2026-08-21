// @ts-check
/** Durability/sync/atomic-publish telemetry aggregation. */

const durabilityStats = {
    operationsObserved: 0,
    operationsWithMetadata: 0,
    fileFlushRequested: 0,
    modes: { none: 0, file: 0, 'file-and-directory': 0 },
    fileSync: { attempted: 0, confirmed: 0, skipped: 0, failed: 0, totalDurationMs: 0, maxDurationMs: 0 },
    directorySync: { attempted: 0, confirmed: 0, skipped: 0, failed: 0, totalDurationMs: 0, maxDurationMs: 0 },
    atomicWritePhases: {
        observed: 0,
        tempPathMs: 0,
        capacityPreflightMs: 0,
        tempWriteMs: 0,
        modeApplyMs: 0,
        fileSyncMs: 0,
        prePublishCheckMs: 0,
        publishMs: 0,
        directorySyncMs: 0,
        totalMs: 0,
    },
    /** @type {{ kind: 'file' | 'directory'; operation: string; errorCode: string | null; at: number } | null} */
    lastFailure: null,
};

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/** @param {'file' | 'directory'} kind @param {unknown} value @param {string} operation */
function recordSyncResult(kind, value, operation) {
    const result = asRecord(value);
    if (!result || result['attempted'] !== true) return;
    const counters = kind === 'file' ? durabilityStats.fileSync : durabilityStats.directorySync;
    counters.attempted += 1;
    const durationMs = Number(result['durationMs'] ?? 0);
    if (Number.isFinite(durationMs) && durationMs >= 0) {
        counters.totalDurationMs += durationMs;
        counters.maxDurationMs = Math.max(counters.maxDurationMs, durationMs);
    }
    if (result['ok'] === true) {
        counters.confirmed += 1;
        return;
    }
    if (typeof result['skippedReason'] === 'string' && result['skippedReason']) {
        counters.skipped += 1;
        return;
    }
    counters.failed += 1;
    durabilityStats.lastFailure = {
        kind,
        operation,
        errorCode: typeof result['errorCode'] === 'string' ? result['errorCode'] : null,
        at: Date.now(),
    };
}

/** @param {unknown} value */
function recordAtomicWritePhaseTimings(value) {
    const timings = asRecord(value);
    if (!timings) return;
    const fields = /** @type {const} */ ([
        'tempPathMs',
        'capacityPreflightMs',
        'tempWriteMs',
        'modeApplyMs',
        'fileSyncMs',
        'prePublishCheckMs',
        'publishMs',
        'directorySyncMs',
        'totalMs',
    ]);
    let observed = false;
    for (const field of fields) {
        const duration = Number(timings[field] ?? 0);
        if (!Number.isFinite(duration) || duration < 0) continue;
        durabilityStats.atomicWritePhases[field] += duration;
        observed = true;
    }
    if (observed) durabilityStats.atomicWritePhases.observed += 1;
}

/** @param {import('#copilot/core/io-contracts').IoMeta} io */
export function recordIoDurability(io) {
    durabilityStats.operationsObserved += 1;
    const advisory = io.advisoryLimits;
    if (!advisory || typeof advisory !== 'object') return;
    let found = false;
    const durability = asRecord(advisory['durability']);
    if (durability) {
        found = true;
        const mode = durability['durability'];
        if (mode === 'none' || mode === 'file' || mode === 'file-and-directory') durabilityStats.modes[mode] += 1;
        if (durability['fileFlushRequested'] === true) durabilityStats.fileFlushRequested += 1;
        recordAtomicWritePhaseTimings(durability['phaseTimings']);
        recordSyncResult('file', durability['fileSync'], io.operation);
        recordSyncResult('directory', durability['directorySync'], io.operation);
        if (Array.isArray(durability['directorySyncs'])) {
            for (const entry of durability['directorySyncs']) {
                recordSyncResult('directory', asRecord(entry)?.['result'], io.operation);
            }
        }
    }
    const syncFields = /** @type {const} */ ([
        ['file', 'fileSync'],
        ['directory', 'destinationDirectorySync'],
        ['directory', 'sourceDirectorySync'],
    ]);
    for (const [kind, key] of syncFields) {
        if (!(key in advisory)) continue;
        found = true;
        recordSyncResult(kind, advisory[key], io.operation);
    }
    if (found) durabilityStats.operationsWithMetadata += 1;
}

/** @returns {typeof durabilityStats} */
export function getIoDurabilityStats() {
    return {
        ...durabilityStats,
        modes: { ...durabilityStats.modes },
        fileSync: { ...durabilityStats.fileSync },
        directorySync: { ...durabilityStats.directorySync },
        atomicWritePhases: { ...durabilityStats.atomicWritePhases },
        lastFailure: durabilityStats.lastFailure ? { ...durabilityStats.lastFailure } : null,
    };
}
