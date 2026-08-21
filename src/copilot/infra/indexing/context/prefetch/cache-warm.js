// @ts-check
/** L1 prefetch primitives and bounded concurrent path warming. */

import { makeBytesKey, makeTextKey, normalizeIoCacheKey } from '#copilot/infra/internal/cache/keys';
import { readBytesFileSnapshot, readTextFileSnapshot } from '#copilot/infra/internal/filesystem/read';
import { decodeUtf8Buffer, sha256, toOwnedBuffer, utf8ByteLength } from '#copilot/infra/internal/platform';
import pLimit from 'p-limit';

/** @typedef {import('./types.js').PrefetchOptions} PrefetchOptions */

/** @param {PrefetchOptions} opts */
export function resolvePrefetchL1Cache(opts) {
    const cache = opts.cacheRuntime?.l1;
    if (!cache) throw new TypeError('IO prefetch requires an explicit runtime-owned L1 cache.');
    return cache;
}

/**
 * @param {string} key
 * @param {Buffer | string} content
 * @param {{ sizeBytes: number; mtimeMs: number; ctimeMs: number; dev: number; ino: number; contentHash?: string }} meta
 * @param {ReturnType<typeof import('#copilot/infra/internal/cache/memory/runtime').createIoL1CacheRuntime>} cache
 * @returns {void}
 */
export function primeIoL1Entry(key, content, meta, cache) {
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
 * @param {ReturnType<typeof import('#copilot/infra/internal/cache/memory/runtime').createIoL1CacheRuntime>} cache
 * @returns {Promise<boolean>}
 */
async function warmSinglePath(filePath, textMode, cachedBytes, cachedText, signalOptions, cache) {
    const normalized = normalizeIoCacheKey(filePath);
    const bytesKey = makeBytesKey(normalized);
    const textKey = makeTextKey(normalized, undefined, undefined);
    let warmed = false;

    if (cachedBytes === null) {
        const bytesSnapshot = await readBytesFileSnapshot(filePath, signalOptions);
        const hash = sha256(bytesSnapshot.content);
        primeIoL1Entry(
            bytesKey,
            bytesSnapshot.content,
            {
                sizeBytes: bytesSnapshot.sizeBytes,
                mtimeMs: bytesSnapshot.mtimeMs,
                ctimeMs: bytesSnapshot.ctimeMs,
                dev: bytesSnapshot.dev,
                ino: bytesSnapshot.ino,
                contentHash: hash,
            },
            cache,
        );
        warmed = true;

        if (textMode && cachedText === null) {
            const text = decodeUtf8Buffer(bytesSnapshot.content);
            primeIoL1Entry(
                textKey,
                text,
                {
                    sizeBytes: bytesSnapshot.sizeBytes,
                    mtimeMs: bytesSnapshot.mtimeMs,
                    ctimeMs: bytesSnapshot.ctimeMs,
                    dev: bytesSnapshot.dev,
                    ino: bytesSnapshot.ino,
                    contentHash: hash,
                },
                cache,
            );
            warmed = true;
        }
        return warmed;
    }

    if (textMode && cachedText === null) {
        const textSnapshot = await readTextFileSnapshot(filePath, signalOptions);
        primeIoL1Entry(
            textKey,
            textSnapshot.content,
            {
                sizeBytes: textSnapshot.sizeBytes,
                mtimeMs: textSnapshot.mtimeMs,
                ctimeMs: textSnapshot.ctimeMs,
                dev: textSnapshot.dev,
                ino: textSnapshot.ino,
                contentHash: sha256(textSnapshot.content),
            },
            cache,
        );
        warmed = true;
    }

    return warmed;
}

/**
 * Converte uma entrada textual L1 já verificada no shape do snapshot baixo, sem copiar conteúdo.
 *
 * @param {string} filePath
 * @param {import('#copilot/infra/internal/cache/memory').IoCacheEntry | null} entry
 * @returns {import('#copilot/infra/internal/filesystem/read').TextFileSnapshot | null}
 */
function textSnapshotFromCacheEntry(filePath, entry) {
    if (
        !entry ||
        typeof entry.content !== 'string' ||
        !Number.isFinite(entry.size) ||
        !Number.isFinite(entry.mtime) ||
        !Number.isFinite(entry.ctime) ||
        !Number.isFinite(entry.dev) ||
        !Number.isFinite(entry.ino)
    ) {
        return null;
    }
    return {
        path: filePath,
        content: entry.content,
        bytesRead: entry.bytes,
        sizeBytes: Number(entry.size),
        mtimeMs: Number(entry.mtime),
        ctimeMs: Number(entry.ctime),
        dev: Number(entry.dev),
        ino: Number(entry.ino),
        attempts: 0,
        consistent: true,
    };
}

/**
 * Aquece somente o L1 textual e retorna snapshots efêmeros para composição com parser/index. Não mantém uma segunda
 * cópia de conteúdo: o Map aponta para a mesma string usada para primar/reusar o L1 e deve ser descartado pelo caller
 * após o pipeline de warm-up.
 *
 * @param {string[]} paths
 * @param {PrefetchOptions} [opts]
 * @returns {Promise<{
 *     preloaded: number;
 *     failed: number;
 *     skipped: number;
 *     durationMs: number;
 *     snapshots: Map<string, import('#copilot/infra/internal/filesystem/read').TextFileSnapshot>;
 * }>}
 */
export async function warmTextSnapshotsForPaths(paths, opts = {}) {
    const { concurrency = 8, silent = true, signal, cacheBytes = false } = opts;
    const cache = resolvePrefetchL1Cache(opts);
    const t0 = performance.now();
    let preloaded = 0;
    let failed = 0;
    let skipped = 0;
    /** @type {Map<string, import('#copilot/infra/internal/filesystem/read').TextFileSnapshot>} */
    const snapshots = new Map();
    const normalizedConcurrency = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 8;
    const limit = pLimit(normalizedConcurrency);

    await Promise.all(
        paths.map((filePath) =>
            limit(async () => {
                signal?.throwIfAborted();
                const normalized = normalizeIoCacheKey(filePath);
                const textKey = makeTextKey(normalized, undefined, undefined);
                try {
                    const cachedText = await cache.getVerified(textKey, filePath);
                    signal?.throwIfAborted();
                    let snapshot = textSnapshotFromCacheEntry(filePath, cachedText);
                    if (snapshot) {
                        skipped += 1;
                    } else {
                        snapshot = await readTextFileSnapshot(filePath, signal ? { signal } : {});
                        const contentHash = sha256(snapshot.content);
                        primeIoL1Entry(
                            textKey,
                            snapshot.content,
                            {
                                sizeBytes: snapshot.sizeBytes,
                                mtimeMs: snapshot.mtimeMs,
                                ctimeMs: snapshot.ctimeMs,
                                dev: snapshot.dev,
                                ino: snapshot.ino,
                                contentHash,
                            },
                            cache,
                        );
                        if (cacheBytes) {
                            primeIoL1Entry(
                                makeBytesKey(normalized),
                                toOwnedBuffer(snapshot.content),
                                {
                                    sizeBytes: snapshot.sizeBytes,
                                    mtimeMs: snapshot.mtimeMs,
                                    ctimeMs: snapshot.ctimeMs,
                                    dev: snapshot.dev,
                                    ino: snapshot.ino,
                                    contentHash,
                                },
                                cache,
                            );
                        }
                        preloaded += 1;
                    }
                    snapshots.set(filePath, snapshot);
                } catch (err) {
                    signal?.throwIfAborted();
                    if (!silent) throw err;
                    failed += 1;
                }
            }),
        ),
    );

    return { preloaded, failed, skipped, durationMs: Math.max(0, performance.now() - t0), snapshots };
}

/**
 * @param {string[]} paths
 * @param {PrefetchOptions} [opts]
 * @returns {Promise<{
 *     preloaded: number;
 *     failed: number;
 *     skipped: number;
 *     durationMs: number;
 *     snapshots?: Map<string, import('#copilot/infra/internal/filesystem/read').TextFileSnapshot>;
 * }>}
 */
export async function warmCacheForPaths(paths, opts = {}) {
    if (opts.captureTextSnapshots === true) return warmTextSnapshotsForPaths(paths, opts);
    const { concurrency = 8, textMode = true, silent = true, signal } = opts;
    const cache = resolvePrefetchL1Cache(opts);
    const t0 = performance.now();
    let preloaded = 0;
    let failed = 0;
    let skipped = 0;

    const normalizedConcurrency = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 8;
    const limit = pLimit(normalizedConcurrency);

    await Promise.all(
        paths.map((filePath) =>
            limit(async () => {
                signal?.throwIfAborted();
                const normalized = normalizeIoCacheKey(filePath);
                const bytesKey = makeBytesKey(normalized);
                const textKey = makeTextKey(normalized, undefined, undefined);
                const cachedBytes = await cache.getVerified(bytesKey, filePath);
                const cachedText = textMode ? await cache.getVerified(textKey, filePath) : null;
                signal?.throwIfAborted();
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
                        cache,
                    );
                    if (warmed) preloaded++;
                } catch (err) {
                    signal?.throwIfAborted();
                    if (!silent) throw err;
                    failed++;
                }
            }),
        ),
    );

    return { preloaded, failed, skipped, durationMs: Math.max(0, performance.now() - t0) };
}

/**
 * @param {string[]} recentPaths
 * @param {PrefetchOptions} [opts]
 * @returns {Promise<{ preloaded: number; failed: number; skipped: number; durationMs: number }>}
 */
export async function warmRecentPaths(recentPaths, opts = {}) {
    return warmCacheForPaths(recentPaths, opts);
}
