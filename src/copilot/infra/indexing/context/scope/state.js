// @ts-check
/** Registry, bounded state and invariants for session scopes. No lifecycle orchestration lives here. */

import { registerIoInvalidationHook } from '#copilot/infra/internal/filesystem/invalidation';
import { readEnvPositiveInt } from '#copilot/infra/internal/platform';
import * as nodePath from 'node:path';

/** @typedef {import('./types.js')._InternalScope} _InternalScope */
/** @typedef {import('./types.js').ScopeFailureSummary} ScopeFailureSummary */

/** @type {Map<string, _InternalScope>} */
export const _registry = new Map();
/** @type {Map<string, Promise<void>>} */
export const _warmPromises = new Map();
/** @type {Map<string, AbortController>} */
export const _warmControllers = new Map();
/** @type {Map<string, Promise<'refreshed' | 'removed' | 'removed-failed' | 'failed'>>} */
export const _refreshingPaths = new Map();
/** @type {(() => void) | null} */
let _scopeInvalidationUnregister = null;

export const MAX_ACTIVE_SCOPES = readEnvPositiveInt('IO_MAX_ACTIVE_SCOPES', 10);

const SYMBOL_PARSE_EXTENSIONS = new Set(['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '.mts', '.cts']);

/**
 * @param {string} filePath
 * @returns {string}
 */
export function normalizeScopePath(filePath) {
    return nodePath.normalize(nodePath.resolve(filePath));
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isSymbolParseTarget(filePath) {
    return SYMBOL_PARSE_EXTENSIONS.has(nodePath.extname(filePath).toLowerCase());
}

/**
 * @param {import('#copilot/infra/internal/indexing/parser').FileSymbols} symbols
 * @returns {number}
 */
function estimateSymbolBytes(symbols) {
    try {
        return Buffer.byteLength(JSON.stringify(symbols), 'utf8');
    } catch {
        return 0;
    }
}

/**
 * @param {_InternalScope} scope
 * @param {string} filePath
 * @param {import('#copilot/infra/internal/indexing/parser').FileSymbols} symbols
 */
export function setScopeSymbols(scope, filePath, symbols) {
    const previous = scope.symbolBytesByPath.get(filePath) ?? 0;
    const next = estimateSymbolBytes(symbols);
    scope.symbolIndex.set(filePath, symbols);
    scope.symbolBytesByPath.set(filePath, next);
    scope.symbolBytes = Math.max(0, scope.symbolBytes - previous + next);
}

/**
 * @param {_InternalScope} scope
 * @param {string} filePath
 */
function deleteScopeSymbols(scope, filePath) {
    const previous = scope.symbolBytesByPath.get(filePath) ?? 0;
    scope.symbolIndex.delete(filePath);
    scope.symbolBytesByPath.delete(filePath);
    scope.symbolBytes = Math.max(0, scope.symbolBytes - previous);
}

/**
 * Remove um arquivo que deixou de existir (ou deixou de ser arquivo) do working set sem fazer backfill silencioso.
 * `candidateFiles`/selection permanecem como evidência da seleção original; `selectedFiles` acompanha o conjunto vivo.
 *
 * @param {_InternalScope} scope
 * @param {string} filePath
 */
export function removeScopePath(scope, filePath) {
    const normalized = normalizeScopePath(filePath);
    deleteScopeSymbols(scope, filePath);
    scope.paths = scope.paths.filter((candidate) => normalizeScopePath(candidate) !== normalized);
    for (const invalidatedPath of [...scope.invalidatedPaths]) {
        if (normalizeScopePath(invalidatedPath) === normalized) scope.invalidatedPaths.delete(invalidatedPath);
    }
    scope.selectedFiles = scope.paths.length;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isScopePathRemovalError(error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code ?? '') : '';
    return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}

/**
 * @param {_InternalScope} scope
 * @param {string} filePath
 * @param {{ recursive?: boolean }} [options]
 * @returns {boolean}
 */
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

/**
 * @param {_InternalScope} scope
 * @param {string} filePath
 * @param {{ recursive?: boolean }} [options]
 * @returns {void}
 */
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

/**
 * @param {_InternalScope} scope
 * @returns {'warming' | 'ready' | 'stale' | 'degraded'}
 */
export function getScopeStatus(scope) {
    if (scope.degraded) return 'degraded';
    if (scope.invalidatedPaths.size > 0) return 'stale';
    return scope.ready ? 'ready' : 'warming';
}

/**
 * @param {_InternalScope} scope
 * @param {unknown} error
 * @param {ScopeFailureSummary['phase']} phase
 * @param {string} summary
 */
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

/**
 * @param {_InternalScope} scope
 */
export function markScopeReady(scope) {
    scope.degraded = false;
    scope.ready = true;
    scope.lastError = null;
    scope.completedAt = Date.now();
}

/**
 * @param {_InternalScope} scope
 * @returns {void}
 */
export function touchScope(scope) {
    scope.lastAccessAt = Date.now();
}

/**
 * @param {string} sessionId
 * @returns {void}
 */
export function abortWarmForSession(sessionId) {
    const controller = _warmControllers.get(sessionId);
    if (controller && !controller.signal.aborted) {
        controller.abort();
    }
    _warmControllers.delete(sessionId);
}

export function ensureScopeInvalidationHook() {
    if (_scopeInvalidationUnregister) return;
    _scopeInvalidationUnregister = registerIoInvalidationHook((filePath, event) => {
        for (const scope of _registry.values()) markScopePathInvalidated(scope, filePath, event);
    });
}

export function releaseScopeInvalidationHookIfIdle() {
    if (_registry.size !== 0 || !_scopeInvalidationUnregister) return;
    _scopeInvalidationUnregister();
    _scopeInvalidationUnregister = null;
}
