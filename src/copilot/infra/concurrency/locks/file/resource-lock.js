// @ts-check
/** Multiprocess file-lock acquisition protocol and idempotent lease release. */

import {
    normalizeIoDurability,
    shouldSyncDirectory,
    syncParentDirectoryBestEffort,
} from '#copilot/infra/internal/platform/node/filesystem';
import { normalizePathResourceKey } from '#copilot/infra/internal/policy';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import {
    assertFileLockPathIsNotSymlink,
    isStaleFileLock,
    observeFileLock,
    reclaimStaleFileLock,
    releaseOwnedFileLock,
    startFileLockHeartbeat,
    writeFileLockMetadata,
} from './metadata.js';
import {
    DEFAULT_FILE_RESOURCE_LOCK_POLL_MS,
    FILE_RESOURCE_LOCK_SCHEMA_VERSION,
    defaultFileResourceLockAcquireTimeoutMs,
    defaultFileResourceLockStaleMs,
    getFileResourceLockDir,
    getFileResourceLockPath,
    hashFileResourceLockKey,
} from './policy.js';
import {
    beginFileLockContention,
    endFileLockContention,
    forgetActiveFileLock,
    recordFileLockAcquired,
    recordFileLockAttempt,
    recordFileLockFailure,
} from './state.js';
import { createFileLockAbortError, createFileLockTimeoutError, fileLockErrorCode, sleepForFileLock } from './wait.js';

/** @typedef {import('./types.js').FileResourceLockMetadata} FileResourceLockMetadata */
/** @typedef {import('./types.js').FileResourceLockLease} FileResourceLockLease */
/** @typedef {import('./types.js').IoDurabilityMode} IoDurabilityMode */

/**
 * @param {string} resourceKey
 * @param {{
 *     operation?: string;
 *     target?: string;
 *     lockDir?: string;
 *     lockPath?: string;
 *     staleMs?: number;
 *     timeoutMs?: number;
 *     pollMs?: number;
 *     signal?: AbortSignal;
 *     durability?: IoDurabilityMode;
 * }} [options]
 * @returns {Promise<FileResourceLockLease>}
 */
export async function acquireFileResourceLock(resourceKey, options = {}) {
    recordFileLockAttempt();
    const normalizedKey = normalizePathResourceKey(resourceKey);
    const explicitLockPath = options.lockPath ? path.resolve(options.lockPath) : null;
    const lockDir = explicitLockPath
        ? path.dirname(explicitLockPath)
        : options.lockDir
          ? path.resolve(options.lockDir)
          : getFileResourceLockDir();
    const lockPath = explicitLockPath ?? getFileResourceLockPath(normalizedKey, lockDir);
    const timeoutMs = options.timeoutMs ?? defaultFileResourceLockAcquireTimeoutMs();
    const staleMs = options.staleMs ?? defaultFileResourceLockStaleMs();
    const pollMs = options.pollMs ?? DEFAULT_FILE_RESOURCE_LOCK_POLL_MS;
    const durability = normalizeIoDurability(options.durability ?? 'file-and-directory');
    const startedWait = Date.now();
    let staleRecovered = false;
    let observedContention = false;

    try {
        await fs.mkdir(lockDir, { recursive: true });
        await assertFileLockPathIsNotSymlink(lockPath);

        while (true) {
            if (options.signal?.aborted) throw createFileLockAbortError();
            /** @type {import('node:fs/promises').FileHandle | null} */
            let handle = null;
            const token = randomUUID();
            const now = Date.now();
            /** @type {FileResourceLockMetadata} */
            const metadata = {
                schemaVersion: FILE_RESOURCE_LOCK_SCHEMA_VERSION,
                token,
                pid: process.pid,
                hostname: hostname(),
                resourceKey: normalizedKey,
                resourceHash: hashFileResourceLockKey(normalizedKey),
                operation: options.operation ?? null,
                target: options.target ?? null,
                startedAt: new Date(now).toISOString(),
                startedAtMs: now,
            };

            try {
                handle = await fs.open(lockPath, 'wx');
                await writeFileLockMetadata(handle, metadata, durability);
                if (shouldSyncDirectory(durability)) await syncParentDirectoryBestEffort(lockPath);
                const waitMs = Date.now() - startedWait;
                recordFileLockAcquired(lockPath, metadata, waitMs, staleRecovered, options.operation);
                const lockHandle = handle;
                handle = null;
                const heartbeat = startFileLockHeartbeat(lockHandle, staleMs);
                let releasePromise = /** @type {Promise<void> | null} */ (null);
                return {
                    resourceKey: normalizedKey,
                    lockPath,
                    token,
                    waitMs,
                    staleRecovered,
                    release: () => {
                        if (releasePromise) return releasePromise;
                        releasePromise = (async () => {
                            clearInterval(heartbeat);
                            await lockHandle.close().catch(() => undefined);
                            await releaseOwnedFileLock(lockPath, token, durability);
                        })().finally(() => {
                            forgetActiveFileLock(lockPath);
                        });
                        return releasePromise;
                    },
                };
            } catch (error) {
                if (handle) await handle.close().catch(() => undefined);
                if (fileLockErrorCode(error) !== 'EEXIST') throw error;

                if (!observedContention) {
                    observedContention = true;
                    beginFileLockContention();
                }
                await assertFileLockPathIsNotSymlink(lockPath);
                const existing = await observeFileLock(lockPath);
                if (isStaleFileLock(existing, Date.now(), staleMs)) {
                    const reclaimed = await reclaimStaleFileLock(lockPath, existing, durability);
                    staleRecovered = staleRecovered || reclaimed;
                    if (reclaimed) continue;
                }

                if (Date.now() - startedWait >= timeoutMs) throw createFileLockTimeoutError(lockPath);
                await sleepForFileLock(
                    Math.min(pollMs, Math.max(1, timeoutMs - (Date.now() - startedWait))),
                    options.signal,
                );
            }
        }
    } catch (error) {
        const code = fileLockErrorCode(error);
        recordFileLockFailure(code);
        throw error;
    } finally {
        if (observedContention) endFileLockContention();
    }
}
