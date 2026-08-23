// @ts-check
/**
 * Snapshots binários streamados para mutações.
 *
 * @module copilot/infra/filesystem/transaction/snapshot
 */

import { createStaleSnapshotError, sameFileSnapshot } from '#copilot/infra/internal/filesystem/read';
import { concatBufferViews, toBufferView } from '#copilot/infra/internal/platform/buffer';
import { nonNegativeIntegerOr, positiveIntegerOr } from '#copilot/infra/internal/platform/config-values';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { addAbortSignal } from 'node:stream';
import { createRollbackSidecarWriter } from './rollback/index.js';

const DEFAULT_SNAPSHOT_RETRIES = 2;

/**
 * Lê um arquivo por stream, calculando hash e guardando snapshot base64 apenas se couber no orçamento.
 *
 * @param {string} filePath
 * @param {{
 *     snapshotMaxBytes?: number;
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     rollbackSidecar?: boolean | { directory?: string; ttlMs?: number; nowMs?: number; policy?: import('./rollback/policy.js').IoRollbackPolicy };
 *     maxRetries?: number;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @returns {Promise<{
 *     contentHash: string;
 *     bytesRead: number;
 *     snapshotBase64: string | null;
 *     snapshotTruncated: boolean;
 *     rollbackSidecar: import('./rollback/index.js').IoRollbackSidecar | null;
 *     attempts: number;
 *     consistent: true;
 * }>}
 */
export async function readBinaryMutationSnapshot(filePath, options = {}) {
    const snapshotMaxBytes = nonNegativeIntegerOr(options.snapshotMaxBytes, 256 * 1024);
    const highWaterMark = positiveIntegerOr(options.highWaterMark, 64 * 1024);
    const maxRetries =
        Number.isInteger(options.maxRetries) && Number(options.maxRetries) >= 0
            ? Math.min(10, Number(options.maxRetries))
            : DEFAULT_SNAPSHOT_RETRIES;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        options.signal?.throwIfAborted();
        const handle = await fs.open(filePath, 'r');
        const hash = createHash('sha256');
        /** @type {Buffer[]} */
        const snapshotChunks = [];
        let snapshotBytes = 0;
        let snapshotTruncated = false;
        let bytesRead = 0;
        /** @type {Awaited<ReturnType<typeof createRollbackSidecarWriter>> | null} */
        let sidecarWriter = null;
        const baseStream = handle.createReadStream({ highWaterMark, autoClose: false });
        const stream = options.signal ? addAbortSignal(options.signal, baseStream) : baseStream;

        try {
            const before = await handle.stat();
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
                if (options.onPhase) {
                    await options.onPhase('after-chunk', {
                        filePath,
                        attempt,
                        bytesRead,
                        chunkBytes: buf.byteLength,
                    });
                }
            }

            const after = await handle.stat();
            const pathAfter = await fs.stat(filePath);
            if (!sameFileSnapshot(before, after) || !sameFileSnapshot(after, pathAfter)) {
                if (sidecarWriter) {
                    await sidecarWriter.abort();
                    sidecarWriter = null;
                }
                if (attempt <= maxRetries) continue;
                throw createStaleSnapshotError(filePath, attempt);
            }

            const contentHash = hash.digest('hex');
            const rollbackSidecar = sidecarWriter
                ? await sidecarWriter.commit({ contentHash, bytes: bytesRead })
                : null;
            return {
                contentHash,
                bytesRead,
                snapshotBase64: snapshotTruncated
                    ? null
                    : concatBufferViews(snapshotChunks, snapshotBytes).toString('base64'),
                snapshotTruncated,
                rollbackSidecar,
                attempts: attempt,
                consistent: true,
            };
        } catch (error) {
            if (sidecarWriter) await sidecarWriter.abort();
            throw error;
        } finally {
            if (!stream.destroyed) stream.destroy();
            await handle.close().catch(() => undefined);
        }
    }

    throw createStaleSnapshotError(filePath, maxRetries + 1);
}
