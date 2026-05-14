// @ts-check
/**
 * Leitura textual baixa em chunks de linhas.
 *
 * @module copilot/infra/io/fs/read-chunks
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * @typedef {{ index: number; startLine: number; endLine: number; content: string; bytes: number }} TextLineChunk
 */

/**
 * @param {string} filePath
 * @param {{ chunkLines?: number; startLine?: number; endLine?: number }} [options]
 * @returns {Promise<{ path: string; chunks: TextLineChunk[]; totalLines: number; bytesRead: number; chunkLines: number; startLine: number; endLine: number | null }>}
 */
export async function readTextLineChunks(filePath, options = {}) {
    const chunkLines =
        Number.isFinite(options.chunkLines) && Number(options.chunkLines) > 0
            ? Math.floor(Number(options.chunkLines))
            : 200;
    const startLine = Math.max(1, options.startLine ?? 1);
    const endLine = Number.isFinite(options.endLine)
        ? Math.max(startLine, Number(options.endLine))
        : Number.POSITIVE_INFINITY;
    /** @type {TextLineChunk[]} */
    const chunks = [];
    /** @type {string[]} */
    let current = [];
    let currentStartLine = startLine;
    let totalLines = 0;
    let bytesRead = 0;

    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
        totalLines += 1;
        if (totalLines < startLine) continue;
        if (totalLines > endLine) break;
        if (current.length === 0) currentStartLine = totalLines;
        current.push(line);
        if (current.length >= chunkLines) {
            const content = current.join('\n');
            const bytes = Buffer.byteLength(content, 'utf8');
            bytesRead += bytes;
            chunks.push({
                index: chunks.length,
                startLine: currentStartLine,
                endLine: totalLines,
                content,
                bytes,
            });
            current = [];
        }
    }
    if (current.length > 0) {
        const content = current.join('\n');
        const bytes = Buffer.byteLength(content, 'utf8');
        bytesRead += bytes;
        chunks.push({
            index: chunks.length,
            startLine: currentStartLine,
            endLine: currentStartLine + current.length - 1,
            content,
            bytes,
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
