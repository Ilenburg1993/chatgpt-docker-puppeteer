// @ts-check
/** Progressive byte-line index builder; owns no cache or invalidation state. */

import { toBufferView } from '#copilot/infra/internal/platform/buffer';
import { open, stat } from 'node:fs/promises';
import { addAbortSignal } from 'node:stream';
import {
    buildSnapshotVersion,
    chunkSnapshotMatchesStats,
    createStaleChunkSnapshotError,
    fingerprintFromStats,
    sameFileSnapshot,
} from '../snapshot/index.js';
import { readByteLineIndexConfig, resolveByteLineIndexHighWaterMark } from './policy.js';
import { scanPhysicalLineStartsFromBuffer } from './scanner.js';

/** @typedef {import('./types.js').ByteLineIndexEntry} ByteLineIndexEntry */

/**
 * @param {string} filePath
 * @param {{
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     attempt?: number;
 *     requiredLineStarts?: number;
 *     captureStartLine?: number;
 *     existing?: ByteLineIndexEntry;
 *     maxLines?: number;
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
export async function buildByteLineIndex(filePath, options = {}) {
    options.signal?.throwIfAborted();
    const maxLines =
        Number.isFinite(options.maxLines) && Number(options.maxLines) > 0
            ? Math.floor(Number(options.maxLines))
            : readByteLineIndexConfig({}).maxLines;
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
            options.existing && chunkSnapshotMatchesStats(options.existing, before) ? options.existing : null;
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
                const scan = scanPhysicalLineStartsFromBuffer(buf, chunkFileStart, pendingCrOffset, (lineStart) => {
                    lineStarts.push(lineStart);
                    return checkLineLimit() || targetSatisfied();
                });
                pendingCrOffset = scan.pendingCrOffset;
                byteOffset = chunkFileStart + scan.consumedBytes;
                const stopChunk = scan.stopped;
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
