// @ts-check
/** Read-through context warm-up with parser/index reuse and relative-import expansion. */

import { makeBytesKey, makeTextKey, normalizeIoCacheKey } from '#copilot/infra/internal/cache/keys';
import { readTextFileSnapshot } from '#copilot/infra/internal/filesystem/read';
import { parseAndCacheSymbols } from '#copilot/infra/internal/indexing/parser/cache';
import { sha256, toOwnedBuffer } from '#copilot/infra/internal/platform';
import { stat as fsStat } from 'node:fs/promises';
import * as nodePath from 'node:path';
import { primeIoL1Entry, resolvePrefetchL1Cache, warmCacheForPaths } from './cache-warm.js';

/**
 * @param {string} filePath
 * @param {{
 *     workspaceRoot?: string;
 *     index?: boolean;
 *     relatedImports?: boolean;
 *     concurrency?: number;
 *     silent?: boolean;
 *     cacheBytes?: boolean;
 *     indexRegistry?: ReturnType<typeof import('../../registry/instance/index.js').createIoIndexRegistryRuntime>;
 *     cacheRuntime?: {l1:ReturnType<typeof import('#copilot/infra/internal/cache/memory/runtime').createIoL1CacheRuntime>};
 *     parserCacheRuntime?: ReturnType<typeof import('../../parser/cache/runtime/index.js').createParserCacheRuntime>;
 * }} [opts]
 * @returns {Promise<{
 *     filePath: string;
 *     indexed: boolean;
 *     reusedTextCache: boolean;
 *     primedByteCache: boolean;
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
        cacheBytes = true,
    } = opts;

    const cache = resolvePrefetchL1Cache(opts);
    let indexed = false;
    let reusedTextCache = false;
    let primedByteCache = false;
    /** @type {string[]} */
    let relatedPaths = [];
    let relatedPreloaded = 0;
    let relatedFailed = 0;

    try {
        const normalized = normalizeIoCacheKey(filePath);
        const textKey = makeTextKey(normalized, undefined, undefined);
        const cachedText = await cache.getVerified(textKey, filePath);
        const canReuseTextCache =
            cachedText !== null &&
            typeof cachedText.content === 'string' &&
            Number.isFinite(cachedText.size) &&
            Number.isFinite(cachedText.mtime) &&
            Number.isFinite(cachedText.ctime) &&
            Number.isFinite(cachedText.dev) &&
            Number.isFinite(cachedText.ino);
        const text = canReuseTextCache
            ? {
                  path: filePath,
                  content: /** @type {string} */ (cachedText.content),
                  bytesRead: /** @type {NonNullable<typeof cachedText>} */ (cachedText).bytes,
                  sizeBytes: Number(/** @type {NonNullable<typeof cachedText>} */ (cachedText).size),
                  mtimeMs: Number(/** @type {NonNullable<typeof cachedText>} */ (cachedText).mtime),
                  ctimeMs: Number(/** @type {NonNullable<typeof cachedText>} */ (cachedText).ctime),
                  dev: Number(/** @type {NonNullable<typeof cachedText>} */ (cachedText).dev),
                  ino: Number(/** @type {NonNullable<typeof cachedText>} */ (cachedText).ino),
                  attempts: 0,
                  consistent: /** @type {const} */ (true),
              }
            : await readTextFileSnapshot(filePath);
        reusedTextCache = canReuseTextCache;
        const textHash = sha256(text.content);
        if (!reusedTextCache) {
            primeIoL1Entry(
                textKey,
                text.content,
                {
                    sizeBytes: text.sizeBytes,
                    mtimeMs: text.mtimeMs,
                    ctimeMs: text.ctimeMs,
                    dev: text.dev,
                    ino: text.ino,
                    contentHash: textHash,
                },
                cache,
            );
        }
        if (cacheBytes) {
            primeIoL1Entry(
                makeBytesKey(normalized),
                toOwnedBuffer(text.content),
                {
                    sizeBytes: text.sizeBytes,
                    mtimeMs: text.mtimeMs,
                    ctimeMs: text.ctimeMs,
                    dev: text.dev,
                    ino: text.ino,
                    contentHash: textHash,
                },
                cache,
            );
            primedByteCache = true;
        }

        // Quando o caller também pediu imports relacionados, parseamos uma única vez a partir do snapshot já lido e
        // entregamos a mesma projeção ao índice. Antes, `indexTextFile()` parseava JS/TS e `parseAndCacheSymbols()`
        // repetia imediatamente o mesmo Babel parse para descobrir imports.
        const symbols = relatedImports
            ? await parseAndCacheSymbols(filePath, {
                  snapshot: text,
                  ...(opts.parserCacheRuntime ? { parserCacheRuntime: opts.parserCacheRuntime } : {}),
              }).catch(() => null)
            : null;

        if (index) {
            const indexStore =
                /**
                 * @type {{
                 *     indexTextFile?: (
                 *         input: {
                 *             filePath: string;
                 *             workspaceRoot: string;
                 *             content: string;
                 *             sizeBytes: number;
                 *             mtimeMs: number;
                 *             ctimeMs: number | null;
                 *             dev?: number | null;
                 *             ino?: number | null;
                 *             metadata?: Record<string, unknown>;
                 *         },
                 *         internal?: { parsedSymbols?: import('#copilot/infra/internal/indexing/parser').FileSymbols },
                 *     ) => Promise<unknown>;
                 * } | null}
                 */ (opts.indexRegistry?.getIndex() ?? null);
            if (typeof indexStore?.indexTextFile === 'function') {
                await indexStore.indexTextFile(
                    {
                        filePath,
                        workspaceRoot,
                        content: text.content,
                        sizeBytes: text.sizeBytes,
                        mtimeMs: text.mtimeMs,
                        ctimeMs: text.ctimeMs,
                        dev: text.dev,
                        ino: text.ino,
                        metadata: { source: 'read-through', limitMode: 'informative' },
                    },
                    symbols ? { parsedSymbols: symbols } : {},
                );
                indexed = true;
            }
        }

        if (relatedImports) {
            relatedPaths = await resolveRelativeImportTargets(filePath, symbols?.imports ?? []);
            if (relatedPaths.length > 0) {
                const warm = await warmCacheForPaths(relatedPaths, {
                    concurrency,
                    silent,
                    textMode: true,
                    ...(opts.cacheRuntime ? { cacheRuntime: opts.cacheRuntime } : {}),
                });
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
        reusedTextCache,
        primedByteCache,
        relatedPaths,
        relatedPreloaded,
        relatedFailed,
        durationMs: Date.now() - startedAt,
    };
}

const IMPORT_EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.json'];

/**
 * @param {string} sourceFile
 * @param {import('#copilot/infra/internal/indexing/parser').ImportEntry[]} imports
 * @returns {Promise<string[]>}
 */
async function resolveRelativeImportTargets(sourceFile, imports) {
    const baseDir = nodePath.dirname(sourceFile);
    /** @type {string[]} */
    const out = [];
    /** @type {Map<string, Promise<import('node:fs').Stats | null>>} */
    const statCache = new Map();

    /**
     * @param {string} candidate
     * @returns {Promise<import('node:fs').Stats | null>}
     */
    function statCandidate(candidate) {
        const cached = statCache.get(candidate);
        if (cached) return cached;
        const pending = fsStat(candidate).catch(() => null);
        statCache.set(candidate, pending);
        return pending;
    }

    for (const entry of imports) {
        if (!entry.source.startsWith('.')) continue;
        const raw = nodePath.resolve(baseDir, entry.source);
        const candidates = [
            ...new Set(
                IMPORT_EXTENSIONS.flatMap((ext) => [`${raw}${ext}`, nodePath.join(raw, `index${ext || '.js'}`)]),
            ),
        ];
        const stats = await Promise.all(candidates.map((candidate) => statCandidate(candidate)));
        const foundIndex = stats.findIndex((stat) => stat?.isFile());
        if (foundIndex >= 0) {
            const foundCandidate = candidates[foundIndex];
            if (foundCandidate) out.push(foundCandidate);
        }
    }
    return [...new Set(out)];
}
