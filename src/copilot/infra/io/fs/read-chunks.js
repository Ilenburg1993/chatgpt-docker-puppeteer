// @ts-check
/**
 * Leitura textual baixa em chunks de linhas.
 *
 * @module copilot/infra/io/fs/read-chunks
 */

import { createReadStream } from 'node:fs';
import { addAbortSignal } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { toBufferView, utf8ByteLength } from '../../shared/buffer.js';

/**
 * @typedef {{ index: number; startLine: number; endLine: number; content: string; bytes: number }} TextLineChunk
 */

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
 *     bytesRead: number;
 *     chunkLines: number;
 *     startLine: number;
 *     endLine: number | null;
 * }>}
 */
export async function readTextLineChunks(filePath, options = {}) {
    if (options.signal?.aborted) throwAbortError();
    const state = { totalLines: 0, bytesRead: 0, stoppedAtRequestedWindow: false };
    const arrayCtor = /** @type {any} */ (Array);
    const chunks = await arrayCtor.fromAsync(iterateTextLineChunks(filePath, options, state));

    return {
        path: filePath,
        chunks,
        totalLines: state.totalLines,
        bytesRead: state.bytesRead,
        chunkLines:
            Number.isFinite(options.chunkLines) && Number(options.chunkLines) > 0
                ? Math.floor(Number(options.chunkLines))
                : 200,
        startLine: Math.max(1, options.startLine ?? 1),
        endLine: Number.isFinite(options.endLine)
            ? Math.max(Math.max(1, options.startLine ?? 1), Number(options.endLine))
            : null,
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
