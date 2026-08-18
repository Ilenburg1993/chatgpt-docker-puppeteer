// @ts-check
/**
 * src/copilot/infra/io-session-scope.js
 *
 * API de escopo de sessão inteligente para a LLM-B.
 *
 * Motivação: Quando a LLM-B recebe um escopo de trabalho (um conjunto de arquivos, um diretório, uma feature), ela pode
 * declarar esse escopo uma vez e o sistema: 1. Pré-aquece o cache L1 em background (io-prefetch). 2. Parseia símbolos
 * dos arquivos JS/TS (io-parser com @babel/parser). 3. Mantém um índice simbólico da sessão consultável sem I/O. 4.
 * Invalida entradas relevantes quando arquivos são modificados. 5. Exporta snapshot de contexto resumido (outline +
 * imports + exports) para o turno.
 *
 * API pública:
 *
 * - `declareScope(opts)` — declara escopo, inicia prefetch+parse em background.
 * - `getScopeContext(sessionId)` — retorna contexto simbólico da sessão.
 * - `getScopeSymbolIndex(sessionId)` — retorna índice de símbolos por arquivo.
 * - `findSymbol(sessionId, name)` — busca símbolo por nome em todos os arquivos do escopo.
 * - `invalidateScopePath(sessionId, filePath)` — invalida L1 + símbolo cache para um path.
 * - `refreshScope(sessionId)` — re-parseia arquivos modificados desde o último refresh.
 * - `closeScope(sessionId)` — encerra escopo e libera recursos.
 * - `getScopeStats(sessionId)` — stats completas do escopo.
 *
 * @module copilot/infra/io-session-scope
 */

import * as nodePath from 'node:path';
import pLimit from 'p-limit';
import { invalidateIoCachePath, registerInvalidationHook } from './io-cache.js';
import { findIoIndexSymbol, refreshIoIndexPaths } from './io-index-registry.js';
import { invalidateParserCache, parseAndCacheSymbols } from './io-parser.js';
import { endSessionScope, startSessionScope, warmCacheForPaths, warmFromDirectory } from './io-prefetch.js';
import { publishIoLifecycleEvent } from './io-observability.js';
import { readEnvPositiveInt } from './shared/env.js';

// ---------------------------------------------------------------------------
// Typedefs
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ScopeDeclareOptions
 * @property {string} sessionId - ID único da sessão LLM-B.
 * @property {string[]} [paths] - Lista explícita de paths a incluir no escopo.
 * @property {string} [directory] - Diretório raiz a escanear (alternativo a paths).
 * @property {string} [workspaceRoot] - Raiz canônica usada pelo índice compartilhado; obrigatória para auto-index seguro.
 * @property {string[]} [extensions] - Extensões a incluir no scan de diretório.
 * @property {number} [maxFiles=500] - Limite efetivo de arquivos selecionados no scan de diretório. Default is `500`
 * @property {string[]} [include] - Padrões glob simples para incluir arquivos no escopo.
 * @property {string[]} [exclude] - Padrões glob simples para excluir arquivos do escopo.
 * @property {'coverage' | 'lexical'} [selectionMode='coverage'] - Política bounded de seleção em directory scopes.
 * @property {string[]} [preferredPaths] - Candidatos elegíveis a priorizar dentro do mesmo hard maxFiles cap.
 * @property {string[]} [seedSymbols] - Símbolos exatos resolvidos pelo índice local para preferred paths dentro do cap.
 * @property {boolean} [recursive=true] - Se false, declara apenas arquivos imediatos do diretório. Default is `true`
 * @property {boolean} [parseSymbols=true] - Se true, parseia símbolos JS/TS em background. Default is `true`
 * @property {'auto' | 'off'} [indexMode='auto'] - Se auto, materializa índice L2/FTS para diretórios declarados.
 *   Default is `'auto'`
 * @property {number} [concurrency=8] - Concorrência do prefetch. Default is `8`
 * @property {boolean} [silent=true] - Silencia erros de leitura/parse. Default is `true`
 */

/**
 * @typedef {{
 *     mode: 'coverage' | 'lexical' | 'explicit';
 *     candidateBuckets: number;
 *     selectedBuckets: number;
 *     preferredRequested: number;
 *     preferredSelected: number;
 *     seedSymbolsRequested: number;
 *     seedSymbolPathsResolved: number;
 * }} ScopeSelectionStats
 */

/**
 * @typedef {object} ScopeStats
 * @property {string} sessionId
 * @property {number} pathCount - Total de arquivos selecionados no escopo.
 * @property {number} candidateFiles - Arquivos candidatos antes do maxFiles no scan de diretório.
 * @property {number} selectedFiles - Arquivos efetivamente selecionados.
 * @property {boolean} hardLimitReached - Indica se maxFiles cortou candidatos do diretório.
 * @property {ScopeSelectionStats} selection - Resumo compacto da política de seleção aplicada.
 * @property {number} preloaded - Arquivos carregados no L1.
 * @property {number} parsed - Arquivos parseados.
 * @property {number} failed - Arquivos com falha.
 * @property {number} invalidated - Arquivos do escopo invalidados desde o último refresh.
 * @property {{ available: boolean; requested: number; indexed: number; unchanged: number; invalidated: number; snapshotReuses: number; parsedSymbolReuses: number; failed: number; durationMs: number; mode: 'selected-path-refresh' } | null} index
 * @property {number} symbolBytes - Estimativa UTF-8 do estado simbólico mantido pelo escopo.
 * @property {number} warmDurationMs - Duração do warm-up em ms.
 * @property {boolean} ready - Se o escopo está pronto (prefetch completo).
 * @property {boolean} degraded - Se o último warm-up/refresh terminou com falha.
 * @property {'warming' | 'ready' | 'stale' | 'degraded'} status
 * @property {ScopeFailureSummary | null} lastError - Erro sanitizado, sem path/mensagem crua.
 * @property {number} startedAt - Timestamp de início.
 * @property {number | null} completedAt - Timestamp do último warm-up/refresh concluído.
 * @property {number} maxActiveScopes - Capacidade máxima configurada para escopos ativos simultâneos.
 */

/**
 * @typedef {{
 *     phase: 'warm' | 'parse' | 'index' | 'refresh' | 'lifecycle';
 *     code: string;
 *     name: string;
 *     summary: string;
 *     atMs: number;
 * }} ScopeFailureSummary
 */

/**
 * @typedef {object} SymbolSearchResult
 * @property {string} filePath
 * @property {import('./io-parser.js').SymbolEntry} symbol
 */

/**
 * @typedef {object} _InternalScope
 * @property {string} sessionId
 * @property {string | null} workspaceRoot
 * @property {string | null} directory
 * @property {string[]} paths
 * @property {Map<string, import('./io-parser.js').FileSymbols>} symbolIndex
 * @property {Map<string, number>} symbolBytesByPath
 * @property {number} symbolBytes
 * @property {number} candidateFiles
 * @property {number} selectedFiles
 * @property {boolean} hardLimitReached
 * @property {ScopeSelectionStats} selection
 * @property {number} refreshConcurrency
 * @property {'auto' | 'off'} indexMode
 * @property {number} preloaded
 * @property {number} failed
 * @property {Set<string>} invalidatedPaths
 * @property {{ available: boolean; requested: number; indexed: number; unchanged: number; invalidated: number; snapshotReuses: number; parsedSymbolReuses: number; failed: number; durationMs: number; mode: 'selected-path-refresh' } | null} index
 * @property {number} warmDurationMs
 * @property {boolean} ready
 * @property {boolean} degraded
 * @property {ScopeFailureSummary | null} lastError
 * @property {number} startedAt
 * @property {number | null} completedAt
 * @property {number} lastAccessAt
 */

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** @type {Map<string, _InternalScope>} */
const _registry = new Map();
/** @type {Map<string, Promise<void>>} */
const _warmPromises = new Map();
/** @type {Map<string, AbortController>} */
const _warmControllers = new Map();
/** @type {Map<string, Promise<boolean>>} */
const _refreshingPaths = new Map();

const MAX_ACTIVE_SCOPES = readEnvPositiveInt('IO_MAX_ACTIVE_SCOPES', 10);

const SYMBOL_PARSE_EXTENSIONS = new Set(['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '.mts', '.cts']);

/**
 * @param {string} filePath
 * @returns {string}
 */
function normalizeScopePath(filePath) {
    return nodePath.normalize(nodePath.resolve(filePath));
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isSymbolParseTarget(filePath) {
    return SYMBOL_PARSE_EXTENSIONS.has(nodePath.extname(filePath).toLowerCase());
}

/**
 * @param {import('./io-parser.js').FileSymbols} symbols
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
 * @param {import('./io-parser.js').FileSymbols} symbols
 */
function setScopeSymbols(scope, filePath, symbols) {
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
 * @param {_InternalScope} scope
 * @param {string} filePath
 * @param {{ recursive?: boolean }} [options]
 * @returns {boolean}
 */
function scopeContainsPath(scope, filePath, options = {}) {
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
function getScopeStatus(scope) {
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
function recordScopeFailure(scope, error, phase, summary) {
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
function markScopeReady(scope) {
    scope.degraded = false;
    scope.ready = true;
    scope.lastError = null;
    scope.completedAt = Date.now();
}

/**
 * @param {_InternalScope} scope
 * @returns {void}
 */
function touchScope(scope) {
    scope.lastAccessAt = Date.now();
}

/**
 * @param {string} sessionId
 * @returns {void}
 */
function abortWarmForSession(sessionId) {
    const controller = _warmControllers.get(sessionId);
    if (controller && !controller.signal.aborted) {
        controller.abort();
    }
    _warmControllers.delete(sessionId);
}

/**
 * @param {string} incomingSessionId
 * @returns {void}
 */
function enforceScopeLimit(incomingSessionId) {
    if (_registry.has(incomingSessionId)) return;
    while (_registry.size >= MAX_ACTIVE_SCOPES) {
        let oldestSessionId = null;
        let oldestAccess = Number.POSITIVE_INFINITY;
        for (const [sessionId, scope] of _registry.entries()) {
            if (scope.lastAccessAt < oldestAccess) {
                oldestAccess = scope.lastAccessAt;
                oldestSessionId = sessionId;
            }
        }
        if (!oldestSessionId) break;
        publishIoLifecycleEvent('scope', 'evicted', {
            sessionId: oldestSessionId,
            activeScopes: _registry.size,
            maxActiveScopes: MAX_ACTIVE_SCOPES,
        });
        closeScope(oldestSessionId);
    }
}

registerInvalidationHook((filePath, event) => {
    for (const scope of _registry.values()) markScopePathInvalidated(scope, filePath, event);
});

// ---------------------------------------------------------------------------
// Scope lifecycle
// ---------------------------------------------------------------------------

/**
 * Declara um escopo de trabalho para a sessão LLM-B. Inicia prefetch + parse em background (não bloqueia). O chamador
 * pode fazer `await awaitReady()` para aguardar warm-up.
 *
 * @param {ScopeDeclareOptions} opts
 * @returns {{ sessionId: string; ready: boolean; awaitReady: () => Promise<ScopeStats> }}
 */
export function declareScope(opts) {
    const {
        sessionId,
        paths: explicitPaths,
        directory,
        extensions,
        include,
        exclude,
        selectionMode = 'coverage',
        preferredPaths = [],
        seedSymbols = [],
        recursive = true,
        maxFiles = 500,
        parseSymbols = true,
        indexMode = 'auto',
        concurrency = 8,
        silent = true,
    } = opts;

    const previousWarmPromise = _warmPromises.get(sessionId) ?? null;
    const warmController = new AbortController();

    enforceScopeLimit(sessionId);
    abortWarmForSession(sessionId);

    /** @type {_InternalScope} */
    const scope = {
        sessionId,
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
    _registry.set(sessionId, scope);
    _warmControllers.set(sessionId, warmController);

    // Inicia background warm-up
    const warmPromise = (async () => {
        try {
            if (previousWarmPromise) {
                await previousWarmPromise.catch(() => undefined);
            }

            let resolvedPaths = [...(explicitPaths ?? [])];
            /** @type {Map<string, import('./io/fs/read-text.js').TextFileSnapshot>} */
            const warmSnapshots = new Map();

            // Se um diretório foi fornecido, seleciona um working set bounded e aquece somente o L1 textual. O snapshot
            // retornado é efêmero e atravessa parser/index neste mesmo pipeline; não vira uma quarta cópia persistente.
            if (directory) {
                const uniqueSeedSymbols = [
                    ...new Set(seedSymbols.map((value) => String(value).trim()).filter(Boolean)),
                ].slice(0, 32);
                const symbolPreferredPaths = new Set();
                for (const seedSymbol of uniqueSeedSymbols) {
                    const rows = findIoIndexSymbol(seedSymbol, {
                        pathPrefix: directory,
                        exactMatch: true,
                        caseSensitive: false,
                        maxResults: 4,
                    });
                    for (const row of rows) {
                        if (typeof row.filePath === 'string' && row.filePath) symbolPreferredPaths.add(row.filePath);
                    }
                }
                const effectivePreferredPaths = [
                    ...new Set([...preferredPaths.map(normalizeScopePath), ...symbolPreferredPaths]),
                ];
                scope.selection.seedSymbolsRequested = uniqueSeedSymbols.length;
                scope.selection.seedSymbolPathsResolved = symbolPreferredPaths.size;
                const scanResult = await warmFromDirectory(
                    directory,
                    {
                        extensions,
                        maxFiles,
                        include,
                        exclude,
                        selectionMode,
                        preferredPaths: effectivePreferredPaths,
                        recursive,
                    },
                    {
                        concurrency,
                        silent,
                        textMode: true,
                        captureTextSnapshots: true,
                        cacheBytes: false,
                        signal: warmController.signal,
                    },
                );
                if (warmController.signal.aborted) return;
                scope.preloaded += scanResult.preloaded;
                scope.failed += scanResult.failed;
                scope.warmDurationMs += scanResult.durationMs;
                scope.candidateFiles = Number(scanResult.advisoryLimits['candidateFiles'] ?? scanResult.paths.length);
                scope.selectedFiles = Number(scanResult.advisoryLimits['selectedFiles'] ?? scanResult.paths.length);
                scope.hardLimitReached = Boolean(scanResult.advisoryLimits['hardLimitReached']);
                const selection = /** @type {Omit<ScopeSelectionStats, 'seedSymbolsRequested' | 'seedSymbolPathsResolved'> | undefined} */ (
                    scanResult.advisoryLimits['selection']
                );
                if (selection) {
                    scope.selection = {
                        ...selection,
                        seedSymbolsRequested: uniqueSeedSymbols.length,
                        seedSymbolPathsResolved: symbolPreferredPaths.size,
                    };
                }
                for (const [filePath, snapshot] of scanResult.snapshots ?? []) warmSnapshots.set(filePath, snapshot);

                resolvedPaths = [...new Set([...resolvedPaths, ...scanResult.paths])];
            } else if (explicitPaths && explicitPaths.length > 0) {
                const warm = await startSessionScope(sessionId, explicitPaths, {
                    concurrency,
                    silent,
                    captureTextSnapshots: true,
                    cacheBytes: false,
                    signal: warmController.signal,
                });
                if (warmController.signal.aborted) return;
                scope.preloaded += warm.preloaded;
                scope.failed += warm.failed;
                scope.warmDurationMs += warm.durationMs;
                scope.candidateFiles = explicitPaths.length;
                scope.selectedFiles = explicitPaths.length;
                for (const [filePath, snapshot] of warm.snapshots ?? []) warmSnapshots.set(filePath, snapshot);
            }

            scope.paths = resolvedPaths;

            if (parseSymbols && resolvedPaths.length > 0) {
                const parseTargets = resolvedPaths.filter(isSymbolParseTarget);
                let idx = 0;

                const parseWorker = async () => {
                    while (idx < parseTargets.length) {
                        if (warmController.signal.aborted) return;
                        const p = parseTargets[idx++];
                        if (!p) continue;
                        try {
                            const snapshot = warmSnapshots.get(p);
                            const symbols = await parseAndCacheSymbols(p, {
                                ...(snapshot ? { snapshot } : {}),
                                signal: warmController.signal,
                            });
                            setScopeSymbols(scope, p, symbols);
                        } catch (parseErr) {
                            if (!silent) throw parseErr;
                            scope.failed++;
                            recordScopeFailure(scope, parseErr, 'parse', 'análise de símbolos falhou durante aquecimento');
                        }
                    }
                };

                await Promise.all(
                    Array.from({ length: Math.min(scope.refreshConcurrency, parseTargets.length || 1) }, () => parseWorker()),
                );
            }

            // `auto` significa convergir apenas o working set selecionado no índice global. Nunca faz full directory build
            // implícito e nunca redefine workspaceRoot/relative_path usando o subdiretório do escopo.
            if (indexMode !== 'off' && scope.workspaceRoot && resolvedPaths.length > 0) {
                if (warmController.signal.aborted) return;
                const indexResult = await refreshIoIndexPaths(resolvedPaths, {
                    workspaceRoot: scope.workspaceRoot,
                    ...(extensions !== undefined ? { extensions } : {}),
                    snapshots: warmSnapshots,
                    parsedSymbols: scope.symbolIndex,
                    signal: warmController.signal,
                });
                scope.index = {
                    available: Boolean(indexResult.available),
                    requested: Number(indexResult.requested ?? resolvedPaths.length),
                    indexed: Number(indexResult.indexed ?? 0),
                    unchanged: Number(indexResult.unchanged ?? 0),
                    invalidated: Number(indexResult.invalidated ?? 0),
                    snapshotReuses: Number(indexResult.snapshotReuses ?? 0),
                    parsedSymbolReuses: Number(indexResult.parsedSymbolReuses ?? 0),
                    failed: Number(indexResult.failed ?? 0),
                    durationMs: Number(indexResult.durationMs ?? 0),
                    mode: 'selected-path-refresh',
                };
                if (scope.index.failed > 0) {
                    scope.failed += scope.index.failed;
                    recordScopeFailure(scope, { code: 'EINDEXPARTIAL', name: 'ScopeIndexError' }, 'index', 'índice do working set terminou com falhas');
                }
            }

            if (warmController.signal.aborted) return;
            if (scope.failed > 0) {
                if (!scope.degraded) {
                    recordScopeFailure(
                        scope,
                        { code: 'ESCOPEPARTIAL', name: 'ScopeWarmError' },
                        'warm',
                        'aquecimento do escopo terminou com falhas',
                    );
                }
                scope.completedAt = Date.now();
            } else {
                markScopeReady(scope);
            }
        } catch (error) {
            if (!warmController.signal.aborted) {
                scope.failed++;
                recordScopeFailure(scope, error, 'warm', 'aquecimento do escopo falhou');
                scope.completedAt = Date.now();
            }
        } finally {
            if (_warmControllers.get(sessionId) === warmController) {
                _warmControllers.delete(sessionId);
            }
        }
    })();
    _warmPromises.set(sessionId, warmPromise);

    return {
        sessionId,
        ready: false,
        awaitReady: async () => {
            await (_warmPromises.get(sessionId) ?? Promise.resolve());
            return (
                getScopeStats(sessionId) ?? {
                    sessionId,
                    pathCount: 0,
                    candidateFiles: 0,
                    selectedFiles: 0,
                    hardLimitReached: false,
                    selection: { ...scope.selection },
                    preloaded: 0,
                    parsed: 0,
                    failed: 0,
                    invalidated: 0,
                    index: null,
                    symbolBytes: 0,
                    warmDurationMs: 0,
                    ready: false,
                    degraded: true,
                    status: /** @type {const} */ ('degraded'),
                    lastError: {
                        phase: /** @type {const} */ ('lifecycle'),
                        code: 'ESCOPECLOSED',
                        name: 'ScopeLifecycleError',
                        summary: 'escopo fechado antes do snapshot de prontidão',
                        atMs: Date.now(),
                    },
                    startedAt: scope.startedAt,
                    completedAt: Date.now(),
                    maxActiveScopes: MAX_ACTIVE_SCOPES,
                }
            );
        },
    };
}

/**
 * Retorna stats do escopo de sessão.
 *
 * @param {string} sessionId
 * @returns {ScopeStats | null}
 */
export function getScopeStats(sessionId) {
    const scope = _registry.get(sessionId);
    if (!scope) return null;
    touchScope(scope);
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
        maxActiveScopes: MAX_ACTIVE_SCOPES,
    };
}

/**
 * Retorna o índice simbólico completo da sessão.
 *
 * @param {string} sessionId
 * @returns {Map<string, import('./io-parser.js').FileSymbols> | null}
 */
export function getScopeSymbolIndex(sessionId) {
    const scope = _registry.get(sessionId);
    if (!scope) return null;
    touchScope(scope);
    return scope.symbolIndex;
}

/**
 * Retorna uma decision surface bounded do working set: contagens, exports e um manifest compacto por arquivo com imports.
 * Conteúdo integral nunca é duplicado no contexto.
 *
 * @param {string} sessionId
 * @param {{ maxFiles?: number; maxBytes?: number }} [options]
 * @returns {{ sessionId: string; files: number; candidateFiles: number; selectedFiles: number; hardLimitReached: boolean; symbols: number; symbolBytes: number; invalidated: number; topExports: string[]; manifest: Array<{ path: string; symbolCount: number; exports: string[]; imports: string[]; stale: boolean }>; manifestTruncated: boolean; contextBytes: number; ready: boolean; degraded: boolean; status: ScopeStats['status']; lastError: ScopeFailureSummary | null } | null}
 */
export function getScopeContext(sessionId, options = {}) {
    const scope = _registry.get(sessionId);
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
    /** @type {Array<{ path: string; symbolCount: number; exports: string[]; imports: string[]; stale: boolean }>} */
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
            exports: (symbols?.symbols ?? []).filter((symbol) => symbol.exported).slice(0, 12).map((symbol) => symbol.name),
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
 * @param {{ exactMatch?: boolean }} [opts]
 * @returns {SymbolSearchResult[]}
 */
export function findSymbol(sessionId, name, opts = {}) {
    const scope = _registry.get(sessionId);
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
 * Invalida L1 cache e símbolo cache para um path específico. Chamado automaticamente pelo io-engine após escritas —
 * pode ser chamado manualmente.
 *
 * @param {string} sessionId
 * @param {string} filePath
 * @returns {void}
 */
export function invalidateScopePath(sessionId, filePath) {
    const scope = _registry.get(sessionId);
    // Invalida L1 global (independente do escopo)
    invalidateIoCachePath(filePath);
    invalidateParserCache(filePath);
    // Remove do índice simbólico da sessão para forçar re-parse no próximo acesso
    if (scope) {
        markScopePathInvalidated(scope, filePath);
    }
}

/**
 * Atualiza somente o delta conhecido do working set. Sem modifiedPaths e sem invalidations pendentes, é no-op O(1);
 * refresh integral exige que o caller forneça explicitamente os paths.
 *
 * @param {string} sessionId
 * @param {string[]} [modifiedPaths] - Paths explicitamente alterados; quando omitido usa somente invalidatedPaths.
 * @returns {Promise<{ refreshed: number; failed: number; skipped: number }>}
 */
export async function refreshScope(sessionId, modifiedPaths) {
    const scope = _registry.get(sessionId);
    if (!scope) return { refreshed: 0, failed: 0, skipped: 0 };
    touchScope(scope);

    const targets = [...new Set((modifiedPaths ?? [...scope.invalidatedPaths]).map(normalizeScopePath))];
    let refreshed = 0;
    let failed = 0;
    let skipped = 0;
    if (targets.length === 0) return { refreshed, failed, skipped };

    const limit = pLimit(scope.refreshConcurrency);
    await Promise.all(
        targets.map((p) =>
            limit(async () => {
                if (!scopeContainsPath(scope, p)) {
                    skipped++;
                    return;
                }
                const refreshKey = `${sessionId}\u0000${p}`;
                const inProgress = _refreshingPaths.get(refreshKey);
                if (inProgress) {
                    await inProgress;
                    return;
                }
                const refreshPromise = (async () => {
                    try {
                        invalidateParserCache(p);
                        invalidateIoCachePath(p);
                        const warm = await warmCacheForPaths([p], {
                            concurrency: 1,
                            silent: false,
                            captureTextSnapshots: true,
                            cacheBytes: false,
                        });
                        const snapshot = warm.snapshots?.get(p);
                        if (!snapshot) throw new Error('scope refresh snapshot unavailable');
                        const symbols = await parseAndCacheSymbols(p, { snapshot });
                        if (scope.indexMode !== 'off' && scope.workspaceRoot) {
                            const indexResult = await refreshIoIndexPaths([p], {
                                workspaceRoot: scope.workspaceRoot,
                                snapshots: new Map([[p, snapshot]]),
                                parsedSymbols: new Map([[p, symbols]]),
                            });
                            if (Number(indexResult.failed ?? 0) > 0) {
                                throw new Error('scope refresh index update failed');
                            }
                        }
                        setScopeSymbols(scope, p, symbols);
                        scope.invalidatedPaths.delete(p);
                        return true;
                    } catch (error) {
                        recordScopeFailure(scope, error, 'refresh', 'atualização do escopo falhou');
                        return false;
                    }
                })();
                _refreshingPaths.set(refreshKey, refreshPromise);
                try {
                    const succeeded = await refreshPromise;
                    if (succeeded) refreshed++;
                    else failed++;
                } finally {
                    if (_refreshingPaths.get(refreshKey) === refreshPromise) _refreshingPaths.delete(refreshKey);
                }
            }),
        ),
    );

    scope.completedAt = Date.now();
    if (failed === 0 && scope.invalidatedPaths.size === 0) {
        markScopeReady(scope);
    } else {
        scope.ready = false;
        scope.degraded = failed > 0;
    }
    return { refreshed, failed, skipped };
}

/**
 * Encerra escopo de sessão e libera recursos.
 *
 * @param {string} sessionId
 * @returns {ScopeStats | null}
 */
export function closeScope(sessionId) {
    const stats = getScopeStats(sessionId);
    abortWarmForSession(sessionId);
    _registry.delete(sessionId);
    _warmPromises.delete(sessionId);
    // Tenta encerrar escopo de prefetch também (best-effort)
    endSessionScope(sessionId);
    return stats;
}

/**
 * Lista IDs dos escopos ativos.
 *
 * @returns {string[]}
 */
export function listScopes() {
    return [..._registry.keys()];
}
