// @ts-check
/** Snapshot-aware symbol cache orchestration. */

import {
    createStaleSnapshotError,
    readTextFileSnapshot,
    statPathSnapshot,
} from '#copilot/infra/internal/filesystem/read';
import { richFingerprintMatches } from '#copilot/infra/internal/platform/fingerprint';
import { normalizeParserPath } from '../foundation/index.js';
import { parseFileSymbols } from '../parse/index.js';

/** @typedef {import('../foundation/index.js').FileSymbols} FileSymbols */
/** @typedef {import('../foundation/index.js').ParserFingerprint} ParserFingerprint */
/** @typedef {import('../foundation/index.js').SymbolCacheEntry} SymbolCacheEntry */

/** @param {{ sizeBytes: number; mtimeMs: number; ctimeMs: number; dev: number | bigint; ino: number | bigint }} value */
function fingerprintFromSnapshot(value) {
    return {
        sizeBytes: value.sizeBytes,
        mtimeMs: value.mtimeMs,
        ctimeMs: value.ctimeMs,
        dev: Number(value.dev),
        ino: Number(value.ino),
    };
}

/**
 * @param {{ sizeBytes: number; mtimeMs: number; ctimeMs: number; dev: number | bigint; ino: number | bigint }} left
 * @param {{ sizeBytes?: number; size?: number; mtimeMs: number; ctimeMs: number; dev: number | bigint; ino: number | bigint }} right
 */
function fingerprintMatches(left, right) {
    return richFingerprintMatches(
        fingerprintFromSnapshot(left),
        {
            sizeBytes: Number(right.sizeBytes ?? right.size),
            mtimeMs: right.mtimeMs,
            ctimeMs: right.ctimeMs,
            dev: Number(right.dev),
            ino: Number(right.ino),
        },
        { mtimeToleranceMs: 0 },
    );
}

/**
 * Parse with snapshot consistency guarantees but without retaining parser cache state.
 * @param {string} filePath
 * @param {{ snapshot?: import('#copilot/infra/internal/filesystem/read').TextFileSnapshot; maxRetries?: number; signal?: AbortSignal }} options
 */
async function parseSymbolsStateless(filePath, options) {
    const maxRetries =
        Number.isInteger(options.maxRetries) && Number(options.maxRetries) >= 0
            ? Math.min(10, Number(options.maxRetries))
            : 2;
    let suppliedSnapshot = options.snapshot ?? null;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        options.signal?.throwIfAborted();
        const snapshot =
            suppliedSnapshot ??
            (await readTextFileSnapshot(filePath, options.signal ? { signal: options.signal } : {}));
        suppliedSnapshot = null;
        const symbols = await parseFileSymbols(
            filePath,
            snapshot.content,
            options.signal ? { signal: options.signal } : {},
        );
        const current = await statPathSnapshot(filePath);
        options.signal?.throwIfAborted();
        if (fingerprintMatches(snapshot, current)) return symbols;
        if (attempt > maxRetries) throw createStaleSnapshotError(filePath, attempt);
    }
    throw createStaleSnapshotError(filePath, maxRetries + 1);
}

/**
 * @param {string} filePath
 * @param {{ snapshot?: import('#copilot/infra/internal/filesystem/read').TextFileSnapshot; maxRetries?: number; signal?: AbortSignal; parserCacheRuntime?: ReturnType<typeof import('./runtime/index.js').createParserCacheRuntime> }} [options]
 * @returns {Promise<FileSymbols>}
 */
export async function parseAndCacheSymbols(filePath, options = {}) {
    const parserCacheRuntime = options.parserCacheRuntime ?? null;
    if (!parserCacheRuntime) return parseSymbolsStateless(filePath, options);
    parserCacheRuntime.ensureInvalidationHook();
    const symbolCache = parserCacheRuntime.symbolCache;
    const symbolStats = parserCacheRuntime.symbolStats;
    options.signal?.throwIfAborted();
    const cacheKey = normalizeParserPath(filePath);
    const maxRetries =
        Number.isInteger(options.maxRetries) && Number(options.maxRetries) >= 0
            ? Math.min(10, Number(options.maxRetries))
            : 2;
    let suppliedSnapshot = options.snapshot ?? null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        options.signal?.throwIfAborted();
        const cached = /** @type {SymbolCacheEntry | undefined} */ (symbolCache.get(cacheKey));
        let snapshot = suppliedSnapshot;
        suppliedSnapshot = null;
        if (snapshot) {
            symbolStats.symbolSuppliedSnapshots += 1;
            if (cached && fingerprintMatches(cached.fingerprint, snapshot)) {
                symbolStats.symbolFreshnessChecks += 1;
                const current = await statPathSnapshot(filePath);
                options.signal?.throwIfAborted();
                if (!fingerprintMatches(snapshot, current)) {
                    symbolStats.symbolSnapshotConflicts += 1;
                    if (attempt <= maxRetries) continue;
                    throw createStaleSnapshotError(filePath, attempt);
                }
                symbolStats.symbolCacheHits += 1;
                return cached.symbols;
            }
            symbolStats.symbolSnapshotPrechecksAvoided += 1;
            if (cached) {
                symbolStats.symbolCacheStale += 1;
                symbolCache.delete(cacheKey);
            }
        } else if (cached) {
            symbolStats.symbolFreshnessChecks += 1;
            const current = await statPathSnapshot(filePath);
            options.signal?.throwIfAborted();
            if (fingerprintMatches(cached.fingerprint, current)) {
                symbolStats.symbolCacheHits += 1;
                return cached.symbols;
            }
            symbolStats.symbolCacheStale += 1;
            symbolCache.delete(cacheKey);
        }

        if (!snapshot) {
            symbolStats.symbolSnapshotReads += 1;
            snapshot = await readTextFileSnapshot(filePath, options.signal ? { signal: options.signal } : {});
        }
        symbolStats.symbolCacheMisses += 1;
        const symbols = await parseFileSymbols(filePath, snapshot.content, {
            ...(options.signal ? { signal: options.signal } : {}),
            parserConfig: parserCacheRuntime.parserConfig,
            ...(parserCacheRuntime.workerRuntime ? { workerRuntime: parserCacheRuntime.workerRuntime } : {}),
        });
        options.signal?.throwIfAborted();
        symbolStats.symbolFreshnessChecks += 1;
        const current = await statPathSnapshot(filePath);
        options.signal?.throwIfAborted();
        if (!fingerprintMatches(snapshot, current)) {
            symbolStats.symbolSnapshotConflicts += 1;
            if (attempt <= maxRetries) continue;
            throw createStaleSnapshotError(filePath, attempt);
        }
        symbolCache.set(cacheKey, { symbols, fingerprint: fingerprintFromSnapshot(snapshot) });
        return symbols;
    }
    throw createStaleSnapshotError(filePath, maxRetries + 1);
}
