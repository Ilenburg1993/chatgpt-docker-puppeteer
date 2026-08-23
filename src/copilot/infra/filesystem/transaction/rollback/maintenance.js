// @ts-check
/** Retention, expiration, quota enforcement and purge lifecycle for rollback sidecars. */

import { acquireIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import { positiveIntegerOr } from '#copilot/infra/internal/platform/config-values';
import { assertSuccessfulSync, syncParentDirectoryBestEffort } from '#copilot/infra/internal/platform/node/filesystem';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { PENDING_FILE_PATTERN, SIDECAR_FILE_PATTERN } from './format.js';
import { createDefaultIoRollbackPolicy } from './policy.js';

const DEFAULT_CLEANUP_MAX_ENTRIES = 512;
/** @param {unknown} error */
function isMissingDirectoryError(error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}
function emptyRollbackCleanupResult() {
    return {
        scanned: 0,
        removed: 0,
        removedBytes: 0,
        expiredRemoved: 0,
        budgetRemoved: 0,
        purged: 0,
        failed: 0,
        remainingCount: 0,
        remainingBytes: 0,
        limited: false,
    };
}

/**
 * Cleanup canônico de sidecars. Sempre remove expirados; opcionalmente purga todos os nomes válidos ou aplica budgets
 * de quantidade/bytes aos sidecars ainda ativos. Nomes desconhecidos permanecem intocados.
 *
 * @param {{
 *     directory?: string;
 *     nowMs?: number;
 *     scanLimit?: number;
 *     maxEntries?: number;
 *     maxBytes?: number;
 *     purgeAll?: boolean;
 *     enforceBudget?: boolean;
 *     preservePath?: string;
 *     policy?: import('./policy.js').IoRollbackPolicy;
 * }} [options]
 * @returns {Promise<{
 *     scanned: number;
 *     removed: number;
 *     removedBytes: number;
 *     expiredRemoved: number;
 *     budgetRemoved: number;
 *     purged: number;
 *     failed: number;
 *     remainingCount: number;
 *     remainingBytes: number;
 *     limited: boolean;
 * }>}
 */
export async function cleanupRollbackSidecars(options = {}) {
    const policy = options.policy ?? createDefaultIoRollbackPolicy();
    const directory = path.resolve(options.directory ?? policy.directory);
    const nowMs = Math.trunc(options.nowMs ?? Date.now());
    const scanLimit = positiveIntegerOr(options.scanLimit, DEFAULT_CLEANUP_MAX_ENTRIES);
    const maxEntries = positiveIntegerOr(options.maxEntries, policy.maxEntries);
    const maxBytes = positiveIntegerOr(options.maxBytes, policy.maxBytes);
    const purgeAll = options.purgeAll === true;
    const enforceBudget = options.enforceBudget !== false;
    const preservePath = options.preservePath ? path.resolve(options.preservePath) : null;
    const directoryExists = await fs
        .readdir(directory, { withFileTypes: true })
        .then(() => true)
        .catch((error) => {
            if (isMissingDirectoryError(error)) return false;
            throw error;
        });
    if (!directoryExists) return emptyRollbackCleanupResult();
    const lease = await acquireIoResourceLock(path.join(directory, '.cleanup'), {
        fileLock: true,
        fileLockDir: path.join(directory, '.locks'),
        operation: 'rollback-sidecar.cleanup',
        target: directory,
    });
    try {
        return await lease.run(async () => {
            const entries = await fs.readdir(directory, { withFileTypes: true });
            const recognizedCount = entries.filter(
                (entry) =>
                    entry.isFile() && (SIDECAR_FILE_PATTERN.test(entry.name) || PENDING_FILE_PATTERN.test(entry.name)),
            ).length;
            const recognized = [];
            for (const entry of entries) {
                if (!entry.isFile() || recognized.length >= scanLimit) continue;
                const sidecarMatch = SIDECAR_FILE_PATTERN.exec(entry.name);
                const pendingMatch = sidecarMatch ? null : PENDING_FILE_PATTERN.exec(entry.name);
                const match = sidecarMatch ?? pendingMatch;
                if (!match) continue;
                const filePath = path.join(directory, entry.name);
                const stats = await fs.lstat(filePath).catch(() => null);
                if (!stats?.isFile()) continue;
                recognized.push({
                    name: entry.name,
                    path: filePath,
                    bytes: stats.size,
                    mtimeMs: stats.mtimeMs,
                    expiresAtMs: Number(match[1]),
                    sidecar: Boolean(sidecarMatch),
                });
            }

            const activeSidecars = recognized
                .filter((item) => item.sidecar && Number.isSafeInteger(item.expiresAtMs) && item.expiresAtMs > nowMs)
                .sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
            const retained = new Set();
            if (!purgeAll && enforceBudget) {
                let retainedCount = 0;
                let retainedBytes = 0;
                const preserved = preservePath
                    ? (activeSidecars.find((item) => path.resolve(item.path) === preservePath) ?? null)
                    : null;
                if (preserved) {
                    retained.add(preserved.path);
                    retainedCount = 1;
                    retainedBytes = preserved.bytes;
                }
                for (const item of activeSidecars) {
                    if (preserved && item.path === preserved.path) continue;
                    const fitsCount = retainedCount < maxEntries;
                    const fitsBytes = retainedBytes + item.bytes <= maxBytes || retainedCount === 0;
                    if (!fitsCount || !fitsBytes) continue;
                    retained.add(item.path);
                    retainedCount += 1;
                    retainedBytes += item.bytes;
                }
            }

            let removed = 0;
            let removedBytes = 0;
            let expiredRemoved = 0;
            let budgetRemoved = 0;
            let purged = 0;
            let failed = 0;
            const removedPaths = new Set();
            for (const item of recognized) {
                const expired = Number.isSafeInteger(item.expiresAtMs) && item.expiresAtMs <= nowMs;
                const overBudget = item.sidecar && enforceBudget && !purgeAll && !expired && !retained.has(item.path);
                if (!purgeAll && !expired && !overBudget) continue;
                try {
                    await fs.unlink(item.path);
                    removed += 1;
                    removedBytes += item.bytes;
                    removedPaths.add(item.path);
                    if (purgeAll) purged += 1;
                    else if (expired) expiredRemoved += 1;
                    else budgetRemoved += 1;
                } catch {
                    failed += 1;
                }
            }

            if (removed > 0) {
                const directorySync = await syncParentDirectoryBestEffort(path.join(directory, '.cleanup'));
                assertSuccessfulSync(directorySync, {
                    code: 'EDIRECTORYSYNC',
                    message: `Falha ao sincronizar cleanup de sidecars de rollback: ${directory}`,
                });
            }
            const remaining = recognized.filter((item) => !removedPaths.has(item.path));
            return {
                scanned: recognized.length,
                removed,
                removedBytes,
                expiredRemoved,
                budgetRemoved,
                purged,
                failed,
                remainingCount: remaining.length,
                remainingBytes: remaining.reduce((sum, item) => sum + item.bytes, 0),
                limited: recognizedCount > recognized.length,
            };
        });
    } finally {
        await lease.releaseAsync();
    }
}

/**
 * Compatibilidade: cleanup estritamente por expiração, sem aplicar budgets aos sidecars ativos.
 *
 * @param {{ directory?: string; nowMs?: number; maxEntries?: number; policy?: import('./policy.js').IoRollbackPolicy }} [options]
 */
export async function cleanupExpiredRollbackSidecars(options = {}) {
    return cleanupRollbackSidecars({
        ...(options.directory === undefined ? {} : { directory: options.directory }),
        ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
        ...(options.policy === undefined ? {} : { policy: options.policy }),
        scanLimit: positiveIntegerOr(options.maxEntries, DEFAULT_CLEANUP_MAX_ENTRIES),
        enforceBudget: false,
    });
}
