// @ts-check
/**
 * Best-effort durability helpers for low-level filesystem mutations.
 *
 * Node can flush file descriptors through `FileHandle.sync()`, but directory fsync is platform/filesystem dependent.
 * These helpers deliberately treat unsupported directory sync as a reported best-effort miss rather than a hard failure.
 *
 * @module copilot/infra/io/fs/durability
 */

import * as fs from 'node:fs/promises';
import path from 'node:path';

/** @typedef {'none' | 'file' | 'file-and-directory'} IoDurabilityMode */

const DIRECTORY_SYNC_UNSUPPORTED_CODES = new Set(['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOSYS', 'ENOTSUP', 'EPERM']);

/**
 * @param {unknown} value
 * @returns {IoDurabilityMode}
 */
export function normalizeIoDurability(value) {
    return value === 'none' || value === 'file' || value === 'file-and-directory' ? value : 'file-and-directory';
}

/**
 * @param {IoDurabilityMode} durability
 * @returns {boolean}
 */
export function shouldFlushFile(durability) {
    return durability === 'file' || durability === 'file-and-directory';
}

/**
 * @param {IoDurabilityMode} durability
 * @returns {boolean}
 */
export function shouldSyncDirectory(durability) {
    return durability === 'file-and-directory';
}

/**
 * @param {string} filePath
 * @returns {Promise<{ attempted: boolean; ok: boolean; skippedReason?: string; errorCode?: string }>}
 */
export async function syncFileBestEffort(filePath) {
    if (typeof fs.open !== 'function') return { attempted: false, ok: false, skippedReason: 'fs.open-unavailable' };
    /** @type {import('node:fs/promises').FileHandle | null} */
    let handle = null;
    try {
        handle = await fs.open(filePath, 'r');
        await handle.sync();
        return { attempted: true, ok: true };
    } catch (error) {
        const code = String(/** @type {{ code?: unknown }} */ (error)?.code ?? 'UNKNOWN');
        return { attempted: true, ok: false, errorCode: code };
    } finally {
        if (handle) await handle.close().catch(() => undefined);
    }
}

/**
 * @param {string} targetPath
 * @returns {Promise<{ attempted: boolean; ok: boolean; skippedReason?: string; errorCode?: string }>}
 */
export async function syncParentDirectoryBestEffort(targetPath) {
    if (typeof fs.open !== 'function') return { attempted: false, ok: false, skippedReason: 'fs.open-unavailable' };
    /** @type {import('node:fs/promises').FileHandle | null} */
    let handle = null;
    try {
        handle = await fs.open(path.dirname(targetPath), 'r');
        await handle.sync();
        return { attempted: true, ok: true };
    } catch (error) {
        const code = String(/** @type {{ code?: unknown }} */ (error)?.code ?? 'UNKNOWN');
        if (DIRECTORY_SYNC_UNSUPPORTED_CODES.has(code)) {
            return { attempted: true, ok: false, skippedReason: 'directory-sync-unsupported', errorCode: code };
        }
        return { attempted: true, ok: false, errorCode: code };
    } finally {
        if (handle) await handle.close().catch(() => undefined);
    }
}
