// @ts-check
/**
 * Leitura binária baixa, sem cache.
 *
 * @module copilot/infra/io/fs/read-bytes
 */

import { readFile, stat } from 'node:fs/promises';

/**
 * @param {string} filePath
 * @returns {Promise<{ path: string; content: Buffer; bytesRead: number; sizeBytes: number; mtimeMs: number }>}
 */
export async function readBytesFileSnapshot(filePath) {
    const [content, stats] = await Promise.all([readFile(filePath), stat(filePath)]);
    return {
        path: filePath,
        content,
        bytesRead: content.byteLength,
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
    };
}
