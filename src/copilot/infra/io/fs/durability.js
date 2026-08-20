// @ts-check
/**
 * Best-effort durability helpers for low-level filesystem mutations.
 *
 * Node can flush file descriptors through `FileHandle.sync()`, but directory fsync is platform/filesystem dependent.
 * These helpers deliberately treat unsupported directory sync as a reported best-effort miss rather than a hard
 * failure.
 *
 * @module copilot/infra/io/fs/durability
 */

import * as fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

/** @typedef {'none' | 'file' | 'file-and-directory'} IoDurabilityMode */

const DIRECTORY_SYNC_UNSUPPORTED_CODES = new Set(['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOSYS', 'ENOTSUP', 'EPERM']);
const FILE_SYNC_UNSUPPORTED_CODES = new Set(['EINVAL', 'ENOSYS', 'ENOTSUP']);

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
 * Promove falhas reais de sync a erro, preservando misses explicitamente classificados como unsupported/best-effort.
 *
 * @param {{ attempted: boolean; ok: boolean; skippedReason?: string; errorCode?: string }} result
 * @param {{ message: string; code: 'EFILESYNC' | 'EDIRECTORYSYNC' }} options
 * @returns {void}
 */
export function assertSuccessfulSync(result, options) {
    if (!result.attempted || result.ok || result.skippedReason) return;
    const error = new Error(options.message);
    /** @type {{ code?: string; cause?: unknown; syncResult?: typeof result }} */ (error).code = options.code;
    /** @type {{ code?: string; cause?: unknown; syncResult?: typeof result }} */ (error).cause = result.errorCode;
    /** @type {{ code?: string; cause?: unknown; syncResult?: typeof result }} */ (error).syncResult = result;
    throw error;
}

/**
 * Flush an already-open file descriptor without reopening the path. This is the preferred primitive while the caller
 * still owns a staging handle because data and metadata mutations on that handle are ordered before the durability
 * barrier.
 *
 * @param {import('node:fs/promises').FileHandle} handle
 * @returns {Promise<{
 *     attempted: boolean;
 *     ok: boolean;
 *     skippedReason?: string;
 *     errorCode?: string;
 *     durationMs: number;
 * }>}
 */
export async function syncFileHandleBestEffort(handle) {
    const startedAt = performance.now();
    /** @param {{ attempted: boolean; ok: boolean; skippedReason?: string; errorCode?: string }} value */
    const finish = (value) => ({ ...value, durationMs: Math.max(0, performance.now() - startedAt) });
    try {
        await handle.sync();
        return finish({ attempted: true, ok: true });
    } catch (error) {
        const code = String(/** @type {{ code?: unknown }} */ (error)?.code ?? 'UNKNOWN');
        if (FILE_SYNC_UNSUPPORTED_CODES.has(code)) {
            return finish({ attempted: true, ok: false, skippedReason: 'file-sync-unsupported', errorCode: code });
        }
        return finish({ attempted: true, ok: false, errorCode: code });
    }
}

/**
 * @param {string} filePath
 * @returns {Promise<{
 *     attempted: boolean;
 *     ok: boolean;
 *     skippedReason?: string;
 *     errorCode?: string;
 *     durationMs: number;
 * }>}
 */
export async function syncFileBestEffort(filePath) {
    const startedAt = performance.now();
    /** @param {{ attempted: boolean; ok: boolean; skippedReason?: string; errorCode?: string }} value */
    const finish = (value) => ({ ...value, durationMs: Math.max(0, performance.now() - startedAt) });
    if (typeof fs.open !== 'function')
        return finish({ attempted: false, ok: false, skippedReason: 'fs.open-unavailable' });
    /** @type {import('node:fs/promises').FileHandle | null} */
    let handle = null;
    try {
        handle = await fs.open(filePath, 'r');
        const result = await syncFileHandleBestEffort(handle);
        const { durationMs: _syncDurationMs, ...rest } = result;
        void _syncDurationMs;
        return finish(rest);
    } catch (error) {
        const code = String(/** @type {{ code?: unknown }} */ (error)?.code ?? 'UNKNOWN');
        return finish({ attempted: false, ok: false, errorCode: code });
    } finally {
        if (handle) await handle.close().catch(() => undefined);
    }
}

/**
 * @param {string} targetPath
 * @returns {Promise<{
 *     attempted: boolean;
 *     ok: boolean;
 *     skippedReason?: string;
 *     errorCode?: string;
 *     durationMs: number;
 * }>}
 */
export async function syncParentDirectoryBestEffort(targetPath) {
    const startedAt = performance.now();
    /** @param {{ attempted: boolean; ok: boolean; skippedReason?: string; errorCode?: string }} value */
    const finish = (value) => ({ ...value, durationMs: Math.max(0, performance.now() - startedAt) });
    if (typeof fs.open !== 'function')
        return finish({ attempted: false, ok: false, skippedReason: 'fs.open-unavailable' });
    /** @type {import('node:fs/promises').FileHandle | null} */
    let handle = null;
    try {
        handle = await fs.open(path.dirname(targetPath), 'r');
        await handle.sync();
        return finish({ attempted: true, ok: true });
    } catch (error) {
        const code = String(/** @type {{ code?: unknown }} */ (error)?.code ?? 'UNKNOWN');
        if (DIRECTORY_SYNC_UNSUPPORTED_CODES.has(code)) {
            return finish({ attempted: true, ok: false, skippedReason: 'directory-sync-unsupported', errorCode: code });
        }
        return finish({ attempted: true, ok: false, errorCode: code });
    } finally {
        if (handle) await handle.close().catch(() => undefined);
    }
}
