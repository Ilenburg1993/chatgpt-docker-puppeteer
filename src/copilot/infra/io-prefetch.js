// @ts-check
/**
 * src/copilot/infra/io-prefetch.js
 *
 * Sistema de prefetch inteligente do cache L1 para a LLM-B.
 *
 * @module copilot/infra/io-prefetch
 */

import { stat as fsStat } from 'node:fs/promises';
import * as nodePath from 'node:path';
import pLimit from 'p-limit';
import { getIoL1Cache, getVerifiedIoL1Entry, makeBytesKey, makeTextKey, normalizeIoCacheKey } from './io-cache.js';
import { getIoIndex } from './io-index-registry.js';
import { parseAndCacheSymbols } from './io-parser.js';
import { scanDirectory } from './io-scanner.js';
import { readBytesFileSnapshot } from './io/fs/read-bytes.js';
import { readTextFileSnapshot } from './io/fs/read-text.js';
import { IO_GLOB_ENGINE, matchesAnyPattern } from './scan/glob.js';
import { decodeUtf8Buffer, toOwnedBuffer, utf8ByteLength } from './shared/buffer.js';
import { sha256 } from './shared/hash.js';

/**
 * @typedef {object} PrefetchOptions
 * @property {number} [concurrency=8] Default is `8`
 * @property {boolean} [textMode=true] Default is `true`
 * @property {boolean} [silent=true] Default is `true`
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} SessionScopeStats
 * @property {string} sessionId
 * @property {number} preloaded
 * @property {number} failed
 * @property {number} skipped
 * @property {number} durationMs
 * @property {number} pathCount
 * @property {boolean} active
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

/** @type {Map<string, _SessionScope>} */
const _scopes = new Map();

/**
 * @param {string} key
 * @param {Buffer | string} content
 * @param {{ sizeBytes: number; mtimeMs: number; ctimeMs: number; dev: number; ino: number; contentHash?: string }} meta
 * @returns {void}
 */
function primeIoL1Entry(key, content, meta) {
    const cache = getIoL1Cache();
    const now = Date.now();
    const bytes = typeof content === 'string' ? utf8ByteLength(content, 'prefetch content') : content.byteLength;
    cache.set(key, {
        content,
        bytes,
        cachedAt: now,
        mtime: meta.mtimeMs,
        size: meta.sizeBytes,
        ctime: meta.ctimeMs,
        dev: meta.dev,
        ino: meta.ino,
        lastValidatedAt: now,
        accessCount: 0,
        ...(meta.contentHash ? { contentHash: meta.contentHash } : {}),
        fingerprintStrategy: 'fs-read',
    });
}

/**
 * @param {string} filePath
 * @param {boolean} textMode
 * @param {{ content?: Buffer | string } | null} cachedBytes
 * @param {{ content?: Buffer | string } | null} cachedText
 * @param {{ signal?: AbortSignal }} signalOptions
 * @returns {Promise<boolean>}
 */
async function warmSinglePath(filePath, textMode, cachedBytes, cachedText, signalOptions) {
    const normalized = normalizeIoCacheKey(filePath);
    const bytesKey = makeBytesKey(normalized);
    const textKey = makeTextKey(normalized, undefined, undefined);
    let warmed = false;

    if (cachedBytes === null) {
        const bytesSnapshot = await readBytesFileSnapshot(filePath, signalOptions);
        const hash = sha256(bytesSnapshot.content);
        primeIoL1Entry(bytesKey, bytesSnapshot.content, {
            sizeBytes: bytesSnapshot.sizeBytes,
            mtimeMs: bytesSnapshot.mtimeMs,
            ctimeMs: bytesSnapshot.ctimeMs,
            dev: bytesSnapshot.dev,
            ino: bytesSnapshot.ino,
            contentHash: hash,
        });
        warmed = true;

        if (textMode && cachedText === null) {
            const text = decodeUtf8Buffer(bytesSnapshot.content);
            primeIoL1Entry(textKey, text, {
                sizeBytes: bytesSnapshot.sizeBytes,
                mtimeMs: bytesSnapshot.mtimeMs,
                ctimeMs: bytesSnapshot.ctimeMs,
                dev: bytesSnapshot.dev,
                ino: bytesSnapshot.ino,
                contentHash: hash,
            });
            warmed = true;
        }
        return warmed;
    }

    if (textMode && cachedText === null) {
        const textSnapshot = await readTextFileSnapshot(filePath);
        primeIoL1Entry(textKey, textSnapshot.content, {
            sizeBytes: textSnapshot.sizeBytes,
            mtimeMs: textSnapshot.mtimeMs,
            ctimeMs: textSnapshot.ctimeMs,
            dev: textSnapshot.dev,
            ino: textSnapshot.ino,
            contentHash: sha256(textSnapshot.content),
        });
        warmed = true;
    }

    return warmed;
}

/**
 * @param {string[]} paths
 * @param {PrefetchOptions} [opts]
 * @returns {Promise<{ preloaded: number; failed: number; skipped: number; durationMs: number }>}
 */
export async function warmCacheForPaths(paths, opts = {}) {
    const { concurrency = 8, textMode = true, silent = true, signal } = opts;
    const t0 = Date.now();
    let preloaded = 0;
    let failed = 0;
    let skipped = 0;

    const normalizedConcurrency = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 8;
    const limit = pLimit(normalizedConcurrency);

    await Promise.all(
        paths.map((filePath) =>
            limit(async () => {
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
                    const warmed = await warmSinglePath(
                        filePath,
                        textMode,
                        cachedBytes,
                        cachedText,
                        signal ? { signal } : {},
                    );
                    if (warmed) preloaded++;
                } catch (err) {
                    if (!silent) throw err;
                    failed++;
                }
            }),
        ),
    );

    return { preloaded, failed, skipped, durationMs: Date.now() - t0 };
}

/**
 * @param {string} sessionId
 * @param {string[]} paths
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
 * @returns {string[]}
 */
export function listSessionScopes() {
    return [..._scopes.keys()];
}

/**
 * @param {string} directory
 * @param {object} [opts]
 * @param {string[]} [opts.extensions=['.js','.ts','.mjs','.json','.md']] Default is
 *   `['.js','.ts','.mjs','.json','.md']`
 * @param {number} [opts.maxFiles=500] Default is `500`
 * @param {string[]} [opts.include]
 * @param {string[]} [opts.exclude]
 * @param {boolean} [opts.recursive=true] Default is `true`
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

    const scanResult = await scanDirectory(directory, {
        recursive,
        showHidden: false,
        depth: recursive ? 20 : 1,
        respectGitignore: true,
    });

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
    const allCandidateFiles = allEntries
        .filter((e) => e.type === 'file' && extensions.includes(nodePath.extname(e.name).toLowerCase()))
        .filter((e) => include.length === 0 || matchesAnyPattern(e.absolutePath, baseDir, include))
        .filter((e) => exclude.length === 0 || !matchesAnyPattern(e.absolutePath, baseDir, exclude))
        .map((e) => e.absolutePath);

    const effectiveMaxFiles = Number.isFinite(maxFiles) && maxFiles > 0 ? Math.floor(maxFiles) : 500;
    const files = allCandidateFiles.slice(0, effectiveMaxFiles);

    const result = await warmCacheForPaths(files, prefetchOpts);
    return {
        scanned: scanResult.scannedEntries,
        ...result,
        durationMs: Date.now() - t0,
        paths: files,
        advisoryLimits: {
            requestedMaxFiles: maxFiles,
            effectiveMaxFiles,
            hardLimitReached: allCandidateFiles.length > files.length,
            selectedFiles: files.length,
            candidateFiles: allCandidateFiles.length,
            recursive,
            includePatternCount: include.length,
            excludePatternCount: exclude.length,
            globEngine: IO_GLOB_ENGINE,
            limitMode: 'enforced-max-files',
        },
    };
}

/**
 * @param {string[]} recentPaths
 * @param {PrefetchOptions} [opts]
 * @returns {Promise<{ preloaded: number; failed: number; skipped: number; durationMs: number }>}
 */
export async function warmRecentPaths(recentPaths, opts = {}) {
    return warmCacheForPaths(recentPaths, opts);
}

/**
 * @param {string} filePath
 * @param {{
 *     workspaceRoot?: string;
 *     index?: boolean;
 *     relatedImports?: boolean;
 *     concurrency?: number;
 *     silent?: boolean;
 *     cacheBytes?: boolean;
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
        const cachedText = await getVerifiedIoL1Entry(textKey, filePath);
        const canReuseTextCache =
            cachedText !== null &&
            typeof cachedText.content === 'string' &&
            Number.isFinite(cachedText.size) &&
            Number.isFinite(cachedText.mtime) &&
            Number.isFinite(cachedText.ctime) &&
            Number.isFinite(cachedText.dev) &&
            Number.isFinite(cachedText.ino);
        const text =
            canReuseTextCache
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
            primeIoL1Entry(textKey, text.content, {
                sizeBytes: text.sizeBytes,
                mtimeMs: text.mtimeMs,
                ctimeMs: text.ctimeMs,
                dev: text.dev,
                ino: text.ino,
                contentHash: textHash,
            });
        }
        if (cacheBytes) {
            primeIoL1Entry(makeBytesKey(normalized), toOwnedBuffer(text.content), {
                sizeBytes: text.sizeBytes,
                mtimeMs: text.mtimeMs,
                ctimeMs: text.ctimeMs,
                dev: text.dev,
                ino: text.ino,
                contentHash: textHash,
            });
            primedByteCache = true;
        }

        if (index) {
            const indexStore = /**
             * @type {{
             *     indexTextFile?: (input: {
             *         filePath: string;
             *         workspaceRoot: string;
             *         content: string;
             *         sizeBytes: number;
             *         mtimeMs: number;
             *         ctimeMs: number | null;
             *         dev?: number | null;
             *         ino?: number | null;
             *         metadata?: Record<string, unknown>;
             *     }) => Promise<unknown>;
             * } | null}
             */ (getIoIndex());
            if (typeof indexStore?.indexTextFile === 'function') {
                await indexStore.indexTextFile({
                    filePath,
                    workspaceRoot,
                    content: text.content,
                    sizeBytes: text.sizeBytes,
                    mtimeMs: text.mtimeMs,
                    ctimeMs: text.ctimeMs,
                    dev: text.dev,
                    ino: text.ino,
                    metadata: { source: 'read-through', limitMode: 'informative' },
                });
                indexed = true;
            }
        }

        if (relatedImports) {
            const symbols = await parseAndCacheSymbols(filePath, { snapshot: text }).catch(() => null);
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
        reusedTextCache,
        primedByteCache,
        relatedPaths,
        relatedPreloaded,
        relatedFailed,
        durationMs: Date.now() - startedAt,
    };
}

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
