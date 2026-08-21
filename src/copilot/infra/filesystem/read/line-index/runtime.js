// @ts-check
/** Cache, LRU, invalidation and metrics for the progressive byte-line index. */

import { normalizePathResourceKey } from '#copilot/infra/internal/policy';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { chunkSnapshotMatchesStats } from '../snapshot/index.js';
import { buildByteLineIndex } from './builder.js';
import { estimateByteLineIndexEntryBytes, readByteLineIndexConfig } from './policy.js';

/** @typedef {import('./types.js').ByteLineIndexEntry} ByteLineIndexEntry */
/** @typedef {import('./types.js').ByteLineIndexLookup} ByteLineIndexLookup */

/**
 * @param {{ invalidationBus:{registerHook:(hook:(filePath:string,event:{recursive:boolean;source:string})=>void)=>()=>void}; config?:ReturnType<typeof readByteLineIndexConfig> }} options
 */
export function createByteLineIndexRuntime(options) {
    if (!options?.invalidationBus) throw new TypeError('createByteLineIndexRuntime requires { invalidationBus }.');
    const invalidationBus = options.invalidationBus;
    const config = options.config ?? readByteLineIndexConfig();
    /** @type {Map<string, ByteLineIndexEntry>} */
    const byteLineIndexCache = new Map();
    const byteLineIndexStats = {
        hits: 0,
        hitPrevalidationElisions: 0,
        misses: 0,
        builds: 0,
        extensions: 0,
        partialBuilds: 0,
        fullBuilds: 0,
        stale: 0,
        evictions: 0,
        memoryEvictions: 0,
        indexBytesScanned: 0,
        rangeBytesRead: 0,
        capturedRangeReuses: 0,
        rangeBytesAvoided: 0,
        streamSeeds: 0,
        streamSeedBytes: 0,
        streamSeedPromotions: 0,
        busInvalidations: 0,
        recursiveInvalidations: 0,
        clears: 0,
    };
    /** @type {(() => void) | null} */
    let byteLineIndexInvalidationUnregister = null;

    function getByteLineIndexStats() {
        return {
            ...byteLineIndexStats,
            size: byteLineIndexCache.size,
            sizeBytes: estimateByteLineIndexCacheBytes(),
            enabled: config.enabled,
            maxEntries: config.maxEntries,
            maxBytes: config.maxBytes,
            maxLines: config.maxLines,
        };
    }

    function clearByteLineIndexCache() {
        byteLineIndexCache.clear();
        for (const key of Object.keys(byteLineIndexStats)) {
            byteLineIndexStats[/** @type {keyof typeof byteLineIndexStats} */ (key)] = 0;
        }
        byteLineIndexInvalidationUnregister?.();
        byteLineIndexInvalidationUnregister = null;
    }

    function ensureByteLineIndexInvalidationHook() {
        if (byteLineIndexInvalidationUnregister) return;
        byteLineIndexInvalidationUnregister = invalidationBus.registerHook((filePath, event) => {
            const removed = event.recursive
                ? invalidateByteLineIndexSubtree(filePath)
                : invalidateByteLineIndexPath(filePath);
            byteLineIndexStats.busInvalidations += 1;
            if (event.recursive) byteLineIndexStats.recursiveInvalidations += 1;
            void removed;
        });
    }

    /** @param {string} filePath */
    function invalidateByteLineIndexPath(filePath) {
        const key = normalizePathResourceKey(filePath);
        const removed = byteLineIndexCache.delete(key) ? 1 : 0;
        byteLineIndexStats.clears += removed;
        return removed;
    }

    /** @param {string} filePath */
    function invalidateByteLineIndexSubtree(filePath) {
        const key = normalizePathResourceKey(filePath);
        const prefix = `${key}${path.sep}`;
        let removed = 0;
        for (const candidate of [...byteLineIndexCache.keys()]) {
            if (candidate !== key && !candidate.startsWith(prefix)) continue;
            byteLineIndexCache.delete(candidate);
            removed += 1;
        }
        byteLineIndexStats.clears += removed;
        return removed;
    }

    function estimateByteLineIndexCacheBytes() {
        let total = 0;
        for (const entry of byteLineIndexCache.values()) total += estimateByteLineIndexEntryBytes(entry);
        return total;
    }

    /**
     * Persist offsets opportunistically learned by the first bounded materialized page. The stream snapshot has already
     * completed rich inode/fingerprint validation, so this seeds the progressive index without another stat or read.
     *
     * @param {string} filePath
     * @param {{
     *     snapshotVersion: string | null;
     *     sizeBytes: number | null;
     *     mtimeMs: number | null;
     *     ctimeMs: number | null;
     *     dev: number | null;
     *     ino: number | null;
     *     byteLineStarts?: number[];
     *     byteLinePendingCrOffset?: number | null;
     *     byteLineScannedBytes?: number;
     * }} state
     */
    function rememberByteLineIndexStreamSeed(filePath, state) {
        if (
            !state.snapshotVersion ||
            state.sizeBytes === null ||
            state.mtimeMs === null ||
            state.ctimeMs === null ||
            state.dev === null ||
            state.ino === null ||
            !Array.isArray(state.byteLineStarts) ||
            state.byteLineStarts.length === 0 ||
            !Number.isFinite(state.byteLineScannedBytes) ||
            Number(state.byteLineScannedBytes) <= 0
        ) {
            return;
        }
        const lineStarts = [...state.byteLineStarts];
        const physicallyScannedBytes = Math.min(state.sizeBytes, Number(state.byteLineScannedBytes));
        const complete = physicallyScannedBytes >= state.sizeBytes;
        let scannedBytes = physicallyScannedBytes;
        if (complete) {
            if (state.byteLinePendingCrOffset !== null && state.byteLinePendingCrOffset !== undefined) {
                lineStarts.push(state.byteLinePendingCrOffset + 1);
            }
            while (lineStarts.length > 0 && lineStarts[lineStarts.length - 1] === state.sizeBytes) lineStarts.pop();
            if (state.sizeBytes === 0) lineStarts.length = 0;
            scannedBytes = state.sizeBytes;
        } else if (state.byteLinePendingCrOffset !== null && state.byteLinePendingCrOffset !== undefined) {
            scannedBytes = state.byteLinePendingCrOffset;
        }
        if (scannedBytes <= 0 || lineStarts.length > config.maxLines + 1) return;

        const entry = {
            sizeBytes: state.sizeBytes,
            mtimeMs: state.mtimeMs,
            ctimeMs: state.ctimeMs,
            dev: state.dev,
            ino: state.ino,
            snapshotVersion: state.snapshotVersion,
            lineStarts,
            totalLines: complete ? lineStarts.length : null,
            complete,
            scannedBytes,
            builtAtMs: Date.now(),
        };
        const cacheKey = normalizePathResourceKey(filePath);
        const existing = byteLineIndexCache.get(cacheKey);
        if (
            existing &&
            existing.snapshotVersion === entry.snapshotVersion &&
            existing.scannedBytes >= entry.scannedBytes
        ) {
            return;
        }
        byteLineIndexCache.delete(cacheKey);
        byteLineIndexCache.set(cacheKey, entry);
        trimByteLineIndexCache();
        byteLineIndexStats.streamSeeds += 1;
        byteLineIndexStats.streamSeedBytes += physicallyScannedBytes;
        if (existing) byteLineIndexStats.streamSeedPromotions += 1;
    }

    /**
     * Resolve a byte-line index lazily. A bounded page only extends the index until it knows the byte boundary immediately
     * after the requested end line; later pages resume from `scannedBytes`. Full-file O(n) indexing is therefore paid only
     * when callers actually traverse to EOF, while already-hot prefixes keep O(window) byte seeks.
     *
     * @param {string} filePath
     * @param {{
     *     highWaterMark?: number;
     *     signal?: AbortSignal;
     *     attempt?: number;
     *     requiredLineStarts?: number;
     *     captureStartLine?: number;
     *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
     * }} [options]
     * @returns {Promise<ByteLineIndexLookup | null>}
     */
    async function getByteLineIndex(filePath, options = {}) {
        if (!config.enabled) return null;
        const requiredLineStarts =
            Number.isFinite(options.requiredLineStarts) && Number(options.requiredLineStarts) > 0
                ? Math.floor(Number(options.requiredLineStarts))
                : null;
        const cacheKey = normalizePathResourceKey(filePath);
        let cached = byteLineIndexCache.get(cacheKey) ?? null;
        if (
            cached &&
            (cached.complete || requiredLineStarts === null || cached.lineStarts.length >= requiredLineStarts)
        ) {
            // The subsequent byte-range snapshot validates the cached inode/fingerprint before and after reading. Avoid a
            // redundant path stat here; external stale state raises ESTALECHUNKSNAPSHOT and the retry path drops this entry.
            byteLineIndexStats.hits += 1;
            byteLineIndexStats.hitPrevalidationElisions += 1;
            byteLineIndexCache.delete(cacheKey);
            byteLineIndexCache.set(cacheKey, cached);
            return { entry: cached, indexBytesRead: 0, cacheState: 'hit' };
        }

        const currentStats = await stat(filePath);
        if (cached && !chunkSnapshotMatchesStats(cached, currentStats)) {
            byteLineIndexCache.delete(cacheKey);
            byteLineIndexStats.stale += 1;
            cached = null;
        }
        if (cached) byteLineIndexStats.extensions += 1;
        else {
            byteLineIndexStats.misses += 1;
            byteLineIndexStats.builds += 1;
        }
        const built = await buildByteLineIndex(filePath, {
            ...(options.highWaterMark !== undefined ? { highWaterMark: options.highWaterMark } : {}),
            ...(options.signal ? { signal: options.signal } : {}),
            ...(options.attempt !== undefined ? { attempt: options.attempt } : {}),
            ...(requiredLineStarts !== null ? { requiredLineStarts } : {}),
            ...(options.captureStartLine !== undefined ? { captureStartLine: options.captureStartLine } : {}),
            ...(cached ? { existing: cached } : {}),
            maxLines: config.maxLines,
            ...(options.onPhase ? { onPhase: options.onPhase } : {}),
        });
        if (!built) return null;
        byteLineIndexStats.indexBytesScanned += built.indexBytesRead;
        if (built.entry.complete) byteLineIndexStats.fullBuilds += 1;
        else byteLineIndexStats.partialBuilds += 1;
        byteLineIndexCache.set(cacheKey, built.entry);
        trimByteLineIndexCache();
        return {
            entry: built.entry,
            indexBytesRead: built.indexBytesRead,
            cacheState: cached ? 'extend' : 'build',
            ...(built.capturedRange ? { capturedRange: built.capturedRange } : {}),
            ...(built.capturedStartByte !== undefined ? { capturedStartByte: built.capturedStartByte } : {}),
            ...(built.capturedEndByte !== undefined ? { capturedEndByte: built.capturedEndByte } : {}),
        };
    }

    /** @returns {void} */
    function trimByteLineIndexCache() {
        const maxBytes = config.maxBytes;
        while (byteLineIndexCache.size > config.maxEntries || estimateByteLineIndexCacheBytes() > maxBytes) {
            const memoryPressure = estimateByteLineIndexCacheBytes() > maxBytes;
            const oldest = byteLineIndexCache.keys().next().value;
            if (typeof oldest !== 'string') break;
            byteLineIndexCache.delete(oldest);
            byteLineIndexStats.evictions += 1;
            if (memoryPressure) byteLineIndexStats.memoryEvictions += 1;
        }
    }

    /** @param {number} bytesAvoided */
    function recordByteLineIndexCapturedRangeReuse(bytesAvoided) {
        byteLineIndexStats.capturedRangeReuses += 1;
        byteLineIndexStats.rangeBytesAvoided += Math.max(0, bytesAvoided);
    }

    /** @param {number} bytesRead */
    function recordByteLineIndexRangeRead(bytesRead) {
        byteLineIndexStats.rangeBytesRead += Math.max(0, bytesRead);
    }

    /** @param {string} filePath */
    function discardStaleByteLineIndex(filePath) {
        const removed = byteLineIndexCache.delete(normalizePathResourceKey(filePath));
        if (removed) byteLineIndexStats.stale += 1;
        return removed;
    }

    return Object.freeze({
        enabled: config.enabled,
        stats: getByteLineIndexStats,
        reset: clearByteLineIndexCache,
        ensureInvalidationHook: ensureByteLineIndexInvalidationHook,
        invalidatePath: invalidateByteLineIndexPath,
        invalidateSubtree: invalidateByteLineIndexSubtree,
        rememberStreamSeed: rememberByteLineIndexStreamSeed,
        get: getByteLineIndex,
        recordCapturedRangeReuse: recordByteLineIndexCapturedRangeReuse,
        recordRangeRead: recordByteLineIndexRangeRead,
        discardStale: discardStaleByteLineIndex,
        dispose: clearByteLineIndexCache,
    });
}
