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
    /** @type {TextLineChunk[]} */
    const chunks = [];
    /** @type {string[]} */
    let current = [];
    let currentStartLine = startLine;
    let totalLines = 0;
    let bytesRead = 0;
    let carry = '';
    const decoder = new StringDecoder('utf8');
    let stoppedAtRequestedWindow = false;

    const baseStream = createReadStream(filePath, {
        ...(highWaterMark !== undefined ? { highWaterMark } : {}),
    });
    const stream = options.signal ? addAbortSignal(options.signal, baseStream) : baseStream;

    /**
     * @param {string} line
     * @returns {boolean} true quando a leitura deve continuar.
     */
    const pushLine = (line) => {
        totalLines += 1;
        if (totalLines < startLine) return true;
        if (totalLines > endLine) return false;
        if (current.length === 0) currentStartLine = totalLines;
        current.push(line);
        if (current.length >= chunkLines) {
            const content = current.join('\n');
            chunks.push({
                index: chunks.length,
                startLine: currentStartLine,
                endLine: totalLines,
                content,
                bytes: utf8ByteLength(content, 'read chunk'),
            });
            current = [];
        }
        return totalLines < endLine;
    };

    /**
     * @param {string} decoded
     * @param {boolean} final
     * @returns {boolean} true quando a leitura deve continuar.
     */
    const processDecoded = (decoded, final) => {
        let data = carry + decoded;
        carry = '';
        if (!final && data.endsWith('\r')) {
            carry = '\r';
            data = data.slice(0, -1);
        }
        if (data === '') return true;

        const parts = data.split(/\r\n|\n|\r/);
        if (!final) {
            carry += parts.pop() ?? '';
        } else if (/\r\n|\n|\r/.test(data.slice(-2))) {
            while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
        }

        for (const line of parts) {
            if (!pushLine(line)) return false;
        }
        return true;
    };

    try {
        for await (const chunk of stream) {
            const buf = toBufferView(/** @type {Buffer | Uint8Array} */ (chunk));
            bytesRead += buf.byteLength;
            if (!processDecoded(decoder.write(buf), false)) {
                stoppedAtRequestedWindow = true;
                break;
            }
        }
        if (!stoppedAtRequestedWindow) processDecoded(decoder.end(), true);
    } finally {
        if (!stream.destroyed) stream.destroy();
    }
    if (current.length > 0) {
        const content = current.join('\n');
        chunks.push({
            index: chunks.length,
            startLine: currentStartLine,
            endLine: currentStartLine + current.length - 1,
            content,
            bytes: utf8ByteLength(content, 'read chunk'),
        });
    }

    return {
        path: filePath,
        chunks,
        totalLines,
        bytesRead,
        chunkLines,
        startLine,
        endLine: Number.isFinite(endLine) ? endLine : null,
    };
}
