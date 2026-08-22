// @ts-check
/** Registry state, bounded invariants and pure scope helpers. @module copilot/infra/indexing/context/scope/state */

import * as nodePath from 'node:path';
import { createPrefetchSessionRegistry } from '../prefetch/index.js';

/** @typedef {import('./types.js')._InternalScope} _InternalScope */
/** @typedef {import('./types.js').ScopeFailureSummary} ScopeFailureSummary */
/**
 * @typedef {{
 *   registry: Map<string, _InternalScope>;
 *   warmPromises: Map<string, Promise<void>>;
 *   warmControllers: Map<string, AbortController>;
 *   refreshingPaths: Map<string, Promise<'refreshed' | 'removed' | 'removed-failed' | 'failed'>>;
 *   scopeInvalidationUnregister: (() => void) | null;
 *   maxActiveScopes: number;
 *   prefetchSessions: ReturnType<typeof createPrefetchSessionRegistry>;
 *   indexRegistry: ReturnType<typeof import('../../registry/instance/index.js').createIoIndexRegistryRuntime> | null;
 *   cacheRuntime: {l1:ReturnType<typeof import('../../../cache/memory/index.js').createIoL1CacheRuntime>};
 *   invalidationBus: ReturnType<typeof import('../../../filesystem/invalidation/bus/index.js').createIoInvalidationBusRuntime> | null;
 *   parserCacheRuntime: ReturnType<typeof import('../../parser/cache/runtime/index.js').createParserCacheRuntime> | null;
 *   scannerConfig: Readonly<{batchSize:number;hardMaxEntries:number}> | null;
 * }} ScopeRuntimeState
 */

/** @param {{
 * maxActiveScopes?: number;
 * indexRegistry?: ReturnType<typeof import('../../registry/instance/index.js').createIoIndexRegistryRuntime>;
 * cacheRuntime: {l1:ReturnType<typeof import('../../../cache/memory/index.js').createIoL1CacheRuntime>};
 * invalidationBus?: ReturnType<typeof import('../../../filesystem/invalidation/bus/index.js').createIoInvalidationBusRuntime>;
 * parserCacheRuntime?: ReturnType<typeof import('../../parser/cache/runtime/index.js').createParserCacheRuntime>;
 * scannerConfig?: Readonly<{batchSize:number;hardMaxEntries:number}>;
 * }} options @returns {ScopeRuntimeState} */
export function createScopeRuntimeState(options) {
    if (!options?.cacheRuntime) throw new TypeError('createScopeRuntimeState requires runtime-owned cacheRuntime.');
    const configuredMax = options.maxActiveScopes ?? 10;
    return {
        registry: new Map(),
        warmPromises: new Map(),
        warmControllers: new Map(),
        refreshingPaths: new Map(),
        scopeInvalidationUnregister: null,
        maxActiveScopes: Math.max(1, Math.floor(configuredMax)),
        prefetchSessions: createPrefetchSessionRegistry({ cacheRuntime: options.cacheRuntime }),
        indexRegistry: options.indexRegistry ?? null,
        cacheRuntime: options.cacheRuntime,
        invalidationBus: options.invalidationBus ?? null,
        parserCacheRuntime: options.parserCacheRuntime ?? null,
        scannerConfig: options.scannerConfig ?? null,
    };
}

const SYMBOL_PARSE_EXTENSIONS = new Set(['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '.mts', '.cts']);

/** @param {string} filePath @returns {string} */
export function normalizeScopePath(filePath) {
    return nodePath.normalize(nodePath.resolve(filePath));
}

/** @param {string} filePath @returns {boolean} */
export function isSymbolParseTarget(filePath) {
    return SYMBOL_PARSE_EXTENSIONS.has(nodePath.extname(filePath).toLowerCase());
}

/** @param {import('#copilot/infra/internal/indexing/parser').FileSymbols} symbols @returns {number} */
function estimateSymbolBytes(symbols) {
    try {
        return Buffer.byteLength(JSON.stringify(symbols), 'utf8');
    } catch {
        return 0;
    }
}

/** @param {_InternalScope} scope @param {string} filePath @param {import('#copilot/infra/internal/indexing/parser').FileSymbols} symbols */
export function setScopeSymbols(scope, filePath, symbols) {
    const previous = scope.symbolBytesByPath.get(filePath) ?? 0;
    const next = estimateSymbolBytes(symbols);
    scope.symbolIndex.set(filePath, symbols);
    scope.symbolBytesByPath.set(filePath, next);
    scope.symbolBytes = Math.max(0, scope.symbolBytes - previous + next);
}

/** @param {_InternalScope} scope @param {string} filePath */
function deleteScopeSymbols(scope, filePath) {
    const previous = scope.symbolBytesByPath.get(filePath) ?? 0;
    scope.symbolIndex.delete(filePath);
    scope.symbolBytesByPath.delete(filePath);
    scope.symbolBytes = Math.max(0, scope.symbolBytes - previous);
}

/** @param {_InternalScope} scope @param {string} filePath */
export function removeScopePath(scope, filePath) {
    const normalized = normalizeScopePath(filePath);
    deleteScopeSymbols(scope, filePath);
    scope.paths = scope.paths.filter((candidate) => normalizeScopePath(candidate) !== normalized);
    for (const invalidatedPath of [...scope.invalidatedPaths]) {
        if (normalizeScopePath(invalidatedPath) === normalized) scope.invalidatedPaths.delete(invalidatedPath);
    }
    scope.selectedFiles = scope.paths.length;
}

/** @param {unknown} error @returns {boolean} */
export function isScopePathRemovalError(error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code ?? '') : '';
    return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}

/** @param {_InternalScope} scope @param {string} filePath @param {{ recursive?: boolean }} [options] */
export function scopeContainsPath(scope, filePath, options = {}) {
    const normalized = normalizeScopePath(filePath);
    return scope.paths.some((candidate) => {
        const normalizedCandidate = normalizeScopePath(candidate);
        return (
            normalizedCandidate === normalized ||
            (options.recursive === true && normalizedCandidate.startsWith(`${normalized}${nodePath.sep}`))
        );
    });
}

/** @param {_InternalScope} scope @param {string} filePath @param {{ recursive?: boolean }} [options] */
function markScopePathInvalidated(scope, filePath, options = {}) {
    if (!scopeContainsPath(scope, filePath, options)) return;
    const normalized = normalizeScopePath(filePath);
    for (const indexedPath of scope.symbolIndex.keys()) {
        const normalizedIndexedPath = normalizeScopePath(indexedPath);
        if (
            normalizedIndexedPath === normalized ||
            (options.recursive === true && normalizedIndexedPath.startsWith(`${normalized}${nodePath.sep}`))
        ) {
            deleteScopeSymbols(scope, indexedPath);
        }
    }
    for (const scopedPath of scope.paths) {
        const normalizedScopedPath = normalizeScopePath(scopedPath);
        if (
            normalizedScopedPath === normalized ||
            (options.recursive === true && normalizedScopedPath.startsWith(`${normalized}${nodePath.sep}`))
        ) {
            scope.invalidatedPaths.add(scopedPath);
        }
    }
    scope.ready = false;
}

/** @param {_InternalScope} scope @returns {'warming' | 'ready' | 'stale' | 'degraded'} */
export function getScopeStatus(scope) {
    if (scope.degraded) return 'degraded';
    if (scope.invalidatedPaths.size > 0) return 'stale';
    return scope.ready ? 'ready' : 'warming';
}

/** @param {_InternalScope} scope @param {unknown} error @param {ScopeFailureSummary['phase']} phase @param {string} summary */
export function recordScopeFailure(scope, error, phase, summary) {
    const record = /** @type {{ code?: unknown; name?: unknown }} */ (error);
    scope.degraded = true;
    scope.ready = false;
    scope.lastError = {
        phase,
        code: String(record?.code ?? 'UNKNOWN').slice(0, 64),
        name: String(record?.name ?? 'Error').slice(0, 64),
        summary,
        atMs: Date.now(),
    };
}

/** @param {_InternalScope} scope */
export function markScopeReady(scope) {
    scope.degraded = false;
    scope.ready = true;
    scope.lastError = null;
    scope.completedAt = Date.now();
}

/** @param {_InternalScope} scope */
export function touchScope(scope) {
    scope.lastAccessAt = Date.now();
}

/** @param {string} sessionId @param {ScopeRuntimeState} runtime */
export function abortWarmForSession(sessionId, runtime) {
    const controller = runtime.warmControllers.get(sessionId);
    if (controller && !controller.signal.aborted) controller.abort();
    runtime.warmControllers.delete(sessionId);
}

/** @param {ScopeRuntimeState} runtime */
export function ensureScopeInvalidationHook(runtime) {
    if (runtime.scopeInvalidationUnregister) return;
    if (!runtime.invalidationBus) return;
    runtime.scopeInvalidationUnregister = runtime.invalidationBus.registerHook((filePath, event) => {
        for (const scope of runtime.registry.values()) markScopePathInvalidated(scope, filePath, event);
    });
}

/** @param {ScopeRuntimeState} runtime */
export function releaseScopeInvalidationHookIfIdle(runtime) {
    if (runtime.registry.size !== 0 || !runtime.scopeInvalidationUnregister) return;
    runtime.scopeInvalidationUnregister();
    runtime.scopeInvalidationUnregister = null;
}
