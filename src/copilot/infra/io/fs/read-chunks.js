// @ts-check
/**
 * Leitura textual baixa em chunks de linhas.
 *
 * @module copilot/infra/io/fs/read-chunks
 */

import { open, stat } from 'node:fs/promises';
import { addAbortSignal } from 'node:stream';
import { normalizePathResourceKey } from '../../policy/path-resource.js';
import { toBufferView, utf8ByteLength } from '../../shared/buffer.js';
import { richFingerprintMatches } from '../../shared/fingerprint-match.js';
import { sha256 } from '../../shared/hash.js';
import { sameFileSnapshot } from './read-bytes.js';

const BYTE_LINE_INDEX_MAX_ENTRIES = 64;
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
 * @typedef {{
 *     sizeBytes: number;
 *     mtimeMs: number;
 *     ctimeMs: number;
 *     dev: number;
 *     ino: number;
 *     snapshotVersion: string;
 *     lineStarts: number[];
 *     totalLines: number;
 *     builtAtMs: number;
 * }} ByteLineIndexEntry
 */

/** @type {Map<string, ByteLineIndexEntry>} */
const byteLineIndexCache = new Map();

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
    const error = /** @type {Error & {
     *     code?: string;
     *     attempts?: number;
     *     partial?: boolean;
     *     snapshotVersion?: string;
     * }} */ (new Error(`Arquivo mudou durante leitura textual em chunks: ${filePath}`));
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

/**
 * @returns {number}
 */
function readByteLineIndexMaxLines() {
    const configured = Number(process.env['COPILOT_IO_BYTE_LINE_INDEX_MAX_LINES'] ?? DEFAULT_BYTE_LINE_INDEX_MAX_LINES);
    if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_BYTE_LINE_INDEX_MAX_LINES;
    return Math.min(HARD_BYTE_LINE_INDEX_MAX_LINES, Math.floor(configured));
}

/**
 * @param {string} filePath
 * @param {{
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     attempt?: number;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @returns {Promise<ByteLineIndexEntry | null>}
 */
async function getByteLineIndex(filePath, options = {}) {
    if (process.env['COPILOT_IO_BYTE_LINE_INDEX_DISABLE'] === 'true') return null;
    const cacheKey = normalizePathResourceKey(filePath);
    const stats = await stat(filePath);
    const cached = byteLineIndexCache.get(cacheKey);
    if (cached && byteLineIndexMatchesStats(cached, stats)) {
        byteLineIndexCache.delete(cacheKey);
        byteLineIndexCache.set(cacheKey, cached);
        return cached;
    }
    if (cached) byteLineIndexCache.delete(cacheKey);
    const built = await buildByteLineIndex(filePath, {
        ...(options.highWaterMark !== undefined ? { highWaterMark: options.highWaterMark } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.attempt !== undefined ? { attempt: options.attempt } : {}),
        ...(options.onPhase ? { onPhase: options.onPhase } : {}),
    });
    if (!built) return null;
    byteLineIndexCache.set(cacheKey, built);
    trimByteLineIndexCache();
    return built;
}

/**
 * @param {string} filePath
 * @param {{
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     attempt?: number;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @returns {Promise<ByteLineIndexEntry | null>}
 */
async function buildByteLineIndex(filePath, options = {}) {
    options.signal?.throwIfAborted();
    const maxLines = readByteLineIndexMaxLines();
    const handle = await open(filePath, 'r');
    /** @type {number[]} */
    const lineStarts = [0];
    let byteOffset = 0;
    let exceededMaxLines = false;
    /** @type {number | null} */
    let pendingCrOffset = null;
    const highWaterMark =
        Number.isFinite(options.highWaterMark) && Number(options.highWaterMark) > 0
            ? Math.floor(Number(options.highWaterMark))
            : undefined;
    const baseStream = handle.createReadStream({
        autoClose: false,
        ...(highWaterMark !== undefined ? { highWaterMark } : {}),
    });
    const stream = options.signal ? addAbortSignal(options.signal, baseStream) : baseStream;

    try {
        const before = await handle.stat();
        const fingerprint = fingerprintFromStats(before);
        const snapshotVersion = buildSnapshotVersion(fingerprint);
        if (before.size > 0) {
            for await (const chunk of stream) {
                const buf = toBufferView(/** @type {Buffer | Uint8Array} */ (chunk));
                for (let index = 0; index < buf.byteLength; index += 1) {
                    const byte = buf[index];
                    if (pendingCrOffset !== null) {
                        if (byte === 0x0a) {
                            lineStarts.push(byteOffset + 1);
                            pendingCrOffset = null;
                            byteOffset += 1;
                            if (lineStarts.length > maxLines + 1) exceededMaxLines = true;
                            if (exceededMaxLines) break;
                            continue;
                        }
                        lineStarts.push(pendingCrOffset + 1);
                        pendingCrOffset = null;
                        if (lineStarts.length > maxLines + 1) exceededMaxLines = true;
                        if (exceededMaxLines) break;
                    }
                    if (byte === 0x0d) {
                        pendingCrOffset = byteOffset;
                    } else if (byte === 0x0a) {
                        lineStarts.push(byteOffset + 1);
                        if (lineStarts.length > maxLines + 1) exceededMaxLines = true;
                        if (exceededMaxLines) break;
                    }
                    byteOffset += 1;
                }
                if (options.onPhase) {
                    await options.onPhase('after-byte-index-chunk', {
                        filePath,
                        attempt: options.attempt ?? 1,
                        bytesRead: byteOffset,
                        chunkBytes: buf.byteLength,
                        snapshotVersion,
                    });
                }
                if (exceededMaxLines) break;
            }
        }
        const after = await handle.stat();
        const pathAfter = await stat(filePath);
        if (!sameFileSnapshot(before, after) || !sameFileSnapshot(after, pathAfter)) {
            throw createStaleChunkSnapshotError(filePath, options.attempt ?? 1, { snapshotVersion });
        }
        if (exceededMaxLines) return null;
        if (pendingCrOffset !== null) lineStarts.push(pendingCrOffset + 1);
        while (lineStarts.length > 0 && lineStarts[lineStarts.length - 1] === after.size) lineStarts.pop();
        if (after.size === 0) lineStarts.length = 0;
        const built = {
            ...fingerprintFromStats(after),
            snapshotVersion,
            lineStarts,
            totalLines: lineStarts.length,
            builtAtMs: Date.now(),
        };
        if (options.onPhase) {
            await options.onPhase('after-byte-index-built', {
                filePath,
                attempt: options.attempt ?? 1,
                totalLines: built.totalLines,
                snapshotVersion,
            });
        }
        return built;
    } finally {
        if (!stream.destroyed) stream.destroy();
        await handle.close().catch(() => undefined);
    }
}

/** @returns {void} */
function trimByteLineIndexCache() {
    while (byteLineIndexCache.size > BYTE_LINE_INDEX_MAX_ENTRIES) {
        const oldest = byteLineIndexCache.keys().next().value;
        if (typeof oldest !== 'string') break;
        byteLineIndexCache.delete(oldest);
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
    const highWaterMark =
        Number.isFinite(options.highWaterMark) && Number(options.highWaterMark) > 0
            ? Math.floor(Number(options.highWaterMark))
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
 *     chunkLines: number;
 *     startLine: number;
 *     endLine: number | null;
 *     engine: string;
 *     cacheFingerprintStrategy: string;
 *     snapshotFingerprintStrategy: string;
 *     snapshotVersion: string;
 *     sizeBytes: number;
 *     mtimeMs: number;
 *     consistent: true;
 * } | null>}
 */
async function readTextLineChunksByByteIndex(filePath, options = {}) {
    const byteIndex = await getByteLineIndex(filePath, options);
    if (!byteIndex || byteIndex.totalLines === 0) return null;
    const startLine = Math.max(1, options.startLine ?? 1);
    const requestedEndLine = Number.isFinite(options.endLine) ? Math.max(startLine, Number(options.endLine)) : null;
    const endLine = requestedEndLine === null ? byteIndex.totalLines : Math.min(requestedEndLine, byteIndex.totalLines);
    const chunkLines = Number.isFinite(options.chunkLines) && Number(options.chunkLines) > 0 ? Math.floor(Number(options.chunkLines)) : 200;
    if (startLine > byteIndex.totalLines || startLine > endLine) {
        return {
            path: filePath,
            chunks: [],
            totalLines: byteIndex.totalLines,
            totalLinesKnown: true,
            returnedLineCount: 0,
            lastScannedLine: byteIndex.totalLines,
            stoppedAtRequestedWindow: false,
            bytesRead: 0,
            chunkLines,
            startLine,
            endLine: requestedEndLine,
            engine: 'io-engine.fs.createReadStream.textChunks.byteSeek',
            cacheFingerprintStrategy: 'byte-line-index',
            snapshotFingerprintStrategy: 'mtime-size-ctime-dev-ino',
            snapshotVersion: byteIndex.snapshotVersion,
            sizeBytes: byteIndex.sizeBytes,
            mtimeMs: byteIndex.mtimeMs,
            consistent: true,
        };
    }
    const maybeByteStart = byteIndex.lineStarts[startLine - 1];
    const maybeByteEndExclusive = endLine < byteIndex.totalLines ? byteIndex.lineStarts[endLine] : byteIndex.sizeBytes;
    if (!Number.isFinite(maybeByteStart) || !Number.isFinite(maybeByteEndExclusive)) return null;
    const byteStart = Number(maybeByteStart);
    const byteEndExclusive = Number(maybeByteEndExclusive);
    if (byteEndExclusive < byteStart) return null;
    const text = await readUtf8Range(filePath, byteStart, byteEndExclusive, byteIndex, options);
    const lines = splitTextLinesLikeScanner(text);
    const chunks = buildTextLineChunks(lines, startLine, chunkLines);
    return {
        path: filePath,
        chunks,
        totalLines: byteIndex.totalLines,
        totalLinesKnown: true,
        returnedLineCount: lines.length,
        lastScannedLine: endLine,
        stoppedAtRequestedWindow: requestedEndLine !== null && endLine < byteIndex.totalLines,
        bytesRead: Math.max(0, byteEndExclusive - byteStart),
        chunkLines,
        startLine,
        endLine: requestedEndLine,
        engine: 'io-engine.fs.createReadStream.textChunks.byteSeek',
        cacheFingerprintStrategy: 'byte-line-index',
        snapshotFingerprintStrategy: 'mtime-size-ctime-dev-ino',
        snapshotVersion: byteIndex.snapshotVersion,
        sizeBytes: byteIndex.sizeBytes,
        mtimeMs: byteIndex.mtimeMs,
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
 *     chunkLines: number;
 *     startLine: number;
 *     endLine: number | null;
 *     engine?: string;
 *     cacheFingerprintStrategy?: string;
 *     snapshotFingerprintStrategy: string;
 *     snapshotVersion: string;
 *     sizeBytes: number;
 *     mtimeMs: number;
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
            };
            const arrayCtor = /** @type {any} */ (Array);
            const chunks = /** @type {TextLineChunk[]} */ (
                await arrayCtor.fromAsync(iterateTextLineChunks(filePath, attemptOptions, state))
            );
            if (!state.snapshotVersion || state.sizeBytes === null || state.mtimeMs === null) {
                throw createStaleChunkSnapshotError(filePath, attempt);
            }

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
                attempts: attempt,
                consistent: true,
            };
        } catch (error) {
            if (!isStaleChunkSnapshotError(error) || attempt > maxRetries) throw error;
            byteLineIndexCache.delete(normalizePathResourceKey(filePath));
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
    };
    const iterable = iterateTextLineChunks(filePath, { ...options, attempt: 1, deliveryMode: 'stream' }, state);
    const readableStreamCtor = /** @type {any} */ (globalThis.ReadableStream);
    if (typeof readableStreamCtor?.from === 'function') {
        return readableStreamCtor.from(iterable);
    }

    return new ReadableStream({
        async start(controller) {
            try {
                for await (const chunk of iterable) controller.enqueue(chunk);
                controller.close();
            } catch (error) {
                controller.error(error);
            }
        },
    });
}
