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
 * @property {number} startedAt - Timestamp de início.
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
 * @property {number} startedAt
 * @property {Promise<void>} _warmPromise
 */

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** @type {Map<string, _InternalScope>} */
const _registry = new Map();

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

registerInvalidationHook((filePath, event) => {
    for (const scope of _registry.values()) markScopePathInvalidated(scope, filePath, event);
});

// ---------------------------------------------------------------------------
// Scope lifecycle
// ---------------------------------------------------------------------------

/**
 * Declara um escopo de trabalho para a sessão LLM-B. Inicia prefetch + parse em background (não bloqueia). O chamador
 * pode fazer `await scope._warmPromise` se quiser aguardar.
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
        startedAt: Date.now(),
        _warmPromise: Promise.resolve(),
    };
    _registry.set(sessionId, scope);

    // Inicia background warm-up
    scope._warmPromise = (async () => {
        try {
            let resolvedPaths = [...(explicitPaths ?? [])];

            // Se um diretório foi fornecido, escaneia e combina
            if (directory) {
                const scanResult = await warmFromDirectory(
                    directory,
                    { extensions, maxFiles, include, exclude, recursive },
                    { concurrency, silent, textMode: true },
                );
                scope.preloaded += scanResult.preloaded;
                scope.failed += scanResult.failed;
                scope.warmDurationMs += scanResult.durationMs;

                resolvedPaths = [...new Set([...resolvedPaths, ...scanResult.paths])];
            } else if (explicitPaths && explicitPaths.length > 0) {
                // Prefetch direto dos paths explícitos
                const warm = await startSessionScope(sessionId, explicitPaths, { concurrency, silent });
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
                        const p = parseTargets[idx++];
                        if (!p) continue;
                        try {
                            const symbols = await parseAndCacheSymbols(p);
                            scope.symbolIndex.set(p, symbols);
                            parsed++;
                        } catch (parseErr) {
                            if (!silent) throw parseErr;
                        }
                    }
                };

                await Promise.all(
                    Array.from({ length: Math.min(concurrency, parseTargets.length || 1) }, () => parseWorker()),
                );

                void parsed; // usado acima
            }

            if (directory && indexMode !== 'off') {
                /** @type {Parameters<typeof buildIoIndexForDirectory>[1]} */
                const indexOptions = {
                    recursive,
                    concurrency,
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
            }

            scope.ready = true;
        } catch {
            scope.ready = true; // marca ready mesmo em erro para não travar awaitReady
        }
    })();

    return {
        sessionId,
        ready: false,
        awaitReady: async () => {
            await scope._warmPromise;
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
                    ready: true,
                    startedAt: scope.startedAt,
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
        startedAt: scope.startedAt,
    };
}

/**
 * Retorna o índice simbólico completo da sessão.
 *
 * @param {string} sessionId
 * @returns {Map<string, import('./io-parser.js').FileSymbols> | null}
 */
export function getScopeSymbolIndex(sessionId) {
    return _registry.get(sessionId)?.symbolIndex ?? null;
}

/**
 * Retorna contexto resumido da sessão para incluir em um turno LLM-B. Inclui: lista de arquivos, total de símbolos,
 * exports mais relevantes.
 *
 * @param {string} sessionId
 * @returns {{ sessionId: string; files: number; symbols: number; topExports: string[]; ready: boolean } | null}
 */
export function getScopeContext(sessionId) {
    const scope = _registry.get(sessionId);
    if (!scope) return null;

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

    const invalidatedTargets = [...scope.invalidatedPaths];
    const targets =
        modifiedPaths ??
        (invalidatedTargets.length > 0
            ? invalidatedTargets
            : scope.paths.filter((p) => scope.symbolIndex.has(p) || isSymbolParseTarget(p)));
    let refreshed = 0;
    let failed = 0;

    for (const p of targets) {
        try {
            invalidateParserCache(p);
            invalidateIoCachePath(p);
            const symbols = await parseAndCacheSymbols(p);
            if (!scopeContainsPath(scope, p)) scope.paths.push(p);
            scope.symbolIndex.set(p, symbols);
            scope.invalidatedPaths.delete(p);
            refreshed++;
        } catch {
            failed++;
        }
    }

    scope.ready = true;
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
    _registry.delete(sessionId);
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
