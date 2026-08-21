// @ts-check
/** Scope allocation, bounded-registry eviction and initial state construction. */
import { publishIoLifecycleEvent } from '#copilot/infra/internal/telemetry';
import { closeScope } from './refresh.js';
import { abortWarmForSession, ensureScopeInvalidationHook, normalizeScopePath } from './state.js';

/** @typedef {import('./types.js').ScopeDeclareOptions} ScopeDeclareOptions */
/** @typedef {import('./types.js')._InternalScope} _InternalScope */

/** @param {string} incomingSessionId @param {import('./state.js').ScopeRuntimeState} runtime */
function enforceScopeLimit(incomingSessionId, runtime) {
    if (runtime.registry.has(incomingSessionId)) return;
    while (runtime.registry.size >= runtime.maxActiveScopes) {
        let oldestSessionId = null;
        let oldestAccess = Number.POSITIVE_INFINITY;
        for (const [sessionId, scope] of runtime.registry.entries()) {
            if (scope.lastAccessAt < oldestAccess) {
                oldestAccess = scope.lastAccessAt;
                oldestSessionId = sessionId;
            }
        }
        if (!oldestSessionId) break;
        publishIoLifecycleEvent('scope', 'evicted', {
            sessionId: oldestSessionId,
            activeScopes: runtime.registry.size,
            maxActiveScopes: runtime.maxActiveScopes,
        });
        closeScope(oldestSessionId, runtime);
    }
}

/** @param {ScopeDeclareOptions} opts @param {import('./state.js').ScopeRuntimeState} runtime */
export function allocateScope(opts, runtime) {
    const previousWarmPromise = runtime.warmPromises.get(opts.sessionId) ?? null;
    const warmController = new AbortController();
    enforceScopeLimit(opts.sessionId, runtime);
    abortWarmForSession(opts.sessionId, runtime);
    ensureScopeInvalidationHook(runtime);

    const explicitPaths = opts.paths;
    const directory = opts.directory;
    const selectionMode = opts.selectionMode ?? 'coverage';
    const preferredPaths = opts.preferredPaths ?? [];
    const seedSymbols = opts.seedSymbols ?? [];
    const concurrency = opts.concurrency ?? 8;
    const indexMode = opts.indexMode ?? 'auto';

    /** @type {_InternalScope} */
    const scope = {
        sessionId: opts.sessionId,
        workspaceRoot: opts.workspaceRoot ? normalizeScopePath(opts.workspaceRoot) : null,
        directory: directory ? normalizeScopePath(directory) : null,
        paths: explicitPaths ? [...explicitPaths] : [],
        symbolIndex: new Map(),
        symbolBytesByPath: new Map(),
        symbolBytes: 0,
        candidateFiles: explicitPaths?.length ?? 0,
        selectedFiles: explicitPaths?.length ?? 0,
        hardLimitReached: false,
        selection: {
            mode: directory ? (selectionMode === 'lexical' ? 'lexical' : 'coverage') : 'explicit',
            candidateBuckets: 0,
            selectedBuckets: 0,
            preferredRequested: directory ? new Set(preferredPaths.map(normalizeScopePath)).size : 0,
            preferredSelected: 0,
            seedSymbolsRequested: directory
                ? new Set(seedSymbols.map((value) => String(value).trim()).filter(Boolean)).size
                : 0,
            seedSymbolPathsResolved: 0,
        },
        refreshConcurrency: Math.max(1, Math.min(32, Math.floor(concurrency))),
        indexMode,
        preloaded: 0,
        failed: 0,
        invalidatedPaths: new Set(),
        index: null,
        warmDurationMs: 0,
        ready: false,
        degraded: false,
        lastError: null,
        startedAt: Date.now(),
        completedAt: null,
        lastAccessAt: Date.now(),
    };
    runtime.registry.set(opts.sessionId, scope);
    runtime.warmControllers.set(opts.sessionId, warmController);
    return { scope, warmController, previousWarmPromise };
}
