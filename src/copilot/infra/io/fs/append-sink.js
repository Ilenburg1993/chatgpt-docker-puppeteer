// @ts-check
/**
 * Append sink primitive for file descriptors intentionally inherited by detached child processes.
 *
 * The IO engine cannot serialize writes performed by the child after spawn, but it can make creation of the pathname
 * explicit and durable. Exclusive create first distinguishes a newly published directory entry without a TOCTOU stat.
 * Existing files are reopened in append mode without changing their namespace.
 *
 * @module copilot/infra/io/fs/append-sink
 */

import { open } from 'node:fs/promises';
import {
    assertSuccessfulSync,
    normalizeIoDurability,
    shouldSyncDirectory,
    syncParentDirectoryBestEffort,
} from './durability.js';
import { markMutationAppliedError } from './mutation-state.js';

/**
 * @param {string} filePath
 * @param {{
 *     mode?: number;
 *     durability?: import('./durability.js').IoDurabilityMode;
 *     syncDirectory?: typeof syncParentDirectoryBestEffort;
 * }} [options]
 * @returns {Promise<{
 *     handle: import('node:fs/promises').FileHandle;
 *     created: boolean;
 *     durability: import('./durability.js').IoDurabilityMode;
 *     directorySync: Awaited<ReturnType<typeof syncParentDirectoryBestEffort>> | null;
 * }>}
 */
export async function openDetachedAppendSinkUnlocked(filePath, options = {}) {
    const durability = normalizeIoDurability(options.durability);
    const mode = options.mode ?? 0o600;
    /** @type {import('node:fs/promises').FileHandle | null} */
    let handle = null;
    let created = false;
    try {
        try {
            handle = await open(filePath, 'ax', mode);
            created = true;
        } catch (error) {
            if (/** @type {{ code?: unknown }} */ (error)?.code !== 'EEXIST') throw error;
            handle = await open(filePath, 'a', mode);
        }

        /** @type {Awaited<ReturnType<typeof syncParentDirectoryBestEffort>> | null} */
        let directorySync = null;
        if (created && shouldSyncDirectory(durability)) {
            directorySync = await (options.syncDirectory ?? syncParentDirectoryBestEffort)(filePath);
            assertSuccessfulSync(directorySync, {
                code: 'EDIRECTORYSYNC',
                message: `Failed to synchronize detached append sink directory: ${filePath}`,
            });
        }
        return { handle, created, durability, directorySync };
    } catch (error) {
        await handle?.close().catch(() => undefined);
        throw created
            ? markMutationAppliedError(error, { phase: 'append-sink-directory-sync', paths: [filePath] })
            : error;
    }
}
