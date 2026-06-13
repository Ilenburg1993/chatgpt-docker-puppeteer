// @ts-check
/**
 * Snapshots binários streamados para mutações.
 *
 * @module copilot/infra/io/fs/snapshot
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { addAbortSignal } from 'node:stream';
import { concatBufferViews, toBufferView } from '../../shared/buffer.js';
import { createRollbackSidecarWriter } from './rollback-sidecar.js';

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
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function nonNegativeIntegerOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

/**
 * Lê um arquivo por stream, calculando hash e guardando snapshot base64 apenas se couber no orçamento.
 *
 * @param {string} filePath
 * @param {{
 *     snapshotMaxBytes?: number;
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     rollbackSidecar?: boolean | { directory?: string; ttlMs?: number; nowMs?: number };
 * }} [options]
 * @returns {Promise<{
 *     contentHash: string;
 *     bytesRead: number;
 *     snapshotBase64: string | null;
 *     snapshotTruncated: boolean;
 *     rollbackSidecar: import('./rollback-sidecar.js').IoRollbackSidecar | null;
 * }>}
 */
export async function readBinaryMutationSnapshot(filePath, options = {}) {
    const snapshotMaxBytes = nonNegativeIntegerOr(options.snapshotMaxBytes, 256 * 1024);
    const highWaterMark = positiveIntegerOr(options.highWaterMark, 64 * 1024);
    const hash = createHash('sha256');
    /** @type {Buffer[]} */
    const snapshotChunks = [];
    let snapshotBytes = 0;
    let snapshotTruncated = false;
    let bytesRead = 0;
    /** @type {Awaited<ReturnType<typeof createRollbackSidecarWriter>> | null} */
    let sidecarWriter = null;
    /** @type {import('./rollback-sidecar.js').IoRollbackSidecar | null} */
    let rollbackSidecar = null;

    const baseStream = createReadStream(filePath, { highWaterMark });
    const stream = options.signal ? addAbortSignal(options.signal, baseStream) : baseStream;

    try {
        for await (const chunk of stream) {
            const buf = toBufferView(/** @type {Buffer | Uint8Array} */ (chunk));
            bytesRead += buf.byteLength;
            hash.update(buf);

            if (!snapshotTruncated && snapshotBytes + buf.byteLength <= snapshotMaxBytes) {
                snapshotChunks.push(buf);
                snapshotBytes += buf.byteLength;
            } else {
                if (!snapshotTruncated && options.rollbackSidecar) {
                    const sidecarOptions = options.rollbackSidecar === true ? {} : options.rollbackSidecar;
                    sidecarWriter = await createRollbackSidecarWriter(sidecarOptions);
                    for (const retainedChunk of snapshotChunks) await sidecarWriter.write(retainedChunk);
                    await sidecarWriter.write(buf);
                } else if (sidecarWriter) {
                    await sidecarWriter.write(buf);
                }
                snapshotTruncated = true;
                snapshotChunks.length = 0;
                snapshotBytes = 0;
            }
        }
        const contentHash = hash.digest('hex');
        if (sidecarWriter) {
            rollbackSidecar = await sidecarWriter.commit({ contentHash, bytes: bytesRead });
        }
        return {
            contentHash,
            bytesRead,
            snapshotBase64: snapshotTruncated
                ? null
                : concatBufferViews(snapshotChunks, snapshotBytes).toString('base64'),
            snapshotTruncated,
            rollbackSidecar,
        };
    } catch (error) {
        if (sidecarWriter) await sidecarWriter.abort();
        throw error;
    } finally {
        if (!stream.destroyed) stream.destroy();
    }
}
