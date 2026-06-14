// @ts-check
/**
 * Leitura binária baixa, sem cache.
 *
 * @module copilot/infra/io/fs/read-bytes
 */

import * as fs from 'node:fs/promises';
import { richFingerprintMatches } from '../../shared/fingerprint-match.js';

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
                attempts: attempt,
                consistent: true,
            };
        } finally {
            await handle.close().catch(() => undefined);
        }
    }

    throw createStaleSnapshotError(filePath, maxRetries + 1);
}
