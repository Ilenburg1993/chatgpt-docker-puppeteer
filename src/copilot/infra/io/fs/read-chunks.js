// @ts-check
/**
 * Leitura textual baixa em chunks de linhas.
 *
 * @module copilot/infra/io/fs/read-chunks
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { addAbortSignal } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { toBufferView, utf8ByteLength } from '../../shared/buffer.js';

const BYTE_LINE_INDEX_MAX_ENTRIES = 64;
const DEFAULT_BYTE_LINE_INDEX_MAX_LINES = 1_000_000;
const HARD_BYTE_LINE_INDEX_MAX_LINES = 5_000_000;

/**
 * @typedef {{ index: number; startLine: number; endLine: number; content: string; bytes: number }} TextLineChunk
 * @typedef {{ sizeBytes: number; mtimeMs: number; lineStarts: number[]; totalLines: number; builtAtMs: number }} ByteLineIndexEntry
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
 * @returns {number}
 */
function readByteLineIndexMaxLines() {
    const configured = Number(process.env['COPILOT_IO_BYTE_LINE_INDEX_MAX_LINES'] ?? DEFAULT_BYTE_LINE_INDEX_MAX_LINES);
    if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_BYTE_LINE_INDEX_MAX_LINES;
    return Math.min(HARD_BYTE_LINE_INDEX_MAX_LINES, Math.floor(configured));
}

/**
 * @param {string} filePath
 * @returns {Promise<ByteLineIndexEntry | null>}
 */
async function getByteLineIndex(filePath) {
    if (process.env['COPILOT_IO_BYTE_LINE_INDEX_DISABLE'] === 'true') return null;
    const stats = await stat(filePath);
    const sizeBytes = Number(stats.size);
    const mtimeMs = Number(stats.mtimeMs);
    const cached = byteLineIndexCache.get(filePath);
    if (cached && cached.sizeBytes === sizeBytes && cached.mtimeMs === mtimeMs) {
        byteLineIndexCache.delete(filePath);
        byteLineIndexCache.set(filePath, cached);
        return cached;
    }
    const built = await buildByteLineIndex(filePath, sizeBytes, mtimeMs);
    if (!built) return null;
    byteLineIndexCache.set(filePath, built);
    trimByteLineIndexCache();
    return built;
}

/**
 * @param {string} filePath
 * @param {number} sizeBytes
 * @param {number} mtimeMs
 * @returns {Promise<ByteLineIndexEntry | null>}
 */
async function buildByteLineIndex(filePath, sizeBytes, mtimeMs) {
    const maxLines = readByteLineIndexMaxLines();
    if (sizeBytes === 0) {
        return { sizeBytes, mtimeMs, lineStarts: [], totalLines: 0, builtAtMs: Date.now() };
    }
    /** @type {number[]} */
    const lineStarts = [0];
    let byteOffset = 0;
    /** @type {number | null} */
    let pendingCrOffset = null;
    const stream = createReadStream(filePath);
    for await (const chunk of stream) {
        const buf = toBufferView(/** @type {Buffer | Uint8Array} */ (chunk));
        for (let index = 0; index < buf.byteLength; index += 1) {
            const byte = buf[index];
            if (pendingCrOffset !== null) {
                if (byte === 0x0a) {
                    lineStarts.push(byteOffset + 1);
                    pendingCrOffset = null;
                    byteOffset += 1;
                    if (lineStarts.length > maxLines + 1) return null;
                    continue;
                }
                lineStarts.push(pendingCrOffset + 1);
                pendingCrOffset = null;
                if (lineStarts.length > maxLines + 1) return null;
            }
            if (byte === 0x0d) {
                pendingCrOffset = byteOffset;
            } else if (byte === 0x0a) {
                lineStarts.push(byteOffset + 1);
                if (lineStarts.length > maxLines + 1) return null;
            }
            byteOffset += 1;
        }
    }
    if (pendingCrOffset !== null) lineStarts.push(pendingCrOffset + 1);
    while (lineStarts.length > 0 && lineStarts[lineStarts.length - 1] === sizeBytes) lineStarts.pop();
    return { sizeBytes, mtimeMs, lineStarts, totalLines: lineStarts.length, builtAtMs: Date.now() };
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
 * }} [options]
 * @param {{ totalLines: number; bytesRead: number; stoppedAtRequestedWindow: boolean }} [state={ totalLines: 0, bytesRead: 0, stoppedAtRequestedWindow: false }]
 *   Default is `{ totalLines: 0, bytesRead: 0, stoppedAtRequestedWindow: false }`
 * @returns {AsyncGenerator<TextLineChunk, void, void>}
 */
async function* iterateTextLineChunks(
    filePath,
    options = {},
    state = { totalLines: 0, bytesRead: 0, stoppedAtRequestedWindow: false },
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
    const decoder = new StringDecoder('utf8');

    const baseStream = createReadStream(filePath, {
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
            endLine: state.totalLines,
            content,
            bytes: utf8ByteLength(content, 'read chunk'),
        };
        chunkIndex += 1;
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
        if (!final && data.endsWith('\r')) {
            carry = '\r';
            data = data.slice(0, -1);
        }
        if (data === '') return emitted;

        const parts = data.split(/\r\n|\n|\r/);
        if (!final) {
            carry += parts.pop() ?? '';
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
            for (const emitted of processDecoded(decoder.write(buf), false)) {
                yield emitted;
            }
            if (state.stoppedAtRequestedWindow) break;
        }
        if (!state.stoppedAtRequestedWindow) {
            for (const emitted of processDecoded(decoder.end(), true)) {
                yield emitted;
            }
        }
    } finally {
        if (!stream.destroyed) stream.destroy();
    }

    if (current.length > 0) {
        yield emitChunk(current.join('\n'));
    }
}

/**
 * @param {string} filePath
 * @param {{ chunkLines?: number; startLine?: number; endLine?: number; highWaterMark?: number; signal?: AbortSignal }} [options]
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
 * } | null>}
 */
async function readTextLineChunksByByteIndex(filePath, options = {}) {
    const byteIndex = await getByteLineIndex(filePath);
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
        };
    }
    const maybeByteStart = byteIndex.lineStarts[startLine - 1];
    const maybeByteEndExclusive = endLine < byteIndex.totalLines ? byteIndex.lineStarts[endLine] : byteIndex.sizeBytes;
    if (!Number.isFinite(maybeByteStart) || !Number.isFinite(maybeByteEndExclusive)) return null;
    const byteStart = Number(maybeByteStart);
    const byteEndExclusive = Number(maybeByteEndExclusive);
    if (byteEndExclusive < byteStart) return null;
    const text = await readUtf8Range(filePath, byteStart, byteEndExclusive, options);
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
    };
}

/**
 * @param {string} filePath
 * @param {number} byteStart
 * @param {number} byteEndExclusive
 * @param {{ highWaterMark?: number; signal?: AbortSignal }} options
 * @returns {Promise<string>}
 */
async function readUtf8Range(filePath, byteStart, byteEndExclusive, options) {
    if (options.signal?.aborted) throwAbortError();
    if (byteEndExclusive <= byteStart) return '';
    const highWaterMark = Number.isFinite(options.highWaterMark) && Number(options.highWaterMark) > 0 ? Math.floor(Number(options.highWaterMark)) : undefined;
    const decoder = new StringDecoder('utf8');
    let text = '';
    const baseStream = createReadStream(filePath, {
        start: byteStart,
        end: byteEndExclusive - 1,
        ...(highWaterMark !== undefined ? { highWaterMark } : {}),
    });
    const stream = options.signal ? addAbortSignal(options.signal, baseStream) : baseStream;
    try {
        for await (const chunk of stream) {
            text += decoder.write(toBufferView(/** @type {Buffer | Uint8Array} */ (chunk)));
        }
        text += decoder.end();
        return text;
    } finally {
        if (!stream.destroyed) stream.destroy();
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
 * }>}
 */
export async function readTextLineChunks(filePath, options = {}) {
    if (options.signal?.aborted) throwAbortError();
    const startLine = Math.max(1, options.startLine ?? 1);
    if (startLine > 1) {
        const seekSnapshot = await readTextLineChunksByByteIndex(filePath, options).catch(() => null);
        if (seekSnapshot) return seekSnapshot;
    }
    const state = { totalLines: 0, bytesRead: 0, stoppedAtRequestedWindow: false };
    const arrayCtor = /** @type {any} */ (Array);
    const chunks = await arrayCtor.fromAsync(iterateTextLineChunks(filePath, options, state));

    return {
        path: filePath,
        chunks,
        totalLines: state.totalLines,
        totalLinesKnown: options.endLine === undefined,
        returnedLineCount: chunks.reduce(
            (/** @type {number} */ sum, /** @type {TextLineChunk} */ chunk) =>
                sum + Math.max(0, chunk.endLine - chunk.startLine + 1),
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
    };
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
 * }} [options]
 * @returns {ReadableStream<TextLineChunk>}
 */
export function readTextLineChunksStream(filePath, options = {}) {
    const state = { totalLines: 0, bytesRead: 0, stoppedAtRequestedWindow: false };
    const iterable = iterateTextLineChunks(filePath, options, state);
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
