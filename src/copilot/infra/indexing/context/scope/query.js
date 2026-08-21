// @ts-check
/** Read-only projections over active session-scope state. */

import * as nodePath from 'node:path';
import { getScopeStatus, touchScope } from './state.js';

/** @typedef {import('./types.js').ScopeStats} ScopeStats */
/** @typedef {import('./types.js').ScopeFailureSummary} ScopeFailureSummary */
/** @typedef {import('./types.js').SymbolSearchResult} SymbolSearchResult */

/**
 * @param {string} sessionId
 * @param {import('./state.js').ScopeRuntimeState} runtime
 * @param {boolean} updateAccess
 * @returns {ScopeStats | null}
 */
function projectScopeStats(sessionId, runtime, updateAccess) {
    const scope = runtime.registry.get(sessionId);
    if (!scope) return null;
    if (updateAccess) touchScope(scope);
    return {
        sessionId,
        pathCount: scope.paths.length,
        candidateFiles: scope.candidateFiles,
        selectedFiles: scope.selectedFiles,
        hardLimitReached: scope.hardLimitReached,
        selection: { ...scope.selection },
        preloaded: scope.preloaded,
        parsed: scope.symbolIndex.size,
        failed: scope.failed,
        invalidated: scope.invalidatedPaths.size,
        index: scope.index,
        symbolBytes: scope.symbolBytes,
        warmDurationMs: scope.warmDurationMs,
        ready: scope.ready,
        degraded: scope.degraded,
        status: getScopeStatus(scope),
        lastError: scope.lastError,
        startedAt: scope.startedAt,
        completedAt: scope.completedAt,
        maxActiveScopes: runtime.maxActiveScopes,
    };
}

/** @param {string} sessionId @param {import('./state.js').ScopeRuntimeState} runtime @returns {ScopeStats | null} */
export function getScopeStats(sessionId, runtime) {
    return projectScopeStats(sessionId, runtime, true);
}

/** Read-side projection that never updates LRU/eviction state. @param {string} sessionId @param {import('./state.js').ScopeRuntimeState} runtime */
export function peekScopeStats(sessionId, runtime) {
    return projectScopeStats(sessionId, runtime, false);
}

/**
 * Retorna o índice simbólico completo da sessão.
 *
 * @param {string} sessionId
 * @param {import('./state.js').ScopeRuntimeState} runtime
 * @returns {Map<string, import('#copilot/infra/internal/indexing/parser').FileSymbols> | null}
 */
export function getScopeSymbolIndex(sessionId, runtime) {
    const scope = runtime.registry.get(sessionId);
    if (!scope) return null;
    touchScope(scope);
    return scope.symbolIndex;
}

/**
 * Retorna uma decision surface bounded do working set: contagens, exports e um manifest compacto por arquivo com
 * imports. Conteúdo integral nunca é duplicado no contexto.
 *
 * @param {string} sessionId
 * @param {{ maxFiles?: number; maxBytes?: number } | undefined} options
 * @returns {{
 *     sessionId: string;
 *     files: number;
 *     candidateFiles: number;
 *     selectedFiles: number;
 *     hardLimitReached: boolean;
 *     symbols: number;
 *     symbolBytes: number;
 *     invalidated: number;
 *     topExports: string[];
 *     manifest: { path: string; symbolCount: number; exports: string[]; imports: string[]; stale: boolean }[];
 *     manifestTruncated: boolean;
 *     contextBytes: number;
 *     ready: boolean;
 *     degraded: boolean;
 *     status: ScopeStats['status'];
 *     lastError: ScopeFailureSummary | null;
 * } | null}
 * @param {import('./state.js').ScopeRuntimeState} runtime
 */
export function getScopeContext(sessionId, options, runtime) {
    options ??= {};
    const scope = runtime.registry.get(sessionId);
    if (!scope) return null;
    touchScope(scope);

    const requestedFiles = Number(options.maxFiles ?? 40);
    const requestedBytes = Number(options.maxBytes ?? 16 * 1024);
    const maxFiles = Number.isFinite(requestedFiles) ? Math.max(1, Math.min(200, Math.floor(requestedFiles))) : 40;
    const maxBytes = Number.isFinite(requestedBytes)
        ? Math.max(1024, Math.min(64 * 1024, Math.floor(requestedBytes)))
        : 16 * 1024;
    let totalSymbols = 0;
    const allExports = /** @type {string[]} */ ([]);
    /** @type {{ path: string; symbolCount: number; exports: string[]; imports: string[]; stale: boolean }[]} */
    const manifest = [];
    let manifestBytes = 0;
    let manifestTruncated = false;
    const manifestBudget = Math.max(0, maxBytes - 2048);

    for (const filePath of scope.paths) {
        const symbols = scope.symbolIndex.get(filePath);
        if (symbols) {
            totalSymbols += symbols.symbols.length;
            for (const s of symbols.symbols.filter((sym) => sym.exported)) {
                allExports.push(`${nodePath.basename(filePath)}::${s.name}(${s.kind})`);
            }
        }
        if (manifest.length >= maxFiles) {
            manifestTruncated = true;
            continue;
        }
        const entry = {
            path: scope.workspaceRoot
                ? nodePath.relative(scope.workspaceRoot, filePath).replace(/\\/gu, '/')
                : filePath,
            symbolCount: symbols?.symbols.length ?? 0,
            exports: (symbols?.symbols ?? [])
                .filter((symbol) => symbol.exported)
                .slice(0, 12)
                .map((symbol) => symbol.name),
            imports: [...new Set((symbols?.imports ?? []).map((entry) => entry.source))].slice(0, 12),
            stale: scope.invalidatedPaths.has(filePath),
        };
        const entryBytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
        if (manifestBytes + entryBytes > manifestBudget) {
            manifestTruncated = true;
            continue;
        }
        manifest.push(entry);
        manifestBytes += entryBytes;
    }

    const result = {
        sessionId,
        files: scope.paths.length,
        candidateFiles: scope.candidateFiles,
        selectedFiles: scope.selectedFiles,
        hardLimitReached: scope.hardLimitReached,
        symbols: totalSymbols,
        symbolBytes: scope.symbolBytes,
        invalidated: scope.invalidatedPaths.size,
        topExports: allExports.slice(0, 24),
        manifest,
        manifestTruncated,
        contextBytes: 0,
        contextBudgetBytes: maxBytes,
        ready: scope.ready,
        degraded: scope.degraded,
        status: getScopeStatus(scope),
        lastError: scope.lastError,
    };
    const measure = () => Buffer.byteLength(JSON.stringify(result), 'utf8');
    while (measure() > maxBytes && result.manifest.length > 0) {
        result.manifest.pop();
        result.manifestTruncated = true;
    }
    while (measure() > maxBytes && result.topExports.length > 0) result.topExports.pop();
    result.contextBytes = measure();
    result.contextBytes = measure();
    return result;
}

/**
 * Busca um símbolo por nome em todos os arquivos do escopo.
 *
 * @param {string} sessionId
 * @param {string} name - Nome exato ou prefixo do símbolo.
 * @param {{ exactMatch?: boolean } | undefined} opts
 * @param {import('./state.js').ScopeRuntimeState} runtime
 * @returns {SymbolSearchResult[]}
 */
export function findSymbol(sessionId, name, opts, runtime) {
    opts ??= {};
    const scope = runtime.registry.get(sessionId);
    if (!scope) return [];
    touchScope(scope);

    const { exactMatch = false } = opts;
    /** @type {SymbolSearchResult[]} */
    const results = [];

    for (const [filePath, fileSymbols] of scope.symbolIndex) {
        for (const symbol of fileSymbols.symbols) {
            const match = exactMatch ? symbol.name === name : symbol.name.toLowerCase().includes(name.toLowerCase());
            if (match) results.push({ filePath, symbol });
        }
    }

    return results;
}

/**
 * Lista IDs dos escopos ativos.
 *
 * @param {import('./state.js').ScopeRuntimeState} runtime
 * @returns {string[]}
 */
export function listScopes(runtime) {
    return [...runtime.registry.keys()];
}
