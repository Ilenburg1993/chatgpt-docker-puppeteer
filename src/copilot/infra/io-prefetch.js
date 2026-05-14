// @ts-check
/**
 * src/copilot/infra/io-prefetch.js
 *
 * Sistema de prefetch inteligente do cache L1 para a LLM-B.
 *
 * Motivação: A LLM-B, ao iniciar uma sessão ou ao receber um escopo de trabalho, muitas vezes sabe de antemão quais
 * arquivos irá ler. Este módulo permite que ela pré-aqueça o cache L1 em background, de modo que as leituras
 * subsequentes sejam cache hits — sem latência de I/O.
 *
 * Capacidades:
 *
 * - `warmCacheForPaths(paths, opts)` — aquece L1 para uma lista de paths em paralelo controlado.
 * - `startSessionScope(sessionId, paths, opts)` — registra escopo nomeado (sessão LLM-B).
 * - `getSessionScopeStats(sessionId)` — hits/misses/preloaded do escopo.
 * - `endSessionScope(sessionId)` — deregistra escopo e retorna stats finais.
 * - `listSessionScopes()` — lista escopos ativos.
 * - `warmFromPattern(glob, opts)` — aquece por glob pattern (ex.: `src/copilot/**`).
 * - `warmFromRecentFiles(n, opts)` — aquece os N arquivos mais recentemente acessados no L1.
 *
 * Design:
 *
 * - Usa `readBytes` do io-engine para popular L1 via canal canônico (com policy, locks, trace).
 * - Concorrência controlada por `concurrency` (padrão: 8) para não saturar FS.
 * - Cada escopo tem `sessionId`, `paths`, contadores de hits/misses e `startedAt`.
 * - Erros de leitura são silenciosos por padrão (não quebram o loop LLM-B).
 *
 * @module copilot/infra/io-prefetch
 */

import { stat as fsStat } from 'node:fs/promises';
import * as nodePath from 'node:path';
import pLimit from 'p-limit';
import { getVerifiedIoL1Entry, makeBytesKey, makeTextKey, normalizeIoCacheKey } from './io-cache.js';
import { readBytes, readText } from './io-engine.js';
import { getIoIndex } from './io-index-registry.js';
import { parseAndCacheSymbols } from './io-parser.js';
import { scanDirectory } from './io-scanner.js';
import { matchesAnyPattern } from './scan/glob.js';

// ---------------------------------------------------------------------------
// Typedefs
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PrefetchOptions
 * @property {number} [concurrency=8] - Máximo de leituras paralelas. Default is `8`
 * @property {boolean} [textMode=true] - Se true, popula chave de texto além de bytes. Default is `true`
 * @property {boolean} [silent=true] - Se true, erros de leitura são ignorados (não jogados). Default is `true`
 * @property {AbortSignal} [signal] - Sinal para abortar o prefetch em andamento.
 */

/**
 * @typedef {object} SessionScopeStats
 * @property {string} sessionId - ID do escopo.
 * @property {number} preloaded - Arquivos efetivamente carregados no cache.
 * @property {number} failed - Arquivos que falharam durante prefetch.
 * @property {number} skipped - Arquivos pulados (já estavam no cache).
 * @property {number} durationMs - Duração total do warm-up em ms.
 * @property {number} pathCount - Total de paths registrados no escopo.
 * @property {boolean} active - Se o escopo ainda está ativo.
 */

/**
 * @typedef {object} _SessionScope
 * @property {string} sessionId
 * @property {string[]} paths
 * @property {number} preloaded
 * @property {number} failed
 * @property {number} skipped
 * @property {number} startedAt
 * @property {number | null} endedAt
 * @property {boolean} active
 */

// ---------------------------------------------------------------------------
// Session scope registry
// ---------------------------------------------------------------------------

/** @type {Map<string, _SessionScope>} */
const _scopes = new Map();

// ---------------------------------------------------------------------------
// Core: parallel warm-up
// ---------------------------------------------------------------------------

/**
 * Aquece o cache L1 para uma lista de paths, com concorrência controlada. Popula chave de bytes (e texto se
 * `textMode=true`).
 *
 * @param {string[]} paths - Lista de paths absolutos ou relativos.
 * @param {PrefetchOptions} [opts]
 * @returns {Promise<{ preloaded: number; failed: number; skipped: number; durationMs: number }>}
 */
export async function warmCacheForPaths(paths, opts = {}) {
    const { concurrency = 8, textMode = true, silent = true, signal } = opts;
    const t0 = Date.now();

    let preloaded = 0;
    let failed = 0;
    let skipped = 0;

    /**
     * Processa um path: verifica se já está no cache, se não, lê do disco.
     *
     * @param {string} filePath
     * @returns {Promise<void>}
     */
    async function processOne(filePath) {
        if (signal?.aborted) return;

        const normalized = normalizeIoCacheKey(filePath);
        const bytesKey = makeBytesKey(normalized);
        const textKey = makeTextKey(normalized, undefined, undefined);

        const cachedBytes = await getVerifiedIoL1Entry(bytesKey, filePath);
        const cachedText = textMode ? await getVerifiedIoL1Entry(textKey, filePath) : null;
        if (cachedBytes !== null && (!textMode || cachedText !== null)) {
            skipped++;
            return;
        }

        try {
            let warmed = false;
            const signalOptions = signal ? { signal } : {};

            if (cachedBytes === null) {
                await readBytes(filePath, signalOptions);
                warmed = true;
            }

            if (textMode && cachedText === null) {
                await readText(filePath, signalOptions);
                warmed = true;
            }

            if (warmed) preloaded++;
        } catch (err) {
            if (!silent) throw err;
            failed++;
        }
    }

    const normalizedConcurrency = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 8;
    const limit = pLimit(normalizedConcurrency);
    await Promise.all(
        paths.map((filePath) =>
            limit(async () => {
                if (signal?.aborted) return;
                await processOne(filePath);
            }),
        ),
    );

    return { preloaded, failed, skipped, durationMs: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// Session scope API
// ---------------------------------------------------------------------------

/**
 * Registra e aquece um escopo de sessão LLM-B. Chamado no início de uma sessão quando a LLM-B conhece seu conjunto de
 * trabalho.
 *
 * @param {string} sessionId - Identificador único da sessão LLM-B.
 * @param {string[]} paths - Paths a pré-carregar.
 * @param {PrefetchOptions} [opts]
 * @returns {Promise<SessionScopeStats>}
 */
export async function startSessionScope(sessionId, paths, opts = {}) {
    /** @type {_SessionScope} */
    const scope = {
        sessionId,
        paths: [...paths],
        preloaded: 0,
        failed: 0,
        skipped: 0,
        startedAt: Date.now(),
        endedAt: null,
        active: true,
    };
    _scopes.set(sessionId, scope);

    const result = await warmCacheForPaths(paths, opts);
    scope.preloaded = result.preloaded;
    scope.failed = result.failed;
    scope.skipped = result.skipped;

    return _toStats(scope, result.durationMs);
}

/**
 * Retorna estatísticas do escopo de sessão.
 *
 * @param {string} sessionId
 * @returns {SessionScopeStats | null}
 */
export function getSessionScopeStats(sessionId) {
    const scope = _scopes.get(sessionId);
    if (!scope) return null;
    return _toStats(
        scope,
        scope.active ? Date.now() - scope.startedAt : (scope.endedAt ?? Date.now()) - scope.startedAt,
    );
}

/**
 * Encerra o escopo de sessão e retorna stats finais.
 *
 * @param {string} sessionId
 * @returns {SessionScopeStats | null}
 */
export function endSessionScope(sessionId) {
    const scope = _scopes.get(sessionId);
    if (!scope) return null;
    scope.active = false;
    scope.endedAt = Date.now();
    const stats = _toStats(scope, scope.endedAt - scope.startedAt);
    _scopes.delete(sessionId);
    return stats;
}

/**
 * Lista IDs dos escopos de sessão ativos.
 *
 * @returns {string[]}
 */
export function listSessionScopes() {
    return [..._scopes.keys()];
}

// ---------------------------------------------------------------------------
// Pattern-based warm-up
// ---------------------------------------------------------------------------

/**
 * Aquece o cache L1 varrendo um diretório e filtrando por extensões de arquivo.
 *
 * @param {string} directory - Diretório raiz a escanear.
 * @param {object} [opts]
 * @param {string[]} [opts.extensions=['.js','.ts','.mjs','.json','.md']] - Extensões permitidas. Default is
 *   `['.js','.ts','.mjs','.json','.md']`
 * @param {number} [opts.maxFiles=500] - Quantidade sugerida para telemetry/advisory; não corta o scan. Default is `500`
 * @param {string[]} [opts.include] - Padrões glob simples para incluir arquivos.
 * @param {string[]} [opts.exclude] - Padrões glob simples para excluir arquivos.
 * @param {boolean} [opts.recursive=true] - Se false, escaneia apenas o diretório imediato. Default is `true`
 * @param {PrefetchOptions} [prefetchOpts]
 * @returns {Promise<{
 *     scanned: number;
 *     preloaded: number;
 *     failed: number;
 *     skipped: number;
 *     durationMs: number;
 *     paths: string[];
 *     advisoryLimits: Record<string, unknown>;
 * }>}
 */
export async function warmFromDirectory(directory, opts = {}, prefetchOpts = {}) {
    const {
        extensions = ['.js', '.ts', '.mjs', '.json', '.md'],
        maxFiles = 500,
        include = [],
        exclude = [],
        recursive = true,
    } = opts;

    const t0 = Date.now();
    const baseDir = nodePath.resolve(directory);

    // Escaneia diretório usando scanner canônico
    const scanResult = await scanDirectory(directory, {
        recursive,
        showHidden: false,
        depth: recursive ? 20 : 1,
        respectGitignore: true,
    });

    // Flatten recursivo das entradas aninhadas
    /** @param {import('./io-scanner.js').IoScanEntry[]} entries @returns {import('./io-scanner.js').IoScanEntry[]} */
    function flattenEntries(entries) {
        /** @type {import('./io-scanner.js').IoScanEntry[]} */
        const flat = [];
        for (const e of entries) {
            flat.push(e);
            if (e.children) flat.push(...flattenEntries(e.children));
        }
        return flat;
    }

    const allEntries = flattenEntries(scanResult.entries);

    // Filtra por extensão e tipo arquivo
    const files = allEntries
        .filter((e) => e.type === 'file' && extensions.includes(nodePath.extname(e.name).toLowerCase()))
        .filter((e) => include.length === 0 || matchesAnyPattern(e.absolutePath, baseDir, include))
        .filter((e) => exclude.length === 0 || !matchesAnyPattern(e.absolutePath, baseDir, exclude))
        .map((e) => e.absolutePath);

    const result = await warmCacheForPaths(files, prefetchOpts);

    return {
        scanned: scanResult.scannedEntries,
        ...result,
        durationMs: Date.now() - t0,
        paths: files,
        advisoryLimits: {
            requestedMaxFiles: maxFiles,
            selectedFiles: files.length,
            recursive,
            includePatternCount: include.length,
            excludePatternCount: exclude.length,
            limitMode: 'informative',
        },
    };
}

/**
 * Aquece os N arquivos mais recentemente acessados já presentes no L1 (renovação de TTL). Útil no início de um novo
 * turno para garantir que arquivos "quentes" do turno anterior não expirem durante o trabalho atual.
 *
 * @param {string[]} recentPaths - Lista de paths recentes (obtida de turn-trace-state ou activity).
 * @param {PrefetchOptions} [opts]
 * @returns {Promise<{ preloaded: number; failed: number; skipped: number; durationMs: number }>}
 */
export async function warmRecentPaths(recentPaths, opts = {}) {
    return warmCacheForPaths(recentPaths, opts);
}

/**
 * Aquece o contexto direto de uma leitura da LLM-B: garante L1 text/bytes do arquivo lido, materializa o índice L2 do
 * arquivo e, quando há imports relativos JS/TS, pré-aquece os alvos diretos. É read-through: parte da própria leitura
 * canônica e não cria uma base paralela.
 *
 * @param {string} filePath
 * @param {{
 *     workspaceRoot?: string;
 *     index?: boolean;
 *     relatedImports?: boolean;
 *     concurrency?: number;
 *     silent?: boolean;
 * }} [opts]
 * @returns {Promise<{
 *     filePath: string;
 *     indexed: boolean;
 *     relatedPaths: string[];
 *     relatedPreloaded: number;
 *     relatedFailed: number;
 *     durationMs: number;
 * }>}
 */
export async function warmReadThroughContext(filePath, opts = {}) {
    const startedAt = Date.now();
    const {
        workspaceRoot = nodePath.dirname(filePath),
        index = true,
        relatedImports = true,
        concurrency = 4,
        silent = true,
    } = opts;

    let indexed = false;
    /** @type {string[]} */
    let relatedPaths = [];
    let relatedPreloaded = 0;
    let relatedFailed = 0;

    try {
        const text = await readText(filePath);
        if (index) {
            const stats = await fsStat(filePath).catch(() => null);
            const indexStore = getIoIndex();
            if (indexStore && stats) {
                await indexStore.indexTextFile({
                    filePath,
                    workspaceRoot,
                    content: text.content,
                    sizeBytes: stats.size,
                    mtimeMs: stats.mtimeMs,
                    ctimeMs: stats.ctimeMs,
                    metadata: {
                        source: 'read-through',
                        limitMode: 'informative',
                    },
                });
                indexed = true;
            }
        }

        if (relatedImports) {
            const symbols = await parseAndCacheSymbols(filePath).catch(() => null);
            relatedPaths = await resolveRelativeImportTargets(filePath, symbols?.imports ?? []);
            if (relatedPaths.length > 0) {
                const warm = await warmCacheForPaths(relatedPaths, { concurrency, silent, textMode: true });
                relatedPreloaded = warm.preloaded;
                relatedFailed = warm.failed;
            }
        }
    } catch (error) {
        if (!silent) throw error;
    }

    return {
        filePath,
        indexed,
        relatedPaths,
        relatedPreloaded,
        relatedFailed,
        durationMs: Date.now() - startedAt,
    };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * @param {_SessionScope} scope
 * @param {number} durationMs
 * @returns {SessionScopeStats}
 */
function _toStats(scope, durationMs) {
    return {
        sessionId: scope.sessionId,
        preloaded: scope.preloaded,
        failed: scope.failed,
        skipped: scope.skipped,
        durationMs,
        pathCount: scope.paths.length,
        active: scope.active,
    };
}

const IMPORT_EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.json'];

/**
 * @param {string} sourceFile
 * @param {import('./io-parser.js').ImportEntry[]} imports
 * @returns {Promise<string[]>}
 */
async function resolveRelativeImportTargets(sourceFile, imports) {
    const baseDir = nodePath.dirname(sourceFile);
    /** @type {string[]} */
    const out = [];
    for (const entry of imports) {
        if (!entry.source.startsWith('.')) continue;
        const raw = nodePath.resolve(baseDir, entry.source);
        const candidates = IMPORT_EXTENSIONS.flatMap((ext) => [
            `${raw}${ext}`,
            nodePath.join(raw, `index${ext || '.js'}`),
        ]);
        for (const candidate of candidates) {
            const stat = await fsStat(candidate).catch(() => null);
            if (stat?.isFile()) {
                out.push(candidate);
                break;
            }
        }
    }
    return [...new Set(out)];
}
