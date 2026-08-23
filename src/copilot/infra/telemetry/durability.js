// @ts-check
/** Instance-owned durability/sync/atomic-publish telemetry. @module copilot/infra/telemetry/durability */

/** @param {unknown} value @returns {Record<string,unknown>|null} */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string,unknown>} */ (value)
        : null;
}

export function createIoDurabilityRuntime() {
    const state = {
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
        /** @type {{kind:'file'|'directory';operation:string;errorCode:string|null;at:number}|null} */ lastFailure:
            null,
    };
    /** @param {'file'|'directory'} kind @param {unknown} value @param {string} operation */
    function recordSync(kind, value, operation) {
        const result = asRecord(value);
        if (!result || result['attempted'] !== true) return;
        const counters = kind === 'file' ? state.fileSync : state.directorySync;
        counters.attempted += 1;
        const durationMs = Number(result['durationMs'] ?? 0);
        if (Number.isFinite(durationMs) && durationMs >= 0) {
            counters.totalDurationMs += durationMs;
            counters.maxDurationMs = Math.max(counters.maxDurationMs, durationMs);
        }
        if (result['ok'] === true) counters.confirmed += 1;
        else if (typeof result['skippedReason'] === 'string' && result['skippedReason']) counters.skipped += 1;
        else {
            counters.failed += 1;
            state.lastFailure = {
                kind,
                operation,
                errorCode: typeof result['errorCode'] === 'string' ? result['errorCode'] : null,
                at: Date.now(),
            };
        }
    }
    /** @param {unknown} value */
    function recordAtomicPhases(value) {
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
            state.atomicWritePhases[field] += duration;
            observed = true;
        }
        if (observed) state.atomicWritePhases.observed += 1;
    }
    /** @param {import('#copilot/infra/internal/operations/contracts').IoMeta} io */
    function record(io) {
        state.operationsObserved += 1;
        const advisory = io.advisoryLimits;
        if (!advisory || typeof advisory !== 'object') return;
        let found = false;
        const durability = asRecord(advisory['durability']);
        if (durability) {
            found = true;
            const mode = durability['durability'];
            if (mode === 'none' || mode === 'file' || mode === 'file-and-directory') state.modes[mode] += 1;
            if (durability['fileFlushRequested'] === true) state.fileFlushRequested += 1;
            recordAtomicPhases(durability['phaseTimings']);
            recordSync('file', durability['fileSync'], io.operation);
            recordSync('directory', durability['directorySync'], io.operation);
            if (Array.isArray(durability['directorySyncs']))
                for (const entry of durability['directorySyncs'])
                    recordSync('directory', asRecord(entry)?.['result'], io.operation);
        }
        const syncFields = /** @type {const} */ ([
            ['file', 'fileSync'],
            ['directory', 'destinationDirectorySync'],
            ['directory', 'sourceDirectorySync'],
        ]);
        for (const [kind, key] of syncFields) {
            if (!(key in advisory)) continue;
            found = true;
            recordSync(kind, advisory[key], io.operation);
        }
        if (found) state.operationsWithMetadata += 1;
    }
    function stats() {
        return {
            ...state,
            modes: { ...state.modes },
            fileSync: { ...state.fileSync },
            directorySync: { ...state.directorySync },
            atomicWritePhases: { ...state.atomicWritePhases },
            lastFailure: state.lastFailure ? { ...state.lastFailure } : null,
        };
    }
    function reset() {
        state.operationsObserved = 0;
        state.operationsWithMetadata = 0;
        state.fileFlushRequested = 0;
        Object.assign(state.modes, { none: 0, file: 0, 'file-and-directory': 0 });
        Object.assign(state.fileSync, {
            attempted: 0,
            confirmed: 0,
            skipped: 0,
            failed: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
        });
        Object.assign(state.directorySync, {
            attempted: 0,
            confirmed: 0,
            skipped: 0,
            failed: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
        });
        Object.assign(state.atomicWritePhases, {
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
        });
        state.lastFailure = null;
    }
    return Object.freeze({ record, stats, reset, dispose: reset });
}
