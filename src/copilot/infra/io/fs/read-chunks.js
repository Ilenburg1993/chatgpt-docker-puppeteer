// @ts-check
/**
 * Leitura textual baixa em chunks de linhas.
 *
 * @module copilot/infra/io/fs/read-chunks
 */

import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { addAbortSignal } from 'node:stream';
import { normalizePathResourceKey } from '../../policy/path-resource.js';
import { toBufferView, utf8ByteLength } from '../../shared/buffer.js';
import { richFingerprintMatches } from '../../shared/fingerprint-match.js';
import { sha256 } from '../../shared/hash.js';
import { registerIoInvalidationHook } from '../invalidation/bus.js';
import { sameFileSnapshot } from './read-bytes.js';

const BYTE_LINE_INDEX_MAX_ENTRIES = 64;
const DEFAULT_BYTE_LINE_INDEX_MAX_BYTES = 32 * 1024 * 1024;
const HARD_BYTE_LINE_INDEX_MAX_BYTES = 256 * 1024 * 1024;
const BYTE_LINE_INDEX_ENTRY_OVERHEAD_BYTES = 512;
const BYTE_LINE_INDEX_ESTIMATED_BYTES_PER_OFFSET = 16;
const BYTE_LINE_INDEX_INITIAL_HIGH_WATER_MARK = 32 * 1024;
const BYTE_LINE_INDEX_SMALL_EXTENSION_HIGH_WATER_MARK = 16 * 1024;
const BYTE_LINE_INDEX_LARGE_EXTENSION_HIGH_WATER_MARK = 64 * 1024;
const BYTE_LINE_INDEX_MEDIUM_EXTENSION_MAX_BYTES = 1024 * 1024;
const DEFAULT_BYTE_LINE_INDEX_MAX_LINES = 1_000_000;
const HARD_BYTE_LINE_INDEX_MAX_LINES = 5_000_000;
const DEFAULT_CHUNK_SNAPSHOT_RETRIES = 2;

/**
 * @typedef {{
 *     index: number;
 *     startLine: number;
 *     endLine: number;
 *     content: string;
 *     bytes: number;
 *     snapshotVersion?: string;
 * }} TextLineChunk
 *
 * @typedef {{
 *     sizeBytes: number;
 *     mtimeMs: number;
 *     ctimeMs: number;
 *     dev: number;
 *     ino: number;
 *     snapshotVersion: string;
 *     lineStarts: number[];
 *     totalLines: number | null;
 *     complete: boolean;
 *     scannedBytes: number;
 *     builtAtMs: number;
 * }} ByteLineIndexEntry
 *
 * @typedef {{
 *     entry: ByteLineIndexEntry;
 *     indexBytesRead: number;
 *     cacheState: 'hit' | 'build' | 'extend';
 *     capturedRange?: Buffer;
 *     capturedStartByte?: number;
 *     capturedEndByte?: number;
 * }} ByteLineIndexLookup
 */

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

ensureByteLineIndexInvalidationHook();

export function getByteLineIndexStats() {
    return {
        ...byteLineIndexStats,
        size: byteLineIndexCache.size,
        sizeBytes: estimateByteLineIndexCacheBytes(),
        maxEntries: BYTE_LINE_INDEX_MAX_ENTRIES,
        maxBytes: readByteLineIndexMaxBytes(),
    };
}

export function resetByteLineIndexCacheForTest() {
    byteLineIndexCache.clear();
    for (const key of Object.keys(byteLineIndexStats)) {
        byteLineIndexStats[/** @type {keyof typeof byteLineIndexStats} */ (key)] = 0;
    }
    byteLineIndexInvalidationUnregister?.();
    byteLineIndexInvalidationUnregister = null;
    ensureByteLineIndexInvalidationHook();
}

export function ensureByteLineIndexInvalidationHook() {
    if (byteLineIndexInvalidationUnregister) return;
    byteLineIndexInvalidationUnregister = registerIoInvalidationHook((filePath, event) => {
        const removed = event.recursive
            ? invalidateByteLineIndexSubtree(filePath)
            : invalidateByteLineIndexPath(filePath);
        byteLineIndexStats.busInvalidations += 1;
        if (event.recursive) byteLineIndexStats.recursiveInvalidations += 1;
        void removed;
    });
}

/** @param {string} filePath */
export function invalidateByteLineIndexPath(filePath) {
    const key = normalizePathResourceKey(filePath);
    const removed = byteLineIndexCache.delete(key) ? 1 : 0;
    byteLineIndexStats.clears += removed;
    return removed;
}

/** @param {string} filePath */
export function invalidateByteLineIndexSubtree(filePath) {
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

/**
 * @returns {never}
 */
function throwAbortError() {
    const error = /** @type {Error & { code?: string }} */ (new Error('The operation was aborted'));
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    throw error;
}

/**
 * @param {string} filePath
 * @param {number} attempts
 * @param {{ partial?: boolean; snapshotVersion?: string }} [details]
 * @returns {Error & { code?: string; attempts?: number; partial?: boolean; snapshotVersion?: string }}
 */
function createStaleChunkSnapshotError(filePath, attempts, details = {}) {
    const error =
        /**
         * @type {Error & {
         *     code?: string;
         *     attempts?: number;
         *     partial?: boolean;
         *     snapshotVersion?: string;
         * }}
         */ (new Error(`Arquivo mudou durante leitura textual em chunks: ${filePath}`));
    error.code = details.partial ? 'ESTALECHUNKSTREAM' : 'ESTALECHUNKSNAPSHOT';
    error.attempts = attempts;
    error.partial = details.partial ?? false;
    if (details.snapshotVersion) error.snapshotVersion = details.snapshotVersion;
    return error;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isStaleChunkSnapshotError(error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    return code === 'ESTALECHUNKSNAPSHOT' || code === 'ESTALECHUNKSTREAM';
}

/**
 * @param {unknown} cause
 * @returns {Error & { code?: string }}
 */
function createInvalidUtf8ChunkError(cause) {
    const error = /** @type {Error & { code?: string }} */ (
        new Error('Arquivo binário detectado (bytes inválidos para UTF-8).', { cause })
    );
    error.name = 'BinaryFileError';
    error.code = 'ERR_INVALID_UTF8';
    return error;
}

/**
 * @param {TextDecoder} decoder
 * @param {Buffer | Uint8Array | undefined} chunk
 * @param {boolean} final
 */
function decodeUtf8Chunk(decoder, chunk, final = false) {
    try {
        return final ? decoder.decode() : decoder.decode(chunk, { stream: true });
    } catch (error) {
        throw createInvalidUtf8ChunkError(error);
    }
}

/** @param {Buffer | Uint8Array} content */
function decodeUtf8Buffer(content) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch (error) {
        throw createInvalidUtf8ChunkError(error);
    }
}

/**
 * @param {import('node:fs').Stats} stats
 */
function fingerprintFromStats(stats) {
    return {
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
        dev: Number(stats.dev),
        ino: Number(stats.ino),
    };
}

/**
 * @param {{ sizeBytes: number; mtimeMs: number; ctimeMs: number; dev: number; ino: number }} fingerprint
 * @returns {string}
 */
function buildSnapshotVersion(fingerprint) {
    return sha256(
        `${fingerprint.dev}:${fingerprint.ino}:${fingerprint.sizeBytes}:${fingerprint.mtimeMs}:${fingerprint.ctimeMs}`,
    ).slice(0, 24);
}

/**
 * @param {ByteLineIndexEntry} entry
 * @param {import('node:fs').Stats} stats
 * @returns {boolean}
 */
function byteLineIndexMatchesStats(entry, stats) {
    return richFingerprintMatches(entry, fingerprintFromStats(stats), { mtimeToleranceMs: 0 });
}

/** @returns {number} */
function readByteLineIndexMaxBytes() {
    const configured = Number(process.env['COPILOT_IO_BYTE_LINE_INDEX_MAX_BYTES'] ?? DEFAULT_BYTE_LINE_INDEX_MAX_BYTES);
    if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_BYTE_LINE_INDEX_MAX_BYTES;
    return Math.min(HARD_BYTE_LINE_INDEX_MAX_BYTES, Math.max(1024, Math.floor(configured)));
}

/** @param {ByteLineIndexEntry} entry */
function estimateByteLineIndexEntryBytes(entry) {
    return BYTE_LINE_INDEX_ENTRY_OVERHEAD_BYTES + entry.lineStarts.length * BYTE_LINE_INDEX_ESTIMATED_BYTES_PER_OFFSET;
}

/** @returns {number} */
function estimateByteLineIndexCacheBytes() {
    let total = 0;
    for (const entry of byteLineIndexCache.values()) total += estimateByteLineIndexEntryBytes(entry);
    return total;
}

/**
 * @returns {number}
 */
function readByteLineIndexMaxLines() {
    const configured = Number(process.env['COPILOT_IO_BYTE_LINE_INDEX_MAX_LINES'] ?? DEFAULT_BYTE_LINE_INDEX_MAX_LINES);
    if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_BYTE_LINE_INDEX_MAX_LINES;
    return Math.min(HARD_BYTE_LINE_INDEX_MAX_LINES, Math.floor(configured));
}

/**
 * Extend byte-line starts from bytes that were already read for another purpose. This scanner consumes no extra I/O and
 * preserves CRLF / bare-CR semantics across physical chunk boundaries.
 *
 * @param {Buffer} buf
 * @param {number} chunkFileStart
 * @param {number[]} lineStarts
 * @param {number | null} pendingCrOffset
 * @returns {number | null}
 */
function appendPhysicalLineStartsFromBuffer(buf, chunkFileStart, lineStarts, pendingCrOffset) {
    let searchIndex = 0;
    let pendingCr = pendingCrOffset;
    if (pendingCr !== null && buf.byteLength > 0) {
        if (buf[0] === 0x0a) {
            lineStarts.push(chunkFileStart + 1);
            searchIndex = 1;
        } else {
            lineStarts.push(pendingCr + 1);
        }
        pendingCr = null;
    }
    if (searchIndex >= buf.byteLength) return pendingCr;

    if (buf.indexOf(0x0d, searchIndex) === -1) {
        let lfIndex = buf.indexOf(0x0a, searchIndex);
        while (lfIndex !== -1) {
            lineStarts.push(chunkFileStart + lfIndex + 1);
            lfIndex = buf.indexOf(0x0a, lfIndex + 1);
        }
        return null;
    }

    while (searchIndex < buf.byteLength) {
        const crIndex = buf.indexOf(0x0d, searchIndex);
        const lfIndex = buf.indexOf(0x0a, searchIndex);
        if (crIndex === -1 && lfIndex === -1) break;
        if (lfIndex !== -1 && (crIndex === -1 || lfIndex < crIndex)) {
            lineStarts.push(chunkFileStart + lfIndex + 1);
            searchIndex = lfIndex + 1;
            continue;
        }
        if (crIndex + 1 >= buf.byteLength) {
            pendingCr = chunkFileStart + crIndex;
            break;
        }
        searchIndex = buf[crIndex + 1] === 0x0a ? crIndex + 2 : crIndex + 1;
        lineStarts.push(chunkFileStart + searchIndex);
    }
    return pendingCr;
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
    if (scannedBytes <= 0 || lineStarts.length > readByteLineIndexMaxLines() + 1) return;

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
    if (existing && existing.snapshotVersion === entry.snapshotVersion && existing.scannedBytes >= entry.scannedBytes) {
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
 * Resolve a physical stream size for progressive index work. Explicit caller tuning wins. Otherwise initial discovery
 * favors 32 KiB to bound over-read, while extensions estimate remaining bytes from the already observed bytes/line
 * density and scale from 16 KiB to 64 KiB as the seek distance grows.
 *
 * @param {number | undefined} configured
 * @param {ByteLineIndexEntry | null} existing
 * @param {number | null} requiredLineStarts
 */
function resolveByteLineIndexHighWaterMark(configured, existing, requiredLineStarts) {
    if (Number.isFinite(configured) && Number(configured) > 0) return Math.floor(Number(configured));
    if (!existing) return BYTE_LINE_INDEX_INITIAL_HIGH_WATER_MARK;
    if (requiredLineStarts === null) return BYTE_LINE_INDEX_LARGE_EXTENSION_HIGH_WATER_MARK;

    const knownLogicalLines = Math.max(1, existing.lineStarts.length - 1);
    const observedBytesPerLine = Math.max(1, existing.scannedBytes / knownLogicalLines);
    const additionalLineStarts = Math.max(0, requiredLineStarts - existing.lineStarts.length);
    const estimatedBytes = additionalLineStarts * observedBytesPerLine;
    if (estimatedBytes <= BYTE_LINE_INDEX_SMALL_EXTENSION_HIGH_WATER_MARK) {
        return BYTE_LINE_INDEX_SMALL_EXTENSION_HIGH_WATER_MARK;
    }
    if (estimatedBytes <= BYTE_LINE_INDEX_MEDIUM_EXTENSION_MAX_BYTES) {
        return BYTE_LINE_INDEX_INITIAL_HIGH_WATER_MARK;
    }
    return BYTE_LINE_INDEX_LARGE_EXTENSION_HIGH_WATER_MARK;
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
    if (process.env['COPILOT_IO_BYTE_LINE_INDEX_DISABLE'] === 'true') return null;
    const requiredLineStarts =
        Number.isFinite(options.requiredLineStarts) && Number(options.requiredLineStarts) > 0
            ? Math.floor(Number(options.requiredLineStarts))
            : null;
    const cacheKey = normalizePathResourceKey(filePath);
    let cached = byteLineIndexCache.get(cacheKey) ?? null;
    if (cached && (cached.complete || requiredLineStarts === null || cached.lineStarts.length >= requiredLineStarts)) {
        // The subsequent byte-range snapshot validates the cached inode/fingerprint before and after reading. Avoid a
        // redundant path stat here; external stale state raises ESTALECHUNKSNAPSHOT and the retry path drops this entry.
        byteLineIndexStats.hits += 1;
        byteLineIndexStats.hitPrevalidationElisions += 1;
        byteLineIndexCache.delete(cacheKey);
        byteLineIndexCache.set(cacheKey, cached);
        return { entry: cached, indexBytesRead: 0, cacheState: 'hit' };
    }

    const currentStats = await stat(filePath);
    if (cached && !byteLineIndexMatchesStats(cached, currentStats)) {
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

/**
 * @param {string} filePath
 * @param {{
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     attempt?: number;
 *     requiredLineStarts?: number;
 *     captureStartLine?: number;
 *     existing?: ByteLineIndexEntry;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @returns {Promise<{
 *     entry: ByteLineIndexEntry;
 *     indexBytesRead: number;
 *     capturedRange?: Buffer;
 *     capturedStartByte?: number;
 *     capturedEndByte?: number;
 * } | null>}
 */
async function buildByteLineIndex(filePath, options = {}) {
    options.signal?.throwIfAborted();
    const maxLines = readByteLineIndexMaxLines();
    const requiredLineStarts =
        Number.isFinite(options.requiredLineStarts) && Number(options.requiredLineStarts) > 0
            ? Math.floor(Number(options.requiredLineStarts))
            : null;
    if (requiredLineStarts !== null && requiredLineStarts > maxLines + 1) return null;

    const handle = await open(filePath, 'r');
    /** @type {import('node:fs').ReadStream | null} */
    let stream = null;
    try {
        const before = await handle.stat();
        const fingerprint = fingerprintFromStats(before);
        const snapshotVersion = buildSnapshotVersion(fingerprint);
        const existing =
            options.existing && byteLineIndexMatchesStats(options.existing, before) ? options.existing : null;
        /** @type {number[]} */
        const lineStarts = existing ? [...existing.lineStarts] : [0];
        let byteOffset = existing?.scannedBytes ?? 0;
        const initialByteOffset = byteOffset;
        let physicalBytesRead = 0;
        const captureStartLine =
            Number.isFinite(options.captureStartLine) && Number(options.captureStartLine) > 0
                ? Math.floor(Number(options.captureStartLine))
                : null;
        /** @type {number | null} */
        let captureStartByte =
            captureStartLine !== null && lineStarts.length >= captureStartLine
                ? Number(lineStarts[captureStartLine - 1])
                : null;
        const captureEnabled =
            captureStartLine !== null && (captureStartByte === null || captureStartByte >= initialByteOffset);
        /** @type {Buffer[]} */
        const capturedRangeChunks = [];
        let exceededMaxLines = false;
        let stoppedForTarget =
            requiredLineStarts !== null && lineStarts.length >= requiredLineStarts && existing?.complete !== true;
        /** @type {number | null} */
        let pendingCrOffset = null;
        const highWaterMark = resolveByteLineIndexHighWaterMark(options.highWaterMark, existing, requiredLineStarts);
        const targetSatisfied = () => requiredLineStarts !== null && lineStarts.length >= requiredLineStarts;
        const checkLineLimit = () => {
            if (lineStarts.length > maxLines + 1) exceededMaxLines = true;
            return exceededMaxLines;
        };

        if (!stoppedForTarget && byteOffset < before.size) {
            const baseStream = handle.createReadStream({
                autoClose: false,
                start: byteOffset,
                ...(highWaterMark !== undefined ? { highWaterMark } : {}),
            });
            stream = options.signal ? addAbortSignal(options.signal, baseStream) : baseStream;
            for await (const chunk of stream) {
                const buf = toBufferView(/** @type {Buffer | Uint8Array} */ (chunk));
                const chunkFileStart = initialByteOffset + physicalBytesRead;
                physicalBytesRead += buf.byteLength;
                let stopChunk = false;
                let searchIndex = 0;
                /** @param {number} lineStart */
                const recordLineStart = (lineStart) => {
                    lineStarts.push(lineStart);
                    if (checkLineLimit() || targetSatisfied()) {
                        stopChunk = true;
                        return true;
                    }
                    return false;
                };

                // Resolve a CR split across physical chunks before using native delimiter search for the remaining bytes.
                if (pendingCrOffset !== null && buf.byteLength > 0) {
                    if (buf[0] === 0x0a) {
                        pendingCrOffset = null;
                        searchIndex = 1;
                        byteOffset = chunkFileStart + 1;
                        recordLineStart(byteOffset);
                    } else {
                        const lineStart = pendingCrOffset + 1;
                        pendingCrOffset = null;
                        byteOffset = chunkFileStart;
                        recordLineStart(lineStart);
                    }
                }

                // Common repository case: LF-only text. One CR probe per physical chunk unlocks a single native LF scan
                // per logical newline instead of performing both CR and LF searches for every line.
                if (!stopChunk && searchIndex < buf.byteLength && buf.indexOf(0x0d, searchIndex) === -1) {
                    let lfIndex = buf.indexOf(0x0a, searchIndex);
                    while (!stopChunk && lfIndex !== -1) {
                        searchIndex = lfIndex + 1;
                        byteOffset = chunkFileStart + searchIndex;
                        recordLineStart(byteOffset);
                        if (!stopChunk) lfIndex = buf.indexOf(0x0a, searchIndex);
                    }
                    if (!stopChunk) byteOffset = chunkFileStart + buf.byteLength;
                    searchIndex = buf.byteLength;
                }

                while (!stopChunk && searchIndex < buf.byteLength) {
                    const crIndex = buf.indexOf(0x0d, searchIndex);
                    const lfIndex = buf.indexOf(0x0a, searchIndex);
                    if (crIndex === -1 && lfIndex === -1) {
                        byteOffset = chunkFileStart + buf.byteLength;
                        break;
                    }

                    if (lfIndex !== -1 && (crIndex === -1 || lfIndex < crIndex)) {
                        searchIndex = lfIndex + 1;
                        byteOffset = chunkFileStart + searchIndex;
                        recordLineStart(byteOffset);
                        continue;
                    }

                    if (crIndex + 1 >= buf.byteLength) {
                        pendingCrOffset = chunkFileStart + crIndex;
                        searchIndex = buf.byteLength;
                        byteOffset = chunkFileStart + buf.byteLength;
                        break;
                    }

                    if (buf[crIndex + 1] === 0x0a) {
                        searchIndex = crIndex + 2;
                    } else {
                        searchIndex = crIndex + 1;
                    }
                    byteOffset = chunkFileStart + searchIndex;
                    recordLineStart(byteOffset);
                }
                if (captureEnabled) {
                    if (
                        captureStartByte === null &&
                        captureStartLine !== null &&
                        lineStarts.length >= captureStartLine
                    ) {
                        const candidate = lineStarts[captureStartLine - 1];
                        if (Number.isFinite(candidate)) captureStartByte = Number(candidate);
                    }
                    if (captureStartByte !== null && byteOffset > captureStartByte) {
                        const captureFrom = Math.max(captureStartByte, chunkFileStart);
                        const captureTo = Math.min(byteOffset, chunkFileStart + buf.byteLength);
                        if (captureTo > captureFrom) {
                            capturedRangeChunks.push(
                                Buffer.from(buf.subarray(captureFrom - chunkFileStart, captureTo - chunkFileStart)),
                            );
                        }
                    }
                }
                if (options.onPhase) {
                    await options.onPhase('after-byte-index-chunk', {
                        filePath,
                        attempt: options.attempt ?? 1,
                        bytesRead: byteOffset,
                        indexBytesRead: physicalBytesRead,
                        chunkBytes: buf.byteLength,
                        snapshotVersion,
                    });
                }
                if (exceededMaxLines) break;
                if (stopChunk) {
                    stoppedForTarget = true;
                    break;
                }
            }
        }

        const after = await handle.stat();
        const pathAfter = await stat(filePath);
        if (!sameFileSnapshot(before, after) || !sameFileSnapshot(after, pathAfter)) {
            throw createStaleChunkSnapshotError(filePath, options.attempt ?? 1, { snapshotVersion });
        }
        if (exceededMaxLines) return null;

        const complete = !stoppedForTarget || byteOffset >= after.size;
        if (complete) {
            if (pendingCrOffset !== null) lineStarts.push(pendingCrOffset + 1);
            while (lineStarts.length > 0 && lineStarts[lineStarts.length - 1] === after.size) lineStarts.pop();
            if (after.size === 0) lineStarts.length = 0;
            byteOffset = after.size;
        }
        const entry = {
            ...fingerprintFromStats(after),
            snapshotVersion,
            lineStarts,
            totalLines: complete ? lineStarts.length : null,
            complete,
            scannedBytes: byteOffset,
            builtAtMs: Date.now(),
        };
        const capturedRange =
            captureEnabled && captureStartByte !== null && capturedRangeChunks.length > 0
                ? Buffer.concat(capturedRangeChunks)
                : null;
        const capturedEndByte =
            capturedRange && captureStartByte !== null ? captureStartByte + capturedRange.byteLength : null;
        if (options.onPhase) {
            await options.onPhase('after-byte-index-built', {
                filePath,
                attempt: options.attempt ?? 1,
                totalLines: entry.totalLines,
                knownLineStarts: entry.lineStarts.length,
                complete: entry.complete,
                scannedBytes: entry.scannedBytes,
                indexBytesRead: physicalBytesRead,
                extendedFromByte: initialByteOffset,
                snapshotVersion,
            });
        }
        return {
            entry,
            indexBytesRead: physicalBytesRead,
            ...(capturedRange ? { capturedRange } : {}),
            ...(capturedRange && captureStartByte !== null ? { capturedStartByte: captureStartByte } : {}),
            ...(capturedEndByte !== null ? { capturedEndByte } : {}),
        };
    } finally {
        if (stream && !stream.destroyed) stream.destroy();
        await handle.close().catch(() => undefined);
    }
}

/** @returns {void} */
function trimByteLineIndexCache() {
    const maxBytes = readByteLineIndexMaxBytes();
    while (byteLineIndexCache.size > BYTE_LINE_INDEX_MAX_ENTRIES || estimateByteLineIndexCacheBytes() > maxBytes) {
        const memoryPressure = estimateByteLineIndexCacheBytes() > maxBytes;
        const oldest = byteLineIndexCache.keys().next().value;
        if (typeof oldest !== 'string') break;
        byteLineIndexCache.delete(oldest);
        byteLineIndexStats.evictions += 1;
        if (memoryPressure) byteLineIndexStats.memoryEvictions += 1;
    }
}

/**
 * @param {string} filePath
 * @param {{
 *     chunkLines?: number;
 *     startLine?: number;
 *     endLine?: number;
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     attempt?: number;
 *     deliveryMode?: 'materialized' | 'stream';
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @param {{
 *     totalLines: number;
 *     bytesRead: number;
 *     stoppedAtRequestedWindow: boolean;
 *     chunksEmitted: number;
 *     snapshotVersion: string | null;
 *     sizeBytes: number | null;
 *     mtimeMs: number | null;
 *     ctimeMs: number | null;
 *     dev: number | null;
 *     ino: number | null;
 *     byteLineStarts?: number[];
 *     byteLinePendingCrOffset?: number | null;
 *     byteLineScannedBytes?: number;
 * }} [state]
 * @returns {AsyncGenerator<TextLineChunk, void, void>}
 */
async function* iterateTextLineChunks(
    filePath,
    options = {},
    state = {
        totalLines: 0,
        bytesRead: 0,
        stoppedAtRequestedWindow: false,
        chunksEmitted: 0,
        snapshotVersion: null,
        sizeBytes: null,
        mtimeMs: null,
        ctimeMs: null,
        dev: null,
        ino: null,
    },
) {
    const chunkLines =
        Number.isFinite(options.chunkLines) && Number(options.chunkLines) > 0
            ? Math.floor(Number(options.chunkLines))
            : 200;
    const startLine = Math.max(1, options.startLine ?? 1);
    const endLine = Number.isFinite(options.endLine)
        ? Math.max(startLine, Number(options.endLine))
        : Number.POSITIVE_INFINITY;
    const boundedMaterializedFirstPage =
        options.deliveryMode === 'materialized' && startLine === 1 && Number.isFinite(options.endLine);
    const highWaterMark =
        Number.isFinite(options.highWaterMark) && Number(options.highWaterMark) > 0
            ? Math.floor(Number(options.highWaterMark))
            : boundedMaterializedFirstPage
              ? endLine <= 1000
                  ? BYTE_LINE_INDEX_INITIAL_HIGH_WATER_MARK
                  : BYTE_LINE_INDEX_LARGE_EXTENSION_HIGH_WATER_MARK
              : undefined;
    /** @type {string[]} */
    let current = [];
    let currentStartLine = startLine;
    let carry = '';
    let chunkIndex = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    options.signal?.throwIfAborted();
    const handle = await open(filePath, 'r');
    const before = await handle.stat();
    const snapshotVersion = buildSnapshotVersion(fingerprintFromStats(before));
    state.snapshotVersion = snapshotVersion;
    state.sizeBytes = before.size;
    state.mtimeMs = before.mtimeMs;
    state.ctimeMs = before.ctimeMs;
    state.dev = Number(before.dev);
    state.ino = Number(before.ino);
    const seedByteLineIndex =
        options.deliveryMode === 'materialized' &&
        startLine === 1 &&
        Number.isFinite(options.endLine) &&
        process.env['COPILOT_IO_BYTE_LINE_INDEX_DISABLE'] !== 'true';
    if (seedByteLineIndex) {
        state.byteLineStarts = [0];
        state.byteLinePendingCrOffset = null;
        state.byteLineScannedBytes = 0;
    }
    const baseStream = handle.createReadStream({
        autoClose: false,
        ...(highWaterMark !== undefined ? { highWaterMark } : {}),
    });
    const stream = options.signal ? addAbortSignal(options.signal, baseStream) : baseStream;

    /**
     * @param {string} content
     * @returns {TextLineChunk}
     */
    function emitChunk(content) {
        const chunk = {
            index: chunkIndex,
            startLine: currentStartLine,
            endLine: currentStartLine + current.length - 1,
            content,
            bytes: utf8ByteLength(content, 'read chunk'),
            ...(options.deliveryMode === 'stream' ? { snapshotVersion } : {}),
        };
        chunkIndex += 1;
        state.chunksEmitted += 1;
        current = [];
        return chunk;
    }

    /**
     * @param {string} line
     * @returns {TextLineChunk | null}
     */
    function pushLine(line) {
        state.totalLines += 1;
        if (state.totalLines < startLine) return null;
        if (state.totalLines > endLine) {
            state.stoppedAtRequestedWindow = true;
            return null;
        }
        if (current.length === 0) currentStartLine = state.totalLines;
        current.push(line);
        if (current.length >= chunkLines) {
            return emitChunk(current.join('\n'));
        }
        return null;
    }

    /**
     * @param {string} decoded
     * @param {boolean} final
     * @returns {TextLineChunk[]}
     */
    function processDecoded(decoded, final) {
        /** @type {TextLineChunk[]} */
        const emitted = [];
        let data = carry + decoded;
        carry = '';
        let trailingCr = '';
        if (!final && data.endsWith('\r')) {
            trailingCr = '\r';
            data = data.slice(0, -1);
        }
        if (data === '') {
            carry = trailingCr;
            return emitted;
        }

        const parts = data.split(/\r\n|\n|\r/);
        if (!final) {
            carry = `${parts.pop() ?? ''}${trailingCr}`;
        } else if (/\r\n|\n|\r/.test(data.slice(-2))) {
            while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
        }

        for (const line of parts) {
            const chunk = pushLine(line);
            if (chunk) emitted.push(chunk);
            if (state.stoppedAtRequestedWindow) break;
        }
        return emitted;
    }

    try {
        for await (const chunk of stream) {
            const buf = toBufferView(/** @type {Buffer | Uint8Array} */ (chunk));
            if (seedByteLineIndex && state.byteLineStarts) {
                const chunkFileStart = Number(state.byteLineScannedBytes ?? 0);
                state.byteLinePendingCrOffset = appendPhysicalLineStartsFromBuffer(
                    buf,
                    chunkFileStart,
                    state.byteLineStarts,
                    state.byteLinePendingCrOffset ?? null,
                );
                state.byteLineScannedBytes = chunkFileStart + buf.byteLength;
            }
            state.bytesRead += buf.byteLength;
            if (options.onPhase) {
                await options.onPhase('after-stream-chunk', {
                    filePath,
                    attempt: options.attempt ?? 1,
                    bytesRead: state.bytesRead,
                    chunkBytes: buf.byteLength,
                    snapshotVersion,
                });
            }
            for (const emitted of processDecoded(decodeUtf8Chunk(decoder, buf), false)) {
                yield emitted;
            }
            if (state.stoppedAtRequestedWindow) break;
        }
        if (!state.stoppedAtRequestedWindow) {
            for (const emitted of processDecoded(decodeUtf8Chunk(decoder, undefined, true), true)) {
                yield emitted;
            }
        }
        const after = await handle.stat();
        const pathAfter = await stat(filePath);
        if (!sameFileSnapshot(before, after) || !sameFileSnapshot(after, pathAfter)) {
            throw createStaleChunkSnapshotError(filePath, options.attempt ?? 1, {
                partial: options.deliveryMode === 'stream' && state.chunksEmitted > 0,
                snapshotVersion,
            });
        }
    } finally {
        if (!stream.destroyed) stream.destroy();
        await handle.close().catch(() => undefined);
    }

    if (current.length > 0) {
        yield emitChunk(current.join('\n'));
    }
}

/**
 * @param {string} filePath
 * @param {{
 *     chunkLines?: number;
 *     startLine?: number;
 *     endLine?: number;
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     attempt?: number;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     chunks: TextLineChunk[];
 *     totalLines: number;
 *     totalLinesKnown: boolean;
 *     returnedLineCount: number;
 *     lastScannedLine: number;
 *     stoppedAtRequestedWindow: boolean;
 *     bytesRead: number;
 *     indexBytesRead: number;
 *     rangeBytesRead: number;
 *     indexCacheState: 'hit' | 'build' | 'extend';
 *     rangeSource: 'index-capture' | 'file-range';
 *     chunkLines: number;
 *     startLine: number;
 *     endLine: number | null;
 *     engine: string;
 *     cacheFingerprintStrategy: string;
 *     snapshotFingerprintStrategy: string;
 *     snapshotVersion: string;
 *     sizeBytes: number;
 *     mtimeMs: number;
 *     ctimeMs: number;
 *     dev: number;
 *     ino: number;
 *     consistent: true;
 * } | null>}
 */
async function readTextLineChunksByByteIndex(filePath, options = {}) {
    const startLine = Math.max(1, options.startLine ?? 1);
    const requestedEndLine = Number.isFinite(options.endLine) ? Math.max(startLine, Number(options.endLine)) : null;
    // An open-ended tail is a one-pass workload. Building an index to EOF and then rereading the tail doubles IO.
    if (requestedEndLine === null) return null;

    const lookup = await getByteLineIndex(filePath, {
        ...options,
        requiredLineStarts: requestedEndLine + 1,
        captureStartLine: startLine,
    });
    if (!lookup) return null;
    const byteIndex = lookup.entry;
    const totalLinesKnown = byteIndex.complete && byteIndex.totalLines !== null;
    const totalLines = totalLinesKnown ? Number(byteIndex.totalLines) : Math.max(0, byteIndex.lineStarts.length - 1);
    const endLine = totalLinesKnown ? Math.min(requestedEndLine, totalLines) : requestedEndLine;
    const chunkLines =
        Number.isFinite(options.chunkLines) && Number(options.chunkLines) > 0
            ? Math.floor(Number(options.chunkLines))
            : 200;
    if (totalLinesKnown && (startLine > totalLines || startLine > endLine)) {
        return {
            path: filePath,
            chunks: [],
            totalLines,
            totalLinesKnown: true,
            returnedLineCount: 0,
            lastScannedLine: totalLines,
            stoppedAtRequestedWindow: false,
            bytesRead: lookup.indexBytesRead,
            indexBytesRead: lookup.indexBytesRead,
            rangeBytesRead: 0,
            indexCacheState: lookup.cacheState,
            rangeSource: 'file-range',
            chunkLines,
            startLine,
            endLine: requestedEndLine,
            engine: 'io-engine.fs.createReadStream.textChunks.byteSeek',
            cacheFingerprintStrategy: 'byte-line-index',
            snapshotFingerprintStrategy: 'mtime-size-ctime-dev-ino',
            snapshotVersion: byteIndex.snapshotVersion,
            sizeBytes: byteIndex.sizeBytes,
            mtimeMs: byteIndex.mtimeMs,
            ctimeMs: byteIndex.ctimeMs,
            dev: byteIndex.dev,
            ino: byteIndex.ino,
            consistent: true,
        };
    }
    const maybeByteStart = byteIndex.lineStarts[startLine - 1];
    const maybeByteEndExclusive =
        totalLinesKnown && endLine >= totalLines ? byteIndex.sizeBytes : byteIndex.lineStarts[endLine];
    if (!Number.isFinite(maybeByteStart) || !Number.isFinite(maybeByteEndExclusive)) return null;
    const byteStart = Number(maybeByteStart);
    const byteEndExclusive = Number(maybeByteEndExclusive);
    if (byteEndExclusive < byteStart) return null;
    const rangeByteLength = Math.max(0, byteEndExclusive - byteStart);
    const capturedRange =
        lookup.capturedRange &&
        lookup.capturedStartByte === byteStart &&
        lookup.capturedEndByte === byteEndExclusive &&
        lookup.capturedRange.byteLength === rangeByteLength
            ? lookup.capturedRange
            : null;
    let rangeBytesRead = 0;
    /** @type {'index-capture' | 'file-range'} */
    let rangeSource = 'file-range';
    let text;
    if (capturedRange) {
        const currentStats = await stat(filePath);
        if (!byteLineIndexMatchesStats(byteIndex, currentStats)) {
            throw createStaleChunkSnapshotError(filePath, options.attempt ?? 1, {
                snapshotVersion: byteIndex.snapshotVersion,
            });
        }
        text = decodeUtf8Buffer(capturedRange);
        rangeSource = 'index-capture';
        byteLineIndexStats.capturedRangeReuses += 1;
        byteLineIndexStats.rangeBytesAvoided += rangeByteLength;
    } else {
        text = await readUtf8Range(filePath, byteStart, byteEndExclusive, byteIndex, options);
        rangeBytesRead = rangeByteLength;
        byteLineIndexStats.rangeBytesRead += rangeBytesRead;
    }
    const lines = splitTextLinesLikeScanner(text);
    const chunks = buildTextLineChunks(lines, startLine, chunkLines);
    return {
        path: filePath,
        chunks,
        totalLines,
        totalLinesKnown,
        returnedLineCount: lines.length,
        lastScannedLine: totalLinesKnown ? endLine : totalLines,
        stoppedAtRequestedWindow: totalLinesKnown ? endLine < totalLines : true,
        bytesRead: lookup.indexBytesRead + rangeBytesRead,
        indexBytesRead: lookup.indexBytesRead,
        rangeBytesRead,
        indexCacheState: lookup.cacheState,
        rangeSource,
        chunkLines,
        startLine,
        endLine: requestedEndLine,
        engine: 'io-engine.fs.createReadStream.textChunks.byteSeek',
        cacheFingerprintStrategy: byteIndex.complete ? 'byte-line-index' : 'byte-line-index-progressive',
        snapshotFingerprintStrategy: 'mtime-size-ctime-dev-ino',
        snapshotVersion: byteIndex.snapshotVersion,
        sizeBytes: byteIndex.sizeBytes,
        mtimeMs: byteIndex.mtimeMs,
        ctimeMs: byteIndex.ctimeMs,
        dev: byteIndex.dev,
        ino: byteIndex.ino,
        consistent: true,
    };
}

/**
 * @param {string} filePath
 * @param {number} byteStart
 * @param {number} byteEndExclusive
 * @param {ByteLineIndexEntry} expected
 * @param {{
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     attempt?: number;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} options
 * @returns {Promise<string>}
 */
async function readUtf8Range(filePath, byteStart, byteEndExclusive, expected, options) {
    if (options.signal?.aborted) throwAbortError();
    const highWaterMark =
        Number.isFinite(options.highWaterMark) && Number(options.highWaterMark) > 0
            ? Math.floor(Number(options.highWaterMark))
            : undefined;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    /** @type {string[]} */
    const decodedChunks = [];
    const handle = await open(filePath, 'r');
    /** @type {import('node:fs').ReadStream | null} */
    let stream = null;
    try {
        const before = await handle.stat();
        if (!byteLineIndexMatchesStats(expected, before)) {
            throw createStaleChunkSnapshotError(filePath, options.attempt ?? 1, {
                snapshotVersion: expected.snapshotVersion,
            });
        }
        if (byteEndExclusive > byteStart) {
            const baseStream = handle.createReadStream({
                autoClose: false,
                start: byteStart,
                end: byteEndExclusive - 1,
                ...(highWaterMark !== undefined ? { highWaterMark } : {}),
            });
            stream = options.signal ? addAbortSignal(options.signal, baseStream) : baseStream;
            for await (const chunk of stream) {
                const buf = toBufferView(/** @type {Buffer | Uint8Array} */ (chunk));
                const decoded = decodeUtf8Chunk(decoder, buf);
                if (decoded) decodedChunks.push(decoded);
                if (options.onPhase) {
                    await options.onPhase('after-byte-range-chunk', {
                        filePath,
                        attempt: options.attempt ?? 1,
                        chunkBytes: buf.byteLength,
                        snapshotVersion: expected.snapshotVersion,
                    });
                }
            }
            const finalDecoded = decodeUtf8Chunk(decoder, undefined, true);
            if (finalDecoded) decodedChunks.push(finalDecoded);
        }
        const after = await handle.stat();
        const pathAfter = await stat(filePath);
        if (
            !sameFileSnapshot(before, after) ||
            !sameFileSnapshot(after, pathAfter) ||
            !byteLineIndexMatchesStats(expected, after)
        ) {
            throw createStaleChunkSnapshotError(filePath, options.attempt ?? 1, {
                snapshotVersion: expected.snapshotVersion,
            });
        }
        return decodedChunks.join('');
    } finally {
        if (stream && !stream.destroyed) stream.destroy();
        await handle.close().catch(() => undefined);
    }
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function splitTextLinesLikeScanner(text) {
    if (text === '') return [];
    const lines = text.split(/\r\n|\n|\r/);
    if (/\r\n|\n|\r/.test(text.slice(-2))) {
        while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    }
    return lines;
}

/**
 * @param {string[]} lines
 * @param {number} startLine
 * @param {number} chunkLines
 * @returns {TextLineChunk[]}
 */
function buildTextLineChunks(lines, startLine, chunkLines) {
    /** @type {TextLineChunk[]} */
    const chunks = [];
    for (let offset = 0; offset < lines.length; offset += chunkLines) {
        const slice = lines.slice(offset, offset + chunkLines);
        const content = slice.join('\n');
        chunks.push({
            index: chunks.length,
            startLine: startLine + offset,
            endLine: startLine + offset + slice.length - 1,
            content,
            bytes: utf8ByteLength(content, 'read chunk'),
        });
    }
    return chunks;
}

/**
 * @param {string} filePath
 * @param {{
 *     chunkLines?: number;
 *     startLine?: number;
 *     endLine?: number;
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     maxRetries?: number;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     chunks: TextLineChunk[];
 *     totalLines: number;
 *     totalLinesKnown?: boolean;
 *     returnedLineCount: number;
 *     lastScannedLine: number;
 *     stoppedAtRequestedWindow: boolean;
 *     bytesRead: number;
 *     indexBytesRead?: number;
 *     rangeBytesRead?: number;
 *     indexCacheState?: 'hit' | 'build' | 'extend';
 *     rangeSource?: 'index-capture' | 'file-range';
 *     chunkLines: number;
 *     startLine: number;
 *     endLine: number | null;
 *     engine?: string;
 *     cacheFingerprintStrategy?: string;
 *     snapshotFingerprintStrategy: string;
 *     snapshotVersion: string;
 *     sizeBytes: number;
 *     mtimeMs: number;
 *     ctimeMs: number;
 *     dev: number;
 *     ino: number;
 *     attempts: number;
 *     consistent: true;
 * }>}
 */
export async function readTextLineChunks(filePath, options = {}) {
    if (options.signal?.aborted) throwAbortError();
    const startLine = Math.max(1, options.startLine ?? 1);
    const maxRetries =
        Number.isInteger(options.maxRetries) && Number(options.maxRetries) >= 0
            ? Math.min(10, Number(options.maxRetries))
            : DEFAULT_CHUNK_SNAPSHOT_RETRIES;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        try {
            const attemptOptions = { ...options, attempt, deliveryMode: /** @type {const} */ ('materialized') };
            if (startLine > 1) {
                const seekSnapshot = await readTextLineChunksByByteIndex(filePath, attemptOptions);
                if (seekSnapshot) return { ...seekSnapshot, attempts: attempt };
            }
            const state = {
                totalLines: 0,
                bytesRead: 0,
                stoppedAtRequestedWindow: false,
                chunksEmitted: 0,
                snapshotVersion: /** @type {string | null} */ (null),
                sizeBytes: /** @type {number | null} */ (null),
                mtimeMs: /** @type {number | null} */ (null),
                ctimeMs: /** @type {number | null} */ (null),
                dev: /** @type {number | null} */ (null),
                ino: /** @type {number | null} */ (null),
            };
            const arrayFromAsync =
                /**
                 * @type {{
                 *     fromAsync: <T>(items: AsyncIterable<T> | Iterable<T>) => Promise<T[]>;
                 * }}
                 */ (/** @type {unknown} */ (Array)).fromAsync;
            const chunks = await arrayFromAsync(iterateTextLineChunks(filePath, attemptOptions, state));
            if (
                !state.snapshotVersion ||
                state.sizeBytes === null ||
                state.mtimeMs === null ||
                state.ctimeMs === null ||
                state.dev === null ||
                state.ino === null
            ) {
                throw createStaleChunkSnapshotError(filePath, attempt);
            }

            rememberByteLineIndexStreamSeed(filePath, state);

            return {
                path: filePath,
                chunks,
                totalLines: state.totalLines,
                totalLinesKnown: options.endLine === undefined,
                returnedLineCount: chunks.reduce(
                    (sum, chunk) => sum + Math.max(0, chunk.endLine - chunk.startLine + 1),
                    0,
                ),
                lastScannedLine: state.totalLines,
                stoppedAtRequestedWindow: state.stoppedAtRequestedWindow,
                bytesRead: state.bytesRead,
                chunkLines:
                    Number.isFinite(options.chunkLines) && Number(options.chunkLines) > 0
                        ? Math.floor(Number(options.chunkLines))
                        : 200,
                startLine,
                endLine: Number.isFinite(options.endLine) ? Math.max(startLine, Number(options.endLine)) : null,
                engine: 'io-engine.fs.createReadStream.textChunks',
                cacheFingerprintStrategy: 'stream-bypass',
                snapshotFingerprintStrategy: 'mtime-size-ctime-dev-ino',
                snapshotVersion: state.snapshotVersion,
                sizeBytes: state.sizeBytes,
                mtimeMs: state.mtimeMs,
                ctimeMs: state.ctimeMs,
                dev: state.dev,
                ino: state.ino,
                attempts: attempt,
                consistent: true,
            };
        } catch (error) {
            if (!isStaleChunkSnapshotError(error) || attempt > maxRetries) throw error;
            if (byteLineIndexCache.delete(normalizePathResourceKey(filePath))) byteLineIndexStats.stale += 1;
        }
    }

    throw createStaleChunkSnapshotError(filePath, maxRetries + 1);
}

/**
 * Exponibiliza o mesmo particionamento textual como `ReadableStream`.
 *
 * @param {string} filePath
 * @param {{
 *     chunkLines?: number;
 *     startLine?: number;
 *     endLine?: number;
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @returns {ReadableStream<TextLineChunk>}
 */
export function readTextLineChunksStream(filePath, options = {}) {
    const state = {
        totalLines: 0,
        bytesRead: 0,
        stoppedAtRequestedWindow: false,
        chunksEmitted: 0,
        snapshotVersion: /** @type {string | null} */ (null),
        sizeBytes: /** @type {number | null} */ (null),
        mtimeMs: /** @type {number | null} */ (null),
        ctimeMs: /** @type {number | null} */ (null),
        dev: /** @type {number | null} */ (null),
        ino: /** @type {number | null} */ (null),
    };
    const iterable = iterateTextLineChunks(filePath, { ...options, attempt: 1, deliveryMode: 'stream' }, state);
    const readableStreamFrom =
        /**
         * @type {{
         *     from: <T>(items: AsyncIterable<T> | Iterable<T>) => ReadableStream<T>;
         * }}
         */ (/** @type {unknown} */ (ReadableStream)).from;
    return readableStreamFrom(iterable);
}
