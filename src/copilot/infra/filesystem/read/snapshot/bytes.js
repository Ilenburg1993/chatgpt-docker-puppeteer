// @ts-check
/**
 * Leitura binária baixa, sem cache.
 *
 * @module copilot/infra/filesystem/read/snapshot/bytes
 */

import { richFingerprintMatches } from '#copilot/infra/internal/platform/fingerprint';
import * as fs from 'node:fs/promises';

const DEFAULT_SNAPSHOT_RETRIES = 2;

/**
 * @param {import('node:fs').Stats} left
 * @param {import('node:fs').Stats} right
 * @returns {boolean}
 */
export function sameFileSnapshot(left, right) {
    return richFingerprintMatches(
        {
            sizeBytes: left.size,
            mtimeMs: left.mtimeMs,
            ctimeMs: left.ctimeMs,
            dev: Number(left.dev),
            ino: Number(left.ino),
        },
        {
            sizeBytes: right.size,
            mtimeMs: right.mtimeMs,
            ctimeMs: right.ctimeMs,
            dev: Number(right.dev),
            ino: Number(right.ino),
        },
        { mtimeToleranceMs: 0 },
    );
}

/**
 * @param {string} filePath
 * @param {number} attempts
 * @returns {Error & { code?: string; attempts?: number }}
 */
export function createStaleSnapshotError(filePath, attempts) {
    const error = /** @type {Error & { code?: string; attempts?: number }} */ (
        new Error(`Arquivo mudou durante snapshot consistente: ${filePath}`)
    );
    error.code = 'ESTALESNAPSHOT';
    error.attempts = attempts;
    return error;
}

/**
 * @param {string} filePath
 * @param {{ signal?: AbortSignal; maxRetries?: number }} [options]
 * @returns {Promise<{
 *     path: string;
 *     content: Buffer;
 *     bytesRead: number;
 *     sizeBytes: number;
 *     mtimeMs: number;
 *     ctimeMs: number;
 *     dev: number;
 *     ino: number;
 *     mode: number;
 *     isFile: boolean;
 *     attempts: number;
 *     consistent: true;
 * }>}
 */
export async function readBytesFileSnapshot(filePath, options = {}) {
    const maxRetries =
        Number.isInteger(options.maxRetries) && Number(options.maxRetries) >= 0
            ? Math.min(10, Number(options.maxRetries))
            : DEFAULT_SNAPSHOT_RETRIES;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        options.signal?.throwIfAborted();
        const handle = await fs.open(filePath, 'r');
        try {
            const before = await handle.stat();
            const content = await handle.readFile(options.signal ? { signal: options.signal } : undefined);
            const after = await handle.stat();
            const pathAfter = await fs.stat(filePath);
            if (!sameFileSnapshot(before, after) || !sameFileSnapshot(after, pathAfter)) {
                if (attempt <= maxRetries) continue;
                throw createStaleSnapshotError(filePath, attempt);
            }
            return {
                path: filePath,
                content,
                bytesRead: content.byteLength,
                sizeBytes: after.size,
                mtimeMs: after.mtimeMs,
                ctimeMs: after.ctimeMs,
                dev: Number(after.dev),
                ino: Number(after.ino),
                mode: Number(after.mode),
                isFile: after.isFile(),
                attempts: attempt,
                consistent: true,
            };
        } finally {
            await handle.close().catch(() => undefined);
        }
    }

    throw createStaleSnapshotError(filePath, maxRetries + 1);
}

/**
 * Read a bounded byte range from one consistent physical file snapshot without materializing the whole file.
 *
 * `fromEnd=true` turns `maxBytes` into a tail budget. Otherwise `start` is the absolute byte offset and `maxBytes`
 * bounds the forward read. When `rejectSymlink` is enabled, both lexical snapshots must remain regular non-symlink
 * files across the operation.
 *
 * @param {string} filePath
 * @param {{
 *     start?: number;
 *     maxBytes: number;
 *     fromEnd?: boolean;
 *     rejectSymlink?: boolean;
 *     signal?: AbortSignal;
 *     maxRetries?: number;
 * }} options
 * @returns {Promise<{
 *     path: string;
 *     content: Buffer;
 *     bytesRead: number;
 *     startByte: number;
 *     endByteExclusive: number;
 *     sizeBytes: number;
 *     mtimeMs: number;
 *     ctimeMs: number;
 *     dev: number;
 *     ino: number;
 *     mode: number;
 *     isFile: boolean;
 *     truncatedBefore: boolean;
 *     truncatedAfter: boolean;
 *     attempts: number;
 *     consistent: true;
 * }>}
 */
export async function readBytesFileRangeSnapshot(filePath, options) {
    const maxBytes = Number(options?.maxBytes);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
        throw new RangeError('readBytesFileRangeSnapshot requires maxBytes >= 0.');
    }
    const requestedStart = Number(options?.start ?? 0);
    if (!Number.isSafeInteger(requestedStart) || requestedStart < 0) {
        throw new RangeError('readBytesFileRangeSnapshot start must be a non-negative safe integer.');
    }
    const maxRetries =
        Number.isInteger(options.maxRetries) && Number(options.maxRetries) >= 0
            ? Math.min(10, Number(options.maxRetries))
            : DEFAULT_SNAPSHOT_RETRIES;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        options.signal?.throwIfAborted();
        const lexicalBefore = options.rejectSymlink ? await fs.lstat(filePath) : null;
        if (lexicalBefore && (lexicalBefore.isSymbolicLink() || !lexicalBefore.isFile())) {
            const error = /** @type {Error & { code?: string }} */ (
                new Error(`Bounded range read requires a regular non-symlink file: ${filePath}`)
            );
            error.code = lexicalBefore.isSymbolicLink() ? 'ELOOP' : 'EISDIR';
            throw error;
        }
        const handle = await fs.open(filePath, 'r');
        try {
            const before = await handle.stat();
            const startByte =
                options.fromEnd === true ? Math.max(0, before.size - maxBytes) : Math.min(before.size, requestedStart);
            const available = Math.max(0, before.size - startByte);
            const requestedLength = Math.min(maxBytes, available);
            const content = Buffer.allocUnsafe(requestedLength);
            let totalRead = 0;
            while (totalRead < requestedLength) {
                options.signal?.throwIfAborted();
                const { bytesRead } = await handle.read(
                    content,
                    totalRead,
                    requestedLength - totalRead,
                    startByte + totalRead,
                );
                if (bytesRead <= 0) break;
                totalRead += bytesRead;
            }
            const boundedContent = totalRead === content.byteLength ? content : content.subarray(0, totalRead);
            const after = await handle.stat();
            const pathAfter = await fs.stat(filePath);
            const lexicalAfter = options.rejectSymlink ? await fs.lstat(filePath) : null;
            const lexicalStable =
                lexicalBefore === null ||
                (lexicalAfter !== null &&
                    !lexicalAfter.isSymbolicLink() &&
                    lexicalAfter.isFile() &&
                    sameFileSnapshot(lexicalBefore, lexicalAfter) &&
                    sameFileSnapshot(lexicalAfter, pathAfter));
            if (!sameFileSnapshot(before, after) || !sameFileSnapshot(after, pathAfter) || !lexicalStable) {
                if (attempt <= maxRetries) continue;
                throw createStaleSnapshotError(filePath, attempt);
            }
            const endByteExclusive = startByte + totalRead;
            return {
                path: filePath,
                content: boundedContent,
                bytesRead: totalRead,
                startByte,
                endByteExclusive,
                sizeBytes: after.size,
                mtimeMs: after.mtimeMs,
                ctimeMs: after.ctimeMs,
                dev: Number(after.dev),
                ino: Number(after.ino),
                mode: Number(after.mode),
                isFile: after.isFile(),
                truncatedBefore: startByte > 0,
                truncatedAfter: endByteExclusive < after.size,
                attempts: attempt,
                consistent: true,
            };
        } finally {
            await handle.close().catch(() => undefined);
        }
    }

    throw createStaleSnapshotError(filePath, maxRetries + 1);
}
