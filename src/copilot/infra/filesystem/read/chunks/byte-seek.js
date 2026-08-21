// @ts-check
/** Materialized bounded line windows resolved through the progressive byte-line index. */

import { toBufferView, utf8ByteLength } from '#copilot/infra/internal/platform';
import { open, stat } from 'node:fs/promises';
import { addAbortSignal } from 'node:stream';
import { chunkSnapshotMatchesStats, createStaleChunkSnapshotError, sameFileSnapshot } from '../snapshot/index.js';
import { decodeUtf8Buffer, decodeUtf8Chunk, throwAbortError } from './codec.js';

/** @typedef {import('../line-index/index.js').ByteLineIndexEntry} ByteLineIndexEntry */
/** @typedef {import('./types.js').TextLineChunk} TextLineChunk */

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
 *     readRuntime?: {byteLineIndex:ReturnType<typeof import('../line-index/index.js').createByteLineIndexRuntime>};
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
export async function readTextLineChunksByByteIndex(filePath, options = {}) {
    const startLine = Math.max(1, options.startLine ?? 1);
    const requestedEndLine = Number.isFinite(options.endLine) ? Math.max(startLine, Number(options.endLine)) : null;
    // An open-ended tail is a one-pass workload. Building an index to EOF and then rereading the tail doubles IO.
    if (requestedEndLine === null) return null;

    const byteLineIndex = options.readRuntime?.byteLineIndex ?? null;
    if (!byteLineIndex) return null;
    const lookup = await byteLineIndex.get(filePath, {
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
        if (!chunkSnapshotMatchesStats(byteIndex, currentStats)) {
            throw createStaleChunkSnapshotError(filePath, options.attempt ?? 1, {
                snapshotVersion: byteIndex.snapshotVersion,
            });
        }
        text = decodeUtf8Buffer(capturedRange);
        rangeSource = 'index-capture';
        byteLineIndex.recordCapturedRangeReuse(rangeByteLength);
    } else {
        text = await readUtf8Range(filePath, byteStart, byteEndExclusive, byteIndex, options);
        rangeBytesRead = rangeByteLength;
        byteLineIndex.recordRangeRead(rangeBytesRead);
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
        if (!chunkSnapshotMatchesStats(expected, before)) {
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
            !chunkSnapshotMatchesStats(expected, after)
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
