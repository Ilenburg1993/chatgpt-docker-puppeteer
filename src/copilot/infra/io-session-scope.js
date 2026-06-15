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
import { invalidateIoCachePath, registerInvalidationHook } from './io-cache.js';
import { buildIoIndexForDirectory } from './io-index-registry.js';
import { invalidateParserCache, parseAndCacheSymbols } from './io-parser.js';
import { endSessionScope, startSessionScope, warmFromDirectory } from './io-prefetch.js';
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
 * @property {string[]} [extensions] - Extensões a incluir no scan de diretório.
 * @property {number} [maxFiles=500] - Quantidade sugerida/advisory para o scan. Não corta o escopo. Default is `500`
 * @property {string[]} [include] - Padrões glob simples para incluir arquivos no escopo.
 * @property {string[]} [exclude] - Padrões glob simples para excluir arquivos do escopo.
 * @property {boolean} [recursive=true] - Se false, declara apenas arquivos imediatos do diretório. Default is `true`
 * @property {boolean} [parseSymbols=true] - Se true, parseia símbolos JS/TS em background. Default is `true`
 * @property {'auto' | 'off'} [indexMode='auto'] - Se auto, materializa índice L2/FTS para diretórios declarados.
 *   Default is `'auto'`
 * @property {number} [concurrency=8] - Concorrência do prefetch. Default is `8`
 * @property {boolean} [silent=true] - Silencia erros de leitura/parse. Default is `true`
 */

/**
 * @typedef {object} ScopeStats
 * @property {string} sessionId
 * @property {number} pathCount - Total de arquivos no escopo.
 * @property {number} preloaded - Arquivos carregados no L1.
 * @property {number} parsed - Arquivos parseados.
 * @property {number} failed - Arquivos com falha.
 * @property {number} invalidated - Arquivos do escopo invalidados desde o último refresh.
 * @property {{ available: boolean; indexed: number; failed: number; durationMs: number } | null} index
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
 * @property {string[]} paths
 * @property {Map<string, import('./io-parser.js').FileSymbols>} symbolIndex
 * @property {number} preloaded
 * @property {number} failed
 * @property {Set<string>} invalidatedPaths
 * @property {{ available: boolean; indexed: number; failed: number; durationMs: number } | null} index
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
            scope.symbolIndex.delete(indexedPath);
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
        paths: explicitPaths ? [...explicitPaths] : [],
        symbolIndex: new Map(),
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

            // Se um diretório foi fornecido, escaneia e combina
            if (directory) {
                const scanResult = await warmFromDirectory(
                    directory,
                    { extensions, maxFiles, include, exclude, recursive },
                    { concurrency, silent, textMode: true, signal: warmController.signal },
                );
                if (warmController.signal.aborted) return;
                scope.preloaded += scanResult.preloaded;
                scope.failed += scanResult.failed;
                scope.warmDurationMs += scanResult.durationMs;

                resolvedPaths = [...new Set([...resolvedPaths, ...scanResult.paths])];
            } else if (explicitPaths && explicitPaths.length > 0) {
                // Prefetch direto dos paths explícitos
                const warm = await startSessionScope(sessionId, explicitPaths, {
                    concurrency,
                    silent,
                    signal: warmController.signal,
                });
                if (warmController.signal.aborted) return;
                scope.preloaded += warm.preloaded;
                scope.failed += warm.failed;
                scope.warmDurationMs += warm.durationMs;
            }

            scope.paths = resolvedPaths;

            // Parse simbólico em background
            if (parseSymbols && resolvedPaths.length > 0) {
                const jsExts = new Set(['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '.mts', '.cts']);
                const parseTargets = resolvedPaths.filter((p) => jsExts.has(nodePath.extname(p).toLowerCase()));

                let parsed = 0;
                let idx = 0;

                const parseWorker = async () => {
                    while (idx < parseTargets.length) {
                        if (warmController.signal.aborted) return;
                        const p = parseTargets[idx++];
                        if (!p) continue;
                        try {
                            const symbols = await parseAndCacheSymbols(p, { signal: warmController.signal });
                            scope.symbolIndex.set(p, symbols);
                            parsed++;
                        } catch (parseErr) {
                            if (!silent) throw parseErr;
                            scope.failed++;
                            recordScopeFailure(scope, parseErr, 'parse', 'análise de símbolos falhou durante aquecimento');
                        }
                    }
                };

                await Promise.all(
                    Array.from({ length: Math.min(concurrency, parseTargets.length || 1) }, () => parseWorker()),
                );

                void parsed; // usado acima
            }

            if (directory && indexMode !== 'off') {
                if (warmController.signal.aborted) return;
                /** @type {Parameters<typeof buildIoIndexForDirectory>[1]} */
                const indexOptions = {
                    recursive,
                    concurrency,
                    signal: warmController.signal,
                };
                if (extensions !== undefined) indexOptions.extensions = extensions;
                if (include !== undefined) indexOptions.include = include;
                if (exclude !== undefined) indexOptions.exclude = exclude;
                const indexResult = await buildIoIndexForDirectory(directory, indexOptions);
                scope.index = {
                    available: Boolean(indexResult.available),
                    indexed: Number(indexResult.indexed ?? 0),
                    failed: Number(indexResult.failed ?? 0),
                    durationMs: Number(indexResult.durationMs ?? 0),
                };
                if (scope.index.failed > 0) {
                    scope.failed += scope.index.failed;
                    recordScopeFailure(scope, { code: 'EINDEXPARTIAL', name: 'ScopeIndexError' }, 'index', 'índice do escopo terminou com falhas');
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
                    preloaded: 0,
                    parsed: 0,
                    failed: 0,
                    invalidated: 0,
                    index: null,
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
        preloaded: scope.preloaded,
        parsed: scope.symbolIndex.size,
        failed: scope.failed,
        invalidated: scope.invalidatedPaths.size,
        index: scope.index,
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
 * Retorna contexto resumido da sessão para incluir em um turno LLM-B. Inclui: lista de arquivos, total de símbolos,
 * exports mais relevantes.
 *
 * @param {string} sessionId
 * @returns {{ sessionId: string; files: number; symbols: number; topExports: string[]; ready: boolean; degraded: boolean; status: ScopeStats['status']; lastError: ScopeFailureSummary | null } | null}
 */
export function getScopeContext(sessionId) {
    const scope = _registry.get(sessionId);
    if (!scope) return null;
    touchScope(scope);

    let totalSymbols = 0;
    const allExports = /** @type {string[]} */ ([]);

    for (const [filePath, symbols] of scope.symbolIndex) {
        totalSymbols += symbols.symbols.length;
        for (const s of symbols.symbols.filter((sym) => sym.exported)) {
            allExports.push(`${nodePath.basename(filePath)}::${s.name}(${s.kind})`);
        }
    }

    return {
        sessionId,
        files: scope.paths.length,
        symbols: totalSymbols,
        topExports: allExports.slice(0, 50),
        ready: scope.ready,
        degraded: scope.degraded,
        status: getScopeStatus(scope),
        lastError: scope.lastError,
    };
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
 * Re-parseia arquivos do escopo que foram modificados (sem re-warm de L1). Útil quando a LLM-B faz edições e quer
 * manter o índice fresco.
 *
 * @param {string} sessionId
 * @param {string[]} [modifiedPaths] - Se fornecido, re-parseia só esses. Senão, re-parseia tudo.
 * @returns {Promise<{ refreshed: number; failed: number }>}
 */
export async function refreshScope(sessionId, modifiedPaths) {
    const scope = _registry.get(sessionId);
    if (!scope) return { refreshed: 0, failed: 0 };
    touchScope(scope);

    const invalidatedTargets = [...scope.invalidatedPaths];
    const targets =
        modifiedPaths ??
        (invalidatedTargets.length > 0
            ? invalidatedTargets
            : scope.paths.filter((p) => scope.symbolIndex.has(p) || isSymbolParseTarget(p)));
    let refreshed = 0;
    let failed = 0;

    if (targets.length === 0) {
        return { refreshed, failed };
    }

    for (const p of targets) {
        const refreshKey = `${sessionId}\u0000${normalizeScopePath(p)}`;
        const inProgress = _refreshingPaths.get(refreshKey);
        if (inProgress) {
            await inProgress;
            continue;
        }
        const refreshPromise = (async () => {
            try {
                invalidateParserCache(p);
                invalidateIoCachePath(p);
                const symbols = await parseAndCacheSymbols(p);
                if (!scopeContainsPath(scope, p)) scope.paths.push(p);
                scope.symbolIndex.set(p, symbols);
                scope.invalidatedPaths.delete(p);
                return true;
            } catch (error) {
                recordScopeFailure(scope, error, 'refresh', 'atualização do escopo falhou');
                return false;
            }
        })();
        _refreshingPaths.set(refreshKey, refreshPromise);
        const succeeded = await refreshPromise;
        if (_refreshingPaths.get(refreshKey) === refreshPromise) _refreshingPaths.delete(refreshKey);
        if (succeeded) refreshed++;
        else failed++;
    }

    scope.completedAt = Date.now();
    if (failed === 0 && scope.invalidatedPaths.size === 0) {
        markScopeReady(scope);
    } else {
        scope.ready = false;
        scope.degraded = failed > 0;
    }
    return { refreshed, failed };
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
