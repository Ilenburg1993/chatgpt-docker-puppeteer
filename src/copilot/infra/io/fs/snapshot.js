// @ts-check
/**
 * Snapshots binários streamados para mutações.
 *
 * @module copilot/infra/io/fs/snapshot
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { addAbortSignal } from 'node:stream';

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveIntegerOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

/**
 * Lê um arquivo por stream, calculando hash e guardando snapshot base64 apenas se couber no orçamento.
 *
 * @param {string} filePath
 * @param {{
 *     snapshotMaxBytes?: number;
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 * }} [options]
 * @returns {Promise<{
 *     contentHash: string;
 *     bytesRead: number;
 *     snapshotBase64: string | null;
 *     snapshotTruncated: boolean;
 * }>}
 */
export async function readBinaryMutationSnapshot(filePath, options = {}) {
    const snapshotMaxBytes = Math.max(0, positiveIntegerOr(options.snapshotMaxBytes, 256 * 1024));
    const highWaterMark = positiveIntegerOr(options.highWaterMark, 64 * 1024);
    const hash = createHash('sha256');
    /** @type {Buffer[]} */
    const snapshotChunks = [];
    let snapshotBytes = 0;
    let snapshotTruncated = false;
    let bytesRead = 0;

    const baseStream = createReadStream(filePath, { highWaterMark });
    const stream = options.signal ? addAbortSignal(options.signal, baseStream) : baseStream;

    try {
        for await (const chunk of stream) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytesRead += buf.byteLength;
            hash.update(buf);

            if (!snapshotTruncated && snapshotBytes + buf.byteLength <= snapshotMaxBytes) {
                snapshotChunks.push(buf);
                snapshotBytes += buf.byteLength;
            } else {
                snapshotTruncated = true;
                snapshotChunks.length = 0;
                snapshotBytes = 0;
            }
        }
    } finally {
        if (!stream.destroyed) stream.destroy();
    }

    return {
        contentHash: hash.digest('hex'),
        bytesRead,
        snapshotBase64: snapshotTruncated ? null : Buffer.concat(snapshotChunks, snapshotBytes).toString('base64'),
        snapshotTruncated,
    };
}
