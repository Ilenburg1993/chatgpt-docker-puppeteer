// @ts-check
/**
 * Helpers de tipo e fingerprint para entradas de scan.
 *
 * @module copilot/infra/scan/fingerprint
 */

import { realpath } from 'node:fs/promises';

/**
 * @param {import('node:fs').Stats} stats
 * @returns {'file' | 'directory' | 'symlink' | 'other'}
 */
export function classifyStats(stats) {
    if (stats.isFile()) return 'file';
    if (stats.isDirectory()) return 'directory';
    if (stats.isSymbolicLink()) return 'symlink';
    return 'other';
}

/**
 * @param {string} absolutePath
 * @param {import('node:fs').Stats} stats
 * @param {<T>(fn: () => Promise<T>) => Promise<T>} limit
 * @returns {Promise<{ realpath: string; mtimeMs: number; size: number }>}
 */
export async function buildFileFingerprint(absolutePath, stats, limit) {
    const canonicalPath = await limit(() => realpath(absolutePath)).catch(() => absolutePath);
    return {
        realpath: canonicalPath,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
    };
}
